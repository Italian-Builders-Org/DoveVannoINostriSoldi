#!/usr/bin/env python3
"""Build the source-locked ISTAT building-permits national intro snapshot (a.1–a.4).

Reads the official zip *Tavole-16giugno2026.zip* (permessi di costruire, anno 2025).
Runtime and CI stay offline: URL, bytes, SHA-256, member hashes, labels and 2025
cell pins live in the source lock.

These are counts, volumes (m³) and surfaces (m²), not money. Empty cells stay
non-observed and are never coerced to zero. Tables a.1–a.4 remain distinct
series (new residential, residential extensions, new non-residential,
non-residential extensions).
"""

from __future__ import annotations

import argparse
import hashlib
import io
import json
import re
import sys
from decimal import Decimal, InvalidOperation
from pathlib import Path
from typing import Any
from xml.etree import ElementTree as ET
from zipfile import BadZipFile, ZipFile

ROOT = Path(__file__).resolve().parents[2]
DEFAULT_SPEC = ROOT / "scripts/etl/specs/istat-permessi-costruire-2015-2025.source.json"
DEFAULT_DATA = ROOT / "src/data/generated/istat-permessi-costruire-2015-2025.data.json"
DEFAULT_META = ROOT / "src/data/generated/istat-permessi-costruire-2015-2025.meta.json"
DATASET_ID = "istat-permessi-costruire-2015-2025"
ISTAT_PREFIX = "https://www.istat.it/"
NS = {"x": "http://schemas.openxmlformats.org/spreadsheetml/2006/main"}
REL_NS = {"r": "http://schemas.openxmlformats.org/package/2006/relationships"}
OFFICE_REL = "{http://schemas.openxmlformats.org/officeDocument/2006/relationships}id"
CELL_REF = re.compile(r"^([A-Z]+)([1-9][0-9]*)$")
MAX_SAFE = 9_007_199_254_740_991
YEARS = tuple(range(2015, 2026))

CAVEATS = (
    "Serie nazionali ISTAT sui permessi di costruire: conteggi, volumi e superfici, non pagamenti né stanziamenti.",
    "Non confondere con le opere pubbliche MOP/OpenBDAP (/opere) né con la cassa SIOPE.",
    "Questa slice pubblica solo le tavole introduttive nazionali a.1–a.4 (2015–2025); nessuna tavola provinciale o analitica.",
    "a.1 (nuova residenziale), a.2 (ampliamenti residenziali), a.3 (nuova non residenziale) e a.4 (ampliamenti non residenziali) restano serie distinte.",
    "Rottura metodologica rispetto alle serie pre-2004: dal 2005 il campo cambia (nota ISTAT sulla landing).",
    "Dall'edizione 2020 ISTAT modifica le imputazioni dei dati mancanti: confrontare con cautela le annate a cavallo.",
    "Celle vuote restano non osservate: non diventano zero e non si ricostruiscono per differenza.",
    "Licenza del zip non dichiarata sul payload: licenseId not-declared; riuso soggetto alle note legali ISTAT citate come evidenza.",
)


class SnapshotError(ValueError):
    """Schema, provenance or cell drift blocks publication."""


def sha256_bytes(payload: bytes) -> str:
    return hashlib.sha256(payload).hexdigest()


def canonical_bytes(value: object) -> bytes:
    return json.dumps(value, ensure_ascii=False, sort_keys=True, separators=(",", ":")).encode("utf-8")


def canonical_lock_sha256(lock: dict[str, Any]) -> str:
    clone = json.loads(json.dumps(lock))
    clone["integrity"]["lockSha256"] = ""
    return sha256_bytes(canonical_bytes(clone))


