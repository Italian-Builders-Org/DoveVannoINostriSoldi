#!/usr/bin/env python3
"""Build the Investigative Explorer relation artifact from DVNS integrated sources.

Draft PR for issue #105 (vertical slice: incarichi-nominativi-shard).

Each source row becomes ONE edge, keyed by (source_dataset, source_record_id).
We never merge two people that share a name: without a stable identifier each
row stays a distinct edge. Every edge keeps full provenance and a per-relation
caveat. The transform is fail-closed: any unexpected shape aborts the build.

In this repository the input is the already-extracted relation CSV under
data/relations/. In the DVNS portale the generator reads the committed integrated
rows (data/source-ledger / src/data/generated/integrated/rows) with the SAME
contract; only --input changes. No network access is required (requiresNetworkInput
is false), so the build and --check run offline under the DVNS network guard.
"""

from __future__ import annotations

import argparse
import csv
import gzip
import hashlib
import json
import re
import sys
from collections import defaultdict
from datetime import datetime, timezone
from pathlib import Path
from urllib.parse import parse_qsl, unquote, urlsplit

OUTPUT = Path("src/data/generated/investigative-explorer-incarichi.json")
DEFAULT_INPUT = Path(
    "data/relations/persona_incarico_ente__incarichi_nominativi_shard.csv"
)
DEFAULT_INPUT_DIR = Path("src/data/generated/integrated/rows")
SOURCE_DATASET = "incarichi-nominativi-shard"
OWNER = "DoveVannoINostriSoldi · Investigative Explorer (slice incarichi)"
ROUTE_URL = "https://www.dovevannoinostrisoldi.com/esplora"
TRANSFORM_VERSION = 3
MAX_ARTIFACT_BYTES = 50 * 1024 * 1024

# PerlaPA act extrema in the note (e.g. INPS.6480.20/06/2025.0003791).
ACT_EXTREMA_RE = re.compile(r"([A-Z]{2,}[A-Z0-9]*\.\d+\.\d{2}/\d{2}/\d{4}\.\d+)")
CIG_RE = re.compile(r"\b(?:codice\s+)?cig(?:\s+(?:derivato|smart))?\s*(?:n\.?\s*)?[:#-]?\s*([A-Z0-9]{10})\b", re.IGNORECASE)
CUP_RE = re.compile(r"\b(?:codice\s+)?cup\s*(?:n\.?\s*)?[:#-]?\s*([A-Z0-9]{15})\b", re.IGNORECASE)
SAFE_CIG_RE = re.compile(r"^[A-Z0-9]{10}$")
SAFE_CUP_RE = re.compile(r"^[A-Z0-9]{15}$")
AMOUNT_SCALE_FACTORS = (100, 1000)

MERGE_POLICY = (
    "Due persone con lo stesso nominativo NON sono fuse: ogni riga di origine "
    "resta un arco distinto identificato da source_record_id."
)
CAVEAT = (
    "Un collegamento indica dove approfondire, non un'illegittimita'. "
    "Non sommare importi o perimetri tra dataset diversi. "
    "I record gemelli con lo stesso riferimento interno e importo in rapporto ×100 o ×1000 sono "
    "marcati suspect_duplicate ed esclusi da aggregati e ricerca; la riga resta nell'artifact."
)
AMOUNT_SCALE_TWINS = (
    "Stesso soggetto, stesso ente, stesso riferimento interno di origine e stesso periodo, "
    "importi in rapporto esatto ×100 o ×1000: si tiene l'importo coincidente con la moda "
    "dei pari (stesso ente, periodo e ruolo), altrimenti il minore; gli altri archi "
    "restano con suspect_duplicate. Nessuna riga è cancellata."
)

REQUIRED = (
    "relation_type",
    "subject_type",
    "subject_key",
    "object_type",
    "object_key",
    "source_dataset",
    "source_record_id",
    "acquisition_date",
    "confidence_note",
)


class ContractError(RuntimeError):
    """Fail-closed: the artifact does not satisfy the published contract."""


def utc_now() -> str:
    return datetime.now(timezone.utc).isoformat(timespec="seconds").replace("+00:00", "Z")


def _non_empty(value: object, field: str) -> str:
    if not isinstance(value, str) or not value.strip():
        raise ContractError(f"{field}: valore obbligatorio mancante")
    return value.strip()


