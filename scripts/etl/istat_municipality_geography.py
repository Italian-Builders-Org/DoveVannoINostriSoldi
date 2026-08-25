#!/usr/bin/env python3
"""Build the dated ISTAT SITUAS municipality geography snapshot."""

from __future__ import annotations

import argparse
import hashlib
import json
import urllib.parse
import urllib.request
from decimal import Decimal, ROUND_HALF_UP
from pathlib import Path


ROOT = Path(__file__).resolve().parents[2]
DEFAULT_OUTPUT = ROOT / "src/data/generated/istat-municipality-geography.json"
BASE_URL = "https://situas-servizi.istat.it/publish/reportspooljson"
REFERENCE_DATES = {
    2022: "31/12/2022",
    2023: "31/12/2023",
    2024: "31/12/2024",
    2025: "31/12/2025",
    2026: "25/08/2026",
}
COLUMNS = (
    "istatCode",
    "taxCode",
    "regionCode",
    "name",
    "surfaceSquareMetres",
    "residentPopulation",
    "populationYear",
    "altimetricZone",
    "altitudeMetres",
    "coastal",
    "island",
    "degreeUrbanization",
)


class SnapshotError(RuntimeError):
    pass


def endpoint(report_id: int, reference_date: str) -> str:
    return f"{BASE_URL}?{urllib.parse.urlencode({'pfun': report_id, 'pdata': reference_date})}"


def download(url: str) -> bytes:
    request = urllib.request.Request(
        url,
        headers={"User-Agent": "DoveVannoINostriSoldi-ETL/1.0", "Accept": "application/json"},
    )
    with urllib.request.urlopen(request, timeout=120) as response:
        return response.read()


def rows(payload: bytes, label: str) -> list[dict]:
    try:
        value = json.loads(payload)
    except json.JSONDecodeError as error:
        raise SnapshotError(f"{label}: JSON non valido") from error
    result = value.get("resultset") if isinstance(value, dict) else None
    if not isinstance(result, list) or len(result) < 7_800:
        raise SnapshotError(f"{label}: copertura comunale inattesa")
    return result


def optional_integer(value: object, label: str) -> int | None:
    if value is None or value == "":
        return None
    try:
        result = int(value)
    except (TypeError, ValueError) as error:
        raise SnapshotError(f"{label}: intero non valido") from error
    return result


def build_year(year: int, reference_date: str) -> tuple[dict, list[list[object]]]:
    identifiers_url = endpoint(61, reference_date)
    dimension_url = endpoint(74, reference_date)
    characteristics_url = endpoint(73, reference_date)
    identifiers_payload = download(identifiers_url)
    dimension_payload = download(dimension_url)
    characteristics_payload = download(characteristics_url)
    identifier_rows = rows(identifiers_payload, f"identificativi {year}")
    dimension_rows = rows(dimension_payload, f"dimensione {year}")
    characteristics_rows = rows(characteristics_payload, f"caratteristiche {year}")
    identifiers_by_code = {str(row.get("PRO_COM_T", "")): row for row in identifier_rows}
    characteristics_by_code = {str(row.get("PRO_COM_T", "")): row for row in characteristics_rows}
    if len(identifiers_by_code) != len(identifier_rows):
        raise SnapshotError(f"identificativi {year}: codici duplicati")
    if len(characteristics_by_code) != len(characteristics_rows):
        raise SnapshotError(f"caratteristiche {year}: codici duplicati")

    packed: list[list[object]] = []
    missing_characteristics = 0
    invalid_tax_codes = 0
    for row in sorted(dimension_rows, key=lambda item: str(item.get("PRO_COM_T", ""))):
        code = str(row.get("PRO_COM_T", ""))
        if len(code) != 6 or not code.isdigit():
            raise SnapshotError(f"dimensione {year}: codice ISTAT non valido {code!r}")
        area = row.get("AREA_KMQ")
        if area is None:
            raise SnapshotError(f"dimensione {year}: superficie assente per {code}")
        surface_square_metres = int(
            (Decimal(str(area)) * Decimal(1_000_000)).quantize(Decimal("1"), rounding=ROUND_HALF_UP)
        )
        if surface_square_metres <= 0:
            raise SnapshotError(f"dimensione {year}: superficie non positiva per {code}")
        characteristic = characteristics_by_code.get(code)
        if characteristic is None:
            missing_characteristics += 1
            characteristic = {}
        identifier = identifiers_by_code.get(code, {})
        tax_code = str(identifier.get("COD_COM_FISCALE", "")).strip()
        if tax_code and (len(tax_code) != 11 or not tax_code.isdigit()):
            invalid_tax_codes += 1
            tax_code = ""
        packed.append([
            code,
            tax_code or None,
            str(row.get("COD_REG", "")).zfill(2),
            str(row.get("COMUNE", "")).strip(),
            surface_square_metres,
            optional_integer(row.get("POP_RES"), f"{year}/{code}/popolazione"),
            optional_integer(row.get("ANNO_POP_RES"), f"{year}/{code}/anno popolazione"),
            optional_integer(characteristic.get("ZONA_ALT"), f"{year}/{code}/zona altimetrica"),
            optional_integer(characteristic.get("ALT"), f"{year}/{code}/altitudine"),
            characteristic.get("COM_LIT") == "1",
            characteristic.get("COM_ISO") == "1",
            optional_integer(characteristic.get("DEGURBA_2021"), f"{year}/{code}/urbanizzazione"),
        ])

    if missing_characteristics > 5:
        raise SnapshotError(f"{year}: troppe caratteristiche mancanti ({missing_characteristics})")
    if invalid_tax_codes > 5:
        raise SnapshotError(f"{year}: troppi codici fiscali non validi ({invalid_tax_codes})")
    if len({row[0] for row in packed}) != len(packed):
        raise SnapshotError(f"{year}: codici ISTAT duplicati")
    provenance = {
        "identifiers": {
            "reportId": 61,
            "url": identifiers_url,
            "bytes": len(identifiers_payload),
            "sha256": hashlib.sha256(identifiers_payload).hexdigest(),
        },
        "dimension": {
            "reportId": 74,
            "url": dimension_url,
            "bytes": len(dimension_payload),
            "sha256": hashlib.sha256(dimension_payload).hexdigest(),
        },
        "characteristics": {
            "reportId": 73,
            "url": characteristics_url,
            "bytes": len(characteristics_payload),
            "sha256": hashlib.sha256(characteristics_payload).hexdigest(),
        },
    }
    return provenance, packed


