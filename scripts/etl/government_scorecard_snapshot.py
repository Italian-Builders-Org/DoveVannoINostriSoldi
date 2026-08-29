#!/usr/bin/env python3
"""Build and validate the government economic-scorecard snapshot.

The refresh is intentionally standard-library only. Remote ZIP, CSV and HTML
inputs are untrusted: URLs, sizes, archive members, schemas and reconciliations
are checked before an atomic write. The generated file contains observations
and provenance; the public score is derived by versioned TypeScript code.
"""

from __future__ import annotations

import argparse
import csv
import hashlib
import html
import io
import json
import math
import os
import re
import tempfile
import time
import urllib.error
import urllib.parse
import urllib.request
import zipfile
from datetime import UTC, datetime
from decimal import Decimal, InvalidOperation
from pathlib import Path, PurePosixPath
from typing import Any, NoReturn


ROOT = Path(__file__).resolve().parents[2]
DEFAULT_SPEC = ROOT / "scripts/etl/specs/government-scorecard.source.json"
DEFAULT_METHODOLOGY_MANIFEST = ROOT / "scripts/etl/specs/government-scorecard-methodology.json"
DEFAULT_OUTPUT = ROOT / "src/data/generated/government-scorecard.json"
MAX_AMECO_BYTES = 10 * 1024 * 1024
MAX_AMECO_UNCOMPRESSED_BYTES = 80 * 1024 * 1024
MAX_CHRONOLOGY_BYTES = 2 * 1024 * 1024
MAX_HISTORICAL_PAGE_BYTES = 512 * 1024
COUNTRY_IDS = ("italy", "france", "germany", "spain")
EXPECTED_YEARS = tuple(range(1960, 2028))
HISTORICAL_PAGE_ALLOWLIST = {
    "dini-i": {
        "sourceLabel": "Governo Dini",
        "pageTitle": "I Governo Dini",
        "pageUrl": "https://storia.camera.it/governi/i-governo-dini/Ministero%20del%20tesoro",
        "startDate": "1995-01-17",
        "endDate": "1996-05-17",
    },
    "prodi-i": {
        "sourceLabel": "Governo Prodi",
        "pageTitle": "I Governo Prodi",
        "pageUrl": "https://storia.camera.it/governi/i-governo-prodi/Ministero%20delle%20finanze",
        "startDate": "1996-05-17",
        "endDate": "1998-10-21",
    },
    "dalema-i": {
        "sourceLabel": "Governo D'Alema",
        "pageTitle": "I Governo D'Alema",
        "pageUrl": "https://storia.camera.it/governi/i-governo-d-alema/Presidenza%20del%20Consiglio%20-%20rapporti%20con%20il%20parlamento",
        "startDate": "1998-10-21",
        "endDate": "1999-12-22",
    },
    "dalema-ii": {
        "sourceLabel": "Governo D'Alema II",
        "pageTitle": "II Governo D'Alema",
        "pageUrl": "https://storia.camera.it/governi/ii-governo-d-alema/Ministero%20dell%27interno",
        "startDate": "1999-12-22",
        "endDate": "2000-04-25",
    },
    "amato-ii": {
        "sourceLabel": "Governo Amato II",
        "pageTitle": "II Governo Amato",
        "pageUrl": "https://storia.camera.it/governi/ii-governo-amato/Presidenza%20del%20Consiglio%20-%20affari%20regionali",
        "startDate": "2000-04-25",
        "endDate": "2001-06-10",
    },
}
GOVERNMENT_DATE_BOUNDARY_MEANING = (
    "startDate ed endDate sono i confini istituzionali del governo pubblicati dalle fonti; "
    "endDate può coincidere con l'inizio del governo successivo e non indica necessariamente "
    "l'ultimo giorno in carica, una data di dimissioni o responsabilità causale"
)
INDICATOR_VALUE_RANGES = {
    "real_compensation": (0, 1_000),
    "unemployment": (0, 100),
    "real_gdp_per_capita": (0, 1_000),
    "debt_ratio": (0, 1_000),
    "primary_balance": (-100, 100),
    "investment_share": (0, 100),
}
ISO_DATE = re.compile(r"^\d{4}-\d{2}-\d{2}$")
SHA256 = re.compile(r"^[0-9a-f]{64}$")
ITALIAN_MONTHS = {
    "gennaio": 1,
    "febbraio": 2,
    "marzo": 3,
    "aprile": 4,
    "maggio": 5,
    "giugno": 6,
    "luglio": 7,
    "agosto": 8,
    "settembre": 9,
    "ottobre": 10,
    "novembre": 11,
    "dicembre": 12,
}


class SnapshotError(ValueError):
    """Raised when an input or generated snapshot violates the contract."""


def fail(message: str) -> NoReturn:
    raise SnapshotError(message)


def sha256_bytes(payload: bytes) -> str:
    return hashlib.sha256(payload).hexdigest()


def require_dict(value: Any, label: str) -> dict[str, Any]:
    if not isinstance(value, dict):
        fail(f"{label}: oggetto atteso")
    return value