def load_spec(path: Path = DEFAULT_SPEC) -> dict[str, Any]:
    try:
        spec = json.loads(path.read_text(encoding="utf-8"))
    except (OSError, json.JSONDecodeError) as error:
        raise SnapshotError(f"source lock illeggibile: {error}") from error
    if spec.get("schemaVersion") != 1 or spec.get("datasetId") != DATASET_ID:
        raise SnapshotError("source lock: identità inattesa")
    source = spec.get("source") or {}
    if source.get("licenseId") != "not-declared":
        raise SnapshotError("source lock: licenza deve restare not-declared")
    for key in ("landingUrl", "url"):
        if not str(source.get(key, "")).startswith(ISTAT_PREFIX):
            raise SnapshotError(f"source lock: {key} non ufficiale ISTAT")
    for evidence in source.get("evidenceUrls") or []:
        if not str(evidence).startswith(ISTAT_PREFIX):
            raise SnapshotError("source lock: evidence URL non ufficiale ISTAT")
    if not isinstance(source.get("bytes"), int) or source["bytes"] <= 0:
        raise SnapshotError("source lock: bytes non validi")
    digest = str(source.get("sha256", ""))
    if len(digest) != 64 or set(digest) - set("0123456789abcdef"):
        raise SnapshotError("source lock: sha256 non valido")
    soldi = (spec.get("semantics") or {}).get("soldi") or {}
    if soldi.get("present") is not False:
        raise SnapshotError("source lock: soldi.present deve essere false")
    if list((spec.get("expected") or {}).get("years") or []) != list(YEARS):
        raise SnapshotError("source lock: anni attesi devono essere 2015-2025")
    if canonical_lock_sha256(spec) != (spec.get("integrity") or {}).get("lockSha256"):
        raise SnapshotError("source lock: lockSha256 divergente")
    return spec


def verified_zip(spec: dict[str, Any], path: Path | None = None) -> bytes:
    source = spec["source"]
    source_path = path or ROOT / source["path"]
    payload = source_path.read_bytes()
    if len(payload) != source["bytes"] or sha256_bytes(payload) != source["sha256"]:
        raise SnapshotError("byte sorgente zip divergenti dal lock")
    return payload


def parse_xlsx_cells(payload: bytes) -> tuple[str, dict[str, Any]]:
    try:
        archive = ZipFile(io.BytesIO(payload))
    except BadZipFile as error:
        raise SnapshotError("membro XLSX non valido") from error
    with archive:
        try:
            strings_root = ET.fromstring(archive.read("xl/sharedStrings.xml"))
            strings = ["".join(item.itertext()) for item in strings_root.findall("x:si", NS)]
            workbook = ET.fromstring(archive.read("xl/workbook.xml"))
            relationships = ET.fromstring(archive.read("xl/_rels/workbook.xml.rels"))
        except (KeyError, ET.ParseError) as error:
            raise SnapshotError("struttura XLSX incompleta") from error
        targets = {
            item.attrib["Id"]: item.attrib["Target"]
            for item in relationships.findall("r:Relationship", REL_NS)
        }
        sheets = workbook.findall("x:sheets/x:sheet", NS)
        if len(sheets) != 1:
            raise SnapshotError(f"atteso un solo foglio, trovati {len(sheets)}")
        sheet = sheets[0]
        name = sheet.attrib.get("name") or ""
        target = targets.get(sheet.attrib.get(OFFICE_REL, ""))
        if not target:
            raise SnapshotError("relazione foglio mancante")
        member = target if target.startswith("xl/") else f"xl/{target}"
        try:
            worksheet = ET.fromstring(archive.read(member))
        except (KeyError, ET.ParseError) as error:
            raise SnapshotError("foglio XLSX mancante") from error
        cells: dict[str, Any] = {}
        for cell in worksheet.findall(".//x:sheetData/x:row/x:c", NS):
            reference = cell.attrib.get("r", "")
            if CELL_REF.fullmatch(reference) is None or reference in cells:
                raise SnapshotError(f"riferimento cella invalido o duplicato: {reference}")
            if cell.find("x:f", NS) is not None:
                raise SnapshotError(f"formula inattesa in {reference}")
            cell_type = cell.attrib.get("t")
            value_node = cell.find("x:v", NS)
            if cell_type == "s":
                if value_node is None or value_node.text is None:
                    raise SnapshotError(f"shared string vuota in {reference}")
                cells[reference] = strings[int(value_node.text)]
            elif cell_type in {None, "n"}:
                if value_node is None or value_node.text is None:
                    cells[reference] = None
                else:
                    try:
                        decimal = Decimal(value_node.text)
                    except InvalidOperation as error:
                        raise SnapshotError(f"numero non valido in {reference}") from error
                    if decimal != decimal.to_integral_value():
                        raise SnapshotError(f"valore non intero in {reference}: {value_node.text}")
                    cells[reference] = int(decimal)
            elif cell_type == "inlineStr":
                inline = cell.find("x:is", NS)
                cells[reference] = "".join(inline.itertext()) if inline is not None else None
            else:
                raise SnapshotError(f"tipo cella inatteso in {reference}: {cell_type}")
        return name, cells