def _amount(value: object, field: str) -> float | None:
    """Parse a possibly messy Euro amount into a float (or None).

    Handles Italian formats: "1.234,56" (dot thousands, comma decimal),
    "1,234.56" (comma thousands, dot decimal) and "1234,56"/"1234.56".
    The last-occurring separator wins as the decimal marker.

    Non-numeric placeholders used by PA sources ("n.d.", "n/d", "N.D.", "na",
    "—", empty) carry no digits, so they are treated as a missing amount (None)
    rather than aborting the build. A string that DOES contain digits but cannot
    be parsed is a genuine anomaly and fails closed.
    """
    if value is None or value == "":
        return None
    s = str(value).strip()
    if not s:
        return None
    norm = "".join(ch for ch in s.lower() if ch.isalnum())
    if not norm or not any(ch.isdigit() for ch in norm):
        return None
    if "," in s and "." in s:
        if s.rfind(",") > s.rfind("."):
            s = s.replace(".", "").replace(",", ".")  # comma = decimal
        else:
            s = s.replace(",", "")  # dot = decimal
    elif "," in s:
        s = s.replace(",", ".")
    elif "." in s and s.count(".") > 1:
        s = s.replace(".", "")
    try:
        amount = float(s)
    except (TypeError, ValueError) as error:
        raise ContractError(f"{field}: importo non valido ({value!r})") from error
    if amount < 0:
        raise ContractError(f"{field}: importo negativo non ammesso")
    return amount


def load_rows(path: Path) -> list[dict]:
    with path.open(encoding="utf-8", newline="") as fh:
        reader = csv.DictReader(fh)
        missing = [c for c in REQUIRED if c not in (reader.fieldnames or [])]
        if missing:
            raise ContractError(f"colonne obbligatorie assenti nel CSV: {missing}")
        return list(reader)


def _safe_source_url(value: object) -> str | None:
    """Keep only public HTTP(S) URLs suitable for a committed artifact."""
    if not isinstance(value, str):
        return None
    candidate = value.strip()
    decoded = unquote(candidate)
    if not candidate or any(ord(char) < 0x20 or ord(char) == 0x7F or char.isspace() for char in decoded):
        return None
    try:
        parsed = urlsplit(candidate)
        hostname = parsed.hostname
        port = parsed.port
    except ValueError:
        return None
    if (
        parsed.scheme.lower() not in {"http", "https"}
        or not hostname
        or "@" in parsed.netloc
        or parsed.username
        or parsed.password
    ):
        return None
    sensitive_query = {"auth", "authorization", "apikey", "credential", "password", "secret", "session", "signature", "token"}
    if any(
        key.lower().replace("-", "_") in sensitive_query
        or key.lower().endswith(("_token", "_secret", "_password", "_signature"))
        for key, _ in parse_qsl(parsed.query, keep_blank_values=True)
    ):
        return None
    lowered = hostname.rstrip(".").lower()
    if lowered in {"localhost", "localhost.localdomain"} or lowered.endswith((".localhost", ".local", ".internal", ".test")):
        return None
    # Reject resolver-specific numeric host spellings instead of risking a
    # decimal, hexadecimal or dotted-octal alias for a private address.
    if re.fullmatch(r"(?:0x[0-9a-f]+|\d+)", lowered) or (
        re.fullmatch(r"[0-9.]+", lowered)
        and any(part.startswith("0") and len(part) > 1 for part in lowered.split("."))
    ):
        return None
    try:
        import ipaddress

        address = ipaddress.ip_address(lowered)
    except ValueError:
        address = None
    if address is not None and (
        address.is_private
        or address.is_loopback
        or address.is_link_local
        or address.is_reserved
        or address.is_multicast
        or address.is_unspecified
    ):
        return None
    if port is not None and not 1 <= port <= 65535:
        return None
    return candidate


def _source_url(values: object) -> str | None:
    candidates = values if isinstance(values, list) else [values]
    for value in candidates:
        if not isinstance(value, str):
            continue
        for candidate in re.split(r",\s*(?=https?://)", value, flags=re.IGNORECASE):
            safe = _safe_source_url(candidate)
            if safe:
                return safe
    return None


