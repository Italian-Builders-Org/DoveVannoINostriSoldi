#!/usr/bin/env python3
"""Build and validate the versioned public-debt snapshot.

The module intentionally uses only the Python standard library.  Every remote
payload is treated as untrusted and is parsed in memory after strict boundary
checks.  Importable pure functions are kept here so the fixture suite exercises
the same code used by the refresh command.
"""

from __future__ import annotations

import argparse
import calendar
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
from datetime import UTC, date, datetime
from decimal import Decimal, InvalidOperation, ROUND_HALF_UP
from pathlib import Path, PurePosixPath
from typing import Any


ROOT = Path(__file__).resolve().parents[2]
DEFAULT_LOCK = ROOT / "scripts/etl/specs/public-debt.source.json"
DEFAULT_OUTPUT = ROOT / "src/data/generated/public-debt.json"
MAX_SAFE_INTEGER = 9_007_199_254_740_991
MAX_ZIP_BYTES = 10 * 1024 * 1024
MAX_UNCOMPRESSED_BYTES = 20 * 1024 * 1024
MAX_JSON_BYTES = 1024 * 1024
MONEY_TOLERANCE_CENTS = 10_000_000
EXPECTED_CUBES = {"TCCE0125", "TCCE0175", "TCCE0200", "TCCE0325"}
ISO_MONTH = re.compile(r"^(\d{4})-(\d{2})$")
ISO_DATE = re.compile(r"^\d{4}-\d{2}-\d{2}$")
SHA256 = re.compile(r"^[0-9a-f]{64}$")


class SnapshotError(ValueError):
    """Raised when an upstream or generated snapshot violates the contract."""


def _fail(message: str) -> None:
    raise SnapshotError(message)


def sha256_bytes(payload: bytes) -> str:
    return hashlib.sha256(payload).hexdigest()


def _require_dict(value: Any, label: str) -> dict[str, Any]:
    if not isinstance(value, dict):
        _fail(f"{label}: oggetto atteso")
    return value


def _require_list(value: Any, label: str) -> list[Any]:
    if not isinstance(value, list):
        _fail(f"{label}: lista attesa")
    return value


def _exact_keys(value: dict[str, Any], expected: set[str], label: str) -> None:
    if set(value) != expected:
        _fail(f"{label}: chiavi inattese")


def _parse_timestamp(value: Any, label: str) -> datetime:
    if not isinstance(value, str):
        _fail(f"{label}: timestamp non valido")
    try:
        parsed = datetime.fromisoformat(value.replace("Z", "+00:00"))
    except ValueError:
        _fail(f"{label}: timestamp non valido")
    if parsed.tzinfo is None:
        _fail(f"{label}: timestamp senza timezone")
    return parsed.astimezone(UTC)


def _parse_date(value: Any, label: str) -> date:
    if not isinstance(value, str) or not ISO_DATE.fullmatch(value):
        _fail(f"{label}: data non valida")
    try:
        return date.fromisoformat(value)
    except ValueError:
        _fail(f"{label}: data non valida")


def _month_end(period: str) -> str:
    match = ISO_MONTH.fullmatch(period)
    if not match:
        _fail(f"periodo mensile non valido: {period!r}")
    year, month = (int(part) for part in match.groups())
    if not 1 <= month <= 12:
        _fail(f"periodo mensile non valido: {period!r}")
    return date(year, month, calendar.monthrange(year, month)[1]).isoformat()


def _month_index(value: date) -> int:
    return value.year * 12 + value.month


def _safe_integer(value: Any, label: str, *, nonnegative: bool = False) -> int:
    if isinstance(value, bool) or not isinstance(value, int):
        _fail(f"{label}: intero atteso")
    if abs(value) > MAX_SAFE_INTEGER:
        _fail(f"{label}: intero non sicuro per JavaScript")
    if nonnegative and value < 0:
        _fail(f"{label}: valore negativo")
    return value


def _decimal(raw: Any, label: str) -> Decimal:
    if not isinstance(raw, str) or not raw or raw.strip() != raw:
        _fail(f"{label}: valore numerico non valido")
    normalized = raw.replace(",", ".")
    if not re.fullmatch(r"[+-]?\d+(?:[.,]\d+)?", raw):
        _fail(f"{label}: valore numerico non valido")
    try:
        value = Decimal(normalized)
    except InvalidOperation:
        _fail(f"{label}: valore numerico non valido")
    if not value.is_finite():
        _fail(f"{label}: valore numerico non valido")
    return value


def money_millions_to_cents(raw: str, label: str, *, allow_negative: bool = False) -> int:
    value = _decimal(raw, label)
    cents = value * Decimal(100_000_000)
    if cents != cents.to_integral_value():
        _fail(f"{label}: valore monetario non convertibile esattamente")
    result = int(cents)
    if not allow_negative and result < 0:
        _fail(f"{label}: valore monetario negativo")
    return _safe_integer(result, label)


def percent_to_basis_points(raw: str, label: str) -> int:
    value = _decimal(raw, label)
    basis_points = value * Decimal(100)
    if basis_points != basis_points.to_integral_value():
        _fail(f"{label}: quota non convertibile esattamente")
    result = int(basis_points)
    if not 0 <= result <= 10_000:
        _fail(f"{label}: quota fuori intervallo")
    return result


def share_basis_points(numerator: int, denominator: int) -> int:
    if denominator <= 0 or numerator < 0:
        _fail("quota: numeratore o denominatore non positivo")
    return int((Decimal(numerator) * 10_000 / Decimal(denominator)).quantize(Decimal(1), rounding=ROUND_HALF_UP))


def validate_official_url(url: str, host: str, expected_path: str | None = None) -> urllib.parse.ParseResult:
    parsed = urllib.parse.urlparse(url)
    if parsed.scheme != "https":
        _fail("URL: è richiesto HTTPS")
    if parsed.hostname != host or parsed.port not in (None, 443):
        _fail("URL: host non consentito")
    if parsed.username is not None or parsed.password is not None:
        _fail("URL: credenziali non consentite")
    if parsed.fragment:
        _fail("URL: fragment non consentito")
    if expected_path is not None and parsed.path != expected_path:
        _fail("URL: path non consentito")
    return parsed


