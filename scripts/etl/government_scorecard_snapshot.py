#!/usr/bin/env python3
"""Build and validate the AMECO observations used by the government scorecard."""

from __future__ import annotations

import argparse
import csv
import hashlib
import io
import json
import math
import os
import re
import tempfile
import urllib.parse
import urllib.request
import zipfile
from datetime import UTC, datetime
from decimal import Decimal, InvalidOperation
from pathlib import Path, PurePosixPath
from typing import Any, NoReturn


ROOT = Path(__file__).resolve().parents[2]
DEFAULT_SPEC = ROOT / "scripts/etl/specs/government-scorecard.source.json"
DEFAULT_METHODOLOGY = ROOT / "scripts/etl/specs/government-scorecard-methodology.json"
DEFAULT_OUTPUT = ROOT / "src/data/generated/government-scorecard.json"
MAX_DOWNLOAD_BYTES = 10 * 1024 * 1024
MAX_UNCOMPRESSED_BYTES = 80 * 1024 * 1024
EXPECTED_ARCHIVE_FILES = {f"AMECO{index}.CSV" for index in range(1, 19)}
EXPECTED_YEARS = tuple(range(1960, 2028))
COUNTRIES = (("italy", "ITA"), ("france", "FRA"), ("germany", "DEU"), ("spain", "ESP"))
VALUE_RANGES = {
    "real_compensation": (0, 1_000),
    "unemployment": (0, 100),
    "real_gdp_per_capita": (0, 1_000),
    "debt_ratio": (0, 1_000),
    "primary_balance": (-100, 100),
    "investment_share": (0, 100),
}


class SnapshotError(ValueError):
    """Raised when an official input or generated artifact violates the contract."""


def fail(message: str) -> NoReturn:
    raise SnapshotError(message)


def exact_keys(value: dict[str, Any], expected: set[str], label: str) -> None:
    if set(value) != expected:
        fail(f"{label}: chiavi inattese")


def require_dict(value: Any, label: str) -> dict[str, Any]:
    if not isinstance(value, dict):
        fail(f"{label}: oggetto atteso")
    return value


def require_list(value: Any, label: str) -> list[Any]:
    if not isinstance(value, list):
        fail(f"{label}: lista attesa")
    return value


def load_json(path: Path, label: str | None = None) -> dict[str, Any]:
    try:
        return require_dict(json.loads(path.read_text(encoding="utf-8")), label or str(path))
    except (OSError, UnicodeDecodeError, json.JSONDecodeError) as error:
        fail(f"{label or path}: JSON non valido ({error})")


def sha256(payload: bytes) -> str:
    return hashlib.sha256(payload).hexdigest()


def validate_https_url(value: Any, hostname: str, path: str | None = None) -> str:
    if not isinstance(value, str):
        fail("URL: stringa attesa")
    parsed = urllib.parse.urlparse(value)
    if (
        parsed.scheme != "https"
        or parsed.hostname != hostname
        or parsed.port not in (None, 443)
        or parsed.username is not None
        or parsed.password is not None
        or parsed.fragment
        or (path is not None and parsed.path != path)
    ):
        fail(f"URL ufficiale inatteso: {value}")
    return value


def source_series_from_config(item: dict[str, Any]) -> list[dict[str, str]]:
    configs = [item["numerator"], item["denominator"]] if "derived" in item else [item]
    return [
        {
            "file": config["file"],
            "codeTemplate": config["codeTemplate"],
            "title": config["title"],
            "unit": config["unit"],
        }
        for config in configs
    ]


def source_series_from_method(item: dict[str, Any]) -> list[dict[str, str]]:
    return [
        {
            "file": source["file"],
            "codeTemplate": source["selector_template"],
            "title": source["series_label"],
            "unit": source["unit"],
        }
        for source in item["source_series"]
    ]


