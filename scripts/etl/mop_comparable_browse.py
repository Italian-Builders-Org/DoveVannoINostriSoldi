#!/usr/bin/env python3
"""Build the OpenBDAP MOP comparable-works browse snapshot.

Publishes only works where planned total and actual total are both > 0
(same rule as the UI delta). Geography is not in the official MOP columns,
so region filters are out of scope for this artifact.

Acquisition pages OpenBDAP OData ordered by planned works cost descending
and stops on a full page of zero planned works, or on --max-pages.
Rows that fail money/schema checks are counted as dropped, not invented.
"""

from __future__ import annotations

import argparse
import gzip
import hashlib
import json
import re
import ssl
import sys
import time
import urllib.error
import urllib.parse
import urllib.request
from collections import Counter
from datetime import datetime, timezone
from pathlib import Path
from typing import Any

try:
    import certifi
except ImportError:  # pragma: no cover
    certifi = None  # type: ignore[assignment]

ROOT = Path(__file__).resolve().parents[2]
DEFAULT_SPEC = ROOT / "scripts/etl/specs/mop-comparable-browse.source.json"
DEFAULT_DATA = ROOT / "src/data/generated/mop-comparable-browse.data.jsonl.gz"
DEFAULT_META = ROOT / "src/data/generated/mop-comparable-browse.meta.json"

DATASET_ID = "bda1676b-62ab-44b7-8f9a-ca93b8534488@rgs"
LANDING_URL = "https://bdap-opendata.rgs.mef.gov.it/content/progetti-opere-pubbliche-mop-totale"
ODATA_BASE = "https://bdap-opendata.rgs.mef.gov.it/ODataProxy"
OFFICIAL_PREFIX = "https://bdap-opendata.rgs.mef.gov.it/"

# physicalName -> (logicalName, dbType)
MOP_FIELDS: dict[str, tuple[str, str]] = {
    "ccodice_locale_progetto": ("Codice Locale Progetto", "STRING"),
    "ccodice_cup": ("Codice CUP", "STRING"),
    "cdescrizione_cup_integrale": ("Descrizione CUP Integrale", "STRING"),
    "ccodice_stato_cup": ("Codice Stato CUP", "STRING"),
    "cdescrizione_stato_cup": ("Descrizione Stato CUP", "STRING"),
    "cdescrizione_titolare": ("Descrizione Titolare", "STRING"),
    "cnatura_intervento": ("Natura Intervento", "STRING"),
    "ctipologia_intervento": ("Tipologia Intervento", "STRING"),
    "csettore_interv_inv": ("Settore Interv Inv", "STRING"),
    "csottosettore_interv_inv": ("Sottosettore Interv Inv", "STRING"),
    "ccategoria_interv_inv": ("Categoria Interv Inv", "STRING"),
    "ccosto_lavori_previsto": ("Costo Lavori Previsto", "NUMERIC"),
    "csomme_a_disposizione_previste": ("Somme a disposizione Previste", "NUMERIC"),
    "coneri_investimento_previsti": ("Oneri Investimento Previsti", "NUMERIC"),
    "ccosto_lavori_effettivo": ("Costo Lavori Effettivo", "NUMERIC"),
    "csomme_a_disposizione_effettiv": ("Somme a disposizione Effettive", "NUMERIC"),
    "coneri_investimento_effettivi": ("Oneri Investimento Effettivi", "NUMERIC"),
    "cinizio_esecuzione_prevista": ("Inizio Esecuzione Prevista", "DATE"),
    "cfine_esecuzione_prevista": ("Fine Esecuzione Prevista", "DATE"),
    "cinizio_esecuzione_effettiva": ("Inizio Esecuzione Effettiva", "DATE"),
    "cfine_esecuzione_effettiva": ("Fine Esecuzione Effettiva", "DATE"),
}

CUP_RE = re.compile(r"^[A-Z0-9]{15}$")
MONEY_RE = re.compile(r"^\d+(?:\.\d{1,2})?$")
DATE_RE = re.compile(r"^(19|20)\d{2}-\d{2}-\d{2}$")
CTRL_RE = re.compile(r"[\x00-\x08\x0b\x0c\x0e-\x1f\x7f-\x9f]")


def clean_text(value: str) -> str:
    return CTRL_RE.sub("'", value)


def utc_now() -> str:
    return datetime.now(timezone.utc).replace(microsecond=0).isoformat().replace("+00:00", "Z")


def sha256_bytes(data: bytes) -> str:
    return hashlib.sha256(data).hexdigest()


