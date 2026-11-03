#!/usr/bin/env python3
"""Build the source-locked ISTAT contractual wage index per employee, 2005-2025.

The worker-side comparator for issue #825: a tariff index (what collective
agreements set), comparable with the MPs' institutional pay. One SDMX-CSV
response pinned in the source spec by URL, bytes and SHA-256; --check stays offline.
"""
from __future__ import annotations

import argparse
import csv
import io
import json
import sys
from decimal import Decimal, InvalidOperation
from pathlib import Path
from typing import Any

from istat_bes_snapshot import sha256_bytes

ROOT = Path(__file__).resolve().parents[2]
DEFAULT_SPEC = ROOT / "scripts/etl/specs/istat-retribuzioni-contrattuali.source.json"
DEFAULT_DATA = ROOT / "src/data/generated/istat-retribuzioni-contrattuali.json"
DATASET_ID = "istat-retribuzioni-contrattuali"
SDMX_PREFIX = "https://esploradati.istat.it/SDMXWS/rest/data/IT1,"
KEY_COLUMNS = ("FREQ", "REF_AREA", "DATA_TYPE", "ADJUSTMENT", "PROF_STATUS_EMP", "MAIN_AGREEMENT_GROUP")

CAVEATS = (
    "Indice delle retribuzioni contrattuali per dipendente, totale economia, dirigenti esclusi, media annua, base dicembre 2021=100: misura quanto stabiliscono i contratti collettivi, non quanto viene effettivamente pagato.",
    "Gli anni 2005-2020 sono la serie ricostruita da ISTAT nella base dicembre 2021, non un raccordo calcolato da questo progetto.",
    "Straordinari, premi aziendali, cambi di qualifica e composizione dell'occupazione restano fuori: per le retribuzioni effettive usare le serie BES o di contabilità nazionale.",
    "È un indice nominale: per un confronto reale va deflazionato con un indice dei prezzi (FOI o IPCA).",
)


class SnapshotError(ValueError):
    pass


def require(condition: object, message: str) -> None:
    if not condition:
        raise SnapshotError(message)


def load_spec(path: Path) -> dict[str, Any]:
    try:
        spec = json.loads(path.read_text(encoding="utf-8"))
    except (OSError, json.JSONDecodeError) as error:
        raise SnapshotError(f"source lock illeggibile: {error}") from error
    require(spec.get("schemaVersion") == 1 and spec.get("datasetId") == DATASET_ID, "source lock: identità inattesa")
    series, asset = spec.get("series") or {}, (spec.get("source") or {}).get("asset") or {}
    key = ".".join(("A", "IT", series.get("dataType", "?"), series.get("adjustment", "?"), series.get("profStatus", "?"), series.get("agreementGroup", "?")))
    require(asset.get("url") == f"{SDMX_PREFIX}{series.get('dataflowId')},1.0/{key}", "source lock: URL diverso dalla serie dichiarata")
    digest = str(asset.get("sha256", ""))
    require(type(asset.get("bytes")) is int and asset["bytes"] > 0 and len(digest) == 64 and not set(digest) - set("0123456789abcdef"), "source lock: byte o sha256 non validi")
    return spec


def years(spec: dict[str, Any]) -> list[int]:
    return list(range(spec["period"]["from"], spec["period"]["to"] + 1))


def tenths(text: str, where: str) -> int:
    try:
        value = Decimal(text) * 10
    except InvalidOperation as error:
        raise SnapshotError(f"{where}: valore non numerico {text!r}") from error
    require(value == value.to_integral_value() and value > 0, f"{where}: valore {text!r} non valido")
    return int(value)


