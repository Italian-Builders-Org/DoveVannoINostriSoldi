#!/usr/bin/env python3
"""Build the high-frequency current-government signals snapshot.

The historical government score and these monthly signals intentionally remain
separate. Eurostat JSON-stat is untrusted input: origin, query shape,
dimensions, labels, periods and every observation are validated before an
atomic write.
"""

from __future__ import annotations

import argparse
import hashlib
import json
import math
import os
import re
import tempfile
import time
import urllib.error
import urllib.parse
import urllib.request
from datetime import UTC, datetime
from pathlib import Path
from typing import Any


ROOT = Path(__file__).resolve().parents[2]
DEFAULT_SPEC = ROOT / "scripts/etl/specs/government-current-signals.source.json"
DEFAULT_OUTPUT = ROOT / "src/data/generated/government-current-signals.json"
MAX_BYTES = 512 * 1024
PERIOD = re.compile(r"^\d{4}-(?:0[1-9]|1[0-2])$")
UTC_TIMESTAMP = re.compile(r"^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}Z$")
SHA256 = re.compile(r"^[0-9a-f]{64}$")
DIMENSIONS = ("freq", "unit", "coicop18", "geo", "time")


class SnapshotError(ValueError):
    """Raised when source or generated data violates the public contract."""


def fail(message: str) -> None:
    raise SnapshotError(message)


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


def sha256_bytes(payload: bytes) -> str:
    return hashlib.sha256(payload).hexdigest()


def validate_https_url(value: Any, host: str, path: str, label: str, *, allow_query: bool = False) -> str:
    if not isinstance(value, str):
        fail(f"{label}: URL atteso")
    parsed = urllib.parse.urlparse(value)
    if parsed.scheme != "https" or parsed.hostname != host or parsed.port not in (None, 443):
        fail(f"{label}: origine non consentita")
    if parsed.username is not None or parsed.password is not None or parsed.fragment or parsed.path != path:
        fail(f"{label}: forma non consentita")
    if not allow_query and parsed.query:
        fail(f"{label}: query non consentita")
    return value


def validate_spec(spec: dict[str, Any]) -> None:
    exact_keys(spec, {"schemaVersion", "methodologyVersion", "source"}, "source spec")
    if spec["schemaVersion"] != 1 or spec["methodologyVersion"] != "current-signals-v1":
        fail("source spec: versione non supportata")
    source = require_dict(spec["source"], "source")
    exact_keys(source, {
        "owner", "datasetCode", "title", "landingUrl", "informationUrl", "reuseUrl",
        "apiUrl", "startPeriod", "cadence", "unitCodes", "countries", "indicators",
    }, "source")
    if source["owner"] != "Eurostat" or source["datasetCode"] != "prc_hicp_minr":
        fail("source: identità inattesa")
    validate_https_url(source["landingUrl"], "ec.europa.eu", "/eurostat/databrowser/view/prc_hicp_minr/default/table", "landingUrl", allow_query=True)
    validate_https_url(source["informationUrl"], "ec.europa.eu", "/eurostat/web/hicp/information-data", "informationUrl")
    validate_https_url(source["reuseUrl"], "ec.europa.eu", "/eurostat/help/copyright-notice", "reuseUrl")
    api_url = validate_https_url(
        source["apiUrl"],
        "ec.europa.eu",
        "/eurostat/api/dissemination/statistics/1.0/data/prc_hicp_minr",
        "apiUrl",
        allow_query=True,
    )
    query = urllib.parse.parse_qs(urllib.parse.urlparse(api_url).query, keep_blank_values=True)
    expected_query = {
        "lang": ["en"],
        "unit": ["I25", "RCH_A"],
        "coicop18": ["TOTAL", "CP01", "CP04"],
        "geo": ["IT", "FR", "DE", "ES"],
        "sinceTimePeriod": ["2022-10"],
    }
    if query != expected_query or source["startPeriod"] != "2022-10":
        fail("apiUrl: filtri inattesi")
    unit_codes = require_dict(source["unitCodes"], "unitCodes")
    if unit_codes != {"index": "I25", "annualRate": "RCH_A"}:
        fail("unitCodes: set inatteso")
    countries = require_list(source["countries"], "countries")
    expected_countries = [
        {"id": "germany", "code": "DE", "label": "Germany"},
        {"id": "spain", "code": "ES", "label": "Spain"},
        {"id": "france", "code": "FR", "label": "France"},
        {"id": "italy", "code": "IT", "label": "Italy"},
    ]
    if countries != expected_countries:
        fail("countries: set o ordine inatteso")
    indicators = require_list(source["indicators"], "indicators")
    if [item.get("id") for item in indicators if isinstance(item, dict)] != ["all-items", "food", "housing-energy"]:
        fail("indicators: paniere inatteso")
    if [item.get("code") for item in indicators if isinstance(item, dict)] != ["TOTAL", "CP01", "CP04"]:
        fail("indicators: codici inattesi")
    for raw in indicators:
        item = require_dict(raw, "indicator")
        exact_keys(item, {"id", "code", "label", "question", "sourceLabel", "limitations"}, "indicator")
        if not all(isinstance(item[key], str) and item[key] for key in ("label", "question", "sourceLabel", "limitations")):
            fail("indicator: testo mancante")