def build_snapshot() -> dict:
    years = []
    for year, reference_date in REFERENCE_DATES.items():
        provenance, packed = build_year(year, reference_date)
        years.append({
            "year": year,
            "referenceDate": reference_date,
            "municipalities": len(packed),
            "provenance": provenance,
            "rows": packed,
        })
    return {
        "schemaVersion": 1,
        "datasetId": "istat-municipality-geography",
        "generatedAt": "2026-08-25T00:00:00Z",
        "source": {
            "owner": "Istat",
            "catalogUrl": "https://situas.istat.it/web/#/territorio",
            "methodologyUrl": "https://www.istat.it/classificazione/principali-statistiche-geografiche-sui-comuni/",
            "rightsNote": "Fonte Istat SITUAS; verificare le condizioni di riuso indicate dal titolare.",
        },
        "columns": list(COLUMNS),
        "years": years,
    }


def validate_snapshot(snapshot: object) -> None:
    if not isinstance(snapshot, dict) or snapshot.get("schemaVersion") != 1:
        raise SnapshotError("schemaVersion inattesa")
    if snapshot.get("datasetId") != "istat-municipality-geography":
        raise SnapshotError("dataset inatteso")
    if snapshot.get("columns") != list(COLUMNS):
        raise SnapshotError("colonne inattese")
    years = snapshot.get("years")
    if not isinstance(years, list) or [item.get("year") for item in years] != list(REFERENCE_DATES):
        raise SnapshotError("annualità inattese")
    for item in years:
        year = item["year"]
        packed = item.get("rows")
        if not isinstance(packed, list) or len(packed) != item.get("municipalities") or len(packed) < 7_800:
            raise SnapshotError(f"{year}: copertura inattesa")
        codes: set[str] = set()
        tax_codes: set[str] = set()
        for row in packed:
            if not isinstance(row, list) or len(row) != len(COLUMNS):
                raise SnapshotError(f"{year}: riga non valida")
            code, tax_code, _region, _name, surface, *_rest = row
            if not isinstance(code, str) or len(code) != 6 or not code.isdigit() or code in codes:
                raise SnapshotError(f"{year}: codice ISTAT non valido o duplicato")
            codes.add(code)
            if tax_code is not None:
                if not isinstance(tax_code, str) or len(tax_code) != 11 or not tax_code.isdigit() or tax_code in tax_codes:
                    raise SnapshotError(f"{year}: codice fiscale non valido o duplicato")
                tax_codes.add(tax_code)
            if not isinstance(surface, int) or surface <= 0:
                raise SnapshotError(f"{year}/{code}: superficie non valida")
        provenance = item.get("provenance")
        if not isinstance(provenance, dict):
            raise SnapshotError(f"{year}: provenienza assente")
        for report in ("identifiers", "dimension", "characteristics"):
            source = provenance.get(report)
            if (
                not isinstance(source, dict)
                or not str(source.get("url", "")).startswith(BASE_URL)
                or len(str(source.get("sha256", ""))) != 64
                or not isinstance(source.get("bytes"), int)
                or source["bytes"] <= 0
            ):
                raise SnapshotError(f"{year}: provenienza {report} non valida")


def validate_committed(path: Path = DEFAULT_OUTPUT) -> None:
    try:
        snapshot = json.loads(path.read_text(encoding="utf-8"))
    except (OSError, json.JSONDecodeError) as error:
        raise SnapshotError(f"snapshot non leggibile: {path}") from error
    validate_snapshot(snapshot)


def main() -> None:
    parser = argparse.ArgumentParser()
    parser.add_argument("--output", type=Path, default=DEFAULT_OUTPUT)
    parser.add_argument("--validate-committed", action="store_true")
    args = parser.parse_args()
    if args.validate_committed:
        validate_committed(args.output)
        print(f"validated {args.output}")
        return
    snapshot = build_snapshot()
    args.output.parent.mkdir(parents=True, exist_ok=True)
    args.output.write_text(json.dumps(snapshot, ensure_ascii=False, separators=(",", ":")) + "\n", encoding="utf-8")
    print(f"wrote {args.output} ({sum(year['municipalities'] for year in snapshot['years'])} righe)")


if __name__ == "__main__":
    main()
