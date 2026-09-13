#!/usr/bin/env python3
"""Project the locked ISTAT non-observed-economy workbook into public corpus rows."""

from __future__ import annotations

import argparse
import csv
import gzip
import io
import json
import re
import tempfile
from decimal import Decimal, InvalidOperation, localcontext
from pathlib import Path
from zipfile import BadZipFile, ZipFile

import integrated_curated_datasets as corpus
from integrated_corpus_append import append_integrated_datasets

ROOT = Path(__file__).resolve().parents[2]
SPEC = ROOT / "scripts/etl/specs/istat-economia-non-osservata.source.json"
CORPUS_SPEC = ROOT / "scripts/etl/specs/integrated-curated-datasets.source.json"
CATALOG = ROOT / "src/data/generated/integrated/catalog.json"
ROWS_DIR = ROOT / "src/data/generated/integrated/rows"
RECEIPTS_DIR = ROOT / "data/source-ledger/datasets"
DATASET_PROOF = ROOT / "data/source-ledger/dataset-proof.json"
RELEASE_PROOF = ROOT / "data/source-ledger/release-proof.json"

SHEET_NS = "{http://schemas.openxmlformats.org/spreadsheetml/2006/main}"
OFFICE_REL_NS = "{http://schemas.openxmlformats.org/officeDocument/2006/relationships}"
PACKAGE_REL_NS = "{http://schemas.openxmlformats.org/package/2006/relationships}"
NUMBER = re.compile(r"-?(?:0|[1-9][0-9]*)(?:\.[0-9]+)?(?:[Ee][+-]?[0-9]+)?\Z")

COMPONENT_HEADERS = [
    "Anno",
    "Componente",
    "Valore",
    "Unità valore",
    "Incidenza percentuale",
    "Denominatore incidenza",
    "Tavola",
    "URL fonte",
]
BRANCH_HEADERS = [
    "Anno",
    "Branca",
    "Componente",
    "Incidenza percentuale",
    "Unità",
    "Denominatore",
    "Tavola",
    "URL fonte",
]


class SourceError(ValueError):
    """The acquired workbook or committed projection violates the reviewed contract."""


def validate_contract(spec: dict) -> None:
    source = spec.get("source")
    if not isinstance(source, dict):
        raise SourceError("contratto fonte mancante")
    if (
        source.get("holder") != "Istituto nazionale di statistica (ISTAT)"
        or source.get("url") != "https://www.istat.it/wp-content/uploads/2025/10/Tavole-Economia-non-osservata_2025.xlsx"
        or source.get("landingUrl") != "https://www.istat.it/comunicato-stampa/economia-non-osservata-nei-conti-nazionali-anni-2020-2023/"
        or source.get("licenseUrl") != "https://www.istat.it/note-legali/"
        or source.get("license") != "CC-BY-4.0"
        or source.get("publicationDate") != "2025-10-17"
        or source.get("referenceYears") != list(range(2011, 2024))
        or source.get("geography") != "Italia; nessun dettaglio territoriale"
        or source.get("updateFrequency") != "annuale"
    ):
        raise SourceError("identità, licenza, periodo o geografia della fonte divergenti")
    if source.get("acquiredAt") != "2026-09-12" or source.get("checkedAt") != "2026-09-12":
        raise SourceError("date di acquisizione o controllo divergenti")

    corpus_spec = json.loads(CORPUS_SPEC.read_text())
    overrides = corpus_spec.get("sourceMetadata", {}).get("overrides", {})
    expected_urls = [source["landingUrl"], source["licenseUrl"], source["url"]]
    for table in spec.get("tables", []):
        dataset_id = table.get("datasetId")
        expected_metadata = {
            "holder": source["holder"],
            "referencePeriod": (
                "Anni 2011-2023; valori nazionali correnti e incidenza sul PIL"
                if dataset_id == "istat-economia-non-osservata-componenti"
                else "Anni 2011-2023; incidenza nazionale per branca di attività economica"
            ),
            "publicationDate": source["publicationDate"],
            "acquisitionDate": source["acquiredAt"],
            "checkedAt": source["checkedAt"],
            "updateFrequency": "annuale; acquisizione e promozione manuali",
            "canonicalUrls": expected_urls,
        }
        if overrides.get(dataset_id) != expected_metadata:
            raise SourceError(f"metadati corpus divergenti dal source lock: {dataset_id}")


