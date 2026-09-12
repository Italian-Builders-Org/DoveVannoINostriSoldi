#!/usr/bin/env python3
"""Build the source-locked Eurostat GDP snapshot used by /pil.

Inputs are five local JSON-stat 2.0 responses from Eurostat (`namq_10_gdp` and
`nama_10_gdp`). CI and runtime stay offline: URLs, structures, update timestamps,
byte lengths and SHA-256 hashes are pinned in the source lock.

National-accounts GDP is not public-spending cash. Levels are million euro,
growth rates are percentage points, demand components are shares of GDP. The
three natures stay distinct and are never summed across perimeters.
"""
from __future__ import annotations

import argparse
import hashlib
import json
import sys
from decimal import Decimal, InvalidOperation
from pathlib import Path
from typing import Any

ROOT = Path(__file__).resolve().parents[2]
DEFAULT_SPEC = ROOT / "scripts/etl/specs/eurostat-gdp-2015-2026.source.json"
DEFAULT_DATA = ROOT / "src/data/generated/eurostat-gdp-2015-2026.data.json"
DEFAULT_META = ROOT / "src/data/generated/eurostat-gdp-2015-2026.meta.json"
DATASET_ID = "eurostat-gdp"
OFFICIAL_PREFIX = "https://ec.europa.eu/eurostat/"

CAVEATS = (
    "Il PIL Eurostat SEC 2010 è competenza economica nei conti nazionali: non è cassa SIOPE, non è uno stanziamento di bilancio e non è spendibile come totale della PA.",
    "Livelli in milioni di euro, variazioni percentuali e quote sul PIL sono tre nature distinte: non si sommano fra loro.",
    "I volumi a prezzi concatenati usano la base 2020 (CLV20_MEUR). Un confronto di livello con una base diversa non è pubblicato qui.",
    "Le componenti della domanda (consumi P3, investimenti P51G, esportazioni P6, importazioni P7) sono quote ufficiali sul PIL: non ricostruiscono da sole la crescita e non includono scorte né altre voci.",
    "Il confronto con Francia, Germania e Spagna vale solo a parità di dataset Eurostat e di destagionalizzazione SCA.",
    "Differenze tra paesi o periodi non sono attribuite automaticamente al governo in carica.",
)

QUARTERLY_PERIODS = [
    f"{year}-Q{quarter}"
    for year in range(2015, 2027)
    for quarter in range(1, 5)
    if not (year == 2026 and quarter > 2)
]
PEER_PERIODS = [period for period in QUARTERLY_PERIODS if period >= "2019-Q1"]
ANNUAL_PERIODS = [str(year) for year in range(2015, 2026)]
PEER_GEOS = ["DE", "ES", "FR", "IT"]
COMPONENT_ITEMS = ["P3", "P51G", "P6", "P7"]


class SnapshotError(ValueError):
    pass


def sha256_bytes(payload: bytes) -> str:
    return hashlib.sha256(payload).hexdigest()


def canonical_bytes(value: object) -> bytes:
    return json.dumps(value, ensure_ascii=False, sort_keys=True, separators=(",", ":")).encode("utf-8")


def canonical_lock_sha256(lock: dict[str, Any]) -> str:
    clone = json.loads(json.dumps(lock))
    clone["integrity"]["lockSha256"] = ""
    return sha256_bytes(canonical_bytes(clone))


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
    for field in ("landingUrl", "annualLandingUrl", "informationUrl", "termsUrl"):
        if not str(source.get(field, "")).startswith(OFFICIAL_PREFIX):
            raise SnapshotError(f"source lock: {field} non ufficiale Eurostat")
    assets = source.get("assets")
    if not isinstance(assets, dict) or set(assets) != {
        "italy-levels",
        "italy-growth",
        "peers-growth",
        "italy-components",
        "italy-annual",
    }:
        raise SnapshotError("source lock: set asset inatteso")
    for name, asset in assets.items():
        if not str(asset.get("url", "")).startswith(OFFICIAL_PREFIX):
            raise SnapshotError(f"source lock: URL asset {name} non ufficiale")
        if not isinstance(asset.get("bytes"), int) or asset["bytes"] <= 0:
            raise SnapshotError(f"source lock: bytes non validi per {name}")
        digest = str(asset.get("sha256", ""))
        if len(digest) != 64 or set(digest) - set("0123456789abcdef"):
            raise SnapshotError(f"source lock: sha256 non valido per {name}")
        structure = asset.get("structure") or {}
        if structure.get("agencyId") != "ESTAT" or not structure.get("id") or not structure.get("version"):
            raise SnapshotError(f"source lock: struttura incompleta per {name}")
    return spec