def require_list(value: Any, label: str) -> list[Any]:
    if not isinstance(value, list):
        fail(f"{label}: lista attesa")
    return value


def exact_keys(value: dict[str, Any], expected: set[str], label: str) -> None:
    if set(value) != expected:
        fail(f"{label}: chiavi inattese")


def validate_official_url(url: Any, host: str, path: str) -> str:
    if not isinstance(url, str):
        fail("URL: stringa attesa")
    parsed = urllib.parse.urlparse(url)
    if parsed.scheme != "https" or parsed.hostname != host or parsed.port not in (None, 443):
        fail("URL: origine non consentita")
    if parsed.username is not None or parsed.password is not None or parsed.fragment or parsed.path != path:
        fail("URL: forma non consentita")
    return url


def read_json_object(path: Path, label: str) -> dict[str, Any]:
    try:
        return require_dict(json.loads(path.read_text(encoding="utf-8")), label)
    except (OSError, UnicodeDecodeError, json.JSONDecodeError) as error:
        fail(f"{label}: lettura fallita ({error})")


def methodology_series_item(item: dict[str, Any]) -> dict[str, Any]:
    source_series = [item["numerator"], item["denominator"]] if "derived" in item else [item]
    result = {
        key: item[key]
        for key in ("id", "area", "label", "weightBasisPoints", "direction", "transformation", "unit", "limitations")
    }
    if "derived" in item:
        result["derived"] = item["derived"]
    result["sourceSeries"] = [
        {key: source[key] for key in ("file", "codeTemplate", "title", "unit")}
        for source in source_series
    ]
    return result


def load_methodology_manifest(spec: dict[str, Any]) -> dict[str, Any]:
    expected_path = "scripts/etl/specs/government-scorecard-methodology.json"
    if spec.get("methodologyManifest") != expected_path:
        fail("source spec: manifest metodologia inattesa")
    manifest = read_json_object(DEFAULT_METHODOLOGY_MANIFEST, "methodology manifest")
    exact_keys(manifest, {"schemaVersion", "methodologyVersion", "countryCodes", "indicators", "method"}, "methodology manifest")
    if manifest["schemaVersion"] != 1 or manifest["methodologyVersion"] != "core-annual-v4":
        fail("methodology manifest: versione non supportata")
    return manifest


def validate_spec(spec: dict[str, Any]) -> None:
    exact_keys(spec, {"schemaVersion", "methodologyVersion", "methodologyManifest", "ameco", "governmentChronology", "method", "contexts", "measures"}, "source spec")
    if spec["schemaVersion"] != 1 or spec["methodologyVersion"] != "core-annual-v4":
        fail("source spec: versione non supportata")
    manifest = load_methodology_manifest(spec)
    ameco = require_dict(spec["ameco"], "ameco")
    chronology = require_dict(spec["governmentChronology"], "governmentChronology")
    validate_official_url(ameco.get("downloadUrl"), "ec.europa.eu", "/economy_finance/db_indicators/ameco/documents/ameco0_csv.zip")
    validate_official_url(chronology.get("pageUrl"), "www.governo.it", "/it/i-governi-dal-1943-ad-oggi/i-governi-nelle-legislature/192")
    if chronology.get("historicalOwner") != "Camera dei deputati · Portale storico":
        fail("governmentChronology: titolare delle fonti storiche inatteso")
    if chronology.get("dateMeaning") != GOVERNMENT_DATE_BOUNDARY_MEANING:
        fail("governmentChronology: significato delle date inatteso")
    historical_pages = require_list(chronology.get("historicalPages"), "governmentChronology.historicalPages")
    allowlisted_pages = list(HISTORICAL_PAGE_ALLOWLIST.items())
    if len(historical_pages) != len(allowlisted_pages):
        fail("governmentChronology: pagine storiche incomplete")
    government_records = require_list(chronology.get("governments"), "governmentChronology.governments")
    governments_by_id: dict[str, dict[str, Any]] = {}
    for raw_item in government_records:
        item = require_dict(raw_item, "governmentChronology.government")
        government_id = item.get("id")
        if not isinstance(government_id, str) or not re.fullmatch(r"[a-z0-9-]+", government_id):
            fail("governmentChronology: identificativo governo non valido")
        if government_id in governments_by_id:
            fail("governmentChronology: identificativo governo duplicato")
        governments_by_id[government_id] = item
    for raw, (government_id, allowlisted) in zip(historical_pages, allowlisted_pages, strict=True):
        page = require_dict(raw, "governmentChronology.historicalPage")
        exact_keys(page, {"governmentId", "sourceLabel", "pageTitle", "pageUrl", "startDate", "endDate"}, "governmentChronology.historicalPage")
        expected_government = governments_by_id.get(government_id)
        if expected_government is None or page["governmentId"] != government_id:
            fail("governmentChronology: pagina storica associata a governo inatteso")
        if page != {"governmentId": government_id, **allowlisted}:
            fail(f"governmentChronology: URL o metadati storici non consentiti ({government_id})")
        if page["sourceLabel"] != expected_government.get("sourceLabel") or page["startDate"] != expected_government.get("startDate") or page["endDate"] != expected_government.get("endDate"):
            fail(f"governmentChronology: pagina storica non allineata alla cronologia ({government_id})")
        parsed_page_url = urllib.parse.urlparse(page["pageUrl"])
        validate_official_url(page["pageUrl"], "storia.camera.it", parsed_page_url.path)
    countries = require_dict(ameco.get("countries"), "ameco.countries")
    expected_country_codes = require_dict(manifest["countryCodes"], "methodology manifest.countryCodes")
    if tuple(countries) != COUNTRY_IDS or {country_id: item.get("code") for country_id, item in countries.items()} != expected_country_codes:
        fail("ameco.countries: set non autorizzato")
    series = require_list(ameco.get("series"), "ameco.series")
    actual_manifest = [methodology_series_item(require_dict(raw, "ameco.series item")) for raw in series]
    if actual_manifest != manifest["indicators"]:
        fail("ameco.series: manifest metodologia divergente")
    method = require_dict(spec["method"], "method")
    if method != manifest["method"]:
        fail("method: manifest metodologia divergente")
    governments = require_list(chronology.get("governments"), "governmentChronology.governments")
    if len(governments) < 17:
        fail("governmentChronology: cronologia 1995+ incompleta")
    previous_start = ""
    for government in governments:
        item = require_dict(government, "governmentChronology.government")
        exact_keys(item, {"id", "name", "sourceLabel", "startDate", "endDate", "status"}, "governmentChronology.government")
        if not isinstance(item["sourceLabel"], str) or not item["sourceLabel"].strip():
            fail("governmentChronology: etichetta fonte mancante")
        if not ISO_DATE.fullmatch(item.get("startDate", "")) or item["startDate"] <= previous_start:
            fail("governmentChronology: date non valide o non ordinate")
        if item["endDate"] is not None and not ISO_DATE.fullmatch(item["endDate"]):
            fail("governmentChronology: data finale non valida")
        if (item.get("status") == "current") != (item["endDate"] is None):
            fail("governmentChronology: stato e data finale non coerenti")
        previous_start = item["startDate"]
    current = [government for government in governments if government.get("status") == "current"]
    if len(current) != 1 or current[0] is not governments[-1] or current[0].get("endDate") is not None:
        fail("governmentChronology: governo corrente non univoco o non più recente")
    for collection in ("contexts", "measures"):
        values = require_list(spec[collection], collection)
        if not values:
            fail(f"{collection}: lista vuota")
        for raw in values:
            item = require_dict(raw, f"{collection} item")
            source_url = item.get("sourceUrl")
            if not isinstance(source_url, str) or urllib.parse.urlparse(source_url).scheme != "https":
                fail(f"{collection}: URL HTTPS atteso")


