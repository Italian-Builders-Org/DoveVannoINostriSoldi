#!/usr/bin/env python3
"""Build the verified INDIRE PNRR external-assignments snapshot."""

from __future__ import annotations

import argparse
import hashlib
import io
import json
import re
import urllib.request
import zipfile
from collections import Counter, defaultdict
from datetime import date, datetime, timedelta
from decimal import Decimal, ROUND_HALF_UP
from pathlib import Path
from xml.etree import ElementTree as ET


LANDING_URL = "https://www.indire.it/amministrazione/titolari-di-incarichi-di-collaborazione-o-consulenza/"
RESOURCE_URL = "https://www.indire.it/wp-content/uploads/2026/05/Elenco-incarichi-di-prestazione-dopera_aprile-2026-3-1-1.xlsx"
SOURCE_OWNER = "Istituto Nazionale di Documentazione, Innovazione e Ricerca Educativa (INDIRE)"
REFERENCE_PERIOD = "aggiornamento aprile 2026"
EXPECTED_BYTES = 54_421
EXPECTED_SHA256 = "d31dadc85a79b2b913608845202e146d0114469abeafe98a6d491d75f7f77a66"
EXPECTED_DIMENSION = "A1:L205"
EXPECTED_HEADERS = (
    "Cognome",
    "Nome",
    "Oggetto dell'incarico",
    "Data inizio",
    "Data fine",
    "Compenso annuo (netto dipendente)",
    "Sede",
    "Selezione",
    "Curriculum\nvitae dell'incaricato Art.15, c.1, lettera b) D.Lgs.33/201 3",
    "Art.15, c.1, lettera c) D.Lgs.33/2013 e Art.1, c.50 L.190/12",
    "Attestazione ai sensi dell’art. 53, c.14, D.Lgs 165/01",
    "Decreto conferimento",
)
EXPECTED_WORKBOOK_ASSIGNMENTS = 201
EXPECTED_PNRR_ASSIGNMENTS = 88
EXPECTED_TOTAL_CENTS = 597_807_504
EXPECTED_END_DATE = "2026-04-30"
PROGRAM_LABELS = {
    "m4c1-i3-1": "M4C1 · Investimento 3.1 · Nuove competenze e nuovi linguaggi",
    "m4c1-r2-1": "M4C1 · Riforma 2.1 · Formazione alla transizione digitale",
}
NS = {"x": "http://schemas.openxmlformats.org/spreadsheetml/2006/main"}
OUTPUT_PATH = Path(__file__).resolve().parents[2] / "src/data/generated/indire-pnrr-assignments.json"


def fetch() -> bytes:
    request = urllib.request.Request(
        RESOURCE_URL,
        headers={"User-Agent": "DoveVannoINostriSoldi/0.2 source-verifier"},
    )
    with urllib.request.urlopen(request, timeout=90) as response:
        if response.status != 200:
            raise ValueError(f"HTTP inatteso {response.status}")
        return response.read()


def column_index(reference: str) -> int:
    match = re.match(r"[A-Z]+", reference)
    if not match:
        raise ValueError(f"Riferimento cella non valido: {reference}")
    result = 0
    for char in match.group(0):
        result = result * 26 + ord(char) - 64
    return result - 1


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


def parse_xlsx(payload: bytes) -> dict[int, list[str | Decimal | None]]:
    if not payload.startswith(b"PK"):
        raise ValueError("La fonte INDIRE non è un archivio XLSX")
    with zipfile.ZipFile(io.BytesIO(payload)) as archive:
        strings = shared_strings(archive)
        worksheet = ET.fromstring(archive.read("xl/worksheets/sheet1.xml"))
        dimension = worksheet.find("x:dimension", NS)
        if dimension is None or dimension.attrib.get("ref") != EXPECTED_DIMENSION:
            raise ValueError("Dimensione del foglio INDIRE inattesa")
        rows: dict[int, list[str | Decimal | None]] = {}
        for row in worksheet.findall(".//x:sheetData/x:row", NS):
            row_number = int(row.attrib["r"])
            values: list[str | Decimal | None] = [None] * len(EXPECTED_HEADERS)
            for cell in row.findall("x:c", NS):
                index = column_index(cell.attrib["r"])
                if index < len(values):
                    values[index] = cell_value(cell, strings)
            rows[row_number] = values
    headers = tuple(str(value or "").strip() for value in rows.get(4, []))
    if headers != EXPECTED_HEADERS:
        raise ValueError("Schema INDIRE inatteso: intestazioni cambiate")
    return rows


