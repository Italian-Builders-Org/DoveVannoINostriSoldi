#!/usr/bin/env python3
"""Project ISTAT Conti economici territoriali Tav.6 into public corpus rows."""

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
SPEC = ROOT / "scripts/etl/specs/istat-economia-non-osservata-territoriale.source.json"
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

HEADERS = [
    "Territorio",
    "Componente",
    "Incidenza percentuale",
    "Unità",
    "Denominatore",
    "Anno",
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
        or source.get("url") != "https://www.istat.it/wp-content/uploads/2025/12/Tavole-allegate-2025-1.xlsx"
        or source.get("landingUrl")
        != "https://www.istat.it/comunicato-stampa/conti-economici-territoriali-2022-2024/"
        or source.get("licenseUrl") != "https://www.istat.it/note-legali/"
        or source.get("license") != "CC-BY-4.0"
        or source.get("publicationDate") != "2025-12-22"
        or source.get("referenceYear") != 2023
        or source.get("geography")
        != "19 regioni, 2 province autonome, Italia e 5 ripartizioni pubblicate; nessun dettaglio provinciale o comunale"
        or source.get("updateFrequency") != "annuale"
    ):
        raise SourceError("identità, licenza, periodo o geografia della fonte divergenti")
    if source.get("acquiredAt") != "2026-09-13" or source.get("checkedAt") != "2026-09-13":
        raise SourceError("date di acquisizione o controllo divergenti")

    semantics = spec.get("semantics")
    if not isinstance(semantics, dict):
        raise SourceError("assi semantici soldi/periodo/provenance mancanti")
    soldi = semantics.get("soldi")
    if not isinstance(soldi, dict) or soldi.get("present") is not False:
        raise SourceError("asse soldi deve dichiarare present=false per le percentuali")
    periodo = semantics.get("periodo")
    provenance = semantics.get("provenance")
    if periodo != {
        "referencePeriod": "Anno 2023",
        "publicationDate": source["publicationDate"],
        "acquisitionDate": source["acquiredAt"],
        "checkedAt": source["checkedAt"],
    }:
        raise SourceError("asse periodo divergente")
    if provenance != {
        "holder": source["holder"],
        "canonicalUrls": [source["landingUrl"], source["licenseUrl"], source["url"]],
        "license": source["license"],
        "licenseUrl": source["licenseUrl"],
    }:
        raise SourceError("asse provenance divergente")

    corpus_spec = json.loads(CORPUS_SPEC.read_text(encoding="utf-8"))
    overrides = corpus_spec.get("sourceMetadata", {}).get("overrides", {})
    dataset_id = spec["tables"][0]["datasetId"]
    expected_metadata = {
        "holder": source["holder"],
        "referencePeriod": "Anno 2023; incidenza percentuale regionale e di ripartizione sul valore aggiunto totale",
        "publicationDate": source["publicationDate"],
        "acquisitionDate": source["acquiredAt"],
        "checkedAt": source["checkedAt"],
        "updateFrequency": "annuale; acquisizione e promozione manuali",
        "canonicalUrls": [source["landingUrl"], source["licenseUrl"], source["url"]],
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


def workbook_cells(payload: bytes, spec: dict) -> dict[str, dict[str, str | None]]:
    workbook_spec = spec["workbook"]
    try:
        archive = ZipFile(io.BytesIO(payload))
    except BadZipFile as error:
        raise SourceError("sorgente non è un XLSX valido") from error
    with archive:
        try:
            workbook = corpus.safe_xml(archive.read(workbook_spec["member"]), "istat-noe-terr", workbook_spec["member"])
            relationships = corpus.safe_xml(
                archive.read(workbook_spec["relationshipsMember"]),
                "istat-noe-terr",
                workbook_spec["relationshipsMember"],
            )
            shared_tree = corpus.safe_xml(
                archive.read(workbook_spec["sharedStringsMember"]),
                "istat-noe-terr",
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
                tree = corpus.safe_xml(archive.read(member), "istat-noe-terr", member)
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
        return cells_by_sheet


def cell(cells: dict[str, str | None], column: int, row: int) -> str | None:
    if column < 1:
        raise SourceError("indice colonna XLSX non valido")
    letters = ""
    current = column
    while current:
        current, remainder = divmod(current - 1, 26)
        letters = chr(65 + remainder) + letters
    return cells.get(f"{letters}{row}")


def territorial_projection(table: dict, cells: dict[str, str | None], source: dict) -> bytes:
    if cell(cells, 1, table["titleRow"]) != table["title"]:
        raise SourceError("titolo Tav.6 divergente")
    headers = [cell(cells, column, table["headerRow"]) for column in range(1, 6)]
    if headers != table["expectedHeaders"]:
        raise SourceError("header Tav.6 divergenti")
    if cell(cells, 1, table["footnoteRow"]) != table["footnote"]:
        raise SourceError("nota Altro* Tav.6 divergente")

    territories = [
        cell(cells, 1, row) for row in range(table["firstDataRow"], table["lastDataRow"] + 1)
    ]
    if territories != table["expectedTerritories"]:
        raise SourceError("territori Tav.6 divergenti")
    if len(territories) != 27:
        raise SourceError("cardinalità territori Tav.6 divergente")

    component_labels: dict[str, str] = table["componentLabels"]
    source_components = table["expectedHeaders"][1:]
    if set(table["publishedAggregates"]) - set(territories):
        raise SourceError("aggregati pubblicati assenti dai territori Tav.6")
    tolerance = Decimal(table["percentageTolerance"])
    year = str(source["referenceYear"])
    rows: list[list[str]] = []

    with localcontext() as context:
        context.prec = 50
        for source_row, territory in zip(
            range(table["firstDataRow"], table["lastDataRow"] + 1),
            territories,
            strict=True,
        ):
            assert isinstance(territory, str)
            raw_values = [cell(cells, column, source_row) for column in range(2, 6)]
            decimals = [
                decimal_value(value, f"Tav.6 {territory} {component}")
                for value, component in zip(raw_values, source_components, strict=True)
            ]
            if abs(decimals[3] - sum(decimals[:3], Decimal())) > tolerance:
                raise SourceError(f"componenti territoriali non riconciliate: {territory}")
            for source_component, value in zip(source_components, raw_values, strict=True):
                assert isinstance(value, str)
                rows.append([
                    territory,
                    component_labels[source_component],
                    value,
                    "percentuale",
                    "valore aggiunto totale del territorio",
                    year,
                    "Tav. 6",
                    source["url"],
                ])

    seen = {(row[0], row[1]) for row in rows}
    if len(seen) != len(rows):
        raise SourceError("duplicati Territorio×Componente nella proiezione Tav.6")
    return delimited_payload(HEADERS, rows)


def delimited_payload(headers: list[str], rows: list[list[str]]) -> bytes:
    output = io.StringIO(newline="")
    writer = csv.writer(output, delimiter="|", lineterminator="\n")
    writer.writerow(headers)
    writer.writerows(rows)
    return output.getvalue().encode("utf-8")


def projections(spec: dict, source_path: Path | None = None) -> dict[str, bytes]:
    validate_contract(spec)
    payload = verified_source(spec, source_path)
    cells_by_sheet = workbook_cells(payload, spec)
    table = spec["tables"][0]
    return {
        table["datasetId"]: territorial_projection(table, cells_by_sheet[table["sheetName"]], spec["source"]),
    }


def check_committed(payloads: dict[str, bytes]) -> None:
    corpus_spec, datasets = corpus.load_spec(CORPUS_SPEC)
    selected = {item["id"]: item for item in datasets if item["id"] in payloads}
    if set(selected) != set(payloads):
        raise SourceError("dataset ISTAT territoriale assente dalla specifica corpus")
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
    spec = json.loads(SPEC.read_text(encoding="utf-8"))
    # validate_contract needs corpus override present; allow --output-dir before registration
    if args.output_dir:
        payload = verified_source(spec, args.input)
        cells_by_sheet = workbook_cells(payload, spec)
        table = spec["tables"][0]
        projected = {
            table["datasetId"]: territorial_projection(
                table, cells_by_sheet[table["sheetName"]], spec["source"]
            )
        }
        args.output_dir.mkdir(parents=True, exist_ok=True)
        for dataset_id, body in projected.items():
            (args.output_dir / f"{dataset_id}.psv").write_bytes(body)
            row_count = body.count(b"\n") - 1
            print(f"{dataset_id}: bytes={len(body)} sha256={corpus.sha256_bytes(body)} rows={row_count}")
    else:
        payloads = projections(spec, args.input)
        if args.publish:
            publish(payloads)
        else:
            check_committed(payloads)
    print("PASS: ISTAT economia non osservata territoriale, Tav.6, fonte e riconciliazioni verificate")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