def download(url: str, max_bytes: int, label: str, attempts: int = 3) -> bytes:
    request = urllib.request.Request(
        url,
        headers={
            "User-Agent": "DoveVannoINostriSoldi/1.0 (+https://github.com/Italian-Builders-Org/DoveVannoINostriSoldi)",
            "Accept": "application/zip,text/html;q=0.9,*/*;q=0.1",
        },
    )
    last_error: Exception | None = None
    for attempt in range(attempts):
        try:
            with urllib.request.urlopen(request, timeout=45) as response:
                final = response.geturl()
                original = urllib.parse.urlparse(url)
                resolved = urllib.parse.urlparse(final)
                if resolved.scheme != "https" or resolved.hostname != original.hostname or resolved.path != original.path:
                    fail(f"{label}: redirect non consentito")
                length = response.headers.get("Content-Length")
                if length and int(length) > max_bytes:
                    fail(f"{label}: payload troppo grande")
                payload = response.read(max_bytes + 1)
                if len(payload) > max_bytes:
                    fail(f"{label}: payload troppo grande")
                if not payload:
                    fail(f"{label}: payload vuoto")
                return payload
        except (OSError, urllib.error.URLError, TimeoutError, ValueError) as error:
            last_error = error
            if attempt + 1 < attempts:
                time.sleep(1.5 * (attempt + 1))
    fail(f"{label}: download fallito ({last_error})")


def load_historical_payloads(spec: dict[str, Any], directory: Path | None = None) -> dict[str, bytes]:
    pages = require_list(spec["governmentChronology"].get("historicalPages"), "governmentChronology.historicalPages")
    payloads: dict[str, bytes] = {}
    for raw_page in pages:
        page = require_dict(raw_page, "governmentChronology.historicalPage")
        government_id = page["governmentId"]
        if directory is None:
            payloads[government_id] = download(page["pageUrl"], MAX_HISTORICAL_PAGE_BYTES, f"cronologia Camera {government_id}")
            continue
        path = directory / f"{government_id}.html"
        try:
            payload = path.read_bytes()
        except OSError as error:
            fail(f"cronologia Camera: fixture assente ({path}: {error})")
        if not payload or len(payload) > MAX_HISTORICAL_PAGE_BYTES:
            fail(f"cronologia Camera: fixture non valido ({path})")
        payloads[government_id] = payload
    return payloads


