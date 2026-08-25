#!/usr/bin/env python3
"""Offline contract validator for committed SIOPE municipal snapshots.

This module is the **single source of truth** for the SIOPE snapshot contract.
It is executed:

- locally via ``python scripts/etl/siope_municipal_snapshot.py --check``
- in the central ``CI / etl`` gate via ``npm run test:snapshots``
- in the scheduled ``siope-refresh.yml`` workflow after a rebuild

The contract was previously inlined as a large Python program inside
``.github/workflows/siope-refresh.yml``.  Moving it here prevents the inline
YAML contract, the Node runtime contract, and the ETL test contract from
drifting apart.
"""

from __future__ import annotations

import json
import re
import sys
from pathlib import Path

DEFAULT_SNAPSHOT_PATH = Path("src/data/generated/siope-municipal.json")


def _check_quantiles(quantiles: dict) -> None:
    values = [quantiles[key] for key in ("p10", "p25", "p50", "p75", "p90")]
    assert all(value is None or isinstance(value, (int, float)) for value in values)
    present = [value for value in values if value is not None]
    assert present == sorted(present)


def validate_snapshot(data: dict) -> dict:
    """Validate a parsed SIOPE municipal snapshot against the full contract.

    Returns a compact summary dict on success.
    Raises ``AssertionError`` on any contract violation.
    """
    assert data["schemaVersion"] == 3
    assert data["scope"] == "municipalities"
    assert 1 <= data["latestMonth"] <= 12
    assert data["totalPaid"] >= 0
    assert 0 <= data["paymentsWithPopulation"] <= data["totalPaid"]
    assert data["populationCovered"] > 0
    assert abs(
        data["nationalPerCapita"]
        - data["paymentsWithPopulation"] / data["populationCovered"]
    ) < 0.01
    assert len(data["regions"]) >= 18
    assert data["coverage"]["withMovements"] > 7000
    assert data["coverage"]["includedMovementRows"] > 0
    assert (
        data["coverage"]["withPopulation"]
        + data["coverage"]["withoutPopulation"]
        == data["coverage"]["withMovements"]
    )
    assert (
        data["coverage"]["withRegion"]
        + data["coverage"]["withoutRegion"]
        == data["coverage"]["withMovements"]
    )
    assert (
        data["coverage"]["matchedToIpaRegion"]
        + data["coverage"]["unmatchedToIpaRegion"]
        == data["coverage"]["activeSiopeMunicipalities"]
    )
    assert data["coverage"]["withRegion"] <= data["coverage"]["matchedToIpaRegion"]
    assert data["coverage"]["withoutRegion"] <= data["coverage"]["unmatchedToIpaRegion"]
    assert abs(
        sum(item["value"] for item in data["regions"])
        + data["coverage"]["paymentsWithoutRegion"]
        - data["totalPaid"]
    ) < 0.05
    assert len(data["topMunicipalitiesByValue"]) == 100
    assert len(data["topMunicipalitiesByPerCapita"]) == 100
    assert data["topMunicipalities"] == data["topMunicipalitiesByValue"]
    assert all(
        item["province"].strip() and item["region"].strip()
        for ranking in (
            data["topMunicipalitiesByValue"],
            data["topMunicipalitiesByPerCapita"],
        )
        for item in ranking
    )
    assert all(
        left["value"] >= right["value"]
        for left, right in zip(
            data["topMunicipalitiesByValue"],
            data["topMunicipalitiesByValue"][1:],
        )
    )
    assert all(
        left["perCapita"] >= right["perCapita"]
        for left, right in zip(
            data["topMunicipalitiesByPerCapita"],
            data["topMunicipalitiesByPerCapita"][1:],
        )
    )
    assert data["source"]["siopeMovementsLastModified"]
    assert data["source"]["siopeRegistryLastModified"]
    for field in ("siopeMovementsEtag", "siopeRegistryEtag", "ipaEtag"):
        assert isinstance(data["source"][field], str) and data["source"][field]
    for field in ("siopeMovementsSha256", "siopeRegistrySha256", "ipaSha256"):
        assert re.fullmatch(r"[0-9a-f]{64}", data["source"][field]), field
    assert (
        data["methodology"]["populationSourceLastModified"]
        == data["source"]["siopeRegistryLastModified"]
    )

    distribution = data.get("distribution")
    assert isinstance(distribution, dict), "Full-population distribution is missing"
    assert distribution["schemaVersion"] == 2
    assert distribution["measure"]["titleCode"] == "1"
    assert distribution["measure"]["shareDenominator"] == (
        "tutti i pagamenti SIOPE degli enti riconosciuti come Comuni "
        "dall'anagrafica SIOPE nel periodo"
    )
    assert distribution["period"]["year"] == data["year"]
    assert distribution["period"]["startMonth"] == 1
    assert distribution["period"]["endMonth"] == data["latestMonth"]
    assert distribution["period"]["completeness"] in ("complete", "partial")

    coverage = distribution["coverage"]
    assert coverage["municipalitiesWithMovements"] == data["coverage"]["withMovements"]
    assert coverage["municipalitiesWithValidPopulation"] == data["coverage"]["withPopulation"]
    assert coverage["municipalitiesWithoutPopulation"] == data["coverage"]["withoutPopulation"]
    assert coverage["populationCovered"] == data["populationCovered"]
    assert coverage["municipalitiesWithRegion"] == data["coverage"]["withRegion"]
    assert coverage["municipalitiesWithoutRegion"] == data["coverage"]["withoutRegion"]
    assert coverage["paymentsWithoutRegion"] == data["coverage"]["paymentsWithoutRegion"]
    assert (
        coverage["municipalitiesWithValidPopulation"]
        - coverage["municipalitiesWithValidPopulationAndRegion"]
        <= coverage["municipalitiesWithoutRegion"]
    )
    assert coverage["titlePaymentsWithoutRegion"] <= coverage["paymentsWithoutRegion"]
    assert (
        coverage["paymentsWithPopulationWithoutRegion"]
        <= coverage["paymentsWithoutRegion"]
    )
    assert (
        coverage["titlePaymentsWithPopulationWithoutRegion"]
        <= coverage["titlePaymentsWithoutRegion"]
    )
    assert (
        coverage["titlePaymentsWithPopulationWithoutRegion"]
        <= coverage["paymentsWithPopulationWithoutRegion"]
    )
    assert abs(
        coverage["paymentsWithoutPopulation"]
        + data["paymentsWithPopulation"]
        - data["totalPaid"]
    ) < 0.05
    assert 0 <= distribution["nationalShareAll"] <= 1
    assert 0 <= distribution["nationalShareCovered"] <= 1

    for group in [
        distribution["perCapita"],
        *(item["perCapita"] for item in distribution["populationBands"]),
        *(item["perCapita"] for item in distribution["regions"]),
    ]:
        _check_quantiles(group["municipalityWeighted"])
        _check_quantiles(group["residentWeighted"])
    assert sum(item["municipalities"] for item in distribution["populationBands"]) == coverage["municipalitiesWithValidPopulation"]
    assert sum(item["municipalities"] for item in distribution["regions"]) == coverage["municipalitiesWithValidPopulationAndRegion"]
    assert sum(item["population"] for item in distribution["populationBands"]) == coverage["populationCovered"]
    assert sum(item["population"] for item in distribution["regions"]) == coverage["populationRegionalized"]
    assert all("municipalities" not in item or item["municipalities"] >= 0 for item in distribution["regions"])

    return {
        "year": data["year"],
        "latestMonth": data["latestMonthLabel"],
        "totalPaid": data["totalPaid"],
        "regions": len(data["regions"]),
        "municipalities": data["coverage"]["withMovements"],
        "municipalitiesWithPopulation": data["coverage"]["withPopulation"],
        "matched": data["coverage"]["matchedToIpaRegion"],
        "unmatched": data["coverage"]["unmatchedToIpaRegion"],
        "movementRows": data["coverage"]["movementRows"],
    }


def check_committed_snapshot(path: Path = DEFAULT_SNAPSHOT_PATH) -> dict:
    """Load and validate the committed SIOPE snapshot at *path*.

    Raises ``SystemExit`` if the file is missing or fails validation.
    """
    if not path.exists():
        raise SystemExit(f"Generated SIOPE snapshot is missing: {path}")
    data = json.loads(path.read_text(encoding="utf-8"))
    return validate_snapshot(data)


def main() -> int:
    """CLI entry point for standalone offline validation."""
    import argparse

    parser = argparse.ArgumentParser(
        description="Validate a committed SIOPE municipal snapshot offline"
    )
    parser.add_argument(
        "--snapshot",
        type=Path,
        default=DEFAULT_SNAPSHOT_PATH,
        help="Path to the committed snapshot JSON (default: %(default)s)",
    )
    args = parser.parse_args()

    summary = check_committed_snapshot(args.snapshot)
    print(json.dumps(summary, ensure_ascii=False, indent=2))
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
