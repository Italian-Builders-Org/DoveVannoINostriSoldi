#!/usr/bin/env python3
"""Derive the CPV index for the existing, validated ANAC entity profiles.

This index adds only the source classification to the typed procurement view.
It never recreates identities, award values, operators, or source populations.
"""
from __future__ import annotations

import argparse
import gzip
import hashlib
import json
import re
import shutil
import tempfile
from collections import Counter
from datetime import datetime
from pathlib import Path

import anac_entity_procurement_page as profiles

ROOT = Path(__file__).resolve().parents[2]
SPEC = ROOT / "scripts/etl/specs/anac-procurement-cpv.source.json"
OUTPUT = ROOT / "src/data/generated/anac-procurement-cpv"
MAX_SHARD_BYTES = 8 * 1024 * 1024
MAX_RAW_BYTES = 32 * 1024 * 1024
ROW_KEYS = ("cig", "rawCode", "description")
ContractError = profiles.ContractError


def cpv_code(raw: str) -> str | None:
    value = raw.strip()
    if re.fullmatch(r"[0-9]{8}(?:-[0-9])?", value) and value[:8] != "00000000":
        return value[:8]
    return None


def read_spec() -> tuple[dict, dict, dict]:
    spec = profiles.load_json(SPEC)
    if spec.get("schemaVersion") != 1 or spec.get("dataset") != "anac-procurement-cpv":
        raise ContractError("CPV: specifica inattesa")
    expected_paths = {
        "sourceLock": "scripts/etl/specs/anac-entity-procurement.source.json",
        "profiles": "src/data/generated/anac-entity-procurement-page/meta.json",
    }
    values = {}
    for name, path in expected_paths.items():
        entry = spec[name]
        if entry["path"] != path or profiles.sha256_path(ROOT / path) != entry["sha256"]:
            raise ContractError(f"CPV: {name} non riconciliato")
        values[name] = profiles.load_json(ROOT / path)
    return spec, values["sourceLock"], values["profiles"]


def profile_records(shard: dict):
    path = ROOT / shard["path"]
    if path.stat().st_size != shard["bytes"] or profiles.sha256_path(path) != shard["sha256"]:
        raise ContractError("CPV: shard del profilo non riconciliato")
    with gzip.open(path, "rt", encoding="utf-8") as stream:
        for line in stream:
            yield json.loads(line)


def classify_sources(input_dir: Path, source: dict) -> tuple[dict, dict]:
    """Read every locked archive and reject duplicate primary CIGs globally."""
    rows = {}
    counts = Counter(rawRows=0, primaryRows=0, nonPrimaryRows=0, classified=0, unclassified=0)
    entries = source["inputs"]["cig"]
    if [entry["month"] for entry in entries] != list(range(1, 13)):
        raise ContractError("CPV: attesi tutti i mesi 2025")
    for entry in entries:
        path = input_dir / entry["fileName"]
        locked = profiles.base.input_lock_from_spec(entry, profiles.base.CIG_HEADERS)
        profiles.base.verify_locked_input(path, locked)
        with profiles.base.csv_rows(path, profiles.base.CIG_HEADERS) as reader:
            for number, raw in enumerate(reader, 2):
                row = profiles.base.checked_row(raw, path=path, row_number=number)
                counts["rawRows"] += 1
                if row["flag_prevalente"].strip() != "1":
                    counts["nonPrimaryRows"] += 1
                    continue
                cig = profiles.base.normalize_cig(row["cig"])
                if not profiles.base.CIG_PATTERN.fullmatch(cig) or cig in rows:
                    raise ContractError("CPV: CIG prevalente non valido o duplicato")
                if row["anno_pubblicazione"].strip() not in {"", "2025"} or row["mese_pubblicazione"].strip() not in {"", str(entry["month"])}:
                    raise ContractError("CPV: periodo fuori contratto")
                observed = datetime.fromisoformat(source["catalogObservedAt"].replace("Z", "+00:00")).date()
                _, published = profiles.base.parse_date_status(row["data_pubblicazione"], observed)
                if published and not published.startswith(f"2025-{entry['month']:02d}-"):
                    raise ContractError("CPV: data pubblicazione fuori contratto")
                item = {"cig": cig, "rawCode": row["cod_cpv"], "description": row["descrizione_cpv"]}
                validate_row(item)
                rows[cig] = (item, published)
                counts["primaryRows"] += 1
                counts["classified" if cpv_code(item["rawCode"]) else "unclassified"] += 1
        print(f"CPV: verificato mese {entry['month']}", flush=True)
    return rows, dict(counts)