def verified_source(spec: dict, path: Path | None = None) -> bytes:
    source = spec["source"]
    source_path = path or ROOT / source["path"]
    payload = source_path.read_bytes()
    if len(payload) != source["bytes"] or corpus.sha256_bytes(payload) != source["sha256"]:
        raise SourceError("byte sorgente divergenti dal lock")
    return payload


def decimal_value(value: str | None, label: str) -> Decimal:
    if not isinstance(value, str) or NUMBER.fullmatch(value) is None:
        raise SourceError(f"numero sorgente non valido: {label}")
    try:
        parsed = Decimal(value)
    except InvalidOperation as error:
        raise SourceError(f"numero sorgente non valido: {label}") from error
    if not parsed.is_finite():
        raise SourceError(f"numero sorgente non finito: {label}")
    return parsed


def workbook_cells(payload: bytes, spec: dict) -> tuple[dict[str, dict[str, str | None]], list[str]]:
    workbook_spec = spec["workbook"]
    try:
        archive = ZipFile(io.BytesIO(payload))
    except BadZipFile as error:
        raise SourceError("sorgente non è un XLSX valido") from error
    with archive:
        try:
            workbook = corpus.safe_xml(archive.read(workbook_spec["member"]), "istat-noe", workbook_spec["member"])
            relationships = corpus.safe_xml(
                archive.read(workbook_spec["relationshipsMember"]),
                "istat-noe",
                workbook_spec["relationshipsMember"],
            )
            shared_tree = corpus.safe_xml(
                archive.read(workbook_spec["sharedStringsMember"]),
                "istat-noe",
                workbook_spec["sharedStringsMember"],
            )
        except KeyError as error:
            raise SourceError("membro obbligatorio XLSX mancante") from error

        shared = ["".join(node.text or "" for node in item.iter(SHEET_NS + "t")) for item in shared_tree]
        targets = {
            node.attrib["Id"]: node.attrib["Target"]
            for node in relationships.findall(PACKAGE_REL_NS + "Relationship")
            if node.attrib.get("Type", "").endswith("/worksheet")
        }
        sheet_nodes = workbook.find(SHEET_NS + "sheets")
        if sheet_nodes is None:
            raise SourceError("elenco fogli XLSX mancante")
        sheets = list(sheet_nodes)
        names = [node.attrib.get("name") for node in sheets]
        if names != workbook_spec["expectedSheetNames"]:
            raise SourceError("nomi o ordine dei fogli divergenti")

        expected_members = {table["sheetName"]: table["sheetMember"] for table in spec["tables"]}
        cells_by_sheet: dict[str, dict[str, str | None]] = {}
        for sheet in sheets:
            name = sheet.attrib["name"]
            if name not in expected_members:
                continue
            relationship_id = sheet.attrib.get(OFFICE_REL_NS + "id")
            target = targets.get(relationship_id or "")
            member = "xl/" + target if target else ""
            if member != expected_members[name]:
                raise SourceError(f"relazione del foglio divergente: {name}")
            try:
                tree = corpus.safe_xml(archive.read(member), "istat-noe", member)
            except KeyError as error:
                raise SourceError(f"foglio XLSX mancante: {name}") from error
            observed: dict[str, str | None] = {}
            for cell in tree.iter(SHEET_NS + "c"):
                reference = cell.attrib.get("r", "")
                if corpus.XLSX_CELL_RE.fullmatch(reference) is None or reference in observed:
                    raise SourceError(f"riferimento cella invalido o duplicato: {name}")
                if cell.find(SHEET_NS + "f") is not None or cell.attrib.get("t") not in {None, "n", "s"}:
                    raise SourceError(f"formula o tipo cella inatteso: {name}!{reference}")
                observed[reference] = corpus.xlsx_cell_value(cell, shared)
            cells_by_sheet[name] = observed
        return cells_by_sheet, shared


def cell(cells: dict[str, str | None], column: int, row: int) -> str | None:
    if column < 1:
        raise SourceError("indice colonna XLSX non valido")
    letters = ""
    current = column
    while current:
        current, remainder = divmod(current - 1, 26)
        letters = chr(65 + remainder) + letters
    return cells.get(f"{letters}{row}")


