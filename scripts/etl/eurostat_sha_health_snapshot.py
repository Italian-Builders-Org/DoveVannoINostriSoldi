#!/usr/bin/env python3
"""Build the source-locked Eurostat SHA health-financing snapshot (hlth_sha11_hf).

Input is one local JSON-stat 2.0 response from the Eurostat Statistics API.
CI and runtime stay offline. Money is million euro → euro-cents.
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
DEFAULT_SPEC = ROOT / "scripts/etl/specs/eurostat-sha-health-2014-2025.source.json"
DEFAULT_DATA = ROOT / "src/data/generated/eurostat-sha-health-2014-2025.data.json"
DEFAULT_META = ROOT / "src/data/generated/eurostat-sha-health-2014-2025.meta.json"
DEFAULT_FIXTURE = ROOT / "tests/fixtures/eurostat-sha-health/hlth_sha11_hf-mio-eur.json"
DATASET_ID = "eurostat-sha-health"
OFFICIAL_PREFIX = "https://ec.europa.eu/eurostat/"
MILLION_TO_CENTS = 100_000_000

CAVEATS = (
    "Quadro SHA Eurostat sulla spesa sanitaria per schema di finanziamento: non è il "
    "Conto Economico SSN OpenBDAP e non è la funzione COFOG GF07.",
    "Non sommare questi importi al CE SSN né a COFOG: perimetri e classificazioni diversi.",
    "HF31, HF32 e HF4 non sono pubblicati per l’Italia in questa estrazione: restano fuori "
    "dallo snapshot, non diventano zero.",
    "Il 2025 porta il flag Eurostat «p» (provvisorio) e può essere rivisto.",
    "Importi in competenza di contabilità sanitaria armonizzata UE, non pagamenti di cassa.",
)

PUBLISHED_SCHEMES: dict[str, str] = {
    "TOT_HF": "Tutti gli schemi di finanziamento",
    "HF1": "Schemi pubblici e contributivi obbligatori",
    "HF11": "Schemi di governo",
    "HF12_13": "Assicurazione sanitaria obbligatoria e CMSA",
    "HF121": "Assicurazione sanitaria sociale",
    "HF122": "Assicurazione privata obbligatoria",
    "HF13": "Conti medici obbligatori (CMSA)",
    "HF2": "Schemi volontari",
    "HF21": "Assicurazione sanitaria volontaria",
    "HF22": "Schemi di istituzioni non profit",
    "HF23": "Schemi delle imprese",
    "HF3": "Pagamenti out-of-pocket delle famiglie",
    "HF_UNK": "Schema di finanziamento sconosciuto",
}


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


def load_spec(path: Path = DEFAULT_SPEC) -> dict[str, Any]:
    try:
        spec = json.loads(path.read_text(encoding="utf-8"))
    except (OSError, json.JSONDecodeError) as error:
        raise SnapshotError(f"source lock illeggibile: {error}") from error
    if spec.get("schemaVersion") != 1 or spec.get("datasetId") != DATASET_ID:
        raise SnapshotError("source lock: identità inattesa")
    source = spec.get("source") or {}
    if source.get("licenseId") != "CC-BY-4.0":
        raise SnapshotError("source lock: licenza Eurostat inattesa")
    for field in ("landingUrl", "termsUrl"):
        if not str(source.get(field, "")).startswith(OFFICIAL_PREFIX):
            raise SnapshotError(f"source lock: {field} non ufficiale Eurostat")
    asset = (source.get("assets") or {}).get("mio-eur")
    if not isinstance(asset, dict):
        raise SnapshotError("source lock: asset mio-eur mancante")
    if not str(asset.get("url", "")).startswith(OFFICIAL_PREFIX):
        raise SnapshotError("source lock: URL asset non ufficiale")
    if not isinstance(asset.get("bytes"), int) or asset["bytes"] <= 0:
        raise SnapshotError("source lock: bytes non validi")
    digest = str(asset.get("sha256", ""))
    if len(digest) != 64 or set(digest) - set("0123456789abcdef"):
        raise SnapshotError("source lock: sha256 non valido")
    structure = asset.get("structure") or {}
    if structure.get("agencyId") != "ESTAT" or not structure.get("id") or not structure.get("version"):
        raise SnapshotError("source lock: struttura incompleta")
    if list(spec.get("expected", {}).get("publishedSchemes", [])) != list(PUBLISHED_SCHEMES):
        raise SnapshotError("source lock: publishedSchemes divergono dal contratto ETL")
    return spec


def million_to_cents(value: object, where: str) -> int:
    try:
        decimal = Decimal(str(value))
    except (InvalidOperation, ValueError) as error:
        raise SnapshotError(f"{where}: valore non numerico {value!r}") from error
    scaled = decimal * MILLION_TO_CENTS
    if scaled != scaled.to_integral_value():
        raise SnapshotError(f"{where}: precisione {value!r} oltre i centesimi pubblicabili")
    return int(scaled)


def parse_bundle(payload: bytes, spec: dict[str, Any]) -> dict[str, Any]:
    try:
        doc = json.loads(payload.decode("utf-8"))
    except (UnicodeDecodeError, json.JSONDecodeError) as error:
        raise SnapshotError(f"JSON-stat illeggibile: {error}") from error
    asset = spec["source"]["assets"]["mio-eur"]
    if doc.get("class") != "dataset" or doc.get("version") != "2.0" or doc.get("source") != "ESTAT":
        raise SnapshotError("non è il dataset JSON-stat 2.0 Eurostat atteso")
    if doc.get("updated") != asset["sourceUpdated"]:
        raise SnapshotError("source updated divergente dal lock")
    structure = doc.get("extension", {}).get("datastructure", {})
    if {key: str(structure.get(key)) for key in ("id", "agencyId", "version")} != {
        key: str(asset["structure"][key]) for key in ("id", "agencyId", "version")
    }:
        raise SnapshotError("struttura SDMX divergente dal lock")
    if list(doc.get("id") or []) != ["freq", "unit", "icha11_hf", "geo", "time"]:
        raise SnapshotError("dimensioni JSON-stat inattese")
    return doc


def ordered_codes(doc: dict[str, Any], dimension: str) -> list[str]:
    index = doc["dimension"][dimension]["category"]["index"]
    return sorted(index, key=index.get)


def flat_index(doc: dict[str, Any], coordinates: dict[str, str]) -> str:
    offset = 0
    for dim, size in zip(doc["id"], doc["size"], strict=True):
        try:
            position = doc["dimension"][dim]["category"]["index"][coordinates[dim]]
        except KeyError as error:
            raise SnapshotError(f"cella: coordinata {dim} mancante") from error
        offset = offset * size + position
    return str(offset)


def source_cell(doc: dict[str, Any], coordinates: dict[str, str]) -> tuple[object | None, str | None]:
    key = flat_index(doc, coordinates)
    values = doc.get("value") or {}
    status = (doc.get("status") or {}).get(key)
    if key not in values:
        return None, status
    return values[key], status


def verified_payload(spec: dict[str, Any], path: Path | None = None) -> bytes:
    asset = spec["source"]["assets"]["mio-eur"]
    target = path or (ROOT / asset["path"])
    if not target.is_file():
        target = DEFAULT_FIXTURE
    payload = target.read_bytes()
    if len(payload) != asset["bytes"] or sha256_bytes(payload) != asset["sha256"]:
        raise SnapshotError(f"fixture {target.name}: byte o hash diversi dal lock")
    return payload


def build_data(doc: dict[str, Any], spec: dict[str, Any]) -> dict[str, Any]:
    years = [str(year) for year in range(spec["period"]["from"], spec["period"]["to"] + 1)]
    if ordered_codes(doc, "time") != years:
        raise SnapshotError(f"anni fonte {ordered_codes(doc, 'time')!r}, atteso {years!r}")
    if ordered_codes(doc, "geo") != ["IT"]:
        raise SnapshotError("geo diversa da IT")
    if ordered_codes(doc, "freq") != ["A"]:
        raise SnapshotError("freq diversa da A")
    if ordered_codes(doc, "unit") != ["MIO_EUR"]:
        raise SnapshotError("unit diversa da MIO_EUR")
    for code in PUBLISHED_SCHEMES:
        if code not in doc["dimension"]["icha11_hf"]["category"]["index"]:
            raise SnapshotError(f"schema {code} assente dalla fonte")

    observations: list[dict[str, Any]] = []
    for scheme, label_it in PUBLISHED_SCHEMES.items():
        official = doc["dimension"]["icha11_hf"]["category"]["label"].get(scheme, scheme)
        for year in years:
            coords = {
                "freq": "A",
                "unit": "MIO_EUR",
                "icha11_hf": scheme,
                "geo": "IT",
                "time": year,
            }
            raw, flag = source_cell(doc, coords)
            where = f"{scheme}/{year}"
            if raw is None:
                raise SnapshotError(f"{where}: cella attesa assente")
            if flag is not None and flag not in spec["expected"]["knownFlags"]:
                raise SnapshotError(f"{where}: flag Eurostat sconosciuto {flag!r}")
            observations.append({
                "scheme": scheme,
                "schemeLabelIt": label_it,
                "schemeLabelEn": official,
                "year": int(year),
                "status": "observed",
                "amountCents": million_to_cents(raw, where),
                "flag": flag,
            })

    expected_count = len(PUBLISHED_SCHEMES) * len(years)
    if len(observations) != expected_count:
        raise SnapshotError(f"celle {len(observations)}, attese {expected_count}")

    by_key = {(row["scheme"], row["year"]): row for row in observations}
    for year in range(spec["period"]["from"], spec["period"]["to"] + 1):
        total = by_key[("TOT_HF", year)]["amountCents"]
        parts = sum(by_key[(code, year)]["amountCents"] for code in ("HF1", "HF2", "HF3", "HF_UNK"))
        if total != parts:
            raise SnapshotError(f"riconciliazione TOT_HF≠HF1+HF2+HF3+HF_UNK per {year}: {total} vs {parts}")
        hf1 = by_key[("HF1", year)]["amountCents"]
        hf1_parts = by_key[("HF11", year)]["amountCents"] + by_key[("HF12_13", year)]["amountCents"]
        if hf1 != hf1_parts:
            raise SnapshotError(f"riconciliazione HF1≠HF11+HF12_13 per {year}: {hf1} vs {hf1_parts}")
        hf2 = by_key[("HF2", year)]["amountCents"]
        hf2_parts = sum(by_key[(code, year)]["amountCents"] for code in ("HF21", "HF22", "HF23"))
        if hf2 != hf2_parts:
            raise SnapshotError(f"riconciliazione HF2≠HF21+HF22+HF23 per {year}: {hf2} vs {hf2_parts}")

    return {
        "schemaVersion": 1,
        "datasetId": DATASET_ID,
        "geography": {"code": "IT", "label": "Italia"},
        "period": {"from": spec["period"]["from"], "to": spec["period"]["to"]},
        "units": {"money": "euro-cents", "sourceMoney": "million-euro"},
        "schemes": [
            {"code": code, "labelIt": label}
            for code, label in PUBLISHED_SCHEMES.items()
        ],
        "coverage": {
            "publishedSchemes": len(PUBLISHED_SCHEMES),
            "years": len(years),
            "observedCells": len(observations),
            "provisionalYears": [2025],
        },
        "caveats": list(CAVEATS),
        "observations": observations,
    }


def validate_data(data: dict[str, Any], spec: dict[str, Any]) -> None:
    if data.get("schemaVersion") != 1 or data.get("datasetId") != DATASET_ID:
        raise SnapshotError("data: identità inattesa")
    if data["period"] != {"from": spec["period"]["from"], "to": spec["period"]["to"]}:
        raise SnapshotError("data: periodo divergente")
    if data["coverage"]["observedCells"] != spec["expected"]["observedCells"]:
        raise SnapshotError("data: observedCells divergenti dal lock")
    if data["caveats"] != list(CAVEATS):
        raise SnapshotError("data: caveats divergenti")


def build_metadata(spec: dict[str, Any], data_bytes: bytes, data: dict[str, Any]) -> dict[str, Any]:
    source = spec["source"]
    asset = source["assets"]["mio-eur"]
    return {
        "schemaVersion": 1,
        "datasetId": DATASET_ID,
        "period": data["period"],
        "observedAt": source["acquisition"]["checkedAt"],
        "source": {
            "owner": source["owner"],
            "datasetCode": source["datasetCode"],
            "datasetLabel": source["datasetLabel"],
            "landingUrl": source["landingUrl"],
            "termsUrl": source["termsUrl"],
            "licenseId": source["licenseId"],
            "licenseNote": source["licenseNote"],
            "publicationDate": asset["sourceUpdated"][:10],
            "acquiredAt": source["acquisition"]["acquiredAt"],
            "checkedAt": source["acquisition"]["checkedAt"],
            "updateFrequency": source["updateFrequency"],
            "assets": {
                "mio-eur": {
                    "url": asset["url"],
                    "bytes": asset["bytes"],
                    "sha256": asset["sha256"],
                    "sourceUpdated": asset["sourceUpdated"],
                    "structure": asset["structure"],
                },
            },
        },
        "coverage": data["coverage"],
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
        "semantics": {
            "soldi": {
                "unit": "euro-cents",
                "sourceUnit": "million-euro",
                "nature": "spesa sanitaria SHA per schema di finanziamento; non CE SSN né COFOG",
            },
            "periodo": {
                "referencePeriod": f"{spec['period']['from']}-{spec['period']['to']}",
                "frequency": "annuale",
                "provisionalYear": 2025,
            },
            "provenance": {
                "holder": source["owner"],
                "canonicalUrls": [source["landingUrl"], asset["url"]],
                "publicationDate": asset["sourceUpdated"][:10],
                "acquisitionDate": source["acquisition"]["acquiredAt"],
                "checkedAt": source["acquisition"]["checkedAt"],
                "license": source["licenseId"],
            },
        },
    }


def write_artifacts(spec: dict[str, Any], data: dict[str, Any], data_path: Path, meta_path: Path) -> None:
    data_bytes = canonical_bytes(data)
    meta = build_metadata(spec, data_bytes, data)
    data_path.write_bytes(data_bytes)
    meta_path.write_text(json.dumps(meta, ensure_ascii=False, sort_keys=True, indent=2) + "\n", encoding="utf-8")


def check(spec_path: Path = DEFAULT_SPEC, data_path: Path = DEFAULT_DATA, meta_path: Path = DEFAULT_META) -> None:
    spec = load_spec(spec_path)
    if spec["integrity"]["lockSha256"] != canonical_lock_sha256(spec):
        raise SnapshotError("lockSha256 non corrisponde al contenuto del lock")
    data_bytes = data_path.read_bytes()
    data = json.loads(data_bytes.decode("utf-8"))
    validate_data(data, spec)
    expected_meta = build_metadata(spec, data_bytes, data)
    if json.loads(meta_path.read_text(encoding="utf-8")) != expected_meta:
        raise SnapshotError("Metadata or artifact hash drift")
    payload = verified_payload(spec)
    rebuilt = build_data(parse_bundle(payload, spec), spec)
    if canonical_bytes(rebuilt) != data_bytes:
        raise SnapshotError("riproiezione dalla fixture diverge dall'artifact")


def main() -> int:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--spec", type=Path, default=DEFAULT_SPEC)
    parser.add_argument("--data", type=Path, default=DEFAULT_DATA)
    parser.add_argument("--meta", type=Path, default=DEFAULT_META)
    parser.add_argument("--input", type=Path, help="JSON-stat locale (default: fixture/lock path)")
    parser.add_argument("--write", action="store_true")
    parser.add_argument("--check", action="store_true")
    args = parser.parse_args()
    try:
        if args.check:
            check(args.spec, args.data, args.meta)
            print("eurostat-sha-health: lock, data e meta coerenti")
            return 0
        if not args.write:
            raise SnapshotError("specificare --write oppure --check")
        if not args.spec.is_file():
            raise SnapshotError("source lock assente: creare prima lo spec")
        draft = load_spec(args.spec)
        payload = verified_payload(draft, args.input)
        data = build_data(parse_bundle(payload, draft), draft)
        validate_data(data, draft)
        data_bytes = canonical_bytes(data)
        draft["expected"]["observedCells"] = data["coverage"]["observedCells"]
        draft["integrity"]["dataArtifact"]["bytes"] = len(data_bytes)
        draft["integrity"]["dataArtifact"]["sha256"] = sha256_bytes(data_bytes)
        draft["integrity"]["lockSha256"] = ""
        draft["integrity"]["lockSha256"] = canonical_lock_sha256(draft)
        args.spec.write_text(json.dumps(draft, ensure_ascii=False, indent=2) + "\n", encoding="utf-8")
        write_artifacts(draft, data, args.data, args.meta)
        check(args.spec, args.data, args.meta)
        print(f"eurostat-sha-health: scritto {args.data.name} ({data['coverage']['observedCells']} celle)")
        return 0
    except SnapshotError as error:
        print(f"eurostat-sha-health: {error}", file=sys.stderr)
        return 1


if __name__ == "__main__":
    raise SystemExit(main())