def validate_redirect(original: str, target: str, host: str, expected_path: str | None = None) -> str:
    resolved = urllib.parse.urljoin(original, target)
    try:
        validate_official_url(resolved, host, expected_path)
    except SnapshotError as error:
        _fail(f"redirect non consentito: {error}")
    return resolved


def validate_source_lock(lock: dict[str, Any]) -> None:
    _exact_keys(lock, {"schemaVersion", "bancaditalia", "eurostat"}, "source lock")
    if lock.get("schemaVersion") != 1:
        _fail("source lock: schemaVersion non supportata")
    bank = _require_dict(lock["bancaditalia"], "bancaditalia")
    euro = _require_dict(lock["eurostat"], "eurostat")
    if set(_require_dict(bank.get("cubes"), "cubes")) != EXPECTED_CUBES:
        _fail("source lock: cubi BDS non autorizzati")
    export_template = bank.get("exportTemplate", "")
    if not isinstance(export_template, str) or export_template.count("{cube}") != 1:
        _fail("source lock: template export BDS non valido")
    for cube_id in EXPECTED_CUBES:
        validate_official_url(
            export_template.replace("{cube}", cube_id),
            bank.get("allowedHost", ""),
            f"/infostat/dataservices/export/IT/CSV/ALL/CUBE/BANKITALIA/DIFF/{cube_id}",
        )
    for cube_id, cube in bank["cubes"].items():
        series = _require_list(_require_dict(cube, cube_id).get("series"), f"{cube_id}.series")
        if not series:
            _fail(f"{cube_id}: serie mancanti")
        fields: set[str] = set()
        ids: set[str] = set()
        for item_value in series:
            item = _require_dict(item_value, f"{cube_id}.serie")
            required = {"field", "id", "description", "frequency", "unit", "scale", "method", "valueType"}
            _exact_keys(item, required, f"{cube_id}.serie")
            if item["field"] in fields or item["id"] in ids:
                _fail(f"{cube_id}: serie duplicate")
            fields.add(item["field"])
            ids.add(item["id"])
            if item["frequency"] != "M" or item["valueType"] not in {"money-stock", "money-flow", "share", "years"}:
                _fail(f"{cube_id}: metadati serie non validi")
    if euro.get("datasetCode") != "gov_10a_main":
        _fail("source lock: dataset Eurostat non autorizzato")
    validate_official_url(euro.get("apiUrl", ""), euro.get("allowedHost", ""), euro.get("apiPath"))
    dimensions = _require_dict(euro.get("dimensions"), "dimensioni Eurostat")
    if set(dimensions) != {"freq", "unit", "sector", "na_item", "geo"}:
        _fail("source lock: dimensioni Eurostat non autorizzate")
    expected = {"freq": "A", "unit": "MIO_EUR", "sector": "S13", "geo": "IT"}
    for dimension, code in expected.items():
        if _require_dict(dimensions[dimension], dimension).get("code") != code:
            _fail("source lock: codici Eurostat non autorizzati")
    if dimensions["na_item"].get("codes") != ["D41PAY", "TE"]:
        _fail("source lock: codici Eurostat non autorizzati")
    if euro.get("historyYears") != 5:
        _fail("source lock: storia Eurostat non valida")


def _decode_csv(payload: bytes, expected_headers: list[str], delimiter: str, label: str) -> list[dict[str, str]]:
    try:
        text = payload.decode("utf-8")
    except UnicodeDecodeError:
        _fail(f"{label}: UTF-8 non valido")
    reader = csv.DictReader(io.StringIO(text, newline=""), delimiter=delimiter)
    if reader.fieldnames != expected_headers:
        _fail(f"{label}: header inatteso")
    rows: list[dict[str, str]] = []
    for row in reader:
        if None in row or any(value is None for value in row.values()):
            present_values = [value for key, value in row.items() if key is not None and value is not None]
            if not any(present_values):
                break
            _fail(f"{label}: riga CSV non valida")
        rows.append(row)
    return rows


def _decode_bds_data(payload: bytes, date_header: str, delimiter: str, required_series: set[str], label: str) -> list[dict[str, str]]:
    try:
        text = payload.decode("utf-8")
    except UnicodeDecodeError:
        _fail(f"{label}: UTF-8 non valido")
    reader = csv.DictReader(io.StringIO(text, newline=""), delimiter=delimiter)
    headers = reader.fieldnames
    if not headers or headers[0] != date_header or len(headers) != len(set(headers)) or not required_series.issubset(headers[1:]):
        _fail(f"{label}: header inatteso o serie richieste mancanti")
    rows = list(reader)
    if any(None in row or any(value is None for value in row.values()) for row in rows):
        _fail(f"{label}: riga CSV non valida")
    return rows


