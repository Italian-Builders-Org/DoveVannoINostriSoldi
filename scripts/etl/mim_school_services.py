#!/usr/bin/env python3
"""Count official MIM school-site flags by an exactly reconciled municipality."""

from __future__ import annotations

import argparse
import csv
import gzip
import io
import json
import re
import tempfile
from collections import Counter
from pathlib import Path

import integrated_curated_datasets as corpus

ROOT = Path(__file__).resolve().parents[2]
SPEC = ROOT / "scripts/etl/specs/mim-school-services.source.json"


class SourceError(ValueError):
    """A source or its municipal projection diverges from the locked release."""


def verified_bytes(path: Path, expected: dict) -> bytes:
    payload = path.read_bytes()
    if len(payload) != expected["bytes"] or corpus.sha256_bytes(payload) != expected["sha256"]:
        raise SourceError("byte sorgente divergenti")
    return payload


def csv_rows(payload: bytes, headers: list[str], delimiter: str = ",") -> list[dict[str, str]]:
    reader = csv.reader(io.StringIO(payload.decode("utf-8-sig"), newline=""), delimiter=delimiter, strict=True)
    if next(reader, None) != headers:
        raise SourceError("intestazioni divergenti")
    rows = []
    for row in reader:
        if len(row) != len(headers):
            raise SourceError("numero di celle divergente")
        rows.append(dict(zip(headers, row, strict=True)))
    return rows


def selected_cells(original: bytes, spec: dict) -> bytes:
    """Keep every source record, but omit school names, addresses and contacts."""
    rows = csv_rows(original, spec["source"]["headers"])
    output = io.StringIO(newline="")
    writer = csv.writer(output, lineterminator="\n")
    writer.writerow(spec["fixture"]["headers"])
    writer.writerows([row[field] for field in spec["fixture"]["headers"]] for row in rows)
    return output.getvalue().encode("utf-8")


def read_registry(spec: dict, original_path: Path | None = None) -> list[dict[str, str]]:
    if original_path is not None:
        payload = selected_cells(verified_bytes(original_path, spec["source"]), spec)
    else:
        payload = gzip.decompress(verified_bytes(ROOT / spec["fixture"]["path"], spec["fixture"]))
    selected = spec["fixture"]["selectedCells"]
    if len(payload) != selected["bytes"] or corpus.sha256_bytes(payload) != selected["sha256"]:
        raise SourceError("celle selezionate divergenti dalla fonte MIM")
    rows = csv_rows(payload, spec["fixture"]["headers"])
    validate_registry(rows, spec)
    return rows


def validate_registry(rows: list[dict[str, str]], spec: dict) -> None:
    school_codes = set()
    regions = Counter()
    flags = Counter()
    for row in rows:
        if any(not isinstance(value, str) or not value.strip() for value in row.values()):
            raise SourceError("identità o indicatore di sede mancante")
        if row["ANNOSCOLASTICO"] != spec["schoolYear"]:
            raise SourceError("anno scolastico divergente")
        code = row["CODICESCUOLA"]
        if re.fullmatch(r"[A-Z0-9]{10}", code) is None or code in school_codes:
            raise SourceError("codice scuola invalido o duplicato")
        school_codes.add(code)
        if re.fullmatch(r"[A-Z][0-9]{3}", row["CODICECOMUNESCUOLA"]) is None:
            raise SourceError("codice catastale invalido")
        if row["REGIONE"] not in spec["regionCodes"] or row["SEDESCOLASTICA"] not in {"SI", "NO"}:
            raise SourceError("regione o indicatore di sede inatteso")
        regions[row["REGIONE"]] += 1
        flags[row["SEDESCOLASTICA"]] += 1
    expected = spec["expected"]
    if len(rows) != expected["sourceRecords"] or dict(regions) != expected["recordsByRegion"] or dict(flags) != expected["siteFlags"]:
        raise SourceError("copertura dell'anagrafe divergente")


