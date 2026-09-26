#!/usr/bin/env python3
"""Source-locked ISTAT 2021 1 km² population grid overview (static aggregates).

Reads the official CSV zip once locally to rebuild the committed overview.
Runtime and CI stay offline: --check validates the committed bundle against the
source lock without network and without requiring the zip in CI.

No refresh workflow: this is a static census foundation, not a live API feed.
"""

from __future__ import annotations

import argparse
import csv
import hashlib
import io
import json
import sys
from collections import Counter
from pathlib import Path
from typing import Any
from zipfile import BadZipFile, ZipFile

ROOT = Path(__file__).resolve().parents[2]
DEFAULT_SPEC = ROOT / "scripts/etl/specs/istat-population-grid-2021.source.json"
DEFAULT_DATA = ROOT / "src/data/generated/istat-population-grid-2021.data.json"
DEFAULT_META = ROOT / "src/data/generated/istat-population-grid-2021.meta.json"
DATASET_ID = "istat-population-grid-2021"
ISTAT_PREFIX = "https://www.istat.it/"
BAND_ORDER = ("0", "1-9", "10-49", "50-99", "100-499", "500-999", "1000-4999", "5000+")
BAND_LABELS = {
    "0": "Celle con popolazione 0",
    "1-9": "1-9 abitanti",
    "10-49": "10-49 abitanti",
    "50-99": "50-99 abitanti",
    "100-499": "100-499 abitanti",
    "500-999": "500-999 abitanti",
    "1000-4999": "1.000-4.999 abitanti",
    "5000+": "5.000 abitanti o più",
}
EXPECTED_COLUMNS = (
    "GRD_ID",
    "CNTR_ID",
    "Pop_Tot",
    "Pop_Tot_M",
    "Pop_Tot_F",
    "Pop_0_15",
    "Pop_15_64",
    "Pop_oltre_65",
    "Nati_Ita",
    "Nati_EU",
    "Nati_Extra_EU",
    "Occupati",
    "Stessa_dimora_1_anno_prima",
    "Altra_dimora_anno_prima_italia",
    "Altra_dimora_anno_prima_estero",
)


class SnapshotError(ValueError):
    """Schema, provenance or aggregate drift blocks publication."""


def sha256_bytes(payload: bytes) -> str:
    return hashlib.sha256(payload).hexdigest()


def canonical_bytes(value: object) -> bytes:
    return json.dumps(value, ensure_ascii=False, sort_keys=True, separators=(",", ":")).encode("utf-8")


def canonical_lock_sha256(lock: dict[str, Any]) -> str:
    clone = json.loads(json.dumps(lock))
    clone["integrity"]["lockSha256"] = ""
    return sha256_bytes(canonical_bytes(clone))


def load_json(path: Path) -> dict[str, Any]:
    try:
        value = json.loads(path.read_text(encoding="utf-8"))
    except (OSError, json.JSONDecodeError) as error:
        raise SnapshotError(f"{path}: JSON non leggibile ({error})") from error
    if not isinstance(value, dict):
        raise SnapshotError(f"{path}: oggetto JSON atteso")
    return value


def load_spec(path: Path = DEFAULT_SPEC) -> dict[str, Any]:
    spec = load_json(path)
    if spec.get("schemaVersion") != 1 or spec.get("datasetId") != DATASET_ID:
        raise SnapshotError("source lock: identità inattesa")
    source = spec.get("source") or {}
    if source.get("licenseId") != "not-declared":
        raise SnapshotError("source lock: licenza deve restare not-declared")
    for key in ("landingUrl", "url", "methodologyUrl"):
        if not str(source.get(key, "")).startswith(ISTAT_PREFIX):
            raise SnapshotError(f"source lock: {key} non ufficiale ISTAT")
    for evidence in source.get("evidenceUrls") or []:
        if not str(evidence).startswith(ISTAT_PREFIX):
            raise SnapshotError("source lock: evidence URL non ufficiale ISTAT")
    if not isinstance(source.get("bytes"), int) or source["bytes"] <= 0:
        raise SnapshotError("source lock: bytes non validi")
    digest = str(source.get("sha256", ""))
    if len(digest) != 64 or set(digest) - set("0123456789abcdef"):
        raise SnapshotError("source lock: sha256 non valido")
    soldi = (spec.get("semantics") or {}).get("soldi") or {}
    if soldi.get("present") is not False:
        raise SnapshotError("source lock: soldi.present deve essere false")
    if list((spec.get("expected") or {}).get("columns") or []) != list(EXPECTED_COLUMNS):
        raise SnapshotError("source lock: colonne attese divergenti")
    if canonical_lock_sha256(spec) != (spec.get("integrity") or {}).get("lockSha256"):
        raise SnapshotError("source lock: lockSha256 divergente")
    return spec


