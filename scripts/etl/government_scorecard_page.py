#!/usr/bin/env python3
"""Freeze observed display series and source-backed government context."""

from __future__ import annotations

import argparse
import datetime as dt
import hashlib
import json
import math
import re
import os
import tempfile
import urllib.parse
import urllib.request
from pathlib import Path
from typing import Any


ROOT = Path(__file__).resolve().parents[2]
OUTPUT = ROOT / "src/data/generated/government-scorecard-page.json"
CORE_PATH = ROOT / "src/data/generated/government-scorecard.json"
CHRONOLOGY_PATH = ROOT / "scripts/etl/specs/government-scorecard-chronology.json"
COUNTRIES = (("IT", "italy"), ("FR", "france"), ("DE", "germany"), ("ES", "spain"))
SNAPSHOT_DATE = "2026-09-03"
SCHEMA_VERSION = 4
SNAPSHOT_VERSION = "government-scorecard-page-2026-09-03-r3"
INDICATOR_ORDER = (
    "inflation",
    "real_compensation",
    "unemployment",
    "employment_rate",
    "real_gdp_per_capita",
    "debt_ratio",
    "debt_per_capita",
    "primary_balance",
    "investment_share",
)
AMECO_LABELS = {
    "real_compensation": "Retribuzione reale per dipendente",
    "unemployment": "Tasso di disoccupazione",
    "real_gdp_per_capita": "PIL reale per abitante",
    "debt_ratio": "Debito pubblico sul PIL",
    "primary_balance": "Saldo primario sul PIL",
    "investment_share": "Investimenti totali sul PIL",
}
CONTEXT_CATEGORIES = (
    "overview",
    "inheritance",
    "geopolitics_crises",
    "eurozone_ecb",
    "laws_measures",
    "chronology",
)
EUROSTAT_API = "https://ec.europa.eu/eurostat/api/dissemination/statistics/1.0/data"
EUROSTAT_DATA_BROWSER = "https://ec.europa.eu/eurostat/databrowser/view/{dataset}/default/table?lang=en"
EUROSTAT_TERMS = "https://ec.europa.eu/eurostat/web/main/help/copyright-notice"


class SupplementalSnapshotError(ValueError):
    """Raised when source identity or normalized output violates the contract."""


def _sha256(payload: bytes) -> str:
    return hashlib.sha256(payload).hexdigest()


def _canonical_hash(value: Any) -> str:
    return _sha256(json.dumps(value, ensure_ascii=False, sort_keys=True, separators=(",", ":")).encode())


def _load(path: Path) -> dict[str, Any]:
    try:
        value = json.loads(path.read_text(encoding="utf-8"))
    except (OSError, json.JSONDecodeError) as exc:
        raise SupplementalSnapshotError(f"cannot read JSON: {path}") from exc
    if not isinstance(value, dict):
        raise SupplementalSnapshotError(f"object expected: {path}")
    return value


def _timestamp(value: str) -> str:
    try:
        parsed = dt.datetime.fromisoformat(value.replace("Z", "+00:00"))
    except ValueError as exc:
        raise SupplementalSnapshotError("retrieved-at must be an ISO timestamp") from exc
    if parsed.tzinfo is None or parsed.utcoffset() != dt.timedelta(0):
        raise SupplementalSnapshotError("retrieved-at must be UTC")
    return parsed.replace(microsecond=0).isoformat().replace("+00:00", "Z")


def _fetch_eurostat(dataset: str, filters: tuple[tuple[str, str], ...], since_period: str = "1995") -> tuple[dict[str, Any], bytes, str]:
    query = urllib.parse.urlencode((("lang", "en"), *filters, *(('geo', code) for code, _ in COUNTRIES), ("sinceTimePeriod", since_period)))
    url = f"{EUROSTAT_API}/{dataset}?{query}"
    request = urllib.request.Request(url, headers={"User-Agent": "DoveVannoINostriSoldi/0.2 data-refresh"})
    try:
        with urllib.request.urlopen(request, timeout=45) as response:
            final = urllib.parse.urlparse(response.geturl())
            if final.scheme != "https" or final.netloc != "ec.europa.eu":
                raise SupplementalSnapshotError("Eurostat redirect outside official origin")
            payload = response.read(10 * 1024 * 1024 + 1)
            if len(payload) > 10 * 1024 * 1024:
                raise SupplementalSnapshotError("Eurostat response too large")
    except OSError as exc:
        raise SupplementalSnapshotError(f"Eurostat download failed: {dataset}") from exc
    try:
        data = json.loads(payload)
    except json.JSONDecodeError as exc:
        raise SupplementalSnapshotError(f"Eurostat returned invalid JSON: {dataset}") from exc
    if not isinstance(data, dict) or "error" in data:
        raise SupplementalSnapshotError(f"Eurostat returned an error: {dataset}")
    validate_jsonstat(data, filters)
    return data, payload, url


def validate_jsonstat(data: dict[str, Any], filters: tuple[tuple[str, str], ...]) -> None:
    """Validate the raw cube before selectors can silently discard schema drift."""
    if data.get("version") != "2.0" or data.get("class") != "dataset" or data.get("source") != "ESTAT":
        raise SupplementalSnapshotError("Eurostat schema/source identity mismatch")
    expected = {"geo": [code for code, _ in COUNTRIES]}
    for key, value in filters:
        expected.setdefault(key, []).append(value)
    dimensions, sizes = data.get("id"), data.get("size")
    if (not isinstance(dimensions, list) or len(dimensions) != len(set(dimensions))
            or set(dimensions) != set(expected) | {"time"}
            or not isinstance(sizes, list) or len(sizes) != len(dimensions)):
        raise SupplementalSnapshotError("Eurostat dimension drift")
    for dimension, size in zip(dimensions, sizes, strict=True):
        positions = _category_positions(data, dimension)
        if type(size) is not int or not 0 < size <= 1_000_000 or any(type(index) is not int for index in positions.values()) or sorted(positions.values()) != list(range(size)):
            raise SupplementalSnapshotError("Eurostat dimension size mismatch")
        if dimension != "time" and set(positions) != set(expected[dimension]):
            raise SupplementalSnapshotError(f"Eurostat filter/identity drift: {dimension}")
        if dimension == "time":
            pattern = {"A": r"\d{4}", "Q": r"\d{4}-Q[1-4]", "M": r"\d{4}-(?:0[1-9]|1[0-2])"}[expected["freq"][0]]
            if any(re.fullmatch(pattern, period) is None for period in positions):
                raise SupplementalSnapshotError("Eurostat period drift")
    count = math.prod(sizes)
    if count > 1_000_000:
        raise SupplementalSnapshotError("Eurostat cube too large")
    for field in ("value", "status"):
        values = data.get(field, {} if field == "status" else None)
        if isinstance(values, list):
            if len(values) != count:
                raise SupplementalSnapshotError("Eurostat incomplete cube")
            values = dict(enumerate(values))
        if not isinstance(values, dict) or any(not str(key).isdigit() or not 0 <= int(key) < count for key in values):
            raise SupplementalSnapshotError("Eurostat malformed cube")
        for value in values.values():
            if field == "status":
                if value is not None and not isinstance(value, str):
                    raise SupplementalSnapshotError("Eurostat malformed status")
                _publication_status(value)
            elif value is not None and (type(value) not in (int, float) or not math.isfinite(value)):
                raise SupplementalSnapshotError("Eurostat malformed value")


