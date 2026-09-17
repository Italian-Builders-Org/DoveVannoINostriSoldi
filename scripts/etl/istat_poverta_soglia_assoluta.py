#!/usr/bin/env python3
"""Build/check the locked ISTAT absolute poverty monetary thresholds (34_211), offline."""

from __future__ import annotations

import argparse
from collections import Counter
import csv
from decimal import Decimal, InvalidOperation
import io
import json
from pathlib import Path

from istat_bes_snapshot import canonical_bytes, sha256_bytes

ROOT = Path(__file__).resolve().parents[2]
SPEC = ROOT / "scripts/etl/specs/istat-poverta-soglia-assoluta-2005-2024.source.json"
DATA = ROOT / "src/data/generated/istat-poverta-soglia-assoluta-2005-2024.data.json"
META = ROOT / "src/data/generated/istat-poverta-soglia-assoluta-2005-2024.meta.json"
DATASET = "istat-poverta-soglia-assoluta"


class SnapshotError(ValueError):
    """Source bytes or public threshold contract differ from the reviewed lock."""


def require(condition: bool, message: str) -> None:
    if not condition:
        raise SnapshotError(message)


def lock_hash(spec: dict) -> str:
    normalized = {**spec, "integrity": {**spec["integrity"], "sourceLockSha256": ""}}
    return sha256_bytes(canonical_bytes(normalized))


def load_spec(path: Path = SPEC) -> dict:
    spec = json.loads(path.read_bytes())
    require(spec["datasetId"] == DATASET, "dataset identity differs")
    require(
        spec["domain"]
        == {"code": "34_211", "label": "Soglia di povertà assoluta", "dataflowId": "34_211"},
        "domain differs",
    )
    require(spec["source"]["licenseId"] == "not-declared", "payload license must not be inferred")
    require(spec["semantics"]["soldi"]["present"] is True, "monetary threshold must declare soldi")
    require(spec["integrity"]["sourceLockSha256"] == lock_hash(spec), "source lock hash differs")
    for asset in spec["source"]["assets"].values():
        require(asset["url"].startswith("https://esploradati.istat.it/"), "unofficial source URL")
    return spec


def value_hundredths(raw: str) -> int:
    try:
        value = Decimal(raw)
        require(value.is_finite() and value >= 0, "invalid threshold value")
        scaled = value * 100
        require(scaled == scaled.to_integral_value(), "value has more than two decimals")
        return int(scaled)
    except (InvalidOperation, ValueError) as error:
        raise SnapshotError(f"invalid threshold value: {raw!r}") from error


def build_data(payload: bytes, spec: dict) -> dict:
    reader = csv.DictReader(io.StringIO(payload.decode("utf-8")))
    require(reader.fieldnames == spec["headers"], "unexpected SDMX columns/order")
    territories = {item["code"]: item for item in spec["territories"]}
    households = {item["code"]: item for item in spec["householdTypologies"]}
    municipalities = {item["code"]: item for item in spec["municipalitySizes"]}
    indicators = {item["code"]: item for item in spec["indicators"]}
    observations = []
    for row in reader:
        require(None not in row and all(value is not None for value in row.values()), "malformed CSV row")
        for key, value in spec["fixedDimensions"].items():
            require(row[key] == value, f"unexpected {key}")
        for key, values in spec["attributes"].items():
            require(row[key] in values, f"unexpected {key}")
        code = row["DATA_TYPE"]
        require(code in indicators, "indicator outside threshold dataset")
        require(row["UNIT_MEAS"] == indicators[code]["unit"], "indicator unit differs")
        territory = row["REF_AREA"]
        household = row["HOUSEHOLD_TYPOLOGY"]
        municipality = row["MUNICIPALITY_SIZE"]
        require(territory in territories, "unknown territory")
        require(household in households, "unknown household typology")
        require(municipality in municipalities, "unknown municipality size")
        raw, flag = row["OBS_VALUE"], row["OBS_STATUS"]
        # Empty OBS_VALUE with empty OBS_STATUS stays null (not zero); no other flag/value pairs.
        require((raw == "" and flag == "") or (raw != "" and flag == ""), "flag/value mismatch")
        require(row["TIME_PERIOD"].isdigit() and len(row["TIME_PERIOD"]) == 4, "invalid year")
        observations.append({
            "territory": territory,
            "householdTypology": household,
            "municipalitySize": municipality,
            "year": int(row["TIME_PERIOD"]),
            "valueHundredths": None if raw == "" else value_hundredths(raw),
            "status": None,
        })
    observations.sort(
        key=lambda item: (
            item["territory"],
            int(item["householdTypology"]),
            item["municipalitySize"],
            item["year"],
        )
    )
    data = {key: spec[key] for key in (
        "schemaVersion", "datasetId", "domain", "period", "periodNote", "indicators",
        "territories", "householdTypologies", "municipalitySizes", "flags", "caveats",
        "reconciliation",
    )}
    data.update(
        scale={
            "factor": 100,
            "note": "Soglie mensili esatte in centesimi di euro (valueHundredths).",
        },
        observations=observations,
    )
    validate_data(data, spec)
    return data


