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
from typing import Any


ROOT = Path(__file__).resolve().parents[2]
DEFAULT_SPEC = ROOT / "scripts/etl/specs/government-scorecard.source.json"
DEFAULT_OUTPUT = ROOT / "src/data/generated/government-scorecard.json"
MAX_AMECO_BYTES = 10 * 1024 * 1024
MAX_AMECO_UNCOMPRESSED_BYTES = 80 * 1024 * 1024
MAX_CHRONOLOGY_BYTES = 2 * 1024 * 1024
COUNTRY_IDS = ("italy", "france", "germany", "spain")
EXPECTED_YEARS = tuple(range(1960, 2028))
ISO_DATE = re.compile(r"^\d{4}-\d{2}-\d{2}$")
SHA256 = re.compile(r"^[0-9a-f]{64}$")
class SnapshotError(ValueError):
    """Raised when an input or generated snapshot violates the contract."""


def fail(message: str) -> None:
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


def validate_spec(spec: dict[str, Any]) -> None:
    exact_keys(spec, {"schemaVersion", "methodologyVersion", "ameco", "governmentChronology", "method", "contexts", "measures"}, "source spec")
    if spec["schemaVersion"] != 1 or spec["methodologyVersion"] != "core-annual-v2":
        fail("source spec: versione non supportata")
    ameco = require_dict(spec["ameco"], "ameco")
    chronology = require_dict(spec["governmentChronology"], "governmentChronology")
    validate_official_url(ameco.get("downloadUrl"), ameco.get("allowedHost", ""), ameco.get("allowedPath", ""))
    validate_official_url(chronology.get("pageUrl"), chronology.get("allowedHost", ""), chronology.get("allowedPath", ""))
    countries = require_dict(ameco.get("countries"), "ameco.countries")
    if tuple(countries) != COUNTRY_IDS or len({item.get("code") for item in countries.values()}) != 4:
        fail("ameco.countries: set non autorizzato")
    series = require_list(ameco.get("series"), "ameco.series")
    if len(series) != 6 or sum(item.get("weightBasisPoints", 0) for item in series if isinstance(item, dict)) != 10_000:
        fail("ameco.series: paniere o pesi non validi")
    ids: set[str] = set()
    for raw in series:
        item = require_dict(raw, "ameco.series item")
        if item.get("id") in ids or item.get("direction") not in {"higher", "lower"}:
            fail("ameco.series: id duplicato o direzione non valida")
        if item.get("transformation") not in {"log-change", "point-change", "level"}:
            fail("ameco.series: trasformazione non valida")
        ids.add(item["id"])
    method = require_dict(spec["method"], "method")
    if method.get("firstScoreYear") != 1995 or method.get("minimumWindowYears") != 1:
        fail("method: soglie non autorizzate")
    if method.get("historicalWeightBasisPoints") + method.get("peerWeightBasisPoints") != 10_000:
        fail("method: pesi storico/peer non validi")
    governments = require_list(chronology.get("governments"), "governmentChronology.governments")
    if len(governments) != 17:
        fail("governmentChronology: cronologia 1995+ incompleta")
    previous_start = ""
    for government in governments:
        item = require_dict(government, "governmentChronology.government")
        exact_keys(item, {"id", "name", "startDate", "endDate", "status"}, "governmentChronology.government")
        if not ISO_DATE.fullmatch(item.get("startDate", "")) or item["startDate"] <= previous_start:
            fail("governmentChronology: date non valide o non ordinate")
        if item["endDate"] is not None and not ISO_DATE.fullmatch(item["endDate"]):
            fail("governmentChronology: data finale non valida")
        previous_start = item["startDate"]
    if governments[-1] != {"id": "meloni-i", "name": "Meloni-I", "startDate": "2022-10-22", "endDate": None, "status": "current"}:
        fail("governmentChronology: governo corrente inatteso")
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
            "id": item["id"],
            "area": item["area"],
            "label": item["label"],
            "weightBasisPoints": item["weightBasisPoints"],
            "direction": item["direction"],
            "transformation": item["transformation"],
            "unit": item["unit"],
            "limitations": item["limitations"],
            "sourceCodes": source_codes,
            "countries": countries,
        })
    return output


def extract_governments(spec: dict[str, Any], payload: bytes) -> list[dict[str, Any]]:
    try:
        text = payload.decode("utf-8")
    except UnicodeDecodeError:
        fail("cronologia governi: HTML non UTF-8")
    required_markers = ["I Governi nelle Legislature", "Governo Meloni", "Governo Berlusconi II", "Governo Dini"]
    if any(marker not in text for marker in required_markers):
        fail("cronologia governi: pagina ufficiale inattesa")
    return spec["governmentChronology"]["governments"]


def build_snapshot(spec: dict[str, Any], ameco_payload: bytes, chronology_payload: bytes, retrieved_at: str) -> dict[str, Any]:
    try:
        timestamp = datetime.fromisoformat(retrieved_at.replace("Z", "+00:00"))
    except ValueError:
        fail("retrievedAt: timestamp non valido")
    if timestamp.tzinfo is None or not retrieved_at.endswith("Z"):
        fail("retrievedAt: timestamp UTC atteso")
    ameco = spec["ameco"]
    chronology = spec["governmentChronology"]
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
                "retrievedAt": retrieved_at,
                "bytes": len(chronology_payload),
                "sha256": sha256_bytes(chronology_payload),
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
    if snapshot["schemaVersion"] != 1 or snapshot["methodologyVersion"] != "core-annual-v2":
        fail("snapshot: versione non supportata")
    sources = require_dict(snapshot["sources"], "sources")
    if set(sources) != {"ameco", "governmentChronology"}:
        fail("snapshot: fonti inattese")
    for source_id, source in sources.items():
        item = require_dict(source, f"sources.{source_id}")
        if not SHA256.fullmatch(str(item.get("sha256", ""))) or not isinstance(item.get("bytes"), int) or item["bytes"] <= 0:
            fail(f"sources.{source_id}: hash o bytes non validi")
    indicators = require_list(snapshot["indicators"], "indicators")
    if len(indicators) != 6 or sum(item["weightBasisPoints"] for item in indicators) != 10_000:
        fail("snapshot: paniere non valido")
    for item in indicators:
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
            if any(values[year - 1960].get("value") is None for year in range(1995, 2028)):
                fail(f"{item.get('id')}.{country_id}: dato obbligatorio mancante dal 1995")
    governments = require_list(snapshot["governments"], "governments")
    if len(governments) != 17 or sum(item.get("status") == "current" for item in governments) != 1:
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
    retrieved_at = args.retrieved_at or datetime.now(UTC).isoformat(timespec="seconds").replace("+00:00", "Z")
    snapshot = build_snapshot(spec, ameco_payload, chronology_payload, retrieved_at)
    validate_snapshot(snapshot)
    atomic_write(args.output, snapshot)
    print(f"wrote: {args.output}")


if __name__ == "__main__":
    try:
        main()
    except SnapshotError as error:
        raise SystemExit(f"error: {error}") from error