def _category_positions(data: dict[str, Any], dimension: str) -> dict[str, int]:
    try:
        raw = data["dimension"][dimension]["category"]["index"]
    except (KeyError, TypeError) as exc:
        raise SupplementalSnapshotError(f"missing JSON-stat dimension: {dimension}") from exc
    if isinstance(raw, list):
        return {code: index for index, code in enumerate(raw)}
    if isinstance(raw, dict) and all(isinstance(code, str) and isinstance(index, int) for code, index in raw.items()):
        return raw
    raise SupplementalSnapshotError(f"invalid JSON-stat dimension: {dimension}")


def _jsonstat_value(data: dict[str, Any], selectors: dict[str, str]) -> tuple[float | None, str | None]:
    dimensions = data.get("id")
    sizes = data.get("size")
    if not isinstance(dimensions, list) or not isinstance(sizes, list) or len(dimensions) != len(sizes):
        raise SupplementalSnapshotError("invalid JSON-stat shape")
    flat_index = 0
    for index, dimension in enumerate(dimensions):
        positions = _category_positions(data, dimension)
        selected = selectors.get(dimension)
        if selected is None:
            if len(positions) != 1:
                raise SupplementalSnapshotError(f"selector required for dimension: {dimension}")
            selected = next(iter(positions))
        if selected not in positions:
            return None, None
        stride = math.prod(sizes[index + 1 :])
        flat_index += positions[selected] * stride
    raw_values = data.get("value", {})
    raw_status = data.get("status", {})
    value = raw_values[flat_index] if isinstance(raw_values, list) and flat_index < len(raw_values) else raw_values.get(str(flat_index))
    status = raw_status[flat_index] if isinstance(raw_status, list) and flat_index < len(raw_status) else raw_status.get(str(flat_index))
    if value is None:
        return None, status
    if isinstance(value, bool) or not isinstance(value, (int, float)) or not math.isfinite(value):
        raise SupplementalSnapshotError("non-finite Eurostat value")
    return float(value), status


def _source(dataset: str, title: str, payload: bytes, url: str, data: dict[str, Any], retrieved_at: str) -> dict[str, Any]:
    updated = data.get("updated")
    if not isinstance(updated, str) or not updated:
        raise SupplementalSnapshotError(f"Eurostat update timestamp missing: {dataset}")
    return {
        "id": f"eurostat:{dataset}",
        "owner": "Eurostat",
        "title": title,
        "dataset_code": dataset,
        "query_url": url,
        "landing_url": EUROSTAT_DATA_BROWSER.format(dataset=dataset),
        "terms_url": EUROSTAT_TERMS,
        "retrieved_at": retrieved_at,
        "upstream_updated_at": updated,
        "raw_bytes": len(payload),
        "raw_sha256": _sha256(payload),
    }


def _period_start(period: str) -> str:
    if "-Q" in period:
        year, quarter = period.split("-Q")
        return f"{year}-{(int(quarter) - 1) * 3 + 1:02d}-01"
    if len(period) == 7:
        return f"{period}-01"
    return f"{period}-01-01"


def _publication_status(upstream_status: str | None) -> str:
    flags = set(upstream_status or "")
    if flags - set("bdepnsuz;"):
        raise SupplementalSnapshotError("unsupported or forecast Eurostat publication flag")
    if "e" in flags:
        return "estimated"
    if "p" in flags:
        return "provisional"
    return "observed"


def _point(period: str, value: float, unit: str, frequency: str, source: dict[str, Any], upstream_status: str | None) -> dict[str, Any]:
    return {
        "year": int(period[:4]),
        "period": period,
        "period_start": _period_start(period),
        "value": value,
        "unit": unit,
        "frequency": frequency,
        "status": _publication_status(upstream_status),
        "upstream_status_or_null": upstream_status,
        "source_id": source["id"],
        "source_owner": source["owner"],
        "source_url": source.get("query_url", source["landing_url"]),
        "retrieved_at": source["retrieved_at"],
        "raw_sha256": source["raw_sha256"],
    }


def _combined_status(*statuses: str | None) -> str | None:
    return ";".join(filter(None, statuses)) or None


def _eurostat_series(
    indicator_id: str,
    label: str,
    unit: str,
    data: dict[str, Any],
    source: dict[str, Any],
    selectors: dict[str, str],
    frequency: str,
) -> dict[str, Any]:
    geographies = []
    periods = sorted(_category_positions(data, "time"), key=_category_positions(data, "time").get)
    for geography, _ in COUNTRIES:
        points = []
        for period in periods:
            value, status = _jsonstat_value(data, {**selectors, "geo": geography, "time": period})
            if value is not None:
                points.append(_point(period, value, unit, frequency, source, status))
        if not points:
            raise SupplementalSnapshotError(f"no observations: {indicator_id}/{geography}")
        geographies.append({"geography": geography, "points": points})
    return {
        "indicator_id": indicator_id,
        "label": label,
        "usage": "context_only",
        "frequency": frequency,
        "latest_published_period": max(point["period"] for geography in geographies for point in geography["points"]),
        "geographies": geographies,
    }