def download(url: str, attempts: int = 3) -> bytes:
    request = urllib.request.Request(
        url,
        headers={
            "User-Agent": "DoveVannoINostriSoldi/1.0 (+https://github.com/Italian-Builders-Org/DoveVannoINostriSoldi)",
            "Accept": "application/json",
        },
    )
    last_error: Exception | None = None
    for attempt in range(attempts):
        try:
            with urllib.request.urlopen(request, timeout=45) as response:
                if response.geturl() != url:
                    fail("Eurostat: redirect non consentito")
                content_type = response.headers.get_content_type()
                if content_type not in {"application/json", "application/vnd.sdmx.data+json"}:
                    fail("Eurostat: content type inatteso")
                length = response.headers.get("Content-Length")
                if length and int(length) > MAX_BYTES:
                    fail("Eurostat: payload troppo grande")
                payload = response.read(MAX_BYTES + 1)
                if not payload or len(payload) > MAX_BYTES:
                    fail("Eurostat: payload vuoto o troppo grande")
                return payload
        except (OSError, urllib.error.URLError, TimeoutError, ValueError) as error:
            last_error = error
            if attempt + 1 < attempts:
                time.sleep(1.5 * (attempt + 1))
    fail(f"Eurostat: download fallito ({last_error})")


def next_period(period: str) -> str:
    year, month = map(int, period.split("-"))
    return f"{year + 1:04d}-01" if month == 12 else f"{year:04d}-{month + 1:02d}"


def normalize_source_timestamp(value: Any) -> str:
    if not isinstance(value, str):
        fail("Eurostat.updated: timestamp atteso")
    try:
        parsed = datetime.strptime(value, "%Y-%m-%dT%H:%M:%S%z")
    except ValueError:
        fail("Eurostat.updated: timestamp non valido")
    return parsed.astimezone(UTC).strftime("%Y-%m-%dT%H:%M:%SZ")


def ordered_categories(dimension: dict[str, Any], label: str) -> tuple[list[str], dict[str, str]]:
    exact_keys(dimension, {"label", "category"}, f"dimension.{label}")
    category = require_dict(dimension["category"], f"dimension.{label}.category")
    exact_keys(category, {"index", "label"}, f"dimension.{label}.category")
    indexes = require_dict(category["index"], f"dimension.{label}.index")
    labels = require_dict(category["label"], f"dimension.{label}.label")
    if set(indexes) != set(labels) or sorted(indexes.values()) != list(range(len(indexes))):
        fail(f"dimension.{label}: indice non continuo")
    ordered = [code for code, _position in sorted(indexes.items(), key=lambda item: item[1])]
    if not all(isinstance(labels[code], str) and labels[code] for code in ordered):
        fail(f"dimension.{label}: etichetta non valida")
    return ordered, labels


def finite_value(value: Any, label: str, *, positive: bool = False) -> float:
    if isinstance(value, bool) or not isinstance(value, (int, float)) or not math.isfinite(value):
        fail(f"{label}: numero finito atteso")
    number = float(value)
    if positive and not 0 < number < 1_000:
        fail(f"{label}: indice fuori intervallo")
    if not positive and not -100 < number < 200:
        fail(f"{label}: variazione fuori intervallo")
    return number


