#!/usr/bin/env python3
"""Enrich the public ANAC operator awards index with CIG procedure fields.

Joins published award CIG codes to the official ANAC CIG annual monthly ZIP
snapshots (2007-2025). Adds only source fields: oggetto, CPV, contracting
authority name. Never invents values; unmatched CIG stay null.
"""

from __future__ import annotations

import argparse
import csv
import gzip
import hashlib
import importlib.util
import io
import json
import re
import sys
import zipfile
from collections import Counter
from datetime import datetime, timezone
from pathlib import Path
from typing import Iterator


ROOT = Path(__file__).resolve().parents[2]
DEFAULT_INDEX = ROOT / "src" / "data" / "generated" / "anac-operator-awards-index"
DEFAULT_CIG_CACHE = ROOT / ".cache" / "anac" / "cig"
DEFAULT_MANIFEST = DEFAULT_CIG_CACHE / "download-manifest.json"
DEFAULT_CIG_SPEC = ROOT / "scripts" / "etl" / "specs" / "anac-cig-2007-2025.source.json"
OPERATOR_SPEC = ROOT / "scripts" / "etl" / "specs" / "anac-operator-awards-index.source.json"
COVERAGE_PATH = ROOT / "scripts" / "etl" / "anac_entity_procurement_coverage.py"

SPEC = importlib.util.spec_from_file_location("anac_entity_procurement_coverage", COVERAGE_PATH)
if SPEC is None or SPEC.loader is None:  # pragma: no cover
    raise RuntimeError("Impossibile caricare anac_entity_procurement_coverage")
base = importlib.util.module_from_spec(SPEC)
sys.modules[SPEC.name] = base
SPEC.loader.exec_module(base)

CIG_RE = re.compile(r"^[A-Z0-9]{10}$")
SHA256_RE = re.compile(r"^[a-f0-9]{64}$")
REQUIRED_CIG_FIELDS = (
    "cig",
    "oggetto_gara",
    "oggetto_lotto",
    "cod_cpv",
    "descrizione_cpv",
    "denominazione_amministrazione_appaltante",
    "flag_prevalente",
    "anno_pubblicazione",
)
MAX_OGGETTO = 500
MAX_AUTHORITY = 300
MAX_CPV_LABEL = 200
MAX_CPV_CODE = 20


class ContractError(ValueError):
    """Raised when enrichment inputs or outputs violate the contract."""


def sha256_path(path: Path) -> str:
    digest = hashlib.sha256()
    with path.open("rb") as handle:
        for chunk in iter(lambda: handle.read(1024 * 1024), b""):
            digest.update(chunk)
    return digest.hexdigest()


def sha256_bytes(value: bytes) -> str:
    return hashlib.sha256(value).hexdigest()


def clean_text(value: object, limit: int) -> str | None:
    if value is None:
        return None
    text = str(value).strip()
    if not text:
        return None
    text = " ".join(text.split())
    # Drop supplementary-plane / private-use noise that inflates UTF-16 length in JS.
    text = "".join(ch for ch in text if ord(ch) < 0x10000 and not (0xE000 <= ord(ch) <= 0xF8FF))
    text = " ".join(text.split())
    if not text:
        return None
    if len(text) > limit:
        text = text[: limit - 1].rstrip() + "…"
    return text


def is_prevalent(flag: object) -> bool:
    raw = str(flag or "").strip().upper()
    return raw in {"1", "TRUE", "T", "SI", "S", "Y", "YES"}


def collect_target_cigs(index_dir: Path) -> set[str]:
    cigs: set[str] = set()
    for path in sorted((index_dir / "operators").glob("*.jsonl.gz")):
        with gzip.open(path, "rt", encoding="utf-8") as handle:
            for line in handle:
                record = json.loads(line)
                for award in record.get("awards") or []:
                    cig = str(award.get("cig") or "")
                    if CIG_RE.fullmatch(cig):
                        cigs.add(cig)
    if not cigs:
        raise ContractError("nessun CIG pubblicato da arricchire")
    return cigs


