#!/usr/bin/env python3
"""Build the hash-pinned Consip program bandi/gare projection for the integrated corpus."""

from __future__ import annotations

import argparse
import csv
import gzip
import hashlib
import io
import json
import re
import tempfile
from collections import Counter
from decimal import Decimal, InvalidOperation
from pathlib import Path

import integrated_curated_datasets as corpus

ROOT = Path(__file__).resolve().parents[2]
SPEC = ROOT / "scripts/etl/specs/consip-bandi-programma-2026.source.json"

DATE = re.compile(r"^[0-9]{2}-[0-9]{2}-[0-9]{4}$")
AMOUNT = re.compile(r"^\d+(,\d{1,2})?$")
INSTRUMENTS = {"MePA", "SDA", "Convenzione", "Accordo Quadro"}


class SourceError(ValueError):
    """Consip bandi input diverges from the locked source spec."""


def verified_bytes(path: Path, expected: dict) -> bytes:
    payload = path.read_bytes()
    if len(payload) != expected["bytes"] or corpus.sha256_bytes(payload) != expected["sha256"]:
        raise SourceError("byte sorgente Consip divergenti")
    return payload


def parse_date(value: str) -> str:
    raw = value.strip()
    if not raw:
        return ""
    if DATE.fullmatch(raw) is None:
        raise SourceError("data Consip con formato inatteso")
    day, month, year = raw.split("-")
    return f"{year}-{month}-{day}"


def parse_amount_cents(value: str) -> str:
    raw = value.strip()
    if not raw:
        return ""
    if AMOUNT.fullmatch(raw) is None:
        raise SourceError("importo Consip non valido")
    normalized = raw.replace(",", ".")
    try:
        amount = Decimal(normalized)
    except InvalidOperation as error:
        raise SourceError("importo Consip non numerico") from error
    if amount < 0:
        raise SourceError("importo Consip negativo")
    return str(int((amount * 100).to_integral_value()))


def read_rows(spec: dict) -> list[dict[str, str]]:
    payload = verified_bytes(ROOT / spec["input"]["path"], spec["input"]).decode("utf-8")
    reader = csv.DictReader(payload.splitlines())
    if reader.fieldnames is None:
        raise SourceError("header CSV mancante")
    normalized_fields = [field.lstrip("#") for field in reader.fieldnames]
    rows: list[dict[str, str]] = []
    for raw in reader:
        row = {
            normalized_fields[index]: (raw[reader.fieldnames[index]] or "").strip()
            for index in range(len(normalized_fields))
        }
        rows.append(row)
    if len(rows) != spec["input"]["rows"]:
        raise SourceError("righe CSV Consip divergenti")
    return rows


def projection(rows: list[dict[str, str]], spec: dict) -> bytes:
    records = []
    instruments: Counter = Counter()
    open_rows = 0
    missing_deadline = 0
    for row in rows:
        instrument = row["Tipo_Strumento"]
        if instrument not in INSTRUMENTS:
            raise SourceError("tipo strumento inatteso")
        instruments[instrument] += 1
        lot_id = row["Identificativo_Lotto"].strip()
        publication = parse_date(row.get("Data_Pubblicazione", ""))
        if not publication:
            raise SourceError("data pubblicazione mancante")
        if not lot_id:
            digest = hashlib.sha256(f"{row['Denominazione_Bando']}|{row['Denominazione_Lotto']}|{publication}".encode()).hexdigest()
            lot_id = f"senza-id-{digest[:16]}"
        title = row["Denominazione_Bando"]
        lot = row["Denominazione_Lotto"]
        if not title or not lot:
            raise SourceError("denominazione mancante")
        deadline = parse_date(row.get("Data_Termine", ""))
        if not deadline:
            missing_deadline += 1
        elif deadline >= spec["openDeadlineCutoff"]:
            open_rows += 1
        category = row.get("Categoria_Merceologica", "").strip()
        if not category:
            raise SourceError("categoria merceologica mancante")
        base = parse_amount_cents(row.get("Base_Asta", ""))
        cap = parse_amount_cents(row.get("Importo_Massimale", ""))
        url = "https://dati.consip.it/dataset/dataset-bandi-e-gare"
        records.append([
            lot_id,
            title,
            lot,
            instrument,
            category,
            publication,
            deadline,
            base,
            cap,
            url,
        ])
    if dict(instruments) != spec["instruments"] or open_rows != spec["openRowsAtAcquisition"] or missing_deadline != spec["missingDeadlineRows"]:
        raise SourceError("copertura Consip divergente")
    output = io.StringIO(newline="")
    writer = csv.writer(output, delimiter="|", lineterminator="\n")
    writer.writerow(spec["publicHeaders"])
    writer.writerows(sorted(records, key=lambda item: (item[5], item[0]), reverse=True))
    return output.getvalue().encode("utf-8")


def check_committed(spec: dict, payload: bytes) -> None:
    corpus_spec, datasets = corpus.load_spec(corpus.DEFAULT_SPEC)
    item = next(item for item in datasets if item["id"] == spec["datasetId"])
    with tempfile.TemporaryDirectory() as directory:
        source_root = Path(directory)
        (source_root / item["relativePath"]).write_bytes(payload)
        parsed = corpus.parse_dataset(source_root, item)
        _, expected_rows, receipt, _ = corpus.build_dataset(item, parsed, corpus.resolved_source_metadata(corpus_spec, item["id"]))
    actual_rows = b"".join(
        gzip.decompress(path.read_bytes())
        for path in sorted((ROOT / "src/data/generated/integrated/rows").glob(f"{item['id']}.part-*.jsonl.gz"))
    )
    actual_receipt = json.loads((ROOT / f"data/source-ledger/datasets/{item['id']}.receipt.json").read_bytes())
    if expected_rows != actual_rows or receipt != actual_receipt:
        raise SourceError("righe pubbliche Consip divergenti dal corpus")


def main() -> int:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--output-dir", type=Path)
    parser.add_argument("--check", action="store_true")
    args = parser.parse_args()
    if not args.output_dir and not args.check:
        parser.error("specificare --output-dir o --check")
    spec = json.loads(SPEC.read_text(encoding="utf-8"))
    payload = projection(read_rows(spec), spec)
    if args.output_dir:
        args.output_dir.mkdir(parents=True, exist_ok=True)
        (args.output_dir / f"{spec['datasetId']}.psv").write_bytes(payload)
    if args.check:
        check_committed(spec, payload)
    print("PASS: bandi Consip programma verificati")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