def validate_spec(spec: dict[str, Any]) -> dict[str, Any]:
    exact_keys(spec, {"schemaVersion", "methodologyVersion", "methodologyManifest", "ameco"}, "source spec")
    if spec["schemaVersion"] != 2 or spec["methodologyVersion"] != "peer-relative-v6":
        fail("source spec: versione non supportata")
    if spec["methodologyManifest"] != "scripts/etl/specs/government-scorecard-methodology.json":
        fail("source spec: manifest inatteso")
    method = load_json(DEFAULT_METHODOLOGY, "methodology manifest")
    if method.get("schema_version") != 1 or method.get("methodology_version") != "peer-relative-v6":
        fail("methodology manifest: versione non supportata")
    if method.get("countries") != ["IT", "FR", "DE", "ES"] or method.get("peers") != ["FR", "DE", "ES"]:
        fail("methodology manifest: paesi inattesi")
    ameco = require_dict(spec["ameco"], "ameco")
    validate_https_url(ameco.get("downloadUrl"), "ec.europa.eu", "/economy_finance/db_indicators/ameco/documents/ameco0_csv.zip")
    validate_https_url(ameco.get("landingUrl"), "economy-finance.ec.europa.eu")
    validate_https_url(ameco.get("termsUrl"), "commission.europa.eu")
    if (
        ameco.get("owner") != "European Commission, Directorate-General for Economic and Financial Affairs"
        or ameco.get("license") != "CC BY 4.0 unless otherwise indicated"
        or ameco.get("observedThrough") != method.get("source", {}).get("observed_through")
        or ameco.get("forecastFrom") != method.get("source", {}).get("forecast_from")
        or ameco.get("forecastThrough") != method.get("source", {}).get("forecast_through")
        or ameco.get("encoding") != "latin-1"
    ):
        fail("ameco: metadati inattesi")
    if (any(type(ameco.get(key)) is not int for key in ("observedThrough", "forecastFrom", "forecastThrough"))
            or not 1995 <= ameco["observedThrough"] < ameco["forecastFrom"] <= ameco["forecastThrough"] <= 2100
            or ameco["forecastFrom"] != ameco["observedThrough"] + 1
            or ameco["release"] != method["source"]["vintage"]
            or re.fullmatch(r"(?:Spring|Autumn) \d{4} Economic Forecast", ameco["release"]) is None):
        fail("AMECO: observed and forecast periods or vintage diverge")
    countries = require_dict(ameco.get("countries"), "ameco.countries")
    if tuple((key, value.get("code")) for key, value in countries.items()) != COUNTRIES:
        fail("ameco.countries: set inatteso")
    if [value.get("currencyCode") for value in countries.values()] != ["EURO-ITL", "EURO-FRF", "EURO-DEM", "EURO-ESP"]:
        fail("ameco.countries: currency identity mismatch")
    source_items = require_list(ameco.get("series"), "ameco.series")
    method_items = require_list(method.get("indicators"), "method.indicators")
    if len(source_items) != 6 or len(method_items) != 6:
        fail("paniere indicatori incompleto")
    for source_item, method_item in zip(source_items, method_items, strict=True):
        source_item = require_dict(source_item, "ameco.series item")
        method_item = require_dict(method_item, "method.indicator")
        if (
            source_item.get("id") != method_item.get("id")
            or source_item.get("direction") != method_item.get("direction")
            or str(source_item.get("transformation", "")).replace("-", "_") != method_item.get("transformation")
            or source_item.get("unit") != method_item.get("unit")
            or source_series_from_config(source_item) != source_series_from_method(method_item)
        ):
            fail(f"ameco.series: divergenza dal metodo ({source_item.get('id')})")
    return method


def download(url: str) -> bytes:
    request = urllib.request.Request(
        url,
        headers={"User-Agent": "DoveVannoINostriSoldi/1.0", "Accept": "application/zip"},
    )
    with urllib.request.urlopen(request, timeout=45) as response:
        final = urllib.parse.urlparse(response.geturl())
        if final.scheme != "https" or final.hostname != "ec.europa.eu":
            fail("AMECO: redirect fuori dall'origine ufficiale")
        payload = response.read(MAX_DOWNLOAD_BYTES + 1)
    if len(payload) == 0 or len(payload) > MAX_DOWNLOAD_BYTES:
        fail("AMECO: dimensione download non valida")
    return payload