def decimal_value(raw: Any, label: str) -> float | None:
    if raw == "NA":
        return None
    if not isinstance(raw, str) or not re.fullmatch(r"[+-]?\d+(?:\.\d+)?", raw):
        fail(f"{label}: valore numerico non valido")
    try:
        value = Decimal(raw)
    except InvalidOperation:
        fail(f"{label}: valore numerico non valido")
    if not value.is_finite():
        fail(f"{label}: valore numerico non finito")
    return round(float(value), 8)


def safe_archive(payload: bytes) -> dict[str, bytes]:
    try:
        archive = zipfile.ZipFile(io.BytesIO(payload))
    except zipfile.BadZipFile:
        fail("AMECO: archivio ZIP non valido")
    expected = {f"AMECO{index}.CSV" for index in range(1, 19)}
    names: set[str] = set()
    members: dict[str, bytes] = {}
    total_size = 0
    with archive:
        for info in archive.infolist():
            path = PurePosixPath(info.filename)
            if info.is_dir() or info.flag_bits & 0x1 or path.is_absolute() or ".." in path.parts or len(path.parts) != 1:
                fail("AMECO: membro ZIP non consentito")
            if info.filename in names:
                fail("AMECO: membro ZIP duplicato")
            names.add(info.filename)
            total_size += info.file_size
            if total_size > MAX_AMECO_UNCOMPRESSED_BYTES:
                fail("AMECO: archivio decompresso troppo grande")
        if names != expected:
            fail("AMECO: set dei file inatteso")
        for name in expected:
            members[name] = archive.read(name)
    return members


def ameco_rows(payload: bytes, encoding: str, label: str) -> dict[str, dict[str, str]]:
    try:
        text = payload.decode(encoding)
    except (UnicodeDecodeError, LookupError):
        fail(f"{label}: encoding non valido")
    reader = csv.DictReader(io.StringIO(text, newline=""))
    expected = ["CODE", "COUNTRY", "SUB-CHAPTER", "TITLE", "UNIT", *map(str, EXPECTED_YEARS), "Unnamed: 73"]
    if reader.fieldnames != expected:
        fail(f"{label}: intestazione CSV inattesa")
    result: dict[str, dict[str, str]] = {}
    for row in reader:
        if None in row or any(value is None for value in row.values()):
            fail(f"{label}: riga CSV non valida")
        code = row["CODE"]
        if code in result:
            fail(f"{label}: codice duplicato {code}")
        result[code] = row
    return result


def series_values(row: dict[str, str], label: str) -> list[dict[str, Any]]:
    return [
        {"year": year, "value": decimal_value(row[str(year)], f"{label}.{year}")}
        for year in EXPECTED_YEARS
    ]


def extract_ameco(spec: dict[str, Any], payload: bytes) -> list[dict[str, Any]]:
    ameco = spec["ameco"]
    members = safe_archive(payload)
    needed_files = {
        item.get("file") or item.get("numerator", {}).get("file")
        for item in ameco["series"]
    } | {
        item.get("denominator", {}).get("file")
        for item in ameco["series"]
        if item.get("denominator")
    }
    needed_files.discard(None)
    files = {name: ameco_rows(members[name], ameco["encoding"], name) for name in needed_files}
    output: list[dict[str, Any]] = []
    for item in ameco["series"]:
        countries: dict[str, list[dict[str, Any]]] = {}
        source_codes: dict[str, Any] = {}
        for country_id, country in ameco["countries"].items():
            country_code = country["code"]
            if "derived" in item:
                numerator_config = item["numerator"]
                denominator_config = item["denominator"]
                numerator_code = numerator_config["codeTemplate"].format(country=country_code)
                denominator_code = denominator_config["codeTemplate"].format(country=country_code)
                numerator = files[numerator_config["file"]].get(numerator_code)
                denominator = files[denominator_config["file"]].get(denominator_code)
                if numerator is None or denominator is None:
                    fail(f"AMECO: serie derivata mancante {item['id']}.{country_id}")
                if numerator["TITLE"] != numerator_config["title"] or denominator["TITLE"] != denominator_config["title"]:
                    fail(f"AMECO: titolo inatteso {item['id']}.{country_id}")
                values = []
                for year in EXPECTED_YEARS:
                    left = decimal_value(numerator[str(year)], f"{numerator_code}.{year}")
                    right = decimal_value(denominator[str(year)], f"{denominator_code}.{year}")
                    if left is None or right is None:
                        value = None
                    elif right <= 0:
                        fail(f"AMECO: denominatore non positivo {denominator_code}.{year}")
                    else:
                        value = round(left / right * 100, 8)
                    values.append({"year": year, "value": value})
                source_codes[country_id] = [numerator_code, denominator_code]
            else:
                code = item["codeTemplate"].format(country=country_code)
                row = files[item["file"]].get(code)
                if row is None or row["TITLE"] != item["title"]:
                    fail(f"AMECO: serie o titolo mancante {item['id']}.{country_id}")
                values = series_values(row, code)
                source_codes[country_id] = [code]
            countries[country_id] = values
        output.append({
            **methodology_series_item(item),
            "sourceId": "ameco",
            "referencePeriod": "annual, 1960-2027; observations through 2024; forecasts from 2025",
            "coverageNotes": "Unavailable country-years remain explicit null values; 1995-2024 is mandatory for every country, while 2025-2027 is published only as a complete forecast scenario.",
            "sourceCodes": source_codes,
            "countries": countries,
        })
    return output