def require_int(value: str, field: str) -> int:
    if value is None or value == "":
        raise SnapshotError(f"{field}: valore mancante")
    try:
        number = int(value)
    except ValueError as error:
        raise SnapshotError(f"{field}: intero non valido") from error
    if number < 0:
        raise SnapshotError(f"{field}: intero negativo")
    return number


def band_id(population: int) -> str:
    if population == 0:
        return "0"
    if population < 10:
        return "1-9"
    if population < 50:
        return "10-49"
    if population < 100:
        return "50-99"
    if population < 500:
        return "100-499"
    if population < 1000:
        return "500-999"
    if population < 5000:
        return "1000-4999"
    return "5000+"


def aggregate_csv(member_bytes: bytes) -> dict[str, Any]:
    text = member_bytes.decode("utf-8-sig")
    reader = csv.DictReader(io.StringIO(text), delimiter=";")
    if reader.fieldnames != list(EXPECTED_COLUMNS):
        raise SnapshotError("CSV: intestazioni inattese")

    bands: Counter[str] = Counter()
    countries: Counter[str] = Counter()
    totals = {
        "cells": 0,
        "cellsWithPopulation": 0,
        "cellsWithZeroPopulation": 0,
        "residentPopulation": 0,
        "malePopulation": 0,
        "femalePopulation": 0,
        "populationFieldPop0_15": 0,
        "populationAge15to64": 0,
        "populationAge65plus": 0,
        "bornInItaly": 0,
        "bornInOtherEuCountry": 0,
        "bornOutsideEu": 0,
        "employed": 0,
        "sameResidenceOneYearEarlier": 0,
        "otherResidenceInItalyOneYearEarlier": 0,
        "otherResidenceAbroadOneYearEarlier": 0,
    }

    for index, row in enumerate(reader, start=2):
        country = str(row.get("CNTR_ID") or "").strip()
        if not country:
            raise SnapshotError(f"riga {index}: CNTR_ID mancante")
        countries[country] += 1
        population = require_int(row["Pop_Tot"], f"riga {index}/Pop_Tot")
        male = require_int(row["Pop_Tot_M"], f"riga {index}/Pop_Tot_M")
        female = require_int(row["Pop_Tot_F"], f"riga {index}/Pop_Tot_F")
        age0 = require_int(row["Pop_0_15"], f"riga {index}/Pop_0_15")
        age15 = require_int(row["Pop_15_64"], f"riga {index}/Pop_15_64")
        age65 = require_int(row["Pop_oltre_65"], f"riga {index}/Pop_oltre_65")
        born_it = require_int(row["Nati_Ita"], f"riga {index}/Nati_Ita")
        born_eu = require_int(row["Nati_EU"], f"riga {index}/Nati_EU")
        born_x = require_int(row["Nati_Extra_EU"], f"riga {index}/Nati_Extra_EU")
        if male + female != population:
            raise SnapshotError(f"riga {index}: sesso non riconciliato")
        if age0 + age15 + age65 != population:
            raise SnapshotError(f"riga {index}: età non riconciliata")
        if born_it + born_eu + born_x != population:
            raise SnapshotError(f"riga {index}: luogo di nascita non riconciliato")

        totals["cells"] += 1
        totals["residentPopulation"] += population
        totals["malePopulation"] += male
        totals["femalePopulation"] += female
        totals["populationFieldPop0_15"] += age0
        totals["populationAge15to64"] += age15
        totals["populationAge65plus"] += age65
        totals["bornInItaly"] += born_it
        totals["bornInOtherEuCountry"] += born_eu
        totals["bornOutsideEu"] += born_x
        totals["employed"] += require_int(row["Occupati"], f"riga {index}/Occupati")
        totals["sameResidenceOneYearEarlier"] += require_int(
            row["Stessa_dimora_1_anno_prima"], f"riga {index}/stessa"
        )
        totals["otherResidenceInItalyOneYearEarlier"] += require_int(
            row["Altra_dimora_anno_prima_italia"], f"riga {index}/italia"
        )
        totals["otherResidenceAbroadOneYearEarlier"] += require_int(
            row["Altra_dimora_anno_prima_estero"], f"riga {index}/estero"
        )
        band = band_id(population)
        bands[band] += 1
        if population == 0:
            totals["cellsWithZeroPopulation"] += 1
        else:
            totals["cellsWithPopulation"] += 1

    if totals["cells"] != totals["cellsWithPopulation"] + totals["cellsWithZeroPopulation"]:
        raise SnapshotError("celle: somma bande zero/positive incoerente")
    if totals["malePopulation"] + totals["femalePopulation"] != totals["residentPopulation"]:
        raise SnapshotError("totali: sesso nazionale non riconciliato")
    if (
        totals["populationFieldPop0_15"]
        + totals["populationAge15to64"]
        + totals["populationAge65plus"]
        != totals["residentPopulation"]
    ):
        raise SnapshotError("totali: età nazionale non riconciliata")
    if (
        totals["bornInItaly"]
        + totals["bornInOtherEuCountry"]
        + totals["bornOutsideEu"]
        != totals["residentPopulation"]
    ):
        raise SnapshotError("totali: luogo di nascita nazionale non riconciliato")

    return {
        "totals": totals,
        "populationBands": [
            {"id": band, "label": BAND_LABELS[band], "cells": bands[band]} for band in BAND_ORDER
        ],
        "borderCells": sorted(
            [{"id": key, "cells": value} for key, value in countries.items()],
            key=lambda item: (-item["cells"], item["id"]),
        ),
        "pins": {
            "cells": totals["cells"],
            "residentPopulation": totals["residentPopulation"],
            "malePopulation": totals["malePopulation"],
            "femalePopulation": totals["femalePopulation"],
            "populationFieldPop0_15": totals["populationFieldPop0_15"],
            "populationAge15to64": totals["populationAge15to64"],
            "populationAge65plus": totals["populationAge65plus"],
            "bornInItaly": totals["bornInItaly"],
            "employed": totals["employed"],
            "cellsWithZeroPopulation": totals["cellsWithZeroPopulation"],
            "bands": {band: bands[band] for band in BAND_ORDER},
        },
    }


