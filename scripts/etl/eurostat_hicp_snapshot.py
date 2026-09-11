#!/usr/bin/env python3
"""Build the source-locked Eurostat HICP snapshot used by /inflazione.

Inputs are four local JSON-stat 2.0 responses from Eurostat. CI and runtime stay
offline: URLs, structures, update timestamps, byte lengths and SHA-256 hashes are
pinned in the source spec. Prices are not public spending, so the metadata says
explicitly that the "soldi" axis is not applicable rather than inventing a
monetary meaning.
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
DEFAULT_SPEC = ROOT / "scripts/etl/specs/eurostat-hicp-2022-2026.source.json"
DEFAULT_DATA = ROOT / "src/data/generated/eurostat-hicp-2022-2026.data.json"
DEFAULT_META = ROOT / "src/data/generated/eurostat-hicp-2022-2026.meta.json"
DATASET_ID = "eurostat-hicp"
OFFICIAL_PREFIX = "https://ec.europa.eu/eurostat/"
TARGET_WEIGHT = 100_000  # 1000.00 per mille, stored in hundredths.

CAVEATS = (
    "L'IPCA misura i prezzi dei consumi delle famiglie con metodologia armonizzata europea: non è spesa pubblica, non è un pagamento SIOPE e non è uno stanziamento di bilancio.",
    "Il tasso annuo confronta un mese con lo stesso mese dell'anno precedente; il tasso mensile confronta con il mese precedente. Un tasso non è il livello dell'indice.",
    "Le 13 divisioni ECOICOP v2 mostrano variazione annua e peso nel paniere. Non vengono sommate come 'contributi' italiani: Eurostat pubblica contributi ufficiali all'inflazione annua per l'area euro, non una decomposizione additiva equivalente per l'Italia in questo snapshot.",
    "Il totale Italia è disponibile fino ad agosto 2026; al controllo del 10 settembre 2026 UE27 e divisioni italiane complete arrivavano a luglio 2026. Ogni blocco mantiene quindi il proprio periodo reale.",
    "IPCA, NIC e FOI sono indici diversi per popolazione di riferimento e finalità. Questo snapshot non sostituisce le serie nazionali ISTAT.",
    "Differenze tra paesi o periodi non dimostrano da sole una causa politica o l'effetto di un singolo governo.",
)

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
    for field in ("landingUrl", "weightsLandingUrl", "informationUrl", "termsUrl"):
        if not str(source.get(field, "")).startswith(OFFICIAL_PREFIX):
            raise SnapshotError(f"source lock: {field} non ufficiale Eurostat")
    assets = source.get("assets")
    if not isinstance(assets, dict) or set(assets) != {"italy-total", "comparison", "divisions", "weights"}:
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


def validate_flag(flag: str | None, spec: dict[str, Any], where: str) -> str | None:
    if flag is not None and flag not in spec["expected"]["knownFlags"]:
        raise SnapshotError(f"{where}: flag Eurostat sconosciuto {flag!r}")
    return flag


def build_data(inputs: dict[str, bytes], spec: dict[str, Any]) -> dict[str, Any]:
    docs = {name: parse_bundle(payload, name, spec) for name, payload in inputs.items()}
    expected = spec["expected"]
    total = docs["italy-total"]
    require_codes(total, "freq", ["M"], "italy-total")
    require_codes(total, "unit", ["I25", "RCH_M", "RCH_A"], "italy-total")
    require_codes(total, "coicop18", [expected["total"]["coicop18"]], "italy-total")
    require_codes(total, "geo", [expected["total"]["geo"]], "italy-total")
    require_codes(total, "time", expected["total"]["periods"], "italy-total")

    total_observations = []
    total_flagged = 0
    for period in expected["total"]["periods"]:
        row: dict[str, Any] = {"period": period}
        flags: dict[str, str] = {}
        for unit, field, scale in (
            ("I25", "indexHundredths", 100),
            ("RCH_A", "annualRateTenths", 10),
            ("RCH_M", "monthlyRateTenths", 10),
        ):
            raw, flag = source_cell(total, {"freq":"M","unit":unit,"coicop18":"TOTAL","geo":"IT","time":period}, f"Italia {period}/{unit}")
            row[field] = scaled_int(raw, scale, f"Italia {period}/{unit}")
            flag = validate_flag(flag, spec, f"Italia {period}/{unit}")
            if flag:
                flags[field] = flag
                total_flagged += 1
        if flags:
            row["flags"] = flags
        total_observations.append(row)

    comparison = docs["comparison"]
    geographies = expected["comparison"]["geographies"]
    require_codes(comparison, "freq", ["M"], "comparison")
    require_codes(comparison, "unit", ["RCH_A"], "comparison")
    require_codes(comparison, "coicop18", ["TOTAL"], "comparison")
    require_codes(comparison, "geo", [g["code"] for g in geographies], "comparison")
    require_codes(comparison, "time", [expected["comparison"]["period"]], "comparison")
    comparison_rows = []
    for geo in geographies:
        raw, flag = source_cell(comparison, {"freq":"M","unit":"RCH_A","coicop18":"TOTAL","geo":geo["code"],"time":expected["comparison"]["period"]}, f"confronto {geo['code']}")
        flag = validate_flag(flag, spec, f"confronto {geo['code']}")
        row = {"geo":geo["code"],"period":expected["comparison"]["period"],"annualRateTenths":scaled_int(raw,10,f"confronto {geo['code']}")}
        if flag: row["flag"] = flag
        comparison_rows.append(row)

    divisions_doc = docs["divisions"]
    division_items = expected["divisions"]["items"]
    require_codes(divisions_doc, "freq", ["M"], "divisions")
    require_codes(divisions_doc, "unit", ["RCH_A"], "divisions")
    require_codes(divisions_doc, "coicop18", [d["code"] for d in division_items], "divisions")
    require_codes(divisions_doc, "geo", ["IT"], "divisions")
    require_codes(divisions_doc, "time", [expected["divisions"]["period"]], "divisions")
    division_rows = []
    for item in division_items:
        code = item["code"]
        raw, flag = source_cell(divisions_doc, {"freq":"M","unit":"RCH_A","coicop18":code,"geo":"IT","time":expected["divisions"]["period"]}, f"divisione {code}")
        flag = validate_flag(flag, spec, f"divisione {code}")
        row = {"code":code,"period":expected["divisions"]["period"],"annualRateTenths":scaled_int(raw,10,f"divisione {code}")}
        if flag: row["flag"] = flag
        division_rows.append(row)

    weights_doc = docs["weights"]
    weight_expected = expected["weights"]
    require_codes(weights_doc, "freq", ["A"], "weights")
    require_codes(weights_doc, "coicop18", [d["code"] for d in weight_expected["items"]], "weights")
    require_codes(weights_doc, "statinfo", ["IW"], "weights")
    require_codes(weights_doc, "geo", ["IT"], "weights")
    require_codes(weights_doc, "time", [str(y) for y in weight_expected["years"]], "weights")
    weights = []
    gaps: dict[str, int] = {}
    for year in weight_expected["years"]:
        year_rows = []
        for item in weight_expected["items"]:
            code = item["code"]
            raw, flag = source_cell(weights_doc, {"freq":"A","coicop18":code,"statinfo":"IW","geo":"IT","time":str(year)}, f"peso {year}/{code}")
            validate_flag(flag, spec, f"peso {year}/{code}")
            row = {"code":code,"year":year,"weightHundredthsPerThousand":scaled_int(raw,100,f"peso {year}/{code}")}
            weights.append(row); year_rows.append(row)
        gap = sum(r["weightHundredthsPerThousand"] for r in year_rows) - TARGET_WEIGHT
        if abs(gap) > weight_expected["sumToleranceHundredthsPerThousand"]:
            raise SnapshotError(f"pesi {year}: somma si scosta da 1000 oltre l'arrotondamento ({gap})")
        gaps[str(year)] = gap

    total_cells = len(total_observations) * 3
    observed_cells = total_cells + len(comparison_rows) + len(division_rows) + len(weights)
    expected_cells = expected["total"]["cells"] + expected["comparison"]["cells"] + expected["divisions"]["cells"] + expected["weights"]["cells"]
    if observed_cells != expected_cells:
        raise SnapshotError(f"copertura normalizzata {observed_cells}, attesa {expected_cells}")
    return {
        "schemaVersion":1,
        "datasetId":DATASET_ID,
        "period":dict(spec["period"]),
        "caveats":list(CAVEATS),
        "units":{
            "indexHundredths":"centesimi di indice, base 2025=100",
            "annualRateTenths":"decimi di punto percentuale, variazione sullo stesso mese dell'anno precedente",
            "monthlyRateTenths":"decimi di punto percentuale, variazione sul mese precedente",
            "weightHundredthsPerThousand":"centesimi di per mille del paniere HICP",
        },
        "flags":dict(expected["knownFlags"]),
        "geographies":[dict(g) for g in geographies],
        "divisions":[dict(d) for d in division_items],
        "totalObservations":total_observations,
        "comparison":comparison_rows,
        "divisionObservations":division_rows,
        "weights":weights,
        "coverage":{"expectedCells":expected_cells,"observedCells":observed_cells,"flaggedTotalCells":total_flagged},
        "reconciliation":{
            "weightTargetHundredthsPerThousand":TARGET_WEIGHT,
            "weightToleranceHundredthsPerThousand":weight_expected["sumToleranceHundredthsPerThousand"],
            "weightGapByYear":gaps,
            "note":"Le 13 divisioni devono sommare a 1000‰ entro il solo errore massimo da arrotondamento indipendente a due decimali; la somma pubblicata non viene corretta.",
        },
    }


def validate_data(data: dict[str, Any], spec: dict[str, Any]) -> None:
    if data.get("schemaVersion") != 1 or data.get("datasetId") != DATASET_ID or data.get("period") != spec["period"]:
        raise SnapshotError("data artifact: identità o periodo inatteso")
    if not data.get("caveats") or data.get("flags") != spec["expected"]["knownFlags"]:
        raise SnapshotError("data artifact: caveat o flag incompleti")
    expected = spec["expected"]
    if len(data.get("totalObservations", [])) != len(expected["total"]["periods"]):
        raise SnapshotError("data artifact: serie totale incompleta")
    if [row["period"] for row in data["totalObservations"]] != expected["total"]["periods"]:
        raise SnapshotError("data artifact: periodi serie totale divergenti")
    for row in data["totalObservations"]:
        if not all(isinstance(row.get(field), int) and not isinstance(row.get(field), bool) for field in ("indexHundredths","annualRateTenths","monthlyRateTenths")):
            raise SnapshotError(f"data artifact: numeri totali non interi in {row.get('period')}")
        for flag in (row.get("flags") or {}).values():
            if flag not in data["flags"]: raise SnapshotError("data artifact: flag totale sconosciuto")
    if [row["geo"] for row in data.get("comparison", [])] != [g["code"] for g in expected["comparison"]["geographies"]]:
        raise SnapshotError("data artifact: confronto geografico incompleto")
    if [row["code"] for row in data.get("divisionObservations", [])] != [d["code"] for d in expected["divisions"]["items"]]:
        raise SnapshotError("data artifact: divisioni incomplete")
    expected_weight_keys = [(year,d["code"]) for year in expected["weights"]["years"] for d in expected["weights"]["items"]]
    if [(row["year"],row["code"]) for row in data.get("weights", [])] != expected_weight_keys:
        raise SnapshotError("data artifact: pesi incompleti o fuori ordine")
    for row in data["comparison"] + data["divisionObservations"]:
        if not isinstance(row.get("annualRateTenths"), int) or isinstance(row.get("annualRateTenths"), bool):
            raise SnapshotError("data artifact: tasso annuale non intero")
    for row in data["weights"]:
        if not isinstance(row.get("weightHundredthsPerThousand"), int) or row["weightHundredthsPerThousand"] < 0:
            raise SnapshotError("data artifact: peso non valido")
    if data.get("coverage",{}).get("expectedCells") != data.get("coverage",{}).get("observedCells"):
        raise SnapshotError("data artifact: copertura incompleta")
    if data["coverage"]["expectedCells"] != expected["total"]["cells"]+expected["comparison"]["cells"]+expected["divisions"]["cells"]+expected["weights"]["cells"]:
        raise SnapshotError("data artifact: copertura divergente dal lock")
    for year in expected["weights"]["years"]:
        total = sum(r["weightHundredthsPerThousand"] for r in data["weights"] if r["year"] == year)
        gap = total - TARGET_WEIGHT
        if gap != data["reconciliation"]["weightGapByYear"][str(year)] or abs(gap) > data["reconciliation"]["weightToleranceHundredthsPerThousand"]:
            raise SnapshotError(f"data artifact: riconciliazione pesi {year} rotta")


def build_metadata(spec: dict[str, Any], data: dict[str, Any], data_bytes: bytes) -> dict[str, Any]:
    source = spec["source"]
    updated = sorted({asset["sourceUpdated"] for asset in source["assets"].values()})
    return {
        "schemaVersion":1,
        "datasetId":DATASET_ID,
        "period":dict(spec["period"]),
        "referencePeriod": (
            f"{spec['period']['total']['from']}/{spec['period']['total']['to']} (totale Italia); "
            f"{spec['period']['comparison']} (confronto e divisioni); "
            f"pesi {spec['period']['weightYears'][0]}-{spec['period']['weightYears'][-1]}"
        ),
        "observedAt":spec["coverage"]["observedAt"],
        "source":{
            "owner":source["owner"],"landingUrl":source["landingUrl"],"weightsLandingUrl":source["weightsLandingUrl"],
            "informationUrl":source["informationUrl"],"licenseId":source["licenseId"],"licenseNote":source["licenseNote"],"termsUrl":source["termsUrl"],
            "acquisition":dict(source["acquisition"]),"assets":{k:dict(v) for k,v in source["assets"].items()},
        },
        "coverage":dict(spec["coverage"]),
        "semantics":{
            "soldi":{"applicable":False,"unit":"non applicabile","nature":"indice dei prezzi al consumo armonizzato (IPCA/HICP), non flusso monetario pubblico","note":"Nessun importo viene derivato o sommato a SIOPE, bilanci o conti pubblici."},
            "periodo":{"referencePeriod":f"totale Italia {spec['period']['total']['from']}/{spec['period']['total']['to']}; confronto e divisioni {spec['period']['comparison']}; pesi {spec['period']['weightYears'][0]}-{spec['period']['weightYears'][-1]}","note":"Ogni blocco conserva il periodo realmente disponibile; agosto 2026 non viene retro-riempito per confronto o divisioni."},
            "provenance":{"holder":source["owner"],"canonicalUrls":[source["landingUrl"],source["weightsLandingUrl"],source["informationUrl"]]+[a["url"] for a in source["assets"].values()],"publicationDate":updated[-1],"acquisitionDate":source["acquisition"]["acquiredAt"],"checkedAt":source["acquisition"]["checkedAt"],"license":source["licenseId"],"hashes":"SHA-256 per ciascuna risposta JSON-stat nel source lock e per l'artefatto normalizzato"},
        },
        "integrity":{"algorithm":"sha256","canonicalization":"UTF-8 JSON, chiavi ordinate, separatori compatti","dataArtifact":{"path":spec["integrity"]["dataArtifact"]["path"],"bytes":len(data_bytes),"sha256":sha256_bytes(data_bytes)},"sourceLockSha256":canonical_lock_sha256(spec)},
    }


def check(spec_path: Path, data_path: Path, meta_path: Path) -> None:
    spec = load_spec(spec_path)
    if spec["integrity"]["lockSha256"] != canonical_lock_sha256(spec):
        raise SnapshotError("lockSha256 non corrisponde al source lock")
    data_bytes = data_path.read_bytes(); data = json.loads(data_bytes)
    validate_data(data, spec)
    meta = json.loads(meta_path.read_text(encoding="utf-8"))
    artifact = meta.get("integrity",{}).get("dataArtifact",{})
    if artifact.get("bytes") != len(data_bytes) or artifact.get("sha256") != sha256_bytes(data_bytes):
        raise SnapshotError("meta: hash o byte del data artifact divergenti")
    if artifact != spec["integrity"]["dataArtifact"]:
        raise SnapshotError("data artifact: hash, byte o percorso divergenti dal source lock")
    if meta.get("integrity",{}).get("sourceLockSha256") != spec["integrity"]["lockSha256"]:
        raise SnapshotError("meta: sourceLockSha256 divergente")
    if meta.get("datasetId") != DATASET_ID or meta.get("period") != spec["period"]:
        raise SnapshotError("meta: identità o periodo divergente")
    if meta != build_metadata(spec, data, data_bytes):
        raise SnapshotError("meta: provenance o semantica divergenti dal source lock")


def main() -> int:
    parser=argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--spec",type=Path,default=DEFAULT_SPEC); parser.add_argument("--data",type=Path,default=DEFAULT_DATA); parser.add_argument("--meta",type=Path,default=DEFAULT_META)
    parser.add_argument("--input-dir",type=Path); parser.add_argument("--write",action="store_true"); parser.add_argument("--check",action="store_true")
    args=parser.parse_args()
    try:
        if args.check:
            check(args.spec,args.data,args.meta); print("eurostat-hicp: lock, data e meta coerenti"); return 0
        if not args.input_dir: raise SnapshotError("serve --input-dir oppure --check")
        spec=load_spec(args.spec); inputs={}
        for name,asset in spec["source"]["assets"].items():
            path=args.input_dir/asset["filename"]
            if not path.is_file(): raise SnapshotError(f"input mancante: {path}")
            payload=path.read_bytes()
            if len(payload)!=asset["bytes"] or sha256_bytes(payload)!=asset["sha256"]: raise SnapshotError(f"input {name}: byte/hash diversi dal lock")
            inputs[name]=payload
        data=build_data(inputs,spec); validate_data(data,spec); data_bytes=canonical_bytes(data)
        if not args.write:
            print(f"eurostat-hicp: build ok, {data['coverage']['observedCells']} celle sorgente normalizzate, {len(data_bytes)} byte"); return 0
        args.data.write_bytes(data_bytes)
        spec["integrity"]["dataArtifact"]["bytes"]=len(data_bytes); spec["integrity"]["dataArtifact"]["sha256"]=sha256_bytes(data_bytes); spec["integrity"]["lockSha256"]=canonical_lock_sha256(spec)
        args.spec.write_text(json.dumps(spec,ensure_ascii=False,indent=2)+"\n",encoding="utf-8")
        meta=build_metadata(spec,data,data_bytes); args.meta.write_text(json.dumps(meta,ensure_ascii=False,sort_keys=True,indent=2)+"\n",encoding="utf-8")
        print(f"eurostat-hicp: scritti {args.data.name} e {args.meta.name}, lock aggiornato"); return 0
    except (SnapshotError,OSError,json.JSONDecodeError) as error:
        print(f"eurostat-hicp: {error}",file=sys.stderr); return 1

if __name__ == "__main__": raise SystemExit(main())
