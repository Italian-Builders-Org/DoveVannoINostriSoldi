#!/usr/bin/env python3
"""Build the 2024 ISTAT enterprise turnover snapshot (Frame Territoriale Anticipato)."""

from __future__ import annotations

import argparse
import hashlib
import io
import json
import re
import ssl
import urllib.request
import zipfile
from pathlib import Path
from xml.etree import ElementTree as ET

ROOT = Path(__file__).resolve().parents[2]
OUTPUT_PATH = ROOT / "src/data/generated/istat-enterprise-turnover-2024.json"

LANDING_URL = (
    "https://www.istat.it/tavole-di-dati/stima-anticipata-dei-dati-economici-delle-imprese-a-livello"
    "-territoriale-il-registro-frame-territoriale-anticipato-anno-2024/"
)
RESOURCE_URL = "https://www.istat.it/wp-content/uploads/2026/03/Tavole20marzo2026.zip"
RESOURCE_BYTES = 393392
RESOURCE_SHA256 = "d774bcd5862467aa0a7529b8b972f3fd80f85f14f7993aaf355362596960ad04"
LICENSE = "CC BY 4.0"
LICENSE_URL = "https://www.istat.it/dati/open-data/"
ATECO_VERSION = "ATECO 2007 agg. 2022"
PERIOD = "2024"
UNIT = "migliaia di euro"
UPDATED_AT = "2026-03-20"

TAVOLA_1_FILE = "Tavole/Tavola_1_Terr_Anti_2024.xlsx"
TAVOLA_2_FILE = "Tavole/Tavola_2_Terr_Anti_2024.xlsx"

REGION_NAME_TO_CODE = {
    "Piemonte": "01",
    "Valle d'Aosta/Vallée d'Aoste": "02",
    "Lombardia": "03",
    "Trentino-Alto Adige/Südtirol": "04",
    "Veneto": "05",
    "Friuli-Venezia Giulia": "06",
    "Liguria": "07",
    "Emilia-Romagna": "08",
    "Toscana": "09",
    "Umbria": "10",
    "Marche": "11",
    "Lazio": "12",
    "Abruzzo": "13",
    "Molise": "14",
    "Campania": "15",
    "Puglia": "16",
    "Basilicata": "17",
    "Calabria": "18",
    "Sicilia": "19",
    "Sardegna": "20",
}

REGION_CANONICAL_NAMES = {
    "01": "Piemonte",
    "02": "Valle d'Aosta",
    "03": "Lombardia",
    "04": "Trentino-Alto Adige",
    "05": "Veneto",
    "06": "Friuli-Venezia Giulia",
    "07": "Liguria",
    "08": "Emilia-Romagna",
    "09": "Toscana",
    "10": "Umbria",
    "11": "Marche",
    "12": "Lazio",
    "13": "Abruzzo",
    "14": "Molise",
    "15": "Campania",
    "16": "Puglia",
    "17": "Basilicata",
    "18": "Calabria",
    "19": "Sicilia",
    "20": "Sardegna",
}

EXPECTED_REGION_CODES = sorted(REGION_CANONICAL_NAMES.keys())

MACRO_SECTORS = [
    {"code": "ALL", "label": "Tutti i settori (Industria e Servizi)"},
    {"code": "INDUSTRIA", "label": "Industria"},
    {"code": "SERVIZI", "label": "Servizi"},
]

NS = {"x": "http://schemas.openxmlformats.org/spreadsheetml/2006/main"}


def column_index(reference: str) -> int:
    letters = re.match(r"[A-Z]+", reference)
    if not letters:
        raise ValueError(f"Riferimento cella non valido: {reference}")
    result = 0
    for char in letters.group(0):
        result = result * 26 + ord(char) - 64
    return result - 1


def shared_strings(archive: zipfile.ZipFile) -> list[str]:
    try:
        root = ET.fromstring(archive.read("xl/sharedStrings.xml"))
    except KeyError:
        return []
    return ["".join(item.itertext()) for item in root.findall("x:si", NS)]


