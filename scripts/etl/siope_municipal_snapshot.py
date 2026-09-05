#!/usr/bin/env python3
"""Build the small SIOPE snapshot consumed by DoveVannoINostriSoldi.

The public SIOPE source publishes one national ZIP per year with *pure monthly*
cash movements. Downloading and parsing that file during a web request would be
slow, expensive and fragile, so this script is intended for a scheduled ETL.

It checks Last-Modified first and only downloads the large source files when one
of the upstreams changed. The generated JSON keeps source timestamps and method
metadata so every chart can explain exactly what it represents.

Scope of v1: cash payments made by municipalities (COMUNE). Region is joined by
codice fiscale against the official IPA "Amministrazioni" dataset. Therefore a
regional total means "payments by municipalities whose legal seat is in that
region", not "all public money spent inside that territory".
"""

from __future__ import annotations

import argparse
import json
import re
import tempfile
from datetime import datetime, timezone
from pathlib import Path

SIOPE_BASE = "https://www.siope.it/documenti/siope2/open/last"
SIOPE_REGISTRY_FILE = "SIOPE_ANAGRAFICHE.zip"
IPA_ADMINISTRATIONS_URL = (
    "https://indicepa.gov.it/ipa-dati/dataset/502ff370-1b2c-4310-94c7-f39ceb7500e3/"
    "resource/3ed63523-ff9c-41f6-a6fe-980f3d9e501f/download/amministrazioni.txt"
)
DEFAULT_OUTPUT = Path("src/data/generated/siope-municipal.json")
DEFAULT_DETAIL_OUTPUT = Path("src/data/generated/siope-municipal-detail.json")
USER_AGENT = "DoveVannoINostriSoldi-ETL/1.0 (+https://github.com/Italian-Builders-Org/DoveVannoINostriSoldi)"
CHUNK_SIZE = 1 << 20
MAX_ATTEMPTS = 3
DISTRIBUTION_SCHEMA_VERSION = 2
QUANTILE_PROBABILITIES = {
    "p10": 0.10,
    "p25": 0.25,
    "p50": 0.50,
    "p75": 0.75,
    "p90": 0.90,
}
POPULATION_BANDS = (
    ("under-1000", "Meno di 1.000", None, 1_000),
    ("1000-4999", "1.000–4.999", 1_000, 5_000),
    ("5000-19999", "5.000–19.999", 5_000, 20_000),
    ("20000-49999", "20.000–49.999", 20_000, 50_000),
    ("50000-99999", "50.000–99.999", 50_000, 100_000),
    ("100000-249999", "100.000–249.999", 100_000, 250_000),
    ("250000-499999", "250.000–499.999", 250_000, 500_000),
    ("500000-plus", "500.000 o più", 500_000, None),
)

TITLE_LABELS = {
    "0": "Pagamenti da regolarizzare",
    "1": "Spese correnti",
    "2": "Spese in conto capitale",
    "3": "Spese per incremento di attività finanziarie",
    "4": "Rimborso prestiti",
    "5": "Chiusura anticipazioni da tesoriere/cassiere",
    "7": "Uscite per conto terzi e partite di giro",
}
DETAIL_TITLE_ORDER = tuple(TITLE_LABELS)

MONTH_NAMES = [
    "Gennaio",
    "Febbraio",
    "Marzo",
    "Aprile",
    "Maggio",
    "Giugno",
    "Luglio",
    "Agosto",
    "Settembre",
    "Ottobre",
    "Novembre",
    "Dicembre",
]


try:
    from .siope_municipal_core import (
        utc_now,
        request,
        open_with_retry,
        remote_metadata,
        download,
        zip_rows,
        normalize_header,
        parse_ipa_regions,
        parse_ipa_municipality_identifiers,
        parse_population,
        parse_siope_provinces,
        load_municipalities,
        title_digit,
        euro,
        per_capita,
        aggregate_cash,
        build_regions,
        build_monthly,
        build_detail,
        build_source,
    )