def _reference_codes(cig: object, text: object) -> dict[str, list[str]]:
    """Extract identifiers only; never copy the source prose into the artifact."""
    values = {"cig": set(), "cup": set()}
    direct_cig = str(cig or "").strip().upper()
    if (
        SAFE_CIG_RE.fullmatch(direct_cig)
        and direct_cig != "0000000000"
        and any(char.isdigit() for char in direct_cig)
    ):
        values["cig"].add(direct_cig)
    source_text = text if isinstance(text, str) else ""
    for match in CIG_RE.finditer(source_text):
        code = match.group(1).upper()
        if code != "0000000000" and any(char.isdigit() for char in code):
            values["cig"].add(code)
    for match in CUP_RE.finditer(source_text):
        values["cup"].add(match.group(1).upper())
    return {key: sorted(codes) for key, codes in values.items()}


def _part_files(path: Path) -> list[Path]:
    if not path.is_dir():
        raise ContractError(f"directory input non trovato: {path}")
    pattern = re.compile(rf"^{re.escape(SOURCE_DATASET)}\.part-(\d{{5}})\.jsonl\.gz$")
    found: list[tuple[int, Path]] = []
    for candidate in path.iterdir():
        match = pattern.fullmatch(candidate.name)
        if match and candidate.is_file():
            found.append((int(match.group(1)), candidate))
    found.sort(key=lambda item: item[0])
    if not found:
        raise ContractError(f"nessun part-file {SOURCE_DATASET} trovato in {path}")
    ordinals = [ordinal for ordinal, _ in found]
    if ordinals != list(range(len(ordinals))):
        raise ContractError("part-file non contigui: input non riproducibile")
    return [candidate for _, candidate in found]


# Public projection of incarichi-nominativi-shard in the DVNS portale.
# cf_ente / cf_piva are privateFields and are excluded by their pipeline.
DVNS_PUBLIC_FIELDS = (
    "ente",
    "ipa",
    "tipo",
    "nominativo",
    "oggetto",
    "cig",
    "importo_euro",
    "data",
    "fonte_url",
    "note",
)


def _row_sha256(row: dict) -> str:
    canonical = json.dumps(row, ensure_ascii=False, sort_keys=True, separators=(",", ":"))
    return hashlib.sha256(canonical.encode("utf-8")).hexdigest()


def load_dvns_rows(path: Path, acquired: str | None = None) -> list[dict]:
    """Read the DVNS public integrated rows (jsonl.gz) for the slice dataset.

    Each integrated row wraps its public projection in a ``cells`` object and
    carries ``sourceRowSha256`` (the authoritative, stable per-source-row id).
    Private fields (cf_ente/cf_piva) are already redacted by their pipeline and
    are not part of our relation; we only read the public cells. Two distinct
    acts never collapse because source_record_id is the DVNS source-row hash.
    """
    rows: list[dict] = []
    paths = _part_files(path) if path.is_dir() else [path]
    for input_path in paths:
        handle = gzip.open(input_path, "rt", encoding="utf-8") if str(input_path).endswith(".gz") else input_path.open(encoding="utf-8")
        with handle:
            for line in handle:
                line = line.strip()
                if not line:
                    continue
                r = json.loads(line)
                cells = r.get("cells") or {}
                public = {field: (cells.get(field) or "") for field in DVNS_PUBLIC_FIELDS}
                nominativo = (public.get("nominativo") or "").strip()
                ente = (public.get("ente") or "").strip()
                if not nominativo or not ente:
                    continue
                oggetto = (public.get("oggetto") or "").strip()
                note = (public.get("note") or "").strip()
                cig = (public.get("cig") or "").strip()
                source_urls = r.get("sourceUrls") or []
                source_url = _source_url(source_urls) or _source_url(public.get("fonte_url"))
                source_record_id = (r.get("sourceRowSha256") or "").strip() or _row_sha256(public)
                rows.append(
                    {
                        "relation_type": "person_has_appointment",
                        "subject_type": "person",
                        "subject_key": nominativo,
                        "object_type": "public_entity",
                        "object_key": ente,
                        "source_dataset": SOURCE_DATASET,
                        "source_record_id": source_record_id,
                        "period": (public.get("data") or "").strip(),
                        "acquisition_date": acquired or "",
                        "confidence_note": (
                            "Incarico da fonte estesa (AT/enti). Non sommare righe o importi "
                            "con altri dataset di incarichi senza riconciliazione."
                        ),
                        "role": (public.get("tipo") or "").strip() or None,
                        "importo_if_present": (public.get("importo_euro") or "").strip(),
                        "ipa": (public.get("ipa") or "").strip() or None,
                        "fonte_url": source_url,
                        "_legacy_source_url": (
                            (source_urls[0] if source_urls else public.get("fonte_url") or "")
                            if isinstance(source_urls, list)
                            else public.get("fonte_url") or ""
                        ).strip() or None,
                        "references": _reference_codes(cig, f"{cig} {oggetto} {note}"),
                        "_legacy_note_source": "; ".join(
                            part for part in (f"CIG {cig}" if cig else "", oggetto, note) if part
                        ) or None,
                        "_act_extrema": _act_extrema(
                            "; ".join(part for part in (f"CIG {cig}" if cig else "", oggetto, note) if part)
                        ),
                    }
                )
    if not rows:
        raise ContractError("nessun arco estraibile dalle righe integrate DVNS")
    return rows