def parse_bds_zip(
    payload: bytes,
    cube_id: str,
    lock: dict[str, Any],
    *,
    max_compressed_bytes: int = MAX_ZIP_BYTES,
    max_uncompressed_bytes: int = MAX_UNCOMPRESSED_BYTES,
) -> dict[str, Any]:
    validate_source_lock(lock)
    if cube_id not in EXPECTED_CUBES:
        _fail("cubo BDS non autorizzato")
    if len(payload) > max_compressed_bytes:
        _fail("archivio compresso oltre il limite")
    if not payload.startswith(b"PK"):
        _fail("archivio senza firma PK")
    expected = {f"{cube_id}_{kind}.csv" for kind in ("DATA", "STRUCTURE", "DOMAIN", "LEGEND")}
    try:
        with zipfile.ZipFile(io.BytesIO(payload)) as archive:
            infos = archive.infolist()
            names = [info.filename for info in infos]
            for info in infos:
                path = PurePosixPath(info.filename)
                if info.is_dir() or path.is_absolute() or ".." in path.parts or len(path.parts) != 1:
                    _fail("archivio con path non sicuro")
            if len(names) != len(set(names)) or set(names) != expected:
                _fail("archivio con membri inattesi o mancanti")
            total_size = 0
            for info in infos:
                if info.flag_bits & 1:
                    _fail("archivio cifrato non consentito")
                total_size += info.file_size
                if total_size > max_uncompressed_bytes:
                    _fail("archivio non compresso oltre il limite")
            if archive.testzip() is not None:
                _fail("archivio con CRC non valido")
            members = {name: archive.read(name) for name in expected}
    except SnapshotError:
        raise
    except (zipfile.BadZipFile, RuntimeError, OSError) as error:
        _fail(f"archivio ZIP non valido: {error}")

    csv_config = lock["bancaditalia"]["csv"]
    delimiter = csv_config["delimiter"]
    cube = lock["bancaditalia"]["cubes"][cube_id]
    configured = {item["id"]: item for item in cube["series"]}
    rows = {
        kind: _decode_csv(members[f"{cube_id}_{kind}.csv"], csv_config[f"{kind.lower()}Headers"], delimiter, f"{cube_id} {kind}")
        for kind in ("STRUCTURE", "DOMAIN", "LEGEND")
    }
    data_rows = _decode_bds_data(
        members[f"{cube_id}_DATA.csv"], csv_config["dataDateHeader"], delimiter, set(configured), f"{cube_id} DATA"
    )
    structure: dict[tuple[str, str], dict[str, str]] = {}
    for row in rows["STRUCTURE"]:
        key = (row["Cubo"], row["Variabile"])
        if key in structure:
            _fail(f"{cube_id}: metadati struttura duplicati")
        structure[key] = row
    legend: dict[str, str] = {}
    for row in rows["LEGEND"]:
        if row["Tipologia di oggetto"] != "Serie storica":
            continue
        if row["Codice"] in legend:
            _fail(f"{cube_id}: descrizione legenda duplicata")
        legend[row["Codice"]] = row["Descrizione"]
    for series_id, item in configured.items():
        if legend.get(series_id) != item["description"]:
            _fail(f"{cube_id}: descrizione divergente per {series_id}")
        expected_rows = {
            "FREQ": ("Frequenza", "VC", "FREQUENZA", item["frequency"]),
            "UNMIS": ("unità di misura", "VC", "UNMIS", item["unit"]),
            "REGOLA": ("Metodo di calcolo", "VC", "FONTE", item["method"]),
            "SCALA": ("Scala", "AT", "SCALA", item["scale"]),
        }
        for variable, expected_values in expected_rows.items():
            metadata = structure.get((series_id, variable))
            if metadata is None:
                _fail(f"{cube_id}: serie richiesta assente dai metadati")
            actual_values = tuple(metadata[column] for column in ("Descrizione", "Tipologia", "Dominio", "Valori di dominio"))
            if actual_values != expected_values:
                _fail(f"{cube_id}: metadati divergenti per {series_id}")

    parsed: dict[str, dict[str, Any]] = {}
    for series_id, item in configured.items():
        field = item["field"]
        target: dict[str, Any] = {}
        previous_period: str | None = None
        direction: int | None = None
        for row in data_rows:
            raw_date = row[csv_config["dataDateHeader"]]
            try:
                parsed_date = datetime.strptime(raw_date, "%Y/%m/%d").date()
            except ValueError:
                _fail(f"{cube_id} {field}: periodo mensile non valido")
            if parsed_date.day != calendar.monthrange(parsed_date.year, parsed_date.month)[1]:
                _fail(f"{cube_id} {field}: periodo non a fine mese")
            period = f"{parsed_date.year:04d}-{parsed_date.month:02d}"
            if period in target:
                _fail(f"{cube_id} {field}: periodo duplicato")
            if previous_period is not None:
                current_direction = 1 if period > previous_period else -1
                if direction is None:
                    direction = current_direction
                elif current_direction != direction:
                    _fail(f"{cube_id} {field}: ordine dei periodi non monotono")
            previous_period = period
            raw = row[series_id]
            if raw == "":
                if field == "total":
                    _fail(f"{cube_id} serie {field}: valore mancante")
                target[period] = None
                continue
            value_type = item["valueType"]
            if value_type == "money-stock":
                target[period] = money_millions_to_cents(raw, f"{cube_id} {field}")
            elif value_type == "money-flow":
                target[period] = money_millions_to_cents(raw, f"{cube_id} {field}", allow_negative=True)
            elif value_type == "share":
                target[period] = percent_to_basis_points(raw, f"{cube_id} {field}")
            else:
                years = _decimal(raw, f"{cube_id} {field}")
                if years <= 0:
                    _fail(f"{cube_id} {field}: valore anni non positivo")
                target[period] = float(years)
        if not any(item is not None for item in target.values()):
            _fail(f"{cube_id}: serie {field} senza osservazioni")
        parsed[field] = dict(sorted(target.items()))
    return {"cubeId": cube_id, "series": parsed}


def _reject_duplicate_pairs(pairs: list[tuple[str, Any]]) -> dict[str, Any]:
    result: dict[str, Any] = {}
    for key, value in pairs:
        if key in result:
            _fail(f"JSON: chiave duplicata {key}")
        result[key] = value
    return result


def _category_codes(dimension: dict[str, Any], name: str) -> tuple[list[str], dict[str, str]]:
    category = _require_dict(dimension.get("category"), f"dimensione {name}")
    index = category.get("index")
    labels = _require_dict(category.get("label"), f"label {name}")
    if isinstance(index, dict):
        if any(isinstance(position, bool) or not isinstance(position, int) for position in index.values()):
            _fail(f"dimensione {name}: indice non valido")
        ordered = sorted(index, key=index.get)
        if sorted(index.values()) != list(range(len(index))):
            noun = "anni" if name == "time" else "cardinalità"
            _fail(f"dimensione {name}: {noun} e indice non validi")
    elif isinstance(index, list) and all(isinstance(item, str) for item in index):
        ordered = index
    else:
        _fail(f"dimensione {name}: indice non valido")
    if set(labels) != set(ordered):
        _fail(f"dimensione {name}: label o cardinalità non valida")
    return ordered, labels