def _primary_balance_series(data: dict[str, Any], source: dict[str, Any]) -> dict[str, Any]:
    geographies = []
    combined_hash = _canonical_hash([source["raw_sha256"], "B9+D41PAY"])
    periods = sorted(_category_positions(data, "time"), key=_category_positions(data, "time").get)
    for geography, _ in COUNTRIES:
        points = []
        for period in periods:
            balance, balance_status = _jsonstat_value(
                data,
                {"freq": "Q", "unit": "PC_GDP", "s_adj": "NSA", "sector": "S13", "na_item": "B9", "geo": geography, "time": period},
            )
            interest, interest_status = _jsonstat_value(
                data,
                {"freq": "Q", "unit": "PC_GDP", "s_adj": "NSA", "sector": "S13", "na_item": "D41PAY", "geo": geography, "time": period},
            )
            if balance is None or interest is None:
                continue
            points.append({
                **_point(period, round(balance + interest, 4), "percent of GDP", "quarterly", {
                    **source,
                    "id": "eurostat:gov_10q_ggnfa:primary-balance",
                    "raw_sha256": combined_hash,
                }, _combined_status(balance_status, interest_status)),
                "derivation": {
                    "formula": "net_lending_percent_gdp + interest_payable_percent_gdp",
                    "net_lending_percent_gdp": balance,
                    "interest_payable_percent_gdp": interest,
                    "sector": "S13",
                    "net_lending_item": "B9",
                    "interest_item": "D41PAY",
                },
                "component_sources": [
                    {"dataset_code": source["dataset_code"], "raw_sha256": source["raw_sha256"], "source_url": source["query_url"]},
                ],
            })
        if not points:
            raise SupplementalSnapshotError(f"no primary-balance observations: {geography}")
        geographies.append({"geography": geography, "points": points})
    return {
        "indicator_id": "primary_balance",
        "label": "Saldo primario sul PIL",
        "usage": "context_only",
        "frequency": "quarterly",
        "latest_published_period": max(point["period"] for geography in geographies for point in geography["points"]),
        "geographies": geographies,
    }


def _ameco_source(core: dict[str, Any]) -> dict[str, Any]:
    raw = core["sources"]["ameco"]
    return {
        "id": f"ameco:{raw['release'].split()[1]}-{raw['release'].split()[0].lower()}",
        "owner": raw["owner"],
        "title": raw["title"],
        "dataset_code": "AMECO",
        "source_version": raw["release"],
        "query_url": raw["downloadUrl"],
        "landing_url": raw["landingUrl"],
        "terms_url": raw["termsUrl"],
        "retrieved_at": raw["retrievedAt"],
        "upstream_updated_at": raw["releaseDate"],
        "raw_bytes": raw["bytes"],
        "raw_sha256": raw["sha256"],
    }


def _ameco_series(core: dict[str, Any], source: dict[str, Any]) -> list[dict[str, Any]]:
    output = []
    for raw in core["indicators"]:
        geographies = []
        for geography, country_id in COUNTRIES:
            points = [
                _point(str(point["year"]), float(point["value"]), raw["unit"], "annual", source, None)
                for point in raw["countries"][country_id]
                if 1995 <= int(point["year"]) <= int(core["sources"]["ameco"]["observedThrough"]) and point["value"] is not None
            ]
            geographies.append({"geography": geography, "points": points})
        output.append({
            "indicator_id": raw["id"],
            "label": AMECO_LABELS.get(raw["id"], raw["id"]),
            "usage": "score_and_context",
            "frequency": "annual",
            "latest_published_period": max(point["period"] for geography in geographies for point in geography["points"]),
            "geographies": geographies,
        })
    return output


def _debt_per_capita_series(
    debt_data: dict[str, Any],
    debt_source: dict[str, Any],
    population_data: dict[str, Any],
    population_source: dict[str, Any],
) -> dict[str, Any]:
    geographies = []
    combined_hash = _canonical_hash([debt_source["raw_sha256"], population_source["raw_sha256"]])
    periods = sorted(
        set(_category_positions(debt_data, "time")) & set(_category_positions(population_data, "time")),
    )
    for geography, _ in COUNTRIES:
        points = []
        for period in periods:
            year = int(period)
            debt, debt_status = _jsonstat_value(debt_data, {"freq": "A", "unit": "MIO_EUR", "sector": "S13", "na_item": "GD", "geo": geography, "time": period})
            population, population_status = _jsonstat_value(population_data, {"freq": "A", "unit": "THS_PER", "na_item": "POP_NC", "geo": geography, "time": period})
            if debt is None or population is None:
                continue
            if debt < 0 or population <= 0:
                raise SupplementalSnapshotError(f"invalid debt-per-capita input: {geography}/{year}")
            point = {
                **_point(period, round(debt * 1000 / population, 2), "euro per inhabitant", "annual", {
                    **debt_source,
                    "id": "eurostat:gov_10dd_edpt1+nama_10_pe",
                    "owner": "Eurostat",
                    "raw_sha256": combined_hash,
                }, ";".join(filter(None, (debt_status, population_status))) or None),
                "derivation": {
                    "formula": "debt_stock_mio_eur * 1000 / population_thousand",
                    "debt_stock_mio_eur": debt,
                    "population_thousand": population,
                    "debt_year": year,
                    "population_year": year,
                    "debt_sector": "S13",
                    "debt_item": "GD",
                    "population_item": "POP_NC",
                },
                "component_sources": [
                    {"dataset_code": debt_source["dataset_code"], "raw_sha256": debt_source["raw_sha256"], "source_url": debt_source["query_url"]},
                    {"dataset_code": population_source["dataset_code"], "raw_sha256": population_source["raw_sha256"], "source_url": population_source["query_url"]},
                ],
            }
            points.append(point)
        if not points:
            raise SupplementalSnapshotError(f"no debt-per-capita observations: {geography}")
        geographies.append({"geography": geography, "points": points})
    return {
        "indicator_id": "debt_per_capita",
        "label": "Debito pubblico per abitante",
        "usage": "context_only",
        "frequency": "annual",
        "latest_published_period": max(point["period"] for geography in geographies for point in geography["points"]),
        "geographies": geographies,
    }


def _owner(url: str) -> str:
    hostname = urllib.parse.urlparse(url).hostname or ""
    if hostname.endswith("normattiva.it"):
        return "Normattiva"
    if hostname.endswith("quirinale.it"):
        return "Presidenza della Repubblica"
    if hostname.endswith("ecb.europa.eu"):
        return "Banca centrale europea"
    if hostname.endswith("bancaditalia.it"):
        return "Banca d'Italia"
    if hostname.endswith("camera.it"):
        return "Camera dei deputati"
    if hostname.endswith("upbilancio.it"):
        return "Ufficio parlamentare di bilancio"
    if hostname.endswith("mimit.gov.it"):
        return "Ministero delle Imprese e del Made in Italy"
    if hostname.endswith("europa.eu") and "/eurostat/" in urllib.parse.urlparse(url).path:
        return "Eurostat"
    if hostname.endswith("europa.eu"):
        return "Commissione europea"
    raise SupplementalSnapshotError(f"unsupported context source: {url}")