def text_at(cells: dict[str, Any], reference: str) -> str | None:
    value = cells.get(reference)
    if value is None:
        return None
    if not isinstance(value, str):
        raise SnapshotError(f"{reference}: atteso testo, trovato {value!r}")
    return value


def require_label(cells: dict[str, Any], reference: str, expected: str) -> None:
    actual = text_at(cells, reference)
    if actual != expected:
        raise SnapshotError(f"etichetta {reference}: {actual!r} != {expected!r}")


def metric_cell(cells: dict[str, Any], reference: str, where: str) -> dict[str, Any]:
    if reference not in cells or cells[reference] is None:
        return {"value": None, "status": "missing"}
    value = cells[reference]
    if isinstance(value, str):
        raise SnapshotError(f"{where}: atteso numero intero, trovato testo {value!r}")
    if not isinstance(value, int) or abs(value) > MAX_SAFE:
        raise SnapshotError(f"{where}: intero non sicuro {value!r}")
    return {"value": value, "status": "observed"}


def year_rows(cells: dict[str, Any], first_row: int) -> dict[int, int]:
    """Map year -> sheet row for contiguous YEARS starting at first_row."""
    mapping: dict[int, int] = {}
    for offset, year in enumerate(YEARS):
        row = first_row + offset
        ref = f"A{row}"
        value = cells.get(ref)
        if value != year:
            raise SnapshotError(f"anno inatteso in {ref}: {value!r} != {year}")
        mapping[year] = row
    return mapping


def build_a1(cells: dict[str, Any], sheet_name: str, table_spec: dict[str, Any]) -> dict[str, Any]:
    if sheet_name != table_spec["sheetName"]:
        raise SnapshotError(f"a.1 sheet name: {sheet_name!r} != {table_spec['sheetName']!r}")
    require_label(cells, "A1", table_spec["titleCell"])
    for reference, expected in table_spec["labels"].items():
        require_label(cells, reference, expected)
    rows = year_rows(cells, table_spec["firstDataRow"])
    years = []
    for year in YEARS:
        row = rows[year]
        years.append({
            "year": year,
            "fabbricati": {
                "numero": metric_cell(cells, f"B{row}", f"a1 {year} fabbricati.numero"),
                "volume": metric_cell(cells, f"C{row}", f"a1 {year} fabbricati.volume"),
                "superficieTotale": metric_cell(cells, f"D{row}", f"a1 {year} fabbricati.superficieTotale"),
            },
            "abitazioni": {
                "numero": metric_cell(cells, f"F{row}", f"a1 {year} abitazioni.numero"),
                "superficieUtile": metric_cell(cells, f"G{row}", f"a1 {year} abitazioni.superficieUtile"),
                "stanze": metric_cell(cells, f"H{row}", f"a1 {year} abitazioni.stanze"),
                "accessoriInterni": metric_cell(cells, f"I{row}", f"a1 {year} abitazioni.accessoriInterni"),
            },
        })
    return {
        "code": "a.1",
        "kind": "nuova-edilizia-residenziale",
        "sheetName": sheet_name,
        "years": years,
    }


