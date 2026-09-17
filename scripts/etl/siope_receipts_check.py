#!/usr/bin/env python3
"""Offline structural and integer-cent reconciliation for municipal receipts."""
from __future__ import annotations

import argparse
import json
import math
import re
from collections import defaultdict
from datetime import datetime
from decimal import Decimal
from email.utils import parsedate_to_datetime
from pathlib import Path

try:
    from . import siope_municipal_core as core
    from .siope_receipts_spec import YEARS, TITLE_LABELS, paths_for_year, source_urls
except ImportError:
    import siope_municipal_core as core
    from siope_receipts_spec import YEARS, TITLE_LABELS, paths_for_year, source_urls

REGIONS = {
    "Abruzzo", "Basilicata", "Calabria", "Campania", "Emilia-Romagna",
    "Friuli-Venezia Giulia", "Lazio", "Liguria", "Lombardia", "Marche",
    "Molise", "Piemonte", "Puglia", "Sardegna", "Sicilia", "Toscana",
    "Trentino-Alto Adige/Südtirol", "Umbria", "Valle d'Aosta/Vallée d'Aoste", "Veneto",
}
COLUMNS = ["taxCode", "codiceIpa", "name", "province", "region", "population", "totalCents", "titleCents"]


def require(condition: bool, field: str) -> None:
    if not condition:
        raise ValueError(f"SIOPE entrate: {field} non valido o non riconciliato")


def count(value, field: str) -> int:
    require(type(value) is int and 0 <= value <= core.MAX_SAFE_CENTS, field)
    return value


def cents(value, field: str) -> int:
    require(type(value) is int and abs(value) <= core.MAX_SAFE_CENTS, field)
    return value


def euro_cents(value, field: str) -> int:
    require(type(value) in (int, float) and math.isfinite(value), field)
    scaled = Decimal(str(value)) * 100
    require(scaled == scaled.to_integral_value(), field)
    return cents(int(scaled), field)


def text(value, field: str) -> None:
    require(isinstance(value, str) and bool(value.strip()), field)


def timestamp(value, field: str, *, http: bool = False) -> datetime:
    text(value, field)
    try:
        parsed = parsedate_to_datetime(value) if http else datetime.fromisoformat(value.replace("Z", "+00:00"))
    except (ValueError, TypeError) as error:
        raise ValueError(f"SIOPE entrate: data {field} non valida") from error
    require(parsed.tzinfo is not None, field)
    return parsed


def keys(value: dict, expected: str, field: str) -> None:
    require(isinstance(value, dict) and set(value) == set(expected.split()), field)