def excel_date(value: object) -> str:
    if not isinstance(value, Decimal):
        raise ValueError(f"Data Excel non numerica: {value!r}")
    converted = date(1899, 12, 30) + timedelta(days=int(value))
    return converted.isoformat()


def compensation_cents(value: object) -> int:
    if not isinstance(value, str):
        raise ValueError(f"Compenso PNRR non testuale: {value!r}")
    match = re.fullmatch(
        r"€\s*([0-9.]+,[0-9]{2})\s+per l'intera durata contrattuale",
        value.strip(),
    )
    if not match:
        raise ValueError(f"Base del compenso PNRR inattesa: {value!r}")
    amount = Decimal(match.group(1).replace(".", "").replace(",", "."))
    return int((amount * 100).quantize(Decimal("1"), rounding=ROUND_HALF_UP))


def program_for(subject: str) -> tuple[str, str]:
    if "ERASMUS+" in subject.upper():
        return (
            "m4c1-i3-1",
            PROGRAM_LABELS["m4c1-i3-1"],
        )
    if "RIFORMA 2.1" in subject.upper():
        return (
            "m4c1-r2-1",
            PROGRAM_LABELS["m4c1-r2-1"],
        )
    raise ValueError("Oggetto PNRR fuori dai due programmi attesi")


def stable_id(parts: list[str]) -> str:
    digest = hashlib.sha256("|".join(parts).encode("utf-8")).hexdigest()[:16]
    return f"indire-pnrr-{digest}"


def canonical_bytes(value: object) -> bytes:
    return (json.dumps(value, ensure_ascii=False, indent=2, sort_keys=True) + "\n").encode()