def build_a2(cells: dict[str, Any], sheet_name: str, table_spec: dict[str, Any]) -> dict[str, Any]:
    if sheet_name != table_spec["sheetName"]:
        raise SnapshotError(f"a.2 sheet name: {sheet_name!r} != {table_spec['sheetName']!r}")
    require_label(cells, "A1", table_spec["titleCell"])
    for reference, expected in table_spec["labels"].items():
        require_label(cells, reference, expected)
    rows = year_rows(cells, table_spec["firstDataRow"])
    years = []
    for year in YEARS:
        row = rows[year]
        years.append({
            "year": year,
            "ampliamentiConAbitazioni": {
                "abitazioni": metric_cell(cells, f"B{row}", f"a2 {year} abitazioni"),
                "superficieUtile": metric_cell(cells, f"C{row}", f"a2 {year} superficieUtile"),
                "stanze": metric_cell(cells, f"D{row}", f"a2 {year} stanze"),
                "accessoriInterni": metric_cell(cells, f"E{row}", f"a2 {year} accessoriInterni"),
            },
            "ampliamentiSoliVani": {
                "stanze": metric_cell(cells, f"G{row}", f"a2 {year} soliVani.stanze"),
                "accessoriInterni": metric_cell(cells, f"H{row}", f"a2 {year} soliVani.accessori"),
                "superficieUtile": metric_cell(cells, f"I{row}", f"a2 {year} soliVani.superficie"),
            },
            "ampliamentiAltriUsi": {
                "superficieServiziEsterni": metric_cell(cells, f"K{row}", f"a2 {year} serviziEsterni"),
                "superficieAttivitaProduttive": metric_cell(cells, f"L{row}", f"a2 {year} attivita"),
            },
            "totaleAmpliamenti": {
                "volume": metric_cell(cells, f"N{row}", f"a2 {year} totale.volume"),
                "superficieTotale": metric_cell(cells, f"O{row}", f"a2 {year} totale.superficie"),
            },
        })
    return {
        "code": "a.2",
        "kind": "ampliamenti-residenziali",
        "sheetName": sheet_name,
        "years": years,
    }


SECTOR_KEYS = ("agricoltura", "industria", "commercio", "altro", "totale")


def build_a3(cells: dict[str, Any], sheet_name: str, table_spec: dict[str, Any]) -> dict[str, Any]:
    if sheet_name != table_spec["sheetName"]:
        raise SnapshotError(f"a.3 sheet name: {sheet_name!r} != {table_spec['sheetName']!r}")
    require_label(cells, "A1", table_spec["titleCell"])
    for reference, expected in table_spec["labels"].items():
        require_label(cells, reference, expected)
    rows = year_rows(cells, table_spec["firstDataRow"])
    columns = table_spec["sectorColumns"]
    years = []
    for year in YEARS:
        row = rows[year]
        sectors = {}
        for key in SECTOR_KEYS:
            cols = columns[key]
            sectors[key] = {
                "fabbricati": metric_cell(cells, f"{cols['fabbricati']}{row}", f"a3 {year} {key}.fabbricati"),
                "volume": metric_cell(cells, f"{cols['volume']}{row}", f"a3 {year} {key}.volume"),
                "superficieTotale": metric_cell(
                    cells, f"{cols['superficieTotale']}{row}", f"a3 {year} {key}.superficie",
                ),
            }
        years.append({"year": year, "sectors": sectors})
    return {
        "code": "a.3",
        "kind": "nuova-edilizia-non-residenziale",
        "sheetName": sheet_name,
        "years": years,
    }