def flatten_index(ids: list[str], sizes: list[int], positions: dict[str, int]) -> int:
    index = 0
    for dimension_id, size in zip(ids, sizes, strict=True):
        index = index * size + positions[dimension_id]
    return index


def extract_response(spec: dict[str, Any], payload: bytes) -> tuple[dict[str, Any], str, str]:
    try:
        response = json.loads(payload.decode("utf-8"))
    except (UnicodeDecodeError, json.JSONDecodeError):
        fail("Eurostat: JSON UTF-8 non valido")
    response = require_dict(response, "Eurostat")
    exact_keys(response, {"version", "class", "label", "source", "updated", "value", "id", "size", "dimension", "extension"}, "Eurostat")
    source = require_dict(spec["source"], "source")
    if response["version"] != "2.0" or response["class"] != "dataset" or response["source"] != "ESTAT" or response["label"] != source["title"]:
        fail("Eurostat: identità dataset inattesa")
    ids = require_list(response["id"], "Eurostat.id")
    sizes = require_list(response["size"], "Eurostat.size")
    if ids != list(DIMENSIONS) or len(sizes) != len(DIMENSIONS) or any(isinstance(size, bool) or not isinstance(size, int) or size < 1 for size in sizes):
        fail("Eurostat: struttura dimensionale inattesa")
    dimensions = require_dict(response["dimension"], "Eurostat.dimension")
    exact_keys(dimensions, set(DIMENSIONS), "Eurostat.dimension")
    ordered: dict[str, list[str]] = {}
    labels: dict[str, dict[str, str]] = {}
    for dimension_id in DIMENSIONS:
        ordered[dimension_id], labels[dimension_id] = ordered_categories(
            require_dict(dimensions[dimension_id], f"dimension.{dimension_id}"),
            dimension_id,
        )
    expected_units = [source["unitCodes"]["index"], source["unitCodes"]["annualRate"]]
    expected_codes = [item["code"] for item in source["indicators"]]
    expected_geographies = [item["code"] for item in source["countries"]]
    if ordered["freq"] != ["M"] or ordered["unit"] != expected_units or ordered["coicop18"] != expected_codes or ordered["geo"] != expected_geographies:
        fail("Eurostat: categorie o ordine inattesi")
    if labels["unit"] != {"I25": "Index, 2025=100", "RCH_A": "Annual rate of change"}:
        fail("Eurostat: unità inattese")
    if labels["coicop18"] != {item["code"]: item["sourceLabel"] for item in source["indicators"]}:
        fail("Eurostat: etichette ECOICOP inattese")
    if labels["geo"] != {item["code"]: item["label"] for item in source["countries"]}:
        fail("Eurostat: etichette geografiche inattese")
    periods = ordered["time"]
    if not periods or periods[0] != source["startPeriod"] or any(not PERIOD.fullmatch(period) for period in periods):
        fail("Eurostat: periodo iniziale o formato inatteso")
    for previous, current in zip(periods, periods[1:]):
        if current != next_period(previous):
            fail("Eurostat: serie mensile non continua")
    if sizes != [1, len(expected_units), len(expected_codes), len(expected_geographies), len(periods)]:
        fail("Eurostat: dimensioni non riconciliate")
    values = require_dict(response["value"], "Eurostat.value")
    expected_count = math.prod(sizes)
    if set(values) != {str(index) for index in range(expected_count)}:
        fail("Eurostat: osservazioni mancanti o inattese")
    positions = {
        dimension_id: {code: position for position, code in enumerate(codes)}
        for dimension_id, codes in ordered.items()
    }
    indicators: list[dict[str, Any]] = []
    for raw_indicator in source["indicators"]:
        countries: dict[str, list[dict[str, Any]]] = {}
        for raw_country in source["countries"]:
            points = []
            for period in periods:
                base_positions = {
                    "freq": 0,
                    "coicop18": positions["coicop18"][raw_indicator["code"]],
                    "geo": positions["geo"][raw_country["code"]],
                    "time": positions["time"][period],
                }
                index_position = flatten_index(ids, sizes, {**base_positions, "unit": positions["unit"]["I25"]})
                annual_position = flatten_index(ids, sizes, {**base_positions, "unit": positions["unit"]["RCH_A"]})
                points.append({
                    "period": period,
                    "index": finite_value(values[str(index_position)], f"{raw_indicator['id']}.{raw_country['id']}.{period}.index", positive=True),
                    "annualRate": finite_value(values[str(annual_position)], f"{raw_indicator['id']}.{raw_country['id']}.{period}.annualRate"),
                })
            countries[raw_country["id"]] = points
        indicators.append({
            "id": raw_indicator["id"],
            "code": raw_indicator["code"],
            "label": raw_indicator["label"],
            "question": raw_indicator["question"],
            "indexUnit": "indice 2025=100",
            "annualRateUnit": "variazione percentuale annua",
            "limitations": raw_indicator["limitations"],
            "countries": countries,
        })
    return {"indicators": indicators}, normalize_source_timestamp(response["updated"]), periods[-1]


