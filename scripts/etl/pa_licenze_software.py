#!/usr/bin/env python3
"""Public administration spending on software licences, from three official sources.

Issue #886. Three measures that answer different questions and are never
added together:

1. Consip, orders under framework conventions for software licences
   (Microsoft Enterprise Agreement, Licenze Software Multibrand, Prodotti
   Software On Premise) and MePA orders in the "Licenze software" category.
   Ordered amounts declared by Consip, CC BY 4.0, per year, convention,
   vendor (read from the lot name) and type of administration.
2. ANAC, awards of procedures with a CPV code of division 48 ("pacchetti
   software e sistemi di informazione") published in 2025, from the ANAC
   artefacts already locked in the repository: per CPV code, vendor (only
   single-operator awards) and contracting entity. Award amounts, not
   payments; Consip orders reappear here as derived CIGs.
3. SIOPE, cash payments of local health authorities under the SSN code 5205
   "Licenze software", the only SIOPE source with a licence code.

The full payload is not versioned: it is imported into dvns_snapshots and the
site checks it against the committed receipt, as for /manovra.
"""

from __future__ import annotations

import argparse
import csv
import gzip
import hashlib
import io
import json
import re
import sys
import urllib.request
from collections import defaultdict
from decimal import Decimal, InvalidOperation
from pathlib import Path
from typing import Any, Iterable

ROOT = Path(__file__).resolve().parents[2]
DEFAULT_SPEC = ROOT / "scripts/etl/specs/pa-licenze-software.source.json"
DEFAULT_CACHE = ROOT / ".cache/pa-licenze-software"
DEFAULT_OUTPUT = ROOT / "src/data/generated/pa-licenze-software.json"
DEFAULT_RECEIPT = ROOT / "src/data/generated/pa-licenze-software.receipt.json"
CPV_DIR = ROOT / "src/data/generated/anac-procurement-cpv"
AWARDS_DIR = ROOT / "src/data/generated/anac-entity-procurement-page"
SIOPE_FILE = ROOT / "src/data/generated/siope-nonmunicipal-detail.json"
USER_AGENT = "Mozilla/5.0 (compatible; dvns-etl/1.0)"
TOP = 10


class LicenceError(ValueError):
    """A source or a classification drifted: publication is blocked."""


def sha256_bytes(payload: bytes) -> str:
    return hashlib.sha256(payload).hexdigest()


def cents(value: str) -> int:
    """Consip amounts: '280486,82', '-87004,8' or '317213453' (euro) to integer cents, exactly."""
    text = value.strip()
    if not text:
        return 0
    if "," in text:
        text = text.replace(".", "").replace(",", ".")
    try:
        amount = Decimal(text)
    except InvalidOperation as error:
        raise LicenceError(f"importo non numerico: {value!r}") from error
    # Consip publishes reversals as negative amounts: they count with their sign,
    # as in consip_ordini_snapshot.py.
    return int((amount * 100).to_integral_value())


def count(value: str) -> int:
    text = value.strip()
    if not text:
        return 0
    if not text.isdigit():
        raise LicenceError(f"conteggio non numerico: {value!r}")
    return int(text)


# ── Consip ───────────────────────────────────────────────────────────────────

def read_asset(spec: dict[str, Any], key: str, cache: Path) -> list[dict[str, str]]:
    asset = spec["consip"]["assets"][key]
    payload = (cache / asset["file"]).read_bytes()
    if len(payload) != asset["bytes"] or sha256_bytes(payload) != asset["sha256"]:
        raise LicenceError(f"Consip {key}: byte o SHA-256 diversi dal source lock")
    reader = csv.DictReader(io.StringIO(payload.decode(spec["consip"]["encoding"]), newline=""))
    if reader.fieldnames != asset["headers"]:
        raise LicenceError(f"Consip {key}: intestazioni inattese {reader.fieldnames}")
    return list(reader)