def build_a4(cells: dict[str, Any], sheet_name: str, table_spec: dict[str, Any]) -> dict[str, Any]:
    if sheet_name != table_spec["sheetName"]:
        raise SnapshotError(f"a.4 sheet name: {sheet_name!r} != {table_spec['sheetName']!r}")
    require_label(cells, "A1", table_spec["titleCell"])
    for reference, expected in table_spec["labels"].items():
        require_label(cells, reference, expected)
    rows = year_rows(cells, table_spec["firstDataRow"])
    columns = table_spec["sectorColumns"]
    years = []
    for year in YEARS:
        row = rows[year]
        sectors = {}
        for key in SECTOR_KEYS:
            cols = columns[key]
            sectors[key] = {
                "volume": metric_cell(cells, f"{cols['volume']}{row}", f"a4 {year} {key}.volume"),
                "superficieTotale": metric_cell(
                    cells, f"{cols['superficieTotale']}{row}", f"a4 {year} {key}.superficie",
                ),
            }
        years.append({"year": year, "sectors": sectors})
    return {
        "code": "a.4",
        "kind": "ampliamenti-non-residenziali",
        "sheetName": sheet_name,
        "years": years,
    }


BUILDERS = {
    "a1": build_a1,
    "a2": build_a2,
    "a3": build_a3,
    "a4": build_a4,
}


def read_locked_members(zip_payload: bytes, spec: dict[str, Any]) -> dict[str, bytes]:
    members_spec = spec["source"]["members"]
    try:
        archive = ZipFile(io.BytesIO(zip_payload))
    except BadZipFile as error:
        raise SnapshotError("zip non valido") from error
    out: dict[str, bytes] = {}
    with archive:
        names = set(archive.namelist())
        for table_id, meta in members_spec.items():
            path = meta["path"]
            if path not in names:
                raise SnapshotError(f"membro obbligatorio assente: {path}")
            payload = archive.read(path)
            if len(payload) != meta["bytes"] or sha256_bytes(payload) != meta["sha256"]:
                raise SnapshotError(f"membro divergente dal lock: {path}")
            out[table_id] = payload
    return out


def pin_2025(table: dict[str, Any], pins: dict[str, Any], table_id: str) -> None:
    year_2025 = next(row for row in table["years"] if row["year"] == 2025)
    if table_id == "a1":
        for group, metrics in pins.items():
            for metric, expected in metrics.items():
                cell = year_2025[group][metric]
                if cell["status"] != "observed" or cell["value"] != expected:
                    raise SnapshotError(f"pin 2025 a1 {group}.{metric}: {cell} != {expected}")
    elif table_id == "a2":
        for group, metrics in pins.items():
            for metric, expected in metrics.items():
                cell = year_2025[group][metric]
                if cell["status"] != "observed" or cell["value"] != expected:
                    raise SnapshotError(f"pin 2025 a2 {group}.{metric}: {cell} != {expected}")
    elif table_id in {"a3", "a4"}:
        for sector, metrics in pins.items():
            for metric, expected in metrics.items():
                cell = year_2025["sectors"][sector][metric]
                if cell["status"] != "observed" or cell["value"] != expected:
                    raise SnapshotError(f"pin 2025 {table_id} {sector}.{metric}: {cell} != {expected}")


def build_data(zip_payload: bytes, spec: dict[str, Any]) -> dict[str, Any]:
    members = read_locked_members(zip_payload, spec)
    tables_spec = spec["expected"]["tables"]
    tables: dict[str, Any] = {}
    for table_id, builder in BUILDERS.items():
        sheet_name, cells = parse_xlsx_cells(members[table_id])
        tables[table_id] = builder(cells, sheet_name, tables_spec[table_id])
        pin_2025(tables[table_id], tables_spec[table_id]["pin2025"], table_id)
    return {
        "schemaVersion": 1,
        "datasetId": DATASET_ID,
        "geography": {"code": "IT", "label": "Italia"},
        "period": {"from": 2015, "to": 2025},
        "units": {
            "counts": "units",
            "volume": "cubic-metres",
            "surface": "square-metres",
        },
        "soldi": {
            "present": False,
            "note": "Conteggi, volumi e superfici dei permessi di costruire; non importi monetari.",
        },
        "caveats": list(CAVEATS),
        "tables": tables,
    }