def build_overview(spec: dict[str, Any], zip_path: Path, *, observed_at: str) -> dict[str, Any]:
    source = spec["source"]
    payload = zip_path.read_bytes()
    if len(payload) != source["bytes"] or sha256_bytes(payload) != source["sha256"]:
        raise SnapshotError("zip ufficiale: byte o SHA-256 divergenti dal lock")
    try:
        with ZipFile(io.BytesIO(payload)) as archive:
            names = archive.namelist()
            if len(names) != 1:
                raise SnapshotError("zip: un solo membro CSV atteso")
            member_name = names[0]
            member_bytes = archive.read(member_name)
    except BadZipFile as error:
        raise SnapshotError("zip ufficiale non leggibile") from error

    expected_member = source["member"]
    if (
        member_name != expected_member["path"]
        or len(member_bytes) != expected_member["bytes"]
        or sha256_bytes(member_bytes) != expected_member["sha256"]
    ):
        raise SnapshotError("membro CSV: path/byte/hash divergenti dal lock")

    aggregated = aggregate_csv(member_bytes)
    if aggregated["pins"] != (spec.get("expected") or {}).get("pins"):
        raise SnapshotError("aggregati: pin ufficiali divergenti dal lock")

    return {
        "schemaVersion": 1,
        "transformVersion": 1,
        "datasetId": DATASET_ID,
        "observedAt": observed_at,
        "unit": "person-and-cell-count",
        "reference": {
            "censusYear": 2021,
            "cellSizeSquareKilometres": 1,
            "gridSystem": "ETRS89-LAEA Eurostat 1 km (CRS3035)",
            "title": "Popolazione legale del Censimento 2021 sulla griglia regolare 1 km²",
        },
        "totals": aggregated["totals"],
        "populationBands": aggregated["populationBands"],
        "borderCells": aggregated["borderCells"],
        "economicJoins": [
            {
                "id": "istat-misura-comune",
                "label": "A misura di Comune (indicatori demografici comunali)",
                "joinKey": "codice ISTAT comunale a 6 cifre",
                "href": "/dati/istat-misura-comune-vecchiaia",
                "note": (
                    "La griglia 1 km non sostituisce i confini comunali: i join economici "
                    "usano i codici comunali, non gli ID di cella."
                ),
            },
            {
                "id": "territori-siope",
                "label": "Pagamenti comunali su base geografica SITUAS",
                "joinKey": "codice ISTAT / codice fiscale comunale",
                "href": "/territori",
                "note": (
                    "La panoramica Territori usa già la geografia comunale ISTAT SITUAS "
                    "per €/km² e filtri."
                ),
            },
        ],
        "caveats": [
            "Celle di 1 km² sulla griglia europea Eurostat (ETRS89-LAEA); non sono sezioni di censimento né confini comunali.",
            "I totali sono conteggi di persone e celle dalla popolazione legale del Censimento 2021 attribuita alle celle; non sono pagamenti né bilanci.",
            "Il campo ufficiale Pop_0_15 è pubblicato con il nome della fonte; non viene rinominato in un intervallo d’età diverso da quello dichiarato nel CSV.",
            "Le variabili di dimora a un anno non riconciliano sempre con Pop_Tot riga per riga: si pubblicano i soli totali osservati, senza imputazioni.",
            "Le celle di confine (CNTR_ID diversi da IT) restano distinte.",
            "Non si stimano valori per celle assenti dal file né si interpola tra celle.",
            "Simulazioni di policy / digital twin restano fuori scope: questa slice pubblica solo numeri statici ufficiali aggregati.",
        ],
        "provenance": {
            "holder": "Istituto Nazionale di Statistica (ISTAT)",
            "landingUrl": source["landingUrl"],
            "assetUrl": source["url"],
            "methodologyUrl": source["methodologyUrl"],
            "licenseId": "not-declared",
            "asset": {
                "bytes": source["bytes"],
                "sha256": source["sha256"],
                "member": source["member"],
            },
            "methodology": source["methodology"],
            "acquiredAt": observed_at,
        },
    }