def cell_value(cell: ET.Element, strings: list[str]) -> str | None:
    cell_type = cell.attrib.get("t")
    value_node = cell.find("x:v", NS)
    if cell_type == "inlineStr":
        inline = cell.find("x:is", NS)
        return "".join(inline.itertext()) if inline is not None else None
    if value_node is None or value_node.text is None:
        return None
    raw = value_node.text
    if cell_type == "s":
        return strings[int(raw)]
    if cell_type in {"str", "e"}:
        return raw
    if cell_type == "b":
        return "1" if raw == "1" else "0"
    return raw


def parse_sheet_rows(archive: zipfile.ZipFile, sheet_path: str, strings: list[str]) -> list[list[str | None]]:
    worksheet = ET.fromstring(archive.read(sheet_path))
    rows: list[list[str | None]] = []
    for row in worksheet.findall(".//x:sheetData/x:row", NS):
        max_idx = 0
        cells: dict[int, str | None] = {}
        for cell in row.findall("x:c", NS):
            idx = column_index(cell.attrib["r"])
            val = cell_value(cell, strings)
            cells[idx] = val
            if idx > max_idx:
                max_idx = idx
        row_vals = [cells.get(i) for i in range(max_idx + 1)]
        rows.append(row_vals)
    return rows


def parse_int(value: str | None, label: str) -> int:
    if value is None or not str(value).strip():
        raise ValueError(f"Valore intero mancante per {label}")
    try:
        parsed = float(str(value).strip())
    except (TypeError, ValueError, OverflowError) as error:
        raise ValueError(f"Impossibile convertire '{value}' in intero per {label}") from error
    if not parsed.is_integer():
        raise ValueError(f"Valore non intero '{value}' per {label}")
    return int(parsed)


def parse_float(value: str | None, label: str) -> float:
    if value is None or not str(value).strip():
        raise ValueError(f"Valore decimale mancante per {label}")
    try:
        return round(float(str(value).strip()), 2)
    except Exception as error:
        raise ValueError(f"Impossibile convertire '{value}' in decimale per {label}") from error


def fetch() -> bytes:
    request = urllib.request.Request(
        RESOURCE_URL,
        headers={"User-Agent": "DoveVannoINostriSoldi/0.2 source-verifier"},
    )
    context = ssl.create_default_context()
    with urllib.request.urlopen(request, context=context, timeout=90) as response:
        if response.status != 200:
            raise ValueError(f"HTTP inatteso {response.status}")
        return response.read()


def sha256_bytes(payload: bytes) -> str:
    return hashlib.sha256(payload).hexdigest()