except ImportError:  # Direct CLI execution.
    from siope_municipal_core import (
        utc_now,
        request,
        open_with_retry,
        remote_metadata,
        download,
        zip_rows,
        normalize_header,
        parse_ipa_regions,
        parse_ipa_municipality_identifiers,
        parse_population,
        parse_siope_provinces,
        load_municipalities,
        title_digit,
        euro,
        per_capita,
        aggregate_cash,
        build_regions,
        build_monthly,
        build_detail,
        build_source,
    )


def municipality_rankings(
    items: list[dict],
    limit: int = 100,
) -> tuple[list[dict], list[dict]]:
    """Build independent, deterministic absolute and per-capita rankings."""
    by_value = sorted(
        items,
        key=lambda item: (-item["value"], item["codiceFiscale"]),
    )[:limit]
    by_per_capita = sorted(
        (item for item in items if item["perCapita"] is not None),
        key=lambda item: (
            -item["perCapita"],
            -item["value"],
            item["codiceFiscale"],
        ),
    )[:limit]
    return by_value, by_per_capita


def _nearest_rank(values: list[tuple[float, int]], probability: float) -> float | None:
    """Return a deterministic weighted nearest-rank quantile.

    The input value is expressed in cents per resident and the second tuple
    member is a strictly positive integer weight. Using the first observation
    whose cumulative weight reaches ``p * total_weight`` avoids interpolating
    between two municipalities, which would create a value no municipality
    actually reports. The same rule with weight 1 is used for municipality-
    weighted quantiles, so the two distributions differ only in their weights.
    """
    if not values:
        return None
    ordered = sorted(values, key=lambda item: item[0])
    total_weight = sum(weight for _, weight in ordered)
    if total_weight <= 0:
        return None
    if probability <= 0:
        return ordered[0][0]
    target = probability * total_weight
    cumulative = 0
    for value, weight in ordered:
        cumulative += weight
        if cumulative >= target:
            return value
    return ordered[-1][0]


def _quantiles(points: list[tuple[float, int]]) -> dict[str, float | None]:
    """Summarize cents-per-resident points with explicit quantile semantics."""
    summary: dict[str, float | None] = {}
    for name, probability in QUANTILE_PROBABILITIES.items():
        value = _nearest_rank(points, probability)
        summary[name] = None if value is None else round(value / 100.0, 2)
    return summary


def _distribution_group(rows: list[dict]) -> dict:
    """Build a compact aggregate; never return municipality-level records."""
    for row in rows:
        if int(row["titleCents"]) > int(row["totalCents"]):
            raise RuntimeError("SIOPE distribution: Titolo 1 supera il totale del Comune")
    valid = [row for row in rows if row.get("population") is not None and row["population"] > 0]
    title_cents = sum(int(row["titleCents"]) for row in valid)
    total_cents = sum(int(row["totalCents"]) for row in valid)
    population = sum(int(row["population"]) for row in valid)
    points = [
        (row["titleCents"] / row["population"], 1)
        for row in valid
    ]
    resident_points = [
        (row["titleCents"] / row["population"], row["population"])
        for row in valid
    ]
    return {
        "municipalities": len(valid),
        "population": population,
        "titleAmount": euro(title_cents),
        "totalAmount": euro(total_cents),
        "share": round(title_cents / total_cents, 8) if total_cents else None,
        "perCapita": {
            "municipalityWeighted": _quantiles(points),
            "residentWeighted": _quantiles(resident_points),
        },
    }


