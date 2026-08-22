#!/usr/bin/env python3
"""Build the compact 2024 regional-accounts snapshot from official Istat tables."""

from __future__ import annotations

import argparse
import hashlib
import io
import json
import re
import urllib.request
import zipfile
from datetime import datetime, timezone
from decimal import Decimal, ROUND_HALF_UP
from pathlib import Path
from xml.etree import ElementTree as ET

ROOT = Path(__file__).resolve().parents[2]
DATA_PATH = ROOT / "src/data/generated/istat-regions-2024.data.json"
META_PATH = ROOT / "src/data/generated/istat-regions-2024.meta.json"
LANDING_URL = "https://www.istat.it/tavole-di-dati/i-bilanci-consuntivi-delle-regioni-e-province-autonome-anno-2024/"
RESOURCE_URL = "https://www.istat.it/wp-content/uploads/2026/05/Tavole.zip"
SOURCE_RECORD_ID = "istat:125266"
EXPECTED_ZIP_BYTES = 280_471
EXPECTED_ZIP_SHA256 = "ba98c16063bf2bb8b62cd29fbd1dae23eded549faaac2ba06707ac7206ccbb7f"
SPENDING_FILE = "Tavole/Regioni_definitivi_2024_Tavola 2 - Spese anno 2024.xlsx"
REVENUE_FILE = "Tavole/Regioni_definitivi_2024_Tavola 1 - Entrate anno 2024.xlsx"
EXPECTED_SPENDING_BYTES = 200_402
EXPECTED_SPENDING_SHA256 = "a2b6f7d0de90e7fa8c15fb6d325535cb747f3b5a19b49bcb33dc16d61bc16682"
EXPECTED_SHEETS = (
    "ITALIA", "REGIONI A STATUTO ORDINARIO", "PIEMONTE", "LIGURIA", "LOMBARDIA", "VENETO",
    "EMILIA-ROMAGNA", "TOSCANA", "UMBRIA", "MARCHE", "LAZIO", "ABRUZZO", "MOLISE",
    "CAMPANIA", "PUGLIA", "BASILICATA", "CALABRIA", "REGIONI A STATUTO SPECIALE",
    "VALLE D'AOSTA - Vallée d'Aoste", "TRENTINO-ALTO ADIGE - Südtirol", "BOLZANO - Bozen",
    "TRENTO", "FRIULI-VENEZIA GIULIA", "SICILIA", "SARDEGNA",
)
ENTITY_STATUS = {
    **{name: "ordinary" for name in EXPECTED_SHEETS[2:17]},
    **{name: "special" for name in (EXPECTED_SHEETS[18], EXPECTED_SHEETS[19], EXPECTED_SHEETS[22], EXPECTED_SHEETS[23], EXPECTED_SHEETS[24])},
    EXPECTED_SHEETS[20]: "autonomous-province",
    EXPECTED_SHEETS[21]: "autonomous-province",
}
ENTITY_IDS = {
    "PIEMONTE": "piemonte", "LIGURIA": "liguria", "LOMBARDIA": "lombardia", "VENETO": "veneto",
    "EMILIA-ROMAGNA": "emilia-romagna", "TOSCANA": "toscana", "UMBRIA": "umbria", "MARCHE": "marche",
    "LAZIO": "lazio", "ABRUZZO": "abruzzo", "MOLISE": "molise", "CAMPANIA": "campania",
    "PUGLIA": "puglia", "BASILICATA": "basilicata", "CALABRIA": "calabria",
    "VALLE D'AOSTA - Vallée d'Aoste": "valle-aosta", "TRENTINO-ALTO ADIGE - Südtirol": "trentino-alto-adige",
    "BOLZANO - Bozen": "bolzano", "TRENTO": "trento", "FRIULI-VENEZIA GIULIA": "friuli-venezia-giulia",
    "SICILIA": "sicilia", "SARDEGNA": "sardegna",
}
ENTITY_LABELS = {
    "PIEMONTE": "Piemonte", "LIGURIA": "Liguria", "LOMBARDIA": "Lombardia", "VENETO": "Veneto",
    "EMILIA-ROMAGNA": "Emilia-Romagna", "TOSCANA": "Toscana", "UMBRIA": "Umbria", "MARCHE": "Marche",
    "LAZIO": "Lazio", "ABRUZZO": "Abruzzo", "MOLISE": "Molise", "CAMPANIA": "Campania",
    "PUGLIA": "Puglia", "BASILICATA": "Basilicata", "CALABRIA": "Calabria",
    "VALLE D'AOSTA - Vallée d'Aoste": "Valle d'Aosta/Vallée d'Aoste",
    "TRENTINO-ALTO ADIGE - Südtirol": "Trentino-Alto Adige/Südtirol",
    "BOLZANO - Bozen": "Provincia autonoma di Bolzano/Bozen",
    "TRENTO": "Provincia autonoma di Trento",
    "FRIULI-VENEZIA GIULIA": "Friuli-Venezia Giulia", "SICILIA": "Sicilia", "SARDEGNA": "Sardegna",
}
TITLE_ROWS = (9, 58, 79, 98, 104, 105)
NS = {"x": "http://schemas.openxmlformats.org/spreadsheetml/2006/main"}
REL_NS = {"r": "http://schemas.openxmlformats.org/package/2006/relationships"}
OFFICE_REL = "{http://schemas.openxmlformats.org/officeDocument/2006/relationships}id"