def sha256_file(path: Path) -> tuple[str, int]:
    digest = hashlib.sha256()
    size = 0
    with path.open("rb") as handle:
        while True:
            chunk = handle.read(1024 * 1024)
            if not chunk:
                break
            digest.update(chunk)
            size += len(chunk)
    return digest.hexdigest(), size


def tls_context() -> ssl.SSLContext:
    if certifi is None:
        return ssl.create_default_context()
    return ssl.create_default_context(cafile=certifi.where())


def http_json(url: str, timeout: float = 60.0) -> Any:
    if not url.startswith(OFFICIAL_PREFIX):
        raise SystemExit(f"URL non ufficiale: {url}")
    request = urllib.request.Request(url, headers={"Accept": "application/json"})
    with urllib.request.urlopen(request, timeout=timeout, context=tls_context()) as response:
        content_type = (response.headers.get("content-type") or "").lower()
        if "application/json" not in content_type:
            raise SystemExit(f"OpenBDAP non ha restituito JSON: {content_type}")
        raw = response.read().decode("utf-8", errors="replace")
        # OpenBDAP occasionally emits bare control characters inside string cells.
        sanitized = re.sub(r"[\x00-\x08\x0b\x0c\x0e-\x1f]", " ", raw)
        return json.loads(sanitized)


def discover_schema() -> tuple[dict[str, str], dict[str, Any]]:
    encoded = urllib.parse.quote(DATASET_ID, safe="")
    meta = http_json(f"{ODATA_BASE}/MdData('{encoded}')?%24format=json")
    columns = http_json(f"{ODATA_BASE}/MdData('{encoded}')/DataColumns?%24format=json")
    data = meta.get("d") or {}
    if data.get("id") != DATASET_ID:
        raise SystemExit("identificativo dataset inatteso")
    if data.get("inferredDataType") != "STATISTIC" or data.get("isReady") is not True:
        raise SystemExit("dataset non pronto")
    last_update = str(data.get("lastUpdate") or "")
    match = re.match(r"^(\d{2})/(\d{2})/(20\d{2}) \d{2}:\d{2}:\d{2}$", last_update)
    if not match:
        raise SystemExit(f"data aggiornamento inattesa: {last_update}")
    reference_date = f"{match.group(3)}-{match.group(2)}-{match.group(1)}"

    by_physical = {row["physicalName"]: row for row in columns["d"]["results"]}
    fields: dict[str, str] = {}
    for physical, (logical, db_type) in MOP_FIELDS.items():
        column = by_physical.get(physical)
        if not column:
            raise SystemExit(f"colonna mancante: {physical}")
        if column.get("logicalName") != logical or column.get("dbType") != db_type:
            raise SystemExit(f"definizione cambiata: {physical}")
        unique = str(column.get("colUniqueId") or "")
        if not re.match(r"^[A-Za-z][A-Za-z0-9_]*$", unique):
            raise SystemExit(f"alias non valido: {physical}")
        fields[physical] = unique
    metadata = {
        "datasetId": DATASET_ID,
        "sourceLastUpdate": last_update,
        "referenceDate": reference_date,
        "localProjectCardinality": int(by_physical["ccodice_locale_progetto"].get("cardinality") or 0),
        "cupCardinality": int(by_physical["ccodice_cup"].get("cardinality") or 0),
        "columnCount": len(columns["d"]["results"]),
    }
    return fields, metadata


def money_cents(value: Any, label: str) -> int:
    if not isinstance(value, str) or not MONEY_RE.match(value.strip()):
        raise ValueError(f"importo non valido in {label}")
    euros, _, decimals = value.strip().partition(".")
    cents = int(euros) * 100 + int((decimals + "00")[:2])
    if cents < 0:
        raise ValueError(f"importo negativo in {label}")
    return cents


def optional_text(value: Any) -> str | None:
    if value is None:
        return None
    text = clean_text(str(value)).strip()
    return text or None


def required_text(value: Any, label: str) -> str:
    text = optional_text(value)
    if not text:
        raise ValueError(f"{label} mancante")
    return text


def optional_date(value: Any) -> str | None:
    text = optional_text(value)
    if not text:
        return None
    if DATE_RE.match(text):
        return text
    return None


def derive_progress(status_code: str, status: str, actual_end: str | None) -> str:
    if actual_end or status_code == "C" or status.upper() == "CHIUSO":
        return "concluso"
    if status_code == "A" or status.upper() == "ATTIVO":
        return "in-corso"
    return "non-determinato"