def parse_eurostat(payload: bytes, lock: dict[str, Any]) -> dict[str, Any]:
    validate_source_lock(lock)
    if len(payload) > MAX_JSON_BYTES:
        _fail("Eurostat: risposta oltre il limite")
    try:
        document = json.loads(payload.decode("utf-8"), object_pairs_hook=_reject_duplicate_pairs)
    except SnapshotError:
        raise
    except (UnicodeDecodeError, json.JSONDecodeError) as error:
        _fail(f"Eurostat: JSON non valido: {error}")
    root = _require_dict(document, "Eurostat")
    ids = _require_list(root.get("id"), "Eurostat id")
    sizes = _require_list(root.get("size"), "Eurostat size")
    dimensions = _require_dict(root.get("dimension"), "Eurostat dimension")
    if root.get("version") != "2.0" or root.get("class") != "dataset":
        _fail("Eurostat: dataset JSON-stat non valido")
    if root.get("label") != lock["eurostat"]["title"] or root.get("source") != "ESTAT":
        _fail("Eurostat: dataset o label inattesi")
    if len(ids) != len(set(ids)) or len(ids) != len(sizes) or set(ids) != {"freq", "unit", "sector", "na_item", "geo", "time"}:
        _fail("Eurostat: dimensioni inattese")
    if any(isinstance(size, bool) or not isinstance(size, int) or size <= 0 for size in sizes):
        _fail("Eurostat: cardinalità non valida")
    if set(dimensions) != set(ids):
        _fail("Eurostat: dimensioni e cardinalità divergenti")

    ordered_codes: dict[str, list[str]] = {}
    lock_dimensions = lock["eurostat"]["dimensions"]
    for position, name in enumerate(ids):
        codes, labels = _category_codes(_require_dict(dimensions[name], name), name)
        if len(codes) != sizes[position]:
            _fail(f"Eurostat: cardinalità dimensione {name} divergente")
        ordered_codes[name] = codes
        if name == "time":
            if any(not re.fullmatch(r"\d{4}", code) for code in codes):
                _fail("Eurostat: anni non validi")
            continue
        spec = lock_dimensions[name]
        expected_codes = spec.get("codes", [spec.get("code")])
        if codes != expected_codes:
            _fail(f"Eurostat: codici dimensione {name} divergenti")
        expected_labels = spec.get("labels", {spec.get("code"): spec.get("label")})
        if any(labels.get(code) != expected_labels.get(code) for code in expected_codes):
            _fail(f"Eurostat: label dimensione {name} divergenti")

    product = math.prod(sizes)
    values = root.get("value")
    if isinstance(values, list):
        if len(values) != product:
            _fail("Eurostat: cardinalità dei valori divergente")
        value_at = lambda index: values[index]
    elif isinstance(values, dict):
        if set(values) != {str(index) for index in range(product)}:
            _fail("Eurostat: cardinalità dei valori divergente")
        value_at = lambda index: values[str(index)]
    else:
        _fail("Eurostat: cardinalità dei valori divergente")
    strides: dict[str, int] = {}
    for index, name in enumerate(ids):
        strides[name] = math.prod(sizes[index + 1:])

    years = sorted(int(code) for code in ordered_codes["time"])
    if len(years) < lock["eurostat"]["historyYears"]:
        _fail("Eurostat: anni insufficienti")
    selected_years = years[-lock["eurostat"]["historyYears"]:]
    if selected_years != list(range(selected_years[0], selected_years[-1] + 1)):
        _fail("Eurostat: anni non consecutivi")
    result: dict[str, dict[int, int]] = {"D41PAY": {}, "TE": {}}
    positions = {name: {code: pos for pos, code in enumerate(codes)} for name, codes in ordered_codes.items()}
    fixed = {"freq": "A", "unit": "MIO_EUR", "sector": "S13", "geo": "IT"}
    for item in ("D41PAY", "TE"):
        for year in selected_years:
            coordinates = {**fixed, "na_item": item, "time": str(year)}
            flat = sum(positions[name][coordinates[name]] * strides[name] for name in ids)
            raw = value_at(flat)
            if isinstance(raw, bool) or not isinstance(raw, (int, float)) or not math.isfinite(raw) or raw <= 0:
                _fail(f"Eurostat: valore non positivo o non valido per {item} {year}")
            if isinstance(raw, float) and not raw.is_integer():
                raw_text = format(raw, ".15g")
            else:
                raw_text = str(int(raw))
            result[item][year] = money_millions_to_cents(raw_text, f"Eurostat {item} {year}")
    updated = root.get("updated")
    _parse_timestamp(updated, "Eurostat updated")
    return {"years": selected_years, "series": result, "upstreamUpdatedAt": updated}


def _latest_common(series: dict[str, dict[str, Any]], fields: list[str], *, require_non_null: bool = True) -> str:
    periods = set(series[fields[0]])
    for field in fields[1:]:
        periods &= set(series[field])
    valid = [period for period in periods if not require_non_null or all(series[field][period] is not None for field in fields)]
    if not valid:
        _fail("nessun periodo comune completo")
    return max(valid)