def fetch() -> bytes:
    request = urllib.request.Request(RESOURCE_URL, headers={"User-Agent": "DoveVannoINostriSoldi/0.2 source-verifier"})
    with urllib.request.urlopen(request, timeout=90) as response:
        if response.status != 200:
            raise ValueError(f"HTTP inatteso {response.status}")
        return response.read()


def canonical_bytes(value: object) -> bytes:
    return (json.dumps(value, ensure_ascii=False, indent=2, sort_keys=True) + "\n").encode()


def cents(value: Decimal) -> int:
    return int((value * 100).quantize(Decimal("1"), rounding=ROUND_HALF_UP))


def shared_strings(archive: zipfile.ZipFile) -> list[str]:
    root = ET.fromstring(archive.read("xl/sharedStrings.xml"))
    return ["".join(item.itertext()) for item in root.findall("x:si", NS)]


def cell_value(cell: ET.Element, strings: list[str]) -> str | Decimal | None:
    cell_type = cell.attrib.get("t")
    value = cell.find("x:v", NS)
    if cell_type == "inlineStr":
        inline = cell.find("x:is", NS)
        return "".join(inline.itertext()) if inline is not None else None
    if value is None or value.text is None:
        return None
    if cell_type == "s":
        return strings[int(value.text)]
    if cell_type in {"str", "e"}:
        return value.text
    return Decimal(value.text)


def worksheet_cells(payload: bytes) -> tuple[list[str], dict[str, dict[str, str | Decimal | None]]]:
    with zipfile.ZipFile(io.BytesIO(payload)) as archive:
        strings = shared_strings(archive)
        workbook = ET.fromstring(archive.read("xl/workbook.xml"))
        relationships = ET.fromstring(archive.read("xl/_rels/workbook.xml.rels"))
        targets = {item.attrib["Id"]: item.attrib["Target"] for item in relationships.findall("r:Relationship", REL_NS)}
        sheets = workbook.findall("x:sheets/x:sheet", NS)
        names = [sheet.attrib["name"] for sheet in sheets]
        cells_by_sheet: dict[str, dict[str, str | Decimal | None]] = {}
        for sheet in sheets:
            name = sheet.attrib["name"]
            target = targets[sheet.attrib[OFFICE_REL]]
            worksheet = ET.fromstring(archive.read(f"xl/{target}"))
            dimension = worksheet.find("x:dimension", NS)
            if dimension is None or dimension.attrib.get("ref") != "A1:D109":
                raise ValueError(f"Dimensione inattesa nel foglio {name}")
            cells_by_sheet[name] = {
                cell.attrib["r"]: cell_value(cell, strings)
                for cell in worksheet.findall(".//x:sheetData/x:row/x:c", NS)
            }
    return names, cells_by_sheet