def convention_family(name: str, spec: dict[str, Any]) -> str | None:
    for family in spec["consip"]["families"]:
        if name.upper().startswith(family["prefix"]):
            return family["id"]
    return None


def lot_vendor(family: str, lot: str, spec: dict[str, Any]) -> dict[str, Any]:
    if family == "microsoft-ea":
        return {"vendor": "Microsoft", "openSource": False}
    text = re.sub(r"\s+", " ", lot.upper())
    matches = [rule for rule in spec["consip"]["vendors"] if re.search(rule["pattern"], text)]
    if len(matches) != 1:
        raise LicenceError(f"lotto {lot!r}: {len(matches)} vendor riconosciuti, atteso 1")
    return {"vendor": matches[0]["vendor"], "openSource": matches[0]["openSource"]}


def add(bucket: dict[str, dict[str, int]], key: str, amount: int, orders: int) -> None:
    entry = bucket.setdefault(key, {"cents": 0, "orders": 0})
    entry["cents"] += amount
    entry["orders"] += orders


def ranked(bucket: dict[str, dict[str, int]], label: str) -> list[dict[str, Any]]:
    return [
        {label: key, "cents": value["cents"], "orders": value["orders"]}
        for key, value in sorted(bucket.items(), key=lambda item: (-item[1]["cents"], item[0]))
    ]


def consip_conventions(spec: dict[str, Any], cache: Path) -> list[dict[str, Any]]:
    """Each group of the open data has one row with the count and one with the amount: both are summed."""
    years = []
    for year in spec["consip"]["years"]:
        rows = read_asset(spec, f"convenzioni-{year}", cache)
        by_vendor: dict[str, dict[str, int]] = {}
        by_convention: dict[str, dict[str, int]] = {}
        by_type: dict[str, dict[str, int]] = {}
        open_source = set()
        all_cents = 0
        for row in rows:
            if row["#Anno_Riferimento"] != str(year):
                raise LicenceError(f"Consip convenzioni {year}: riga di un altro anno")
            amount, orders = cents(row["Importo_Ordinato"]), count(row["Numero_Ordini"])
            all_cents += amount
            family = convention_family(row["Convenzione"], spec)
            if family is None:
                continue
            vendor = lot_vendor(family, row["Lotto"], spec)
            if vendor["openSource"]:
                open_source.add(vendor["vendor"])
            add(by_vendor, vendor["vendor"], amount, orders)
            add(by_convention, re.sub(r"\s+", " ", row["Convenzione"].strip()), amount, orders)
            add(by_type, row["Tipologia_Amministrazione"].strip(), amount, orders)
        total = sum(entry["cents"] for entry in by_vendor.values())
        years.append({
            "year": year,
            "cents": total,
            "orders": sum(entry["orders"] for entry in by_vendor.values()),
            "allConventionsCents": all_cents,
            "byVendor": [
                {**entry, "openSource": entry["vendor"] in open_source}
                for entry in ranked(by_vendor, "vendor")
            ],
            "byConvention": ranked(by_convention, "convention"),
            "byAdministrationType": ranked(by_type, "type"),
        })
    return years


def consip_mepa(spec: dict[str, Any], cache: Path) -> list[dict[str, Any]]:
    categories = set(spec["consip"]["mepaCategories"])
    years = []
    for year in spec["consip"]["years"]:
        rows = read_asset(spec, f"mepa-{year}", cache)
        by_type: dict[str, dict[str, int]] = {}
        seen = set()
        all_cents = 0
        counted = False
        for row in rows:
            amount, orders = cents(row["Valore_economico_Ordini"]), count(row["N_Ordini"])
            all_cents += amount
            if row["Categoria_Abilitazione"].strip() not in categories:
                continue
            seen.add(row["Categoria_Abilitazione"].strip())
            counted = counted or bool(row["N_Ordini"].strip())
            add(by_type, row["Tipologia_Amministrazione"].strip(), amount, orders)
        if seen != categories:
            raise LicenceError(f"MePA {year}: categorie assenti {sorted(categories - seen)}")
        # The licence rows of the MePA files carry the amount without the order
        # count: an unpublished count stays null, it is not zero.
        types = ranked(by_type, "type")
        if not counted:
            for entry in types:
                entry["orders"] = None
        years.append({
            "year": year,
            "cents": sum(entry["cents"] for entry in by_type.values()),
            "orders": sum(entry["orders"] for entry in by_type.values()) if counted else None,
            "allMepaCents": all_cents,
            "byAdministrationType": types,
        })
    return years


