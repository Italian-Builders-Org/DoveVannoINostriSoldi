#!/usr/bin/env python3
"""Project three municipal ISTAT series into the existing public corpus, offline."""

from __future__ import annotations

import argparse
import csv
import gzip
import io
import json
import re
import tempfile
from collections import Counter
from decimal import Decimal, localcontext
from pathlib import Path
from zipfile import ZipFile

import integrated_curated_datasets as corpus

ROOT = Path(__file__).resolve().parents[2]
SPEC = ROOT / "scripts/etl/specs/istat-misura-comune.source.json"
NS = "{http://schemas.openxmlformats.org/spreadsheetml/2006/main}"
NUMBER = re.compile(r"(?:0|[1-9]\d*)(?:\.\d+)?(?:[Ee][+-]?\d+)?\Z")


class SourceError(ValueError):
    """The acquired release no longer satisfies its declared contract."""


def verified_bytes(path: Path, expected: dict) -> bytes:
    payload = path.read_bytes()
    if len(payload) != expected["bytes"] or corpus.sha256_bytes(payload) != expected["sha256"]:
        raise SourceError("byte sorgente divergenti")
    return payload


def read_members(path: Path, spec: dict, *, original: bool = False) -> dict[str, bytes]:
    payload = verified_bytes(path, spec["source"] if original else spec["fixture"])
    members = {}
    with ZipFile(io.BytesIO(payload)) as archive:
        if not original and sorted(archive.namelist()) != sorted(member["name"] for member in spec["fixture"]["members"]):
            raise SourceError("membri della fixture divergenti")
        for member in spec["fixture"]["members"]:
            value = archive.read(member["name"])
            if len(value) != member["bytes"] or corpus.sha256_bytes(value) != member["sha256"]:
                raise SourceError("membro XLSX divergente")
            members[member["name"]] = value
    return members


def parse_sheet(payload: bytes, shared: list[str], sheet: dict, headers: list[str]) -> list[list[str]]:
    tree = corpus.safe_xml(payload, sheet["id"], sheet["member"])
    data = tree.find(NS + "sheetData")
    if data is None:
        raise SourceError("foglio privo di righe")
    rows = {}
    extra_footer_cells = 0
    for row in data:
        index = int(row.attrib["r"])
        if index in rows:
            raise SourceError("riga XLSX duplicata")
        cells = {}
        for cell in row:
            ref = cell.attrib.get("r", "")
            match = re.fullmatch(r"([A-Z]+)([1-9]\d*)", ref)
            if match is None or int(match[2]) != index:
                raise SourceError("cella fuori riga")
            column = corpus.xlsx_column_number(ref)
            if column in cells:
                raise SourceError("cella XLSX duplicata")
            if cell.find(NS + "f") is not None or cell.get("t") not in {None, "n", "s", "inlineStr"}:
                raise SourceError("formula o tipo di cella inatteso")
            value = corpus.xlsx_cell_value(cell, shared)
            cells[column] = value
            if column > len(headers) and value is not None:
                # Excel repeats the same source footnote in formatted columns.
                if index != sheet["rows"] + 5 or value != sheet["footer"][0]:
                    raise SourceError("contenuto fuori tabella")
                extra_footer_cells += 1
        rows[index] = [cells.get(column) for column in range(1, len(headers) + 1)]
    expected_indices = [1, 2, *range(4, sheet["rows"] + len(sheet["footer"]) + 5)]
    if list(rows) != expected_indices:
        raise SourceError("copertura delle righe XLSX divergente")
    if (
        rows[1] != [sheet["title"], *([None] * (len(headers) - 1))]
        or rows[2] != ["INDICE", *([None] * (len(headers) - 1))]
    ):
        raise SourceError("titolo o indicatore divergente")
    if rows[4] != headers:
        raise SourceError("intestazioni o anni divergenti")
    for index, footer in enumerate(sheet["footer"], sheet["rows"] + 5):
        if rows[index] != [footer, *([None] * (len(headers) - 1))]:
            raise SourceError("nota metodologica divergente")
    if extra_footer_cells != sheet["repeatedFooterCells"]:
        raise SourceError("ripetizioni della nota divergenti")
    result = [rows[index] for index in range(5, sheet["rows"] + 5)]
    validate_rows(result, sheet, headers)
    return result


def validate_rows(rows: list[list[str]], sheet: dict, headers: list[str]) -> None:
    codes = set()
    missing = Counter({"..": 0, "N.C.": 0})
    for row in rows:
        if len(row) != len(headers) or any(not isinstance(value, str) or not value.strip() for value in row):
            raise SourceError("cella mancante o schema divergente")
        if re.fullmatch(r"\d{6}", row[6]) is None or row[6] in codes:
            raise SourceError("codice comunale invalido o duplicato")
        codes.add(row[6])
        if re.fullmatch(r"(?:0[1-9]|1[0-9]|20)", row[1]) is None or row[4] not in {"0", "1"}:
            raise SourceError("geografia divergente")
        for value in row[7:]:
            if value in missing:
                missing[value] += 1
            elif NUMBER.fullmatch(value) is None or not Decimal(value).is_finite():
                raise SourceError("indicatore non valido")
    if len(rows) != sheet["rows"] or dict(missing) != sheet["missing"]:
        raise SourceError("copertura o valori mancanti divergenti")