def build_snapshot(payload: bytes, acquired_at: str) -> dict:
    asset_hash = hashlib.sha256(payload).hexdigest()
    if len(payload) != EXPECTED_BYTES or asset_hash != EXPECTED_SHA256:
        raise ValueError("Asset INDIRE diverso dalla versione ufficiale verificata")

    rows = parse_xlsx(payload)
    workbook_assignments = sum(
        any(value is not None for value in rows.get(row_number, []))
        for row_number in range(5, 206)
    )
    assignments = []
    last_name = first_name = None
    for row_number in range(5, 206):
        row = rows.get(row_number, [None] * len(EXPECTED_HEADERS))
        if row[0] is not None:
            last_name = str(row[0]).strip()
        if row[1] is not None:
            first_name = str(row[1]).strip()
        subject = str(row[2] or "").strip()
        if "PNRR" not in subject.upper():
            continue
        if not last_name or not first_name:
            raise ValueError(f"Nominativo mancante alla riga {row_number}")
        start_date = excel_date(row[3])
        end_date = excel_date(row[4])
        amount_cents = compensation_cents(row[5])
        program_id, program_label = program_for(subject)
        selection = str(row[7] or "").strip()
        decree = str(row[11] or "").strip()
        if not selection or not decree:
            raise ValueError(f"Selezione o decreto mancanti alla riga {row_number}")
        assignment_id = stable_id(
            [last_name, first_name, program_id, start_date, end_date, selection, decree]
        )
        assignments.append(
            {
                "compensation": {
                    "basis": "contract_total",
                    "valueCents": amount_cents,
                },
                "conflictCheckPublished": bool(str(row[10] or "").strip()),
                "cvPublished": str(row[8] or "").strip().upper() == "CV",
                "decree": decree,
                "endDate": end_date,
                "firstName": first_name,
                "id": assignment_id,
                "lastName": last_name,
                "location": str(row[6]).strip() if row[6] is not None else None,
                "programId": program_id,
                "programLabel": program_label,
                "selection": selection,
                "sourceRow": row_number,
                "startDate": start_date,
            }
        )

    program_totals: dict[tuple[str, str], dict[str, int]] = defaultdict(
        lambda: {"assignments": 0, "compensationCents": 0}
    )
    for assignment in assignments:
        key = (assignment["programId"], assignment["programLabel"])
        program_totals[key]["assignments"] += 1
        program_totals[key]["compensationCents"] += assignment["compensation"]["valueCents"]

    amount_counts = Counter(item["compensation"]["valueCents"] for item in assignments)
    selection_counts = Counter(item["selection"] for item in assignments)
    total_cents = sum(item["compensation"]["valueCents"] for item in assignments)
    snapshot = {
        "assignments": assignments,
        "coverage": {
            "compensationKnown": len(assignments),
            "latestEndDate": max(item["endDate"] for item in assignments),
            "pnrrAssignments": len(assignments),
            "uniquePeople": len({(item["lastName"], item["firstName"]) for item in assignments}),
            "workbookAssignments": workbook_assignments,
        },
        "dataset": "indire_pnrr_external_assignments",
        "generatedAt": acquired_at,
        "methodology": {
            "compensation": "Ogni importo è indicato dalla fonte per l'intera durata contrattuale; non è un compenso annuo.",
            "filter": "Righe il cui oggetto contiene il riferimento esplicito al PNRR.",
            "scope": "Incarichi retribuiti di prestazione d'opera professionale conferiti a soggetti esterni da INDIRE.",
            "warning": "Lo snapshot descrive gli incarichi elencati nell'aggiornamento di aprile 2026; non misura pagamenti effettuati né prova sprechi o irregolarità.",
        },
        "programs": [
            {"id": key[0], "label": key[1], **value}
            for key, value in sorted(program_totals.items())
        ],
        "schemaVersion": 1,
        "selections": [
            {"assignments": count, "code": code}
            for code, count in sorted(selection_counts.items())
        ],
        "source": {
            "asset": {
                "bytes": len(payload),
                "dimension": EXPECTED_DIMENSION,
                "sha256": asset_hash,
                "sheet": "Table 1",
            },
            "format": "XLSX",
            "landingUrl": LANDING_URL,
            "licenseStatus": "not-declared",
            "owner": SOURCE_OWNER,
            "referencePeriod": REFERENCE_PERIOD,
            "resourceUrl": RESOURCE_URL,
        },
        "tiers": [
            {
                "assignments": count,
                "compensationCents": amount,
                "totalCents": amount * count,
            }
            for amount, count in sorted(amount_counts.items(), reverse=True)
        ],
        "totals": {"contractCompensationCents": total_cents},
    }
    validate_snapshot(snapshot)
    return snapshot