def build_snapshot(
    lock: dict[str, Any],
    cubes: dict[str, dict[str, Any]],
    eurostat: dict[str, Any],
    *,
    bankitalia_retrieved_at: str,
    eurostat_retrieved_at: str,
    bds_raw: dict[str, dict[str, Any]],
    eurostat_raw: dict[str, Any],
) -> dict[str, Any]:
    validate_source_lock(lock)
    _parse_timestamp(bankitalia_retrieved_at, "Banca d'Italia retrievedAt")
    _parse_timestamp(eurostat_retrieved_at, "Eurostat retrievedAt")
    if set(cubes) != EXPECTED_CUBES or set(bds_raw) != EXPECTED_CUBES:
        _fail("input BDS incompleti")
    stock_series = cubes["TCCE0175"]["series"]
    stock_period = _latest_common(stock_series, list(stock_series))
    total_periods = list(stock_series["total"])
    end = total_periods.index(stock_period)
    selected_periods = total_periods[max(0, end - 12):end + 1]
    if len(selected_periods) != 13:
        _fail("storia stock senza tredici mesi")
    total = stock_series["total"][stock_period]
    previous = stock_series["total"][selected_periods[-2]]
    change_series = cubes["TCCE0125"]["series"]
    if not all(stock_period in values for values in change_series.values()):
        _fail("fabbisogno non allineato allo stock")
    holders_series = cubes["TCCE0200"]["series"]
    holder_fields = [field for field in holders_series if field != "total"]
    holder_period = _latest_common(holders_series, ["total", *holder_fields])
    maturity_series = cubes["TCCE0325"]["series"]
    maturity_period = _latest_common(maturity_series, list(maturity_series))
    years = eurostat["years"]
    annual_history = [
        {
            "year": year,
            "interestExpenseCents": eurostat["series"]["D41PAY"][year],
            "totalGovernmentExpenditureCents": eurostat["series"]["TE"][year],
            "interestShareBasisPoints": share_basis_points(eurostat["series"]["D41PAY"][year], eurostat["series"]["TE"][year]),
        }
        for year in years
    ]
    holder_specs = [
        ("bankitalia", "Banca d'Italia", "bankitaliaAmount", "bankitaliaShare"),
        ("other-mfi", "Altre istituzioni finanziarie monetarie", "otherMfiAmount", "otherMfiShare"),
        ("other-financial", "Altre istituzioni finanziarie", "otherFinancialAmount", "otherFinancialShare"),
        ("other-residents", "Altri residenti", "otherResidentsAmount", "otherResidentsShare"),
        ("non-residents", "Non residenti", "nonResidentsAmount", "nonResidentsShare"),
    ]
    bank_lock = lock["bancaditalia"]
    euro_lock = lock["eurostat"]
    borrowing = change_series["borrowingRequirement"][stock_period]
    raw_liquidity = change_series["rawLiquidityChange"][stock_period]
    liquidity = -raw_liquidity
    stock_change = total - previous
    snapshot = {
        "schemaVersion": 1,
        "sources": {
            "bancaditalia": {
                "id": "bancaditalia", "owner": bank_lock["owner"], "title": bank_lock["title"],
                "landingUrl": bank_lock["landingUrl"], "bdsUrl": bank_lock["bdsUrl"], "termsUrl": bank_lock["termsUrl"],
                "retrievedAt": bankitalia_retrieved_at, "cadence": bank_lock["cadence"], "expectedLagDays": bank_lock["expectedLagDays"],
                "cubes": [
                    {"id": cube_id, "exportUrl": bank_lock["exportTemplate"].replace("{cube}", cube_id), "bytes": bds_raw[cube_id]["bytes"], "sha256": bds_raw[cube_id]["sha256"]}
                    for cube_id in sorted(EXPECTED_CUBES)
                ],
            },
            "eurostat": {
                "id": "eurostat", "owner": euro_lock["owner"], "title": euro_lock["title"], "datasetCode": euro_lock["datasetCode"],
                "datasetUrl": euro_lock["datasetUrl"], "apiUrl": euro_lock["apiUrl"], "termsUrl": euro_lock["termsUrl"],
                "retrievedAt": eurostat_retrieved_at, "upstreamUpdatedAt": eurostat["upstreamUpdatedAt"], "cadence": euro_lock["cadence"],
                "bytes": eurostat_raw["bytes"], "sha256": eurostat_raw["sha256"],
            },
        },
        "stock": {
            "referenceDate": _month_end(stock_period), "totalCents": total, "previousMonthCents": previous, "changeCents": stock_change,
            "history": [{"referenceDate": _month_end(period), "totalCents": stock_series["total"][period]} for period in selected_periods],
            "instruments": {
                "currencyAndDepositsCents": stock_series["currencyAndDeposits"][stock_period],
                "securitiesCents": stock_series["shortTermSecurities"][stock_period] + stock_series["mediumLongTermSecurities"][stock_period],
                "loansAndOtherLiabilitiesCents": stock_series["otherLiabilities"][stock_period] + stock_series["mfiLoans"][stock_period] + stock_series["euLoans"][stock_period],
            },
        },
        "change": {
            "referenceDate": _month_end(stock_period), "borrowingRequirementCents": borrowing,
            "debtInstrumentTransactionsCents": change_series["debtInstrumentTransactions"][stock_period],
            "rawLiquidityChangeCents": raw_liquidity, "liquidityContributionCents": liquidity,
            "otherEffectsCents": stock_change - borrowing - liquidity,
            "netShortTermSecuritiesCents": change_series["netShortTermSecurities"][stock_period],
            "netMediumLongTermSecuritiesCents": change_series["netMediumLongTermSecurities"][stock_period],
        },
        "holders": {
            "referenceDate": _month_end(holder_period), "totalCents": holders_series["total"][holder_period],
            "sectors": [{"id": item_id, "label": label, "amountCents": holders_series[amount][holder_period], "shareBasisPoints": holders_series[share][holder_period]} for item_id, label, amount, share in holder_specs],
        },
        "residualMaturity": {
            "referenceDate": _month_end(maturity_period), "totalCents": maturity_series["total"][maturity_period],
            "upToOneYearCents": maturity_series["upToOneYear"][maturity_period], "oneToFiveYearsCents": maturity_series["oneToFiveYears"][maturity_period],
            "overFiveYearsCents": maturity_series["overFiveYears"][maturity_period], "averageYears": maturity_series["averageYears"][maturity_period],
        },
        "annualInterest": {
            "referenceYear": years[-1], "previousYear": years[-2], "interestExpenseCents": annual_history[-1]["interestExpenseCents"],
            "previousInterestExpenseCents": annual_history[-2]["interestExpenseCents"], "totalGovernmentExpenditureCents": annual_history[-1]["totalGovernmentExpenditureCents"],
            "previousTotalGovernmentExpenditureCents": annual_history[-2]["totalGovernmentExpenditureCents"], "interestShareBasisPoints": annual_history[-1]["interestShareBasisPoints"],
            "previousInterestShareBasisPoints": annual_history[-2]["interestShareBasisPoints"], "history": annual_history,
        },
        "caveats": [
            "I dati recenti possono essere provvisori e soggetti a revisione.",
            "Il debito è uno stock a fine mese; gli interessi sono una spesa annuale e hanno una periodicità diversa.",
        ],
    }
    validate_snapshot(snapshot)
    return snapshot


