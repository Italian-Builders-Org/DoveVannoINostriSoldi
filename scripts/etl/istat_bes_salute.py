#!/usr/bin/env python3
"""Build/check the separately locked BesT BES_01 health domain, without network I/O."""

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
SPEC = ROOT / "scripts/etl/specs/istat-bes-salute-2004-2024.source.json"
DATA = ROOT / "src/data/generated/istat-bes-salute-2004-2024.data.json"
META = ROOT / "src/data/generated/istat-bes-salute-2004-2024.meta.json"
DATASET = "istat-bes-salute"


class SnapshotError(ValueError):
    """Source bytes or public health contract differ from the reviewed lock."""


def require(condition: bool, message: str) -> None:
    if not condition:
        raise SnapshotError(message)


def lock_hash(spec: dict) -> str:
    normalized = {**spec, "integrity": {**spec["integrity"], "sourceLockSha256": ""}}
    return sha256_bytes(canonical_bytes(normalized))


def load_spec(path: Path = SPEC) -> dict:
    spec = json.loads(path.read_bytes())
    require(spec["datasetId"] == DATASET, "dataset identity differs")
    require(spec["domain"] == {"code": "BES_01", "label": "Salute", "edition": "2025"}, "domain differs")
    require(spec["source"]["licenseId"] == "not-declared", "license must not be inferred")
    require(spec["integrity"]["sourceLockSha256"] == lock_hash(spec), "source lock hash differs")
    for asset in spec["source"]["assets"].values():
        require(asset["url"].startswith("https://esploradati.istat.it/"), "unofficial source URL")
    return spec


def value_tenths(raw: str) -> int:
    try:
        value = Decimal(raw)
        require(value.is_finite() and value >= 0, "invalid health value")
        scaled = value * 10
        require(scaled == scaled.to_integral_value(), "value has more than one decimal")
        return int(scaled)
    except (InvalidOperation, ValueError) as error:
        raise SnapshotError(f"invalid health value: {raw!r}") from error


def build_data(payload: bytes, spec: dict) -> dict:
    reader = csv.DictReader(io.StringIO(payload.decode("utf-8")))
    require(reader.fieldnames == spec["headers"], "unexpected SDMX columns/order")
    indicators = {i["code"]: i for i in spec["indicators"]}
    observations = []
    for row in reader:
        require(None not in row and all(v is not None for v in row.values()), "malformed CSV row")
        for key, value in spec["fixedDimensions"].items():
            require(row[key] == value, f"unexpected {key}")
        code = row["DATA_TYPE"]
        require(code in indicators, "indicator outside health domain")
        require(row["UNIT_MEAS"] == indicators[code]["unit"], "indicator unit differs")
        for key, values in spec["attributes"].items():
            require(row[key] in values, f"unexpected {key}")
        require(row["NOTE_DATA_TYPE_DESCR"] == code, "description reference differs")
        require(row["NOTE_DATA_TYPE_SOURCE"] == code + "_SOU", "source reference differs")
        raw, flag = row["OBS_VALUE"], row["OBS_STATUS"]
        require((flag == "n" and raw == "") or (flag == "" and raw != ""), "flag/value mismatch")
        require(row["TIME_PERIOD"].isdigit() and len(row["TIME_PERIOD"]) == 4, "invalid year")
        observations.append({"indicator": code, "territory": row["REF_AREA"], "sex": row["SEX"],
                             "year": int(row["TIME_PERIOD"]),
                             "valueTenths": None if flag else value_tenths(raw),
                             "status": flag or None})
    observations.sort(key=lambda o: (o["indicator"], o["territory"], o["sex"], o["year"]))
    data = {key: spec[key] for key in ("schemaVersion", "datasetId", "domain", "period", "periodNote",
                                      "indicators", "territories", "flags", "caveats", "reconciliation")}
    data.update(scale={"factor": 10, "note": "Valori esatti in decimi dell'unità di ogni indicatore."},
                observations=observations)
    validate_data(data, spec)
    return data


