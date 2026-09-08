#!/usr/bin/env python3
"""Build national summary rankings for the public ANAC operator awards index.

Counts procedure fields once per unique matched CIG among published awards.
Operator tops come from the search index (all operators). Fail-closed on drift.
"""

from __future__ import annotations

import argparse
import gzip
import hashlib
import json
import sys
from collections import Counter
from datetime import datetime, timezone
from decimal import Decimal, InvalidOperation
from pathlib import Path
from typing import Any


ROOT = Path(__file__).resolve().parents[2]
DEFAULT_INDEX = ROOT / "src" / "data" / "generated" / "anac-operator-awards-index"
OPERATOR_SPEC = ROOT / "scripts" / "etl" / "specs" / "anac-operator-awards-index.source.json"
TOP_LIMIT = 20
MAX_LABEL = 280
PLACEHOLDER_OGGETTO = {
    "NOME LOTTO",
    "SERVIZI",
    "FORNITURE",
    "LAVORI",
    "OGGETTO",
    "N.D.",
    "ND",
    "N/A",
}
PLACEHOLDER_CPV_CODES = {"99999999", "00000000"}


class ContractError(ValueError):
    """Raised when summary inputs or outputs violate the contract."""


def is_informative_oggetto(value: str) -> bool:
    text = " ".join(value.split())
    if len(text) < 16:
        return False
    upper = text.upper()
    if upper in PLACEHOLDER_OGGETTO:
        return False
    if "NON PUBBLICABILE" in upper:
        return False
    if "POTENZIALE PRESENZA" in upper:
        return False
    return True


def is_informative_cpv(code: str | None, label: str) -> bool:
    if code and code.strip() in PLACEHOLDER_CPV_CODES:
        return False
    upper = label.upper()
    if "NON DISPONIBILE" in upper or "NON DEFINIT" in upper:
        return False
    return True


def sha256_path(path: Path) -> str:
    digest = hashlib.sha256()
    with path.open("rb") as handle:
        for chunk in iter(lambda: handle.read(1024 * 1024), b""):
            digest.update(chunk)
    return digest.hexdigest()


def sha256_bytes(value: bytes) -> str:
    return hashlib.sha256(value).hexdigest()


def clip_label(value: str, limit: int = MAX_LABEL) -> str:
    text = " ".join(value.split())
    if len(text) <= limit:
        return text
    return text[: limit - 1].rstrip() + "…"


def load_search_hits(index_dir: Path) -> list[dict[str, Any]]:
    path = index_dir / "search.jsonl.gz"
    if not path.exists():
        raise ContractError("search.jsonl.gz assente")
    hits: list[dict[str, Any]] = []
    with gzip.open(path, "rt", encoding="utf-8") as handle:
        for line in handle:
            hits.append(json.loads(line))
    if not hits:
        raise ContractError("search index vuoto")
    return hits


def attributed_value_key(hit: dict[str, Any]) -> tuple[Decimal, int, str]:
    raw = str(hit.get("attributedValue") or "0")
    try:
        value = Decimal(raw)
    except InvalidOperation as exc:  # pragma: no cover
        raise ContractError(f"attributedValue non valido: {raw}") from exc
    return (-value, -int(hit.get("awardCount") or 0), str(hit.get("name") or ""))


def project_operator_hit(hit: dict[str, Any]) -> dict[str, Any]:
    return {
        "ref": hit["ref"],
        "name": hit["name"],
        "awardCount": int(hit["awardCount"]),
        "attributedAwardCount": int(hit["attributedAwardCount"]),
        "attributedValue": str(hit["attributedValue"]),
        "yearMin": hit.get("yearMin"),
        "yearMax": hit.get("yearMax"),
    }


def top_operators(hits: list[dict[str, Any]], limit: int) -> tuple[list[dict[str, Any]], list[dict[str, Any]]]:
    by_count = sorted(
        hits,
        key=lambda hit: (-int(hit.get("awardCount") or 0), attributed_value_key(hit)[0], str(hit.get("name") or "")),
    )[:limit]
    by_value = sorted(hits, key=attributed_value_key)[:limit]
    return [project_operator_hit(hit) for hit in by_count], [project_operator_hit(hit) for hit in by_value]


