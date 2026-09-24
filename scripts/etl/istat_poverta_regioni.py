#!/usr/bin/env python3
"""Build/check the locked ISTAT regional relative poverty incidence, offline.

Two dataflows of the current post-revision series 34_727, same key except the
measure: 34_727_DF_DCCV_POVERTA_8 publishes the household incidence and
34_727_DF_DCCV_POVERTA_10 the individual one, for 30 territories x 11 years.

Two kinds of absence live in the source and must stay distinct (see #580):

* cells whose OBS_VALUE is empty and whose OBS_STATUS is "0";
* rows that are missing from the response altogether (Bolzano 2016, in both).

CL_FLAG reads "0" as "less than half of the unit used", which would license
imputing zero.  That reading does not survive the data: the individual
incidence equals the household one times the ratio between the average size of
poor households and of all households, and across the 310 valid household
cells that ratio never leaves [0.903, 1.919].  Umbria 2015 publishes a 13.4%
individual incidence, so its household incidence cannot sit below 0.05%: it
would take a ratio of 268, households of six hundred people.  Across the 11
dataflows of the family no flagged cell ever carries a value.  So the flagged
cells are undiffused data, excluded and declared one by one, never zero.
"""

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
SPEC = ROOT / "scripts/etl/specs/istat-poverta-regioni-2014-2024.source.json"
DATA = ROOT / "src/data/generated/istat-poverta-regioni-2014-2024.data.json"
META = ROOT / "src/data/generated/istat-poverta-regioni-2014-2024.meta.json"
DATASET = "istat-poverta-regioni"
SCALE_FACTOR = 100
YEARS = tuple(range(2014, 2025))
UNDIFFUSED_FLAG = "0"

MEASURES = (
    {
        "code": "INCID_POVREL_FAM",
        "key": "households",
        "dataflowId": "34_727_DF_DCCV_POVERTA_8",
        "label": "incidenza di povertà relativa familiare (% di famiglie povere)",
    },
    {
        "code": "INCID_POVREL_INDIV",
        "key": "individuals",
        "dataflowId": "34_727_DF_DCCV_POVERTA_10",
        "label": "incidenza di povertà relativa individuale (% di individui poveri)",
    },
)
MEASURE_BY_KEY = {item["key"]: item for item in MEASURES}


class SnapshotError(ValueError):
    """Source bytes or public regional contract differ from the reviewed lock."""


def require(condition: bool, message: str) -> None:
    if not condition:
        raise SnapshotError(message)


def lock_hash(spec: dict) -> str:
    normalized = {**spec, "integrity": {**spec["integrity"], "sourceLockSha256": ""}}
    return sha256_bytes(canonical_bytes(normalized))


def load_spec(path: Path = SPEC) -> dict:
    spec = json.loads(path.read_bytes())
    require(spec["datasetId"] == DATASET, "dataset identity differs")
    require(spec["source"]["licenseId"] == "not-declared", "payload license must not be inferred")
    require(spec["semantics"]["soldi"]["present"] is False, "an incidence is not money")
    require(spec["integrity"]["sourceLockSha256"] == lock_hash(spec), "source lock hash differs")
    require(
        [item["code"] for item in spec["measures"]] == [item["code"] for item in MEASURES],
        "measure set differs",
    )
    require(
        set(spec["invariants"]["individualToHouseholdRatio"]) == {"pairs", "min", "max"},
        "the individual/household ratio invariant is missing from the lock",
    )
    for asset in spec["source"]["assets"].values():
        require(asset["url"].startswith("https://esploradati.istat.it/"), "unofficial source URL")
    return spec


def value_hundredths(raw: str) -> int:
    try:
        value = Decimal(raw)
        require(value.is_finite() and value >= 0, "invalid incidence value")
        require(value <= 100, "an incidence cannot exceed 100%")
        scaled = value * SCALE_FACTOR
        require(scaled == scaled.to_integral_value(), "value has more than two decimals")
        return int(scaled)
    except (InvalidOperation, ValueError) as error:
        raise SnapshotError(f"invalid incidence value: {raw!r}") from error