def validate_data(data: dict, spec: dict) -> None:
    for key in (
        "schemaVersion", "datasetId", "domain", "period", "periodNote", "indicators",
        "territories", "householdTypologies", "municipalitySizes", "flags", "caveats",
        "reconciliation",
    ):
        require(data[key] == spec[key], f"public {key} differs from source lock")
    require(data["scale"]["factor"] == 100, "scale differs")
    territories = {item["code"]: item for item in data["territories"]}
    households = {item["code"] for item in data["householdTypologies"]}
    municipalities = {item["code"] for item in data["municipalitySizes"]}
    indicators = {item["code"]: item for item in data["indicators"]}
    require(len(territories) == 23 and len(households) == 83 and len(municipalities) == 6, "dictionary size differs")
    require(len(indicators) == 1 and "SOGLIA_POVASS" in indicators, "indicator dictionary differs")
    for territory in territories.values():
        require(territory["parent"] is None, "unexpected in-dataset parent")
        require(territory.get("parentOutsideDataset"), "missing parentOutsideDataset")
        if territory["code"] in {"ITCD", "ITFG"}:
            require(territory["kind"] == "composite" and "parts" in territory, "composite metadata differs")
        elif territory["code"] == "ITE":
            require(territory["kind"] == "macro", "Centro must stay a macro ripartizione")
        else:
            require(territory["kind"] == "regione", "region kind differs")
    seen, nulls, coverage = set(), [], Counter()
    for row in data["observations"]:
        territory, household, municipality, year = (
            row["territory"], row["householdTypology"], row["municipalitySize"], row["year"]
        )
        key = (territory, household, municipality, year)
        require(key not in seen, "duplicate observation")
        seen.add(key)
        require(
            territory in territories and household in households and municipality in municipalities,
            "unknown dimension",
        )
        indicator = indicators["SOGLIA_POVASS"]
        require(type(year) is int and indicator["period"]["from"] <= year <= indicator["period"]["to"], "period differs")
        value = row["valueHundredths"]
        require(row["status"] is None, "unexpected observation status")
        if value is None:
            nulls.append([territory, household, municipality, year])
        else:
            require(type(value) is int and value >= 0, "invalid value")
        coverage[str(year)] += 1
    require(len(seen) == spec["observations"], "observation coverage differs")
    require(nulls == spec["nullCells"], "null cell identity differs")
    require({row["territory"] for row in data["observations"]} == set(territories), "territory coverage differs")
    require(
        {row["householdTypology"] for row in data["observations"]} == households,
        "household coverage differs",
    )
    require(
        {row["municipalitySize"] for row in data["observations"]} == municipalities,
        "municipality coverage differs",
    )
    require(dict(coverage) == indicators["SOGLIA_POVASS"]["coverage"], "coverage per year differs")
    require(len(seen) == indicators["SOGLIA_POVASS"]["observations"], "indicator coverage differs")


def metadata(spec: dict, data_bytes: bytes) -> dict:
    return {
        "schemaVersion": 1,
        "datasetId": DATASET,
        "period": spec["period"],
        "acquiredAt": spec["source"]["acquisitionDate"],
        "source": spec["source"],
        "semantics": spec["semantics"],
        "integrity": {
            "sourceLockSha256": lock_hash(spec),
            "dataArtifact": {
                "path": str(DATA.relative_to(ROOT)),
                "bytes": len(data_bytes),
                "sha256": sha256_bytes(data_bytes),
            },
        },
    }


def check(spec_path: Path = SPEC, data_path: Path = DATA, meta_path: Path = META) -> None:
    spec = load_spec(spec_path)
    raw = data_path.read_bytes()
    data = json.loads(raw)
    validate_data(data, spec)
    require(raw == canonical_bytes(data), "noncanonical data bytes")
    expected = metadata(spec, raw)
    require(json.loads(meta_path.read_bytes()) == expected, "metadata differs from source lock/data")
    require(spec["integrity"]["dataArtifact"] == expected["integrity"]["dataArtifact"], "artifact hash/bytes differ")


def main() -> None:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--check", action="store_true")
    parser.add_argument("--input", type=Path)
    parser.add_argument("--structure", type=Path)
    parser.add_argument("--write", action="store_true")
    args = parser.parse_args()
    if args.check:
        check()
        print(f"{DATASET}: source lock, data, metadata and coverage verified offline")
        return
    require(args.input is not None and args.structure is not None, "both locked CSV and structure are required")
    spec = load_spec()
    for name, path in (("csv", args.input), ("structure", args.structure)):
        raw = path.read_bytes()
        asset = spec["source"]["assets"][name]
        require(len(raw) == asset["bytes"] and sha256_bytes(raw) == asset["sha256"], f"{name} bytes/hash differ")
    data = build_data(args.input.read_bytes(), spec)
    raw = canonical_bytes(data)
    if args.write:
        spec["integrity"]["dataArtifact"] = metadata(spec, raw)["integrity"]["dataArtifact"]
        spec["integrity"]["sourceLockSha256"] = lock_hash(spec)
        raw = canonical_bytes(data)
        DATA.write_bytes(raw)
        META.write_bytes(canonical_bytes(metadata(spec, raw)))
        SPEC.write_text(json.dumps(spec, ensure_ascii=False, indent=2) + "\n")
        check()
    print(f"{DATASET}: {len(data['observations'])} observations, {len(raw)} bytes")


if __name__ == "__main__":
    main()