def collect_unique_matched_procedures(index_dir: Path) -> dict[str, dict[str, Any]]:
    """Map CIG → procedure fields, first matched published award wins."""
    procedures: dict[str, dict[str, Any]] = {}
    operators_dir = index_dir / "operators"
    for path in sorted(operators_dir.glob("*.jsonl.gz")):
        with gzip.open(path, "rt", encoding="utf-8") as handle:
            for line in handle:
                record = json.loads(line)
                for award in record.get("awards") or []:
                    cig = str(award.get("cig") or "")
                    if not cig or cig in procedures:
                        continue
                    procedure = award.get("procedure")
                    if not isinstance(procedure, dict) or procedure.get("matched") is not True:
                        continue
                    procedures[cig] = procedure
    return procedures


def top_named(counter: Counter[str], limit: int) -> list[dict[str, Any]]:
    return [
        {"label": clip_label(label), "count": count}
        for label, count in sorted(counter.items(), key=lambda item: (-item[1], item[0]))[:limit]
    ]


def top_cpv(procedures: dict[str, dict[str, Any]], limit: int) -> list[dict[str, Any]]:
    counter: Counter[tuple[str | None, str]] = Counter()
    for procedure in procedures.values():
        code = procedure.get("cpvCode")
        label = procedure.get("cpvLabel") or procedure.get("cpvCode")
        if not isinstance(label, str) or not label.strip():
            continue
        code_s = str(code).strip() if isinstance(code, str) and code.strip() else None
        clipped = clip_label(label)
        if not is_informative_cpv(code_s, clipped):
            continue
        counter[(code_s, clipped)] += 1
    rows: list[dict[str, Any]] = []
    for (code, label), count in sorted(counter.items(), key=lambda item: (-item[1], item[0][1], item[0][0] or ""))[
        :limit
    ]:
        rows.append({"label": label, "code": code, "count": count})
    return rows


def build_summaries(index_dir: Path, observed_at: str, limit: int = TOP_LIMIT) -> dict[str, Any]:
    hits = load_search_hits(index_dir)
    by_count, by_value = top_operators(hits, limit)
    procedures = collect_unique_matched_procedures(index_dir)
    cpv_counter_labels: Counter[str] = Counter()
    authority_counter: Counter[str] = Counter()
    oggetto_counter: Counter[str] = Counter()
    skipped_oggetto = 0
    skipped_cpv = 0
    for procedure in procedures.values():
        authority = procedure.get("contractingAuthority")
        if isinstance(authority, str) and authority.strip():
            authority_counter[authority.strip()] += 1
        oggetto = procedure.get("oggetto")
        if isinstance(oggetto, str) and oggetto.strip():
            if is_informative_oggetto(oggetto):
                oggetto_counter[oggetto.strip()] += 1
            else:
                skipped_oggetto += 1
        label = procedure.get("cpvLabel") or procedure.get("cpvCode")
        code = procedure.get("cpvCode")
        code_s = str(code).strip() if isinstance(code, str) and code.strip() else None
        if isinstance(label, str) and label.strip():
            if is_informative_cpv(code_s, label):
                cpv_counter_labels[label.strip()] += 1
            else:
                skipped_cpv += 1
    return {
        "schemaVersion": 1,
        "dataset": "anac-operator-awards-index",
        "generatedAt": observed_at,
        "basis": {
            "operators": "search-index-all-operators",
            "procedures": "unique-matched-cig-among-published-awards",
            "limit": limit,
            "moneyNature": "award-declared",
            "note": (
                "Le classifiche imprese usano tutto l'indice search. "
                "CPV, stazioni e oggetti contano una sola volta per ogni CIG "
                "abbinato tra le aggiudicazioni pubblicate (max 15 per operatore)."
            ),
        },
        "coverage": {
            "operators": len(hits),
            "uniqueMatchedCigsCounted": len(procedures),
            "distinctCpvLabels": len(cpv_counter_labels),
            "distinctContractingAuthorities": len(authority_counter),
            "distinctProcedureObjects": len(oggetto_counter),
            "skippedNonInformativeOggetto": skipped_oggetto,
            "skippedNonInformativeCpv": skipped_cpv,
        },
        "topOperatorsByAwardCount": by_count,
        "topOperatorsByAttributedValue": by_value,
        "topCpv": top_cpv(procedures, limit),
        "topContractingAuthorities": top_named(authority_counter, limit),
        "topProcedureObjects": top_named(oggetto_counter, limit),
    }