def build_snapshot(spec: dict[str, Any], payload: bytes, generated_at: str) -> dict[str, Any]:
    validate_spec(spec)
    if not UTC_TIMESTAMP.fullmatch(generated_at) or not math.isfinite(datetime.fromisoformat(generated_at.replace("Z", "+00:00")).timestamp()):
        fail("generatedAt: timestamp UTC non valido")
    extracted, source_updated_at, through = extract_response(spec, payload)
    source = spec["source"]
    snapshot = {
        "schemaVersion": 1,
        "methodologyVersion": "current-signals-v1",
        "generatedAt": generated_at,
        "governmentStartPeriod": source["startPeriod"],
        "source": {
            "owner": source["owner"],
            "datasetCode": source["datasetCode"],
            "title": source["title"],
            "landingUrl": source["landingUrl"],
            "informationUrl": source["informationUrl"],
            "reuseUrl": source["reuseUrl"],
            "apiUrl": source["apiUrl"],
            "cadence": source["cadence"],
            "sourceUpdatedAt": source_updated_at,
            "retrievedAt": generated_at,
            "referencePeriodFrom": source["startPeriod"],
            "referencePeriodThrough": through,
            "bytes": len(payload),
            "sha256": sha256_bytes(payload),
        },
        "indicators": extracted["indicators"],
        "caveats": [
            "Questi segnali mensili descrivono i prezzi osservati durante il mandato e non entrano nel Core annuale.",
            "Il confronto con i peer usa lo stesso periodo, ma non attribuisce causalmente le differenze alle politiche del governo.",
            "L'IPCA è una media nazionale: l'esperienza di ogni famiglia dipende dal proprio paniere di spesa.",
            "I dati Eurostat possono essere rivisti; ogni aggiornamento conserva timestamp e hash della risposta usata.",
        ],
    }
    validate_snapshot(snapshot)
    return snapshot