def iter_cig_zip_rows(path: Path) -> Iterator[dict[str, str]]:
    with zipfile.ZipFile(path) as archive:
        members = [info for info in archive.infolist() if info.filename.lower().endswith(".csv")]
        if len(members) != 1:
            raise ContractError(f"{path.name}: atteso un solo CSV nel ZIP")
        with archive.open(members[0]) as raw:
            text = io.TextIOWrapper(raw, encoding="utf-8-sig", newline="")
            reader = csv.DictReader(text, delimiter=";")
            if not reader.fieldnames:
                raise ContractError(f"{path.name}: header assente")
            missing = [field for field in REQUIRED_CIG_FIELDS if field not in reader.fieldnames]
            if missing:
                raise ContractError(f"{path.name}: header incompleto {missing}")
            for row in reader:
                yield {key: (row.get(key) or "") for key in REQUIRED_CIG_FIELDS}


def score_row(row: dict[str, str]) -> tuple[int, int, int, str, str]:
    oggetto = clean_text(row.get("oggetto_lotto") or row.get("oggetto_gara"), MAX_OGGETTO) or ""
    return (
        1 if is_prevalent(row.get("flag_prevalente")) else 0,
        1 if clean_text(row.get("oggetto_lotto"), MAX_OGGETTO) else 0,
        len(oggetto),
        oggetto,
        clean_text(row.get("cod_cpv"), MAX_CPV_CODE) or "",
    )


def project_procedure(row: dict[str, str], source_year: int) -> dict[str, object]:
    oggetto = clean_text(row.get("oggetto_lotto") or row.get("oggetto_gara"), MAX_OGGETTO)
    cpv_code = clean_text(row.get("cod_cpv"), MAX_CPV_CODE)
    cpv_label = clean_text(row.get("descrizione_cpv"), MAX_CPV_LABEL)
    authority = clean_text(row.get("denominazione_amministrazione_appaltante"), MAX_AUTHORITY)
    year_raw = str(row.get("anno_pubblicazione") or "").strip()
    cig_year: int | None
    if year_raw.isdigit() and len(year_raw) == 4:
        cig_year = int(year_raw)
    else:
        cig_year = source_year
    if oggetto is None and cpv_code is None and cpv_label is None and authority is None:
        return {
            "oggetto": None,
            "cpvCode": None,
            "cpvLabel": None,
            "contractingAuthority": None,
            "cigYear": cig_year,
            "matched": False,
        }
    return {
        "oggetto": oggetto,
        "cpvCode": cpv_code,
        "cpvLabel": cpv_label,
        "contractingAuthority": authority,
        "cigYear": cig_year,
        "matched": True,
    }


def build_procedure_map(
    cig_cache: Path,
    target: set[str],
) -> tuple[dict[str, dict[str, object]], list[dict[str, object]], Counter[str]]:
    zips = sorted(cig_cache.rglob("cig_csv_*.zip"))
    if not zips:
        raise ContractError(f"nessun ZIP CIG in {cig_cache}")
    best_raw: dict[str, tuple[tuple[int, int, int, str, str], dict[str, str], int]] = {}
    inputs: list[dict[str, object]] = []
    coverage: Counter[str] = Counter(files=0, rows=0, matchedRows=0, uniqueMatched=0)
    for path in zips:
        coverage["files"] += 1
        year = int(path.parent.name) if path.parent.name.isdigit() else 0
        digest = sha256_path(path)
        inputs.append(
            {
                "path": str(path.relative_to(ROOT)) if path.is_relative_to(ROOT) else str(path),
                "fileName": path.name,
                "year": year,
                "bytes": path.stat().st_size,
                "sha256": digest,
            }
        )
        for row in iter_cig_zip_rows(path):
            coverage["rows"] += 1
            cig = base.normalize_cig(row.get("cig", ""))
            if not CIG_RE.fullmatch(cig) or cig not in target:
                continue
            coverage["matchedRows"] += 1
            scored = score_row(row)
            previous = best_raw.get(cig)
            if previous is None or scored > previous[0]:
                best_raw[cig] = (scored, row, year)
        print(
            f"anac cig enrich: scanned {path.name} files={coverage['files']} matched_unique={len(best_raw)}",
            file=sys.stderr,
            flush=True,
        )
    procedures = {
        cig: project_procedure(row, year) for cig, (_score, row, year) in best_raw.items()
    }
    coverage["uniqueMatched"] = len(procedures)
    return procedures, inputs, coverage