def reconcile(series: list[list[list[str]]]) -> None:
    """The three ratios share the same population and municipal geography."""
    if any([row[:7] for row in rows] != [row[:7] for row in series[0]] for rows in series[1:]):
        raise SourceError("anagrafiche comunali divergenti")
    with localcontext() as context:
        context.prec = 50
        for old, elderly, structural in zip(*series, strict=True):
            for age, dependency, total in zip(old[7:], elderly[7:], structural[7:], strict=True):
                if ".." in (age, dependency, total):
                    if (age, dependency, total) != ("..", "..", ".."):
                        raise SourceError("disponibilita temporale divergente")
                    continue
                dependency, total = Decimal(dependency), Decimal(total)
                if total < dependency:
                    raise SourceError("dipendenza strutturale inferiore agli anziani")
                if age == "N.C.":
                    if dependency != total:
                        raise SourceError("denominatore nullo incoerente")
                elif Decimal(age) != 0:
                    expected = dependency * (1 + Decimal(100) / Decimal(age))
                    if abs(total - expected) > Decimal("0.00000001"):
                        raise SourceError("riconciliazione degli indici divergente")


def projections(spec: dict, members: dict[str, bytes]) -> dict[str, bytes]:
    shared_tree = corpus.safe_xml(members["xl/sharedStrings.xml"], "istat-misura-comune", "sharedStrings")
    shared = ["".join(node.text or "" for node in item.iter(NS + "t")) for item in shared_tree]
    index = corpus.safe_xml(members["xl/worksheets/sheet1.xml"], "istat-misura-comune", "index")
    metadata = {cell.get("r"): corpus.xlsx_cell_value(cell, shared) for cell in index.iter(NS + "c")}
    if any(metadata.get(key) != value for key, value in spec["metadataCells"].items()):
        raise SourceError("metadati di periodo, geografia o valori mancanti divergenti")
    series = [parse_sheet(members[sheet["member"]], shared, sheet, spec["headers"]) for sheet in spec["sheets"]]
    reconcile(series)
    result = {}
    for sheet, rows in zip(spec["sheets"], series, strict=True):
        output = io.StringIO(newline="")
        writer = csv.writer(output, delimiter="|", lineterminator="\n")
        writer.writerow(spec["headers"])
        writer.writerows(rows)
        result[sheet["id"]] = output.getvalue().encode("utf-8")
    return result


def check_committed(spec: dict, payloads: dict[str, bytes]) -> None:
    corpus_spec, datasets = corpus.load_spec(corpus.DEFAULT_SPEC)
    with tempfile.TemporaryDirectory() as directory:
        source_root = Path(directory)
        for item in datasets:
            if item["id"] not in payloads:
                continue
            (source_root / item["relativePath"]).write_bytes(payloads[item["id"]])
            parsed = corpus.parse_dataset(source_root, item)
            _, expected_rows, receipt, _ = corpus.build_dataset(
                item, parsed, corpus.resolved_source_metadata(corpus_spec, item["id"])
            )
            actual_rows = b"".join(gzip.decompress(path.read_bytes()) for path in sorted(
                (ROOT / "src/data/generated/integrated/rows").glob(f"{item['id']}.part-*.jsonl.gz")
            ))
            actual_receipt = json.loads((ROOT / f"data/source-ledger/datasets/{item['id']}.receipt.json").read_bytes())
            if expected_rows != actual_rows or receipt != actual_receipt:
                raise SourceError("proiezione pubblica divergente dalle celle ISTAT")
        if set(payloads) != {item["id"] for item in datasets if item["id"] in payloads}:
            raise SourceError("dataset assente dal corpus")
    if spec["headers"][7:] != [str(year) for year in spec["source"]["referenceYears"]]:
        raise SourceError("anni della fonte divergenti")


def main() -> int:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--input", type=Path, help="Original hash-pinned XLSX; default: extracted source cells")
    parser.add_argument("--output-dir", type=Path, help="Write the three pipe-separated projections")
    parser.add_argument("--check", action="store_true")
    args = parser.parse_args()
    spec = json.loads(SPEC.read_text())
    members = read_members(args.input or ROOT / spec["fixture"]["path"], spec, original=args.input is not None)
    payloads = projections(spec, members)
    if args.output_dir:
        args.output_dir.mkdir(parents=True, exist_ok=True)
        for dataset_id, payload in payloads.items():
            (args.output_dir / f"{dataset_id}.psv").write_bytes(payload)
    if args.check:
        check_committed(spec, payloads)
    if not args.output_dir and not args.check:
        parser.error("specificare --output-dir o --check")
    print("PASS: tre serie comunali ISTAT, celle e riconciliazioni verificate")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