def validate_data(data: dict[str, Any], spec: dict[str, Any]) -> None:
    if data.get("datasetId") != DATASET_ID or data.get("schemaVersion") != 1:
        raise SnapshotError("data: identità inattesa")
    if data.get("soldi", {}).get("present") is not False:
        raise SnapshotError("data: soldi.present deve essere false")
    if data.get("period") != {"from": 2015, "to": 2025}:
        raise SnapshotError("data: periodo inatteso")
    if data.get("caveats") != list(CAVEATS):
        raise SnapshotError("data: caveats divergenti")
    tables = data.get("tables") or {}
    if set(tables) != {"a1", "a2", "a3", "a4"}:
        raise SnapshotError("data: tavole incomplete")
    for table_id, table in tables.items():
        years = [row["year"] for row in table.get("years") or []]
        if years != list(YEARS):
            raise SnapshotError(f"{table_id}: anni divergenti")
        pin_2025(table, spec["expected"]["tables"][table_id]["pin2025"], table_id)
        for row in table["years"]:
            # Empty ≠ zero: observed zeros would be allowed if present; missing must stay missing.
            def walk(node: Any, path: str) -> None:
                if isinstance(node, dict) and set(node.keys()) == {"value", "status"}:
                    status = node["status"]
                    value = node["value"]
                    if status == "observed":
                        if value is None or not isinstance(value, int):
                            raise SnapshotError(f"{path}: observed senza intero")
                    elif status == "missing":
                        if value is not None:
                            raise SnapshotError(f"{path}: missing con valore")
                    else:
                        raise SnapshotError(f"{path}: status sconosciuto {status}")
                elif isinstance(node, dict):
                    for key, child in node.items():
                        if key == "year":
                            continue
                        walk(child, f"{path}.{key}")
                elif isinstance(node, list):
                    for index, child in enumerate(node):
                        walk(child, f"{path}[{index}]")
            walk(row, f"{table_id}.{row['year']}")


def metadata(spec: dict[str, Any], data_payload: bytes, data: dict[str, Any]) -> dict[str, Any]:
    source = spec["source"]
    return {
        "schemaVersion": 1,
        "datasetId": DATASET_ID,
        "period": {"from": 2015, "to": 2025},
        "observedAt": source["acquiredAt"],
        "source": {
            "owner": source["owner"],
            "landingUrl": source["landingUrl"],
            "url": source["url"],
            "filename": source["filename"],
            "licenseId": source["licenseId"],
            "licenseNote": source["licenseNote"],
            "evidenceUrls": list(source["evidenceUrls"]),
            "publicationDate": source["publicationDate"],
            "acquiredAt": source["acquiredAt"],
            "checkedAt": source["checkedAt"],
            "bytes": source["bytes"],
            "sha256": source["sha256"],
            "path": source["path"],
            "geography": source["geography"],
            "updateFrequency": source["updateFrequency"],
            "referenceYear": source["referenceYear"],
        },
        "coverage": {
            "years": 11,
            "tables": 4,
            "geography": "national-only",
        },
        "integrity": {
            "sourceLockSha256": spec["integrity"]["lockSha256"],
            "dataSha256": sha256_bytes(data_payload),
            "dataBytes": len(data_payload),
        },
        "semantics": {
            "soldi": {
                "present": False,
                "unit": None,
                "nature": "conteggi / volumi / superfici dei permessi di costruire; non soldi",
            },
            "periodo": {
                "referencePeriod": "2015-2025",
                "referenceYearOfRelease": source["referenceYear"],
                "publicationDate": source["publicationDate"],
            },
            "provenance": {
                "holder": source["owner"],
                "publicationDate": source["publicationDate"],
                "acquiredAt": source["acquiredAt"],
                "checkedAt": source["checkedAt"],
            },
        },
    }