def validate_row(row: dict) -> None:
    profiles.exact_keys(row, ROW_KEYS, "CPV row")
    if not isinstance(row["cig"], str) or not profiles.base.CIG_PATTERN.fullmatch(row["cig"]):
        raise ContractError("CPV: CIG non valido")
    for key, maximum in (("rawCode", 100), ("description", 2000)):
        if not isinstance(row[key], str) or len(row[key]) > maximum:
            raise ContractError(f"CPV: {key} non valido")


def validate_record(record: dict, parent: dict) -> Counter:
    profiles.exact_keys(record, ("codiceIpa", "procedures"), "CPV record")
    if record["codiceIpa"] != parent["codiceIpa"] or not isinstance(record["procedures"], list):
        raise ContractError("CPV: identita ente divergente")
    expected = [p["cig"] for p in parent["procedures"]]
    if [p.get("cig") for p in record["procedures"]] != expected:
        raise ContractError("CPV: insieme CIG divergente dal profilo")
    counts = Counter(entities=1, procedures=len(expected), classified=0, unclassified=0)
    for row in record["procedures"]:
        validate_row(row)
        counts["classified" if cpv_code(row["rawCode"]) else "unclassified"] += 1
    return counts


def build(input_dir: Path, output: Path = OUTPUT) -> None:
    spec, source, parent_meta = read_spec()
    # Validate the pre-existing typed view before enriching its procedure keys.
    profiles.check_artifact(ROOT / spec["profiles"]["path"].rsplit("/", 1)[0])
    source_rows, source_counts = classify_sources(input_dir, source)
    output.parent.mkdir(parents=True, exist_ok=True)
    staging = Path(tempfile.mkdtemp(prefix=".anac-cpv-", dir=output.parent))
    backup = None
    published = False
    try:
        counts = Counter(entities=0, procedures=0, classified=0, unclassified=0)
        shards = []
        for parent_shard in parent_meta["shards"]:
            records = []
            for parent in profile_records(parent_shard):
                rows = []
                for procedure in parent["procedures"]:
                    match = source_rows.get(procedure["cig"])
                    if match is None or match[1] != procedure["publishedAt"]:
                        raise ContractError("CPV: join CIG/data non riconciliato")
                    rows.append(match[0])
                record = {"codiceIpa": parent["codiceIpa"], "procedures": rows}
                counts.update(validate_record(record, parent))
                records.append(record)
            raw = b"".join(profiles.canonical_line(record) for record in records)
            compressed = gzip.compress(raw, mtime=0)
            name = f"{parent_shard['id']}.jsonl.gz"
            (staging / name).write_bytes(compressed)
            shards.append({"id": parent_shard["id"], "bytes": len(compressed), "rawBytes": len(raw), "sha256": hashlib.sha256(compressed).hexdigest(), "entities": len(records)})
        meta = {"schemaVersion": 1, "dataset": spec["dataset"], "sourceSpecSha256": profiles.sha256_path(SPEC), "sourceCounts": source_counts, "counts": dict(counts), "shards": shards}
        (staging / "meta.json").write_text(json.dumps(meta, ensure_ascii=False, indent=2) + "\n", encoding="utf-8")
        check(staging)
        backup = profiles.atomic_publish(staging, output)
        published = True
        check(output)
        if backup:
            shutil.rmtree(backup)
        print(json.dumps(meta["counts"]), flush=True)
    except Exception:
        if published and output.exists():
            shutil.rmtree(output)
        if backup and backup.exists():
            backup.rename(output)
        raise
    finally:
        if staging.exists():
            shutil.rmtree(staging)