EDGE_FIELDS = (
    "relation_type",
    "subject_type",
    "subject_key",
    "object_type",
    "object_key",
    "source_dataset",
    "source_record_id",
    "period",
    "acquisition_date",
    "confidence_note",
    "role",
    "amount",
    "ipa",
    "source_url",
    "references",
)


def _edge_key(rel: dict) -> str:
    return json.dumps([rel[field] for field in EDGE_FIELDS], ensure_ascii=False, sort_keys=True)


LEGACY_EDGE_FIELDS = (
    "relation_type", "subject_type", "subject_key", "object_type", "object_key",
    "source_dataset", "source_record_id", "period", "acquisition_date",
    "confidence_note", "role", "amount", "ipa", "_legacy_source_url",
    "_legacy_note_source",
)


def _legacy_edge_key(rel: dict) -> str:
    return json.dumps(
        [rel[field] for field in LEGACY_EDGE_FIELDS],
        ensure_ascii=False,
        sort_keys=True,
        separators=(",", ":"),
    )


def _edge_id(rel: dict) -> str:
    """Stable composite key for a relation (hash of all edge fields).

    Distinct edges that legitimately share a ``source_record_id`` (e.g. one act
    granting two appointments) still get different ids, so it is safe to use as
    a React key / de-duplication token.
    """
    canonical = json.dumps(
        [rel[field] for field in LEGACY_EDGE_FIELDS],
        ensure_ascii=False,
        sort_keys=True,
        separators=(",", ":"),
    )
    return "ie_" + hashlib.sha256(canonical.encode("utf-8")).hexdigest()[:16]


def _act_extrema(note: object) -> str | None:
    if not isinstance(note, str) or not note:
        return None
    match = ACT_EXTREMA_RE.search(note)
    return match.group(1) if match else None


def _amount_cents(amount: float) -> int:
    return round(float(amount) * 100)


def _peer_amount_cents(
    relations: list[dict],
    exclude_ids: set[str],
    object_key: str,
    period: str,
    role: object,
) -> int | None:
    """Modal amount among peers (same entity, period, role), or None."""
    counts: dict[int, int] = {}
    for rel in relations:
        if rel["id"] in exclude_ids:
            continue
        if rel["object_key"] != object_key or (rel.get("period") or "") != period:
            continue
        if (rel.get("role") or None) != (role or None):
            continue
        amount = rel.get("amount")
        if not isinstance(amount, (int, float)) or amount <= 0:
            continue
        cents = _amount_cents(amount)
        counts[cents] = counts.get(cents, 0) + 1
    if not counts:
        return None
    return max(counts.items(), key=lambda item: (item[1], -item[0]))[0]