def municipal_identities(spec: dict) -> dict[str, list[str]]:
    join = spec["municipalJoin"]
    data = json.loads(verified_bytes(ROOT / join["path"], join))
    if data.get("datasetId") != "mef_irpef_comunale" or data.get("taxYear") != join["taxYear"]:
        raise SourceError("anagrafe di raccordo divergente")
    identities = {}
    istat_codes = set()
    for record in data["municipalities"]:
        istat, cadastral, _name, _province, _abbreviation, region = record[:6]
        if (
            re.fullmatch(r"[0-9]{6}", istat) is None
            or re.fullmatch(r"[A-Z][0-9]{3}", cadastral) is None
            or istat in istat_codes or cadastral in identities
            or region not in {f"{value:02}" for value in range(1, 21)}
        ):
            raise SourceError("identità comunale non univoca")
        identities[cadastral] = record[:6]
        istat_codes.add(istat)
    if len(identities) != join["municipalities"]:
        raise SourceError("copertura dell'anagrafe di raccordo divergente")
    return identities


def projection(rows: list[dict[str, str]], identities: dict[str, list[str]], spec: dict) -> bytes:
    municipalities = {}
    for row in rows:
        cadastral = row["CODICECOMUNESCUOLA"]
        identity = identities.get(cadastral)
        if identity is None or identity[5] != spec["regionCodes"][row["REGIONE"]]:
            raise SourceError("raccordo catastale/ISTAT o regione non riconciliati")
        geography = [identity[0], cadastral, row["DESCRIZIONECOMUNE"], row["PROVINCIA"], row["REGIONE"]]
        current = municipalities.setdefault(cadastral, {"geography": geography, "counts": Counter()})
        if current["geography"] != geography:
            raise SourceError("geografia MIM contraddittoria per lo stesso Comune")
        current["counts"][row["SEDESCOLASTICA"]] += 1
    expected = spec["expected"]
    if len(municipalities) != expected["municipalities"] or sum(item["counts"]["SI"] > 0 for item in municipalities.values()) != expected["municipalitiesWithSites"]:
        raise SourceError("copertura della vista comunale divergente")
    output = io.StringIO(newline="")
    writer = csv.writer(output, delimiter="|", lineterminator="\n")
    writer.writerow(spec["publicHeaders"])
    for item in sorted(municipalities.values(), key=lambda item: item["geography"][0]):
        writer.writerow([spec["schoolYearLabel"], *item["geography"], item["counts"]["SI"], item["counts"]["NO"]])
    return output.getvalue().encode("utf-8")


def check_committed(spec: dict, payload: bytes) -> None:
    corpus_spec, datasets = corpus.load_spec(corpus.DEFAULT_SPEC)
    item = next((item for item in datasets if item["id"] == spec["datasetId"]), None)
    if item is None:
        raise SourceError("dataset assente dal corpus")
    with tempfile.TemporaryDirectory() as directory:
        source_root = Path(directory)
        (source_root / item["relativePath"]).write_bytes(payload)
        parsed = corpus.parse_dataset(source_root, item)
        _, expected_rows, receipt, _ = corpus.build_dataset(
            item, parsed, corpus.resolved_source_metadata(corpus_spec, item["id"])
        )
    actual_rows = b"".join(gzip.decompress(path.read_bytes()) for path in sorted(
        (ROOT / "src/data/generated/integrated/rows").glob(f"{item['id']}.part-*.jsonl.gz")
    ))
    actual_receipt = json.loads((ROOT / f"data/source-ledger/datasets/{item['id']}.receipt.json").read_bytes())
    if expected_rows != actual_rows or receipt != actual_receipt:
        raise SourceError("righe pubbliche o ricevuta divergenti dai codici MIM")


def main() -> int:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--input", type=Path, help="Original hash-pinned MIM CSV; default: selected source cells")
    parser.add_argument("--output-dir", type=Path)
    parser.add_argument("--check", action="store_true")
    args = parser.parse_args()
    if not args.output_dir and not args.check:
        parser.error("specificare --output-dir o --check")
    spec = json.loads(SPEC.read_text())
    rows = read_registry(spec, args.input)
    payload = projection(rows, municipal_identities(spec), spec)
    if args.output_dir:
        args.output_dir.mkdir(parents=True, exist_ok=True)
        (args.output_dir / f"{spec['datasetId']}.psv").write_bytes(payload)
    if args.check:
        check_committed(spec, payload)
    print("PASS: codici MIM, raccordo comunale e conteggi delle sedi verificati")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