def scaled_int(value: object, scale: int, where: str) -> int:
    try:
        decimal = Decimal(str(value))
    except (InvalidOperation, ValueError) as error:
        raise SnapshotError(f"{where}: valore non numerico {value!r}") from error
    scaled = decimal * scale
    if scaled != scaled.to_integral_value():
        raise SnapshotError(f"{where}: precisione {value!r} oltre quella pubblicabile")
    return int(scaled)


def parse_bundle(payload: bytes, name: str, spec: dict[str, Any]) -> dict[str, Any]:
    try:
        doc = json.loads(payload.decode("utf-8"))
    except (UnicodeDecodeError, json.JSONDecodeError) as error:
        raise SnapshotError(f"{name}: JSON-stat illeggibile") from error
    asset = spec["source"]["assets"][name]
    if doc.get("class") != "dataset" or doc.get("version") != "2.0" or doc.get("source") != "ESTAT":
        raise SnapshotError(f"{name}: non è il dataset JSON-stat 2.0 Eurostat atteso")
    if doc.get("updated") != asset["sourceUpdated"]:
        raise SnapshotError(f"{name}: source updated divergente dal lock")
    structure = doc.get("extension", {}).get("datastructure", {})
    if {key: str(structure.get(key)) for key in ("id", "agencyId", "version")} != {
        key: str(asset["structure"][key]) for key in ("id", "agencyId", "version")
    }:
        raise SnapshotError(f"{name}: struttura SDMX divergente dal lock")
    return doc


def ordered_codes(doc: dict[str, Any], dimension: str) -> list[str]:
    index = doc["dimension"][dimension]["category"]["index"]
    return sorted(index, key=index.get)


def require_codes(doc: dict[str, Any], dimension: str, expected: list[str], where: str) -> None:
    actual = ordered_codes(doc, dimension)
    if actual != expected:
        raise SnapshotError(f"{where}: {dimension} {actual!r}, atteso {expected!r}")


def flat_index(doc: dict[str, Any], coordinates: dict[str, str]) -> str:
    offset = 0
    for dim, size in zip(doc["id"], doc["size"], strict=True):
        try:
            position = doc["dimension"][dim]["category"]["index"][coordinates[dim]]
        except KeyError as error:
            raise SnapshotError(f"cella: coordinata {dim} mancante") from error
        offset = offset * size + position
    return str(offset)


def source_cell(doc: dict[str, Any], coordinates: dict[str, str], where: str) -> tuple[object, str | None]:
    key = flat_index(doc, coordinates)
    values = doc.get("value") or {}
    if key not in values:
        raise SnapshotError(f"{where}: cella assente nella fonte")
    return values[key], (doc.get("status") or {}).get(key)


def validate_flag(flag: str | None, known: list[str], where: str) -> str | None:
    if flag is not None and flag not in known:
        raise SnapshotError(f"{where}: flag Eurostat sconosciuto {flag!r}")
    return flag