def mark_scale_twins(relations: list[dict]) -> int:
    """Mark suspect_duplicate on same-act amount-scale twins. Never deletes a row.

    Group: same subject, entity, act extrema in the note, and period.
    Scale: amounts in exact euro-cent ratio ×100 or ×1000 (issue #147).
    Keeper: peer-mode amount if it is one of the scale values, else the smaller.
    Only the inflated members are flagged; the source rows stay in the artifact.
    """
    groups: dict[tuple, list[dict]] = defaultdict(list)
    for rel in relations:
        act_id = rel.get("_act_extrema")
        if not act_id:
            continue
        amount = rel.get("amount")
        if not isinstance(amount, (int, float)) or amount <= 0:
            continue
        key = (rel["subject_key"], rel["object_key"], act_id, rel.get("period") or "")
        groups[key].append(rel)

    marked = 0
    for key, rows in groups.items():
        if len(rows) < 2:
            continue
        cents_list = [_amount_cents(row["amount"]) for row in rows]
        scale_cents: set[int] = set()
        for index, left in enumerate(cents_list):
            for right in cents_list[index + 1 :]:
                lo, hi = (left, right) if left <= right else (right, left)
                if hi in {lo * factor for factor in AMOUNT_SCALE_FACTORS}:
                    scale_cents.add(left)
                    scale_cents.add(right)
        if len(scale_cents) < 2:
            continue
        exclude_ids = {row["id"] for row in rows}
        peer = _peer_amount_cents(
            relations,
            exclude_ids,
            key[1],
            key[3],
            rows[0].get("role"),
        )
        keeper_cents = peer if peer in scale_cents else min(scale_cents)
        inflated = {keeper_cents * factor for factor in AMOUNT_SCALE_FACTORS}
        for rel, cents in zip(rows, cents_list):
            if cents in scale_cents and cents in inflated:
                rel["suspect_duplicate"] = True
                marked += 1
    return marked


def build_relations(rows: list[dict]) -> tuple[list[dict], int]:
    """Emit one edge per source row, dropping accidental full-duplicate rows.

    A single source act may legitimately produce several DISTINCT edges (e.g. the
    same source_record_id granted two different appointments). Those are kept.
    Only byte-identical edges are collapsed, and the count is reported for audit.
    """
    relations: list[dict] = []
    seen: set[tuple] = set()
    duplicates = 0
    for index, row in enumerate(rows, start=1):
        rel = {
            "relation_type": _non_empty(row.get("relation_type"), f"riga {index}.relation_type"),
            "subject_type": _non_empty(row.get("subject_type"), f"riga {index}.subject_type"),
            "subject_key": _non_empty(row.get("subject_key"), f"riga {index}.subject_key"),
            "object_type": _non_empty(row.get("object_type"), f"riga {index}.object_type"),
            "object_key": _non_empty(row.get("object_key"), f"riga {index}.object_key"),
            "source_dataset": _non_empty(row.get("source_dataset"), f"riga {index}.source_dataset"),
            "source_record_id": _non_empty(row.get("source_record_id"), f"riga {index}.source_record_id"),
            "period": (row.get("period") or "").strip(),
            "acquisition_date": _non_empty(row.get("acquisition_date"), f"riga {index}.acquisition_date"),
            "confidence_note": _non_empty(row.get("confidence_note"), f"riga {index}.confidence_note"),
            "role": (row.get("role") or "").strip() or None,
            "amount": _amount(row.get("importo_if_present"), f"riga {index}.importo_if_present"),
            "ipa": (row.get("ipa") or "").strip() or None,
            "source_url": _source_url(row.get("fonte_url")),
            "_legacy_source_url": row.get("_legacy_source_url") or (row.get("fonte_url") or "").strip() or None,
            "references": row.get("references") or _reference_codes(
                row.get("cig"), row.get("note_source")
            ),
            "_legacy_note_source": row.get("_legacy_note_source") or row.get("note_source"),
            "_act_extrema": row.get("_act_extrema") or _act_extrema(row.get("note_source")),
        }
        key = _legacy_edge_key(rel)
        if key in seen:
            duplicates += 1
            continue
        seen.add(key)
        rel["id"] = _edge_id(rel)
        relations.append(rel)
    return relations, duplicates