# ── ANAC ─────────────────────────────────────────────────────────────────────

def jsonl_gz(path: Path) -> Iterable[dict[str, Any]]:
    with gzip.open(path, "rt", encoding="utf-8") as handle:
        for line in handle:
            if line.strip():
                yield json.loads(line)


def verify_shards(directory: Path) -> str:
    """Shards must match their own meta.json; returns the meta digest for provenance."""
    meta_bytes = (directory / "meta.json").read_bytes()
    meta = json.loads(meta_bytes)
    shard_dir = directory / "entities" if (directory / "entities").is_dir() else directory
    for shard in meta.get("shards", []):
        payload = (shard_dir / f"{shard['id']}.jsonl.gz").read_bytes()
        if sha256_bytes(payload) != shard["sha256"]:
            raise LicenceError(f"{directory.name}: shard {shard['id']} diverso da meta.json")
    return sha256_bytes(meta_bytes)


def normalized_vendor(name: str) -> str:
    text = re.sub(r"[^A-Z0-9 ]", " ", name.upper())
    text = re.sub(r"\b(S ?R ?L|S ?P ?A|S ?A ?S|S ?N ?C|SOCIETA|A SOCIO UNICO|UNIPERSONALE|IN SIGLA)\b", " ", text)
    return re.sub(r"\s+", " ", text).strip()


def anac_division(spec: dict[str, Any], ipa_names: dict[str, str]) -> dict[str, Any]:
    division = spec["anac"]["cpvDivision"]
    cpv_meta = verify_shards(CPV_DIR)
    awards_meta = verify_shards(AWARDS_DIR)
    cpv_by_cig: dict[str, tuple[str, str]] = {}
    for shard in sorted(CPV_DIR.glob("*.jsonl.gz")):
        for entity in jsonl_gz(shard):
            for procedure in entity["procedures"]:
                code = procedure["rawCode"]
                if code.startswith(division):
                    cpv_by_cig[procedure["cig"]] = (code, procedure["description"])
    by_code: dict[str, dict[str, Any]] = {}
    by_entity: dict[str, dict[str, int]] = {}
    vendor_totals: dict[str, dict[str, int]] = {}
    vendor_names: dict[str, dict[str, int]] = defaultdict(lambda: defaultdict(int))
    largest: list[dict[str, Any]] = []
    total = attributed = awards = 0
    for shard in sorted((AWARDS_DIR / "entities").glob("*.jsonl.gz")):
        for entity in jsonl_gz(shard):
            names = {operator["ref"]: operator["name"] for operator in entity["operators"]}
            for award in entity["awards"]:
                cpv = cpv_by_cig.get(award["cig"])
                if cpv is None or not award["amountStatus"].startswith("positive"):
                    continue
                amount = int((Decimal(award["amount"]) * 100).to_integral_value())
                awards += 1
                total += amount
                code = by_code.setdefault(cpv[0], {"code": cpv[0], "label": cpv[1], "cents": 0, "awards": 0})
                code["cents"] += amount
                code["awards"] += 1
                add(by_entity, entity["codiceIpa"], amount, 1)
                vendor = None
                if award["attribution"] == "single-operator" and len(award["operatorRefs"]) == 1:
                    vendor = names[award["operatorRefs"][0]]
                    key = normalized_vendor(vendor)
                    attributed += amount
                    add(vendor_totals, key, amount, 1)
                    vendor_names[key][vendor] += 1
                largest.append({
                    "cig": award["cig"],
                    "codiceIpa": entity["codiceIpa"],
                    "entity": ipa_names.get(entity["codiceIpa"]),
                    "vendor": vendor,
                    "cpv": cpv[0],
                    "cents": amount,
                    "awardedAt": award["awardedAt"],
                })
    if not awards:
        raise LicenceError("ANAC: nessuna aggiudicazione nella divisione CPV")
    display = {key: sorted(names.items(), key=lambda item: (-item[1], item[0]))[0][0] for key, names in vendor_names.items()}
    largest.sort(key=lambda item: (-item["cents"], item["cig"]))
    return {
        "cohort": spec["anac"]["cohort"],
        "cpvDivision": division,
        "cents": total,
        "awards": awards,
        "attributedCents": attributed,
        "byCpv": sorted(by_code.values(), key=lambda item: (-item["cents"], item["code"]))[:15],
        "topVendors": [
            {"vendor": display[entry["vendor"]], "cents": entry["cents"], "awards": entry["orders"]}
            for entry in ranked(vendor_totals, "vendor")[:TOP]
        ],
        "topEntities": [
            {"codiceIpa": entry["codiceIpa"], "entity": ipa_names.get(entry["codiceIpa"]), "cents": entry["cents"], "awards": entry["orders"]}
            for entry in ranked(by_entity, "codiceIpa")[:TOP]
        ],
        "largestAwards": largest[:TOP],
        "artefacts": {"cpvMetaSha256": cpv_meta, "awardsMetaSha256": awards_meta},
    }


