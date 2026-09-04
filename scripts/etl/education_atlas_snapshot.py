#!/usr/bin/env python3
"""Build and validate the education module snapshot.

The source grain is one row per school code, course year, pathway and study
address. The public artifact deliberately rolls those rows up to region,
school type, pathway and address: it never publishes school names,
identifiers, emails or physical addresses.
"""

from __future__ import annotations

import argparse
import csv
import hashlib
import io
import json
import re
import sys
import unicodedata
import urllib.request
from collections import defaultdict
from pathlib import Path
from typing import Any


ROOT = Path(__file__).resolve().parents[2]
DEFAULT_OUTPUT = ROOT / "src/data/generated/education-atlas-snapshot.json"
DEFAULT_SOURCE_FILES_OUTPUT = ROOT / "src/data/generated/education-atlas-source-files.json"
OBSERVED_AT_DEFAULT = "2026-08-27T00:00:00+02:00"

PERIODS = (
    ("202223", "2022/23"),
    ("202324", "2023/24"),
    ("202425", "2024/25"),
)
SCHOOL_TYPES = (("state", "Scuola statale"), ("paritaria", "Scuola paritaria"))
ALLOWED_SCHOOL_ORDERS = frozenset({"SCUOLA SECONDARIA II GRADO"})
ALLOWED_PATHWAY_TYPES = frozenset({"LICEO", "TECNICO", "PROFESSIONALE", "PROFESSIONALE IEFP"})
EXPECTED_OBSERVED_REGION_COUNT = 18
MAX_REMOTE_SOURCE_BYTES = 50 * 1024 * 1024
IODL_URL = "http://www.dati.gov.it/iodl/2.0/"
SOURCE_PUBLISHED_AT = {
    ("students", "state"): "2026-02-23",
    ("students", "paritaria"): "2026-02-23",
    ("registry", "state"): "2026-06-18",
    ("registry", "paritaria"): "2026-06-18",
}
SOURCE_DATA_AS_OF = {
    "202223": "2023-08-31",
    "202324": "2024-08-31",
    "202425": "2025-08-31",
}