def build_snapshot(payload: bytes, spec: dict[str, Any]) -> dict[str, Any]:
    asset, series = spec["source"]["asset"], spec["series"]
    require(len(payload) == asset["bytes"] and sha256_bytes(payload) == asset["sha256"], "input: byte/hash diversi dal lock")
    expected_key = ("A", "IT", series["dataType"], series["adjustment"], series["profStatus"], series["agreementGroup"])
    values: dict[int, int] = {}
    for row in csv.DictReader(io.StringIO(payload.decode("utf-8-sig"), newline="")):
        where = f"riga {row.get('TIME_PERIOD')}"
        require(row["DATAFLOW"] == f"IT1:{series['dataflowId']}(1.0)", f"{where}: dataflow inatteso")
        require(tuple(row[column] for column in KEY_COLUMNS) == expected_key, f"{where}: serie diversa da quella del lock")
        require(not row["OBS_STATUS"], f"{where}: flag inatteso {row['OBS_STATUS']!r}")
        year = int(row["TIME_PERIOD"])
        require(year not in values, f"{where}: anno duplicato")
        values[year] = tenths(row["OBS_VALUE"], where)
    require(sorted(values) == years(spec), f"anni {sorted(values)} diversi dal periodo del lock")

    source = spec["source"]
    snapshot = {
        "schemaVersion": 1,
        "datasetId": DATASET_ID,
        "referencePeriod": f"{spec['period']['from']}-{spec['period']['to']}",
        "observedAt": source["acquisition"]["checkedAt"],
        "caveats": list(CAVEATS),
        "units": {"indexTenths": "decimi di indice, base dicembre 2021=100, media annua"},
        "series": {key: series[key] for key in ("dataTypeLabel", "profStatusLabel", "agreementGroupLabel")},
        "observations": [{"year": year, "indexTenths": values[year]} for year in years(spec)],
        "semantics": {
            "soldi": {"applicable": False, "unit": "non applicabile", "nature": "indice delle retribuzioni contrattuali, non importo pagato né spesa pubblica"},
            "periodo": {"referencePeriod": f"{spec['period']['from']}-{spec['period']['to']}", "granularity": "anno solare, media annua pubblicata da ISTAT"},
            "provenance": {
                "holder": source["owner"],
                "landingUrl": source["landingUrl"],
                "dataflowId": series["dataflowId"],
                "url": asset["url"],
                "format": asset["format"],
                "bytes": asset["bytes"],
                "sha256": asset["sha256"],
                "license": source["licenseId"],
                "licenseNote": source["licenseNote"],
                "acquisitionDate": source["acquisition"]["acquiredAt"],
            },
        },
    }
    validate_snapshot(snapshot, spec)
    return snapshot


def validate_snapshot(snapshot: dict[str, Any], spec: dict[str, Any]) -> None:
    require(snapshot.get("schemaVersion") == 1 and snapshot.get("datasetId") == DATASET_ID, "artefatto: identità inattesa")
    observations = snapshot.get("observations") or []
    require([row.get("year") for row in observations] == years(spec), "artefatto: anni mancanti o fuori ordine")
    require(all(type(row.get("indexTenths")) is int and row["indexTenths"] > 0 for row in observations), "artefatto: indice non valido")
    provenance = snapshot["semantics"]["provenance"]
    asset = spec["source"]["asset"]
    require(
        (provenance["url"], provenance["bytes"], provenance["sha256"]) == (asset["url"], asset["bytes"], asset["sha256"]),
        "artefatto: provenienza divergente dal source lock",
    )


def encode(snapshot: dict[str, Any]) -> bytes:
    return (json.dumps(snapshot, ensure_ascii=False, indent=2) + "\n").encode("utf-8")


def main() -> int:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--spec", type=Path, default=DEFAULT_SPEC)
    parser.add_argument("--data", type=Path, default=DEFAULT_DATA)
    parser.add_argument("--input", type=Path, help="risposta SDMX-CSV scaricata dall'URL del lock")
    parser.add_argument("--write", action="store_true")
    parser.add_argument("--check", action="store_true")
    args = parser.parse_args()
    try:
        spec = load_spec(args.spec)
        if args.check:
            validate_snapshot(json.loads(args.data.read_text(encoding="utf-8")), spec)
            print(f"{DATASET_ID}: lock e artefatto coerenti")
            return 0
        require(args.input, "serve --input oppure --check")
        payload = encode(build_snapshot(args.input.read_bytes(), spec))
        if args.write:
            args.data.write_bytes(payload)
        print(f"{DATASET_ID}: build ok, {len(payload)} byte" + (", scritto" if args.write else ""))
        return 0
    except (ValueError, OSError, KeyError) as error:  # SnapshotError and JSONDecodeError are ValueErrors
        print(f"{DATASET_ID}: {error}", file=sys.stderr)
        return 1


if __name__ == "__main__":
    raise SystemExit(main())