def normalize(rows: list[dict], generated_at: str) -> dict:
    relations, duplicates = build_relations(rows)
    if not relations:
        raise ContractError("nessun arco da emettere: il dataset di origine e' vuoto")
    suspects = mark_scale_twins(relations)
    public_relations = []
    for relation in relations:
        public = {field: relation[field] for field in EDGE_FIELDS}
        public["id"] = relation["id"]
        if relation.get("suspect_duplicate"):
            public["suspect_duplicate"] = True
        public_relations.append(public)
    return {
        "schemaVersion": 1,
        "transformVersion": TRANSFORM_VERSION,
        "scope": "investigative-explorer-incarichi",
        "generatedAt": generated_at,
        "relationCount": len(relations),
        "duplicatesRemoved": duplicates,
        "suspectDuplicates": suspects,
        "license": "AGPL-3.0-or-later",
        "source": {
            "owner": OWNER,
            "dataset": SOURCE_DATASET,
            "landingUrl": ROUTE_URL,
            "license": "AGPL-3.0-or-later",
            "reuseTerms": "Riuso con attribuzione e licenza identica",
            "observedAt": generated_at,
            "provenance": "Ogni arco riporta source_dataset, source_record_id, period, acquisition_date, riferimenti CIG/CUP strutturati, URL validato e caveat.",
        },
        "methodology": {
            "mergePolicy": MERGE_POLICY,
            "caveat": CAVEAT,
            "amountScaleTwins": AMOUNT_SCALE_TWINS,
            "redactions": "Usate solo le righe pubbliche; i campi oscurati non sono inclusi.",
        },
        "relations": public_relations,
    }


def validate_artifact(snapshot: object) -> dict:
    root = snapshot
    if not isinstance(root, dict):
        raise ContractError("artifact: oggetto atteso")
    if root.get("schemaVersion") != 1 or root.get("transformVersion") != TRANSFORM_VERSION:
        raise ContractError("artifact: versione non supportata")
    if root.get("scope") != "investigative-explorer-incarichi":
        raise ContractError("artifact.scope non valido")
    suspects = root.get("suspectDuplicates")
    if not isinstance(suspects, int) or suspects < 0:
        raise ContractError("artifact.suspectDuplicates: intero >= 0 atteso")
    relations = root.get("relations")
    if not isinstance(relations, list) or not relations:
        raise ContractError("artifact.relations: lista non vuota attesa")
    seen_ids: set[str] = set()
    seen_edge_ids: set[str] = set()
    seen_edges: set[str] = set()
    flagged = 0
    for index, rel in enumerate(relations, start=1):
        if not isinstance(rel, dict):
            raise ContractError(f"relazione {index}: oggetto atteso")
        allowed_fields = set(EDGE_FIELDS) | {"id", "suspect_duplicate"}
        unexpected_fields = sorted(set(rel) - allowed_fields)
        if unexpected_fields:
            raise ContractError(f"relazione {index}: campi pubblici non previsti {unexpected_fields}")
        for field in REQUIRED:
            if not (isinstance(rel.get(field), str) and rel[field].strip()):
                raise ContractError(f"relazione {index}: {field} mancante")
        rid = rel["source_record_id"]
        if not rid:
            raise ContractError(f"relazione {index}: source_record_id vuoto")
        seen_ids.add(rid)
        eid = rel.get("id")
        if not isinstance(eid, str) or not eid:
            raise ContractError(f"relazione {index}: id mancante")
        if eid in seen_edge_ids:
            raise ContractError(f"relazione {index}: id duplicato")
        seen_edge_ids.add(eid)
        if rel.get("amount") is not None and not isinstance(rel["amount"], (int, float)):
            raise ContractError(f"relazione {index}: amount non numerico")
        if "note_source" in rel or "_act_extrema" in rel:
            raise ContractError(f"relazione {index}: testo sorgente interno non pubblicabile")
        references = rel.get("references")
        if not isinstance(references, dict) or set(references) != {"cig", "cup"}:
            raise ContractError(f"relazione {index}: references non valido")
        for kind, pattern in (("cig", SAFE_CIG_RE), ("cup", SAFE_CUP_RE)):
            codes = references[kind]
            if not isinstance(codes, list) or codes != sorted(set(codes)):
                raise ContractError(f"relazione {index}: riferimenti {kind} non validi")
            if not all(isinstance(code, str) and pattern.fullmatch(code) for code in codes):
                raise ContractError(f"relazione {index}: riferimenti {kind} non validi")
            if kind == "cig" and "0000000000" in codes:
                raise ContractError(f"relazione {index}: CIG tutto-zero non pubblicabile")
        source_url = rel.get("source_url")
        if source_url is not None and _safe_source_url(source_url) != source_url:
            raise ContractError(f"relazione {index}: source_url non sicuro")
        flag = rel.get("suspect_duplicate")
        if flag is True:
            flagged += 1
        elif flag not in (None, False):
            raise ContractError(f"relazione {index}: suspect_duplicate non booleano")
        edge_key = _edge_key(rel)
        if edge_key in seen_edges:
            raise ContractError(f"relazione {index}: arco duplicato (merge non consentito)")
        seen_edges.add(edge_key)
    if flagged != suspects:
        raise ContractError("artifact.suspectDuplicates non riconciliato con gli archi")
    encoded = json.dumps(root, ensure_ascii=False, separators=(",", ":"), allow_nan=False).encode("utf-8")
    if len(encoded) > MAX_ARTIFACT_BYTES:
        raise ContractError(f"artifact oltre il limite di {MAX_ARTIFACT_BYTES} byte")
    return root