def gzip_jsonl_lines(lines: list[str]) -> bytes:
    buffer = io.BytesIO()
    with gzip.GzipFile(fileobj=buffer, mode="wb", mtime=0) as handle:
        for line in lines:
            handle.write((line + "\n").encode("utf-8"))
    return buffer.getvalue()


def enrich_operator_record(
    record: dict[str, object],
    procedures: dict[str, dict[str, object]],
) -> tuple[dict[str, object], int]:
    awards = record.get("awards")
    if not isinstance(awards, list):
        raise ContractError(f"{record.get('ref')}: awards non validi")
    matched = 0
    enriched_awards: list[dict[str, object]] = []
    cpv_counter: Counter[str] = Counter()
    authority_counter: Counter[str] = Counter()
    for award in awards:
        if not isinstance(award, dict):
            raise ContractError("award non oggetto")
        cig = str(award.get("cig") or "")
        procedure = procedures.get(cig)
        if procedure and procedure.get("matched"):
            matched += 1
            award = {**award, "procedure": procedure}
            label = procedure.get("cpvLabel") or procedure.get("cpvCode")
            if isinstance(label, str) and label:
                cpv_counter[label] += 1
            authority = procedure.get("contractingAuthority")
            if isinstance(authority, str) and authority:
                authority_counter[authority] += 1
        else:
            award = {
                **award,
                "procedure": {
                    "oggetto": None,
                    "cpvCode": None,
                    "cpvLabel": None,
                    "contractingAuthority": None,
                    "cigYear": None,
                    "matched": False,
                },
            }
        enriched_awards.append(award)
    top_cpv = [
        {"label": label, "count": count}
        for label, count in sorted(cpv_counter.items(), key=lambda item: (-item[1], item[0]))[:5]
    ]
    top_authorities = [
        {"label": label, "count": count}
        for label, count in sorted(authority_counter.items(), key=lambda item: (-item[1], item[0]))[:5]
    ]
    out = {
        **record,
        "awards": enriched_awards,
        "procedureMatchedAwards": matched,
        "topCpv": top_cpv,
        "topContractingAuthorities": top_authorities,
    }
    return out, matched