def build_snapshot(payload: bytes, observed_at: str | None = None) -> dict:
    if observed_at is None:
        observed_at = "2026-08-26T00:00:00+02:00"

    if not payload.startswith(b"PK"):
        raise ValueError("L'archivio ISTAT non è un file ZIP valido")
    if len(payload) != RESOURCE_BYTES or sha256_bytes(payload) != RESOURCE_SHA256:
        raise ValueError("L'archivio ISTAT non coincide con l'archivio ufficiale verificato (bytes/SHA-256)")

    with zipfile.ZipFile(io.BytesIO(payload)) as outer_zip:
        namelist = outer_zip.namelist()
        if TAVOLA_1_FILE not in namelist or TAVOLA_2_FILE not in namelist:
            raise ValueError(f"File attesi ({TAVOLA_1_FILE}, {TAVOLA_2_FILE}) non trovati nell'archivio")

        t1_bytes = outer_zip.read(TAVOLA_1_FILE)
        t2_bytes = outer_zip.read(TAVOLA_2_FILE)

    with zipfile.ZipFile(io.BytesIO(t1_bytes)) as z1:
        t1_rows = parse_sheet_rows(z1, "xl/worksheets/sheet1.xml", shared_strings(z1))

    with zipfile.ZipFile(io.BytesIO(t2_bytes)) as z2:
        t2_rows = parse_sheet_rows(z2, "xl/worksheets/sheet1.xml", shared_strings(z2))

    t1_by_source_name: dict[str, list[str | None]] = {}
    for row in t1_rows[2:]:
        if row and row[0] and str(row[0]).strip():
            name = str(row[0]).strip()
            t1_by_source_name[name] = row

    t2_by_source_name: dict[str, list[str | None]] = {}
    for row in t2_rows[5:]:
        if row and row[0] and str(row[0]).strip():
            name = str(row[0]).strip()
            if not name.startswith("Note"):
                t2_by_source_name[name] = row

    observations = []
    for source_name, region_code in sorted(REGION_NAME_TO_CODE.items(), key=lambda item: item[1]):
        r1 = t1_by_source_name.get(source_name)
        r2 = t2_by_source_name.get(source_name)
        if not r1 or not r2:
            raise ValueError(f"Dati mancanti per la regione {source_name}")

        canonical_name = REGION_CANONICAL_NAMES[region_code]

        # Tavola 1: Totale (ALL)
        local_units_tot = parse_int(r1[1], f"{source_name} local_units")
        employees_tot = parse_float(r1[2], f"{source_name} employees")
        payroll_employees_tot = parse_float(r1[3], f"{source_name} payroll_employees")
        labor_cost_tot = parse_int(r1[4], f"{source_name} labor_cost")
        value_added_tot = parse_int(r1[5], f"{source_name} value_added")
        turnover_tot = parse_int(r1[6], f"{source_name} turnover")
        purchases_tot = parse_int(r1[7], f"{source_name} purchases")

        observations.append({
            "observationType": "aggregate",
            "geographyLevel": "region",
            "geographyCode": region_code,
            "geographyName": canonical_name,
            "macroSector": "ALL",
            "macroSectorLabel": "Tutti i settori (Industria e Servizi)",
            "atecoVersion": ATECO_VERSION,
            "metric": "turnover",
            "period": PERIOD,
            "unit": UNIT,
            "value": turnover_tot,
            "localUnits": local_units_tot,
            "employees": employees_tot,
            "payrollEmployees": payroll_employees_tot,
            "laborCostThousandEuro": labor_cost_tot,
            "valueAddedThousandEuro": value_added_tot,
            "purchasesThousandEuro": purchases_tot,
            "sourceId": "istat-frame-territoriale-2024",
        })

        # Tavola 2: Industria
        local_units_ind = parse_int(r2[1], f"{source_name} ind local_units")
        employees_ind = parse_float(r2[2], f"{source_name} ind employees")
        payroll_employees_ind = parse_float(r2[3], f"{source_name} ind payroll_employees")
        labor_cost_ind = parse_int(r2[4], f"{source_name} ind labor_cost")
        value_added_ind = parse_int(r2[5], f"{source_name} ind value_added")
        turnover_ind = parse_int(r2[6], f"{source_name} ind turnover")
        purchases_ind = parse_int(r2[7], f"{source_name} ind purchases")

        observations.append({
            "observationType": "aggregate",
            "geographyLevel": "region",
            "geographyCode": region_code,
            "geographyName": canonical_name,
            "macroSector": "INDUSTRIA",
            "macroSectorLabel": "Industria",
            "atecoVersion": ATECO_VERSION,
            "metric": "turnover",
            "period": PERIOD,
            "unit": UNIT,
            "value": turnover_ind,
            "localUnits": local_units_ind,
            "employees": employees_ind,
            "payrollEmployees": payroll_employees_ind,
            "laborCostThousandEuro": labor_cost_ind,
            "valueAddedThousandEuro": value_added_ind,
            "purchasesThousandEuro": purchases_ind,
            "sourceId": "istat-frame-territoriale-2024",
        })

        # Tavola 2: Servizi
        local_units_ser = parse_int(r2[14], f"{source_name} ser local_units")
        employees_ser = parse_float(r2[15], f"{source_name} ser employees")
        payroll_employees_ser = parse_float(r2[16], f"{source_name} ser payroll_employees")
        labor_cost_ser = parse_int(r2[17], f"{source_name} ser labor_cost")
        value_added_ser = parse_int(r2[18], f"{source_name} ser value_added")
        turnover_ser = parse_int(r2[19], f"{source_name} ser turnover")
        purchases_ser = parse_int(r2[20], f"{source_name} ser purchases")

        observations.append({
            "observationType": "aggregate",
            "geographyLevel": "region",
            "geographyCode": region_code,
            "geographyName": canonical_name,
            "macroSector": "SERVIZI",
            "macroSectorLabel": "Servizi",
            "atecoVersion": ATECO_VERSION,
            "metric": "turnover",
            "period": PERIOD,
            "unit": UNIT,
            "value": turnover_ser,
            "localUnits": local_units_ser,
            "employees": employees_ser,
            "payrollEmployees": payroll_employees_ser,
            "laborCostThousandEuro": labor_cost_ser,
            "valueAddedThousandEuro": value_added_ser,
            "purchasesThousandEuro": purchases_ser,
            "sourceId": "istat-frame-territoriale-2024",
        })

    # National totals from official row "ITALIA"
    r1_italia = t1_by_source_name["ITALIA"]
    r2_italia = t2_by_source_name["ITALIA"]

    national_turnover = parse_int(r1_italia[6], "ITALIA turnover")
    national_ind_turnover = parse_int(r2_italia[6], "ITALIA ind turnover")
    national_ser_turnover = parse_int(r2_italia[19], "ITALIA ser turnover")

    snapshot = {
        "schemaVersion": 1,
        "generatedAt": observed_at,
        "observationType": "aggregate",
        "geographyLevel": "region",
        "geographyVersion": "regioni ISTAT 2024",
        "atecoVersion": ATECO_VERSION,
        "period": PERIOD,
        "unit": UNIT,
        "source": {
            "id": "istat-frame-territoriale-2024",
            "label": "Stima anticipata dei dati economici delle imprese · Frame Territoriale 2024",
            "publisher": "Istituto Nazionale di Statistica (ISTAT)",
            "url": RESOURCE_URL,
            "archive": {"bytes": RESOURCE_BYTES, "sha256": RESOURCE_SHA256},
            "landingUrl": LANDING_URL,
            "license": LICENSE,
            "licenseUrl": LICENSE_URL,
            "updatedAt": UPDATED_AT,
            "observedAt": observed_at,
            "cadence": "annuale",
            "coverage": (
                "Unità locali di imprese con almeno un dipendente (Registro Frame Territoriale Anticipato 2024); "
                "non è l'universo completo delle sedi attive."
            ),
            "caveat": (
                "I dati si riferiscono alle unità locali di imprese con almeno un dipendente (Registro Frame "
                "Territoriale Anticipato 2024) e non all'universo completo delle sedi attive. Il fatturato è "
                "espresso in migliaia di euro e classificato in ATECO 2007 aggiornamento 2022. I dati sono aggregati "
                "per territorio e non identificano singole aziende o persone fisiche. Le tavole del totale e dei "
                "macro-settori sono pubblicate separatamente: differenze di pochi migliaia di euro tra somme e totale "
                "sono mantenute e possono riflettere gli arrotondamenti della fonte."
            ),
        },
        "macroSectors": MACRO_SECTORS,
        "regions": [{"code": code, "name": REGION_CANONICAL_NAMES[code]} for code in EXPECTED_REGION_CODES],
        "national": {
            "turnoverThousandEuro": national_turnover,
            "industryTurnoverThousandEuro": national_ind_turnover,
            "servicesTurnoverThousandEuro": national_ser_turnover,
            "localUnits": parse_int(r1_italia[1], "ITALIA local_units"),
            "industryLocalUnits": parse_int(r2_italia[1], "ITALIA ind local_units"),
            "servicesLocalUnits": parse_int(r2_italia[14], "ITALIA ser local_units"),
            "employees": parse_float(r1_italia[2], "ITALIA employees"),
            "industryEmployees": parse_float(r2_italia[2], "ITALIA ind employees"),
            "servicesEmployees": parse_float(r2_italia[15], "ITALIA ser employees"),
            "valueAddedThousandEuro": parse_int(r1_italia[5], "ITALIA value_added"),
            "industryValueAddedThousandEuro": parse_int(r2_italia[5], "ITALIA ind value_added"),
            "servicesValueAddedThousandEuro": parse_int(r2_italia[18], "ITALIA ser value_added"),
            "laborCostThousandEuro": parse_int(r1_italia[4], "ITALIA labor_cost"),
            "industryLaborCostThousandEuro": parse_int(r2_italia[4], "ITALIA ind labor_cost"),
            "servicesLaborCostThousandEuro": parse_int(r2_italia[17], "ITALIA ser labor_cost"),
            "purchasesThousandEuro": parse_int(r1_italia[7], "ITALIA purchases"),
            "industryPurchasesThousandEuro": parse_int(r2_italia[7], "ITALIA ind purchases"),
            "servicesPurchasesThousandEuro": parse_int(r2_italia[20], "ITALIA ser purchases"),
        },
        "observations": observations,
        "coverage": {
            "regionCount": len(EXPECTED_REGION_CODES),
            "macroSectorCount": len(MACRO_SECTORS),
            "totalObservations": len(observations),
            "nullValues": 0,
            "nationalTurnoverThousandEuro": national_turnover,
            "campaniaTurnoverThousandEuro": next(
                obs["value"] for obs in observations if obs["geographyCode"] == "15" and obs["macroSector"] == "ALL"
            ),
        },
    }

    validate_snapshot(snapshot)
    return snapshot