def build_data(inputs: dict[str, bytes], spec: dict[str, Any]) -> dict[str, Any]:
    docs = {name: parse_bundle(payload, name, spec) for name, payload in inputs.items()}
    known_flags = list(spec["expected"]["knownFlags"])
    expected = spec["expected"]

    levels = docs["italy-levels"]
    require_codes(levels, "freq", ["Q"], "italy-levels")
    require_codes(levels, "unit", ["CP_MEUR", "CLV20_MEUR"], "italy-levels")
    require_codes(levels, "s_adj", ["SCA"], "italy-levels")
    require_codes(levels, "na_item", ["B1GQ"], "italy-levels")
    require_codes(levels, "geo", ["IT"], "italy-levels")
    require_codes(levels, "time", expected["quarterlyPeriods"], "italy-levels")

    growth = docs["italy-growth"]
    require_codes(growth, "freq", ["Q"], "italy-growth")
    require_codes(growth, "unit", ["CLV_PCH_PRE", "CLV_PCH_SM"], "italy-growth")
    require_codes(growth, "s_adj", ["SCA"], "italy-growth")
    require_codes(growth, "na_item", ["B1GQ"], "italy-growth")
    require_codes(growth, "geo", ["IT"], "italy-growth")
    require_codes(growth, "time", expected["quarterlyPeriods"], "italy-growth")

    peers = docs["peers-growth"]
    require_codes(peers, "freq", ["Q"], "peers-growth")
    require_codes(peers, "unit", ["CLV_PCH_SM"], "peers-growth")
    require_codes(peers, "s_adj", ["SCA"], "peers-growth")
    require_codes(peers, "na_item", ["B1GQ"], "peers-growth")
    require_codes(peers, "geo", expected["peerGeos"], "peers-growth")
    require_codes(peers, "time", expected["peerPeriods"], "peers-growth")

    components = docs["italy-components"]
    require_codes(components, "freq", ["Q"], "italy-components")
    require_codes(components, "unit", ["PC_GDP"], "italy-components")
    require_codes(components, "s_adj", ["SCA"], "italy-components")
    require_codes(components, "na_item", expected["componentItems"], "italy-components")
    require_codes(components, "geo", ["IT"], "italy-components")
    require_codes(components, "time", expected["quarterlyPeriods"], "italy-components")

    annual = docs["italy-annual"]
    require_codes(annual, "freq", ["A"], "italy-annual")
    require_codes(annual, "unit", ["CP_MEUR", "CLV20_MEUR", "CLV_PCH_PRE"], "italy-annual")
    require_codes(annual, "na_item", ["B1GQ"], "italy-annual")
    require_codes(annual, "geo", ["IT"], "italy-annual")
    require_codes(annual, "time", expected["annualPeriods"], "italy-annual")

    quarterly_observations: list[dict[str, Any]] = []
    flagged = 0
    for period in expected["quarterlyPeriods"]:
        row: dict[str, Any] = {"period": period}
        flags: dict[str, str] = {}
        for unit, field, scale in (
            ("CP_MEUR", "nominalMillionEuroTenths", 10),
            ("CLV20_MEUR", "realMillionEuroTenths", 10),
        ):
            raw, flag = source_cell(
                levels,
                {"freq": "Q", "unit": unit, "s_adj": "SCA", "na_item": "B1GQ", "geo": "IT", "time": period},
                f"livello {period}/{unit}",
            )
            row[field] = scaled_int(raw, scale, f"livello {period}/{unit}")
            flag = validate_flag(flag, known_flags, f"livello {period}/{unit}")
            if flag:
                flags[field] = flag
                flagged += 1
        for unit, field, scale in (
            ("CLV_PCH_SM", "yoyGrowthTenths", 10),
            ("CLV_PCH_PRE", "qoqGrowthTenths", 10),
        ):
            raw, flag = source_cell(
                growth,
                {"freq": "Q", "unit": unit, "s_adj": "SCA", "na_item": "B1GQ", "geo": "IT", "time": period},
                f"crescita {period}/{unit}",
            )
            row[field] = scaled_int(raw, scale, f"crescita {period}/{unit}")
            flag = validate_flag(flag, known_flags, f"crescita {period}/{unit}")
            if flag:
                flags[field] = flag
                flagged += 1
        component_row: dict[str, int] = {}
        for item, field in (
            ("P3", "finalConsumptionShareTenths"),
            ("P51G", "grossFixedCapitalFormationShareTenths"),
            ("P6", "exportsShareTenths"),
            ("P7", "importsShareTenths"),
        ):
            raw, flag = source_cell(
                components,
                {"freq": "Q", "unit": "PC_GDP", "s_adj": "SCA", "na_item": item, "geo": "IT", "time": period},
                f"componente {period}/{item}",
            )
            component_row[field] = scaled_int(raw, 10, f"componente {period}/{item}")
            flag = validate_flag(flag, known_flags, f"componente {period}/{item}")
            if flag:
                flags[field] = flag
                flagged += 1
        row.update(component_row)
        if flags:
            row["flags"] = flags
        quarterly_observations.append(row)

    peer_observations: list[dict[str, Any]] = []
    for geo in expected["peerGeos"]:
        for period in expected["peerPeriods"]:
            raw, flag = source_cell(
                peers,
                {"freq": "Q", "unit": "CLV_PCH_SM", "s_adj": "SCA", "na_item": "B1GQ", "geo": geo, "time": period},
                f"peer {geo}/{period}",
            )
            entry: dict[str, Any] = {
                "geo": geo,
                "period": period,
                "yoyGrowthTenths": scaled_int(raw, 10, f"peer {geo}/{period}"),
            }
            flag = validate_flag(flag, known_flags, f"peer {geo}/{period}")
            if flag:
                entry["flag"] = flag
                flagged += 1
            peer_observations.append(entry)

    annual_observations: list[dict[str, Any]] = []
    for period in expected["annualPeriods"]:
        row = {"period": period}
        flags = {}
        for unit, field, scale in (
            ("CP_MEUR", "nominalMillionEuroTenths", 10),
            ("CLV20_MEUR", "realMillionEuroTenths", 10),
            ("CLV_PCH_PRE", "yoyGrowthTenths", 10),
        ):
            raw, flag = source_cell(
                annual,
                {"freq": "A", "unit": unit, "na_item": "B1GQ", "geo": "IT", "time": period},
                f"annuale {period}/{unit}",
            )
            row[field] = scaled_int(raw, scale, f"annuale {period}/{unit}")
            flag = validate_flag(flag, known_flags, f"annuale {period}/{unit}")
            if flag:
                flags[field] = flag
                flagged += 1
        if flags:
            row["flags"] = flags
        annual_observations.append(row)

    expected_cells = (
        len(expected["quarterlyPeriods"]) * 8
        + len(expected["peerGeos"]) * len(expected["peerPeriods"])
        + len(expected["annualPeriods"]) * 3
    )
    observed_cells = expected_cells
    return {
        "schemaVersion": 1,
        "datasetId": DATASET_ID,
        "period": dict(spec["period"]),
        "caveats": list(CAVEATS),
        "flags": known_flags,
        "units": {
            "levels": "tenths of million euro",
            "growth": "tenths of a percentage point",
            "shares": "tenths of a percentage point of GDP",
        },
        "geographies": [
            {"code": "IT", "label": "Italia", "kind": "country"},
            {"code": "FR", "label": "Francia", "kind": "country"},
            {"code": "DE", "label": "Germania", "kind": "country"},
            {"code": "ES", "label": "Spagna", "kind": "country"},
        ],
        "quarterlyObservations": quarterly_observations,
        "peerObservations": peer_observations,
        "annualObservations": annual_observations,
        "coverage": {
            "expectedCells": expected_cells,
            "observedCells": observed_cells,
            "flaggedCells": flagged,
        },
    }