def chronology_date(line: str, pattern: str) -> str | None:
    match = re.search(pattern, line, re.IGNORECASE)
    if not match:
        return None
    day, month_name, year = match.groups()
    month = ITALIAN_MONTHS.get(month_name.lower())
    if month is None:
        fail("cronologia governi: mese italiano inatteso")
    try:
        return datetime(int(year), month, int(day)).date().isoformat()
    except ValueError:
        fail("cronologia governi: data ufficiale non valida")


def chronology_start_date(line: str) -> str | None:
    return chronology_date(line, r"\((?:dal\s+|dall')(\d{1,2})\s+([a-zà]+)\s+(\d{4})\b")


def chronology_end_date(line: str) -> str | None:
    return chronology_date(line, r"\bal\s+(\d{1,2})\s+([a-zà]+)\s+(\d{4})\b")


def historical_page_text(payload: bytes, label: str) -> str:
    try:
        text = payload.decode("utf-8")
    except UnicodeDecodeError:
        fail(f"{label}: HTML non UTF-8")
    text = re.sub(r"<(script|style)\b[^>]*>.*?</\1>", " ", text, flags=re.IGNORECASE | re.DOTALL)
    return " ".join(html.unescape(re.sub(r"<[^>]+>", " ", text)).split())


def extract_historical_receipts(
    spec: dict[str, Any],
    payloads: dict[str, bytes],
    retrieved_at: str | None = None,
) -> list[dict[str, Any]]:
    historical_pages = require_list(spec["governmentChronology"].get("historicalPages"), "governmentChronology.historicalPages")
    expected_ids = tuple(HISTORICAL_PAGE_ALLOWLIST)
    if set(payloads) != set(expected_ids):
        fail("cronologia Camera: pagine storiche mancanti o inattese")
    receipts: list[dict[str, Any]] = []
    months = "|".join(ITALIAN_MONTHS)
    date_pattern = rf"\bDal\s+(\d{{1,2}})\s+({months})\s+(\d{{4}})\s+al\s+(\d{{1,2}})\s+({months})\s+(\d{{4}})\b"
    for raw_page in historical_pages:
        page = require_dict(raw_page, "governmentChronology.historicalPage")
        government_id = page.get("governmentId")
        allowlisted = HISTORICAL_PAGE_ALLOWLIST.get(government_id)
        if allowlisted is None or page != {"governmentId": government_id, **allowlisted}:
            fail(f"cronologia Camera: URL o metadati storici non consentiti ({government_id})")
        payload = payloads.get(government_id)
        if not isinstance(payload, bytes) or not payload or len(payload) > MAX_HISTORICAL_PAGE_BYTES:
            fail(f"cronologia Camera: payload non valido ({government_id})")
        text = historical_page_text(payload, f"cronologia Camera {government_id}")
        if page["pageTitle"].casefold() not in text.casefold():
            fail(f"cronologia Camera: titolo inatteso ({government_id})")
        match = re.search(date_pattern, text, re.IGNORECASE)
        if match is None:
            fail(f"cronologia Camera: date assenti ({government_id})")
        day, start_month, start_year, end_day, end_month, end_year = match.groups()
        start_date = chronology_date(f"dal {day} {start_month} {start_year}", r"\bdal\s+(\d{1,2})\s+([a-zà]+)\s+(\d{4})\b")
        end_date = chronology_date(f"al {end_day} {end_month} {end_year}", r"\bal\s+(\d{1,2})\s+([a-zà]+)\s+(\d{4})\b")
        if start_date != page["startDate"] or end_date != page["endDate"]:
            fail(f"cronologia Camera: date divergenti ({government_id})")
        receipts.append({
            "governmentId": government_id,
            "sourceLabel": page["sourceLabel"],
            "pageTitle": page["pageTitle"],
            "pageUrl": page["pageUrl"],
            "startDate": page["startDate"],
            "endDate": page["endDate"],
            "retrievedAt": retrieved_at,
            "bytes": len(payload),
            "sha256": sha256_bytes(payload),
        })
    return receipts