def _context_item(
    item_id: str,
    title: str,
    summary: str,
    start_date: str,
    end_date: str | None,
    channel: str,
    url: str,
    retrieved_at: str,
    precision: str = "day",
    relation: str = "cross_government",
    rule: str = "Elemento sovrapposto al mandato con fonte ufficiale e canale economico documentato.",
    additional_urls: tuple[str, ...] = (),
) -> dict[str, Any]:
    normalized_id = item_id.split(":", 1)
    if len(normalized_id) != 2:
        raise SupplementalSnapshotError(f"invalid context item id: {item_id}")
    stable_id = f"{normalized_id[0]}:{normalized_id[1].replace(':', '-')}"
    evidence = {
        "id": stable_id,
        "title": title,
        "summary": summary,
        "period": f"{start_date}–{end_date}" if end_date else f"{start_date}–in corso",
        "start_date": start_date,
        "end_date_or_null": end_date,
        "date_precision": precision,
        "economic_channel": channel,
        "mandate_relation": relation,
        "selection_rule": rule,
        "score_impact": "none",
        "sources": [
            {"owner": _owner(source_url), "type": "official", "url": source_url}
            for source_url in (url, *additional_urls)
        ],
    }
    return {
        **evidence,
        "retrieved_at": retrieved_at,
        "evidence_sha256": _canonical_hash(evidence),
    }


def _ready_slide(category: str, title: str, label: str, summary: str, items: list[dict[str, Any]]) -> dict[str, Any]:
    if not items:
        raise SupplementalSnapshotError(f"ready context without items: {category}")
    return {
        "category": category,
        "title": title,
        "label": label,
        "summary": summary,
        "status": "ready",
        "catalog_complete": True,
        "score_impact": "none",
        "items": sorted(items, key=lambda item: (item["start_date"], item["id"])),
    }


def _empty_slide(category: str, title: str, label: str, summary: str) -> dict[str, Any]:
    return {
        "category": category,
        "title": title,
        "label": label,
        "summary": summary,
        "status": "empty",
        "catalog_complete": True,
        "score_impact": "none",
        "message": "Il catalogo verificato non contiene elementi che soddisfano insieme periodo, fonte ufficiale e canale economico documentato.",
        "items": [],
    }


ITALIAN_MONTHS = {
    "gennaio": 1, "febbraio": 2, "marzo": 3, "aprile": 4, "maggio": 5, "giugno": 6,
    "luglio": 7, "agosto": 8, "settembre": 9, "ottobre": 10, "novembre": 11, "dicembre": 12,
}


def _act_date(act: str) -> str:
    import re
    match = re.search(r"\b(\d{1,2})\s+([a-z]+)\s+(\d{4})\b", act.lower())
    if not match or match.group(2) not in ITALIAN_MONTHS:
        raise SupplementalSnapshotError(f"cannot derive act date: {act}")
    return f"{int(match.group(3)):04d}-{ITALIAN_MONTHS[match.group(2)]:02d}-{int(match.group(1)):02d}"


def _measure_period(measure: dict[str, Any]) -> tuple[str, str | None, str]:
    if measure["act"].startswith("PNRR italiano"):
        return "2021-01-01", None, "year"
    act_date = _act_date(measure["act"])
    return act_date, None, "day"


def _date_overlaps(start: str, end: str | None, window_start: str, window_end: str) -> bool:
    return start <= window_end and (end is None or end >= window_start)


def _context_start(item: dict[str, Any]) -> str:
    return f"{int(item['startYear']):04d}-01-01"


def _context_end(item: dict[str, Any]) -> str:
    return f"{int(item['endYear']):04d}-12-31"


def _format_euro_it(value: float) -> str:
    return f"{value:,.2f}".replace(",", "_").replace(".", ",").replace("_", ".")


def _period_end(period: str) -> str:
    start = dt.date.fromisoformat(_period_start(period))
    if "-Q" in period:
        month = start.month + 3
        next_start = dt.date(start.year + (month > 12), ((month - 1) % 12) + 1, 1)
    elif len(period) == 7:
        next_start = dt.date(start.year + (start.month == 12), (start.month % 12) + 1, 1)
    else:
        next_start = dt.date(start.year + 1, 1, 1)
    return (next_start - dt.timedelta(days=1)).isoformat()


def _format_inherited_value(indicator_id: str, value: float) -> str:
    if indicator_id == "debt_per_capita":
        return f"{_format_euro_it(value)} euro per abitante"
    return f"{str(round(value, 1)).replace('.', ',')}%"


