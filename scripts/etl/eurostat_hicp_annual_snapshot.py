#!/usr/bin/env python3
"""Build the source-locked annual HICP series for Italy (Eurostat prc_hicp_ainr).

Used to turn nominal amounts into real ones over long periods (issue #825). The
input is one JSON-stat 2.0 response pinned in the source spec by URL, SDMX
structure, upstream timestamp, bytes and SHA-256; --check stays offline.
"""
from __future__ import annotations

import argparse
import json
import sys
from decimal import ROUND_HALF_UP, Decimal
from pathlib import Path
from typing import Any

from eurostat_hicp_snapshot import (
    OFFICIAL_PREFIX,
    SnapshotError,
    flat_index,
    parse_bundle,
    require_codes,
    scaled_int,
    sha256_bytes,
    source_cell,
    validate_flag,
)

ROOT = Path(__file__).resolve().parents[2]
DEFAULT_SPEC = ROOT / "scripts/etl/specs/eurostat-hicp-annuale.source.json"
DEFAULT_DATA = ROOT / "src/data/generated/eurostat-hicp-annuale.json"
DATASET_ID = "eurostat-hicp-annuale"
ASSET = "annual"

CAVEATS = (
    "Indice armonizzato dei prezzi al consumo (IPCA/HICP) per l'Italia, media annua, base 2025=100: serve a deflazionare importi nominali, non è spesa pubblica.",
    "Il tasso è la variazione della media annua sulla media dell'anno precedente, calcolata da Eurostat sugli indici non arrotondati: ricalcolato dagli indici a un decimale può scostarsi di qualche decimo.",
    "Il 1996 è il primo anno della serie e non ha tasso di variazione.",
    "IPCA, NIC e FOI sono indici diversi. Le rivalutazioni di legge usano il FOI ISTAT, che questo snapshot non contiene.",
)


def load_spec(path: Path) -> dict[str, Any]:
    try:
        spec = json.loads(path.read_text(encoding="utf-8"))
    except (OSError, json.JSONDecodeError) as error:
        raise SnapshotError(f"source lock illeggibile: {error}") from error
    if spec.get("schemaVersion") != 1 or spec.get("datasetId") != DATASET_ID:
        raise SnapshotError("source lock: identità inattesa")
    source = spec.get("source") or {}
    if source.get("licenseId") != "CC-BY-4.0":
        raise SnapshotError("source lock: licenza Eurostat inattesa")
    for field in ("landingUrl", "informationUrl", "termsUrl"):
        if not str(source.get(field, "")).startswith(OFFICIAL_PREFIX):
            raise SnapshotError(f"source lock: {field} non ufficiale Eurostat")
    assets = source.get("assets")
    if not isinstance(assets, dict) or set(assets) != {ASSET}:
        raise SnapshotError("source lock: set asset inatteso")
    asset = assets[ASSET]
    if not str(asset.get("url", "")).startswith(OFFICIAL_PREFIX + "api/"):
        raise SnapshotError("source lock: URL asset non ufficiale")
    digest = str(asset.get("sha256", ""))
    if not isinstance(asset.get("bytes"), int) or asset["bytes"] <= 0 or len(digest) != 64 or set(digest) - set("0123456789abcdef"):
        raise SnapshotError("source lock: byte o sha256 non validi")
    period = spec.get("period") or {}
    if not all(type(period.get(key)) is int for key in ("from", "to")) or period["from"] >= period["to"]:
        raise SnapshotError("source lock: periodo non valido")
    return spec


def years(spec: dict[str, Any]) -> list[str]:
    return [str(year) for year in range(spec["period"]["from"], spec["period"]["to"] + 1)]


def recomputed_rate_tenths(previous: int, current: int) -> int:
    rate = (Decimal(current) / Decimal(previous) - 1) * 1000
    return int(rate.quantize(Decimal(1), rounding=ROUND_HALF_UP))


def build_snapshot(payload: bytes, spec: dict[str, Any]) -> dict[str, Any]:
    asset = spec["source"]["assets"][ASSET]
    if len(payload) != asset["bytes"] or sha256_bytes(payload) != asset["sha256"]:
        raise SnapshotError("input: byte/hash diversi dal lock")
    doc = parse_bundle(payload, ASSET, spec)
    for dimension, codes in (("freq", ["A"]), ("unit", ["INX_A_AVG", "RCH_A_AVG"]), ("coicop18", ["TOTAL"]), ("geo", ["IT"]), ("time", years(spec))):
        require_codes(doc, dimension, codes, ASSET)

    first = years(spec)[0]
    observations = []
    for year in years(spec):
        cell = {"freq": "A", "coicop18": "TOTAL", "geo": "IT", "time": year}
        raw, flag = source_cell(doc, {**cell, "unit": "INX_A_AVG"}, f"indice {year}")
        row: dict[str, Any] = {"year": int(year), "indexTenths": scaled_int(raw, 10, f"indice {year}")}
        flags = {}
        if flag := validate_flag(flag, spec, f"indice {year}"):
            flags["indexTenths"] = flag
        if year == first:
            if flat_index(doc, {**cell, "unit": "RCH_A_AVG"}) in (doc.get("value") or {}):
                raise SnapshotError(f"tasso {year}: inatteso nel primo anno")
        else:
            raw, flag = source_cell(doc, {**cell, "unit": "RCH_A_AVG"}, f"tasso {year}")
            row["annualAverageRateTenths"] = scaled_int(raw, 10, f"tasso {year}")
            if flag := validate_flag(flag, spec, f"tasso {year}"):
                flags["annualAverageRateTenths"] = flag
        if flags:
            row["flags"] = flags
        observations.append(row)

    source = spec["source"]
    snapshot = {
        "schemaVersion": 1,
        "datasetId": DATASET_ID,
        "referencePeriod": f"{spec['period']['from']}-{spec['period']['to']}",
        "observedAt": source["acquisition"]["checkedAt"],
        "caveats": list(CAVEATS),
        "units": {
            "indexTenths": f"decimi di indice, base {spec['expected']['baseYear']}=100",
            "annualAverageRateTenths": "decimi di punto percentuale, media annua sulla media dell'anno precedente",
        },
        "flags": dict(spec["expected"]["knownFlags"]),
        "observations": observations,
        "coverage": {"expectedCells": spec["expected"]["cells"], "observedCells": sum(len(row) - 1 - ("flags" in row) for row in observations)},
        "reconciliation": {
            "rateToleranceTenths": spec["expected"]["rateToleranceTenths"],
            "maxRateGapTenths": max_rate_gap(observations),
            "note": "Ogni tasso pubblicato è confrontato con quello ricalcolato dagli indici arrotondati; lo scarto ammesso copre solo l'arrotondamento.",
        },
        "semantics": {
            "soldi": {"applicable": False, "unit": "non applicabile", "nature": "indice dei prezzi al consumo armonizzato (IPCA/HICP), non flusso monetario pubblico"},
            "periodo": {"referencePeriod": f"{spec['period']['from']}-{spec['period']['to']}", "granularity": "anno solare, media dei dodici indici mensili"},
            "provenance": {
                "holder": source["owner"],
                "landingUrl": source["landingUrl"],
                "informationUrl": source["informationUrl"],
                "url": asset["url"],
                "structure": dict(asset["structure"]),
                "publicationDate": asset["sourceUpdated"],
                "acquisitionDate": source["acquisition"]["acquiredAt"],
                "license": source["licenseId"],
                "licenseNote": source["licenseNote"],
                "bytes": asset["bytes"],
                "sha256": asset["sha256"],
            },
        },
    }
    validate_snapshot(snapshot, spec)
    return snapshot