def write_artifacts(spec: dict[str, Any], data: dict[str, Any], data_path: Path, meta_path: Path) -> None:
    payload = (json.dumps(data, ensure_ascii=False, indent=2) + "\n").encode("utf-8")
    meta = metadata(spec, payload, data)
    data_path.parent.mkdir(parents=True, exist_ok=True)
    data_path.write_bytes(payload)
    meta_path.write_text(json.dumps(meta, ensure_ascii=False, indent=2) + "\n", encoding="utf-8")


def check(spec_path: Path = DEFAULT_SPEC, data_path: Path = DEFAULT_DATA, meta_path: Path = DEFAULT_META) -> None:
    spec = load_spec(spec_path)
    payload = data_path.read_bytes()
    data = json.loads(payload.decode("utf-8"))
    validate_data(data, spec)
    expected_meta = metadata(spec, payload, data)
    if json.loads(meta_path.read_text(encoding="utf-8")) != expected_meta:
        raise SnapshotError("Metadata or artifact hash drift")
    if spec.get("dataCanonicalSha256") != sha256_bytes(canonical_bytes(data)):
        raise SnapshotError("dataCanonicalSha256 drift")
    source_payload = verified_zip(spec)
    rebuilt = build_data(source_payload, spec)
    if canonical_bytes(rebuilt) != canonical_bytes(data):
        raise SnapshotError("riproiezione dallo zip diverge dall'artifact")


def main() -> int:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--spec", type=Path, default=DEFAULT_SPEC)
    parser.add_argument("--data", type=Path, default=DEFAULT_DATA)
    parser.add_argument("--meta", type=Path, default=DEFAULT_META)
    parser.add_argument("--input", type=Path, help="path to the official zip (defaults to lock path)")
    parser.add_argument("--write", action="store_true")
    parser.add_argument("--check", action="store_true")
    args = parser.parse_args()
    try:
        if args.check:
            check(args.spec, args.data, args.meta)
            print("istat-permessi-costruire-2015-2025: lock, data e meta coerenti")
            return 0
        if not args.write:
            raise SnapshotError("specificare --write oppure --check")
        # Draft lock may have empty integrity; load without hash check for write bootstrap.
        raw = json.loads(args.spec.read_text(encoding="utf-8"))
        if not (raw.get("integrity") or {}).get("lockSha256"):
            raw.setdefault("integrity", {})["lockSha256"] = ""
            raw["integrity"]["lockSha256"] = canonical_lock_sha256(raw)
            # Temporarily accept for build; rewritten below with data digest.
        # Bypass load_spec hash until digests are filled.
        draft = raw
        if draft.get("schemaVersion") != 1 or draft.get("datasetId") != DATASET_ID:
            raise SnapshotError("source lock: identità inattesa")
        zip_payload = verified_zip(draft, args.input)
        data = build_data(zip_payload, draft)
        draft["dataCanonicalSha256"] = sha256_bytes(canonical_bytes(data))
        draft["integrity"]["lockSha256"] = ""
        draft["integrity"]["lockSha256"] = canonical_lock_sha256(draft)
        args.spec.write_text(json.dumps(draft, ensure_ascii=False, indent=2) + "\n", encoding="utf-8")
        write_artifacts(draft, data, args.data, args.meta)
        check(args.spec, args.data, args.meta)
        print(f"istat-permessi-costruire-2015-2025: scritto {args.data.relative_to(ROOT)}")
        return 0
    except SnapshotError as error:
        print(f"istat-permessi-costruire-2015-2025: {error}", file=sys.stderr)
        return 1


if __name__ == "__main__":
    raise SystemExit(main())