def safe_archive(payload: bytes) -> dict[str, bytes]:
    try:
        archive = zipfile.ZipFile(io.BytesIO(payload))
    except zipfile.BadZipFile:
        fail("AMECO: ZIP non valido")
    members: dict[str, bytes] = {}
    with archive:
        entries = archive.infolist()
        names = [item.filename for item in entries]
        if len(names) != len(set(names)) or set(names) != EXPECTED_ARCHIVE_FILES:
            fail("AMECO: set dei file inatteso")
        total = 0
        for item in entries:
            path = PurePosixPath(item.filename)
            if path.is_absolute() or ".." in path.parts or item.is_dir():
                fail("AMECO: membro ZIP non sicuro")
            total += item.file_size
            if total > MAX_UNCOMPRESSED_BYTES:
                fail("AMECO: archivio decompresso troppo grande")
            members[item.filename] = archive.read(item)
    return members


def ameco_rows(payload: bytes, encoding: str, label: str, years=EXPECTED_YEARS) -> dict[str, dict[str, str]]:
    try:
        text = payload.decode(encoding)
    except (UnicodeDecodeError, LookupError):
        fail(f"{label}: encoding non valido")
    reader = csv.DictReader(io.StringIO(text, newline=""))
    expected = ["CODE", "COUNTRY", "SUB-CHAPTER", "TITLE", "UNIT", *map(str, years), f"Unnamed: {len(years) + 5}"]
    if reader.fieldnames != expected:
        fail(f"{label}: intestazione CSV inattesa")
    rows: dict[str, dict[str, str]] = {}
    for row in reader:
        if None in row or any(value is None for value in row.values()):
            fail(f"{label}: riga non valida")
        if row["CODE"] in rows:
            fail(f"{label}: codice duplicato {row['CODE']}")
        rows[row["CODE"]] = row
    return rows


def decimal_value(raw: Any, label: str) -> float | None:
    if raw is None or str(raw).strip() in {"", ":", "NA"}:
        return None
    try:
        value = float(Decimal(str(raw).strip().replace(",", ".")))
    except (InvalidOperation, ValueError):
        fail(f"{label}: numero non valido")
    if not math.isfinite(value):
        fail(f"{label}: numero non finito")
    return value


def extract_indicators(spec: dict[str, Any], method: dict[str, Any], payload: bytes) -> list[dict[str, Any]]:
    ameco = spec["ameco"]
    archive = safe_archive(payload)
    configs = ameco["series"]
    needed_files = {
        source["file"]
        for item in configs
        for source in ([item["numerator"], item["denominator"]] if "derived" in item else [item])
    }
    years = tuple(range(1960, ameco["forecastThrough"] + 1))
    files = {name: ameco_rows(archive[name], ameco["encoding"], name, years) for name in needed_files}
    method_by_id = {item["id"]: item for item in method["indicators"]}
    def source_row(config, country_id, country_code):
        code = config["codeTemplate"].format(country=country_code)
        row = files[config["file"]].get(code)
        expected_unit = config["rawUnitTemplate"].format(currency=ameco["countries"][country_id]["currencyCode"])
        if (row is None or row["TITLE"] != config["title"] or row["UNIT"] != expected_unit
                or row["COUNTRY"] != country_id.title()):
            fail(f"AMECO: serie mancante o identita divergente {code}")
        return code, row

    output: list[dict[str, Any]] = []
    for item in configs:
        method_item = method_by_id[item["id"]]
        countries: dict[str, list[dict[str, Any]]] = {}
        source_codes: dict[str, list[str]] = {}
        for country_id, country_code in COUNTRIES:
            values: list[dict[str, Any]] = []
            if "derived" in item:
                left_config, right_config = item["numerator"], item["denominator"]
                left_code, left_row = source_row(left_config, country_id, country_code)
                right_code, right_row = source_row(right_config, country_id, country_code)
                for year in years:
                    left = decimal_value(left_row[str(year)], f"{left_code}.{year}")
                    right = decimal_value(right_row[str(year)], f"{right_code}.{year}")
                    if left is None or right is None:
                        value = None
                    elif right <= 0:
                        fail(f"AMECO: denominatore non positivo {right_code}.{year}")
                    else:
                        value = round(left / right * 100, 8)
                    values.append({"year": year, "value": value})
                source_codes[country_id] = [left_code, right_code]
            else:
                code, row = source_row(item, country_id, country_code)
                values = [{"year": year, "value": decimal_value(row[str(year)], f"{code}.{year}")} for year in years]
                source_codes[country_id] = [code]
            countries[country_id] = values
        output.append({
            "id": item["id"],
            "sourceId": "ameco",
            "direction": item["direction"],
            "transformation": item["transformation"],
            "unit": item["unit"],
            "definition": method_item["definition"],
            "sourceSeries": source_series_from_method(method_item),
            "sourceCodes": source_codes,
            "countries": countries,
        })
    return output