def read_measure(payload: bytes, measure: dict, spec: dict) -> tuple[list, list, list]:
    """Return (published, undiffused, missing) for one measure, fail-closed on drift."""
    reader = csv.DictReader(io.StringIO(payload.decode("utf-8")))
    require(reader.fieldnames == spec["headers"], "unexpected SDMX columns/order")
    territories = {item["code"] for item in spec["territories"]}
    fixed = dict(spec["fixedDimensions"])
    fixed["DATAFLOW"] = f"IT1:{measure['dataflowId']}(1.0)"
    fixed["DATA_TYPE"] = measure["code"]

    published, undiffused, seen = [], [], set()
    for row in reader:
        require(None not in row and all(value is not None for value in row.values()), "malformed CSV row")
        for key, value in fixed.items():
            require(row[key] == value, f"unexpected {key}")
        for key, values in spec["attributes"].items():
            require(row[key] in values, f"unexpected {key}")
        territory = row["REF_AREA"]
        require(territory in territories, "unknown territory")
        require(row["TIME_PERIOD"].isdigit() and len(row["TIME_PERIOD"]) == 4, "invalid year")
        year = int(row["TIME_PERIOD"])
        require(year in YEARS, f"year {year} outside the locked window")
        key = (territory, year)
        require(key not in seen, "duplicate source observation")
        seen.add(key)

        raw, flag = row["OBS_VALUE"], row["OBS_STATUS"]
        if raw == "":
            # Dato non diffuso: la cella porta un simbolo al posto del numero.
            require(flag == UNDIFFUSED_FLAG, f"empty value with unexpected flag {flag!r}")
            undiffused.append({"territory": territory, "measure": measure["key"], "year": year, "flag": flag})
            continue
        require(flag == "", f"published value carries flag {flag!r}")
        published.append(
            {
                "territory": territory,
                "measure": measure["key"],
                "year": year,
                "valueHundredths": value_hundredths(raw),
            }
        )

    missing = [
        {"territory": territory, "measure": measure["key"], "year": year}
        for territory in sorted(territories)
        for year in YEARS
        if (territory, year) not in seen
    ]
    return published, undiffused, missing