def max_rate_gap(observations: list[dict[str, Any]]) -> int:
    return max(
        abs(current["annualAverageRateTenths"] - recomputed_rate_tenths(previous["indexTenths"], current["indexTenths"]))
        for previous, current in zip(observations, observations[1:])
    )


def validate_snapshot(snapshot: dict[str, Any], spec: dict[str, Any]) -> None:
    if snapshot.get("schemaVersion") != 1 or snapshot.get("datasetId") != DATASET_ID:
        raise SnapshotError("artefatto: identità inattesa")
    observations = snapshot.get("observations") or []
    if [row.get("year") for row in observations] != [int(year) for year in years(spec)]:
        raise SnapshotError("artefatto: anni mancanti o fuori ordine")
    for index, row in enumerate(observations):
        fields = ("indexTenths",) if index == 0 else ("indexTenths", "annualAverageRateTenths")
        if not all(type(row.get(field)) is int for field in fields) or row["indexTenths"] <= 0:
            raise SnapshotError(f"artefatto: valori non interi o mancanti nel {row['year']}")
        if index == 0 and "annualAverageRateTenths" in row:
            raise SnapshotError("artefatto: tasso inatteso nel primo anno")
        for flag in (row.get("flags") or {}).values():
            if flag not in spec["expected"]["knownFlags"]:
                raise SnapshotError(f"artefatto: flag sconosciuto {flag!r}")
    base = next(row for row in observations if row["year"] == spec["expected"]["baseYear"])
    if base["indexTenths"] != 1000:
        raise SnapshotError("artefatto: l'anno base non vale 100")
    gap = max_rate_gap(observations)
    if gap > spec["expected"]["rateToleranceTenths"] or gap != snapshot["reconciliation"]["maxRateGapTenths"]:
        raise SnapshotError(f"artefatto: tasso incoerente con gli indici (scarto {gap} decimi)")
    coverage = snapshot.get("coverage") or {}
    if coverage.get("observedCells") != spec["expected"]["cells"] or coverage.get("expectedCells") != spec["expected"]["cells"]:
        raise SnapshotError("artefatto: copertura incompleta")
    provenance = snapshot["semantics"]["provenance"]
    asset = spec["source"]["assets"][ASSET]
    if (provenance["url"], provenance["bytes"], provenance["sha256"], provenance["publicationDate"]) != (
        asset["url"], asset["bytes"], asset["sha256"], asset["sourceUpdated"]
    ):
        raise SnapshotError("artefatto: provenienza divergente dal source lock")


def encode(snapshot: dict[str, Any]) -> bytes:
    return (json.dumps(snapshot, ensure_ascii=False, indent=2) + "\n").encode("utf-8")


def main() -> int:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--spec", type=Path, default=DEFAULT_SPEC)
    parser.add_argument("--data", type=Path, default=DEFAULT_DATA)
    parser.add_argument("--input", type=Path, help="risposta JSON-stat scaricata dall'URL del lock")
    parser.add_argument("--write", action="store_true")
    parser.add_argument("--check", action="store_true")
    args = parser.parse_args()
    try:
        spec = load_spec(args.spec)
        if args.check:
            validate_snapshot(json.loads(args.data.read_text(encoding="utf-8")), spec)
            print(f"{DATASET_ID}: lock e artefatto coerenti")
            return 0
        if not args.input:
            raise SnapshotError("serve --input oppure --check")
        payload = encode(build_snapshot(args.input.read_bytes(), spec))
        if args.write:
            args.data.write_bytes(payload)
        print(f"{DATASET_ID}: build ok, {len(payload)} byte" + (", scritto" if args.write else ""))
        return 0
    except (SnapshotError, OSError, json.JSONDecodeError, KeyError, StopIteration) as error:
        print(f"{DATASET_ID}: {error}", file=sys.stderr)
        return 1


if __name__ == "__main__":
    raise SystemExit(main())