def normalize_browse_row(row: dict[str, Any], fields: dict[str, str]) -> dict[str, Any]:
    get = lambda physical: row.get(fields[physical])
    cup = required_text(get("ccodice_cup"), "CUP").upper()
    if not CUP_RE.match(cup):
        raise ValueError("CUP non valido")
    planned = (
        money_cents(get("ccosto_lavori_previsto"), "previsto lavori")
        + money_cents(get("csomme_a_disposizione_previste"), "somme previste")
        + money_cents(get("coneri_investimento_previsti"), "oneri previsti")
    )
    actual = (
        money_cents(get("ccosto_lavori_effettivo"), "effettivo lavori")
        + money_cents(get("csomme_a_disposizione_effettiv"), "somme effettive")
        + money_cents(get("coneri_investimento_effettivi"), "oneri effettivi")
    )
    if planned <= 0 or actual <= 0:
        raise ValueError("non confrontabile")
    delta = actual - planned
    change_bp = round((delta / planned) * 10_000)
    status_code = required_text(get("ccodice_stato_cup"), "codice stato")
    status = required_text(get("cdescrizione_stato_cup"), "stato")
    planned_start = optional_date(get("cinizio_esecuzione_prevista"))
    planned_end = optional_date(get("cfine_esecuzione_prevista"))
    actual_start = optional_date(get("cinizio_esecuzione_effettiva"))
    actual_end = optional_date(get("cfine_esecuzione_effettiva"))
    return {
        "localCode": required_text(get("ccodice_locale_progetto"), "codice locale"),
        "cup": cup,
        "description": required_text(get("cdescrizione_cup_integrale"), "descrizione"),
        "statusCode": status_code,
        "status": status,
        "holderName": required_text(get("cdescrizione_titolare"), "titolare"),
        "nature": optional_text(get("cnatura_intervento")),
        "interventionType": optional_text(get("ctipologia_intervento")),
        "sector": optional_text(get("csettore_interv_inv")),
        "subsector": optional_text(get("csottosettore_interv_inv")),
        "category": optional_text(get("ccategoria_interv_inv")),
        "plannedTotalCents": planned,
        "actualTotalCents": actual,
        "deltaCents": delta,
        "deltaAbsCents": abs(delta),
        "changeBasisPoints": change_bp,
        "plannedExecutionStart": planned_start,
        "plannedExecutionEnd": planned_end,
        "actualExecutionStart": actual_start,
        "actualExecutionEnd": actual_end,
        "progress": derive_progress(status_code, status, actual_end),
    }


def fetch_page(fields: dict[str, str], skip: int, top: int) -> list[dict[str, Any]]:
    encoded = urllib.parse.quote(DATASET_ID, safe="")
    order_field = fields["ccosto_lavori_previsto"]
    select = ",".join(fields[physical] for physical in MOP_FIELDS)
    query = urllib.parse.urlencode(
        {
            "$orderby": f"{order_field} desc",
            "$skip": str(skip),
            "$top": str(top),
            "$format": "json",
            "$select": select,
        }
    )
    payload = http_json(f"{ODATA_BASE}/MdData('{encoded}')/DataRows?{query}")
    results = payload.get("d", {}).get("results")
    if not isinstance(results, list):
        raise SystemExit("elenco risultati non valido")
    return results


def write_gzip_jsonl(path: Path, rows: list[dict[str, Any]]) -> tuple[str, int]:
    path.parent.mkdir(parents=True, exist_ok=True)
    raw = b"".join((json.dumps(row, ensure_ascii=False, separators=(",", ":")) + "\n").encode("utf-8") for row in rows)
    compressed = gzip.compress(raw, mtime=0, compresslevel=9)
    path.write_bytes(compressed)
    return sha256_bytes(compressed), len(compressed)


def facet_counts(rows: list[dict[str, Any]], key: str, limit: int = 80) -> list[dict[str, Any]]:
    counter: Counter[str] = Counter()
    for row in rows:
        value = row.get(key)
        if isinstance(value, str) and value.strip():
            counter[value.strip()] += 1
    return [{"label": label, "count": count} for label, count in counter.most_common(limit)]