def build_meta(spec: dict[str, Any], data: dict[str, Any], data_path: Path) -> dict[str, Any]:
    payload = data_path.read_bytes()
    return {
        "schemaVersion": 1,
        "datasetId": DATASET_ID,
        "generatedAt": data["observedAt"],
        "observedAt": data["observedAt"],
        "source": {
            "holder": data["provenance"]["holder"],
            "landingUrl": data["provenance"]["landingUrl"],
            "assetUrl": data["provenance"]["assetUrl"],
            "methodologyUrl": data["provenance"]["methodologyUrl"],
            "licenseId": "not-declared",
            "acquiredAt": data["provenance"]["acquiredAt"],
            "asset": data["provenance"]["asset"],
            "methodology": data["provenance"]["methodology"],
        },
        "semantics": spec["semantics"],
        "artifact": {
            "path": "src/data/generated/istat-population-grid-2021.data.json",
            "bytes": len(payload),
            "sha256": sha256_bytes(payload),
        },
        "refreshWorkflow": None,
        "runtimeNetwork": False,
    }


def validate_committed(spec: dict[str, Any], data_path: Path = DEFAULT_DATA, meta_path: Path = DEFAULT_META) -> None:
    data = load_json(data_path)
    meta = load_json(meta_path)
    if data.get("datasetId") != DATASET_ID or meta.get("datasetId") != DATASET_ID:
        raise SnapshotError("artifact: datasetId inatteso")
    if data.get("schemaVersion") != 1 or data.get("transformVersion") != 1:
        raise SnapshotError("artifact: versione inattesa")
    if meta.get("refreshWorkflow") is not None:
        raise SnapshotError("meta: nessun refresh workflow ammesso")
    if meta.get("runtimeNetwork") is not False:
        raise SnapshotError("meta: runtimeNetwork deve essere false")

    pins = (spec.get("expected") or {}).get("pins") or {}
    totals = data.get("totals") or {}
    for key in (
        "cells",
        "residentPopulation",
        "malePopulation",
        "femalePopulation",
        "populationFieldPop0_15",
        "populationAge15to64",
        "populationAge65plus",
        "bornInItaly",
        "employed",
        "cellsWithZeroPopulation",
    ):
        if totals.get(key) != pins.get(key):
            raise SnapshotError(f"totals.{key}: pin divergente")
    band_map = {row["id"]: row["cells"] for row in data.get("populationBands") or []}
    if band_map != pins.get("bands"):
        raise SnapshotError("populationBands: pin divergenti")
    if totals["malePopulation"] + totals["femalePopulation"] != totals["residentPopulation"]:
        raise SnapshotError("totals: sesso non riconciliato")
    if (
        totals["populationFieldPop0_15"]
        + totals["populationAge15to64"]
        + totals["populationAge65plus"]
        != totals["residentPopulation"]
    ):
        raise SnapshotError("totals: età non riconciliata")

    payload = data_path.read_bytes()
    artifact = meta.get("artifact") or {}
    if artifact.get("bytes") != len(payload) or artifact.get("sha256") != sha256_bytes(payload):
        raise SnapshotError("meta.artifact: hash/byte non riconciliati")
    source = meta.get("source") or {}
    for key in ("bytes", "sha256"):
        if source.get("asset", {}).get(key) != spec["source"][key]:
            raise SnapshotError(f"meta.source.asset.{key}: divergente dal lock")
    if source.get("asset", {}).get("member") != spec["source"]["member"]:
        raise SnapshotError("meta.source.asset.member: divergente dal lock")