def validate_snapshot(snapshot: dict) -> None:
    if snapshot.get("schemaVersion") != 1:
        raise ValueError("schemaVersion non supportata")
    if snapshot.get("observationType") != "aggregate":
        raise ValueError("observationType deve essere 'aggregate'")
    if snapshot.get("geographyLevel") != "region":
        raise ValueError("geographyLevel deve essere 'region'")
    if snapshot.get("atecoVersion") != ATECO_VERSION:
        raise ValueError(f"atecoVersion atteso '{ATECO_VERSION}', ricevuto '{snapshot.get('atecoVersion')}'")
    if snapshot.get("period") != PERIOD:
        raise ValueError(f"period atteso '{PERIOD}', ricevuto '{snapshot.get('period')}'")
    if snapshot.get("unit") != UNIT:
        raise ValueError(f"unit attesa '{UNIT}', ricevuta '{snapshot.get('unit')}'")

    source = snapshot.get("source", {})
    if source.get("license") != LICENSE:
        raise ValueError("Licenza fonte inattesa")
    if source.get("id") != "istat-frame-territoriale-2024":
        raise ValueError("Identificativo fonte inatteso")
    if source.get("archive") != {"bytes": RESOURCE_BYTES, "sha256": RESOURCE_SHA256}:
        raise ValueError("Provenienza archivio ISTAT inattesa (bytes/SHA-256)")

    regions = snapshot.get("regions", [])
    if len(regions) != 20:
        raise ValueError(f"Attese 20 regioni, trovate {len(regions)}")
    region_codes = [r["code"] for r in regions]
    if sorted(region_codes) != EXPECTED_REGION_CODES:
        raise ValueError("Codici regionali non corrispondenti alle 20 regioni ISTAT")

    observations = snapshot.get("observations", [])
    expected_count = 20 * len(MACRO_SECTORS)
    if len(observations) != expected_count:
        raise ValueError(f"Attese {expected_count} osservazioni, trovate {len(observations)}")

    rows_by_key: dict[str, dict] = {}
    for index, obs in enumerate(observations):
        if obs["observationType"] != "aggregate" or obs["geographyLevel"] != "region":
            raise ValueError(f"Osservazione non aggregata regionale all'indice {index}")
        if obs["geographyCode"] not in EXPECTED_REGION_CODES:
            raise ValueError(f"Codice regione non valido all'indice {index}: {obs['geographyCode']}")
        if obs["macroSector"] not in {"ALL", "INDUSTRIA", "SERVIZI"}:
            raise ValueError(f"Macro-settore non valido all'indice {index}: {obs['macroSector']}")
        if obs["metric"] != "turnover":
            raise ValueError(f"Metrica non valida all'indice {index}: {obs['metric']}")
        if obs["value"] is None or obs["value"] < 0:
            raise ValueError(f"Valore nullo o negativo all'indice {index}: {obs['value']}")
        for field in ("localUnits", "employees", "valueAddedThousandEuro"):
            if field not in obs or obs[field] is None:
                raise ValueError(f"Campo {field} mancante all'indice {index}")
        if obs["localUnits"] < 0 or obs["valueAddedThousandEuro"] < 0:
            raise ValueError(f"Metrica economica negativa all'indice {index}")
        if obs["employees"] <= 0:
            raise ValueError(f"Addetti non positivi all'indice {index}")
        if obs["atecoVersion"] != ATECO_VERSION:
            raise ValueError(f"Versione ATECO non coerente all'indice {index}")

        key = f"{obs['geographyCode']}|{obs['macroSector']}"
        if key in rows_by_key:
            raise ValueError(f"Osservazione duplicata per {key}")
        rows_by_key[key] = obs

    def reconcile(label: str, total: float, industry: float, services: float, tolerance: float) -> None:
        delta = total - industry - services
        if abs(delta) > tolerance:
            raise ValueError(f"{label} non riconcilia: totale meno Industria e Servizi = {delta}")

    for region_code in EXPECTED_REGION_CODES:
        total = rows_by_key[f"{region_code}|ALL"]
        industry = rows_by_key[f"{region_code}|INDUSTRIA"]
        services = rows_by_key[f"{region_code}|SERVIZI"]
        reconcile(f"{region_code} fatturato", total["value"], industry["value"], services["value"], 1)
        reconcile(
            f"{region_code} unità locali",
            total["localUnits"],
            industry["localUnits"],
            services["localUnits"],
            0,
        )
        reconcile(
            f"{region_code} addetti",
            total["employees"],
            industry["employees"],
            services["employees"],
            0.000001,
        )
        reconcile(
            f"{region_code} valore aggiunto",
            total["valueAddedThousandEuro"],
            industry["valueAddedThousandEuro"],
            services["valueAddedThousandEuro"],
            1,
        )

    # Parity check: Campania row from Table 1 must be exactly 216750478
    campania_all = next((obs for obs in observations if obs["geographyCode"] == "15" and obs["macroSector"] == "ALL"), None)
    if not campania_all or campania_all["value"] != 216_750_478:
        raise ValueError(f"Valore Campania inatteso: atteso 216750478, ricevuto {campania_all['value'] if campania_all else None}")

    campania_ind = next((obs for obs in observations if obs["geographyCode"] == "15" and obs["macroSector"] == "INDUSTRIA"), None)
    campania_ser = next((obs for obs in observations if obs["geographyCode"] == "15" and obs["macroSector"] == "SERVIZI"), None)
    if not campania_ind or not campania_ser or campania_ind["value"] != 78_917_895 or campania_ser["value"] != 137_832_583:
        raise ValueError("Valori disaggregati Campania Industria/Servizi non coincidenti con la fonte ufficiale")

    if campania_ind["value"] + campania_ser["value"] != campania_all["value"]:
        raise ValueError("Somma Industria + Servizi non coincidente con il totale Campania")

    # Check national turnover
    if snapshot["national"]["turnoverThousandEuro"] != 3_768_464_269:
        raise ValueError("Totale nazionale fatturato inatteso")
    national = snapshot["national"]
    reconcile(
        "Unità locali nazionali",
        national["localUnits"],
        national["industryLocalUnits"],
        national["servicesLocalUnits"],
        0,
    )
    reconcile(
        "Addetti nazionali",
        national["employees"],
        national["industryEmployees"],
        national["servicesEmployees"],
        0.000001,
    )
    reconcile(
        "Valore aggiunto nazionale",
        national["valueAddedThousandEuro"],
        national["industryValueAddedThousandEuro"],
        national["servicesValueAddedThousandEuro"],
        0,
    )