def _near(left: int, right: int, label: str) -> None:
    if abs(left - right) > MONEY_TOLERANCE_CENTS:
        _fail(f"riconciliazione {label} fallita")


def validate_snapshot(snapshot: dict[str, Any], *, now: str | None = None) -> list[str]:
    value = _require_dict(snapshot, "snapshot")
    _exact_keys(value, {"schemaVersion", "sources", "stock", "change", "holders", "residualMaturity", "annualInterest", "caveats"}, "snapshot")
    if value["schemaVersion"] != 1:
        _fail("snapshot: schemaVersion non supportata")
    sources = _require_dict(value["sources"], "sources")
    if set(sources) != {"bancaditalia", "eurostat"}:
        _fail("snapshot: fonti inattese")
    bank = _require_dict(sources["bancaditalia"], "fonte Banca d'Italia")
    euro = _require_dict(sources["eurostat"], "fonte Eurostat")
    _parse_timestamp(bank.get("retrievedAt"), "Banca d'Italia retrievedAt")
    _parse_timestamp(euro.get("retrievedAt"), "Eurostat retrievedAt")
    _parse_timestamp(euro.get("upstreamUpdatedAt"), "Eurostat upstreamUpdatedAt")
    cubes = _require_list(bank.get("cubes"), "cubi Banca d'Italia")
    if {cube.get("id") for cube in cubes if isinstance(cube, dict)} != EXPECTED_CUBES or len(cubes) != 4:
        _fail("snapshot: cubi Banca d'Italia inattesi")
    for cube in cubes:
        if not SHA256.fullmatch(str(cube.get("sha256", ""))):
            _fail("snapshot: hash Banca d'Italia non valido")
        _safe_integer(cube.get("bytes"), "bytes Banca d'Italia", nonnegative=True)
        cube_id = cube.get("id")
        validate_official_url(
            cube.get("exportUrl", ""),
            "a2a.bancaditalia.it",
            f"/infostat/dataservices/export/IT/CSV/ALL/CUBE/BANKITALIA/DIFF/{cube_id}",
        )
    if not SHA256.fullmatch(str(euro.get("sha256", ""))):
        _fail("snapshot: hash Eurostat non valido")
    _safe_integer(euro.get("bytes"), "bytes Eurostat", nonnegative=True)

    stock = _require_dict(value["stock"], "stock")
    change = _require_dict(value["change"], "change")
    holders = _require_dict(value["holders"], "holders")
    maturity = _require_dict(value["residualMaturity"], "vita residua")
    annual = _require_dict(value["annualInterest"], "interessi")
    stock_date = _parse_date(stock.get("referenceDate"), "data stock")
    previous = _safe_integer(stock.get("previousMonthCents"), "stock precedente", nonnegative=True)
    total = _safe_integer(stock.get("totalCents"), "stock totale", nonnegative=True)
    if _safe_integer(stock.get("changeCents"), "variazione stock") != total - previous:
        _fail("riconciliazione variazione stock fallita")
    instruments = _require_dict(stock.get("instruments"), "strumenti")
    instrument_sum = sum(_safe_integer(amount, f"strumenti {name}", nonnegative=True) for name, amount in instruments.items())
    if instrument_sum != total:
        _fail("riconciliazione strumenti fallita")
    history = _require_list(stock.get("history"), "storia stock")
    if len(history) != 13:
        _fail("storia stock: servono tredici mesi")
    history_dates = [_parse_date(point.get("referenceDate"), "data storia stock") for point in history]
    if any(_month_index(right) - _month_index(left) != 1 for left, right in zip(history_dates, history_dates[1:])) or history_dates[-1] != stock_date:
        _fail("storia stock: tredici mesi non consecutivi")
    for point in history:
        _safe_integer(point.get("totalCents"), "totale storia stock", nonnegative=True)
    if history[-1]["totalCents"] != total or history[-2]["totalCents"] != previous:
        _fail("storia stock non riconciliata")

    if _parse_date(change.get("referenceDate"), "data variazione") != stock_date:
        _fail("fabbisogno: data non allineata")
    borrowing = _safe_integer(change.get("borrowingRequirementCents"), "fabbisogno")
    transactions = _safe_integer(change.get("debtInstrumentTransactionsCents"), "transazioni debito")
    raw_liquidity = _safe_integer(change.get("rawLiquidityChangeCents"), "variazione liquidità")
    if transactions + raw_liquidity != borrowing:
        _fail("riconciliazione fabbisogno fallita")
    liquidity = _safe_integer(change.get("liquidityContributionCents"), "contributo liquidità")
    if liquidity != -raw_liquidity:
        _fail("riconciliazione liquidità fallita")
    other = _safe_integer(change.get("otherEffectsCents"), "altri effetti")
    if borrowing + liquidity + other != stock["changeCents"]:
        _fail("riconciliazione altri effetti fallita")
    _safe_integer(change.get("netShortTermSecuritiesCents"), "titoli brevi netti")
    _safe_integer(change.get("netMediumLongTermSecuritiesCents"), "titoli medio-lunghi netti")

    holder_date = _parse_date(holders.get("referenceDate"), "data detentori")
    if holder_date > stock_date:
        _fail("periodo detentori successivo allo stock")
    lag = _month_index(stock_date) - _month_index(holder_date)
    if lag > 2:
        _fail("periodo detentori più vecchio di due mesi")
    holder_total = _safe_integer(holders.get("totalCents"), "totale detentori", nonnegative=True)
    sectors = _require_list(holders.get("sectors"), "settori detentori")
    if len(sectors) != 5 or {sector.get("id") for sector in sectors if isinstance(sector, dict)} != {"bankitalia", "other-mfi", "other-financial", "other-residents", "non-residents"}:
        _fail("settori detentori non validi")
    holder_amounts = 0
    holder_shares = 0
    for sector in sectors:
        amount = _safe_integer(sector.get("amountCents"), "importo detentore", nonnegative=True)
        holder_amounts += amount
        share = _safe_integer(sector.get("shareBasisPoints"), "quota detentore", nonnegative=True)
        if share > 10_000:
            _fail("quote detentori fuori intervallo")
        holder_shares += share
        if holder_total > 0 and abs(share - share_basis_points(amount, holder_total)) > 5:
            _fail("quota detentore non coerente con l'importo")
    _near(holder_amounts, holder_total, "detentori")
    if abs(holder_shares - 10_000) > 20:
        _fail("quote detentori non sommano a cento")
    stock_same_date = next((point["totalCents"] for point in history if point["referenceDate"] == holders["referenceDate"]), None)
    if stock_same_date is not None:
        _near(holder_total, stock_same_date, "detentori e stock")

    maturity_date = _parse_date(maturity.get("referenceDate"), "data vita residua")
    if maturity_date != stock_date:
        _fail("vita residua: data non allineata")
    maturity_total = _safe_integer(maturity.get("totalCents"), "totale vita residua", nonnegative=True)
    bucket_sum = sum(_safe_integer(maturity.get(field), f"vita residua {field}", nonnegative=True) for field in ("upToOneYearCents", "oneToFiveYearsCents", "overFiveYearsCents"))
    _near(bucket_sum, maturity_total, "vita residua")
    _near(maturity_total, total, "vita residua e stock")
    average = maturity.get("averageYears")
    if isinstance(average, bool) or not isinstance(average, (int, float)) or not math.isfinite(average) or average <= 0:
        _fail("vita residua media non valida")

    annual_history = _require_list(annual.get("history"), "storia interessi")
    if len(annual_history) != 5:
        _fail("storia interessi: servono cinque anni")
    years = [point.get("year") for point in annual_history]
    if any(isinstance(year, bool) or not isinstance(year, int) for year in years) or years != list(range(years[0], years[0] + 5)):
        _fail("storia interessi: cinque anni consecutivi richiesti")
    for point in annual_history:
        interest = _safe_integer(point.get("interestExpenseCents"), "interessi annui", nonnegative=True)
        expenditure = _safe_integer(point.get("totalGovernmentExpenditureCents"), "spesa annua", nonnegative=True)
        if interest <= 0 or expenditure <= 0:
            _fail("interessi e spesa devono essere positivi")
        if point.get("interestShareBasisPoints") != share_basis_points(interest, expenditure):
            _fail("riconciliazione quota interessi fallita")
    latest, prior = annual_history[-1], annual_history[-2]
    annual_pairs = {
        "referenceYear": latest["year"], "previousYear": prior["year"],
        "interestExpenseCents": latest["interestExpenseCents"], "previousInterestExpenseCents": prior["interestExpenseCents"],
        "totalGovernmentExpenditureCents": latest["totalGovernmentExpenditureCents"], "previousTotalGovernmentExpenditureCents": prior["totalGovernmentExpenditureCents"],
        "interestShareBasisPoints": latest["interestShareBasisPoints"], "previousInterestShareBasisPoints": prior["interestShareBasisPoints"],
    }
    for key, expected in annual_pairs.items():
        if annual.get(key) != expected:
            _fail("riconciliazione interessi annuali fallita")
    if annual["referenceYear"] > datetime.now(UTC).year:
        _fail("anno interessi nel futuro")
    if not isinstance(value["caveats"], list) or not value["caveats"] or not all(isinstance(item, str) and item for item in value["caveats"]):
        _fail("caveat mancanti")

    warnings_found: list[str] = []
    reference_now = _parse_timestamp(now, "now") if now is not None else datetime.now(UTC)
    if (reference_now.date() - stock_date).days > 75:
        warnings_found.append("stock-stale")
    annual_end = date(annual["referenceYear"], 12, 31)
    if (reference_now.date() - annual_end).days > 540:
        warnings_found.append("annual-interest-stale")
    return warnings_found