def ipa_names(spec: dict[str, Any], cache: Path) -> dict[str, str]:
    asset = spec["ipa"]
    payload = (cache / asset["file"]).read_bytes()
    if len(payload) != asset["bytes"] or sha256_bytes(payload) != asset["sha256"]:
        raise LicenceError("IPA: byte o SHA-256 diversi dal source lock")
    reader = csv.DictReader(io.StringIO(payload.decode("utf-8-sig"), newline=""))
    return {row["Codice_IPA"]: row["Denominazione_ente"].strip() for row in reader}


# ── SIOPE ────────────────────────────────────────────────────────────────────

def siope_licences(spec: dict[str, Any]) -> dict[str, Any]:
    code = spec["siope"]["code"]
    payload = SIOPE_FILE.read_bytes()
    data = json.loads(payload)
    if data["unit"] != "EUR-cent" or data["accountingBasis"] != "cash":
        raise LicenceError("SIOPE: unità o base contabile inattese")
    years: dict[int, dict[str, Any]] = {}

    def walk(node: Any, year: int, entity: str) -> None:
        if isinstance(node, dict):
            if node.get("code") == code:
                if node.get("label") != spec["siope"]["label"]:
                    raise LicenceError(f"SIOPE: etichetta del codice {code} cambiata")
                entry = years.setdefault(year, {"year": year, "cents": 0, "entities": set(), "months": None})
                entry["cents"] += node["amountCents"]
                entry["entities"].add(entity)
            for value in node.values():
                walk(value, year, entity)
        elif isinstance(node, list):
            for value in node:
                walk(value, year, entity)

    months: dict[int, list[int]] = {}
    for entity in data["entities"]:
        for year in entity["years"]:
            months.setdefault(year["year"], year["monthsObserved"])
            walk(year["titles"], year["year"], entity["codiceIpa"])
    result = []
    for year in sorted(years):
        entry = years[year]
        result.append({"year": year, "cents": entry["cents"], "entities": len(entry["entities"]), "monthsObserved": len(months[year])})
    return {
        "code": code,
        "label": spec["siope"]["label"],
        "entityType": "ASL",
        "byYear": result,
        "releaseId": data["releaseId"],
        "fileSha256": sha256_bytes(payload),
    }


# ── assemblaggio ─────────────────────────────────────────────────────────────