def build_meta(
    *,
    spec: dict[str, Any],
    metadata: dict[str, Any],
    rows: list[dict[str, Any]],
    data_path: Path,
    data_sha: str,
    data_bytes: int,
    scanned_rows: int,
    dropped_rows: int,
    comparable_skipped_zero: int,
    pages: int,
    observed_at: str,
    generated_at: str,
) -> dict[str, Any]:
    return {
        "schemaVersion": 1,
        "dataset": "mop-comparable-browse",
        "observedAt": observed_at,
        "generatedAt": generated_at,
        "referenceDate": metadata["referenceDate"],
        "source": {
            "owner": "Ragioneria Generale dello Stato",
            "dataset": "Progetti Opere Pubbliche MOP - Totale",
            "landingUrl": LANDING_URL,
            "datasetId": DATASET_ID,
            "license": "CC BY",
            "sourceLastUpdate": metadata["sourceLastUpdate"],
            "declaredCadence": "periodica",
        },
        "coverage": {
            "publishedWorks": len(rows),
            "scannedRows": scanned_rows,
            "droppedInvalidRows": dropped_rows,
            "nonComparableAmongScanned": comparable_skipped_zero,
            "pagesFetched": pages,
            "sourceCupCardinality": metadata["cupCardinality"],
            "sourceLocalProjectCardinality": metadata["localProjectCardinality"],
            "sourceColumnCount": metadata["columnCount"],
        },
        "scope": {
            "distributionKind": "comparable-subset-from-live-odata",
            "comparableRule": "plannedTotalCents>0 and actualTotalCents>0",
            "acquisitionOrder": "ccosto_lavori_previsto desc",
            "nationalPopulationClaim": "not-asserted",
            "geography": "absent-in-mop-columns",
            "note": (
                "Sottoinsieme delle opere MOP con costo previsto e costo effettivo "
                "entrambi valorizzati, acquisito in ordine di costo lavori previsto "
                "decrescente. Non e l'intero catalogo nazionale e non contiene regioni."
            ),
        },
        "facets": {
            "sectors": facet_counts(rows, "sector"),
            "categories": facet_counts(rows, "category"),
            "statuses": facet_counts(rows, "status", limit=30),
            "progress": facet_counts(rows, "progress", limit=10),
        },
        "integrity": {
            "algorithm": "sha256",
            "dataArtifact": {"path": str(data_path.relative_to(ROOT)), "bytes": data_bytes, "sha256": data_sha},
            "sourceSpecSha256": sha256_file(DEFAULT_SPEC)[0] if DEFAULT_SPEC.exists() else None,
        },
        "methodology": {
            "moneyFamily": "Solo costi MOP (lavori + somme + oneri). I finanziamenti restano fuori.",
            "delta": "changeBasisPoints solo con entrambi i totali > 0.",
            "screeningOnly": "Nessuna classifica di spreco o illegalita.",
            "regions": "Le colonne ufficiali MOP non espongono regione/provincia/comune.",
            "ongoingWorks": (
                "Uno scostamento previsto/effettivo su un'opera ancora in corso "
                "non prova un risparmio o un extra-costo finale."
            ),
        },
        "limitations": spec.get("limitations", []),
    }


def load_existing(meta_path: Path, data_path: Path) -> tuple[dict[str, Any], list[dict[str, Any]]]:
    meta = json.loads(meta_path.read_text(encoding="utf-8"))
    raw = gzip.decompress(data_path.read_bytes()).decode("utf-8")
    rows = [json.loads(line) for line in raw.splitlines() if line.strip()]
    return meta, rows


def check_artifacts(meta_path: Path, data_path: Path) -> None:
    meta, rows = load_existing(meta_path, data_path)
    if meta.get("dataset") != "mop-comparable-browse":
        raise SystemExit("dataset meta inatteso")
    if meta["coverage"]["publishedWorks"] != len(rows):
        raise SystemExit("conteggio opere non allineato")
    data_sha, data_bytes = sha256_file(data_path)
    if meta["integrity"]["dataArtifact"]["sha256"] != data_sha:
        raise SystemExit("hash data drift")
    if meta["integrity"]["dataArtifact"]["bytes"] != data_bytes:
        raise SystemExit("bytes data drift")
    seen: set[str] = set()
    for row in rows:
        if row["plannedTotalCents"] <= 0 or row["actualTotalCents"] <= 0:
            raise SystemExit("riga non confrontabile pubblicata")
        key = row["localCode"]
        if key in seen:
            raise SystemExit(f"duplicato {key}")
        seen.add(key)
        if row["deltaCents"] != row["actualTotalCents"] - row["plannedTotalCents"]:
            raise SystemExit("delta incoerente")
    print(f"ok mop-comparable-browse · {len(rows)} opere")