def write_snapshot_if_changed(path: Path, snapshot: dict[str, Any]) -> bool:
    payload = (json.dumps(snapshot, ensure_ascii=False, indent=2) + "\n").encode("utf-8")
    if path.exists() and path.read_bytes() == payload:
        return False
    path.parent.mkdir(parents=True, exist_ok=True)
    descriptor, temp_name = tempfile.mkstemp(prefix=f".{path.name}.", dir=path.parent)
    try:
        with os.fdopen(descriptor, "wb") as handle:
            handle.write(payload)
            handle.flush()
            os.fsync(handle.fileno())
        os.replace(temp_name, path)
    finally:
        try:
            os.unlink(temp_name)
        except FileNotFoundError:
            pass
    return True


def snapshots_semantically_equal(left: dict[str, Any], right: dict[str, Any]) -> bool:
    """Ignore transport-only metadata that changes on equivalent BDS exports.

    BDS regenerates ZIP container timestamps on every request, so raw archive
    hashes are deliberately retained from the first acquisition until one of
    the normalized, published values (or Eurostat's upstream version) changes.
    Raw SHA-256 values are still computed and validated for every download.
    """
    def comparable(snapshot: dict[str, Any]) -> dict[str, Any]:
        value = json.loads(json.dumps(snapshot))
        bank = value["sources"]["bancaditalia"]
        euro = value["sources"]["eurostat"]
        bank.pop("retrievedAt", None)
        for cube in bank["cubes"]:
            cube.pop("bytes", None)
            cube.pop("sha256", None)
        for field in ("retrievedAt", "bytes", "sha256"):
            euro.pop(field, None)
        return value
    return comparable(left) == comparable(right)