def _build_contexts(core: dict[str, Any], chronology: dict[str, Any], series: list[dict[str, Any]], retrieved_at: str) -> list[dict[str, Any]]:
    measures_by_government: dict[str, list[dict[str, Any]]] = {}
    for measure in core["measures"]:
        measures_by_government.setdefault(measure["government"].replace("-", " ").lower(), []).append(measure)
    chronology_by_id = {item["id"]: item for item in chronology["governments"]}
    series_by_id = {item["indicator_id"]: item for item in series}
    contexts = core["contexts"]
    ecb_ids = {"euro-convergence", "euro-introduction", "sovereign-debt-crisis", "ecb-purchase-programmes", "ecb-rate-tightening"}
    crisis_ids = {"dot-com-slowdown", "global-financial-crisis", "sovereign-debt-crisis", "italian-banking-stress", "trade-slowdown", "pandemic", "energy-inflation"}
    ukraine_source_url = "https://commission.europa.eu/topics/eu-solidarity-ukraine_en"
    output = []
    for index, government in enumerate(core["governments"]):
        start_date = chronology_by_id[government["id"]]["startDate"]
        next_government = core["governments"][index + 1] if index + 1 < len(core["governments"]) else None
        end_date = chronology_by_id[next_government["id"]]["startDate"] if next_government else None
        selection_end = end_date or SNAPSHOT_DATE
        inheritance_items = []
        inheritance_specs = (
            ("debt_per_capita", "Debito pubblico per abitante", "inherited_public_debt_per_capita"),
            ("inflation", "Inflazione armonizzata", "inherited_harmonised_inflation"),
            ("unemployment", "Tasso di disoccupazione", "inherited_unemployment_rate"),
        )
        for indicator_id, title, channel in inheritance_specs:
            italian_points = series_by_id[indicator_id]["geographies"][0]["points"]
            eligible = [point for point in italian_points if _period_end(point["period"]) < start_date]
            if not eligible:
                continue
            inherited = max(eligible, key=lambda point: point["period_start"])
            inheritance_items.append(_context_item(
                f"{government['id']}:inheritance-{indicator_id.replace('_', '-')}",
                title,
                f"Ultimo dato osservato prima del giuramento: {_format_inherited_value(indicator_id, inherited['value'])} ({inherited['period']}).",
                inherited["period_start"],
                _period_end(inherited["period"]),
                channel,
                inherited["source_url"],
                inherited["retrieved_at"],
                "month" if inherited["frequency"] == "monthly" else "quarter" if inherited["frequency"] == "quarterly" else "year",
                relation="inherited",
                rule="Ultima osservazione ufficiale conclusa prima del giuramento.",
            ))
        if inheritance_items:
            inheritance = _ready_slide(
                "inheritance", "Situazione ereditata", "Eredità",
                "Condizioni disponibili prima dell'insediamento, senza attribuzione al nuovo governo.", inheritance_items,
            )
        else:
            inheritance_items = []
            inheritance = _empty_slide("inheritance", "Situazione ereditata", "Eredità", "Condizioni disponibili prima dell'insediamento.")

        key = government["name"].replace("-", " ").lower()
        measures = []
        for measure in measures_by_government.get(key, []):
            measure_start, measure_end, _ = _measure_period(measure)
            if _date_overlaps(measure_start, measure_end, start_date, selection_end):
                measures.append(measure)
        if measures:
            measure_items = []
            for position, measure in enumerate(measures):
                measure_start, measure_end, measure_precision = _measure_period(measure)
                semantic_id = f"measure-{measure_start[:4]}-{position + 1}"
                if government["id"] == "meloni-i":
                    semantic_id = {
                        "2023-02-16": "measure-2023-credits",
                        "2024-12-30": "measure-2024-tax-wedge",
                        "2025-12-30": "measure-2026-budget",
                        "2021-01-01": "recovery-plan",
                    }[measure_start]
                measure_items.append(_context_item(
                    f"{government['id']}:{semantic_id}",
                    measure["act"],
                    f"{measure['act']}: {measure['mechanism']} {measure['evidence']}",
                    measure_start,
                    measure_end,
                    "documented_government_measure",
                    measure["sourceUrl"],
                    retrieved_at,
                    measure_precision,
                    relation="cross_government" if measure["status"] == "implemented-across-governments" else "during",
                    rule="Atto approvato o attuato nel mandato, distinto dai risultati economici osservati.",
                ))
            measure_slide = _ready_slide(
                "laws_measures", "Manovre e misure", "Misure",
                "Atti principali approvati o attuati; approvazione ed esiti restano distinti.", measure_items,
            )
        else:
            measure_items = []
            measure_slide = _empty_slide("laws_measures", "Manovre e misure", "Misure", "Atti principali verificati nel periodo.")

        ecb_items = [
            _context_item(
                f"{government['id']}:{'ecb-rate-cycle' if item['id'] == 'ecb-rate-tightening' else 'ecb-' + item['id']}",
                "Ciclo dei tassi BCE" if item["id"] == "ecb-rate-tightening" else item["label"],
                "Dal 2022 la BCE ha prima alzato e poi ridotto i tassi: il ciclo continua a incidere su credito e costo del debito nell'intera area euro." if item["id"] == "ecb-rate-tightening" else item["summary"],
                "2022-07-21" if item["id"] == "ecb-rate-tightening" else _context_start(item),
                None if item["id"] == "ecb-rate-tightening" else _context_end(item),
                "common_monetary_policy",
                item["sourceUrl"],
                retrieved_at,
                "day" if item["id"] == "ecb-rate-tightening" else "year",
                relation="cross_government",
                rule="Decisione comune dell'area euro sovrapposta al mandato e documentata dalla BCE.",
            )
            for item in contexts
            if item["id"] in ecb_ids and _date_overlaps(_context_start(item), _context_end(item), start_date, selection_end)
        ]
        ecb_slide = _ready_slide(
            "eurozone_ecb", "BCE ed eurozona", "BCE",
            "Decisioni comuni dell'area euro, distinte dalle azioni del governo italiano.", ecb_items,
        ) if ecb_items else _empty_slide("eurozone_ecb", "BCE ed eurozona", "BCE", "Decisioni comuni dell'area euro nel periodo.")

        crisis_items = [
            _context_item(
                f"{government['id']}:{item['id']}",
                item["label"],
                item["summary"],
                _context_start(item),
                _context_end(item),
                "documented_external_or_financial_shock",
                item["sourceUrl"],
                retrieved_at,
                "year",
                relation="cross_government",
                rule="Shock europeo o globale sovrapposto al mandato con canale economico documentato.",
            )
            for item in contexts
            if item["id"] in crisis_ids and _date_overlaps(_context_start(item), _context_end(item), start_date, selection_end)
        ]
        war_start = "2022-02-24"
        war_overlaps = _date_overlaps(war_start, None, start_date, selection_end)
        energy_item_id = f"{government['id']}:energy-inflation"
        energy_item = next((item for item in crisis_items if item["id"] == energy_item_id), None)
        if war_overlaps and energy_item:
            crisis_items = [item for item in crisis_items if item["id"] != energy_item_id]
        war_items = [_context_item(
            f"{government['id']}:ukraine-war",
            "Energia, inflazione e invasione dell'Ucraina" if energy_item else "Invasione russa dell'Ucraina",
            (
                "L'inflazione energetica era già in aumento nel 2021; l'invasione russa del 24 febbraio 2022 "
                "aggravò lo shock e i rischi per energia, commercio e finanza pubblica."
                if energy_item else
                "L'invasione russa dell'Ucraina resta un fattore geopolitico aperto per energia, commercio, bilanci pubblici e aiuti europei."
            ),
            war_start,
            None,
            "energy_trade_fiscal_support_and_geopolitics",
            energy_item["sources"][0]["url"] if energy_item else ukraine_source_url,
            retrieved_at,
            relation="cross_government",
            rule="Conflitto sovrapposto al mandato con canale economico documentato da una fonte istituzionale.",
            additional_urls=(ukraine_source_url,) if energy_item else (),
        )] if war_overlaps else []
        current_items = []
        if government["id"] == "meloni-i":
            current_items.extend([
                _context_item(
                    "meloni-i:trade-tensions",
                    "Dazi USA e tensioni commerciali",
                    "Nel 2025 il surplus di conto corrente dell'area euro è sceso dal 2,7% all'1,7% del PIL; la BCE indica fra i fattori i dazi statunitensi e i cambiamenti nel commercio globale.",
                    "2025-01-01",
                    "2025-12-31",
                    "trade_exports_investment_and_uncertainty",
                    "https://www.ecb.europa.eu/press/economic-bulletin/focus/2026/html/ecb.ebbox202604_08~de66a3786d.en.html",
                    retrieved_at,
                    "year",
                    rule="Tensione commerciale sovrapposta al mandato con un effetto osservato e documentato dalla BCE per l'area euro.",
                ),
                _context_item(
                    "meloni-i:iran-war-energy-shock",
                    "Guerra in Iran e shock dei carburanti",
                    "Dal 23 febbraio al 4 maggio 2026, il MIMIT registra in Italia un aumento del prezzo medio alla pompa dell'8,1% per la benzina e del 20,2% per il gasolio. Nello stesso periodo la BCE collega lo shock energetico alla guerra in Medio Oriente e alla chiusura dello Stretto di Hormuz; è contesto esterno, non un effetto attribuito al governo.",
                    "2026-02-28",
                    None,
                    "oil_supply_fuel_prices_inflation_and_growth",
                    "https://www.mimit.gov.it/images/stories/documenti/presentazione_BMTI_-_CAR_mar_26_CARBURANTI_-_20260507_1.pdf",
                    retrieved_at,
                    relation="cross_government",
                    rule="Conflitto sovrapposto al mandato con prezzi italiani osservati e canale energetico documentato da fonti ufficiali.",
                    additional_urls=("https://www.ecb.europa.eu/press/blog/date/2026/html/ecb.blog20260603~3015f38292.en.html",),
                ),
            ])
        geopolitics_items = crisis_items + war_items + current_items
        geopolitics_slide = _ready_slide(
            "geopolitics_crises", "Geopolitica, shock e crisi", "Crisi e guerre",
            "Solo eventi esterni essenziali, sovrapposti al mandato e con un canale economico documentato.", geopolitics_items,
        ) if geopolitics_items else _empty_slide(
            "geopolitics_crises", "Geopolitica, shock e crisi", "Crisi e guerre",
            "Eventi esterni essenziali verificati nel periodo.",
        )

        chronology_item = chronology_by_id[government["id"]]
        chronology_items = [_context_item(
            f"{government['id']}:chronology-start",
            "Giuramento del governo",
            chronology_item["sourceLocator"],
            start_date,
            end_date,
            "institutional_timeline",
            chronology_item["sourceUrl"],
            chronology["verifiedAt"] + "T00:00:00Z",
            relation="during",
            rule="Data di giuramento verificata sulla fonte istituzionale; la fine esclusiva coincide con il giuramento del successore.",
        )]
        chronology_slide = _ready_slide(
            "chronology", "Cronologia", "Date",
            "La stessa regola istituzionale delimita tutti i mandati.", chronology_items,
        )
        external_items = geopolitics_items + ecb_items
        external_titles = "; ".join(item["title"] for item in external_items[:3])
        if len(external_items) > 3:
            external_titles += f"; altri {len(external_items) - 3} eventi documentati"
        measure_titles = "; ".join(item["title"] for item in measure_items[:2])
        if len(measure_items) > 2:
            measure_titles += f"; altri {len(measure_items) - 2} atti documentati"
        overview_items = [
            _context_item(
                f"{government['id']}:overview-1-inheritance", "Condizioni ereditate",
                " ".join(item["summary"] for item in inheritance_items) if inheritance_items else "Non sono disponibili dati osservati conclusi prima dell'insediamento.",
                start_date, start_date, "condizioni_economiche_iniziali",
                inheritance_items[0]["sources"][0]["url"] if inheritance_items else chronology_item["sourceUrl"], retrieved_at,
                relation="inherited", rule="Sintesi delle condizioni documentate nella slide successiva.",
            ),
            _context_item(
                f"{government['id']}:overview-2-external", "Contesto esterno ed eurozona",
                f"Il periodo attraversa {external_titles}." if external_titles else "Non risultano eventi esterni selezionati dal catalogo verificato.",
                start_date, end_date, "shock_geopolitica_e_condizioni_finanziarie",
                external_items[0]["sources"][0]["url"] if external_items else chronology_item["sourceUrl"], retrieved_at,
                relation="cross_government", rule="Sintesi degli eventi essenziali documentati nelle categorie successive.",
            ),
            _context_item(
                f"{government['id']}:overview-3-actions", "Azioni economiche del governo",
                f"Atti principali: {measure_titles}. Gli esiti economici restano distinti." if measure_titles else "Non risultano atti selezionati dal catalogo verificato.",
                start_date, end_date, "politica_fiscale_riforme_e_investimenti",
                measure_items[0]["sources"][0]["url"] if measure_items else chronology_item["sourceUrl"], retrieved_at,
                relation="during", rule="Sintesi degli atti documentati nella slide delle misure.",
            ),
        ]
        overview_slide = _ready_slide(
            "overview", "Il mandato in breve", "In breve",
            "Punto di partenza, contesto esterno e azioni principali in un'unica sintesi.", overview_items,
        )
        output.append({
            "government_id": government["id"],
            "government_name": chronology_item["name"],
            "slides": [overview_slide, inheritance, geopolitics_slide, ecb_slide, measure_slide, chronology_slide],
        })
    return output