def validate_snapshot(snapshot: dict[str, Any]) -> None:
    exact_keys(snapshot, {"schemaVersion", "methodologyVersion", "generatedAt", "governmentStartPeriod", "source", "indicators", "caveats"}, "snapshot")
    if snapshot["schemaVersion"] != 1 or snapshot["methodologyVersion"] != "current-signals-v1" or snapshot["governmentStartPeriod"] != "2022-10":
        fail("snapshot: versione o periodo iniziale inatteso")
    if not isinstance(snapshot["generatedAt"], str) or not UTC_TIMESTAMP.fullmatch(snapshot["generatedAt"]):
        fail("snapshot.generatedAt: timestamp non valido")
    source = require_dict(snapshot["source"], "snapshot.source")
    exact_keys(source, {
        "owner", "datasetCode", "title", "landingUrl", "informationUrl", "reuseUrl", "apiUrl", "cadence",
        "sourceUpdatedAt", "retrievedAt", "referencePeriodFrom", "referencePeriodThrough", "bytes", "sha256",
    }, "snapshot.source")
    if source["owner"] != "Eurostat" or source["datasetCode"] != "prc_hicp_minr" or source["referencePeriodFrom"] != "2022-10":
        fail("snapshot.source: identità inattesa")
    if not all(isinstance(source[key], str) and UTC_TIMESTAMP.fullmatch(source[key]) for key in ("sourceUpdatedAt", "retrievedAt")):
        fail("snapshot.source: timestamp non valido")
    if not isinstance(source["bytes"], int) or isinstance(source["bytes"], bool) or not 0 < source["bytes"] <= MAX_BYTES or not isinstance(source["sha256"], str) or not SHA256.fullmatch(source["sha256"]):
        fail("snapshot.source: dimensione o hash non valido")
    indicators = require_list(snapshot["indicators"], "snapshot.indicators")
    if [item.get("id") for item in indicators if isinstance(item, dict)] != ["all-items", "food", "housing-energy"]:
        fail("snapshot.indicators: paniere inatteso")
    expected_periods: list[str] | None = None
    for raw_indicator in indicators:
        indicator = require_dict(raw_indicator, "snapshot.indicator")
        exact_keys(indicator, {"id", "code", "label", "question", "indexUnit", "annualRateUnit", "limitations", "countries"}, "snapshot.indicator")
        if indicator["indexUnit"] != "indice 2025=100" or indicator["annualRateUnit"] != "variazione percentuale annua":
            fail("snapshot.indicator: unità inattese")
        countries = require_dict(indicator["countries"], "snapshot.indicator.countries")
        exact_keys(countries, {"germany", "spain", "france", "italy"}, "snapshot.indicator.countries")
        for country_id, raw_points in countries.items():
            points = require_list(raw_points, f"snapshot.{indicator['id']}.{country_id}")
            periods = []
            for raw_point in points:
                point = require_dict(raw_point, "snapshot.observation")
                exact_keys(point, {"period", "index", "annualRate"}, "snapshot.observation")
                periods.append(point["period"])
                finite_value(point["index"], "snapshot.observation.index", positive=True)
                finite_value(point["annualRate"], "snapshot.observation.annualRate")
            if not periods or periods[0] != "2022-10" or any(current != next_period(previous) for previous, current in zip(periods, periods[1:])):
                fail("snapshot: periodi non continui")
            if expected_periods is None:
                expected_periods = periods
            elif periods != expected_periods:
                fail("snapshot: copertura non uniforme")
    if not expected_periods or expected_periods[-1] != source["referencePeriodThrough"]:
        fail("snapshot: ultimo periodo non riconciliato")
    caveats = require_list(snapshot["caveats"], "snapshot.caveats")
    if len(caveats) < 4 or not all(isinstance(item, str) and item for item in caveats):
        fail("snapshot.caveats: limiti insufficienti")


def write_atomic(path: Path, snapshot: dict[str, Any]) -> None:
    path.parent.mkdir(parents=True, exist_ok=True)
    serialized = json.dumps(snapshot, ensure_ascii=False, indent=2) + "\n"
    temporary_path: Path | None = None
    try:
        with tempfile.NamedTemporaryFile("w", encoding="utf-8", dir=path.parent, prefix=f".{path.name}.", delete=False) as handle:
            handle.write(serialized)
            handle.flush()
            os.fsync(handle.fileno())
            temporary_path = Path(handle.name)
        os.replace(temporary_path, path)
    finally:
        if temporary_path and temporary_path.exists():
            temporary_path.unlink()


def utc_now() -> str:
    return datetime.now(UTC).strftime("%Y-%m-%dT%H:%M:%SZ")


def load_json(path: Path, label: str) -> dict[str, Any]:
    try:
        return require_dict(json.loads(path.read_text(encoding="utf-8")), label)
    except (OSError, UnicodeDecodeError, json.JSONDecodeError) as error:
        fail(f"{label}: lettura fallita ({error})")


def main() -> int:
    parser = argparse.ArgumentParser()
    parser.add_argument("--spec", type=Path, default=DEFAULT_SPEC)
    parser.add_argument("--output", type=Path, default=DEFAULT_OUTPUT)
    parser.add_argument("--input", type=Path)
    parser.add_argument("--generated-at", default=None)
    parser.add_argument("--check", action="store_true")
    args = parser.parse_args()
    spec = load_json(args.spec, "source spec")
    validate_spec(spec)
    if args.check:
        validate_snapshot(load_json(args.output, "snapshot"))
        print(f"Validated {args.output}")
        return 0
    payload = args.input.read_bytes() if args.input else download(spec["source"]["apiUrl"])
    if not payload or len(payload) > MAX_BYTES:
        fail("Eurostat: input vuoto o troppo grande")
    snapshot = build_snapshot(spec, payload, args.generated_at or utc_now())
    write_atomic(args.output, snapshot)
    print(f"Wrote {args.output} through {snapshot['source']['referencePeriodThrough']}")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