def build_distribution(
    *,
    rows: list[dict],
    year: int,
    latest_month: int,
    observed_at: str,
    validators: dict[str, dict[str, str | None]],
) -> dict:
    """Create the full-population analysis without publishing raw municipality rows.

    ``rows`` is an ETL-only list assembled from every municipality with a
    movement. The generated result contains only national, regional and fixed
    population-band aggregates, so the web bundle never needs the full source
    movement table or a hidden top-100 proxy for the distribution.
    """
    for source_key in ("movements", "registry", "ipa"):
        source_hash = validators.get(source_key, {}).get("sha256")
        if not isinstance(source_hash, str) or not re.fullmatch(r"[0-9a-f]{64}", source_hash):
            raise RuntimeError(
                f"SIOPE distribution: SHA-256 {source_key} mancante o non valido"
            )
    for row in rows:
        if int(row["titleCents"]) > int(row["totalCents"]):
            raise RuntimeError("SIOPE distribution: Titolo 1 supera il totale del Comune")
    valid_rows = [
        row
        for row in rows
        if row.get("population") is not None and row["population"] > 0
    ]
    regionalized_rows = [row for row in rows if row.get("region")]
    regionalized_valid_rows = [row for row in valid_rows if row.get("region")]
    unregionalized_rows = [row for row in rows if not row.get("region")]
    unregionalized_valid_rows = [row for row in valid_rows if not row.get("region")]
    all_title_cents = sum(int(row["titleCents"]) for row in rows)
    all_total_cents = sum(int(row["totalCents"]) for row in rows)
    covered_title_cents = sum(int(row["titleCents"]) for row in valid_rows)
    covered_total_cents = sum(int(row["totalCents"]) for row in valid_rows)
    if all_title_cents > all_total_cents or covered_title_cents > covered_total_cents:
        raise RuntimeError("SIOPE distribution: Titolo 1 supera un totale aggregato")
    excluded_rows = [
        row
        for row in rows
        if row.get("population") is None or row["population"] <= 0
    ]
    observed_year = datetime.fromisoformat(observed_at.replace("Z", "+00:00")).year

    bands: list[dict] = []
    for band_id, label, lower, upper in POPULATION_BANDS:
        band_rows = [
            row
            for row in valid_rows
            if (lower is None or row["population"] >= lower)
            and (upper is None or row["population"] < upper)
        ]
        bands.append({"id": band_id, "label": label, **_distribution_group(band_rows)})

    regions: list[dict] = []
    for region in sorted(
        {row["region"] for row in regionalized_valid_rows},
        key=lambda value: value.casefold(),
    ):
        region_rows = [row for row in regionalized_valid_rows if row["region"] == region]
        regions.append({"region": region, **_distribution_group(region_rows)})

    return {
        "schemaVersion": DISTRIBUTION_SCHEMA_VERSION,
        "measure": {
            "titleCode": "1",
            "titleLabel": "Spese correnti",
            "metric": "pagamenti del Titolo 1 per abitante del Comune",
            "shareDenominator": (
                "tutti i pagamenti SIOPE degli enti riconosciuti come Comuni "
                "dall'anagrafica SIOPE nel periodo"
            ),
            "quantileMethod": (
                "nearest-rank pesato: prima osservazione la cui cumulata raggiunge p·peso totale"
            ),
        },
        "period": {
            "year": year,
            "startMonth": 1,
            "endMonth": latest_month,
            "completeness": "partial" if observed_year == year else "complete",
        },
        "coverage": {
            "municipalitiesWithMovements": len(rows),
            "municipalitiesWithValidPopulation": len(valid_rows),
            "populationCovered": sum(int(row["population"]) for row in valid_rows),
            "municipalitiesWithoutPopulation": len(excluded_rows),
            "municipalitiesWithRegion": len(regionalized_rows),
            "municipalitiesWithoutRegion": len(unregionalized_rows),
            "municipalitiesWithValidPopulationAndRegion": len(regionalized_valid_rows),
            "paymentsWithoutPopulation": euro(
                all_total_cents - covered_total_cents
            ),
            "titlePaymentsWithoutPopulation": euro(
                all_title_cents - covered_title_cents
            ),
            "populationRegionalized": sum(
                int(row["population"]) for row in regionalized_valid_rows
            ),
            "paymentsWithoutRegion": euro(
                sum(int(row["totalCents"]) for row in unregionalized_rows)
            ),
            "titlePaymentsWithoutRegion": euro(
                sum(int(row["titleCents"]) for row in unregionalized_rows)
            ),
            "paymentsWithPopulationWithoutRegion": euro(
                sum(int(row["totalCents"]) for row in unregionalized_valid_rows)
            ),
            "titlePaymentsWithPopulationWithoutRegion": euro(
                sum(int(row["titleCents"]) for row in unregionalized_valid_rows)
            ),
        },
        "nationalShareAll": (
            round(all_title_cents / all_total_cents, 8) if all_total_cents else None
        ),
        "nationalShareCovered": (
            round(covered_title_cents / covered_total_cents, 8)
            if covered_total_cents
            else None
        ),
        "perCapita": _distribution_group(valid_rows)["perCapita"],
        "populationBands": bands,
        "regions": regions,
        "provenance": {
            "siopeMovementsUrl": f"{SIOPE_BASE}/SIOPE_USCITE.{year}.zip",
            "siopeRegistryUrl": f"{SIOPE_BASE}/{SIOPE_REGISTRY_FILE}",
            "ipaUrl": IPA_ADMINISTRATIONS_URL,
            "siopeMovementsLastModified": validators["movements"].get("lastModified"),
            "siopeRegistryLastModified": validators["registry"].get("lastModified"),
            "ipaLastModified": validators["ipa"].get("lastModified"),
            "siopeMovementsEtag": validators["movements"].get("etag"),
            "siopeRegistryEtag": validators["registry"].get("etag"),
            "ipaEtag": validators["ipa"].get("etag"),
            "siopeMovementsSha256": validators["movements"].get("sha256"),
            "siopeRegistrySha256": validators["registry"].get("sha256"),
            "ipaSha256": validators["ipa"].get("sha256"),
            "observedAt": observed_at,
        },
    }