def persist(
    *,
    spec: dict[str, Any],
    metadata: dict[str, Any],
    by_local: dict[str, dict[str, Any]],
    data_path: Path,
    meta_path: Path,
    scanned: int,
    dropped: int,
    non_comparable: int,
    pages: int,
    observed_at: str,
) -> int:
    published = sorted(
        by_local.values(),
        key=lambda row: (-row["deltaAbsCents"], -row["plannedTotalCents"], row["cup"], row["localCode"]),
    )
    generated_at = utc_now()
    data_sha, data_bytes = write_gzip_jsonl(data_path, published)
    meta = build_meta(
        spec=spec,
        metadata=metadata,
        rows=published,
        data_path=data_path,
        data_sha=data_sha,
        data_bytes=data_bytes,
        scanned_rows=scanned,
        dropped_rows=dropped,
        comparable_skipped_zero=non_comparable,
        pages=pages,
        observed_at=observed_at,
        generated_at=generated_at,
    )
    meta_path.parent.mkdir(parents=True, exist_ok=True)
    meta_path.write_text(json.dumps(meta, ensure_ascii=False, indent=2) + "\n", encoding="utf-8")
    print(f"wrote {len(published)} works → {data_path.relative_to(ROOT)}", flush=True)
    return len(published)


def acquire(
    *,
    page_size: int,
    max_pages: int,
    sleep_s: float,
    data_path: Path,
    meta_path: Path,
    spec_path: Path,
) -> None:
    spec = json.loads(spec_path.read_text(encoding="utf-8"))
    observed_at = utc_now()
    fields, metadata = discover_schema()
    by_local: dict[str, dict[str, Any]] = {}
    scanned = 0
    dropped = 0
    non_comparable = 0
    pages = 0

    try:
        for page_index in range(max_pages):
            skip = page_index * page_size
            try:
                results = fetch_page(fields, skip=skip, top=page_size)
            except (urllib.error.HTTPError, urllib.error.URLError, TimeoutError, json.JSONDecodeError) as error:
                if pages > 0:
                    print(f"stop early after {pages} pages: {error}", file=sys.stderr)
                    break
                raise
            pages += 1
            if not results:
                break

            planned_field = fields["ccosto_lavori_previsto"]
            zero_planned_page = True
            for raw in results:
                scanned += 1
                planned_raw = str(raw.get(planned_field) or "").strip()
                if planned_raw not in {"", "0", "0.0", "0.00"}:
                    zero_planned_page = False
                try:
                    work = normalize_browse_row(raw, fields)
                except ValueError as error:
                    message = str(error)
                    if message == "non confrontabile":
                        non_comparable += 1
                    else:
                        dropped += 1
                    continue
                existing = by_local.get(work["localCode"])
                if existing is None or work["deltaAbsCents"] > existing["deltaAbsCents"]:
                    by_local[work["localCode"]] = work

            print(
                f"page {pages} skip={skip} scanned={scanned} published={len(by_local)} "
                f"dropped={dropped} nonComparable={non_comparable}",
                flush=True,
            )
            if pages % 50 == 0:
                persist(
                    spec=spec,
                    metadata=metadata,
                    by_local=by_local,
                    data_path=data_path,
                    meta_path=meta_path,
                    scanned=scanned,
                    dropped=dropped,
                    non_comparable=non_comparable,
                    pages=pages,
                    observed_at=observed_at,
                )
            if zero_planned_page:
                print("stop: pagina di soli previsti a zero", flush=True)
                break
            if len(results) < page_size:
                break
            if sleep_s > 0:
                time.sleep(sleep_s)
    finally:
        if by_local:
            persist(
                spec=spec,
                metadata=metadata,
                by_local=by_local,
                data_path=data_path,
                meta_path=meta_path,
                scanned=scanned,
                dropped=dropped,
                non_comparable=non_comparable,
                pages=pages,
                observed_at=observed_at,
            )


def main() -> None:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--check", action="store_true")
    parser.add_argument("--spec", type=Path, default=DEFAULT_SPEC)
    parser.add_argument("--data", type=Path, default=DEFAULT_DATA)
    parser.add_argument("--meta", type=Path, default=DEFAULT_META)
    parser.add_argument("--page-size", type=int, default=100)
    parser.add_argument("--max-pages", type=int, default=400)
    parser.add_argument("--sleep", type=float, default=1.1)
    args = parser.parse_args()

    if args.check:
        check_artifacts(args.meta, args.data)
        return
    if not args.spec.exists():
        raise SystemExit(f"manca lo source spec: {args.spec}")
    acquire(
        page_size=args.page_size,
        max_pages=args.max_pages,
        sleep_s=args.sleep,
        data_path=args.data,
        meta_path=args.meta,
        spec_path=args.spec,
    )
    check_artifacts(args.meta, args.data)


if __name__ == "__main__":
    main()