def _contexts_for_snapshot(core: dict[str, Any], chronology: dict[str, Any], series: list[dict[str, Any]], retrieved_at: str) -> list[dict[str, Any]]:
    if "measures" in core and "contexts" in core:
        return _build_contexts(core, chronology, series, retrieved_at)
    existing = _load(OUTPUT).get("contexts")
    if not isinstance(existing, list):
        raise SupplementalSnapshotError("existing context catalog missing")
    return existing


def build_snapshot(retrieved_at: str, *, core=None, chronology=None, existing=None, core_hash=None) -> dict[str, Any]:
    core = core if core is not None else _load(CORE_PATH)
    chronology = chronology if chronology is not None else _load(CHRONOLOGY_PATH)
    ameco = _ameco_source(core)
    inflation_data, inflation_payload, inflation_url = _fetch_eurostat("prc_hicp_minr", (("freq", "M"), ("unit", "RCH_A"), ("coicop18", "TOTAL")), "1996-01")
    unemployment_data, unemployment_payload, unemployment_url = _fetch_eurostat("une_rt_m", (("freq", "M"), ("s_adj", "SA"), ("age", "TOTAL"), ("sex", "T"), ("unit", "PC_ACT")), "1997-01")
    employment_data, employment_payload, employment_url = _fetch_eurostat("lfsi_emp_q", (("freq", "Q"), ("indic_em", "EMP_LFS"), ("s_adj", "SA"), ("sex", "T"), ("age", "Y20-64"), ("unit", "PC_POP")), "2009-Q1")
    real_gdp_per_capita_data, real_gdp_per_capita_payload, real_gdp_per_capita_url = _fetch_eurostat("namq_10_pc", (("freq", "Q"), ("unit", "CLV_I20_HAB"), ("s_adj", "NSA"), ("na_item", "B1GQ")), "1995-Q1")
    debt_data, debt_payload, debt_url = _fetch_eurostat("gov_10dd_edpt1", (("freq", "A"), ("unit", "MIO_EUR"), ("sector", "S13"), ("na_item", "GD")))
    debt_ratio_data, debt_ratio_payload, debt_ratio_url = _fetch_eurostat("gov_10q_ggdebt", (("freq", "Q"), ("unit", "PC_GDP"), ("sector", "S13"), ("na_item", "GD")), "1995-Q1")
    primary_balance_data, primary_balance_payload, primary_balance_url = _fetch_eurostat("gov_10q_ggnfa", (("freq", "Q"), ("unit", "PC_GDP"), ("s_adj", "NSA"), ("sector", "S13"), ("na_item", "B9"), ("na_item", "D41PAY")), "1995-Q1")
    investment_share_data, investment_share_payload, investment_share_url = _fetch_eurostat("namq_10_gdp", (("freq", "Q"), ("unit", "PC_GDP"), ("s_adj", "SCA"), ("na_item", "P51G")), "1995-Q1")
    population_data, population_payload, population_url = _fetch_eurostat("nama_10_pe", (("freq", "A"), ("unit", "THS_PER"), ("na_item", "POP_NC")))
    inflation_source = _source("prc_hicp_minr", "HICP monthly annual rate of change", inflation_payload, inflation_url, inflation_data, retrieved_at)
    unemployment_source = _source("une_rt_m", "Monthly unemployment rate", unemployment_payload, unemployment_url, unemployment_data, retrieved_at)
    employment_source = _source("lfsi_emp_q", "Quarterly seasonally adjusted employment rate", employment_payload, employment_url, employment_data, retrieved_at)
    real_gdp_per_capita_source = _source("namq_10_pc", "Quarterly real GDP per capita", real_gdp_per_capita_payload, real_gdp_per_capita_url, real_gdp_per_capita_data, retrieved_at)
    debt_source = _source("gov_10dd_edpt1", "Government deficit/surplus, debt and associated data", debt_payload, debt_url, debt_data, retrieved_at)
    debt_ratio_source = _source("gov_10q_ggdebt", "Quarterly general government gross debt", debt_ratio_payload, debt_ratio_url, debt_ratio_data, retrieved_at)
    primary_balance_source = _source("gov_10q_ggnfa", "Quarterly government finance statistics", primary_balance_payload, primary_balance_url, primary_balance_data, retrieved_at)
    investment_share_source = _source("namq_10_gdp", "Quarterly national accounts main GDP aggregates", investment_share_payload, investment_share_url, investment_share_data, retrieved_at)
    population_source = _source("nama_10_pe", "Population and employment by main activity", population_payload, population_url, population_data, retrieved_at)

    series = _ameco_series(core, ameco)
    series.extend([
        _eurostat_series("inflation", "Inflazione armonizzata", "annual rate of change, percent", inflation_data, inflation_source, {"freq": "M", "unit": "RCH_A", "coicop18": "TOTAL"}, "monthly"),
        _eurostat_series("unemployment", "Tasso di disoccupazione", "percent of labour force", unemployment_data, unemployment_source, {"freq": "M", "s_adj": "SA", "age": "TOTAL", "sex": "T", "unit": "PC_ACT"}, "monthly"),
        _eurostat_series("employment_rate", "Tasso di occupazione 20–64", "percent of population aged 20–64", employment_data, employment_source, {"freq": "Q", "indic_em": "EMP_LFS", "s_adj": "SA", "sex": "T", "age": "Y20-64", "unit": "PC_POP"}, "quarterly"),
        _eurostat_series("real_gdp_per_capita", "PIL reale per abitante", "chain linked volumes, index 2020=100 per inhabitant", real_gdp_per_capita_data, real_gdp_per_capita_source, {"freq": "Q", "unit": "CLV_I20_HAB", "s_adj": "NSA", "na_item": "B1GQ"}, "quarterly"),
        _eurostat_series("debt_ratio", "Debito pubblico sul PIL", "percent of GDP", debt_ratio_data, debt_ratio_source, {"freq": "Q", "unit": "PC_GDP", "sector": "S13", "na_item": "GD"}, "quarterly"),
        _primary_balance_series(primary_balance_data, primary_balance_source),
        _eurostat_series("investment_share", "Investimenti totali sul PIL", "percent of GDP", investment_share_data, investment_share_source, {"freq": "Q", "unit": "PC_GDP", "s_adj": "SCA", "na_item": "P51G"}, "quarterly"),
    ])
    debt_per_capita = _debt_per_capita_series(debt_data, debt_source, population_data, population_source)
    series.append(debt_per_capita)
    by_id = {item["indicator_id"]: item for item in series}
    ordered_series = [by_id[indicator_id] for indicator_id in INDICATOR_ORDER]
    snapshot = {
        "schema_version": SCHEMA_VERSION,
        "snapshot_version": SNAPSHOT_VERSION,
        "as_of_date": retrieved_at[:10],
        "coverage": {
            "first_period": "1995",
            "latest_published_periods": [{"indicator_id": item["indicator_id"], "period": item["latest_published_period"]} for item in ordered_series],
            "missing_rule": "omit unavailable source observations; never interpolate",
        },
        "sources": [
            ameco,
            inflation_source,
            unemployment_source,
            employment_source,
            real_gdp_per_capita_source,
            debt_source,
            debt_ratio_source,
            primary_balance_source,
            investment_share_source,
            population_source,
        ],
        "series": ordered_series,
        "contexts": existing["contexts"] if existing is not None else _contexts_for_snapshot(core, chronology, ordered_series, retrieved_at),
        "score_contract": {"supplemental_score_impact": "none", "core_artifact_sha256": core_hash or _sha256(CORE_PATH.read_bytes())},
    }
    validate(snapshot, core_hash=core_hash, chronology=chronology)
    return snapshot