def build(spec: dict[str, Any], cache: Path) -> dict[str, Any]:
    names = ipa_names(spec, cache)
    data = {
        "schemaVersion": 1,
        "datasetId": spec["datasetId"],
        "sources": {
            "consip": {key: spec["consip"][key] for key in ("owner", "landingUrl", "license", "licenseUrl", "acquiredAt")}
            | {"assets": {key: {k: asset[k] for k in ("url", "sha256", "lastModified")} for key, asset in spec["consip"]["assets"].items()}},
            "anac": {key: spec["anac"][key] for key in ("owner", "landingUrl", "license", "licenseUrl", "cohort")},
            "siope": {key: spec["siope"][key] for key in ("owner", "landingUrl", "license")},
            "ipa": {key: spec["ipa"][key] for key in ("url", "sha256", "acquiredAt", "license")},
        },
        "partialYear": spec["consip"]["partialYear"],
        "consip": {
            "families": [{key: family[key] for key in ("id", "label")} for family in spec["consip"]["families"]],
            "conventions": consip_conventions(spec, cache),
            "mepa": consip_mepa(spec, cache),
            "mepaCategories": spec["consip"]["mepaCategories"],
        },
        "anac": anac_division(spec, names),
        "siope": siope_licences(spec),
    }
    for year in data["consip"]["conventions"]:
        expected = spec["expected"]["conventionsMinCents"].get(str(year["year"]))
        if expected is not None and year["cents"] < expected:
            raise LicenceError(f"Consip {year['year']}: totale sotto la soglia attesa")
    return data


def serialize(data: dict[str, Any]) -> bytes:
    return (json.dumps(data, ensure_ascii=False, separators=(",", ":")) + "\n").encode("utf-8")


def fetch(spec: dict[str, Any], cache: Path) -> None:
    cache.mkdir(parents=True, exist_ok=True)
    targets = [(asset["url"], asset["file"]) for asset in spec["consip"]["assets"].values()] + [(spec["ipa"]["url"], spec["ipa"]["file"])]
    for url, name in targets:
        if (cache / name).exists():
            continue
        request = urllib.request.Request(url, headers={"User-Agent": USER_AGENT})
        with urllib.request.urlopen(request, timeout=180) as response:  # noqa: S310 - URL fissato nello spec
            (cache / name).write_bytes(response.read())


def main() -> int:
    parser = argparse.ArgumentParser(description=__doc__.splitlines()[0])
    parser.add_argument("--spec", type=Path, default=DEFAULT_SPEC)
    parser.add_argument("--cache", type=Path, default=DEFAULT_CACHE)
    parser.add_argument("--fetch", action="store_true")
    parser.add_argument("--write", action="store_true")
    parser.add_argument("--code-sha")
    args = parser.parse_args()
    spec = json.loads(args.spec.read_text(encoding="utf-8"))
    try:
        if args.fetch:
            fetch(spec, args.cache)
        data = build(spec, args.cache)
    except (LicenceError, FileNotFoundError) as error:
        print(f"pa-licenze-software: {error}", file=sys.stderr)
        return 1
    payload = serialize(data)
    if args.write:
        if not args.code_sha or not re.fullmatch(r"[0-9a-f]{40}", args.code_sha):
            print("pa-licenze-software: --write richiede --code-sha di 40 caratteri", file=sys.stderr)
            return 1
        DEFAULT_OUTPUT.write_bytes(payload)
        receipt = {
            "schemaVersion": 1,
            "documentPath": DEFAULT_OUTPUT.relative_to(ROOT).as_posix(),
            "codeSha": args.code_sha,
            "sourceSha256": sha256_bytes(payload),
            "sourceBytes": len(payload),
            "consipYears": spec["consip"]["years"],
            "anacCohort": spec["anac"]["cohort"],
        }
        DEFAULT_RECEIPT.write_text(json.dumps(receipt, ensure_ascii=False, indent=2) + "\n", encoding="utf-8")
    print(f"pa-licenze-software: payload {len(payload)} byte, sha256 {sha256_bytes(payload)}")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