def extract_governments(spec: dict[str, Any], payload: bytes) -> list[dict[str, Any]]:
    try:
        text = payload.decode("utf-8")
    except UnicodeDecodeError:
        fail("cronologia governi: HTML non UTF-8")
    if "I Governi nelle Legislature" not in text:
        fail("cronologia governi: pagina ufficiale inattesa")
    chronology = re.search(r"<dl\b[^>]*>(.*?)</dl>", text, re.IGNORECASE | re.DOTALL)
    if chronology is None:
        fail("cronologia governi: elenco ufficiale assente")
    lines: list[str] = []
    for block in re.findall(r"<dd\b[^>]*>(.*?)</dd>", chronology.group(1), re.IGNORECASE | re.DOTALL):
        block = re.sub(r"<br\s*/?>", "\n", block, flags=re.IGNORECASE)
        block = html.unescape(re.sub(r"<[^>]+>", " ", block))
        lines.extend(" ".join(line.split()) for line in block.splitlines() if line.strip())

    governments = spec["governmentChronology"]["governments"]
    expected = list(reversed(governments))
    official = lines[:len(expected)]
    if len(official) != len(expected):
        fail("cronologia governi: elenco ufficiale 1995+ incompleto")
    for item, line in zip(expected, official, strict=True):
        source_label = item["sourceLabel"]
        official_label = line.split(" (", 1)[0].strip()
        if official_label != source_label:
            fail(f"cronologia governi: fonte e specifica divergono ({official_label!r} != {source_label!r})")
        official_start = chronology_start_date(line)
        historical_page = HISTORICAL_PAGE_ALLOWLIST.get(item["id"])
        # The Presidency page still lists the five oldest governments, but no
        # longer publishes their dates. Those dates are verified independently
        # against the allowlisted Camera pages and their receipts. If the
        # Presidency later restores dates, they must agree as well.
        if official_start is None and historical_page is None:
            fail(f"cronologia governi: data iniziale assente per {source_label}")
        if official_start is not None and official_start != item["startDate"]:
            fail(f"cronologia governi: data iniziale divergente per {source_label}")
        official_end = chronology_end_date(line)
        if item["status"] == "ended" and official_end is None and historical_page is None:
            fail(f"cronologia governi: data finale assente per {source_label}")
        if item["status"] == "ended" and official_end is not None and official_end != item["endDate"]:
            fail(f"cronologia governi: data finale divergente per {source_label}")
    if "in carica" not in official[0].lower() or expected[0]["status"] != "current":
        fail("cronologia governi: governo corrente divergente")

    return [
        {key: item[key] for key in ("id", "name", "startDate", "endDate", "status")}
        for item in governments
    ]


def build_snapshot(
    spec: dict[str, Any],
    ameco_payload: bytes,
    chronology_payload: bytes,
    retrieved_at: str,
    historical_payloads: dict[str, bytes],
) -> dict[str, Any]:
    validate_spec(spec)
    try:
        timestamp = datetime.fromisoformat(retrieved_at.replace("Z", "+00:00"))
    except ValueError:
        fail("retrievedAt: timestamp non valido")
    if timestamp.tzinfo is None or not retrieved_at.endswith("Z"):
        fail("retrievedAt: timestamp UTC atteso")
    ameco = spec["ameco"]
    chronology = spec["governmentChronology"]
    historical_receipts = extract_historical_receipts(spec, historical_payloads, retrieved_at)
    return {
        "schemaVersion": 1,
        "methodologyVersion": spec["methodologyVersion"],
        "generatedAt": retrieved_at,
        "sources": {
            "ameco": {
                "owner": ameco["owner"],
                "title": ameco["title"],
                "release": ameco["release"],
                "releaseDate": ameco["releaseDate"],
                "landingUrl": ameco["landingUrl"],
                "downloadUrl": ameco["downloadUrl"],
                "termsUrl": ameco["termsUrl"],
                "license": ameco["license"],
                "cadence": ameco["cadence"],
                "geography": ameco["geography"],
                "referencePeriod": ameco["referencePeriod"],
                "publication": ameco["publication"],
                "retrievedAt": retrieved_at,
                "bytes": len(ameco_payload),
                "sha256": sha256_bytes(ameco_payload),
                "observedThrough": ameco["observedThrough"],
                "forecastFrom": ameco["forecastFrom"],
                "forecastThrough": ameco["forecastThrough"],
            },
            "governmentChronology": {
                "owner": chronology["owner"],
                "title": chronology["title"],
                "pageUrl": chronology["pageUrl"],
                "termsUrl": chronology["termsUrl"],
                "cadence": chronology["cadence"],
                "geography": chronology["geography"],
                "referencePeriod": chronology["referencePeriod"],
                "publication": chronology["publication"],
                "historicalOwner": chronology["historicalOwner"],
                "dateMeaning": chronology["dateMeaning"],
                "retrievedAt": retrieved_at,
                "bytes": len(chronology_payload),
                "sha256": sha256_bytes(chronology_payload),
                "historicalReceipts": historical_receipts,
            },
        },
        "method": spec["method"],
        "indicators": extract_ameco(spec, ameco_payload),
        "governments": extract_governments(spec, chronology_payload),
        "contexts": spec["contexts"],
        "measures": spec["measures"],
        "caveats": [
            "Il Core annuale non è la pagella socio-economica completa raccomandata per il periodo dal 2005.",
            "I governi precedenti al 1995 sono mostrati come storia e contesto senza voto complessivo.",
            "I valori 2025-2027 sono previsioni AMECO e non vengono mescolati con le osservazioni fino al 2024.",
            "Il confronto descrive risultati durante un mandato e non identifica quanto sia stato causato dal governo.",
            "La banca dati usa l'ultimo vintage AMECO: le serie storiche possono essere state riviste dopo i governi osservati.",
        ],
    }