def validate_snapshot(summary: dict, detail: dict, *, require_national: bool = False) -> dict:
    keys(summary, "schemaVersion scope flow unit accountingBasis year generatedAt latestMonth latestMonthLabel totalCollected receiptsWithPopulation populationCovered nationalPerCapita coverage monthly regions titles source methodology", "summary schema")
    keys(detail, "schemaVersion scope flow unit accountingBasis year generatedAt latestMonth titleOrder titleLabels columns coverage municipalities methodology", "detail schema")
    year = summary["year"]
    require(type(year) is int and year in YEARS, "year")
    for data, scope, unit in ((summary, "municipal-receipts", "EUR"), (detail, "municipal-receipts-detail", "EUR-cent")):
        require(type(data["schemaVersion"]) is int and data["schemaVersion"] == 1, "schemaVersion")
        require(data["scope"] == scope and data["flow"] == "entrate" and data["unit"] == unit and data["accountingBasis"] == "cash", "flow/scope/unit/basis")
        require(data["year"] == year and data["generatedAt"] == summary["generatedAt"], "period/provenance pair")
        timestamp(data["generatedAt"], "generatedAt")
        require(type(data["latestMonth"]) is int and 1 <= data["latestMonth"] <= 12, "latestMonth")
        require(data["latestMonth"] == summary["latestMonth"], "latestMonth pair")
    require(summary["latestMonthLabel"] == core.MONTH_NAMES[summary["latestMonth"] - 1], "latestMonthLabel")
    require(detail["columns"] == COLUMNS, "columns")
    require(detail["titleOrder"] == list(TITLE_LABELS) and detail["titleLabels"] == TITLE_LABELS, "title vocabulary")
    require(isinstance(detail["municipalities"], list) and bool(detail["municipalities"]), "municipalities")
    rows = detail["municipalities"]
    tax_codes = []
    for row in rows:
        require(isinstance(row, list) and len(row) == 8, "municipality row schema")
        tax, ipa, name, province, region, population, total, titles = row
        require(isinstance(tax, str) and bool(re.fullmatch(r"[0-9]{11}", tax)), "taxCode")
        require(ipa is None or isinstance(ipa, str) and bool(re.fullmatch(r"[A-Za-z0-9_]+", ipa)), "codiceIpa")
        text(name, "municipality name")
        text(province, "province")
        require(region is None or region in REGIONS, "region")
        if population is not None:
            require(count(population, "population") > 1, "population sentinel")
        require((total is None) == (titles is None), "null vs observed zero")
        if total is not None:
            cents(total, "totalCents")
            require(isinstance(titles, list) and len(titles) == len(TITLE_LABELS), "titleCents length")
            require(sum(cents(value, "titleCents") for value in titles) == total, "municipal titles")
        tax_codes.append(tax)
    require(tax_codes == sorted(set(tax_codes)), "duplicate/sorted tax codes")
    ipa_codes = [row[1] for row in rows if row[1] is not None]
    require(len(ipa_codes) == len(set(ipa_codes)), "duplicate IPA identifiers")
    observed = [row for row in rows if row[6] is not None]
    populated = [row for row in observed if row[5] is not None]
    regionalized = [row for row in observed if row[4] is not None]
    require(bool(observed), "no observed movements")
    expected_detail = {
        "activeMunicipalities": len(rows), "withMovements": len(observed),
        "withoutMovements": len(rows) - len(observed),
        "withPopulation": sum(row[5] is not None for row in rows),
        "withRegion": sum(row[4] is not None for row in rows),
        "withIpaIdentifier": sum(row[1] is not None for row in rows),
    }
    require(detail["coverage"] == expected_detail, "detail coverage")
    for field, value in detail["coverage"].items():
        count(value, field)
    coverage = summary["coverage"]
    keys(coverage, "activeSiopeMunicipalities matchedToIpaRegion unmatchedToIpaRegion withMovements withRegion withoutRegion receiptsWithoutRegion movementRows includedMovementRows malformedRows withPopulation withoutPopulation", "coverage schema")
    expected = {
        "activeSiopeMunicipalities": len(rows), "matchedToIpaRegion": expected_detail["withRegion"],
        "unmatchedToIpaRegion": len(rows) - expected_detail["withRegion"],
        "withMovements": len(observed), "withRegion": len(regionalized),
        "withoutRegion": len(observed) - len(regionalized), "malformedRows": 0,
        "withPopulation": len(populated), "withoutPopulation": len(observed) - len(populated),
    }
    for field, value in coverage.items():
        if field != "receiptsWithoutRegion":
            count(value, field)
    require(all(coverage[key] == value for key, value in expected.items()), "summary coverage")
    require(coverage["movementRows"] >= coverage["includedMovementRows"] >= len(observed), "movement rows")
    require(euro_cents(coverage["receiptsWithoutRegion"], "receiptsWithoutRegion") == sum(row[6] for row in observed if row[4] is None), "unregionalized receipts")
    total = cents(sum(row[6] for row in observed), "national total safe cents")
    covered = cents(sum(row[6] for row in populated), "covered total safe cents")
    population = sum(row[5] for row in populated)
    require(euro_cents(summary["totalCollected"], "totalCollected") == total, "national total")
    require(euro_cents(summary["receiptsWithPopulation"], "receiptsWithPopulation") == covered, "covered total")
    require(count(summary["populationCovered"], "populationCovered") == population, "covered population")
    require(summary["nationalPerCapita"] == core.per_capita(covered, population), "national per capita")
    if summary["nationalPerCapita"] is not None:
        euro_cents(summary["nationalPerCapita"], "nationalPerCapita")
    months = []
    cumulative = 0
    require(isinstance(summary["monthly"], list) and bool(summary["monthly"]), "monthly")
    for item in summary["monthly"]:
        keys(item, "month label flow cumulative", "monthly schema")
        month = count(item["month"], "month")
        require(1 <= month <= 12 and item["label"] == core.MONTH_NAMES[month - 1], "month label")
        cumulative = cents(cumulative + euro_cents(item["flow"], "monthly flow"), "monthly sum")
        require(euro_cents(item["cumulative"], "monthly cumulative") == cumulative, "monthly cumulative")
        months.append(month)
    require(months == sorted(set(months)) and months[-1] == summary["latestMonth"] and cumulative == total, "monthly period/total")
    expected_regions: dict[str, list] = defaultdict(list)
    for row in regionalized:
        expected_regions[row[4]].append(row)
    region_names = []
    require(isinstance(summary["regions"], list), "regions")
    for region in summary["regions"]:
        keys(region, "region value perCapitaValue population perCapita municipalities municipalitiesWithPopulation", "region schema")
        name = region["region"]
        require(name in expected_regions, "unobserved region")
        selected = expected_regions[name]
        with_pop = [row for row in selected if row[5] is not None]
        pop = sum(row[5] for row in with_pop) if with_pop else None
        receipts = sum(row[6] for row in with_pop)
        require(euro_cents(region["value"], "region value") == sum(row[6] for row in selected), "region total")
        require(euro_cents(region["perCapitaValue"], "region covered value") == receipts, "region covered total")
        require(region["population"] == pop and region["perCapita"] == core.per_capita(receipts, pop), "region per capita")
        if region["population"] is not None:
            count(region["population"], "region population")
        if region["perCapita"] is not None:
            euro_cents(region["perCapita"], "region per capita")
        require(count(region["municipalities"], "region municipalities") == len(selected), "region municipalities")
        require(count(region["municipalitiesWithPopulation"], "region municipalities with population") == len(with_pop), "region covered municipalities")
        region_names.append(name)
    require(len(region_names) == len(set(region_names)) and set(region_names) == set(expected_regions), "region coverage")
    title_totals = {code: sum(row[7][i] for row in observed) for i, code in enumerate(TITLE_LABELS)}
    title_codes = []
    for title in summary["titles"]:
        keys(title, "code label value", "title schema")
        code = title["code"]
        require(code in TITLE_LABELS and title["label"] == TITLE_LABELS[code], "title label")
        require(euro_cents(title["value"], "title value") == title_totals[code], "title total")
        title_codes.append(code)
    require(bool(title_codes) and len(title_codes) == len(set(title_codes)), "duplicate/empty titles")
    require(all(value == 0 or code in title_codes for code, value in title_totals.items()), "missing title")
    require(sum(euro_cents(title["value"], "title") for title in summary["titles"]) == total, "title reconciliation")
    source = summary["source"]
    keys(source, "siopeOwner siopeMovementsUrl siopeRegistryUrl ipaUrl siopeMovementsLastModified siopeRegistryLastModified ipaLastModified siopeMovementsEtag siopeRegistryEtag ipaEtag siopeMovementsSha256 siopeRegistrySha256 ipaSha256 observedAt publicationDate acquisitionDate checkedAt license", "source schema")
    for key, prefix in (("movements", "siopeMovements"), ("registry", "siopeRegistry"), ("ipa", "ipa")):
        require(source[prefix + "Url"] == source_urls(year)[key], "canonical source URL")
        require(isinstance(source[prefix + "Sha256"], str) and bool(re.fullmatch(r"[a-f0-9]{64}", source[prefix + "Sha256"])), "source SHA-256")
        if source[prefix + "LastModified"] is not None:
            timestamp(source[prefix + "LastModified"], "LastModified", http=True)
        if source[prefix + "Etag"] is not None:
            text(source[prefix + "Etag"], "ETag")
    text(source["siopeOwner"], "owner")
    require(source["publicationDate"] is None and source["license"] == "not-declared", "publication/license not declared")
    require(source["observedAt"] == source["acquisitionDate"] == summary["generatedAt"], "acquisition chronology")
    acquired_at = timestamp(source["acquisitionDate"], "acquisitionDate")
    require(timestamp(source["checkedAt"], "checkedAt") >= acquired_at, "checkedAt chronology")
    require((year, summary["latestMonth"]) <= (acquired_at.year, acquired_at.month), "future movement period")
    keys(summary["methodology"], "measure periodicity territorialJoin populationSource populationReference populationSourceLastModified perCapitaCoverage warning", "methodology schema")
    require(summary["methodology"]["populationSourceLastModified"] == source["siopeRegistryLastModified"], "population provenance")
    for field, value in summary["methodology"].items():
        if field != "populationSourceLastModified":
            text(value, field)
    keys(detail["methodology"], "join absence amounts", "detail methodology")
    for value in detail["methodology"].values():
        text(value, "detail methodology")
    if require_national:
        require(set(region_names) == REGIONS and len(observed) > 7000, "national coverage")
    return {"year": year, "latestMonth": summary["latestMonth"], "totalCollected": summary["totalCollected"], "municipalities": len(rows)}


def check_committed_snapshots(*, years=YEARS) -> list[dict]:
    result = []
    for year in years:
        summary_path, detail_path = paths_for_year(year)
        summary = json.loads(summary_path.read_text(encoding="utf-8"))
        detail = json.loads(detail_path.read_text(encoding="utf-8"))
        require(summary["year"] == year, "year matches artifact path")
        result.append(validate_snapshot(summary, detail, require_national=True))
    return result


def main() -> int:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--include-expenditure", action="store_true", help="Validate the jointly published expenditure summaries too")
    args = parser.parse_args()
    result = check_committed_snapshots()
    if args.include_expenditure:
        try:
            from .siope_snapshot_check import check_committed_snapshot
        except ImportError:
            from siope_snapshot_check import check_committed_snapshot
        for year in YEARS:
            suffix = "" if year == 2026 else f"-{year}"
            result.append(check_committed_snapshot(Path(f"src/data/generated/siope-municipal{suffix}.json")))
    print(json.dumps(result, ensure_ascii=False, indent=2))
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