def write_if_changed(snapshot: dict, output: Path) -> bool:
    output.parent.mkdir(parents=True, exist_ok=True)
    # Canonical JSON (compact, LF, trailing newline) to match DVNS conventions
    # and keep the committed artifact byte-stable and hashable.
    payload = json.dumps(snapshot, ensure_ascii=False, separators=(",", ":"), allow_nan=False) + "\n"
    if len(payload.encode("utf-8")) > MAX_ARTIFACT_BYTES:
        raise ContractError(f"artifact oltre il limite di {MAX_ARTIFACT_BYTES} byte")
    output.write_text(payload, encoding="utf-8")
    return True


def build_meta(snapshot: dict, rows: list[dict], artifact: bytes, compressed: bytes) -> dict:
    """Lightweight, relation-free projection for SSR/metadata (no full parse).

    The server reads ONLY this file to render the count + caveat, so /esplora
    never parses the multi-MB edges array. Keeps top entities for a quick
    editorial overview without shipping every edge to the client.
    """
    person_counter: dict[str, int] = {}
    entity_counter: dict[str, int] = {}
    role_counter: dict[str, int] = {}
    for rel in snapshot["relations"]:
        if rel.get("suspect_duplicate"):
            continue
        person_counter[rel["subject_key"]] = person_counter.get(rel["subject_key"], 0) + 1
        entity_counter[rel["object_key"]] = entity_counter.get(rel["object_key"], 0) + 1
        if rel.get("role"):
            role_counter[rel["role"]] = role_counter.get(rel["role"], 0) + 1
    acquisition = rows[0]["acquisition_date"] if rows else ""
    return {
        "schemaVersion": snapshot["schemaVersion"],
        "transformVersion": snapshot["transformVersion"],
        "scope": snapshot["scope"],
        "generatedAt": snapshot["generatedAt"],
        "relationCount": snapshot["relationCount"],
        "duplicatesRemoved": snapshot["duplicatesRemoved"],
        "suspectDuplicates": snapshot.get("suspectDuplicates", 0),
        "acquisitionDate": acquisition,
        "license": snapshot.get("license", "AGPL-3.0-or-later"),
        "caveat": snapshot["methodology"]["caveat"],
        "mergePolicy": snapshot["methodology"]["mergePolicy"],
        "source": snapshot["source"],
        "topPersons": [
            {"key": k, "count": c}
            for k, c in sorted(person_counter.items(), key=lambda kv: kv[1], reverse=True)[:50]
        ],
        "topEntities": [
            {"key": k, "count": c}
            for k, c in sorted(entity_counter.items(), key=lambda kv: kv[1], reverse=True)[:50]
        ],
        "edgesByRole": role_counter,
        "artifactBytes": len(artifact),
        "artifactSha256": hashlib.sha256(artifact).hexdigest(),
        "gzipBytes": len(compressed),
        "gzipSha256": hashlib.sha256(compressed).hexdigest(),
    }


def write_meta(meta: dict, output: Path) -> None:
    output.parent.mkdir(parents=True, exist_ok=True)
    output.write_text(
        json.dumps(meta, ensure_ascii=False, separators=(",", ":")) + "\n",
        encoding="utf-8",
    )


def write_gzip(snapshot: dict, output: Path) -> None:
    """Compressed full artifact for bandwidth/cold-start (served with Content-Encoding)."""
    output.parent.mkdir(parents=True, exist_ok=True)
    payload = json.dumps(snapshot, ensure_ascii=False, separators=(",", ":"), allow_nan=False) + "\n"
    import io

    buffer = io.BytesIO()
    with gzip.GzipFile(filename="", mode="wb", fileobj=buffer, compresslevel=9, mtime=0) as handle:
        handle.write(payload.encode("utf-8"))
    compressed = bytearray(buffer.getvalue())
    if len(compressed) < 10:
        raise ContractError("gzip canonico incompleto")
    compressed[9] = 255
    if len(compressed) > MAX_ARTIFACT_BYTES:
        raise ContractError(f"gzip oltre il limite di {MAX_ARTIFACT_BYTES} byte")
    output.write_bytes(bytes(compressed))


