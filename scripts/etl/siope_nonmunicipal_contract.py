"""Refreshable SIOPE measurements; all other corpus contributions stay pinned."""
from __future__ import annotations

import json
import re
from pathlib import Path

ROOT = Path(__file__).resolve().parents[2]
PROVENANCE = "src/data/generated/siope-nonmunicipal-provenance.json"
DATASET_IDS = frozenset({"siope-inventario-enti", "siope-uscite-asl", "siope-uscite-province", "siope-uscite-regioni", "siope-uscite-citta-metropolitane"})
# Reviewed main@b7d5bef7 minus the five SIOPE projections (811150 rows).
FIXED_ROWS = {"sourceRows": 13_992_818, "publicRows": 1_010_472, "catalogOnlyRows": 12_979_505, "derivedOnlyRows": 2_841}


def load_manifest(path: Path | None = None) -> dict:
    manifest = json.loads((path or ROOT / PROVENANCE).read_bytes())
    # Import lazily: receipt verification uses the ETL primitives, not this contract.
    from siope_nonmunicipal import validate_native_receipt
    if manifest.get("schemaVersion") != 2 or manifest.get("scope") != "non-municipal-payments":
        raise ValueError("SIOPE refresh requires a native receipt")
    validate_native_receipt(manifest)
    projections = manifest.get("projections")
    if not isinstance(projections, dict) or set(projections) != DATASET_IDS:
        raise ValueError("SIOPE projection set differs from the reviewed scope")
    for value in projections.values():
        if not isinstance(value, dict) or set(value) != {"bytes", "rows", "sha256"}:
            raise ValueError("SIOPE projection metadata schema changed")
        if any(type(value[key]) is not int or not 0 < value[key] <= 9_007_199_254_740_991 for key in ("bytes", "rows")) or not isinstance(value["sha256"], str) or re.fullmatch(r"[a-f0-9]{64}", value["sha256"]) is None:
            raise ValueError("SIOPE projection measurements invalid")
    return manifest


def row_contract(manifest: dict | None = None) -> dict[str, int]:
    manifest = load_manifest() if manifest is None else manifest
    count = sum(item["rows"] for item in manifest["projections"].values())
    totals = {key: value + (count if key in {"sourceRows", "publicRows"} else 0) for key, value in FIXED_ROWS.items()}
    if any(value > 9_007_199_254_740_991 for value in totals.values()):
        raise ValueError("SIOPE row totals exceed safe integer bounds")
    return totals


def apply_manifest(spec: dict, manifest: dict) -> None:
    """Only measurements and observation dates vary; schema and semantics do not."""
    selected = [item for item in spec["datasets"] if item["id"] in DATASET_IDS]
    if {item["id"] for item in selected} != DATASET_IDS:
        raise ValueError("SIOPE corpus specification incomplete")
    for item in selected:
        if item["publication"] != "rows" or item["licenseStatus"] != "not-declared":
            raise ValueError("SIOPE publication policy changed")
        item["expected"].update(manifest["projections"][item["id"]])
        metadata = spec["sourceMetadata"]["overrides"][item["id"]]
        metadata["acquisitionDate"] = manifest["acquiredAt"][:10]
        metadata["checkedAt"] = manifest["acquiredAt"][:10]