def validate_data(data: dict[str, Any], spec: dict[str, Any]) -> None:
    if data.get("schemaVersion") != 1 or data.get("datasetId") != DATASET_ID or data.get("period") != spec["period"]:
        raise SnapshotError("data artifact: identità o periodo inatteso")
    if list(data.get("caveats") or []) != list(CAVEATS):
        raise SnapshotError("data artifact: caveat divergenti")
    expected = spec["expected"]
    if [row["period"] for row in data.get("quarterlyObservations", [])] != expected["quarterlyPeriods"]:
        raise SnapshotError("data artifact: periodi trimestrali divergenti")
    if [row["period"] for row in data.get("annualObservations", [])] != expected["annualPeriods"]:
        raise SnapshotError("data artifact: periodi annuali divergenti")
    if len(data.get("peerObservations", [])) != len(expected["peerGeos"]) * len(expected["peerPeriods"]):
        raise SnapshotError("data artifact: peer incompleti")
    for row in data["quarterlyObservations"]:
        for field in (
            "nominalMillionEuroTenths",
            "realMillionEuroTenths",
            "yoyGrowthTenths",
            "qoqGrowthTenths",
            "finalConsumptionShareTenths",
            "grossFixedCapitalFormationShareTenths",
            "exportsShareTenths",
            "importsShareTenths",
        ):
            if not isinstance(row.get(field), int) or isinstance(row.get(field), bool):
                raise SnapshotError(f"data artifact: campo {field} non intero in {row.get('period')}")
    if data.get("coverage", {}).get("expectedCells") != data.get("coverage", {}).get("observedCells"):
        raise SnapshotError("data artifact: copertura incompleta")