def validate_snapshot(snapshot: dict[str, Any]) -> None:
    exact_keys(snapshot, {"schemaVersion", "methodologyVersion", "generatedAt", "sources", "method", "indicators", "governments", "contexts", "measures", "caveats"}, "snapshot")
    if snapshot["schemaVersion"] != 1 or snapshot["methodologyVersion"] != "core-annual-v4":
        fail("snapshot: versione non supportata")
    sources = require_dict(snapshot["sources"], "sources")
    if set(sources) != {"ameco", "governmentChronology"}:
        fail("snapshot: fonti inattese")
    for source_id, source in sources.items():
        item = require_dict(source, f"sources.{source_id}")
        if not SHA256.fullmatch(str(item.get("sha256", ""))) or not isinstance(item.get("bytes"), int) or item["bytes"] <= 0:
            fail(f"sources.{source_id}: hash o bytes non validi")
    canonical_spec = read_json_object(DEFAULT_SPEC, "canonical source spec")
    validate_spec(canonical_spec)
    chronology_source = require_dict(sources["governmentChronology"], "sources.governmentChronology")
    if chronology_source.get("historicalOwner") != "Camera dei deputati · Portale storico":
        fail("snapshot: titolare delle fonti storiche inatteso")
    if chronology_source.get("dateMeaning") != GOVERNMENT_DATE_BOUNDARY_MEANING:
        fail("snapshot: significato delle date inatteso")
    receipts = require_list(chronology_source.get("historicalReceipts"), "sources.governmentChronology.historicalReceipts")
    expected_pages = require_list(canonical_spec["governmentChronology"].get("historicalPages"), "canonical governmentChronology.historicalPages")
    if len(receipts) != len(expected_pages):
        fail("snapshot: ricevute Camera incomplete")
    for receipt_raw, page_raw in zip(receipts, expected_pages, strict=True):
        receipt = require_dict(receipt_raw, "sources.governmentChronology.historicalReceipt")
        page = require_dict(page_raw, "canonical governmentChronology.historicalPage")
        exact_keys(receipt, {
            "governmentId", "sourceLabel", "pageTitle", "pageUrl", "startDate", "endDate",
            "retrievedAt", "bytes", "sha256",
        }, "sources.governmentChronology.historicalReceipt")
        for field in ("governmentId", "sourceLabel", "pageTitle", "pageUrl", "startDate", "endDate"):
            if receipt.get(field) != page.get(field):
                fail(f"snapshot: ricevuta Camera divergente ({field})")
        if receipt.get("retrievedAt") != chronology_source.get("retrievedAt"):
            fail("snapshot: timestamp ricevuta Camera divergente")
        if not SHA256.fullmatch(str(receipt.get("sha256", ""))) or not isinstance(receipt.get("bytes"), int) or receipt["bytes"] <= 0:
            fail("snapshot: hash o bytes ricevuta Camera non validi")
    manifest = load_methodology_manifest(canonical_spec)
    if snapshot["method"] != manifest["method"]:
        fail("snapshot: metodo divergente")
    indicators = require_list(snapshot["indicators"], "indicators")
    if len(indicators) != len(manifest["indicators"]):
        fail("snapshot: paniere non valido")
    for item, expected_indicator in zip(indicators, manifest["indicators"], strict=True):
        expected_keys = {
            "id", "sourceId", "area", "label", "weightBasisPoints", "direction", "transformation",
            "unit", "limitations", "referencePeriod", "coverageNotes", "sourceSeries", "sourceCodes", "countries",
        }
        if "derived" in expected_indicator:
            expected_keys.add("derived")
        exact_keys(item, expected_keys, f"snapshot.indicator.{item.get('id')}")
        if item["sourceId"] != "ameco":
            fail("snapshot: fonte indicatore divergente")
        if item["referencePeriod"] != "annual, 1960-2027; observations through 2024; forecasts from 2025":
            fail("snapshot: periodo indicatore divergente")
        if item["coverageNotes"] != "Unavailable country-years remain explicit null values; 1995-2024 is mandatory for every country, while 2025-2027 is published only as a complete forecast scenario.":
            fail("snapshot: copertura indicatore divergente")
        for field in ("id", "area", "label", "weightBasisPoints", "direction", "transformation", "unit", "limitations"):
            if item.get(field) != expected_indicator[field]:
                fail(f"snapshot: manifest indicatore divergente ({field})")
        if item.get("sourceSeries") != expected_indicator["sourceSeries"]:
            fail(f"snapshot: provenance serie divergente ({item.get('id')})")
        if "derived" in expected_indicator:
            if item.get("derived") != expected_indicator["derived"]:
                fail(f"snapshot: formula derivata divergente ({item.get('id')})")
        elif "derived" in item:
            fail(f"snapshot: formula derivata inattesa ({item.get('id')})")
        source_codes = require_dict(item.get("sourceCodes"), f"{item.get('id')}.sourceCodes")
        expected_templates = [source["codeTemplate"] for source in expected_indicator["sourceSeries"]]
        for country_id, country_code in manifest["countryCodes"].items():
            expected_codes = [template.format(country=country_code) for template in expected_templates]
            if source_codes.get(country_id) != expected_codes:
                fail(f"snapshot: codici serie divergenti per {item.get('id')}.{country_id}")
        valid_range = INDICATOR_VALUE_RANGES.get(item.get("id"))
        if valid_range is None:
            fail("snapshot: indicatore inatteso")
        minimum, maximum = valid_range
        countries = require_dict(item.get("countries"), f"{item.get('id')}.countries")
        if tuple(countries) != COUNTRY_IDS:
            fail(f"{item.get('id')}: paesi inattesi")
        for country_id, values in countries.items():
            if len(values) != len(EXPECTED_YEARS) or [point.get("year") for point in values] != list(EXPECTED_YEARS):
                fail(f"{item.get('id')}.{country_id}: anni inattesi")
            for point in values:
                value = point.get("value")
                if value is not None and (not isinstance(value, (int, float)) or isinstance(value, bool) or not math.isfinite(value)):
                    fail(f"{item.get('id')}.{country_id}: valore non valido")
                if value is not None and not minimum <= value <= maximum:
                    fail(f"{item.get('id')}.{country_id}: valore fuori intervallo plausibile")
            observed_through = sources["ameco"].get("observedThrough")
            if not isinstance(observed_through, int) or any(values[year - 1960].get("value") is None for year in range(1995, observed_through + 1)):
                fail(f"{item.get('id')}.{country_id}: dato obbligatorio mancante dal 1995")
    governments = require_list(snapshot["governments"], "governments")
    expected_governments = [
        {key: item[key] for key in ("id", "name", "startDate", "endDate", "status")}
        for item in canonical_spec["governmentChronology"]["governments"]
    ]
    if governments != expected_governments:
        fail("snapshot: cronologia governi divergente")
    current = [item for item in governments if item.get("status") == "current"]
    if len(governments) < 17 or len(current) != 1 or current[0] is not governments[-1]:
        fail("snapshot: cronologia governi incompleta")
    government_names = {item["name"] for item in governments}
    for measure in require_list(snapshot["measures"], "measures"):
        if measure.get("government") not in government_names:
            fail(f"snapshot: misura associata a governo assente {measure.get('government')}")
    if len(require_list(snapshot["caveats"], "caveats")) < 4:
        fail("snapshot: caveat insufficienti")