def component_projection(table: dict, cells: dict[str, str | None], source: dict) -> bytes:
    if cell(cells, 1, 2) != table["title"]:
        raise SourceError("titolo Tavola 1 divergente")
    components = [cell(cells, 1, row) for row in range(table["firstDataRow"], table["lastDataRow"] + 1)]
    if components != table["expectedComponents"]:
        raise SourceError("componenti Tavola 1 divergenti")

    rows: list[list[str | None]] = []
    by_year: dict[int, dict[str, tuple[Decimal, Decimal | None]]] = {}
    for year_index, year in enumerate(source["referenceYears"]):
        value_column = 2 + year_index * 2
        percentage_column = value_column + 1
        if cell(cells, value_column, table["yearRow"]) != str(year):
            raise SourceError("anni Tavola 1 divergenti")
        if (
            cell(cells, value_column, table["measureRow"]) != "Milioni di euro correnti"
            or cell(cells, percentage_column, table["measureRow"]) != "Incidenza  % sul PIL"
        ):
            raise SourceError("unità o denominatore Tavola 1 divergenti")
        values: dict[str, tuple[Decimal, Decimal | None]] = {}
        for source_row, component in zip(
            range(table["firstDataRow"], table["lastDataRow"] + 1),
            components,
            strict=True,
        ):
            assert isinstance(component, str)
            raw_value = cell(cells, value_column, source_row)
            value = decimal_value(raw_value, f"Tavola 1 {year} {component}")
            raw_percentage = cell(cells, percentage_column, source_row)
            percentage = None if raw_percentage is None else decimal_value(
                raw_percentage, f"Tavola 1 incidenza {year} {component}"
            )
            if component not in {"Valore aggiunto", "PIL"} and percentage is None:
                raise SourceError("incidenza Tavola 1 mancante")
            if component in {"Valore aggiunto", "PIL"} and percentage is not None:
                raise SourceError("incidenza inattesa per denominatore Tavola 1")
            values[component] = (value, percentage)
            rows.append([
                str(year), component.strip(), raw_value, "milioni di euro correnti",
                raw_percentage, "PIL" if raw_percentage is not None else None,
                "Tavola 1", source["url"],
            ])
        by_year[year] = values

    value_tolerance = Decimal(table["valueTolerance"])
    percentage_tolerance = Decimal(table["percentageTolerance"])
    with localcontext() as context:
        context.prec = 50
        for year, values in by_year.items():
            submerged = values["Economia sommersa "]
            parts = [values[name] for name in table["expectedComponents"][1:4]]
            illegal = values["Attività illegali "]
            total = values["Economia non osservata"]
            if abs(submerged[0] - sum((item[0] for item in parts), Decimal())) > value_tolerance:
                raise SourceError(f"componenti monetarie non riconciliate: {year}")
            if abs(total[0] - submerged[0] - illegal[0]) > value_tolerance:
                raise SourceError(f"totale monetario non riconciliato: {year}")
            if abs(submerged[1] - sum((item[1] for item in parts), Decimal())) > percentage_tolerance:
                raise SourceError(f"componenti percentuali non riconciliate: {year}")
            if abs(total[1] - submerged[1] - illegal[1]) > percentage_tolerance:
                raise SourceError(f"totale percentuale non riconciliato: {year}")
            pil = values["PIL"][0]
            for component in table["expectedComponents"][:6]:
                amount, percentage = values[component]
                assert percentage is not None
                if abs(amount / pil * Decimal(100) - percentage) > percentage_tolerance:
                    raise SourceError(f"denominatore PIL non riconciliato: {year} {component}")
    return delimited_payload(COMPONENT_HEADERS, rows)


def branch_projection(table: dict, cells: dict[str, str | None], source: dict) -> bytes:
    if cell(cells, 1, 2) != table["title"]:
        raise SourceError("titolo Tavola 3 divergente")
    branches = [cell(cells, 1, row) for row in range(table["firstDataRow"], table["lastDataRow"] + 1)]
    if branches != table["expectedBranches"]:
        raise SourceError("branche Tavola 3 divergenti")

    rows: list[list[str]] = []
    tolerance = Decimal(table["percentageTolerance"])
    with localcontext() as context:
        context.prec = 50
        for year_index, year in enumerate(source["referenceYears"]):
            first_column = 2 + year_index * 4
            if cell(cells, first_column, table["yearRow"]) != str(year):
                raise SourceError("anni Tavola 3 divergenti")
            measures = [cell(cells, first_column + offset, table["measureRow"]) for offset in range(4)]
            if measures != table["expectedComponents"]:
                raise SourceError("componenti Tavola 3 divergenti")
            for source_row, branch in zip(
                range(table["firstDataRow"], table["lastDataRow"] + 1),
                branches,
                strict=True,
            ):
                assert isinstance(branch, str)
                values = [
                    cell(cells, first_column + offset, source_row)
                    for offset in range(4)
                ]
                decimals = [
                    decimal_value(value, f"Tavola 3 {year} {branch} {component}")
                    for value, component in zip(values, measures, strict=True)
                ]
                if abs(decimals[3] - sum(decimals[:3], Decimal())) > tolerance:
                    raise SourceError(f"componenti di branca non riconciliate: {year} {branch}")
                for component, value in zip(measures, values, strict=True):
                    assert isinstance(component, str) and isinstance(value, str)
                    rows.append([
                        str(year), branch.strip(), component.strip(), value, "percentuale",
                        "valore aggiunto totale della stessa branca" if branch != "Totale " else "valore aggiunto totale nazionale",
                        "Tavola 3", source["url"],
                    ])
    return delimited_payload(BRANCH_HEADERS, rows)