def text_cell(cells: dict[str, str | Decimal | None], coordinate: str) -> str:
    value = cells.get(coordinate)
    if not isinstance(value, str) or not value.strip():
        raise ValueError(f"Testo Istat mancante in {coordinate}")
    return " ".join(value.split())


def money_cell(cells: dict[str, str | Decimal | None], coordinate: str) -> Decimal:
    value = cells.get(coordinate)
    if not isinstance(value, Decimal):
        raise ValueError(f"Importo Istat mancante in {coordinate}")
    return value


def build_snapshot(payload: bytes, acquired_at: str) -> tuple[dict, dict]:
    if len(payload) != EXPECTED_ZIP_BYTES or hashlib.sha256(payload).hexdigest() != EXPECTED_ZIP_SHA256:
        raise ValueError("Archivio Istat diverso dal file validato")
    with zipfile.ZipFile(io.BytesIO(payload)) as archive:
        if set(archive.namelist()) != {"Tavole/", REVENUE_FILE, SPENDING_FILE}:
            raise ValueError("Contenuto archivio Istat inatteso")
        spending = archive.read(SPENDING_FILE)
    if len(spending) != EXPECTED_SPENDING_BYTES or hashlib.sha256(spending).hexdigest() != EXPECTED_SPENDING_SHA256:
        raise ValueError("Tavola spese Istat diversa dal file validato")
    sheet_names, sheets = worksheet_cells(spending)
    if tuple(sheet_names) != EXPECTED_SHEETS:
        raise ValueError("Elenco o ordine dei fogli Istat inatteso")

    entities = []
    for sheet_name, status in ENTITY_STATUS.items():
        cells = sheets[sheet_name]
        if text_cell(cells, "B4").casefold() != "impegni":
            raise ValueError(f"Fase contabile inattesa nel foglio {sheet_name}")
        source_label = text_cell(cells, "A7")
        titles = []
        for row in TITLE_ROWS:
            label = text_cell(cells, f"A{row}")
            match = re.search(r"TITOLO\s+([IVX0-9]+)", label, flags=re.IGNORECASE)
            if not match:
                raise ValueError(f"Titolo inatteso nel foglio {sheet_name}, riga {row}")
            titles.append({"code": match.group(1).upper(), "label": label, "commitmentsCents": cents(money_cell(cells, f"B{row}"))})
        if text_cell(cells, "A108").casefold() != "totale generale delle spese":
            raise ValueError(f"Totale ufficiale mancante nel foglio {sheet_name}")
        total = cents(money_cell(cells, "B108"))
        if sum(item["commitmentsCents"] for item in titles) != total:
            raise ValueError(f"Titoli non riconciliati nel foglio {sheet_name}")
        entities.append({
            "id": ENTITY_IDS[sheet_name],
            "label": ENTITY_LABELS[sheet_name],
            "sourceLabel": source_label,
            "sourceSheet": sheet_name,
            "status": status,
            "commitmentsCents": total,
            "titles": titles,
        })
    if len(entities) != 22 or len({item["id"] for item in entities}) != 22:
        raise ValueError("Copertura delle amministrazioni regionali inattesa")

    data = {
        "schemaVersion": 1,
        "referenceYear": 2024,
        "unit": "euro_cents",
        "accountingFrame": "commitments",
        "entities": entities,
        "coverage": {
            "workbookSheets": len(sheet_names), "individualAdministrations": len(entities),
            "ordinaryRegions": sum(item["status"] == "ordinary" for item in entities),
            "specialRegions": sum(item["status"] == "special" for item in entities),
            "autonomousProvinces": sum(item["status"] == "autonomous-province" for item in entities),
            "entitiesReconciled": len(entities),
        },
        "definitions": {
            "scope": "Bilanci consuntivi delle singole amministrazioni regionali e Province autonome.",
            "measure": "Impegni 2024, tenuti separati dai pagamenti di competenza e sui residui.",
            "comparisonLimit": "Valori assoluti: nessun confronto pro capite senza una popolazione Istat bloccata sullo stesso periodo.",
            "geographyLimit": "Ventidue amministrazioni non corrispondono alle venti geometrie regionali; la mappa non viene usata.",
        },
    }
    data_bytes = canonical_bytes(data)
    meta = {
        "schemaVersion": 1,
        "source": {
            "owner": "Istat", "landingUrl": LANDING_URL, "resourceUrl": RESOURCE_URL,
            "sourceRecordId": SOURCE_RECORD_ID, "referencePeriod": "2024", "publishedAt": "2026-05-05",
            "acquiredAt": acquired_at, "format": "zip+xlsx", "licenseStatus": "not-declared",
        },
        "asset": {"bytes": len(payload), "sha256": hashlib.sha256(payload).hexdigest()},
        "spendingWorkbook": {"path": SPENDING_FILE, "bytes": len(spending), "sha256": hashlib.sha256(spending).hexdigest()},
        "transformation": {"version": 1, "description": "Esclusi i tre fogli aggregati; letti solo gli impegni dei sei Titoli e riconciliati con il totale ufficiale per 22 amministrazioni."},
        "dataArtifact": {"path": str(DATA_PATH.relative_to(ROOT)), "bytes": len(data_bytes), "sha256": hashlib.sha256(data_bytes).hexdigest()},
    }
    return data, meta