def build_snapshot(
    *,
    year: int,
    movements_zip: Path,
    registry_zip: Path,
    ipa_path: Path,
    validators: dict[str, dict[str, str | None]],
) -> dict:
    cash = aggregate_cash(
        year=year, flow="uscite", titles=TITLE_LABELS,
        movements_zip=movements_zip, registry_zip=registry_zip, ipa_path=ipa_path,
    )
    municipalities = cash.municipalities
    active_siope_count = len(municipalities)
    municipality_cents = cash.municipality_cents
    municipality_title_cents = cash.municipality_title_cents
    title_cents = cash.title_cents
    national_monthly = cash.national_monthly
    observed_keys = cash.observed_keys
    latest_month = cash.latest_month
    rows_total = cash.rows_total
    rows_included = cash.rows_included
    malformed = 0
    regions = build_regions(cash)

    analysis_rows: list[dict] = []
    municipalities_with_movements: list[dict] = []
    for key, cents in municipality_cents.items():
        municipality = municipalities[key]
        population = municipality["population"]
        analysis_rows.append(
            {
                "region": municipality["region"],
                "population": population,
                "totalCents": cents,
                "titleCents": municipality_title_cents[key].get("1", 0),
            }
        )
        if municipality["region"]:
            municipalities_with_movements.append(
                {
                    "name": municipality["name"],
                    "region": municipality["region"],
                    "province": municipality["province"],
                    "codiceFiscale": municipality["cf"],
                    "population": population,
                    "value": euro(cents),
                    "perCapita": per_capita(cents, population),
                }
            )
    top_municipalities_by_value, top_municipalities_by_per_capita = (
        municipality_rankings(municipalities_with_movements)
    )

    titles = [
        {
            "code": digit,
            "label": TITLE_LABELS.get(digit, f"Titolo {digit}"),
            "value": euro(cents),
        }
        for digit, cents in sorted(
            title_cents.items(),
            key=lambda item: item[1],
            reverse=True,
        )
    ]

    monthly = build_monthly(cash)

    observed_population = sum(
        municipalities[key]["population"] or 0 for key in observed_keys
    )
    payments_with_population_cents = sum(
        municipality_cents[key]
        for key in observed_keys
        if municipalities[key]["population"] is not None
    )
    municipalities_with_population = sum(
        municipalities[key]["population"] is not None for key in observed_keys
    )
    observed_with_region = {
        key for key in observed_keys if municipalities[key]["region"]
    }
    payments_without_region_cents = sum(
        municipality_cents[key] for key in observed_keys - observed_with_region
    )
    matched_to_ipa_region = sum(
        municipality["region"] is not None for municipality in municipalities.values()
    )
    latest_total_cents = sum(national_monthly)
    observed_at = utc_now()
    distribution = build_distribution(
        rows=analysis_rows,
        year=year,
        latest_month=latest_month,
        observed_at=observed_at,
        validators=validators,
    )

    detail = build_detail(
        cash, year=year, observed_at=observed_at, titles=TITLE_LABELS,
        scope="municipality-detail",
    )

    return {
        "_municipalityDetail": detail,
        "schemaVersion": 3,
        "generatedAt": observed_at,
        "scope": "municipalities",
        "year": year,
        "latestMonth": latest_month,
        "latestMonthLabel": MONTH_NAMES[latest_month - 1],
        "totalPaid": euro(latest_total_cents),
        "paymentsWithPopulation": euro(payments_with_population_cents),
        "populationCovered": observed_population,
        "nationalPerCapita": per_capita(
            payments_with_population_cents,
            observed_population,
        ),
        "coverage": {
            "activeSiopeMunicipalities": active_siope_count,
            "matchedToIpaRegion": matched_to_ipa_region,
            "withMovements": len(observed_keys),
            "withRegion": len(observed_with_region),
            "withoutRegion": len(observed_keys - observed_with_region),
            "paymentsWithoutRegion": euro(payments_without_region_cents),
            "unmatchedToIpaRegion": max(
                active_siope_count - matched_to_ipa_region,
                0,
            ),
            "movementRows": rows_total,
            "includedMovementRows": rows_included,
            "malformedRows": malformed,
            "withPopulation": municipalities_with_population,
            "withoutPopulation": len(observed_keys) - municipalities_with_population,
        },
        "monthly": monthly,
        "regions": regions,
        "titles": titles,
        # Kept as a backwards-compatible alias for existing API/MCP clients.
        "topMunicipalities": top_municipalities_by_value,
        "topMunicipalitiesByValue": top_municipalities_by_value,
        "topMunicipalitiesByPerCapita": top_municipalities_by_per_capita,
        "distribution": distribution,
        "source": build_source(
            year=year, flow="uscite", validators=validators, observed_at=observed_at,
        ),
        "methodology": {
            "measure": "pagamenti di cassa SIOPE dei Comuni",
            "periodicity": "movimenti mensili puri, sommati da gennaio all'ultimo mese disponibile",
            "territorialJoin": (
                "codice fiscale SIOPE → Regione della sede legale in IPA; "
                "Provincia pubblicata nell'anagrafica enti SIOPE"
            ),
            "populationSource": "popolazione riportata nell'anagrafica enti SIOPE",
            "populationReference": "data di riferimento non dichiarata dalla fonte",
            "populationSourceLastModified": validators["registry"].get("lastModified"),
            "perCapitaCoverage": (
                "numeratore e denominatore includono soltanto i Comuni con popolazione valida"
            ),
            "warning": (
                "Il totale regionale rappresenta i pagamenti dei Comuni con sede nella regione; "
                "non misura tutta la spesa pubblica effettuata fisicamente nel territorio. "
                "Il valore pro capite usa la popolazione dell'anagrafica SIOPE: turismo, "
                "pendolarismo, ricostruzioni e servizi sovracomunali possono alterare il confronto."
            ),
        },
    }