class _RestrictedRedirect(urllib.request.HTTPRedirectHandler):
    def __init__(self, host: str, expected_path: str | None = None):
        self.host = host
        self.expected_path = expected_path

    def redirect_request(self, request, file_pointer, code, message, headers, new_url):
        safe_url = validate_redirect(request.full_url, new_url, self.host, self.expected_path)
        return super().redirect_request(request, file_pointer, code, message, headers, safe_url)


def _download(url: str, host: str, *, expected_path: str | None, max_bytes: int, expected_content: str) -> bytes:
    validate_official_url(url, host, expected_path)
    opener = urllib.request.build_opener(_RestrictedRedirect(host, expected_path))
    request = urllib.request.Request(url, headers={"Accept": expected_content, "User-Agent": "DoveVannoINostriSoldi-ETL/1"}, method="GET")
    last_error: Exception | None = None
    for attempt in range(3):
        try:
            with opener.open(request, timeout=20) as response:
                final = response.geturl()
                validate_official_url(final, host, expected_path)
                content_type = response.headers.get_content_type()
                if expected_content == "application/json" and content_type not in {"application/json", "application/json-stat+json"}:
                    _fail("download: content type JSON inatteso")
                if expected_content == "application/zip" and content_type not in {"application/zip", "application/octet-stream", "application/x-zip-compressed"}:
                    _fail("download: content type ZIP inatteso")
                payload = response.read(max_bytes + 1)
                if len(payload) > max_bytes:
                    _fail("download: risposta oltre il limite")
                return payload
        except urllib.error.HTTPError as error:
            last_error = error
            if error.code not in {408, 425, 429, 500, 502, 503, 504} or attempt == 2:
                break
        except (urllib.error.URLError, TimeoutError) as error:
            last_error = error
            if attempt == 2:
                break
        time.sleep(2**attempt)
    _fail(f"download fallito: {last_error}")


def _load_json(path: Path) -> dict[str, Any]:
    try:
        return _require_dict(json.loads(path.read_text(encoding="utf-8"), object_pairs_hook=_reject_duplicate_pairs), str(path))
    except (OSError, UnicodeDecodeError, json.JSONDecodeError) as error:
        _fail(f"impossibile leggere {path}: {error}")


def refresh(lock_path: Path, output_path: Path) -> bool:
    lock = _load_json(lock_path)
    validate_source_lock(lock)
    bank = lock["bancaditalia"]
    raw_cubes: dict[str, bytes] = {}
    parsed_cubes: dict[str, dict[str, Any]] = {}
    for cube_id in sorted(EXPECTED_CUBES):
        url = bank["exportTemplate"].replace("{cube}", cube_id)
        expected_path = f"/infostat/dataservices/export/IT/CSV/ALL/CUBE/BANKITALIA/DIFF/{cube_id}"
        payload = _download(url, bank["allowedHost"], expected_path=expected_path, max_bytes=MAX_ZIP_BYTES, expected_content="application/zip")
        raw_cubes[cube_id] = payload
        parsed_cubes[cube_id] = parse_bds_zip(payload, cube_id, lock)
    euro_lock = lock["eurostat"]
    euro_payload = _download(euro_lock["apiUrl"], euro_lock["allowedHost"], expected_path=euro_lock["apiPath"], max_bytes=MAX_JSON_BYTES, expected_content="application/json")
    parsed_euro = parse_eurostat(euro_payload, lock)
    now = datetime.now(UTC).replace(microsecond=0).isoformat().replace("+00:00", "Z")
    bank_retrieved = now
    euro_retrieved = now
    old: dict[str, Any] | None = None
    if output_path.exists():
        old = _load_json(output_path)
        validate_snapshot(old)
        old_bank_hashes = {cube["id"]: cube["sha256"] for cube in old["sources"]["bancaditalia"]["cubes"]}
        new_bank_hashes = {cube_id: sha256_bytes(payload) for cube_id, payload in raw_cubes.items()}
        if old_bank_hashes == new_bank_hashes:
            bank_retrieved = old["sources"]["bancaditalia"]["retrievedAt"]
        if old["sources"]["eurostat"]["sha256"] == sha256_bytes(euro_payload):
            euro_retrieved = old["sources"]["eurostat"]["retrievedAt"]
    snapshot = build_snapshot(
        lock, parsed_cubes, parsed_euro,
        bankitalia_retrieved_at=bank_retrieved, eurostat_retrieved_at=euro_retrieved,
        bds_raw={cube_id: {"bytes": len(payload), "sha256": sha256_bytes(payload)} for cube_id, payload in raw_cubes.items()},
        eurostat_raw={"bytes": len(euro_payload), "sha256": sha256_bytes(euro_payload)},
    )
    if old is not None and snapshots_semantically_equal(old, snapshot):
        return False
    return write_snapshot_if_changed(output_path, snapshot)


def main() -> int:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--lock", type=Path, default=DEFAULT_LOCK)
    parser.add_argument("--output", type=Path, default=DEFAULT_OUTPUT)
    parser.add_argument("--check", action="store_true", help="Validate the committed lock and snapshot without network access")
    arguments = parser.parse_args()
    lock = _load_json(arguments.lock)
    validate_source_lock(lock)
    if arguments.check:
        snapshot = _load_json(arguments.output)
        warnings_found = validate_snapshot(snapshot)
        print(json.dumps({"valid": True, "warnings": warnings_found}, separators=(",", ":")))
        return 0
    changed = refresh(arguments.lock, arguments.output)
    print(json.dumps({"changed": changed, "output": str(arguments.output)}, separators=(",", ":")))
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