def build_snapshot(spec: dict[str, Any], payload: bytes, retrieved_at: str) -> dict[str, Any]:
    method = validate_spec(spec)
    try:
        timestamp = datetime.fromisoformat(retrieved_at.replace("Z", "+00:00"))
    except ValueError:
        fail("retrievedAt: timestamp non valido")
    if timestamp.tzinfo is None or not retrieved_at.endswith("Z"):
        fail("retrievedAt: timestamp UTC atteso")
    ameco = spec["ameco"]
    source = {
        key: ameco[key]
        for key in (
            "owner", "title", "release", "releaseDate", "landingUrl", "downloadUrl", "termsUrl",
            "license", "cadence", "geography", "referencePeriod", "publication", "observedThrough",
            "forecastFrom", "forecastThrough",
        )
    }
    source.update({"retrievedAt": retrieved_at, "bytes": len(payload), "sha256": sha256(payload)})
    return {
        "schemaVersion": 2,
        "methodologyVersion": "peer-relative-v6",
        "generatedAt": retrieved_at,
        "sources": {"ameco": source},
        "indicators": extract_indicators(spec, method, payload),
        "caveats": [
            "Il voto usa soltanto osservazioni annuali comuni ai quattro paesi; le previsioni sono escluse.",
            "Il confronto descrive risultati durante un mandato e non dimostra quanto sia stato causato dal governo.",
            "La banca dati usa l'ultimo vintage AMECO: le serie storiche possono essere riviste.",
        ],
    }