def atomic_write(path: Path, snapshot: dict[str, Any]) -> None:
    path.parent.mkdir(parents=True, exist_ok=True)
    payload = json.dumps(snapshot, ensure_ascii=False, indent=2, sort_keys=False) + "\n"
    with tempfile.NamedTemporaryFile("w", encoding="utf-8", dir=path.parent, delete=False) as handle:
        handle.write(payload)
        temp_path = Path(handle.name)
    os.replace(temp_path, path)


def load_json(path: Path) -> dict[str, Any]:
    try:
        value = json.loads(path.read_text(encoding="utf-8"))
    except (OSError, json.JSONDecodeError) as error:
        fail(f"{path}: JSON non valido ({error})")
    return require_dict(value, str(path))


def main() -> None:
    parser = argparse.ArgumentParser()
    parser.add_argument("--spec", type=Path, default=DEFAULT_SPEC)
    parser.add_argument("--output", type=Path, default=DEFAULT_OUTPUT)
    parser.add_argument("--ameco-input", type=Path)
    parser.add_argument("--chronology-input", type=Path)
    parser.add_argument(
        "--chronology-history-dir",
        "--historical-chronology-dir",
        dest="chronology_history_dir",
        type=Path,
        help="directory of explicit Camera fixtures named <governmentId>.html",
    )
    parser.add_argument("--retrieved-at")
    parser.add_argument("--check", action="store_true")
    args = parser.parse_args()

    spec = load_json(args.spec)
    validate_spec(spec)
    if args.check:
        validate_snapshot(load_json(args.output))
        print(f"ok: {args.output}")
        return

    ameco_payload = args.ameco_input.read_bytes() if args.ameco_input else download(spec["ameco"]["downloadUrl"], MAX_AMECO_BYTES, "AMECO")
    chronology_payload = args.chronology_input.read_bytes() if args.chronology_input else download(spec["governmentChronology"]["pageUrl"], MAX_CHRONOLOGY_BYTES, "cronologia governi")
    historical_payloads = load_historical_payloads(spec, args.chronology_history_dir)
    retrieved_at = args.retrieved_at or datetime.now(UTC).isoformat(timespec="seconds").replace("+00:00", "Z")
    snapshot = build_snapshot(spec, ameco_payload, chronology_payload, retrieved_at, historical_payloads)
    validate_snapshot(snapshot)
    atomic_write(args.output, snapshot)
    print(f"wrote: {args.output}")


if __name__ == "__main__":
    try:
        main()
    except SnapshotError as error:
        raise SystemExit(f"error: {error}") from error
