#!/usr/bin/env python3
"""Materialize municipal comparison inputs from committed, locked snapshots."""
from __future__ import annotations

import argparse
import gzip
import hashlib
import io
import json
import os
import shutil
import tempfile
from collections import Counter
from fractions import Fraction
from pathlib import Path

import anac_procurement_cpv as cpv
import istat_municipality_geography as geography

ROOT = Path(__file__).resolve().parents[2]
SPEC = ROOT / "scripts/etl/specs/anac-procurement-peers.source.json"
OUTPUT = ROOT / "src/data/generated/anac-procurement-peers"
INPUTS = {
    "profiles": "src/data/generated/anac-entity-procurement-page/meta.json",
    "cpv": "src/data/generated/anac-procurement-cpv/meta.json",
    "cpvSpec": "scripts/etl/specs/anac-procurement-cpv.source.json",
    "geography": "src/data/generated/istat-municipality-geography.json",
}


def ratio(value: Fraction) -> dict:
    return {"numerator": str(value.numerator), "denominator": str(value.denominator)}


def metrics(weights: list[Fraction], observations: int) -> dict | None:
    weights = sorted((w for w in weights if w > 0), reverse=True)
    total = sum(weights)
    if observations < 30 or not total:
        return None
    return {
        "top1Share": ratio(weights[0] / total),
        "top10Share": ratio(sum(weights[:10]) / total),
        "hhi10000": ratio(sum(w * w for w in weights) * 10000 / (total * total)),
    }


def derive_row(profile: dict, classification: dict, municipality: list) -> dict:
    cpv.validate_record(classification, profile)
    cpv.profiles.validate_record(profile, "peer profile")
    mix = Counter(code[:2] for p in classification["procedures"] if (code := cpv.cpv_code(p["rawCode"])))
    summary, operators = profile["summary"], profile["operators"]
    population = municipality[5]
    if population is not None and (type(population) is not int or population <= 0):
        raise cpv.ContractError("Peers: popolazione non valida")
    if population is not None and municipality[6] != 2024:
        population = None  # Do not mix population years or impute a value.
    value_observations = sum(o["attributedAwardCount"] for o in operators)
    return {
        "codiceIpa": profile["codiceIpa"], "istatCode": municipality[0], "name": municipality[3],
        "population": population, "procedures": summary["procedureCount"],
        "awards": summary["awardCount"], "stableAwards": summary["awardsWithStableAwardees"],
        "positiveAwards": summary["positiveAwardCount"], "valueObservations": value_observations,
        "awardValue": summary["awardValue"], "attributedValue": summary["attributedAwardValue"],
        "mix": dict(sorted(mix.items())),
        "count": metrics([Fraction(o["awardCount"]) for o in operators], summary["awardCount"]),
        "value": metrics([Fraction(o["attributedValue"]) for o in operators], value_observations),
    }


def derive() -> dict:
    spec = cpv.profiles.load_json(SPEC)
    if spec["inputs"] != {key: {"path": path, "sha256": cpv.profiles.sha256_path(ROOT / path)} for key, path in INPUTS.items()}:
        raise cpv.ContractError("Peers: input fuori source lock")
    cpv.check()
    snapshot = cpv.profiles.load_json(ROOT / INPUTS["geography"])
    geography.validate_snapshot(snapshot)
    year = next(y for y in snapshot["years"] if y["year"] == 2025)
    municipalities = {r[1]: r for r in year["rows"] if r[1]}
    parent = cpv.profiles.load_json(ROOT / INPUTS["profiles"])
    rows = []
    for shard in parent["shards"]:
        with gzip.open(cpv.OUTPUT / f"{shard['id']}.jsonl.gz", "rt", encoding="utf-8") as stream:
            classifications = [json.loads(line) for line in stream]
        for profile, classification in zip(cpv.profile_records(shard), classifications, strict=True):
            municipality = municipalities.get(profile["codiceFiscaleEnte"])
            if municipality is not None:
                rows.append(derive_row(profile, classification, municipality))
    # Multiple IPA profiles for one municipality cannot act as independent peers.
    identities = Counter(row["istatCode"] for row in rows)
    ambiguous = sum(identities[row["istatCode"]] != 1 for row in rows)
    rows = sorted((r for r in rows if identities[r["istatCode"]] == 1), key=lambda r: r["codiceIpa"])
    return {"schemaVersion": 1, "dataset": "anac-procurement-peers", "sourceSpecSha256": cpv.profiles.sha256_path(SPEC),
            "municipalProfiles": len(rows), "ambiguousProfilesExcluded": ambiguous,
            "totalProfiles": parent["totals"]["entities"], "rows": rows}


def verify_output(output: Path, raw: bytes) -> None:
    if {p.name for p in output.iterdir()} != {"meta.json", "snapshot.json.gz"}:
        raise cpv.ContractError("Peers: file inattesi o mancanti")
    payload = output / "snapshot.json.gz"
    if payload.is_symlink() or payload.stat().st_size > 4_000_000:
        raise cpv.ContractError("Peers: file oltre budget")
    compressed = payload.read_bytes()
    metadata = {"schemaVersion": 1, "bytes": len(compressed), "rawBytes": len(raw),
                "sha256": hashlib.sha256(compressed).hexdigest()}
    with gzip.open(payload, "rb") as stream:
        observed = stream.read(len(raw) + 1)
    if cpv.profiles.load_json(output / "meta.json") != metadata or observed != raw:
        raise cpv.ContractError("Peers: indice divergente dalla derivazione integrale")


def build(check: bool = False) -> None:
    snapshot = derive()
    raw = (json.dumps(snapshot, ensure_ascii=False, separators=(",", ":")) + "\n").encode()
    if len(raw) > 24_000_000:
        raise cpv.ContractError("Peers: contenuto oltre budget")
    if check:
        verify_output(OUTPUT, raw)
    else:
        stream = io.BytesIO()
        with gzip.GzipFile(fileobj=stream, mode="wb", mtime=0, filename="") as archive:
            archive.write(raw)
        compressed = stream.getvalue()
        metadata = {"schemaVersion": 1, "bytes": len(compressed), "rawBytes": len(raw),
                    "sha256": hashlib.sha256(compressed).hexdigest()}
        OUTPUT.parent.mkdir(parents=True, exist_ok=True)
        with tempfile.TemporaryDirectory(prefix=".anac-peers-", dir=OUTPUT.parent) as temporary:
            staging = Path(temporary) / "output"
            staging.mkdir()
            (staging / "snapshot.json.gz").write_bytes(compressed)
            (staging / "meta.json").write_text(json.dumps(metadata, indent=2) + "\n")
            verify_output(staging, raw)
            backup = cpv.profiles.atomic_publish(staging, OUTPUT)
            try:
                verify_output(OUTPUT, raw)
            except Exception:
                shutil.rmtree(OUTPUT)
                if backup is not None:
                    os.replace(backup, OUTPUT)
                raise
            if backup is not None:
                shutil.rmtree(backup)
    print(f"Peers: {snapshot['municipalProfiles']} Comuni, {snapshot['ambiguousProfilesExcluded']} profili ambigui esclusi; verifica integrale OK")


if __name__ == "__main__":
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--check", action="store_true")
    build(parser.parse_args().check)