def delimited_payload(headers: list[str], rows: list[list[str | None]]) -> bytes:
    output = io.StringIO(newline="")
    writer = csv.writer(output, delimiter="|", lineterminator="\n")
    writer.writerow(headers)
    writer.writerows(rows)
    return output.getvalue().encode("utf-8")


def projections(spec: dict, source_path: Path | None = None) -> dict[str, bytes]:
    validate_contract(spec)
    payload = verified_source(spec, source_path)
    cells_by_sheet, _shared = workbook_cells(payload, spec)
    component, branch = spec["tables"]
    return {
        component["datasetId"]: component_projection(component, cells_by_sheet[component["sheetName"]], spec["source"]),
        branch["datasetId"]: branch_projection(branch, cells_by_sheet[branch["sheetName"]], spec["source"]),
    }


def check_committed(payloads: dict[str, bytes]) -> None:
    corpus_spec, datasets = corpus.load_spec(CORPUS_SPEC)
    selected = {item["id"]: item for item in datasets if item["id"] in payloads}
    if set(selected) != set(payloads):
        raise SourceError("dataset ISTAT assente dalla specifica corpus")
    with tempfile.TemporaryDirectory() as directory:
        source_root = Path(directory)
        for dataset_id, payload in payloads.items():
            item = selected[dataset_id]
            (source_root / item["relativePath"]).write_bytes(payload)
            parsed = corpus.parse_dataset(source_root, item)
            entry, expected_rows, expected_receipt, _ = corpus.build_dataset(
                item, parsed, corpus.resolved_source_metadata(corpus_spec, dataset_id)
            )
            actual_rows = b"".join(
                gzip.decompress(path.read_bytes())
                for path in sorted(ROWS_DIR.glob(f"{dataset_id}.part-*.jsonl.gz"))
            )
            actual_receipt = json.loads((RECEIPTS_DIR / f"{dataset_id}.receipt.json").read_bytes())
            catalog = json.loads(CATALOG.read_bytes())
            actual_entry = next((value for value in catalog["datasets"] if value["id"] == dataset_id), None)
            if expected_rows != actual_rows or expected_receipt != actual_receipt or entry != actual_entry:
                raise SourceError(f"proiezione pubblica divergente dalla fonte ISTAT: {dataset_id}")


def publish(payloads: dict[str, bytes]) -> None:
    with tempfile.TemporaryDirectory() as directory:
        source_root = Path(directory)
        for dataset_id, payload in payloads.items():
            (source_root / f"{dataset_id}.psv").write_bytes(payload)
        append_integrated_datasets(
            spec_path=CORPUS_SPEC,
            source_root=source_root,
            dataset_ids=set(payloads),
            catalog_path=CATALOG,
            rows_dir=ROWS_DIR,
            receipts_dir=RECEIPTS_DIR,
            proof_path=DATASET_PROOF,
            release_proof_path=RELEASE_PROOF,
        )


def main() -> int:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--input", type=Path, help="workbook XLSX alternativo, soggetto allo stesso lock")
    parser.add_argument("--output-dir", type=Path)
    parser.add_argument("--publish", action="store_true")
    parser.add_argument("--check", action="store_true")
    args = parser.parse_args()
    if sum(bool(value) for value in (args.output_dir, args.publish, args.check)) != 1:
        parser.error("specificare una sola azione: --output-dir, --publish o --check")
    spec = json.loads(SPEC.read_text())
    payloads = projections(spec, args.input)
    if args.output_dir:
        args.output_dir.mkdir(parents=True, exist_ok=True)
        for dataset_id, payload in payloads.items():
            (args.output_dir / f"{dataset_id}.psv").write_bytes(payload)
    elif args.publish:
        publish(payloads)
    else:
        check_committed(payloads)
    print("PASS: ISTAT economia non osservata, Tavole 1 e 3, fonte e riconciliazioni verificate")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