def validate(snapshot: dict[str, Any], *, core_hash=None, chronology=None) -> None:
    expected_keys = {"schema_version", "snapshot_version", "as_of_date", "coverage", "sources", "series", "contexts", "score_contract"}
    if set(snapshot) != expected_keys:
        raise SupplementalSnapshotError("unexpected snapshot fields")
    try:
        if dt.date.fromisoformat(snapshot["as_of_date"]).isoformat() != snapshot["as_of_date"]:
            raise ValueError
    except (TypeError, ValueError) as exc:
        raise SupplementalSnapshotError("invalid snapshot reference date") from exc
    if snapshot.get("schema_version") != SCHEMA_VERSION or snapshot.get("snapshot_version") != SNAPSHOT_VERSION:
        raise SupplementalSnapshotError("snapshot identity mismatch")
    if snapshot.get("score_contract") != {
        "supplemental_score_impact": "none",
        "core_artifact_sha256": core_hash or _sha256(CORE_PATH.read_bytes()),
    }:
        raise SupplementalSnapshotError("page data must not affect the score and must reference the current core artifact")
    series = snapshot.get("series")
    if not isinstance(series, list) or [item.get("indicator_id") for item in series] != list(INDICATOR_ORDER):
        raise SupplementalSnapshotError("indicator registry mismatch")
    for item in series:
        if item.get("frequency") not in {"annual", "quarterly", "monthly"} or [geo.get("geography") for geo in item.get("geographies", [])] != [code for code, _ in COUNTRIES]:
            raise SupplementalSnapshotError(f"series contract mismatch: {item.get('indicator_id')}")
        all_periods = []
        for geography in item["geographies"]:
            period_starts = []
            for point in geography.get("points", []):
                period_starts.append(point.get("period_start"))
                all_periods.append(point.get("period"))
                if point.get("status") not in {"observed", "provisional", "estimated"} or point.get("frequency") != item["frequency"] or not str(point.get("period", "")).startswith(str(point.get("year"))):
                    raise SupplementalSnapshotError("unsupported publication status or synthetic point")
                if not isinstance(point.get("value"), (int, float)) or not math.isfinite(point["value"]):
                    raise SupplementalSnapshotError("non-finite point")
                if not isinstance(point.get("raw_sha256"), str) or len(point["raw_sha256"]) != 64:
                    raise SupplementalSnapshotError("point without source hash")
            if period_starts != sorted(set(period_starts)) or not period_starts:
                raise SupplementalSnapshotError("unordered, duplicated or empty series")
        if item.get("latest_published_period") != max(all_periods):
            raise SupplementalSnapshotError("latest published period mismatch")
    contexts = snapshot.get("contexts")
    chronology = chronology if chronology is not None else _load(CHRONOLOGY_PATH)
    if not isinstance(contexts, list) or [(item.get("government_id"), item.get("government_name")) for item in contexts] != [(item["id"], item["name"]) for item in chronology["governments"]]:
        raise SupplementalSnapshotError("context government coverage mismatch")
    for context in contexts:
        slides = context.get("slides", [])
        if [slide.get("category") for slide in slides] != list(CONTEXT_CATEGORIES):
            raise SupplementalSnapshotError(f"context category mismatch: {context.get('government_id')}")
        for slide in slides:
            common_slide_keys = {"category", "title", "label", "summary", "status", "catalog_complete", "score_impact", "items"}
            expected_slide_keys = common_slide_keys | ({"message"} if slide.get("status") == "empty" else set())
            if set(slide) != expected_slide_keys:
                raise SupplementalSnapshotError("unexpected context slide fields")
            if slide.get("score_impact") != "none" or slide.get("status") not in {"ready", "empty"} or slide.get("catalog_complete") is not True:
                raise SupplementalSnapshotError("context impact/status mismatch")
            if slide["status"] == "empty" and slide.get("items"):
                raise SupplementalSnapshotError("empty context contains items")
            if slide["status"] == "ready":
                items = slide.get("items")
                if not isinstance(items, list) or not items:
                    raise SupplementalSnapshotError("ready context lacks documented items")
                for item in items:
                    item_evidence = {
                        "id": item["id"],
                        "title": item["title"],
                        "summary": item["summary"],
                        "period": item["period"],
                        "start_date": item["start_date"],
                        "end_date_or_null": item["end_date_or_null"],
                        "date_precision": item["date_precision"],
                        "economic_channel": item["economic_channel"],
                        "mandate_relation": item["mandate_relation"],
                        "selection_rule": item["selection_rule"],
                        "score_impact": item["score_impact"],
                        "sources": item["sources"],
                    }
                    if not item.get("sources") or item.get("evidence_sha256") != _canonical_hash(item_evidence):
                        raise SupplementalSnapshotError("context item evidence hash mismatch")
    debt = next(item for item in series if item["indicator_id"] == "debt_per_capita")
    for geography in debt["geographies"]:
        for point in geography["points"]:
            derivation = point.get("derivation")
            components = point.get("component_sources")
            if not isinstance(derivation, dict) or not isinstance(components, list) or len(components) != 2:
                raise SupplementalSnapshotError("debt per capita lacks derivation")
            expected = round(derivation["debt_stock_mio_eur"] * 1000 / derivation["population_thousand"], 2)
            if derivation["debt_year"] != point["year"] or derivation["population_year"] != point["year"] or point["value"] != expected:
                raise SupplementalSnapshotError("debt per capita does not reconcile")