def validate_snapshot(snapshot: dict) -> None:
    if snapshot.get("schemaVersion") != 1 or snapshot.get("dataset") != "indire_pnrr_external_assignments":
        raise ValueError("Identità snapshot INDIRE inattesa")
    source = snapshot.get("source", {})
    asset = source.get("asset", {})
    if (
        source.get("owner") != SOURCE_OWNER
        or source.get("landingUrl") != LANDING_URL
        or source.get("resourceUrl") != RESOURCE_URL
        or source.get("referencePeriod") != REFERENCE_PERIOD
        or source.get("format") != "XLSX"
        or source.get("licenseStatus") != "not-declared"
        or asset.get("bytes") != EXPECTED_BYTES
        or asset.get("sha256") != EXPECTED_SHA256
        or asset.get("sheet") != "Table 1"
        or asset.get("dimension") != EXPECTED_DIMENSION
    ):
        raise ValueError("Provenienza snapshot INDIRE inattesa")
    assignments = snapshot.get("assignments", [])
    coverage = snapshot.get("coverage", {})
    if (
        len(assignments) != EXPECTED_PNRR_ASSIGNMENTS
        or coverage.get("pnrrAssignments") != EXPECTED_PNRR_ASSIGNMENTS
        or coverage.get("uniquePeople") != EXPECTED_PNRR_ASSIGNMENTS
        or coverage.get("compensationKnown") != EXPECTED_PNRR_ASSIGNMENTS
        or coverage.get("workbookAssignments") != EXPECTED_WORKBOOK_ASSIGNMENTS
        or coverage.get("latestEndDate") != EXPECTED_END_DATE
    ):
        raise ValueError("Copertura snapshot INDIRE inattesa")
    if len({item["id"] for item in assignments}) != len(assignments):
        raise ValueError("Identificatori incarico INDIRE duplicati")
    if len({(item["lastName"], item["firstName"]) for item in assignments}) != len(assignments):
        raise ValueError("Nominativi incarico INDIRE duplicati")
    for item in assignments:
        if (
            not re.fullmatch(r"indire-pnrr-[a-f0-9]{16}", item["id"])
            or not 5 <= item["sourceRow"] <= 205
            or item["compensation"]["basis"] != "contract_total"
            or item["compensation"]["valueCents"] <= 0
            or item["programLabel"] != PROGRAM_LABELS.get(item["programId"])
            or item["endDate"] < item["startDate"]
            or not item["cvPublished"]
            or not item["conflictCheckPublished"]
        ):
            raise ValueError("Dettaglio incarico INDIRE inatteso")
    total = sum(item["compensation"]["valueCents"] for item in assignments)
    if total != EXPECTED_TOTAL_CENTS or snapshot.get("totals", {}).get("contractCompensationCents") != total:
        raise ValueError("Totale compensi INDIRE non riconciliato")
    expected_programs = defaultdict(lambda: {"assignments": 0, "compensationCents": 0})
    for item in assignments:
        expected_programs[item["programId"]]["assignments"] += 1
        expected_programs[item["programId"]]["compensationCents"] += item["compensation"]["valueCents"]
    actual_programs = {
        item["id"]: {
            "assignments": item["assignments"],
            "compensationCents": item["compensationCents"],
        }
        for item in snapshot.get("programs", [])
        if item.get("label") == PROGRAM_LABELS.get(item.get("id"))
    }
    if actual_programs != dict(expected_programs):
        raise ValueError("Programmi INDIRE non riconciliati")
    if sum(item["compensationCents"] for item in snapshot.get("programs", [])) != total:
        raise ValueError("Compensi per programma INDIRE non riconciliati")
    expected_tiers = Counter(item["compensation"]["valueCents"] for item in assignments)
    actual_tiers = {
        item["compensationCents"]: item["assignments"]
        for item in snapshot.get("tiers", [])
        if item.get("totalCents") == item.get("compensationCents", 0) * item.get("assignments", 0)
    }
    if actual_tiers != dict(expected_tiers):
        raise ValueError("Fasce compenso INDIRE non riconciliate")
    if sum(item["totalCents"] for item in snapshot.get("tiers", [])) != total:
        raise ValueError("Totali per fascia INDIRE non riconciliati")
    expected_selections = Counter(item["selection"] for item in assignments)
    actual_selections = {
        item["code"]: item["assignments"] for item in snapshot.get("selections", [])
    }
    if actual_selections != dict(expected_selections):
        raise ValueError("Selezioni INDIRE non riconciliate")


def parse_args() -> argparse.Namespace:
    parser = argparse.ArgumentParser()
    parser.add_argument("--input-xlsx", type=Path)
    parser.add_argument("--output", type=Path, default=OUTPUT_PATH)
    parser.add_argument("--acquired-at", default=datetime.now().date().isoformat())
    parser.add_argument("--validate-committed", action="store_true")
    return parser.parse_args()


def main() -> None:
    args = parse_args()
    if args.validate_committed:
        validate_snapshot(json.loads(OUTPUT_PATH.read_text(encoding="utf-8")))
        return
    payload = args.input_xlsx.read_bytes() if args.input_xlsx else fetch()
    snapshot = build_snapshot(payload, args.acquired_at)
    args.output.parent.mkdir(parents=True, exist_ok=True)
    args.output.write_bytes(canonical_bytes(snapshot))


if __name__ == "__main__":
    main()