def rewrite_index(
    index_dir: Path,
    procedures: dict[str, dict[str, object]],
    cig_inputs: list[dict[str, object]],
    coverage: Counter[str],
    observed_at: str,
) -> dict[str, object]:
    operators_dir = index_dir / "operators"
    shard_meta: list[dict[str, object]] = []
    totals = Counter(
        operators=0,
        awardsPublished=0,
        procedureMatchedAwards=0,
        procedureMatchedOperators=0,
    )
    for path in sorted(operators_dir.glob("*.jsonl.gz")):
        lines: list[str] = []
        with gzip.open(path, "rt", encoding="utf-8") as handle:
            for raw in handle:
                record = json.loads(raw)
                enriched, matched = enrich_operator_record(record, procedures)
                totals["operators"] += 1
                totals["awardsPublished"] += int(enriched.get("awardsPublished") or 0)
                totals["procedureMatchedAwards"] += matched
                if matched:
                    totals["procedureMatchedOperators"] += 1
                lines.append(json.dumps(enriched, ensure_ascii=False, separators=(",", ":"), sort_keys=True))
        payload = gzip_jsonl_lines(lines)
        path.write_bytes(payload)
        shard_id = path.name.replace(".jsonl.gz", "")
        shard_meta.append(
            {
                "id": shard_id,
                "path": f"src/data/generated/anac-operator-awards-index/operators/{path.name}",
                "bytes": len(payload),
                "sha256": sha256_bytes(payload),
                "operators": len(lines),
            }
        )
        print(f"anac cig enrich: wrote shard {shard_id} operators={len(lines)}", file=sys.stderr, flush=True)

    meta_path = index_dir / "meta.json"
    meta = json.loads(meta_path.read_text(encoding="utf-8"))
    meta["generatedAt"] = observed_at
    meta["shards"] = shard_meta
    meta["cigEnrichment"] = {
        "years": list(range(2007, 2026)),
        "sourceDatasetPages": [
            f"https://dati.anticorruzione.it/opendata/dataset/cig-{year}" for year in range(2007, 2026)
        ],
        "inputs": cig_inputs,
        "coverage": {
            "targetPublishedCigs": coverage.get("target", 0),
            "filesScanned": int(coverage["files"]),
            "cigRowsScanned": int(coverage["rows"]),
            "matchedRows": int(coverage["matchedRows"]),
            "uniqueMatchedCigs": int(coverage["uniqueMatched"]),
            "publishedAwards": int(totals["awardsPublished"]),
            "procedureMatchedAwards": int(totals["procedureMatchedAwards"]),
            "procedureMatchedOperators": int(totals["procedureMatchedOperators"]),
        },
        "fields": [
            "oggetto_lotto|oggetto_gara",
            "cod_cpv",
            "descrizione_cpv",
            "denominazione_amministrazione_appaltante",
            "anno_pubblicazione",
        ],
        "moneyNature": "none-added",
        "note": "Campi procedura CIG da snapshot annuali ANAC 2007-2025; nessun importo aggiuntivo.",
    }
    limitations = list(meta.get("limitations") or [])
    extra = [
        "i campi procedura CIG (oggetto/CPV/stazione) derivano dagli snapshot annuali CIG 2007-2025 e possono mancare se il CIG non compare in quei file",
        "per CIG multi-lotto si preferisce la riga con flag_prevalente, altrimenti oggetto_lotto piu informativo",
    ]
    for item in extra:
        if item not in limitations:
            limitations.append(item)
    meta["limitations"] = limitations
    # refresh shard hashes already set; keep search.jsonl.gz unchanged
    search_path = index_dir / "search.jsonl.gz"
    if search_path.exists():
        meta["search"]["bytes"] = search_path.stat().st_size
        meta["search"]["sha256"] = sha256_path(search_path)
    meta["sourceSpecSha256"] = sha256_path(OPERATOR_SPEC)
    meta_path.write_text(json.dumps(meta, ensure_ascii=False, indent=2) + "\n", encoding="utf-8")
    return meta


def write_cig_source_spec(manifest_path: Path, cig_cache: Path, output: Path, observed_at: str) -> None:
    manifest = json.loads(manifest_path.read_text(encoding="utf-8"))
    resources = []
    for item in manifest:
        path = cig_cache / str(item["year"]) / item["fileName"]
        if not path.exists():
            raise ContractError(f"manca {path}")
        with zipfile.ZipFile(path) as archive:
            infos = [info for info in archive.infolist() if info.filename.lower().endswith(".csv")]
            if len(infos) != 1:
                raise ContractError(f"{path.name}: CSV membro non univoco")
            member = infos[0]
            member_sha = hashlib.sha256()
            with archive.open(member) as handle:
                for chunk in iter(lambda: handle.read(1024 * 1024), b""):
                    member_sha.update(chunk)
        resources.append(
            {
                "year": item["year"],
                "fileName": item["fileName"],
                "datasetPageUrl": item["datasetPageUrl"],
                "resourceId": item.get("resourceId"),
                "resourceUrl": item["url"],
                "archiveBytes": path.stat().st_size,
                "archiveSha256": sha256_path(path),
                "member": {
                    "name": member.filename,
                    "bytes": member.file_size,
                    "crc32": f"{member.CRC:08x}",
                    "sha256": member_sha.hexdigest(),
                },
            }
        )
    spec = {
        "schemaVersion": 1,
        "dataset": "anac-cig-2007-2025",
        "license": "CC BY-SA 4.0",
        "observedAt": observed_at,
        "scope": {
            "years": list(range(2007, 2026)),
            "distributionKind": "annual-monthly-full-snapshots",
            "note": "ZIP mensili ufficiali CIG ANAC 2007-2025 usati solo per arricchire le procedure collegate agli operatori.",
        },
        "resources": resources,
    }
    output.write_text(json.dumps(spec, ensure_ascii=False, indent=2) + "\n", encoding="utf-8")