def main() -> None:
    parser = argparse.ArgumentParser()
    parser.add_argument("--refresh", action="store_true")
    parser.add_argument("--refresh-contexts", action="store_true")
    parser.add_argument("--check", action="store_true")
    parser.add_argument("--retrieved-at")
    args = parser.parse_args()
    if sum((args.refresh, args.refresh_contexts, args.check)) != 1:
        parser.error("choose exactly one of --refresh, --refresh-contexts or --check")
    if args.check:
        validate(_load(OUTPUT))
        print(f"validated {OUTPUT.relative_to(ROOT)}")
        return
    if not args.retrieved_at:
        parser.error("--refresh requires --retrieved-at")
    retrieved_at = _timestamp(args.retrieved_at)
    if args.refresh_contexts:
        snapshot = _load(OUTPUT)
        snapshot["schema_version"] = SCHEMA_VERSION
        snapshot["snapshot_version"] = SNAPSHOT_VERSION
        snapshot["contexts"] = _contexts_for_snapshot(_load(CORE_PATH), _load(CHRONOLOGY_PATH), snapshot["series"], retrieved_at)
    else:
        snapshot = build_snapshot(retrieved_at)
    validate(snapshot)
    payload = json.dumps(snapshot, ensure_ascii=False, indent=2) + "\n"
    OUTPUT.parent.mkdir(parents=True, exist_ok=True)
    temporary_path: Path | None = None
    try:
        with tempfile.NamedTemporaryFile("w", encoding="utf-8", dir=OUTPUT.parent, delete=False) as handle:
            temporary_path = Path(handle.name)
            handle.write(payload)
            handle.flush()
            os.fsync(handle.fileno())
        os.replace(temporary_path, OUTPUT)
        temporary_path = None
    finally:
        if temporary_path is not None:
            temporary_path.unlink(missing_ok=True)
    validate(_load(OUTPUT))
    print(f"wrote {OUTPUT.relative_to(ROOT)}")


if __name__ == "__main__":
    main()