def ratio_bounds(published: list) -> dict:
    """Individual over household incidence, in ten-thousandths, on the pairs the source publishes."""
    by_key = {(row["measure"], row["territory"], row["year"]): row["valueHundredths"] for row in published}
    ratios = []
    for (measure, territory, year), value in by_key.items():
        if measure != "households":
            continue
        individual = by_key.get(("individuals", territory, year))
        if individual is None:
            continue
        require(value > 0, "a published household incidence of zero would break the ratio")
        ratios.append(individual * 10_000 // value)
    require(ratios, "no comparable pair left to pin the ratio")
    return {"pairs": len(ratios), "min": min(ratios), "max": max(ratios)}


def build_data(households: bytes, individuals: bytes, spec: dict) -> dict:
    published, undiffused, missing = [], [], []
    for payload, measure in ((households, MEASURES[0]), (individuals, MEASURES[1])):
        rows, blanks, gaps = read_measure(payload, measure, spec)
        published.extend(rows)
        undiffused.extend(blanks)
        missing.extend(gaps)

    published.sort(key=lambda item: (item["measure"], item["territory"], item["year"]))
    undiffused.sort(key=lambda item: (item["measure"], item["territory"], item["year"]))
    missing.sort(key=lambda item: (item["measure"], item["territory"], item["year"]))

    bounds = ratio_bounds(published)
    require(
        bounds == spec["invariants"]["individualToHouseholdRatio"],
        "individual/household ratio differs from the reviewed lock",
    )

    data = {key: spec[key] for key in (
        "schemaVersion", "datasetId", "domain", "period", "periodNote", "measures",
        "territories", "flags", "caveats", "reconciliation",
    )}
    data.update(
        scale={
            "factor": SCALE_FACTOR,
            "note": "Incidenze in centesimi di punto percentuale (valueHundredths): 10,9% vale 1090.",
        },
        observations=published,
        undiffused=undiffused,
        missingRows=missing,
        ratioBounds=bounds,
    )
    validate_data(data, spec)
    return data


def validate_data(data: dict, spec: dict) -> None:
    for key in (
        "schemaVersion", "datasetId", "domain", "period", "periodNote", "measures",
        "territories", "flags", "caveats", "reconciliation",
    ):
        require(data[key] == spec[key], f"public {key} differs from source lock")
    require(data["scale"]["factor"] == SCALE_FACTOR, "scale differs")

    territories = {item["code"]: item for item in data["territories"]}
    require(len(territories) == 30, "territory dictionary differs")
    for item in data["territories"]:
        require(item["kind"] in {"country", "macro-area", "area", "region", "autonomous-province"}, "unknown territory kind")
        require(item["parent"] is None or item["parent"] in territories, "dangling territory parent")
    require(territories["IT"]["parent"] is None and territories["IT"]["kind"] == "country", "Italia must stay the root")

    seen, coverage = set(), Counter()
    for row in data["observations"]:
        key = (row["measure"], row["territory"], row["year"])
        require(key not in seen, "duplicate observation")
        seen.add(key)
        require(row["measure"] in MEASURE_BY_KEY, "unknown measure")
        require(row["territory"] in territories, "unknown territory")
        require(row["year"] in YEARS, "year outside published set")
        require(type(row["valueHundredths"]) is int, "value must be an integer of hundredths")
        require(0 <= row["valueHundredths"] <= 100 * SCALE_FACTOR, "incidence out of range")
        coverage[row["measure"]] += 1

    # Assenza dichiarata: nessuna cella non diffusa o mancante puo' comparire fra i valori.
    declared = set()
    for row in data["undiffused"]:
        require(row["flag"] == UNDIFFUSED_FLAG, "unexpected undiffused flag")
        key = (row["measure"], row["territory"], row["year"])
        require(key not in seen, "an undiffused cell leaked into the published values")
        require(key not in declared, "duplicate undiffused cell")
        declared.add(key)
    for row in data["missingRows"]:
        key = (row["measure"], row["territory"], row["year"])
        require(key not in seen, "a missing row leaked into the published values")
        require(key not in declared, "a row cannot be both missing and undiffused")
        declared.add(key)

    reconciliation = data["reconciliation"]
    for measure in MEASURES:
        stats = reconciliation["byMeasure"][measure["key"]]
        published = coverage[measure["key"]]
        undiffused = sum(1 for row in data["undiffused"] if row["measure"] == measure["key"])
        missing = sum(1 for row in data["missingRows"] if row["measure"] == measure["key"])
        require(published == stats["published"], f"{measure['key']}: published coverage differs")
        require(undiffused == stats["undiffused"], f"{measure['key']}: undiffused coverage differs")
        require(missing == stats["missing"], f"{measure['key']}: missing coverage differs")
        require(stats["sourceRows"] == published + undiffused, f"{measure['key']}: source rows differ")
        require(
            published + undiffused + missing == len(territories) * len(YEARS),
            f"{measure['key']}: the 30x11 grid is not accounted for",
        )

    # Bolzano non ha nemmeno un valore familiare: la fetta lo dichiara, non lo mostra spezzato.
    bolzano = {row["year"] for row in data["observations"] if row["territory"] == "ITD1" and row["measure"] == "households"}
    require(not bolzano, "Bolzano now publishes a household incidence: re-review the exclusion")

    # L'invariante che smonta la lettura "meno della meta' della cifra minima".
    bounds = ratio_bounds(data["observations"])
    require(bounds == data["ratioBounds"], "individual/household ratio differs from the pinned bounds")
    require(bounds == spec["invariants"]["individualToHouseholdRatio"], "ratio differs from the reviewed lock")
    require(bounds["max"] < 40_000, "ratio above 4: an undiffused cell may have been imputed")
    require(bounds["min"] > 5_000, "ratio below 0.5: measures may have been swapped")


def public_metadata(spec: dict) -> dict:
    source = spec["source"]
    return {
        "period": [
            f"Anni {YEARS[0]}–{YEARS[-1]}, serie corrente post-revisione",
            spec["semantics"]["periodo"]["note"],
            f"Dataflow aggiornati {source['dataflowLastUpdate'][:10]}; acquisizione {source['acquisitionDate']}",
        ],
        "units": [
            f"Incidenze in centesimi di punto percentuale (scale factor {SCALE_FACTOR})",
            "UNIT_MEAS assente nel payload: l'unità è dichiarata dal codice misura, non dedotta",
        ],
        "coverage": spec["reconciliation"]["note"],
        "references": [
            {"label": "ISTAT · Open Data" if "open-data" in url else "ISTAT · Note legali", "url": url}
            for url in source["reuseTermsEvidence"]
        ],
    }


def metadata(spec: dict, data_bytes: bytes) -> dict:
    return {
        "schemaVersion": 1,
        "datasetId": DATASET,
        "period": spec["period"],
        "acquiredAt": spec["source"]["acquisitionDate"],
        "source": spec["source"],
        "semantics": spec["semantics"],
        "publicMetadata": public_metadata(spec),
        "integrity": {
            "sourceLockSha256": lock_hash(spec),
            "dataArtifact": {
                "path": DATA.relative_to(ROOT).as_posix(),
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
    parser.add_argument("--check", action="store_true", help="verify the committed artifacts offline")
    parser.add_argument("--write", action="store_true", help="rebuild the artifacts from the locked inputs")
    parser.add_argument("--input-dir", type=Path, help="directory holding the two locked SDMX-CSV responses")
    args = parser.parse_args()

    if args.write:
        require(args.input_dir is not None, "--write needs --input-dir with the locked responses")
        spec = load_spec()
        payloads = {}
        for measure in MEASURES:
            asset = spec["source"]["assets"][measure["key"]]
            path = args.input_dir / f"{measure['key']}.csv"
            raw = path.read_bytes()
            require(len(raw) == asset["bytes"], f"{measure['key']}: byte count differs from the lock")
            require(sha256_bytes(raw) == asset["sha256"], f"{measure['key']}: SHA-256 differs from the lock")
            payloads[measure["key"]] = raw
        data = build_data(payloads["households"], payloads["individuals"], spec)
        data_bytes = canonical_bytes(data)
        DATA.write_bytes(data_bytes)
        META.write_bytes(canonical_bytes(metadata(spec, data_bytes)))
        print(f"scritto {DATA.relative_to(ROOT)}: {len(data_bytes)} byte, {len(data['observations'])} osservazioni")
        return

    check()
    print("ok: artefatti coerenti con il lock")


if __name__ == "__main__":
    main()