def validate_committed() -> None:
    data_bytes = DATA_PATH.read_bytes()
    data = json.loads(data_bytes)
    meta = json.loads(META_PATH.read_text())
    artifact = meta["dataArtifact"]
    if len(data_bytes) != artifact["bytes"] or hashlib.sha256(data_bytes).hexdigest() != artifact["sha256"]:
        raise ValueError("Artefatto Regioni non legato al manifesto")
    if meta["asset"] != {"bytes": EXPECTED_ZIP_BYTES, "sha256": EXPECTED_ZIP_SHA256}:
        raise ValueError("Archivio Regioni non legato alla fonte validata")
    if meta["spendingWorkbook"] != {
        "path": SPENDING_FILE, "bytes": EXPECTED_SPENDING_BYTES, "sha256": EXPECTED_SPENDING_SHA256,
    }:
        raise ValueError("Workbook Regioni non legato alla tavola validata")
    if meta["source"]["sourceRecordId"] != SOURCE_RECORD_ID or meta["source"]["resourceUrl"] != RESOURCE_URL:
        raise ValueError("Identità della fonte Regioni inattesa")
    if data["coverage"] != {"workbookSheets": 25, "individualAdministrations": 22, "ordinaryRegions": 15, "specialRegions": 5, "autonomousProvinces": 2, "entitiesReconciled": 22}:
        raise ValueError("Copertura Regioni inattesa")
    if {
        item["sourceSheet"]: (item["id"], item["status"])
        for item in data["entities"]
    } != {
        sheet: (ENTITY_IDS[sheet], status)
        for sheet, status in ENTITY_STATUS.items()
    }:
        raise ValueError("Identità delle amministrazioni regionali inattesa")


def main() -> None:
    parser = argparse.ArgumentParser()
    parser.add_argument("--input", type=Path)
    parser.add_argument("--acquired-at")
    parser.add_argument("--validate-committed", action="store_true")
    args = parser.parse_args()
    if args.validate_committed:
        validate_committed()
        return
    payload = args.input.read_bytes() if args.input else fetch()
    acquired_at = args.acquired_at or datetime.now(timezone.utc).isoformat().replace("+00:00", "Z")
    data, meta = build_snapshot(payload, acquired_at)
    DATA_PATH.write_bytes(canonical_bytes(data))
    META_PATH.write_bytes(canonical_bytes(meta))


if __name__ == "__main__":
    main()