def check(output: Path = OUTPUT) -> None:
    spec, _, parent_meta = read_spec()
    meta = profiles.load_json(output / "meta.json")
    profiles.exact_keys(meta, ("schemaVersion", "dataset", "sourceSpecSha256", "sourceCounts", "counts", "shards"), "CPV meta")
    if meta["schemaVersion"] != 1 or meta["dataset"] != spec["dataset"] or meta["sourceSpecSha256"] != profiles.sha256_path(SPEC):
        raise ContractError("CPV: metadata non riconciliati")
    if len(meta["shards"]) != 256:
        raise ContractError("CPV: attesi 256 shard")
    expected_files = {"meta.json"} | {f"{i:02x}.jsonl.gz" for i in range(256)}
    if {p.name for p in output.iterdir()} != expected_files:
        raise ContractError("CPV: file inattesi o mancanti")
    counts = Counter(entities=0, procedures=0, classified=0, unclassified=0)
    for shard, parent_shard in zip(meta["shards"], parent_meta["shards"], strict=True):
        profiles.exact_keys(shard, ("id", "bytes", "rawBytes", "sha256", "entities"), "CPV shard")
        if shard["id"] != parent_shard["id"] or shard["entities"] != parent_shard["entities"]:
            raise ContractError("CPV: shard divergente dal profilo")
        if not 0 < shard["bytes"] <= MAX_SHARD_BYTES or not 0 < shard["rawBytes"] <= MAX_RAW_BYTES:
            raise ContractError("CPV: shard oltre budget")
        path = output / f"{shard['id']}.jsonl.gz"
        if path.is_symlink() or path.stat().st_size != shard["bytes"] or profiles.sha256_path(path) != shard["sha256"]:
            raise ContractError("CPV: hash/byte divergenti")
        with gzip.open(path, "rb") as stream:
            raw = stream.read(MAX_RAW_BYTES + 1)
        if len(raw) != shard["rawBytes"] or not raw.endswith(b"\n"):
            raise ContractError("CPV: righe o dimensione raw divergenti")
        rows = [json.loads(line) for line in raw.splitlines()]
        if len(rows) != shard["entities"]:
            raise ContractError("CPV: cardinalita shard divergente")
        for record, parent in zip(rows, profile_records(parent_shard), strict=True):
            counts.update(validate_record(record, parent))
    if dict(counts) != meta["counts"] or counts["entities"] != parent_meta["totals"]["entities"] or counts["procedures"] != parent_meta["totals"]["procedures"]:
        raise ContractError("CPV: totali non riconciliati")
    source = meta["sourceCounts"]
    profiles.exact_keys(source, ("rawRows", "primaryRows", "nonPrimaryRows", "classified", "unclassified"), "CPV source counts")
    if any(not isinstance(v, int) or isinstance(v, bool) or v < 0 for v in source.values()):
        raise ContractError("CPV: conteggi sorgente non validi")
    if source["rawRows"] != source["primaryRows"] + source["nonPrimaryRows"] or source["primaryRows"] != source["classified"] + source["unclassified"] or counts["procedures"] > source["primaryRows"]:
        raise ContractError("CPV: copertura sorgente incoerente")


def main() -> int:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--input-dir", type=Path)
    parser.add_argument("--output", type=Path, default=OUTPUT)
    parser.add_argument("--check", action="store_true")
    args = parser.parse_args()
    try:
        if args.check:
            check(args.output)
            print("ANAC CPV: PASS")
        elif args.input_dir:
            build(args.input_dir, args.output)
        else:
            parser.error("servono --input-dir o --check")
    except (ContractError, profiles.base.ContractError, OSError, ValueError) as exc:
        parser.exit(1, f"ANAC CPV: {exc}\n")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