def canonical_bytes(value: object) -> bytes:
    return (json.dumps(value, ensure_ascii=False, indent=2, sort_keys=True) + "\n").encode("utf-8")


def main() -> None:
    parser = argparse.ArgumentParser(description="Genera e valida lo snapshot ISTAT del fatturato aggregato 2024.")
    parser.add_argument("--check", action="store_true", help="Valida lo snapshot committato senza rete")
    parser.add_argument("--input-zip", type=Path, help="Percorso del file ZIP locale")
    parser.add_argument("--output", type=Path, default=OUTPUT_PATH, help="Percorso del file JSON di output")
    parser.add_argument("--observed-at", help="Timestamp ISO per l'osservazione")
    args = parser.parse_args()

    if args.check:
        if not args.output.exists():
            raise FileNotFoundError(f"Snapshot non trovato: {args.output}")
        snapshot = json.loads(args.output.read_text(encoding="utf-8"))
        validate_snapshot(snapshot)
        print(f"OK {args.output}: {len(snapshot['observations'])} osservazioni aggregate validate offline")
        return

    payload = args.input_zip.read_bytes() if args.input_zip else fetch()
    snapshot = build_snapshot(payload, observed_at=args.observed_at)
    args.output.parent.mkdir(parents=True, exist_ok=True)
    args.output.write_bytes(canonical_bytes(snapshot))
    print(f"Scritto {args.output}: {len(snapshot['observations'])} osservazioni aggregate generate con successo")


if __name__ == "__main__":
    main()