def source_validators(year: int) -> dict[str, dict[str, str | None]]:
    return {
        "movements": remote_metadata(f"{SIOPE_BASE}/SIOPE_USCITE.{year}.zip"),
        "registry": remote_metadata(f"{SIOPE_BASE}/{SIOPE_REGISTRY_FILE}"),
        "ipa": remote_metadata(IPA_ADMINISTRATIONS_URL),
    }


def is_unchanged(
    output: Path,
    year: int,
    validators: dict,
    detail_output: Path | None = None,
) -> bool:
    if not output.exists():
        return False
    if detail_output is not None and not detail_output.exists():
        return False
    try:
        current = json.loads(output.read_text(encoding="utf-8"))
    except (OSError, json.JSONDecodeError):
        return False
    source = current.get("source", {})
    source_keys = (
        ("movements", "siopeMovements"),
        ("registry", "siopeRegistry"),
        ("ipa", "ipa"),
    )
    validators_match = all(
        validators[key].get("lastModified") is not None
        and source.get(f"{prefix}LastModified") == validators[key].get("lastModified")
        and (
            validators[key].get("etag") is None
            or source.get(f"{prefix}Etag") == validators[key].get("etag")
        )
        for key, prefix in source_keys
    )
    return (
        current.get("schemaVersion") == 3
        and current.get("year") == year
        and validators_match
        and isinstance(current.get("distribution"), dict)
        and current["distribution"].get("schemaVersion") == DISTRIBUTION_SCHEMA_VERSION
        and all(
            re.fullmatch(r"[0-9a-f]{64}", str(source.get(field, "")))
            for field in (
                "siopeMovementsSha256",
                "siopeRegistrySha256",
                "ipaSha256",
            )
        )
    )


