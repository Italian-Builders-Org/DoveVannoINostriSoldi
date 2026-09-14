#!/usr/bin/env python3
"""Build the source-locked Eurostat gov_10a_taxag snapshot (PA tax aggregates).

Input is one local JSON-stat 2.0 response from the Eurostat Statistics API for
`gov_10a_taxag` (CC BY 4.0). CI and runtime stay offline: URL, structure, update
timestamp, bytes and SHA-256 are pinned in the source lock.

Published cells are a curated subset of na_item × ESA sector × year. Missing
cells stay absent (never zero). Money is million euro → euro-cents.
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
DEFAULT_SPEC = ROOT / "scripts/etl/specs/eurostat-taxag-2014-2025.source.json"
DEFAULT_DATA = ROOT / "src/data/generated/eurostat-taxag-2014-2025.data.json"
DEFAULT_META = ROOT / "src/data/generated/eurostat-taxag-2014-2025.meta.json"
DEFAULT_FIXTURE = ROOT / "tests/fixtures/eurostat-taxag/gov_10a_taxag-mio-eur.json"
DATASET_ID = "eurostat-taxag"
OFFICIAL_PREFIX = "https://ec.europa.eu/eurostat/"
MILLION_TO_CENTS = 100_000_000

CAVEATS = (
    "Gettito Eurostat SEC 2010 in competenza economica: non è cassa SIOPE (/entrate), "
    "non sono dichiarazioni MEF e non è tax gap o evasione.",
    "«S1311 Amministrazioni centrali» non significa denaro trattenuto a Roma: esistono "
    "trasferimenti fra livelli di governo.",
    "S1314 (fondi di previdenza) non pubblica le voci di imposta D2/D5/D91: l’assenza "
    "resta assenza, non zero.",
    "D611 (contributi datori) è pubblicato per S13 e S1314; manca su S1311 e S1313.",
    "Le voci pubblicate non ricostruiscono l’intero codice ESA: sotto-voci fuori lock "
    "restano nei byte acquisiti ma non sono esposte.",
    "Nessuna somma con COFOG, CPT, OpenBDAP, IRPEF comunale o VAT gap UE.",
)

# na_item → Italian label (product surface). Official English labels stay in the lock.
PUBLISHED_ITEMS: dict[str, str] = {
    "D2_D5_D91_D61_M_D995": "Totale imposte e contributi sociali",
    "D2_D5_D91": "Totale gettito fiscale",
    "D2": "Imposte sulla produzione e sulle importazioni",
    "D21": "Imposte sui prodotti",
    "D211": "IVA",
    "D214": "Imposte sui prodotti diverse da IVA e dazi",
    "D5": "Imposte correnti sul reddito e sul patrimonio",
    "D51": "Imposte sul reddito",
    "D51A": "Imposte sul reddito delle persone fisiche",
    "D51B": "Imposte sul reddito delle società",
    "D61": "Contributi sociali netti",
    "D611": "Contributi sociali effettivi a carico dei datori di lavoro",
    "D91": "Imposte in conto capitale",
    "D29A": "Imposte su terreni, fabbricati e altre strutture",
}

SECTORS: dict[str, str] = {
    "S13": "Amministrazioni pubbliche",
    "S1311": "Amministrazioni centrali",
    "S1313": "Amministrazioni locali",
    "S1314": "Enti di previdenza",
}

# Sectors where each na_item is expected to be observed (others must be absent).
EXPECTED_SECTORS: dict[str, tuple[str, ...]] = {
    "D2_D5_D91_D61_M_D995": ("S13", "S1311", "S1313", "S1314"),
    "D2_D5_D91": ("S13", "S1311", "S1313"),
    "D2": ("S13", "S1311", "S1313"),
    "D21": ("S13", "S1311", "S1313"),
    "D211": ("S13", "S1311", "S1313"),
    "D214": ("S13", "S1311", "S1313"),
    "D5": ("S13", "S1311", "S1313"),
    "D51": ("S13", "S1311", "S1313"),
    "D51A": ("S13", "S1311", "S1313"),
    "D51B": ("S13", "S1311", "S1313"),
    "D61": ("S13", "S1311", "S1313", "S1314"),
    "D611": ("S13", "S1314"),
    "D91": ("S13", "S1311", "S1313"),
    "D29A": ("S13", "S1311", "S1313"),
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
    if list(spec.get("expected", {}).get("publishedItems", [])) != list(PUBLISHED_ITEMS):
        raise SnapshotError("source lock: publishedItems divergono dal contratto ETL")
    if list(spec.get("expected", {}).get("sectors", [])) != list(SECTORS):
        raise SnapshotError("source lock: sectors divergono dal contratto ETL")
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
    if list(doc.get("id") or []) != ["freq", "unit", "sector", "na_item", "geo", "time"]:
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
    sector_codes = ordered_codes(doc, "sector")
    if set(sector_codes) != set(SECTORS):
        raise SnapshotError(f"settori fonte inattesi: {sector_codes!r}")
    for code in PUBLISHED_ITEMS:
        if code not in doc["dimension"]["na_item"]["category"]["index"]:
            raise SnapshotError(f"na_item {code} assente dalla fonte")

    observations: list[dict[str, Any]] = []
    for na_item, label_it in PUBLISHED_ITEMS.items():
        expected = set(EXPECTED_SECTORS[na_item])
        official = doc["dimension"]["na_item"]["category"]["label"].get(na_item, na_item)
        for sector in SECTORS:
            for year in years:
                coords = {
                    "freq": "A",
                    "unit": "MIO_EUR",
                    "sector": sector,
                    "na_item": na_item,
                    "geo": "IT",
                    "time": year,
                }
                raw, flag = source_cell(doc, coords)
                where = f"{na_item}/{sector}/{year}"
                if sector in expected:
                    if raw is None:
                        raise SnapshotError(f"{where}: cella attesa assente")
                    if flag is not None and flag not in spec["expected"]["knownFlags"]:
                        raise SnapshotError(f"{where}: flag Eurostat sconosciuto {flag!r}")
                    observations.append({
                        "naItem": na_item,
                        "naItemLabelIt": label_it,
                        "naItemLabelEn": official,
                        "sector": sector,
                        "sectorLabelIt": SECTORS[sector],
                        "year": int(year),
                        "status": "observed",
                        "amountCents": million_to_cents(raw, where),
                        "flag": flag,
                    })
                else:
                    if raw is not None:
                        raise SnapshotError(f"{where}: cella inattesa presente ({raw!r})")
                    observations.append({
                        "naItem": na_item,
                        "naItemLabelIt": label_it,
                        "naItemLabelEn": official,
                        "sector": sector,
                        "sectorLabelIt": SECTORS[sector],
                        "year": int(year),
                        "status": "absent",
                        "amountCents": None,
                        "flag": flag,
                    })

    observed = [row for row in observations if row["status"] == "observed"]
    expected_count = sum(len(EXPECTED_SECTORS[code]) * len(years) for code in PUBLISHED_ITEMS)
    if len(observed) != expected_count:
        raise SnapshotError(f"celle osservate {len(observed)}, attese {expected_count}")

    # Reconcile tax total = D2 + D5 + D91 and total+contrib = tax + D61 where published.
    by_key = {
        (row["naItem"], row["sector"], row["year"]): row
        for row in observations
        if row["status"] == "observed"
    }
    for sector in ("S13", "S1311", "S1313"):
        for year in range(spec["period"]["from"], spec["period"]["to"] + 1):
            total = by_key[("D2_D5_D91", sector, year)]["amountCents"]
            parts = sum(by_key[(code, sector, year)]["amountCents"] for code in ("D2", "D5", "D91"))
            if total != parts:
                raise SnapshotError(
                    f"riconciliazione D2_D5_D91≠D2+D5+D91 per {sector}/{year}: {total} vs {parts}"
                )
            grand = by_key[("D2_D5_D91_D61_M_D995", sector, year)]["amountCents"]
            contrib = by_key[("D61", sector, year)]["amountCents"]
            if grand != total + contrib:
                raise SnapshotError(
                    f"riconciliazione totale≠tasse+D61 per {sector}/{year}: "
                    f"{grand} vs {total + contrib}"
                )
    for year in range(spec["period"]["from"], spec["period"]["to"] + 1):
        grand = by_key[("D2_D5_D91_D61_M_D995", "S1314", year)]["amountCents"]
        contrib = by_key[("D61", "S1314", year)]["amountCents"]
        if grand != contrib:
            raise SnapshotError(
                f"riconciliazione S1314 totale≠D61 per {year}: {grand} vs {contrib}"
            )

    return {
        "schemaVersion": 1,
        "datasetId": DATASET_ID,
        "geography": {"code": "IT", "label": "Italia"},
        "period": {"from": spec["period"]["from"], "to": spec["period"]["to"]},
        "units": {"money": "euro-cents", "sourceMoney": "million-euro"},
        "sectors": [{"code": code, "labelIt": label} for code, label in SECTORS.items()],
        "items": [
            {
                "code": code,
                "labelIt": label,
                "expectedSectors": list(EXPECTED_SECTORS[code]),
            }
            for code, label in PUBLISHED_ITEMS.items()
        ],
        "coverage": {
            "publishedItems": len(PUBLISHED_ITEMS),
            "sectors": len(SECTORS),
            "years": len(years),
            "observedCells": len(observed),
            "absentCells": len(observations) - len(observed),
            "totalCells": len(observations),
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
    if len(data["observations"]) != spec["expected"]["totalCells"]:
        raise SnapshotError("data: totalCells divergenti dal lock")
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
                "nature": "gettito SEC 2010 (competenza); non cassa e non tax gap",
            },
            "periodo": {
                "referencePeriod": f"{spec['period']['from']}-{spec['period']['to']}",
                "frequency": "annuale",
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
            print("eurostat-taxag: lock, data e meta coerenti")
            return 0
        if not args.write:
            raise SnapshotError("specificare --write oppure --check")

        draft = load_spec(args.spec) if args.spec.is_file() else None
        # First write may use a draft lock; allow bootstrap from template via --write
        # after the lock file exists with asset hashes already filled.
        if draft is None:
            raise SnapshotError("source lock assente: creare prima lo spec")
        payload = verified_payload(draft, args.input)
        doc = parse_bundle(payload, draft)
        data = build_data(doc, draft)
        validate_data(data, draft)
        data_bytes = canonical_bytes(data)
        draft["expected"]["observedCells"] = data["coverage"]["observedCells"]
        draft["expected"]["totalCells"] = data["coverage"]["totalCells"]
        draft["integrity"]["dataArtifact"]["bytes"] = len(data_bytes)
        draft["integrity"]["dataArtifact"]["sha256"] = sha256_bytes(data_bytes)
        draft["integrity"]["lockSha256"] = ""
        draft["integrity"]["lockSha256"] = canonical_lock_sha256(draft)
        args.spec.write_text(json.dumps(draft, ensure_ascii=False, indent=2) + "\n", encoding="utf-8")
        write_artifacts(draft, data, args.data, args.meta)
        check(args.spec, args.data, args.meta)
        print(f"eurostat-taxag: scritto {args.data.name} ({data['coverage']['observedCells']} celle)")
        return 0
    except SnapshotError as error:
        print(f"eurostat-taxag: {error}", file=sys.stderr)
        return 1


if __name__ == "__main__":
    raise SystemExit(main())