def validate_companion_files(snapshot: dict, output: Path) -> None:
    """Validate JSON, metadata and canonical gzip as one committed unit."""
    meta_path = output.with_suffix(".meta.json")
    gzip_path = output.with_suffix(".json.gz")
    if not meta_path.is_file() or not gzip_path.is_file():
        raise ContractError("file companion meta/gzip mancanti")
    artifact = output.read_bytes()
    compressed = gzip_path.read_bytes()
    try:
        inflated = gzip.decompress(compressed)
    except (OSError, EOFError) as exc:
        raise ContractError("gzip companion non valido") from exc
    if inflated != artifact:
        raise ContractError("gzip non coerente con l'artifact JSON")
    try:
        meta = json.loads(meta_path.read_text(encoding="utf-8"))
    except (OSError, json.JSONDecodeError) as exc:
        raise ContractError("meta companion non valido") from exc
    expected = {
        "schemaVersion": snapshot["schemaVersion"],
        "transformVersion": snapshot["transformVersion"],
        "relationCount": snapshot["relationCount"],
        "suspectDuplicates": snapshot["suspectDuplicates"],
        "artifactBytes": len(artifact),
        "artifactSha256": hashlib.sha256(artifact).hexdigest(),
        "gzipBytes": len(compressed),
        "gzipSha256": hashlib.sha256(compressed).hexdigest(),
    }
    for field, value in expected.items():
        if meta.get(field) != value:
            raise ContractError(f"meta companion non riconciliato: {field}")
    if "relations" in meta:
        raise ContractError("meta companion non deve contenere relazioni")


def main() -> int:
    parser = argparse.ArgumentParser()
    parser.add_argument("--check", action="store_true", help="Valida l'artifact senza rigenerare")
    input_group = parser.add_mutually_exclusive_group()
    input_group.add_argument("--input", type=Path)
    input_group.add_argument("--input-dir", type=Path, default=None)
    parser.add_argument("--output", type=Path, default=OUTPUT)
    parser.add_argument(
        "--acquired",
        type=str,
        default=None,
        help="Data di acquisizione (YYYY-MM-DD) per righe integrate DVNS",
    )
    parser.add_argument("--generated-at", type=str, default=None)
    args = parser.parse_args()

    if args.check:
        if not args.output.is_file():
            raise ContractError(f"artifact non trovato: {args.output}")
        data = validate_artifact(json.loads(args.output.read_text(encoding="utf-8")))
        validate_companion_files(data, args.output)
        print(f"Investigative Explorer artifact valido: {args.output} ({data['relationCount']} archi)")
        return 0

    input_path = args.input_dir or args.input or (DEFAULT_INPUT_DIR if DEFAULT_INPUT_DIR.exists() else DEFAULT_INPUT)
    suffix = str(input_path).lower()
    if args.input_dir or suffix.endswith((".jsonl", ".jsonl.gz", ".json")) or input_path.is_dir():
        rows = load_dvns_rows(input_path, args.acquired)
    else:
        rows = load_rows(input_path)
    generated_at = args.generated_at or (f"{args.acquired}T00:00:00Z" if args.acquired else utc_now())
    snapshot = normalize(rows, generated_at)
    validate_artifact(snapshot)
    write_if_changed(snapshot, args.output)
    artifact_bytes = args.output.read_bytes()
    meta_path = args.output.with_suffix(".meta.json")
    gz_path = args.output.with_suffix(".json.gz")
    write_gzip(snapshot, gz_path)
    compressed_bytes = gz_path.read_bytes()
    if gzip.decompress(compressed_bytes) != artifact_bytes:
        raise ContractError("gzip non coerente con l'artifact JSON")
    meta = build_meta(snapshot, rows, artifact_bytes, compressed_bytes)
    write_meta(meta, meta_path)
    print(
        json.dumps(
            {
                "relationCount": snapshot["relationCount"],
                "output": str(args.output),
                "meta": str(meta_path),
                "gz": str(gz_path),
            },
            ensure_ascii=False,
        )
    )
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