def parse_args() -> argparse.Namespace:
    parser = argparse.ArgumentParser()
    parser.add_argument("--year", type=int, default=datetime.now(timezone.utc).year)
    parser.add_argument("--output", type=Path, default=DEFAULT_OUTPUT)
    parser.add_argument("--detail-output", type=Path, default=DEFAULT_DETAIL_OUTPUT)
    parser.add_argument("--force", action="store_true")
    parser.add_argument(
        "--check",
        action="store_true",
        help="Validate the committed snapshot offline without network access",
    )
    return parser.parse_args()


def main() -> int:
    args = parse_args()

    if args.check:
        from siope_snapshot_check import check_committed_snapshot

        summary = check_committed_snapshot(args.output)
        print(json.dumps(summary, ensure_ascii=False, indent=2))
        return 0

    if args.year < 2016 or args.year > datetime.now(timezone.utc).year + 1:
        raise SystemExit(f"Anno non valido: {args.year}")

    validators = source_validators(args.year)
    print("source validators:", json.dumps(validators, ensure_ascii=False))
    if not args.force and is_unchanged(
        args.output,
        args.year,
        validators,
        args.detail_output,
    ):
        print("SIOPE snapshot unchanged; no large download required")
        return 0

    args.output.parent.mkdir(parents=True, exist_ok=True)
    args.detail_output.parent.mkdir(parents=True, exist_ok=True)
    with tempfile.TemporaryDirectory(prefix=".siope-", dir=".") as temp_dir:
        temp = Path(temp_dir)
        movements = temp / f"SIOPE_USCITE.{args.year}.zip"
        registry = temp / SIOPE_REGISTRY_FILE
        ipa = temp / "amministrazioni.txt"

        movement_response = download(
            f"{SIOPE_BASE}/SIOPE_USCITE.{args.year}.zip",
            movements,
        )
        registry_response = download(f"{SIOPE_BASE}/{SIOPE_REGISTRY_FILE}", registry)
        ipa_response = download(IPA_ADMINISTRATIONS_URL, ipa, timeout=180)

        for key, response_meta in (
            ("movements", movement_response),
            ("registry", registry_response),
            ("ipa", ipa_response),
        ):
            validators[key]["lastModified"] = (
                response_meta.get("lastModified")
                or validators[key].get("lastModified")
            )
            validators[key]["etag"] = response_meta.get("etag") or validators[key].get("etag")
            validators[key]["sha256"] = response_meta.get("sha256")

        snapshot = build_snapshot(
            year=args.year,
            movements_zip=movements,
            registry_zip=registry,
            ipa_path=ipa,
            validators=validators,
        )
        detail = snapshot.pop("_municipalityDetail")

    args.output.write_text(
        json.dumps(snapshot, ensure_ascii=False, indent=2) + "\n",
        encoding="utf-8",
    )
    args.detail_output.write_text(
        json.dumps(detail, ensure_ascii=False, separators=(",", ":")) + "\n",
        encoding="utf-8",
    )
    print(
        "snapshot written:",
        args.output,
        f"regions={len(snapshot['regions'])}",
        f"municipalities={snapshot['coverage']['withMovements']}",
        f"latest={snapshot['latestMonthLabel']}",
        f"total={snapshot['totalPaid']:.2f}",
    )
    print(
        "municipality detail written:",
        args.detail_output,
        f"municipalities={len(detail['municipalities'])}",
        f"withMovements={detail['coverage']['withMovements']}",
    )
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
