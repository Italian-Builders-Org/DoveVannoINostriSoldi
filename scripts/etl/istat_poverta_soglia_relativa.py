#!/usr/bin/env python3
"""Build/check the locked ISTAT relative poverty monetary thresholds (34_727_DF_DCCV_POVERTA_11), offline.

Publishes SOGLIA_POVREL for Italia × ampiezze familiari N1…N7_GE.
Year 2021 is excluded from the published series (issue #329 decision a): the
source CSV still contains it and the lock fails closed if that year disappears
or appears in the public artifact.
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
SPEC = ROOT / "scripts/etl/specs/istat-poverta-soglia-relativa-2014-2024.source.json"
DATA = ROOT / "src/data/generated/istat-poverta-soglia-relativa-2014-2024.data.json"
META = ROOT / "src/data/generated/istat-poverta-soglia-relativa-2014-2024.meta.json"
DATASET = "istat-poverta-soglia-relativa"
SCALE_FACTOR = 100
EXCLUDED_YEAR = 2021
PUBLISHED_YEARS = (2014, 2015, 2016, 2017, 2018, 2019, 2020, 2022, 2023, 2024)
HOUSEHOLD_COMPS = (
    {"code": "N1", "label": "1"},
    {"code": "N2", "label": "2"},
    {"code": "N3", "label": "3"},
    {"code": "N4", "label": "4"},
    {"code": "N5", "label": "5"},
    {"code": "N6", "label": "6"},
    {"code": "N7_GE", "label": "7 e più"},
)


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
        == {
            "code": "34_727_DF_DCCV_POVERTA_11",
            "label": "Linee e soglie di povertà relativa",
            "dataflowId": "34_727_DF_DCCV_POVERTA_11",
        },
        "domain differs",
    )
    require(spec["source"]["licenseId"] == "not-declared", "payload license must not be inferred")
    require(spec["semantics"]["soldi"]["present"] is True, "monetary threshold must declare soldi")
    require(spec["excludedYear"] == EXCLUDED_YEAR, "excluded year differs")
    require(spec["integrity"]["sourceLockSha256"] == lock_hash(spec), "source lock hash differs")
    for asset in spec["source"]["assets"].values():
        require(asset["url"].startswith("https://esploradati.istat.it/"), "unofficial source URL")
    return spec


def value_hundredths(raw: str) -> int:
    try:
        value = Decimal(raw)
        require(value.is_finite() and value >= 0, "invalid threshold value")
        scaled = value * SCALE_FACTOR
        require(scaled == scaled.to_integral_value(), "value has more than two decimals")
        return int(scaled)
    except (InvalidOperation, ValueError) as error:
        raise SnapshotError(f"invalid threshold value: {raw!r}") from error


def build_data(payload: bytes, spec: dict) -> dict:
    reader = csv.DictReader(io.StringIO(payload.decode("utf-8")))
    require(reader.fieldnames == spec["headers"], "unexpected SDMX columns/order")
    territories = {item["code"]: item for item in spec["territories"]}
    households = {item["code"]: item for item in spec["householdCompositions"]}
    indicators = {item["code"]: item for item in spec["indicators"]}
    source_rows = []
    published = []
    excluded = []
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
        household = row["NUMBER_HOUSEHOLD_COMP"]
        require(territory in territories, "unknown territory")
        require(household in households, "unknown household composition")
        raw, flag = row["OBS_VALUE"], row["OBS_STATUS"]
        require(raw != "" and flag == "", "empty or flagged OBS_VALUE not expected for relative threshold")
        require(row["TIME_PERIOD"].isdigit() and len(row["TIME_PERIOD"]) == 4, "invalid year")
        year = int(row["TIME_PERIOD"])
        observation = {
            "territory": territory,
            "householdComposition": household,
            "year": year,
            "valueHundredths": value_hundredths(raw),
            "status": None,
        }
        source_rows.append(observation)
        if year == EXCLUDED_YEAR:
            excluded.append(observation)
        else:
            require(year in PUBLISHED_YEARS, f"unexpected published year {year}")
            published.append(observation)

    require(len(source_rows) == spec["sourceObservations"], "source observation coverage differs")
    require(len(excluded) == spec["excludedObservations"], "excluded 2021 coverage differs")
    require(
        {row["householdComposition"] for row in excluded} == set(households),
        "2021 must cover every household composition",
    )
    # Fail-closed anomaly check: 2021 N1 stays the known broken magnitude vs 2020/2022.
    by_key = {(row["householdComposition"], row["year"]): row["valueHundredths"] for row in source_rows}
    n1_2020, n1_2021, n1_2022 = by_key[("N1", 2020)], by_key[("N1", 2021)], by_key[("N1", 2022)]
    require(n1_2021 > n1_2020 * 2 and n1_2021 > n1_2022 * 2, "2021 anomaly disappeared; re-review exclusion")

    published.sort(key=lambda item: (item["householdComposition"], item["year"]))
    data = {key: spec[key] for key in (
        "schemaVersion", "datasetId", "domain", "period", "periodNote", "excludedYear",
        "excludedYearReason", "indicators", "territories", "householdCompositions", "flags",
        "caveats", "reconciliation",
    )}
    data.update(
        scale={
            "factor": SCALE_FACTOR,
            "note": "Soglie mensili esatte in centesimi di euro (valueHundredths).",
        },
        observations=published,
    )
    validate_data(data, spec)
    return data


def validate_data(data: dict, spec: dict) -> None:
    for key in (
        "schemaVersion", "datasetId", "domain", "period", "periodNote", "excludedYear",
        "excludedYearReason", "indicators", "territories", "householdCompositions", "flags",
        "caveats", "reconciliation",
    ):
        require(data[key] == spec[key], f"public {key} differs from source lock")
    require(data["scale"]["factor"] == SCALE_FACTOR, "scale differs")
    territories = {item["code"]: item for item in data["territories"]}
    households = {item["code"] for item in data["householdCompositions"]}
    indicators = {item["code"]: item for item in data["indicators"]}
    require(len(territories) == 1 and "IT" in territories, "territory dictionary differs")
    require(len(households) == 7, "household dictionary differs")
    require(len(indicators) == 1 and "SOGLIA_POVREL" in indicators, "indicator dictionary differs")
    require(territories["IT"]["kind"] == "country", "Italia must stay country")
    seen, coverage = set(), Counter()
    for row in data["observations"]:
        key = (row["territory"], row["householdComposition"], row["year"])
        require(key not in seen, "duplicate observation")
        seen.add(key)
        require(row["territory"] in territories and row["householdComposition"] in households, "unknown dimension")
        require(row["year"] != EXCLUDED_YEAR, "excluded year leaked into public artifact")
        require(row["year"] in PUBLISHED_YEARS, "year outside published set")
        require(row["status"] is None, "unexpected observation status")
        require(type(row["valueHundredths"]) is int and row["valueHundredths"] >= 0, "invalid value")
        coverage[str(row["year"])] += 1
    require(len(seen) == spec["observations"], "observation coverage differs")
    require({row["territory"] for row in data["observations"]} == set(territories), "territory coverage differs")
    require(
        {row["householdComposition"] for row in data["observations"]} == households,
        "household coverage differs",
    )
    require(dict(coverage) == indicators["SOGLIA_POVREL"]["coverage"], "coverage per year differs")
    require(len(seen) == indicators["SOGLIA_POVREL"]["observations"], "indicator coverage differs")


def public_metadata(spec: dict) -> dict:
    source = spec["source"]
    indicators = spec["indicators"]
    require(
        len(indicators) == 1 and indicators[0].get("code") == "SOGLIA_POVREL",
        "SOGLIA_POVREL must be the only indicator in public metadata",
    )
    indicator = indicators[0]
    require(spec["semantics"]["soldi"]["present"] is True, "monetary threshold must declare soldi")
    unit = indicator.get("unit")
    unit_note = "UNIT_MEAS assente nel payload" if unit == "" else f"UNIT_MEAS={unit}"
    return {
        "period": [
            f"Anni pubblicati {', '.join(str(year) for year in PUBLISHED_YEARS)} (escluso il {EXCLUDED_YEAR})",
            spec["semantics"]["periodo"]["note"],
            f"Dataflow aggiornato {source['dataflowLastUpdate'][:10]}; acquisizione {source['acquisitionDate']}",
        ],
        "units": [
            f"Soglia monetaria mensile in centesimi di euro (scale factor {SCALE_FACTOR})",
            unit_note,
        ],
        "coverage": (
            f"{spec['periodNote']} L'anno {EXCLUDED_YEAR} è presente nella fonte e "
            f"escluso dal prodotto: {spec['excludedYearReason']}"
        ),
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


def bootstrap_spec(csv_path: Path, structure_path: Path) -> dict:
    """One-shot helper used only to mint the initial reviewed lock from pinned bytes."""
    csv_raw = csv_path.read_bytes()
    structure_raw = structure_path.read_bytes()
    reader = csv.DictReader(io.StringIO(csv_raw.decode("utf-8")))
    headers = list(reader.fieldnames or [])
    rows = list(reader)
    require(len(rows) == 77, "expected 77 source rows (7 compositions × 11 years)")
    comps = sorted({row["NUMBER_HOUSEHOLD_COMP"] for row in rows})
    require(comps == [item["code"] for item in HOUSEHOLD_COMPS], "household composition set differs")
    coverage = {str(year): 7 for year in PUBLISHED_YEARS}
    attribute_keys = [
        "OBS_STATUS",
        "NOTE_DS",
        "NOTE_REF_AREA",
        "NOTE_DATA_TYPE",
        "NOTE_POVERTY_LINES",
        "NOTE_NUMBER_HOUSEHOLD_COMP",
        "NOTE_HOUSEHOLD_TYPOLOGY",
        "NOTE_AGE_REFERENCE_PERSON",
        "NOTE_EDU_LEV_REFPERS",
        "NOTE_LABPROF_STATUS_B_REF",
        "NOTE_SEX",
        "NOTE_AGE",
        "NOTE_TIME_PERIOD",
        "BASE_PER",
        "UNIT_MEAS",
        "UNIT_MULT",
    ]
    attributes = {key: sorted({row[key] for row in rows}) for key in attribute_keys}
    return {
        "schemaVersion": 1,
        "datasetId": DATASET,
        "domain": {
            "code": "34_727_DF_DCCV_POVERTA_11",
            "label": "Linee e soglie di povertà relativa",
            "dataflowId": "34_727_DF_DCCV_POVERTA_11",
        },
        "period": {"from": 2014, "to": 2024},
        "periodNote": (
            "Serie nazionale 2014–2024 (solo Italia). L'anno 2021 è escluso dal prodotto "
            "perché i valori pubblicati dalla fonte risultano incoerenti con il resto della serie "
            "(decisione #329, opzione a)."
        ),
        "excludedYear": EXCLUDED_YEAR,
        "excludedYearReason": (
            "I valori 2021 della soglia relativa sono circa 2,6× quelli del 2020 e circa 2,2× "
            "quelli del 2022; la soglia relativa non può variare così. Si pubblica la serie con "
            "buco dichiarato invece di un valore che sappiamo falso."
        ),
        "sourceObservations": 77,
        "excludedObservations": 7,
        "observations": 70,
        "source": {
            "owner": "ISTAT — Istituto nazionale di statistica",
            "landingUrl": "https://esploradati.istat.it/databrowser/",
            "dataflowId": "34_727_DF_DCCV_POVERTA_11",
            "dataflowVersion": "1.0",
            "dataflowLabel": "Linee e soglie di povertà relativa",
            "dataStructure": "34_727_DF_DCCV_POVERTA_11 v1.0",
            "dataflowLastUpdate": "2025-10-14T08:02:20.381Z",
            "licenseId": "not-declared",
            "licenseNote": (
                "La risposta SDMX non dichiara una licenza; le condizioni generali ISTAT CC BY 4.0 "
                "sono documentate separatamente e non vengono promosse a licenza incorporata nel payload."
            ),
            "reuseTermsEvidence": [
                "https://www.istat.it/dati/open-data/",
                "https://www.istat.it/note-legali/",
            ],
            "acquisitionDate": "2026-09-21",
            "checkedAt": "2026-09-21",
            "assets": {
                "csv": {
                    "url": (
                        "https://esploradati.istat.it/SDMXWS/rest/data/"
                        "IT1,34_727_DF_DCCV_POVERTA_11,1.0/"
                        "A.IT.SOGLIA_POVREL.ALL.N1+N2+N3+N4+N5+N6+N7_GE.HH.TOTAL.99.ALL.9.TOTAL"
                    ),
                    "requestHeaders": {"Accept": "text/csv"},
                    "format": "SDMX-CSV 1.0.0",
                    "bytes": len(csv_raw),
                    "sha256": sha256_bytes(csv_raw),
                },
                "structure": {
                    "url": (
                        "https://esploradati.istat.it/SDMXWS/rest/dataflow/"
                        "IT1/34_727_DF_DCCV_POVERTA_11/1.0?references=all"
                    ),
                    "format": "SDMX-ML Structure 2.1",
                    "bytes": len(structure_raw),
                    "sha256": sha256_bytes(structure_raw),
                },
            },
        },
        "semantics": {
            "soldi": {
                "present": True,
                "note": (
                    "Soglia monetaria mensile in centesimi di euro (valueHundredths). "
                    "Non è spesa pubblica: non confrontare né sommare con pagamenti, stanziamenti o gettito."
                ),
            },
            "periodo": {
                "referencePeriod": "2014–2024 (senza 2021)",
                "note": (
                    "Aggiornamento del dataflow, acquisizione e anni delle osservazioni restano date distinte. "
                    f"L'anno {EXCLUDED_YEAR} resta nella fonte e fuori dal prodotto."
                ),
            },
            "provenance": {
                "holder": "ISTAT",
                "dataflowLastUpdate": "2025-10-14T08:02:20.381Z",
                "acquisitionDate": "2026-09-21",
                "checkedAt": "2026-09-21",
                "license": "not-declared",
            },
        },
        "headers": headers,
        "fixedDimensions": {
            "DATAFLOW": "IT1:34_727_DF_DCCV_POVERTA_11(1.0)",
            "FREQ": "A",
            "REF_AREA": "IT",
            "DATA_TYPE": "SOGLIA_POVREL",
            "POVERTY_LINES": "ALL",
            "HOUSEHOLD_TYPOLOGY": "HH",
            "AGE_REFERENCE_PERSON": "TOTAL",
            "EDU_LEV_REFPERS": "99",
            "LABPROF_STATUS_B_REF": "ALL",
            "SEX": "9",
            "AGE": "TOTAL",
        },
        "attributes": attributes,
        "indicators": [
            {
                "code": "SOGLIA_POVREL",
                "label": "soglia di povertà relativa (spesa mensile in euro)",
                "unit": "",
                "period": {"from": 2014, "to": 2024},
                "observations": 70,
                "coverage": coverage,
            }
        ],
        "territories": [{"code": "IT", "label": "Italia", "kind": "country", "parent": None}],
        "householdCompositions": list(HOUSEHOLD_COMPS),
        "flags": {
            "OBS_STATUS": {
                "codelist": "CL_FLAG",
                "note": (
                    "In questo DSD OBS_STATUS è vincolato a CL_FLAG. In questa acquisizione tutte "
                    "le celle hanno OBS_STATUS vuoto e OBS_VALUE valorizzato."
                ),
                "knownValues": {
                    "0": "il dato non raggiunge la metà della cifra minima considerata",
                    "c": "dato oscurato per la tutela del segreto statistico",
                    "n": "dato statisticamente non significativo",
                    "u": "dato indisponibile o incerto",
                },
            }
        },
        "caveats": [
            "Soglia monetaria mensile, non spesa pubblica e non un'incidenza: non confrontare né sommare con le misure 34_727 di povertà relativa/assoluta già in piattaforma.",
            "Soglia relativa ≠ soglia assoluta (34_211): territori, ampiezze e definizioni diverse; nessun confronto riga per riga.",
            "Solo Italia: nessun dettaglio regionale in questo dataflow.",
            "TOT (totale ampiezze) e FAM_VAL_PERC_POV restano fuori perimetro.",
            f"L'anno {EXCLUDED_YEAR} è escluso dal prodotto perché i valori della fonte sono incoerenti con il resto della serie.",
            "UNIT_MEAS è vuoto nel payload: l'unità è dichiarata dal codice misura, non inventata.",
            "Licenza del payload not-declared.",
        ],
        "reconciliation": {
            "sourceRows": 77,
            "publishedRows": 70,
            "excludedYear": EXCLUDED_YEAR,
            "excludedRows": 7,
            "householdCompositions": 7,
            "territories": 1,
            "note": (
                "Il CSV ufficiale contiene 77 osservazioni (7 ampiezze × 11 anni). "
                "Il prodotto pubblica 70 osservazioni escludendo le 7 del 2021."
            ),
        },
        "integrity": {
            "sourceLockSha256": "",
            "dataArtifact": {
                "path": DATA.relative_to(ROOT).as_posix(),
                "bytes": 0,
                "sha256": "",
            },
        },
    }


def main() -> None:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--check", action="store_true")
    parser.add_argument("--bootstrap", action="store_true", help="Mint initial source lock from pinned bytes")
    parser.add_argument("--input", type=Path)
    parser.add_argument("--structure", type=Path)
    parser.add_argument("--write", action="store_true")
    args = parser.parse_args()
    if args.check:
        check()
        print(f"{DATASET}: source lock, data, metadata and coverage verified offline")
        return
    require(args.input is not None and args.structure is not None, "both locked CSV and structure are required")
    if args.bootstrap:
        spec = bootstrap_spec(args.input, args.structure)
        SPEC.parent.mkdir(parents=True, exist_ok=True)
        SPEC.write_text(json.dumps(spec, ensure_ascii=False, indent=2) + "\n", encoding="utf-8")
        # Fill integrity after first write path below.
    else:
        spec = load_spec()
    for name, path in (("csv", args.input), ("structure", args.structure)):
        raw = path.read_bytes()
        asset = spec["source"]["assets"][name]
        require(len(raw) == asset["bytes"] and sha256_bytes(raw) == asset["sha256"], f"{name} bytes/hash differ")
    data = build_data(args.input.read_bytes(), spec)
    raw = canonical_bytes(data)
    if args.write or args.bootstrap:
        spec["integrity"]["dataArtifact"] = metadata(spec, raw)["integrity"]["dataArtifact"]
        spec["integrity"]["sourceLockSha256"] = lock_hash(spec)
        raw = canonical_bytes(data)
        DATA.write_bytes(raw)
        META.write_bytes(canonical_bytes(metadata(spec, raw)))
        SPEC.write_text(json.dumps(spec, ensure_ascii=False, indent=2) + "\n", encoding="utf-8")
        check()
    print(f"{DATASET}: {len(data['observations'])} observations, {len(raw)} bytes")


if __name__ == "__main__":
    main()