def validate_snapshot(snapshot: dict[str, Any]) -> None:
    exact_keys(snapshot, {"schemaVersion", "methodologyVersion", "generatedAt", "sources", "indicators", "caveats"}, "snapshot")
    if snapshot["schemaVersion"] != 2 or snapshot["methodologyVersion"] != "peer-relative-v6":
        fail("snapshot: versione non supportata")
    spec = load_json(DEFAULT_SPEC, "source spec")
    method = validate_spec(spec)
    exact_keys(require_dict(snapshot["sources"], "sources"), {"ameco"}, "sources")
    source = require_dict(snapshot["sources"].get("ameco"), "sources.ameco")
    ameco = spec["ameco"]
    for field in (
        "owner", "title", "release", "releaseDate", "landingUrl", "downloadUrl", "termsUrl", "license",
        "cadence", "geography", "referencePeriod", "publication", "observedThrough", "forecastFrom", "forecastThrough",
    ):
        if source.get(field) != ameco.get(field):
            fail(f"snapshot: metadato fonte divergente ({field})")
    if not isinstance(source.get("bytes"), int) or source["bytes"] <= 0 or not isinstance(source.get("sha256"), str) or re.fullmatch(r"[0-9a-f]{64}", source["sha256"]) is None:
        fail("snapshot: ricevuta AMECO non valida")
    years = list(range(1960, source["forecastThrough"] + 1))
    indicators = require_list(snapshot["indicators"], "indicators")
    if [item.get("id") for item in indicators] != [item["id"] for item in method["indicators"]]:
        fail("snapshot: ordine indicatori divergente")
    for item, expected in zip(indicators, method["indicators"], strict=True):
        exact_keys(item, {"id", "sourceId", "direction", "transformation", "unit", "definition", "sourceSeries", "sourceCodes", "countries"}, f"indicator.{item.get('id')}")
        if (
            item["sourceId"] != "ameco"
            or item["direction"] != expected["direction"]
            or item["transformation"].replace("-", "_") != expected["transformation"]
            or item["unit"] != expected["unit"]
            or item["definition"] != expected["definition"]
            or item["sourceSeries"] != source_series_from_method(expected)
        ):
            fail(f"snapshot: contratto indicatore divergente ({item['id']})")
        expected_codes = {country: [source["selector_template"].format(country=code) for source in expected["source_series"]] for country, code in COUNTRIES}
        if item["sourceCodes"] != expected_codes:
            fail("snapshot: source series identity mismatch")
        minimum, maximum = VALUE_RANGES[item["id"]]
        countries = require_dict(item["countries"], f"{item['id']}.countries")
        if tuple(countries) != tuple(country_id for country_id, _ in COUNTRIES):
            fail(f"{item['id']}: paesi inattesi")
        for country_id, points in countries.items():
            if len(points) != len(years) or [point.get("year") for point in points] != years:
                fail(f"{item['id']}.{country_id}: anni inattesi")
            for point in points:
                value = point.get("value")
                if value is not None and (isinstance(value, bool) or not isinstance(value, (int, float)) or not math.isfinite(value) or not minimum <= value <= maximum):
                    fail(f"{item['id']}.{country_id}: valore non valido")
            if any(points[year - 1960].get("value") is None for year in range(1995, source["observedThrough"] + 1)):
                fail(f"{item['id']}.{country_id}: osservazione obbligatoria mancante")
    if len(require_list(snapshot["caveats"], "caveats")) < 3:
        fail("snapshot: limiti insufficienti")


def atomic_write(path: Path, snapshot: dict[str, Any]) -> None:
    payload = json.dumps(snapshot, ensure_ascii=False, indent=2) + "\n"
    path.parent.mkdir(parents=True, exist_ok=True)
    temporary: Path | None = None
    try:
        with tempfile.NamedTemporaryFile("w", encoding="utf-8", dir=path.parent, delete=False) as handle:
            temporary = Path(handle.name)
            handle.write(payload)
            handle.flush()
            os.fsync(handle.fileno())
        os.replace(temporary, path)
        temporary = None
    finally:
        if temporary is not None:
            temporary.unlink(missing_ok=True)


def main() -> None:
    parser = argparse.ArgumentParser()
    parser.add_argument("--spec", type=Path, default=DEFAULT_SPEC)
    parser.add_argument("--output", type=Path, default=DEFAULT_OUTPUT)
    parser.add_argument("--ameco-input", type=Path)
    parser.add_argument("--retrieved-at")
    parser.add_argument("--check", action="store_true")
    args = parser.parse_args()
    spec = load_json(args.spec, "source spec")
    validate_spec(spec)
    if args.check:
        validate_snapshot(load_json(args.output, "snapshot"))
        print(f"ok: {args.output}")
        return
    payload = args.ameco_input.read_bytes() if args.ameco_input else download(spec["ameco"]["downloadUrl"])
    retrieved_at = args.retrieved_at or datetime.now(UTC).isoformat(timespec="seconds").replace("+00:00", "Z")
    snapshot = build_snapshot(spec, payload, retrieved_at)
    validate_snapshot(snapshot)
    atomic_write(args.output, snapshot)
    validate_snapshot(load_json(args.output, "snapshot"))
    print(f"wrote: {args.output}")


if __name__ == "__main__":
    try:
        main()
    except SnapshotError as error:
        raise SystemExit(f"error: {error}") from error