def main(argv: list[str] | None = None) -> int:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--check", action="store_true", help="Valida il bundle committato offline")
    parser.add_argument("--write", action="store_true", help="Rigenera data/meta da zip locale")
    parser.add_argument("--input", type=Path, help="Percorso allo zip ufficiale ISTAT")
    parser.add_argument("--observed-at", default="2026-09-26T07:15:00.000Z")
    parser.add_argument("--spec", type=Path, default=DEFAULT_SPEC)
    parser.add_argument("--data", type=Path, default=DEFAULT_DATA)
    parser.add_argument("--meta", type=Path, default=DEFAULT_META)
    args = parser.parse_args(argv)

    try:
        spec = load_spec(args.spec)
        if args.check and args.write:
            raise SnapshotError("usare --check oppure --write, non entrambi")
        if args.check or not args.write:
            validate_committed(spec, args.data, args.meta)
            if args.check:
                print("istat-population-grid-2021: check OK")
                return 0
        if not args.write:
            raise SnapshotError("specificare --check oppure --write --input <zip>")
        if args.input is None:
            raise SnapshotError("--write richiede --input <zip ufficiale>")
        data = build_overview(spec, args.input, observed_at=args.observed_at)
        args.data.write_text(json.dumps(data, ensure_ascii=False, indent=2) + "\n", encoding="utf-8")
        meta = build_meta(spec, data, args.data)
        args.meta.write_text(json.dumps(meta, ensure_ascii=False, indent=2) + "\n", encoding="utf-8")
        validate_committed(spec, args.data, args.meta)
        print(f"wrote {args.data}")
        print(f"wrote {args.meta}")
        return 0
    except SnapshotError as error:
        print(f"error: {error}", file=sys.stderr)
        return 1


if __name__ == "__main__":
    raise SystemExit(main())