def build_metadata(spec: dict[str, Any], data: dict[str, Any], data_bytes: bytes) -> dict[str, Any]:
    source = spec["source"]
    updated = sorted({asset["sourceUpdated"] for asset in source["assets"].values()})
    return {
        "schemaVersion": 1,
        "datasetId": DATASET_ID,
        "period": dict(spec["period"]),
        "referencePeriod": (
            f"trimestrale Italia {spec['period']['quarterly']['from']}/{spec['period']['quarterly']['to']}; "
            f"annuale Italia {spec['period']['annual']['from']}/{spec['period']['annual']['to']}; "
            f"peer {spec['period']['peers']['from']}/{spec['period']['peers']['to']}"
        ),
        "observedAt": spec["coverage"]["observedAt"],
        "source": {
            "owner": source["owner"],
            "landingUrl": source["landingUrl"],
            "annualLandingUrl": source["annualLandingUrl"],
            "informationUrl": source["informationUrl"],
            "licenseId": source["licenseId"],
            "licenseNote": source["licenseNote"],
            "termsUrl": source["termsUrl"],
            "acquisition": dict(source["acquisition"]),
            "assets": {key: dict(value) for key, value in source["assets"].items()},
        },
        "coverage": dict(spec["coverage"]),
        "semantics": {
            "soldi": {
                "applicable": True,
                "unit": "milioni di euro (livelli); punti percentuali (variazioni e quote sul PIL)",
                "nature": "conti nazionali SEC 2010 (competenza economica), non cassa pubblica",
                "note": "Nessun totale SIOPE, stanziamento o missione di bilancio viene derivato da queste serie.",
            },
            "periodo": {
                "referencePeriod": (
                    f"trimestrale {spec['period']['quarterly']['from']}/{spec['period']['quarterly']['to']}; "
                    f"annuale {spec['period']['annual']['from']}/{spec['period']['annual']['to']}"
                ),
                "note": "Ogni blocco conserva il periodo realmente disponibile nella risposta Eurostat acquisita.",
            },
            "provenance": {
                "holder": source["owner"],
                "canonicalUrls": [source["landingUrl"], source["annualLandingUrl"], source["informationUrl"]]
                + [asset["url"] for asset in source["assets"].values()],
                "publicationDate": updated[-1],
                "acquisitionDate": source["acquisition"]["acquiredAt"],
                "checkedAt": source["acquisition"]["checkedAt"],
                "license": source["licenseId"],
                "hashes": "SHA-256 per ciascuna risposta JSON-stat nel source lock e per l'artefatto normalizzato",
            },
        },
        "integrity": {
            "algorithm": "sha256",
            "canonicalization": "UTF-8 JSON, chiavi ordinate, separatori compatti",
            "dataArtifact": {
                "path": spec["integrity"]["dataArtifact"]["path"],
                "bytes": len(data_bytes),
                "sha256": sha256_bytes(data_bytes),
            },
            "sourceLockSha256": canonical_lock_sha256(spec),
        },
    }


def check(spec_path: Path, data_path: Path, meta_path: Path) -> None:
    spec = load_spec(spec_path)
    if spec["integrity"]["lockSha256"] != canonical_lock_sha256(spec):
        raise SnapshotError("lockSha256 non corrisponde al source lock")
    data_bytes = data_path.read_bytes()
    data = json.loads(data_bytes)
    validate_data(data, spec)
    meta = json.loads(meta_path.read_text(encoding="utf-8"))
    artifact = meta.get("integrity", {}).get("dataArtifact", {})
    if artifact.get("bytes") != len(data_bytes) or artifact.get("sha256") != sha256_bytes(data_bytes):
        raise SnapshotError("meta: hash o byte del data artifact divergenti")
    if artifact != spec["integrity"]["dataArtifact"]:
        raise SnapshotError("data artifact: hash, byte o percorso divergenti dal source lock")
    if meta.get("integrity", {}).get("sourceLockSha256") != spec["integrity"]["lockSha256"]:
        raise SnapshotError("meta: sourceLockSha256 divergente")
    if meta.get("datasetId") != DATASET_ID or meta.get("period") != spec["period"]:
        raise SnapshotError("meta: identità o periodo divergente")
    if meta != build_metadata(spec, data, data_bytes):
        raise SnapshotError("meta: provenance o semantica divergenti dal source lock")