def write_summaries(index_dir: Path, summaries: dict[str, Any]) -> dict[str, Any]:
    payload = (json.dumps(summaries, ensure_ascii=False, indent=2, sort_keys=True) + "\n").encode("utf-8")
    path = index_dir / "summaries.json"
    path.write_bytes(payload)
    return {
        "path": "summaries.json",
        "bytes": len(payload),
        "sha256": sha256_bytes(payload),
        "limit": summaries["basis"]["limit"],
        "coverage": summaries["coverage"],
    }


def update_meta(index_dir: Path, summaries_meta: dict[str, Any], observed_at: str) -> None:
    meta_path = index_dir / "meta.json"
    meta = json.loads(meta_path.read_text(encoding="utf-8"))
    # Keep absolute-repo path in published meta when writing the real index.
    published = dict(summaries_meta)
    if index_dir.resolve() == DEFAULT_INDEX.resolve():
        published["path"] = "src/data/generated/anac-operator-awards-index/summaries.json"
    meta["summaries"] = published
    meta["generatedAt"] = observed_at
    limitations = list(meta.get("limitations") or [])
    extra = (
        "le tabelle riassuntive CPV/stazioni/oggetti contano CIG unici abbinati "
        "solo tra le aggiudicazioni pubblicate (non l'intero universo CIG ANAC)"
    )
    if extra not in limitations:
        limitations.append(extra)
    meta["limitations"] = limitations
    if OPERATOR_SPEC.exists():
        meta["sourceSpecSha256"] = sha256_path(OPERATOR_SPEC)
    meta_path.write_text(json.dumps(meta, ensure_ascii=False, indent=2) + "\n", encoding="utf-8")


def assert_summaries(index_dir: Path) -> None:
    meta = json.loads((index_dir / "meta.json").read_text(encoding="utf-8"))
    summaries_meta = meta.get("summaries")
    if not isinstance(summaries_meta, dict):
        raise ContractError("meta.summaries assente")
    path = index_dir / "summaries.json"
    if not path.exists():
        raise ContractError("summaries.json assente")
    if path.stat().st_size != int(summaries_meta["bytes"]):
        raise ContractError("summaries bytes non allineati")
    if sha256_path(path) != summaries_meta["sha256"]:
        raise ContractError("summaries sha256 non allineato")
    data = json.loads(path.read_text(encoding="utf-8"))
    if data.get("schemaVersion") != 1 or data.get("dataset") != "anac-operator-awards-index":
        raise ContractError("summaries schema inatteso")
    for key in (
        "topOperatorsByAwardCount",
        "topOperatorsByAttributedValue",
        "topCpv",
        "topContractingAuthorities",
        "topProcedureObjects",
    ):
        rows = data.get(key)
        if not isinstance(rows, list) or len(rows) == 0:
            raise ContractError(f"{key} vuoto")
        if len(rows) > int(data["basis"]["limit"]):
            raise ContractError(f"{key} oltre il limite")
    if int(data["coverage"]["operators"]) != int(meta["totals"]["operators"]):
        raise ContractError("coverage.operators non riconcilia totals.operators")


def main() -> int:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--index", type=Path, default=DEFAULT_INDEX)
    parser.add_argument("--limit", type=int, default=TOP_LIMIT)
    parser.add_argument(
        "--observed-at",
        default=datetime.now(timezone.utc).strftime("%Y-%m-%dT%H:%M:%SZ"),
    )
    parser.add_argument("--check", action="store_true")
    args = parser.parse_args()

    if args.check:
        assert_summaries(args.index)
        print("anac operator national summaries: check ok", file=sys.stderr)
        return 0

    if args.limit < 1 or args.limit > 50:
        raise ContractError("limit fuori range 1..50")
    summaries = build_summaries(args.index, args.observed_at, args.limit)
    summaries_meta = write_summaries(args.index, summaries)
    update_meta(args.index, summaries_meta, args.observed_at)
    print(
        "anac operator national summaries: "
        f"operators={summaries['coverage']['operators']} "
        f"matched_cigs={summaries['coverage']['uniqueMatchedCigsCounted']} "
        f"wrote={summaries_meta['path']}",
        file=sys.stderr,
        flush=True,
    )
    return 0


if __name__ == "__main__":
    try:
        raise SystemExit(main())
    except ContractError as exc:
        print(f"error: {exc}", file=sys.stderr)
        raise SystemExit(2) from exc