REGION_NAMES = {
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
REGION_CODES = tuple(REGION_NAMES)
EXPECTED_OBSERVED_REGION_CODES = tuple(code for code in REGION_CODES if code not in {"02", "04"})

REGION_SOURCE_LABELS = {
    "ABRUZZO": "13",
    "BASILICATA": "17",
    "CALABRIA": "18",
    "CAMPANIA": "15",
    "EMILIA ROMAGNA": "08",
    "FRIULI-VENEZIA G": "06",
    "LAZIO": "12",
    "LIGURIA": "07",
    "LOMBARDIA": "03",
    "MARCHE": "11",
    "MOLISE": "14",
    "PIEMONTE": "01",
    "PUGLIA": "16",
    "SARDEGNA": "20",
    "SICILIA": "19",
    "TOSCANA": "09",
    "UMBRIA": "10",
    "VENETO": "05",
}

PATHWAY_LABELS = {
    "ARTISTICO": "Artistico",
    "CLASSICO": "Classico",
    "ECONOMICO": "Economico",
    "EUROPEO": "Europeo",
    "INDUSTRIA E ARTIGIANATO": "Industria e artigianato",
    "INTERNAZIONALE": "Internazionale",
    "IEFP": "IeFP",
    "LINGUISTICO": "Linguistico",
    "MUSICALE E COREUTICO": "Musicale e coreutico",
    "NUOVI PROFESSIONALI": "Nuovi professionali",
    "SCIENTIFICO": "Scientifico",
    "SCIENZE UMANE": "Scienze umane",
    "SERVIZI": "Servizi",
    "TECNOLOGICO": "Tecnologico",
}

STUDENT_FIELDS = (
    "ANNOSCOLASTICO",
    "CODICESCUOLA",
    "ORDINESCUOLA",
    "ANNOCORSO",
    "TIPOPERCORSO",
    "PERCORSO",
    "INDIRIZZO",
    "ALUNNIMASCHI",
    "ALUNNIFEMMINE",
)
REGISTRY_FIELDS_STATE = (
    "ANNOSCOLASTICO",
    "AREAGEOGRAFICA",
    "REGIONE",
    "PROVINCIA",
    "CODICEISTITUTORIFERIMENTO",
    "DENOMINAZIONEISTITUTORIFERIMENTO",
    "CODICESCUOLA",
    "DENOMINAZIONESCUOLA",
    "INDIRIZZOSCUOLA",
    "CAPSCUOLA",
    "CODICECOMUNESCUOLA",
    "DESCRIZIONECOMUNE",
    "DESCRIZIONECARATTERISTICASCUOLA",
    "DESCRIZIONETIPOLOGIAGRADOISTRUZIONESCUOLA",
    "INDICAZIONESEDEDIRETTIVO",
    "INDICAZIONESEDEOMNICOMPRENSIVO",
    "INDIRIZZOEMAILSCUOLA",
    "INDIRIZZOPECSCUOLA",
    "SITOWEBSCUOLA",
    "SEDESCOLASTICA",
)
REGISTRY_FIELDS_PARITARIA = (
    "ANNOSCOLASTICO",
    "AREAGEOGRAFICA",
    "REGIONE",
    "PROVINCIA",
    "CODICESCUOLA",
    "DENOMINAZIONESCUOLA",
    "INDIRIZZOSCUOLA",
    "CAPSCUOLA",
    "CODICECOMUNESCUOLA",
    "DESCRIZIONECOMUNE",
    "DESCRIZIONETIPOLOGIAGRADOISTRUZIONESCUOLA",
    "INDIRIZZOEMAILSCUOLA",
    "INDIRIZZOPECSCUOLA",
    "SITOWEBSCUOLA",
)

SOURCE_FILES: dict[str, dict[str, dict[str, str]]] = {}
for period, _label in PERIODS:
    year = {"202223": "20222320230831", "202324": "20232420240831", "202425": "20242520250831"}[period]
    SOURCE_FILES[period] = {
        "state": {
            "students": f"https://dati.istruzione.it/opendata/opendata/catalogo/elements1/ALUSECGRADOINDSTA{year}.csv",
            "registry": f"https://dati.istruzione.it/opendata/opendata/catalogo/elements1/SCUANAGRAFESTAT{year}.csv",
        },
        "paritaria": {
            "students": f"https://dati.istruzione.it/opendata/opendata/catalogo/elements1/ALUSECGRADOINDPAR{year}.csv",
            "registry": f"https://dati.istruzione.it/opendata/opendata/catalogo/elements1/SCUANAGRAFEPAR{year}.csv",
        },
    }

SOURCE_LANDING_URLS = {
    "students": "https://dati.istruzione.it/opendata/opendata/catalogo/elements1/?area=Studenti",
    "registry": "https://dati.istruzione.it/opendata/opendata/catalogo/elements1/?area=Scuole",
}


def normalized_text(value: str) -> str:
    text = unicodedata.normalize("NFKC", value or "")
    text = text.replace("‐", "-").replace("‑", "-").replace("‒", "-")
    text = text.replace("–", "-").replace("—", "-").replace("−", "-")
    text = text.replace("’", "'").replace("‘", "'")
    return " ".join(text.strip().split())


def normalized_region_label(value: str) -> str:
    return normalized_text(value).upper().replace(".", "")


def region_code(value: str) -> str:
    normalized = normalized_region_label(value)
    code = REGION_SOURCE_LABELS.get(normalized)
    if code is None:
        raise ValueError(f"Regione MIM non mappata: {value!r}")
    return code


def pathway_code(value: str) -> str:
    normalized = normalized_text(value)
    if normalized.casefold() == "iefp":
        return "IEFP"
    code = normalized.upper()
    if code not in PATHWAY_LABELS:
        raise ValueError(f"Percorso MIM inatteso: {value!r}")
    return code


def nonnegative_int(value: str, field: str, line_number: int) -> int:
    text = normalized_text(value)
    if not text.isdigit():
        raise ValueError(f"Valore {field} non valido alla riga CSV {line_number}: {value!r}")
    result = int(text)
    if result < 0:
        raise ValueError(f"Valore {field} negativo alla riga CSV {line_number}: {value!r}")
    return result


def read_csv_bytes(payload: bytes, expected_fields: tuple[str, ...], source_url: str) -> list[dict[str, str]]:
    try:
        text = payload.decode("utf-8-sig")
    except UnicodeDecodeError as error:
        raise ValueError(f"CSV non UTF-8: {source_url}") from error
    reader = csv.DictReader(io.StringIO(text, newline=""))
    if tuple(reader.fieldnames or ()) != expected_fields:
        raise ValueError(
            f"Intestazione inattesa per {source_url}: {reader.fieldnames!r}; attesa {expected_fields!r}"
        )
    rows = []
    for row in reader:
        if not any(normalized_text(value or "") for value in row.values()):
            continue
        rows.append({field: value or "" for field, value in row.items()})
    return rows


def source_bytes(url: str, input_dir: Path | None, local_name: str) -> bytes:
    if input_dir is not None:
        path = input_dir / local_name
        if not path.is_file():
            raise FileNotFoundError(f"Input locale mancante: {path}")
        return path.read_bytes()
    request = urllib.request.Request(url, headers={"User-Agent": "DoveVannoINostriSoldi education atlas ETL"})
    with urllib.request.urlopen(request, timeout=60) as response:
        content_length = response.headers.get("Content-Length")
        if content_length:
            try:
                declared_bytes = int(content_length)
            except ValueError:
                declared_bytes = None
            if declared_bytes is not None and declared_bytes > MAX_REMOTE_SOURCE_BYTES:
                raise ValueError(
                    f"Fonte oltre il limite di {MAX_REMOTE_SOURCE_BYTES} byte: {url}"
                )

        chunks: list[bytes] = []
        received_bytes = 0
        while True:
            chunk = response.read(min(1024 * 1024, MAX_REMOTE_SOURCE_BYTES - received_bytes + 1))
            if not chunk:
                break
            received_bytes += len(chunk)
            if received_bytes > MAX_REMOTE_SOURCE_BYTES:
                raise ValueError(f"Fonte oltre il limite di {MAX_REMOTE_SOURCE_BYTES} byte: {url}")
            chunks.append(chunk)
        payload = b"".join(chunks)
    if not payload:
        raise ValueError(f"Fonte vuota: {url}")
    return payload


def file_receipt(
    *,
    period: str,
    school_type: str,
    role: str,
    url: str,
    payload: bytes,
    rows: int,
) -> dict[str, Any]:
    return {
        "period": period,
        "schoolType": school_type,
        "role": role,
        "publishedAt": SOURCE_PUBLISHED_AT[(role, school_type)],
        "dataAsOf": SOURCE_DATA_AS_OF[period],
        "url": url,
        "sha256": hashlib.sha256(payload).hexdigest(),
        "bytes": len(payload),
        "rows": rows,
    }


def registry_map(
    rows: list[dict[str, str]],
    source_url: str,
    expected_period: str | None = None,
) -> dict[str, str]:
    result: dict[str, str] = {}
    for line_number, row in enumerate(rows, start=2):
        source_period = normalized_text(row["ANNOSCOLASTICO"])
        if expected_period is not None and source_period != expected_period:
            raise ValueError(
                f"ANNOSCOLASTICO incoerente nell'anagrafe alla riga {line_number}: "
                f"atteso {expected_period}, trovato {source_period!r}"
            )
        code = normalized_text(row["CODICESCUOLA"]).upper()
        if not code:
            raise ValueError(f"Codice scuola vuoto alla riga {line_number}: {source_url}")
        if code in result:
            raise ValueError(f"Codice scuola duplicato alla riga {line_number}: {code}")
        current_region = region_code(row["REGIONE"])
        result[code] = current_region
    return result


def add_bucket(bucket: dict[str, int], male: int, female: int) -> None:
    bucket["maleCount"] += male
    bucket["femaleCount"] += female
    bucket["studentCount"] += male + female


def aggregate_source(
    *,
    period: str,
    school_type: str,
    students: list[dict[str, str]],
    registry: dict[str, str],
    source_url: str,
) -> tuple[list[dict[str, Any]], list[dict[str, Any]], list[dict[str, Any]], dict[str, Any]]:
    regional: dict[tuple[str, str], dict[str, Any]] = {}
    pathways: dict[tuple[str, str, str], dict[str, Any]] = {}
    addresses: dict[tuple[str, str, str, str], dict[str, Any]] = {}
    school_codes_by_region: dict[str, set[str]] = defaultdict(set)
    seen_source_keys: set[tuple[str, str, str, str, str, str, str, str]] = set()

    for line_number, row in enumerate(students, start=2):
        source_period = normalized_text(row["ANNOSCOLASTICO"])
        if source_period != period:
            raise ValueError(
                f"ANNOSCOLASTICO incoerente alla riga {line_number}: atteso {period}, trovato {source_period!r}"
            )
        school_order = normalized_text(row["ORDINESCUOLA"]).upper()
        if school_order not in ALLOWED_SCHOOL_ORDERS:
            raise ValueError(
                f"ORDINESCUOLA inatteso alla riga {line_number}: {row['ORDINESCUOLA']!r}"
            )
        pathway_type = normalized_text(row["TIPOPERCORSO"]).upper()
        if pathway_type not in ALLOWED_PATHWAY_TYPES:
            raise ValueError(
                f"TIPOPERCORSO inatteso alla riga {line_number}: {row['TIPOPERCORSO']!r}"
            )
        code = normalized_text(row["CODICESCUOLA"]).upper()
        region = registry.get(code)
        if region is None:
            raise ValueError(f"Codice scuola degli studenti non presente nell'anagrafe alla riga {line_number}: {code}")
        course_year = normalized_text(row["ANNOCORSO"])
        pathway = pathway_code(row["PERCORSO"])
        address = normalized_text(row["INDIRIZZO"])
        if not course_year.isdigit() or not address:
            raise ValueError(f"Dimensione obbligatoria non valida alla riga {line_number}: {source_url}")
        source_key = (
            source_period,
            school_type,
            region,
            code,
            course_year,
            pathway_type,
            pathway,
            address,
        )
        if source_key in seen_source_keys:
            raise ValueError(f"Riga studenti duplicata alla riga {line_number}: {source_key}")
        seen_source_keys.add(source_key)

        male = nonnegative_int(row["ALUNNIMASCHI"], "ALUNNIMASCHI", line_number)
        female = nonnegative_int(row["ALUNNIFEMMINE"], "ALUNNIFEMMINE", line_number)
        school_codes_by_region[region].add(code)

        regional_bucket = regional.setdefault(
            (region, school_type),
            {"studentCount": 0, "maleCount": 0, "femaleCount": 0},
        )
        add_bucket(regional_bucket, male, female)

        pathway_bucket = pathways.setdefault(
            (region, school_type, pathway),
            {"studentCount": 0, "maleCount": 0, "femaleCount": 0},
        )
        add_bucket(pathway_bucket, male, female)

        address_bucket = addresses.setdefault(
            (region, school_type, pathway, address),
            {"studentCount": 0, "maleCount": 0, "femaleCount": 0},
        )
        add_bucket(address_bucket, male, female)

    if len(school_codes_by_region) != EXPECTED_OBSERVED_REGION_COUNT:
        observed_regions = ", ".join(sorted(school_codes_by_region)) or "nessuna"
        raise ValueError(
            f"Copertura regionale inattesa per {period}/{school_type}: "
            f"attese {EXPECTED_OBSERVED_REGION_COUNT} Regioni osservate, "
            f"trovate {len(school_codes_by_region)} ({observed_regions})"
        )

    regional_rows = []
    for (region, current_type), values in regional.items():
        regional_rows.append(
            {
                "period": period,
                "schoolType": current_type,
                "regionCode": region,
                "regionName": REGION_NAMES[region],
                **values,
                "schoolCount": len(school_codes_by_region[region]),
            }
        )

    pathway_rows = []
    for (region, current_type, pathway), values in pathways.items():
        pathway_rows.append(
            {
                "period": period,
                "schoolType": current_type,
                "regionCode": region,
                "regionName": REGION_NAMES[region],
                "pathwayCode": pathway,
                "pathwayLabel": PATHWAY_LABELS[pathway],
                **values,
            }
        )

    address_rows = []
    for (region, current_type, pathway, address), values in addresses.items():
        address_rows.append(
            {
                "period": period,
                "schoolType": current_type,
                "regionCode": region,
                "regionName": REGION_NAMES[region],
                "pathwayCode": pathway,
                "pathwayLabel": PATHWAY_LABELS[pathway],
                "addressLabel": address,
                **values,
            }
        )

    total = sum(row["studentCount"] for row in regional_rows)
    male_total = sum(row["maleCount"] for row in regional_rows)
    female_total = sum(row["femaleCount"] for row in regional_rows)
    coverage = {
        "sourceRows": len(students),
        "matchedRows": len(students),
        "unmatchedRows": 0,
        "schoolCount": len({code for codes in school_codes_by_region.values() for code in codes}),
        "regionCount": len(school_codes_by_region),
        "studentCount": total,
        "maleCount": male_total,
        "femaleCount": female_total,
        "addressCount": len(addresses),
    }
    return regional_rows, pathway_rows, address_rows, coverage


def sorted_regions() -> list[dict[str, str]]:
    return [{"code": code, "name": REGION_NAMES[code]} for code in REGION_CODES]


def build_snapshot(observed_at: str, input_dir: Path | None = None) -> dict[str, Any]:
    all_regional: list[dict[str, Any]] = []
    all_pathways: list[dict[str, Any]] = []
    all_addresses: list[dict[str, Any]] = []
    coverage_by_period_type: dict[str, dict[str, Any]] = {}
    source_files: list[dict[str, Any]] = []

    for period, _period_label in PERIODS:
        coverage_by_period_type[period] = {}
        for school_type, _school_type_label in SCHOOL_TYPES:
            urls = SOURCE_FILES[period][school_type]
            students_name = f"students-{school_type}-{period}.csv"
            registry_name = f"registry-{school_type}-{period}.csv"
            students_payload = source_bytes(urls["students"], input_dir, students_name)
            registry_payload = source_bytes(urls["registry"], input_dir, registry_name)
            students = read_csv_bytes(students_payload, STUDENT_FIELDS, urls["students"])
            registry_fields = REGISTRY_FIELDS_STATE if school_type == "state" else REGISTRY_FIELDS_PARITARIA
            registry_rows = read_csv_bytes(registry_payload, registry_fields, urls["registry"])
            registry = registry_map(registry_rows, urls["registry"], expected_period=period)
            regional, pathways, addresses, coverage = aggregate_source(
                period=period,
                school_type=school_type,
                students=students,
                registry=registry,
                source_url=urls["students"],
            )
            all_regional.extend(regional)
            all_pathways.extend(pathways)
            all_addresses.extend(addresses)
            coverage_by_period_type[period][school_type] = coverage
            source_files.append(file_receipt(
                period=period,
                school_type=school_type,
                role="students",
                url=urls["students"],
                payload=students_payload,
                rows=len(students),
            ))
            source_files.append(file_receipt(
                period=period,
                school_type=school_type,
                role="registry",
                url=urls["registry"],
                payload=registry_payload,
                rows=len(registry_rows),
            ))

    observed_regions = sorted({row["regionCode"] for row in all_regional})
    missing_regions = [code for code in REGION_CODES if code not in observed_regions]
    pathways = sorted(
        ({"code": code, "label": label} for code, label in PATHWAY_LABELS.items()),
        key=lambda item: item["label"].casefold(),
    )

    return {
        "schemaVersion": 1,
        "generatedAt": observed_at,
        "verifiedAt": observed_at,
        "observationType": "aggregate",
        "geographyLevel": "region",
        "periods": [{"id": period, "label": label} for period, label in PERIODS],
        "regions": sorted_regions(),
        "schoolTypes": [{"code": code, "label": label} for code, label in SCHOOL_TYPES],
        "pathways": pathways,
        "sources": [
            {
                "id": "students",
                "label": "Studenti della scuola secondaria di II grado per percorso e indirizzo",
                "url": "https://dati.istruzione.it/opendata/opendata/catalogo/elements1/ALUSECGRADOINDSTA20242520250831.csv",
                "landingUrl": "https://dati.istruzione.it/opendata/opendata/catalogo/elements1/?area=Studenti",
                "publisher": "Ministero dell'Istruzione e del Merito",
                "license": "IODL 2.0",
                "licenseUrl": IODL_URL,
                "publishedAt": "2026-02-23",
                "latestDataAsOf": SOURCE_DATA_AS_OF["202425"],
                "observedAt": observed_at,
                "verifiedAt": observed_at,
                "cadence": "annuale",
                "coverage": "Scuola secondaria di II grado; anno scolastico, tipo percorso, percorso, indirizzo e genere; statali e paritarie per il triennio 2022/23-2024/25.",
                "caveat": "Il numero di studenti descrive la presenza nel file MIM e non misura qualità, esiti, domanda futura o disponibilità di lavoro.",
            },
            {
                "id": "registry",
                "label": "Anagrafe delle scuole",
                "url": "https://dati.istruzione.it/opendata/opendata/catalogo/elements1/SCUANAGRAFESTAT20242520250831.csv",
                "landingUrl": "https://dati.istruzione.it/opendata/opendata/catalogo/elements1/?area=Scuole",
                "publisher": "Ministero dell'Istruzione e del Merito",
                "license": "IODL 2.0",
                "licenseUrl": IODL_URL,
                "publishedAt": "2026-06-18",
                "latestDataAsOf": SOURCE_DATA_AS_OF["202425"],
                "observedAt": observed_at,
                "verifiedAt": observed_at,
                "cadence": "annuale",
                "coverage": "Anagrafe delle sedi scolastiche usata per collegare i codici scuola ai territori senza pubblicare il dettaglio nominativo nel prodotto.",
                "caveat": "Il join territoriale è tecnico: non rende comparabili automaticamente qualità, dotazioni o risultati delle scuole.",
            },
        ],
        "sourceFiles": source_files,
        "regionalObservations": sorted(
            all_regional,
            key=lambda row: (row["period"], row["schoolType"], row["regionCode"]),
        ),
        "pathwayObservations": sorted(
            all_pathways,
            key=lambda row: (row["period"], row["schoolType"], row["regionCode"], row["pathwayLabel"]),
        ),
        "addressObservations": sorted(
            all_addresses,
            key=lambda row: (
                row["period"],
                row["schoolType"],
                row["regionCode"],
                row["pathwayLabel"],
                row["addressLabel"],
            ),
        ),
        "coverage": {
            "expectedRegionCount": len(REGION_CODES),
            "observedRegionCount": len(observed_regions),
            "missingRegionCodes": missing_regions,
            "byPeriodSchoolType": coverage_by_period_type,
            "joinKey": "CODICESCUOLA",
            "sourceGrain": "CODICESCUOLA × ANNOCORSO × TIPOPERCORSO × PERCORSO × INDIRIZZO",
        },
    }


def assert_snapshot(snapshot: dict[str, Any]) -> None:
    if snapshot.get("schemaVersion") != 1:
        raise ValueError("schemaVersion inattesa")
    if snapshot.get("observationType") != "aggregate" or snapshot.get("geographyLevel") != "region":
        raise ValueError("Il prodotto deve essere aggregate/region")
    if [item["id"] for item in snapshot.get("periods", [])] != [period for period, _label in PERIODS]:
        raise ValueError("Periodi scolastici inattesi")
    if [item["code"] for item in snapshot.get("regions", [])] != list(REGION_CODES):
        raise ValueError("Catalogo regioni inatteso")
    if [item["code"] for item in snapshot.get("schoolTypes", [])] != [code for code, _label in SCHOOL_TYPES]:
        raise ValueError("Tipi scuola inattesi")
    if len(snapshot.get("sources", [])) != 2:
        raise ValueError("Fonti MIM inattese")
    expected_sources = (
        ("students", SOURCE_FILES["202425"]["state"]["students"], SOURCE_LANDING_URLS["students"], "2026-02-23"),
        ("registry", SOURCE_FILES["202425"]["state"]["registry"], SOURCE_LANDING_URLS["registry"], "2026-06-18"),
    )
    actual_sources = [
        (item.get("id"), item.get("url"), item.get("landingUrl"), item.get("publishedAt"))
        for item in snapshot["sources"]
    ]
    if actual_sources != list(expected_sources):
        raise ValueError("Provenienza dataset MIM incoerente")
    if any(item.get("latestDataAsOf") != SOURCE_DATA_AS_OF["202425"] for item in snapshot["sources"]):
        raise ValueError("Data di riferimento più recente incoerente")
    source_files = snapshot.get("sourceFiles", [])
    if len(source_files) != 12:
        raise ValueError("Ricevute source file inattese")
    if snapshot.get("coverage", {}).get("expectedRegionCount") != len(REGION_CODES):
        raise ValueError("Numero di Regioni atteso incoerente")
    if snapshot.get("coverage", {}).get("observedRegionCount") != EXPECTED_OBSERVED_REGION_COUNT:
        raise ValueError("Numero di Regioni osservate incoerente")
    expected_source_files = [
        (period, school_type, role)
        for period, _period_label in PERIODS
        for school_type, _school_type_label in SCHOOL_TYPES
        for role in ("students", "registry")
    ]
    actual_source_files = [
        (item.get("period"), item.get("schoolType"), item.get("role"))
        for item in source_files
    ]
    if actual_source_files != expected_source_files:
        raise ValueError("Inventario source file incoerente: periodo, tipo scuola o ruolo inatteso")
    if len({item.get("url") for item in source_files}) != len(source_files):
        raise ValueError("URL sorgente duplicati nell'inventario source file")
    for item, (period, school_type, role) in zip(source_files, expected_source_files):
        if item.get("url") != SOURCE_FILES[period][school_type][role]:
            raise ValueError(f"URL sorgente incoerente: {period}/{school_type}/{role}")
        if item.get("publishedAt") != SOURCE_PUBLISHED_AT[(role, school_type)]:
            raise ValueError(f"Data pubblicazione sorgente incoerente: {period}/{school_type}/{role}")
        if item.get("dataAsOf") != SOURCE_DATA_AS_OF[period]:
            raise ValueError(f"Data di riferimento sorgente incoerente: {period}/{school_type}/{role}")
        if not re.fullmatch(r"[a-f0-9]{64}", str(item.get("sha256", ""))):
            raise ValueError(f"Hash sorgente non valido: {period}/{school_type}/{role}")
        for field in ("bytes", "rows"):
            if not isinstance(item.get(field), int) or item[field] < 1:
                raise ValueError(f"Ricevuta sorgente non valida: {period}/{school_type}/{role}/{field}")

    expected_pathways = [
        {"code": code, "label": label}
        for code, label in sorted(PATHWAY_LABELS.items(), key=lambda item: item[1].casefold())
    ]
    if snapshot.get("pathways") != expected_pathways:
        raise ValueError("Tassonomia percorsi incoerente")

    region_keys: set[tuple[str, str, str]] = set()
    for row in snapshot.get("regionalObservations", []):
        key = (row["period"], row["schoolType"], row["regionCode"])
        if key in region_keys:
            raise ValueError(f"Osservazione regionale duplicata: {key}")
        region_keys.add(key)
        if row["regionName"] != REGION_NAMES[row["regionCode"]]:
            raise ValueError(f"Nome Regione incoerente: {key}")
        for field in ("studentCount", "maleCount", "femaleCount", "schoolCount"):
            if not isinstance(row[field], int) or row[field] < 0:
                raise ValueError(f"Valore regionale non valido: {key}/{field}")
        if row["studentCount"] != row["maleCount"] + row["femaleCount"]:
            raise ValueError(f"Totale regionale non riconciliato: {key}")

    pathway_keys: set[tuple[str, str, str, str]] = set()
    for row in snapshot.get("pathwayObservations", []):
        key = (row["period"], row["schoolType"], row["regionCode"], row["pathwayCode"])
        if key in pathway_keys:
            raise ValueError(f"Osservazione percorso duplicata: {key}")
        pathway_keys.add(key)
        if row["pathwayCode"] not in PATHWAY_LABELS or row["pathwayLabel"] != PATHWAY_LABELS[row["pathwayCode"]]:
            raise ValueError(f"Etichetta percorso incoerente: {key}")
        if row["studentCount"] != row["maleCount"] + row["femaleCount"]:
            raise ValueError(f"Totale percorso non riconciliato: {key}")

    address_keys: set[tuple[str, str, str, str, str]] = set()
    for row in snapshot.get("addressObservations", []):
        key = (row["period"], row["schoolType"], row["regionCode"], row["pathwayCode"], row["addressLabel"])
        if key in address_keys:
            raise ValueError(f"Osservazione indirizzo duplicata: {key}")
        address_keys.add(key)
        if row["pathwayCode"] not in PATHWAY_LABELS or row["pathwayLabel"] != PATHWAY_LABELS[row["pathwayCode"]]:
            raise ValueError(f"Etichetta percorso incoerente: {key}")
        if row["studentCount"] != row["maleCount"] + row["femaleCount"]:
            raise ValueError(f"Totale indirizzo non riconciliato: {key}")

    expected_coverage = snapshot["coverage"]["byPeriodSchoolType"]
    for period, _period_label in PERIODS:
        for school_type, _school_type_label in SCHOOL_TYPES:
            coverage = expected_coverage[period][school_type]
            regional_rows = [
                row for row in snapshot["regionalObservations"]
                if row["period"] == period and row["schoolType"] == school_type
            ]
            pathway_rows = [
                row for row in snapshot["pathwayObservations"]
                if row["period"] == period and row["schoolType"] == school_type
            ]
            address_rows = [
                row for row in snapshot["addressObservations"]
                if row["period"] == period and row["schoolType"] == school_type
            ]
            if sum(row["studentCount"] for row in regional_rows) != coverage["studentCount"]:
                raise ValueError(f"Totale regionale non riconciliato: {period}/{school_type}")
            if sum(row["studentCount"] for row in pathway_rows) != coverage["studentCount"]:
                raise ValueError(f"Totale percorso non riconciliato: {period}/{school_type}")
            if sum(row["studentCount"] for row in address_rows) != coverage["studentCount"]:
                raise ValueError(f"Totale indirizzo non riconciliato: {period}/{school_type}")
            if coverage["matchedRows"] != coverage["sourceRows"] or coverage["unmatchedRows"] != 0:
                raise ValueError(f"Join incompleto: {period}/{school_type}")
            if coverage["regionCount"] != EXPECTED_OBSERVED_REGION_COUNT:
                raise ValueError(f"Copertura regionale incompleta: {period}/{school_type}")
            observed_codes = sorted({row["regionCode"] for row in regional_rows})
            if observed_codes != sorted(EXPECTED_OBSERVED_REGION_CODES):
                raise ValueError(f"Codici Regione incompleti: {period}/{school_type}")

    missing = snapshot["coverage"]["missingRegionCodes"]
    if missing != ["02", "04"]:
        raise ValueError(f"Copertura regionale cambiata: {missing}")


def source_file_manifest(snapshot: dict[str, Any], snapshot_path: Path) -> dict[str, Any]:
    try:
        relative_snapshot_path = snapshot_path.resolve().relative_to(ROOT).as_posix()
    except ValueError:
        relative_snapshot_path = str(snapshot_path)
    return {
        "schemaVersion": 1,
        "snapshotPath": relative_snapshot_path,
        "verifiedAt": snapshot["verifiedAt"],
        "files": snapshot["sourceFiles"],
    }


def assert_source_file_manifest(manifest: dict[str, Any], snapshot: dict[str, Any]) -> None:
    if manifest.get("schemaVersion") != 1:
        raise ValueError("Versione manifest source file inattesa")
    if not isinstance(manifest.get("snapshotPath"), str) or not manifest["snapshotPath"].strip():
        raise ValueError("Percorso snapshot assente nel manifest source file")
    if manifest.get("verifiedAt") != snapshot.get("verifiedAt"):
        raise ValueError("verifiedAt del manifest source file non riconciliato")
    if manifest.get("files") != snapshot.get("sourceFiles"):
        raise ValueError("Manifest source file non riconciliato con lo snapshot")
    assert_snapshot({**snapshot, "sourceFiles": manifest["files"]})


def parse_args() -> argparse.Namespace:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--output", type=Path, default=DEFAULT_OUTPUT)
    parser.add_argument("--source-files-output", type=Path, default=DEFAULT_SOURCE_FILES_OUTPUT)
    parser.add_argument("--input-dir", type=Path, help="Directory con i 12 CSV già scaricati.")
    parser.add_argument("--observed-at", default=OBSERVED_AT_DEFAULT)
    parser.add_argument("--check", action="store_true", help="Valida lo snapshot già committato senza rete.")
    return parser.parse_args()


def main() -> int:
    args = parse_args()
    try:
        if args.check:
            snapshot = json.loads(args.output.read_text(encoding="utf-8"))
            assert_snapshot(snapshot)
            manifest = json.loads(args.source_files_output.read_text(encoding="utf-8"))
            assert_source_file_manifest(manifest, snapshot)
            print(f"OK education atlas snapshot: {args.output}")
            return 0
        snapshot = build_snapshot(args.observed_at, args.input_dir)
        assert_snapshot(snapshot)
        manifest = source_file_manifest(snapshot, args.output)
        assert_source_file_manifest(manifest, snapshot)
        args.output.parent.mkdir(parents=True, exist_ok=True)
        args.output.write_text(
            json.dumps(snapshot, ensure_ascii=False, indent=2) + "\n",
            encoding="utf-8",
        )
        args.source_files_output.parent.mkdir(parents=True, exist_ok=True)
        args.source_files_output.write_text(
            json.dumps(manifest, ensure_ascii=False, indent=2) + "\n",
            encoding="utf-8",
        )
        print(
            f"Generated {args.output}: {len(snapshot['regionalObservations'])} regional, "
            f"{len(snapshot['pathwayObservations'])} pathway, "
            f"{len(snapshot['addressObservations'])} address observations",
        )
        return 0
    except (OSError, ValueError, json.JSONDecodeError) as error:
        print(f"education atlas ETL failed: {error}", file=sys.stderr)
        return 1


if __name__ == "__main__":
    raise SystemExit(main())