def validate_data(data: dict, spec: dict) -> None:
    for key in ("schemaVersion", "datasetId", "domain", "period", "periodNote", "indicators",
                "territories", "flags", "caveats", "reconciliation"):
        require(data[key] == spec[key], f"public {key} differs from source lock")
    require(data["scale"]["factor"] == 10, "scale differs")
    territories = {t["code"]: t for t in data["territories"]}
    indicators = {i["code"]: i for i in data["indicators"]}
    require(len(territories) == 135 and len(indicators) == 6, "duplicate/missing dictionary entry")
    for territory in territories.values():
        parent = territory["parent"]
        if parent is not None:
            require(parent in territories and territories[parent]["depth"] + 1 == territory["depth"],
                    "territory hierarchy differs")
        elif territory["code"] != "IT":
            require(territory.get("parentOutsideDataset") in {"ITD1", "ITD2"}, "unexplained missing parent")
        if territory["code"] in {"ITCD", "ITFG"}:
            require(territory["kind"] == "composite", "composite is not a region")
    seen, nulls, coverage, counts = set(), [], Counter(), Counter()
    for row in data["observations"]:
        code, territory, sex, year = (row[k] for k in ("indicator", "territory", "sex", "year"))
        key = (code, territory, sex, year)
        require(key not in seen, "duplicate observation")
        seen.add(key)
        require(code in indicators and territory in territories and sex in {"F", "M", "T"}, "unknown dimension")
        indicator = indicators[code]
        require(type(year) is int and indicator["period"]["from"] <= year <= indicator["period"]["to"], "period differs")
        value = row["valueTenths"]
        if value is None:
            require(row["status"] == "n", "null must preserve statistical significance flag")
            nulls.append(list(key))
        else:
            require(type(value) is int and value >= 0 and row["status"] is None, "invalid value/status")
        coverage[(code, f"{sex}/{year}")] += 1
        counts[code] += 1
    require(len(seen) == spec["observations"], "observation coverage differs")
    require(nulls == spec["nullCells"], "null cell identity differs")
    require({r["territory"] for r in data["observations"]} == set(territories), "territory coverage differs")
    for code, indicator in indicators.items():
        require(counts[code] == indicator["observations"], "indicator coverage differs")
        actual = {key: count for (ind, key), count in coverage.items() if ind == code}
        require(actual == indicator["coverage"], "coverage per sex/year differs")


def metadata(spec: dict, data_bytes: bytes) -> dict:
    return {"schemaVersion": 1, "datasetId": DATASET, "period": spec["period"],
            "acquiredAt": spec["source"]["acquisitionDate"], "source": spec["source"],
            "semantics": spec["semantics"], "integrity": {
                "sourceLockSha256": lock_hash(spec), "dataArtifact": {
                    "path": str(DATA.relative_to(ROOT)), "bytes": len(data_bytes),
                    "sha256": sha256_bytes(data_bytes)}}}


def check(spec_path: Path = SPEC, data_path: Path = DATA, meta_path: Path = META) -> None:
    spec = load_spec(spec_path)
    raw = data_path.read_bytes()
    data = json.loads(raw)
    validate_data(data, spec)
    require(raw == canonical_bytes(data), "noncanonical data bytes")
    meta = metadata(spec, raw)
    require(json.loads(meta_path.read_bytes()) == meta, "metadata differs from source lock/data")
    require(spec["integrity"]["dataArtifact"] == meta["integrity"]["dataArtifact"], "artifact hash/bytes differ")


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
        meta = metadata(spec, raw)
        DATA.write_bytes(raw)
        META.write_bytes(canonical_bytes(meta))
        SPEC.write_text(json.dumps(spec, ensure_ascii=False, indent=2) + "\n")
        check()
    print(f"{DATASET}: {len(data['observations'])} observations, {len(raw)} bytes")


if __name__ == "__main__":
    main()