def bootstrap_spec(inputs: dict[str, bytes]) -> dict[str, Any]:
    docs = {name: json.loads(payload) for name, payload in inputs.items()}
    assets = {}
    filenames = {
        "italy-levels": "namq_10_gdp-italy-levels.json",
        "italy-growth": "namq_10_gdp-italy-growth.json",
        "peers-growth": "namq_10_gdp-peers-growth.json",
        "italy-components": "namq_10_gdp-italy-components.json",
        "italy-annual": "nama_10_gdp-italy-annual.json",
    }
    urls = {
        "italy-levels": "https://ec.europa.eu/eurostat/api/dissemination/statistics/1.0/data/namq_10_gdp?format=JSON&lang=EN&freq=Q&unit=CP_MEUR&unit=CLV20_MEUR&s_adj=SCA&na_item=B1GQ&geo=IT&sinceTimePeriod=2015-Q1",
        "italy-growth": "https://ec.europa.eu/eurostat/api/dissemination/statistics/1.0/data/namq_10_gdp?format=JSON&lang=EN&freq=Q&unit=CLV_PCH_SM&unit=CLV_PCH_PRE&s_adj=SCA&na_item=B1GQ&geo=IT&sinceTimePeriod=2015-Q1",
        "peers-growth": "https://ec.europa.eu/eurostat/api/dissemination/statistics/1.0/data/namq_10_gdp?format=JSON&lang=EN&freq=Q&unit=CLV_PCH_SM&s_adj=SCA&na_item=B1GQ&geo=IT&geo=FR&geo=DE&geo=ES&sinceTimePeriod=2019-Q1",
        "italy-components": "https://ec.europa.eu/eurostat/api/dissemination/statistics/1.0/data/namq_10_gdp?format=JSON&lang=EN&freq=Q&unit=PC_GDP&s_adj=SCA&na_item=P3&na_item=P51G&na_item=P6&na_item=P7&geo=IT&sinceTimePeriod=2015-Q1",
        "italy-annual": "https://ec.europa.eu/eurostat/api/dissemination/statistics/1.0/data/nama_10_gdp?format=JSON&lang=EN&freq=A&unit=CP_MEUR&unit=CLV20_MEUR&unit=CLV_PCH_PRE&na_item=B1GQ&geo=IT&sinceTimePeriod=2015",
    }
    for name, payload in inputs.items():
        doc = docs[name]
        structure = doc["extension"]["datastructure"]
        assets[name] = {
            "filename": filenames[name],
            "datasetCode": "nama_10_gdp" if name == "italy-annual" else "namq_10_gdp",
            "url": urls[name],
            "bytes": len(payload),
            "sha256": sha256_bytes(payload),
            "sourceUpdated": doc["updated"],
            "structure": {
                "id": structure["id"],
                "agencyId": structure["agencyId"],
                "version": structure["version"],
            },
        }
    return {
        "schemaVersion": 1,
        "datasetId": DATASET_ID,
        "period": {
            "quarterly": {"from": QUARTERLY_PERIODS[0], "to": QUARTERLY_PERIODS[-1]},
            "annual": {"from": ANNUAL_PERIODS[0], "to": ANNUAL_PERIODS[-1]},
            "peers": {"from": PEER_PERIODS[0], "to": PEER_PERIODS[-1]},
        },
        "source": {
            "owner": "Eurostat (Commissione europea)",
            "landingUrl": "https://ec.europa.eu/eurostat/databrowser/view/namq_10_gdp/default/table?lang=en",
            "annualLandingUrl": "https://ec.europa.eu/eurostat/databrowser/view/nama_10_gdp/default/table?lang=en",
            "informationUrl": "https://ec.europa.eu/eurostat/web/national-accounts/information-data",
            "licenseId": "CC-BY-4.0",
            "licenseNote": "Eurostat copyright notice: dati Eurostat riutilizzabili sotto Creative Commons Attribution 4.0 International con attribuzione e indicazione delle modifiche; verifica del 2026-09-12.",
            "termsUrl": "https://ec.europa.eu/eurostat/web/main/help/copyright-notice",
            "assets": assets,
            "acquisition": {"acquiredAt": "2026-09-12", "checkedAt": "2026-09-12"},
        },
        "expected": {
            "knownFlags": ["p"],
            "quarterlyPeriods": QUARTERLY_PERIODS,
            "peerPeriods": PEER_PERIODS,
            "annualPeriods": ANNUAL_PERIODS,
            "peerGeos": PEER_GEOS,
            "componentItems": COMPONENT_ITEMS,
        },
        "coverage": {
            "observedAt": "2026-09-12",
            "note": "Trimestrale Italia e peer fino al 2026-Q2; annuale Italia fino al 2025.",
        },
        "integrity": {
            "lockSha256": "",
            "dataArtifact": {
                "path": "src/data/generated/eurostat-gdp-2015-2026.data.json",
                "bytes": 0,
                "sha256": "",
            },
        },
    }