def _build_national_summaries(index_dir: Path, observed_at: str) -> None:
    summaries_path = ROOT / "scripts" / "etl" / "anac_operator_national_summaries.py"
    spec = importlib.util.spec_from_file_location("anac_operator_national_summaries", summaries_path)
    if spec is None or spec.loader is None:  # pragma: no cover
        raise ContractError("Impossibile caricare anac_operator_national_summaries")
    module = importlib.util.module_from_spec(spec)
    sys.modules[spec.name] = module
    spec.loader.exec_module(module)
    summaries = module.build_summaries(index_dir, observed_at)
    summaries_meta = module.write_summaries(index_dir, summaries)
    module.update_meta(index_dir, summaries_meta, observed_at)


def assert_enriched_index(index_dir: Path) -> None:
    meta = json.loads((index_dir / "meta.json").read_text(encoding="utf-8"))
    enrich = meta.get("cigEnrichment")
    if not isinstance(enrich, dict):
        raise ContractError("meta.cigEnrichment assente")
    coverage = enrich.get("coverage")
    if not isinstance(coverage, dict) or int(coverage.get("uniqueMatchedCigs") or 0) <= 0:
        raise ContractError("coverage CIG non valida")
    sample_path = index_dir / "operators" / "00.jsonl.gz"
    with gzip.open(sample_path, "rt", encoding="utf-8") as handle:
        line = handle.readline()
    record = json.loads(line)
    awards = record.get("awards")
    if not isinstance(awards, list) or not awards:
        raise ContractError("sample senza awards")
    procedure = awards[0].get("procedure")
    if not isinstance(procedure, dict) or "matched" not in procedure:
        raise ContractError("procedure enrich assente sul sample")
    for shard in meta["shards"]:
        path = ROOT / shard["path"]
        if sha256_path(path) != shard["sha256"]:
            raise ContractError(f"hash drift {shard['path']}")
    summaries_path = ROOT / "scripts" / "etl" / "anac_operator_national_summaries.py"
    spec = importlib.util.spec_from_file_location("anac_operator_national_summaries_check", summaries_path)
    if spec is None or spec.loader is None:  # pragma: no cover
        raise ContractError("Impossibile caricare anac_operator_national_summaries")
    module = importlib.util.module_from_spec(spec)
    sys.modules[spec.name] = module
    spec.loader.exec_module(module)
    module.assert_summaries(index_dir)


def main() -> int:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--index", type=Path, default=DEFAULT_INDEX)
    parser.add_argument("--cig-cache", type=Path, default=DEFAULT_CIG_CACHE)
    parser.add_argument("--manifest", type=Path, default=DEFAULT_MANIFEST)
    parser.add_argument("--cig-spec-out", type=Path, default=DEFAULT_CIG_SPEC)
    parser.add_argument("--observed-at", default=datetime.now(timezone.utc).strftime("%Y-%m-%dT%H:%M:%SZ"))
    parser.add_argument("--check", action="store_true")
    parser.add_argument("--write-cig-spec", action="store_true")
    args = parser.parse_args()

    if args.check:
        assert_enriched_index(args.index)
        print("anac operator cig enrich: check ok", file=sys.stderr)
        return 0

    if args.write_cig_spec:
        write_cig_source_spec(args.manifest, args.cig_cache, args.cig_spec_out, args.observed_at)
        print(f"wrote {args.cig_spec_out}", file=sys.stderr)
        return 0

    target = collect_target_cigs(args.index)
    print(f"anac cig enrich: target cigs={len(target)}", file=sys.stderr, flush=True)
    procedures, inputs, coverage = build_procedure_map(args.cig_cache, target)
    coverage["target"] = len(target)
    meta = rewrite_index(args.index, procedures, inputs, coverage, args.observed_at)
    _build_national_summaries(args.index, args.observed_at)
    write_cig_source_spec(args.manifest, args.cig_cache, args.cig_spec_out, args.observed_at)
    matched = meta["cigEnrichment"]["coverage"]["uniqueMatchedCigs"]
    print(
        f"anac cig enrich: done matched_cigs={matched}/{len(target)}",
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