def main() -> int:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--spec", type=Path, default=DEFAULT_SPEC)
    parser.add_argument("--data", type=Path, default=DEFAULT_DATA)
    parser.add_argument("--meta", type=Path, default=DEFAULT_META)
    parser.add_argument("--input-dir", type=Path)
    parser.add_argument("--write", action="store_true")
    parser.add_argument("--check", action="store_true")
    parser.add_argument("--bootstrap", action="store_true", help="crea il source lock iniziale dagli input")
    args = parser.parse_args()
    try:
        if args.check:
            check(args.spec, args.data, args.meta)
            print("eurostat-gdp: lock, data e meta coerenti")
            return 0
        if args.input_dir is None:
            raise SnapshotError("serve --input-dir oppure --check")
        names = {
            "italy-levels": "italy-levels.json",
            "italy-growth": "italy-growth.json",
            "peers-growth": "peers-growth.json",
            "italy-components": "italy-components.json",
            "italy-annual": "italy-annual.json",
        }
        inputs: dict[str, bytes] = {}
        for name, filename in names.items():
            path = args.input_dir / filename
            if not path.is_file():
                raise SnapshotError(f"input mancante: {path}")
            inputs[name] = path.read_bytes()
        if args.bootstrap or not args.spec.is_file():
            spec = bootstrap_spec(inputs)
        else:
            spec = load_spec(args.spec)
            for name, asset in spec["source"]["assets"].items():
                payload = inputs[name]
                if len(payload) != asset["bytes"] or sha256_bytes(payload) != asset["sha256"]:
                    raise SnapshotError(f"input {name}: byte/hash diversi dal lock")
        data = build_data(inputs, spec)
        validate_data(data, spec)
        data_bytes = canonical_bytes(data)
        if not args.write:
            print(f"eurostat-gdp: build ok, {data['coverage']['observedCells']} celle, {len(data_bytes)} byte")
            return 0
        args.data.parent.mkdir(parents=True, exist_ok=True)
        args.data.write_bytes(data_bytes)
        spec["integrity"]["dataArtifact"]["bytes"] = len(data_bytes)
        spec["integrity"]["dataArtifact"]["sha256"] = sha256_bytes(data_bytes)
        spec["integrity"]["lockSha256"] = canonical_lock_sha256(spec)
        args.spec.parent.mkdir(parents=True, exist_ok=True)
        args.spec.write_text(json.dumps(spec, ensure_ascii=False, indent=2) + "\n", encoding="utf-8")
        meta = build_metadata(spec, data, data_bytes)
        args.meta.write_text(json.dumps(meta, ensure_ascii=False, sort_keys=True, indent=2) + "\n", encoding="utf-8")
        # rename input files to lock filenames for local archive convenience
        for name, asset in spec["source"]["assets"].items():
            target = args.input_dir / asset["filename"]
            source = args.input_dir / names[name]
            if source.resolve() != target.resolve():
                target.write_bytes(inputs[name])
        print(f"eurostat-gdp: scritti {args.data.name} e {args.meta.name}, lock aggiornato")
        return 0
    except (SnapshotError, OSError, json.JSONDecodeError) as error:
        print(f"eurostat-gdp: {error}", file=sys.stderr)
        return 1


if __name__ == "__main__":
    raise SystemExit(main())
