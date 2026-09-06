#!/usr/bin/env python3
"""Build verified SIOPE payment projections for non-municipal territorial entities.

The municipal ETL remains the owner of municipal payments and receipts.  This
module deliberately reuses its transport, ZIP and integer-cent primitives but
keeps the different entity and accounting-compartment policies explicit.
"""
from __future__ import annotations

import argparse
import csv
import gzip
import hashlib
import json
import os
import re
import stat
import tempfile
from collections import defaultdict
from dataclasses import dataclass
from datetime import date, datetime, timezone
from pathlib import Path
from typing import Iterable

try:
    from . import siope_municipal_core as core
except ImportError:  # direct CLI execution
    import siope_municipal_core as core

YEARS = (2024, 2025, 2026)
SIOPE_OWNER = "Ragioneria Generale dello Stato · banca dati gestita da Banca d'Italia"
DEFAULT_DETAIL_PATH = Path("src/data/generated/siope-nonmunicipal-detail.json")
DEFAULT_VIEW_PROOF_PATH = Path("src/data/generated/siope-nonmunicipal-view-proof.json")
DEFAULT_CATALOG_PATH = Path("src/data/generated/integrated/catalog.json")
DEFAULT_ROWS_DIR = Path("src/data/generated/integrated/rows")
DEFAULT_RECEIPTS_DIR = Path("data/source-ledger/datasets")
DEFAULT_DATASET_PROOF_PATH = Path("data/source-ledger/dataset-proof.json")
DEFAULT_RELEASE_PROOF_PATH = Path("data/source-ledger/release-proof.json")
REPO_ROOT = Path(__file__).resolve().parents[2]
CANONICAL_INPUT_URLS = {
    "SIOPE_ANAGRAFICHE.zip": f"{core.SIOPE_BASE}/{core.SIOPE_REGISTRY_FILE}",
    "amministrazioni.txt": core.IPA_ADMINISTRATIONS_URL,
    **{f"SIOPE_USCITE.{year}.zip": f"{core.SIOPE_BASE}/SIOPE_USCITE.{year}.zip" for year in YEARS},
}

@dataclass(frozen=True)
class ScopePolicy:
    key: str
    entity_type: str
    compartment: str
    dataset_id: str
    title: str

POLICIES = (
    ScopePolicy("province", "PROVINCIA", "PRO", "siope-uscite-province", "Pagamenti SIOPE delle Province"),
    ScopePolicy("regioni", "REGIONE", "REG", "siope-uscite-regioni", "Pagamenti SIOPE delle Regioni"),
    ScopePolicy("citta-metropolitane", "CITTA_METROP", "PRO", "siope-uscite-citta-metropolitane", "Pagamenti SIOPE delle Città metropolitane"),
)
POLICY_BY_TYPE = {item.entity_type: item for item in POLICIES}
TITLE_LABELS = {
    "0": "Pagamenti da regolarizzare", "1": "Spese correnti",
    "2": "Spese in conto capitale", "3": "Spese per incremento di attività finanziarie",
    "4": "Rimborso prestiti", "5": "Chiusura anticipazioni da tesoriere/cassiere",
    "7": "Uscite per conto terzi e partite di giro",
}
INVENTORY_HEADERS = (
    "entityType", "year", "registryRows", "distinctSiopeCodes", "distinctTaxCodes",
    "validAtObservationCodes", "observedSiopeCodes", "withoutMovementsCodes", "observedMonths",
    "rawMovementRows", "knownAmountCents", "ipaMatched", "ipaUnmatched", "ipaAmbiguous",
    "ipaMatchedAmountCents", "ipaUnmatchedAmountCents", "ipaAmbiguousAmountCents", "coverageStatus",
    "coverageNote", "productStatus",
)
PAYMENT_HEADERS = (
    "entityCode", "taxCode", "codiceIpa", "entityType", "entityName", "validFrom", "validTo",
    "region", "province", "ipaJoinStatus", "regionJoinStatus", "year", "month", "managementCode",
    "compartment", "managementLabel", "titleCode", "titleLabel", "amountCents",
)

class SiopeNonMunicipalError(RuntimeError):
    pass

def canonical_json(value: object) -> bytes:
    return json.dumps(value, ensure_ascii=False, sort_keys=True, separators=(",", ":"), allow_nan=False).encode("utf-8")

def parse_acquisition_timestamp(value: object, label: str) -> datetime:
    if not isinstance(value, str) or re.fullmatch(r"\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:Z|[+-]\d{2}:\d{2})", value) is None:
        raise SiopeNonMunicipalError(f"{label}: data di acquisizione non valida")
    try:
        parsed = datetime.fromisoformat(value.replace("Z", "+00:00"))
    except ValueError as error:
        raise SiopeNonMunicipalError(f"{label}: data di acquisizione non valida") from error
    if parsed.tzinfo is None or parsed.utcoffset() is None or parsed.astimezone(timezone.utc).date() > datetime.now(timezone.utc).date():
        raise SiopeNonMunicipalError(f"{label}: data di acquisizione non valida")
    return parsed

def load_and_verify_input_receipt(input_dir: Path, receipt_path: Path, acquired_at: str) -> tuple[dict, dict[str, tuple[int, int, int, int, int]]]:
    """Verify every acquired byte against an explicit immutable receipt before parsing."""
    try:
        payload = receipt_path.read_bytes()
        receipt = json.loads(payload)
    except (OSError, UnicodeDecodeError, json.JSONDecodeError) as error:
        raise SiopeNonMunicipalError("Ricevuta input SIOPE illeggibile") from error
    if payload != canonical_json(receipt) + b"\n":
        raise SiopeNonMunicipalError("Ricevuta input SIOPE non canonica")
    validate_input_receipt_metadata(receipt, acquired_at)
    tokens: dict[str, tuple[int, int, int, int, int]] = {}
    for name, item in receipt["files"].items():
        path = input_dir / name
        try:
            metadata = path.lstat()
        except OSError as error:
            raise SiopeNonMunicipalError(f"Input SIOPE mancante: {name}") from error
        if stat.S_ISLNK(metadata.st_mode) or not stat.S_ISREG(metadata.st_mode) or metadata.st_size != item["bytes"] or sha256_path(path) != item["sha256"]:
            raise SiopeNonMunicipalError(f"Ricevuta input SIOPE: byte input divergenti per {name}")
        tokens[name] = (metadata.st_dev, metadata.st_ino, metadata.st_size, metadata.st_mtime_ns, metadata.st_ctime_ns)
    return receipt, tokens

def validate_input_receipt_metadata(receipt: dict, acquired_at: str) -> None:
    if not isinstance(receipt, dict) or set(receipt) != {"schemaVersion", "scope", "files"} or receipt.get("schemaVersion") != 1 or receipt.get("scope") != "non-municipal-payments-inputs":
        raise SiopeNonMunicipalError("Ricevuta input SIOPE non canonica o con schema divergente")
    parse_acquisition_timestamp(acquired_at, "acquired-at")
    files = receipt.get("files")
    if not isinstance(files, dict) or set(files) != set(CANONICAL_INPUT_URLS):
        raise SiopeNonMunicipalError("Ricevuta input SIOPE: insieme file divergente")
    for name, expected_url in CANONICAL_INPUT_URLS.items():
        item = files.get(name)
        if not isinstance(item, dict) or set(item) != {"url", "bytes", "sha256", "acquisitionDate", "etag", "lastModified"}:
            raise SiopeNonMunicipalError(f"Ricevuta input SIOPE: schema divergente per {name}")
        if item.get("url") != expected_url or item.get("acquisitionDate") != acquired_at:
            raise SiopeNonMunicipalError(f"Ricevuta input SIOPE: provenienza divergente per {name}")
        parse_acquisition_timestamp(item["acquisitionDate"], name)
        if not isinstance(item.get("bytes"), int) or isinstance(item.get("bytes"), bool) or item["bytes"] <= 0 or not isinstance(item.get("sha256"), str) or re.fullmatch(r"[a-f0-9]{64}", item["sha256"]) is None:
            raise SiopeNonMunicipalError(f"Ricevuta input SIOPE: byte/hash non validi per {name}")
        if item.get("etag") is not None and (not isinstance(item["etag"], str) or not item["etag"]):
            raise SiopeNonMunicipalError(f"Ricevuta input SIOPE: ETag non valido per {name}")
        if item.get("lastModified") is not None and (not isinstance(item["lastModified"], str) or not item["lastModified"]):
            raise SiopeNonMunicipalError(f"Ricevuta input SIOPE: Last-Modified non valido per {name}")


def verify_inputs_unchanged(input_dir: Path, tokens: dict[str, tuple[int, int, int, int, int]]) -> None:
    for name, expected in tokens.items():
        try:
            metadata = (input_dir / name).lstat()
        except OSError as error:
            raise SiopeNonMunicipalError(f"Input SIOPE cambiato durante il parsing: {name}") from error
        actual = (metadata.st_dev, metadata.st_ino, metadata.st_size, metadata.st_mtime_ns, metadata.st_ctime_ns)
        if actual != expected:
            raise SiopeNonMunicipalError(f"Input SIOPE cambiato durante il parsing: {name}")

@dataclass(frozen=True)
class EntityIdentity:
    code: str
    valid_from: date
    valid_to: date
    tax_code: str | None
    name: str
    raw_region_code: str
    province_code: str
    entity_type: str

@dataclass(frozen=True)
class IpaJoin:
    codice_ipa: str | None
    codice_ipa_status: str
    region: str | None
    region_status: str

@dataclass(frozen=True)
class ManagementCode:
    code: str
    compartment: str
    label: str
    valid_from: date
    valid_to: date

def sha256_path(path: Path) -> str:
    digest = hashlib.sha256()
    with path.open("rb") as handle:
        for chunk in iter(lambda: handle.read(1 << 20), b""):
            digest.update(chunk)
    return digest.hexdigest()

def safe_add(left: int, right: int) -> int:
    return core.safe_cents(left + right)

def month_interval(year: int, month: int) -> tuple[date, date]:
    if not 1 <= month <= 12:
        raise SiopeNonMunicipalError("SIOPE: mese non valido")
    first = date(year, month, 1)
    last = date(year + (month == 12), 1 if month == 12 else month + 1, 1)
    return first, date.fromordinal(last.toordinal() - 1)

def load_identities(registry_zip: Path) -> tuple[list[EntityIdentity], dict[str, str]]:
    identities: list[EntityIdentity] = []
    provinces = core.parse_siope_provinces(registry_zip)
    for row in core.zip_rows(registry_zip, "ANAG_ENTI_SIOPE"):
        if len(row) != 9:
            raise SiopeNonMunicipalError("ANAG_ENTI_SIOPE: schema inatteso")
        code, raw_from, raw_to, raw_tax, raw_name, raw_region, province, _population, raw_type = (value.strip() for value in row)
        try:
            valid_from = date.fromisoformat(raw_from)
            valid_to = date.fromisoformat(raw_to)
        except ValueError as error:
            raise SiopeNonMunicipalError(f"ANAG_ENTI_SIOPE: validità non valida per {code or raw_tax}") from error
        if valid_from > valid_to or not code or not raw_type:
            raise SiopeNonMunicipalError("ANAG_ENTI_SIOPE: identità incompleta")
        identities.append(EntityIdentity(
            code=code, valid_from=valid_from, valid_to=valid_to,
            tax_code=raw_tax or None, name=raw_name or "Ente non indicato",
            raw_region_code=raw_region, province_code=province,
            entity_type=raw_type,
        ))
    return identities, provinces

def ipa_joins(ipa_path: Path) -> dict[str, IpaJoin]:
    index, rows = core.ipa_rows(ipa_path)
    required = {"cf", "cod_amm", "regione"}
    if not required <= set(index):
        raise SiopeNonMunicipalError("Schema IPA inatteso: mancano cf/cod_amm/regione")
    codes: dict[str, set[str]] = defaultdict(set)
    regions: dict[str, set[str]] = defaultdict(set)
    for row in rows:
        cf = row[index["cf"]].strip()
        if not cf:
            continue
        code = row[index["cod_amm"]].strip()
        region = " ".join(row[index["regione"]].split())
        if code:
            codes[cf].add(code)
        if region:
            regions[cf].add(region)
    result: dict[str, IpaJoin] = {}
    for cf in codes.keys() | regions.keys():
        candidate_codes, candidate_regions = codes[cf], regions[cf]
        result[cf] = IpaJoin(
            next(iter(candidate_codes)) if len(candidate_codes) == 1 else None,
            "matched" if len(candidate_codes) == 1 else "unmatched" if not candidate_codes else "ambiguous",
            next(iter(candidate_regions)) if len(candidate_regions) == 1 else None,
            "matched" if len(candidate_regions) == 1 else "unmatched" if not candidate_regions else "ambiguous",
        )
    return result

def load_management_codes(registry_zip: Path) -> dict[tuple[str, str], list[ManagementCode]]:
    result: dict[tuple[str, str], list[ManagementCode]] = defaultdict(list)
    for row in core.zip_rows(registry_zip, "ANAG_CODGEST_USCITE"):
        if len(row) != 5:
            raise SiopeNonMunicipalError("ANAG_CODGEST_USCITE: schema inatteso")
        code, compartment, label, raw_from, raw_to = (value.strip() for value in row)
        try:
            valid_from, valid_to = date.fromisoformat(raw_from), date.fromisoformat(raw_to)
        except ValueError as error:
            raise SiopeNonMunicipalError(f"ANAG_CODGEST_USCITE: validità non valida per {code}") from error
        if not code or not compartment or not label or valid_from > valid_to:
            raise SiopeNonMunicipalError("ANAG_CODGEST_USCITE: riga incompleta")
        result[(code, compartment)].append(ManagementCode(code, compartment, label, valid_from, valid_to))
    return result

def annual_identities(identities: Iterable[EntityIdentity], year: int) -> dict[str, list[EntityIdentity]]:
    first, last = date(year, 1, 1), date(year, 12, 31)
    result: dict[str, list[EntityIdentity]] = defaultdict(list)
    for identity in identities:
        if identity.valid_from <= last and identity.valid_to >= first:
            result[identity.code].append(identity)
    return result

def resolve_identity(candidates: list[EntityIdentity], year: int, month: int) -> EntityIdentity | None:
    first, last = month_interval(year, month)
    matching = [item for item in candidates if item.valid_from <= last and item.valid_to >= first]
    if not matching:
        return None
    signatures = {(item.tax_code, item.name, item.entity_type, item.raw_region_code, item.province_code) for item in matching}
    if len(signatures) != 1:
        raise SiopeNonMunicipalError("SIOPE: identità mensile ambigua")
    return sorted(matching, key=lambda item: (item.valid_from, item.valid_to), reverse=True)[0]

def resolve_management(codes: dict[tuple[str, str], list[ManagementCode]], code: str, compartment: str, year: int, month: int) -> ManagementCode:
    first, last = month_interval(year, month)
    matching = [item for item in codes.get((code, compartment), []) if item.valid_from <= last and item.valid_to >= first]
    if len(matching) != 1:
        raise SiopeNonMunicipalError(f"SIOPE: codice gestionale non univoco o ignoto per comparto {compartment}: {code}")
    return matching[0]

def title_code(management_code: str) -> str:
    value = management_code.split(".", 1)[0]
    if not value.isdigit():
        raise SiopeNonMunicipalError(f"SIOPE: titolo non derivabile da {management_code}")
    if value not in TITLE_LABELS:
        raise SiopeNonMunicipalError(f"SIOPE: titolo non verificato per {management_code}")
    return value

def iter_movements(path: Path, year: int):
    for row in core.zip_rows(path, "USCITE"):
        if len(row) != 5:
            raise SiopeNonMunicipalError("SIOPE_USCITE: schema inatteso")
        entity_code, raw_year, raw_month, management_code, raw_amount = (value.strip() for value in row)
        if raw_year != str(year):
            raise SiopeNonMunicipalError("SIOPE_USCITE: anno divergente")
        if not raw_month.isdigit() or not 1 <= int(raw_month) <= 12:
            raise SiopeNonMunicipalError("SIOPE_USCITE: mese non valido")
        yield entity_code, int(raw_month), management_code, core.parse_amount(raw_amount)

def inventory_and_rows(*, year: int, movement_zip: Path, identities: list[EntityIdentity], known_types: set[str], joins: dict[str, IpaJoin], provinces: dict[str, str], management_codes: dict[tuple[str, str], list[ManagementCode]], observation_date: date) -> tuple[list[dict[str, str]], dict[str, list[dict[str, str | None]]], dict[str, dict]]:
    annual = annual_identities(identities, year)
    all_by_code: dict[str, list[EntityIdentity]] = defaultdict(list)
    for item in identities:
        all_by_code[item.code].append(item)
    by_type: dict[str, list[EntityIdentity]] = defaultdict(list)
    for group in annual.values():
        for item in group:
            by_type[item.entity_type].append(item)
    metrics: dict[str, dict] = {}
    for entity_type in known_types:
        group = by_type.get(entity_type, [])
        codes = {item.code for item in group}
        taxes = {item.tax_code for item in group if item.tax_code}
        join_counts = CounterForJoin(group, joins)
        metrics[entity_type] = {
            "registry_rows": len(group), "codes": codes, "taxes": taxes,
            "current": {item.code for item in group if item.valid_from <= observation_date <= item.valid_to},
            "months": set(), "movement_rows": 0, "amount": 0,
            "observed": set(), "join_counts": join_counts, "join_amounts": {"matched": 0, "unmatched": 0, "ambiguous": 0},
        }
    unresolved = {
        "unknownCode": {"rows": 0, "amountCents": 0},
        "outsideValidity": {"rows": 0, "amountCents": 0},
    }
    payments = {policy.key: [] for policy in POLICIES}
    seen = {policy.key: set() for policy in POLICIES}
    for code, month, management_code, amount in iter_movements(movement_zip, year):
        candidates = all_by_code.get(code, [])
        identity = resolve_identity(candidates, year, month) if candidates else None
        if identity is None:
            reason = "outsideValidity" if candidates else "unknownCode"
            unresolved[reason]["rows"] += 1
            unresolved[reason]["amountCents"] = safe_add(unresolved[reason]["amountCents"], amount)
            continue
        metric = metrics[identity.entity_type]
        metric["months"].add(month); metric["movement_rows"] += 1; metric["amount"] = safe_add(metric["amount"], amount); metric["observed"].add(code)
        join = joins.get(identity.tax_code or "", IpaJoin(None, "unmatched", None, "unmatched"))
        metric["join_amounts"][join.codice_ipa_status] = safe_add(metric["join_amounts"][join.codice_ipa_status], amount)
        policy = POLICY_BY_TYPE.get(identity.entity_type)
        if policy is None:
            continue
        key = (code, year, month, management_code)
        if key in seen[policy.key]:
            raise SiopeNonMunicipalError("SIOPE: chiave movimento duplicata")
        seen[policy.key].add(key)
        management = resolve_management(management_codes, management_code, policy.compartment, year, month)
        payments[policy.key].append({
            "entityCode": identity.code, "taxCode": identity.tax_code, "codiceIpa": join.codice_ipa,
            "entityType": identity.entity_type, "entityName": identity.name,
            "validFrom": identity.valid_from.isoformat(), "validTo": identity.valid_to.isoformat(),
            "region": join.region, "province": provinces.get(identity.province_code),
            "ipaJoinStatus": join.codice_ipa_status, "regionJoinStatus": join.region_status,
            "year": str(year), "month": str(month), "managementCode": management.code,
            "compartment": policy.compartment, "managementLabel": management.label,
            "titleCode": title_code(management.code), "titleLabel": TITLE_LABELS[title_code(management.code)], "amountCents": str(amount),
        })
    inventory: list[dict[str, str]] = []
    for entity_type in sorted(metrics):
        metric = metrics[entity_type]
        policy = POLICY_BY_TYPE.get(entity_type)
        unresolved_rows = unresolved["unknownCode"]["rows"] + unresolved["outsideValidity"]["rows"]
        coverage = "partial" if unresolved_rows else "complete"
        note = (
            "Movimenti non attribuiti a un tipo: "
            f"codice sconosciuto {unresolved['unknownCode']['rows']} righe / {unresolved['unknownCode']['amountCents']} centesimi; "
            f"validità mancante {unresolved['outsideValidity']['rows']} righe / {unresolved['outsideValidity']['amountCents']} centesimi."
            if unresolved_rows else "Anagrafica e movimenti annuali letti integralmente"
        )
        inventory.append({
            "entityType": entity_type, "year": str(year), "registryRows": str(metric["registry_rows"]),
            "distinctSiopeCodes": str(len(metric["codes"])), "distinctTaxCodes": str(len(metric["taxes"])),
            "validAtObservationCodes": str(len(metric["current"])), "observedSiopeCodes": str(len(metric["observed"])),
            "withoutMovementsCodes": str(len(metric["codes"] - metric["observed"])),
            "observedMonths": ",".join(str(value) for value in sorted(metric["months"])),
            "rawMovementRows": str(metric["movement_rows"]), "knownAmountCents": str(metric["amount"]),
            "ipaMatched": str(metric["join_counts"]["matched"]), "ipaUnmatched": str(metric["join_counts"]["unmatched"]),
            "ipaAmbiguous": str(metric["join_counts"]["ambiguous"]),
            "ipaMatchedAmountCents": str(metric["join_amounts"]["matched"]), "ipaUnmatchedAmountCents": str(metric["join_amounts"]["unmatched"]),
            "ipaAmbiguousAmountCents": str(metric["join_amounts"]["ambiguous"]), "coverageStatus": coverage,
            "coverageNote": note, "productStatus": "published-payments" if policy else "census-only",
        })
    metrics["unresolvedMovements"] = unresolved
    return inventory, payments, metrics

def CounterForJoin(group: list[EntityIdentity], joins: dict[str, IpaJoin]) -> dict[str, int]:
    result = {"matched": 0, "unmatched": 0, "ambiguous": 0}
    for code in {item.code for item in group}:
        identity = next(item for item in group if item.code == code)
        status = joins.get(identity.tax_code or "", IpaJoin(None, "unmatched", None, "unmatched")).codice_ipa_status
        result[status] += 1
    return result

def write_tsv(path: Path, headers: tuple[str, ...], rows: Iterable[dict[str, str | None]]) -> None:
    path.parent.mkdir(parents=True, exist_ok=True)
    with path.open("w", encoding="utf-8", newline="") as handle:
        writer = csv.DictWriter(handle, fieldnames=headers, delimiter="|", lineterminator="\n", extrasaction="raise")
        writer.writeheader(); writer.writerows(rows)

def source_metadata(receipt: dict, year: int, acquired_at: str) -> dict:
    movement = receipt["files"][f"SIOPE_USCITE.{year}.zip"]
    registry = receipt["files"]["SIOPE_ANAGRAFICHE.zip"]
    ipa = receipt["files"]["amministrazioni.txt"]
    return {
        "siopeOwner": SIOPE_OWNER, "siopeMovementsUrl": movement["url"],
        "siopeRegistryUrl": registry["url"], "ipaUrl": ipa["url"],
        "siopeMovementsSha256": movement["sha256"], "siopeRegistrySha256": registry["sha256"], "ipaSha256": ipa["sha256"],
        "acquisitionDate": acquired_at, "publicationDate": None, "license": "not-declared",
    }

def build_entity_detail(*, identities: list[EntityIdentity], joins: dict[str, IpaJoin], payments: dict[str, list[dict[str, str | None]]], sources: dict[str, dict], release_id: str) -> dict:
    entities: list[dict] = []
    grouped: dict[tuple[str, str, str], list[EntityIdentity]] = defaultdict(list)
    types_by_public_identity: dict[tuple[str, str], set[str]] = defaultdict(set)
    for identity in identities:
        if identity.entity_type not in POLICY_BY_TYPE or not identity.tax_code:
            continue
        join = joins.get(identity.tax_code)
        if join and join.codice_ipa_status == "matched" and join.codice_ipa:
            grouped[(identity.tax_code, join.codice_ipa, identity.entity_type)].append(identity)
            types_by_public_identity[(identity.tax_code, join.codice_ipa)].add(identity.entity_type)
    if any(len(types) > 1 for types in types_by_public_identity.values()):
        raise SiopeNonMunicipalError("SIOPE: lo stesso CF/IPA attraversa tipi distinti")
    all_rows = [row for values in payments.values() for row in values]
    for (tax_code, codice_ipa, entity_type), group in grouped.items():
        codes = sorted({item.code for item in group})
        identity_signatures = {(item.code, item.valid_from.isoformat(), item.valid_to.isoformat()) for item in group}
        observed_rows = [row for row in all_rows if row["taxCode"] == tax_code and row["codiceIpa"] == codice_ipa and row["entityType"] == entity_type and (row["entityCode"], row["validFrom"], row["validTo"]) in identity_signatures]
        current = max(group, key=lambda item: (item.valid_to, item.valid_from, item.name))
        years = []
        for year in sorted(YEARS, reverse=True):
            first, last = date(year, 1, 1), date(year, 12, 31)
            active_codes = {item.code for item in group if item.valid_from <= last and item.valid_to >= first}
            rows = [row for row in observed_rows if row["year"] == str(year) and row["entityCode"] in active_codes]
            if not active_codes:
                status, amount = "outside_period", None
            elif not rows:
                status, amount = "no_movements", None
            else:
                status, amount = "available", 0
                for row in rows:
                    amount = safe_add(amount, int(row["amountCents"] or "0"))
            monthly: dict[int, int] = defaultdict(int); titles: dict[tuple[str, str], int] = defaultdict(int)
            for row in rows:
                month = int(row["month"] or "0")
                monthly[month] = safe_add(monthly[month], int(row["amountCents"] or "0"))
                title_key = (row["titleCode"] or "", row["titleLabel"] or "")
                titles[title_key] = safe_add(titles[title_key], int(row["amountCents"] or "0"))
            years.append({
                "year": year, "status": status, "amountCents": amount,
                "monthsObserved": sorted(monthly),
                "monthly": [{"month": month, "amountCents": monthly[month]} for month in sorted(monthly)],
                "titles": [{"code": code, "label": label, "amountCents": value} for (code, label), value in sorted(titles.items())],
                "provenance": sources[str(year)],
                "caveats": ["Pagamenti di cassa dell'amministrazione, non spesa consolidata nel territorio.", "La sede legale non indica il destinatario del pagamento."],
            })
        entities.append({"codiceIpa": codice_ipa, "taxCode": tax_code, "entityType": current.entity_type, "entityName": current.name, "includedCodes": codes, "years": years})
    entities.sort(key=lambda item: item["codiceIpa"])
    return {"schemaVersion": 1, "scope": "non-municipal-payments", "flow": "uscite", "unit": "EUR-cent", "accountingBasis": "cash", "releaseId": release_id, "entities": entities}

def projection_metadata(path: Path) -> dict[str, int | str]:
    try:
        payload = path.read_bytes()
    except OSError as error:
        raise SiopeNonMunicipalError(f"Proiezione SIOPE mancante: {path.name}") from error
    return {"bytes": len(payload), "sha256": hashlib.sha256(payload).hexdigest(), "rows": max(0, len(payload.splitlines()) - 1)}

def build_release(*, input_dir: Path, input_receipt: Path, output_dir: Path, acquired_at: str) -> dict:
    observation = parse_acquisition_timestamp(acquired_at, "acquired-at").date()
    receipt, input_tokens = load_and_verify_input_receipt(input_dir, input_receipt, acquired_at)
    registry = input_dir / "SIOPE_ANAGRAFICHE.zip"; ipa = input_dir / "amministrazioni.txt"
    identities, provinces = load_identities(registry)
    joins, management_codes = ipa_joins(ipa), load_management_codes(registry)
    all_inventory: list[dict[str, str]] = []; all_payments = {policy.key: [] for policy in POLICIES}; all_metrics = {}
    sources = {}
    for year in YEARS:
        inventory, payments, metrics = inventory_and_rows(year=year, movement_zip=input_dir / f"SIOPE_USCITE.{year}.zip", identities=identities, known_types={item.entity_type for item in identities}, joins=joins, provinces=provinces, management_codes=management_codes, observation_date=observation)
        all_inventory.extend(inventory); all_metrics[str(year)] = metrics; sources[str(year)] = source_metadata(receipt, year, acquired_at)
        for key, values in payments.items(): all_payments[key].extend(values)
    for policy in POLICIES:
        all_payments[policy.key].sort(key=lambda row: tuple(row[key] or "" for key in ("year", "entityCode", "month", "managementCode")))
    output_dir.mkdir(parents=True, exist_ok=True)
    write_tsv(output_dir / "siope-inventario-enti.psv", INVENTORY_HEADERS, all_inventory)
    for policy in POLICIES:
        write_tsv(output_dir / f"{policy.dataset_id}.psv", PAYMENT_HEADERS, all_payments[policy.key])
    projection_paths = {
        "siope-inventario-enti": output_dir / "siope-inventario-enti.psv",
        **{policy.dataset_id: output_dir / f"{policy.dataset_id}.psv" for policy in POLICIES},
    }
    projections = {dataset_id: projection_metadata(path) for dataset_id, path in sorted(projection_paths.items())}
    input_receipt_sha256 = hashlib.sha256(canonical_json(receipt) + b"\n").hexdigest()
    release_id = hashlib.sha256(canonical_json({"inputReceiptSha256": input_receipt_sha256, "projections": projections, "sources": sources})).hexdigest()
    detail = build_entity_detail(identities=identities, joins=joins, payments=all_payments, sources=sources, release_id=release_id)
    manifest = {
        "schemaVersion": 2, "scope": "non-municipal-payments", "flow": "uscite", "unit": "EUR-cent", "accountingBasis": "cash",
        "releaseId": release_id, "acquiredAt": acquired_at, "inputReceiptSha256": input_receipt_sha256, "inputReceipt": receipt,
        "sources": sources, "projections": projections, "inventoryRows": len(all_inventory),
        "paymentRows": {policy.key: len(all_payments[policy.key]) for policy in POLICIES},
        "unresolvedMovements": {year: all_metrics[year]["unresolvedMovements"] for year in sorted(all_metrics)},
    }
    (output_dir / "siope-nonmunicipal-release.json").write_bytes(canonical_json(manifest) + b"\n")
    (output_dir / "siope-nonmunicipal-detail.json").write_bytes(canonical_json(detail) + b"\n")
    verify_inputs_unchanged(input_dir, input_tokens)
    validate_candidate_detail(
        detail_path=output_dir / "siope-nonmunicipal-detail.json",
        projection_dir=output_dir,
        manifest_path=output_dir / "siope-nonmunicipal-release.json",
    )
    return manifest

def _load_and_validate_detail(path: Path) -> dict:
    try:
        detail = json.loads(path.read_text(encoding="utf-8"))
    except (OSError, json.JSONDecodeError) as error:
        raise SiopeNonMunicipalError("Dettaglio SIOPE non municipale illeggibile") from error
    expected = {"schemaVersion", "scope", "flow", "unit", "accountingBasis", "releaseId", "entities"}
    if not isinstance(detail, dict) or set(detail) != expected:
        raise SiopeNonMunicipalError("Dettaglio SIOPE non municipale: schema divergente")
    if detail.get("schemaVersion") != 1 or detail.get("scope") != "non-municipal-payments" or detail.get("flow") != "uscite" or detail.get("unit") != "EUR-cent" or detail.get("accountingBasis") != "cash" or not isinstance(detail.get("releaseId"), str) or re.fullmatch(r"[a-f0-9]{64}", detail["releaseId"]) is None:
        raise SiopeNonMunicipalError("Dettaglio SIOPE non municipale: contratto divergente")
    entities = detail.get("entities")
    if not isinstance(entities, list) or not entities:
        raise SiopeNonMunicipalError("Dettaglio SIOPE non municipale: enti assenti")
    ipa_codes: set[str] = set()
    for entity in entities:
        if not isinstance(entity, dict) or set(entity) != {"codiceIpa", "taxCode", "entityType", "entityName", "includedCodes", "years"}:
            raise SiopeNonMunicipalError("Dettaglio SIOPE non municipale: ente divergente")
        ipa = entity["codiceIpa"]
        if not isinstance(ipa, str) or not ipa or ipa in ipa_codes or entity["entityType"] not in POLICY_BY_TYPE or not isinstance(entity["taxCode"], str) or not entity["taxCode"] or not isinstance(entity["entityName"], str) or not entity["entityName"]:
            raise SiopeNonMunicipalError("Dettaglio SIOPE non municipale: identità divergente")
        ipa_codes.add(ipa)
        codes, years = entity["includedCodes"], entity["years"]
        if not isinstance(codes, list) or not codes or codes != sorted(set(codes)) or not isinstance(years, list) or [item.get("year") if isinstance(item, dict) else None for item in years] != list(sorted(YEARS, reverse=True)):
            raise SiopeNonMunicipalError("Dettaglio SIOPE non municipale: periodo divergente")
        for item in years:
            if set(item) != {"year", "status", "amountCents", "monthsObserved", "monthly", "titles", "provenance", "caveats"} or item["status"] not in {"available", "no_movements", "outside_period"}:
                raise SiopeNonMunicipalError("Dettaglio SIOPE non municipale: annualità divergente")
            amount = item["amountCents"]
            if item["status"] == "available":
                if not isinstance(amount, int) or abs(amount) > core.MAX_SAFE_CENTS:
                    raise SiopeNonMunicipalError("Dettaglio SIOPE non municipale: centesimi divergenti")
            elif amount is not None:
                raise SiopeNonMunicipalError("Dettaglio SIOPE non municipale: assenza trasformata in zero")
            monthly = item["monthly"]; titles = item["titles"]
            if not isinstance(monthly, list) or not isinstance(titles, list) or item["monthsObserved"] != [row.get("month") for row in monthly]:
                raise SiopeNonMunicipalError("Dettaglio SIOPE non municipale: aggregati divergenti")
            monthly_total = 0
            for row in monthly:
                if not isinstance(row, dict) or set(row) != {"month", "amountCents"} or not isinstance(row["month"], int) or not 1 <= row["month"] <= 12 or not isinstance(row["amountCents"], int):
                    raise SiopeNonMunicipalError("Dettaglio SIOPE non municipale: mese divergente")
                monthly_total = safe_add(monthly_total, row["amountCents"])
            title_total = 0
            for row in titles:
                if not isinstance(row, dict) or set(row) != {"code", "label", "amountCents"} or row.get("code") not in TITLE_LABELS or row.get("label") != TITLE_LABELS[row["code"]] or not isinstance(row.get("amountCents"), int):
                    raise SiopeNonMunicipalError("Dettaglio SIOPE non municipale: titolo divergente")
                title_total = safe_add(title_total, row["amountCents"])
            if item["status"] == "available" and (monthly_total != amount or title_total != amount):
                raise SiopeNonMunicipalError("Dettaglio SIOPE non municipale: riconciliazione divergente")
            provenance = item.get("provenance")
            if not isinstance(provenance, dict) or set(provenance) != {
                "siopeOwner", "siopeMovementsUrl", "siopeRegistryUrl", "ipaUrl",
                "siopeMovementsSha256", "siopeRegistrySha256", "ipaSha256",
                "acquisitionDate", "publicationDate", "license",
            }:
                raise SiopeNonMunicipalError("Dettaglio SIOPE non municipale: provenienza divergente")
            expected_url = CANONICAL_INPUT_URLS[f"SIOPE_USCITE.{item['year']}.zip"]
            if provenance.get("siopeOwner") != SIOPE_OWNER or provenance.get("siopeMovementsUrl") != expected_url or provenance.get("siopeRegistryUrl") != CANONICAL_INPUT_URLS["SIOPE_ANAGRAFICHE.zip"] or provenance.get("ipaUrl") != CANONICAL_INPUT_URLS["amministrazioni.txt"] or provenance.get("publicationDate") is not None or provenance.get("license") != "not-declared":
                raise SiopeNonMunicipalError("Dettaglio SIOPE non municipale: URL/provenienza non ammessi")
            parse_acquisition_timestamp(provenance.get("acquisitionDate"), "Dettaglio SIOPE")
            for field in ("siopeMovementsSha256", "siopeRegistrySha256", "ipaSha256"):
                digest = provenance.get(field)
                if not isinstance(digest, str) or re.fullmatch(r"[a-f0-9]{64}", digest) is None or len(set(digest)) == 1:
                    raise SiopeNonMunicipalError("Dettaglio SIOPE non municipale: hash provenienza divergente")
    return detail

def _projection_rows(projection_dir: Path) -> Iterable[dict[str, str]]:
    for policy in POLICIES:
        path = projection_dir / f"{policy.dataset_id}.psv"
        try:
            with path.open(encoding="utf-8", newline="") as handle:
                reader = csv.DictReader(handle, delimiter="|")
                if tuple(reader.fieldnames or ()) != PAYMENT_HEADERS:
                    raise SiopeNonMunicipalError(f"Corpus canonico: header divergente per {policy.dataset_id}")
                for row in reader:
                    if row.get("entityType") != policy.entity_type or row.get("compartment") != policy.compartment:
                        raise SiopeNonMunicipalError(f"Corpus canonico: tipo/comparto divergente per {policy.dataset_id}")
                    yield row
        except OSError as error:
            raise SiopeNonMunicipalError(f"Corpus canonico mancante: {policy.dataset_id}") from error

def _reconcile_detail_to_rows(detail: dict, rows: Iterable[dict[str, str]]) -> None:
    aggregates: dict[tuple[str, str, str, int], dict] = {}
    for row in rows:
        if row.get("ipaJoinStatus") != "matched" or not row.get("codiceIpa"):
            continue
        try:
            year, month, amount = int(row["year"]), int(row["month"]), int(row["amountCents"])
        except (KeyError, TypeError, ValueError) as error:
            raise SiopeNonMunicipalError("Corpus canonico: riga monetaria non valida") from error
        key = (row["taxCode"], row["codiceIpa"], row["entityType"], year)
        aggregate = aggregates.setdefault(key, {"amount": 0, "monthly": defaultdict(int), "titles": defaultdict(int), "codes": set()})
        aggregate["amount"] = safe_add(aggregate["amount"], amount)
        aggregate["monthly"][month] = safe_add(aggregate["monthly"][month], amount)
        title = (row["titleCode"], row["titleLabel"])
        aggregate["titles"][title] = safe_add(aggregate["titles"][title], amount)
        aggregate["codes"].add(row["entityCode"])
    entities = {(item["taxCode"], item["codiceIpa"], item["entityType"]): item for item in detail["entities"]}
    for (tax_code, ipa, entity_type, year), expected in aggregates.items():
        entity = entities.get((tax_code, ipa, entity_type))
        if entity is None or not expected["codes"].issubset(set(entity["includedCodes"])):
            raise SiopeNonMunicipalError("Dettaglio SIOPE non municipale: identità divergente dal corpus canonico")
        period = next((item for item in entity["years"] if item["year"] == year), None)
        expected_monthly = [{"month": month, "amountCents": value} for month, value in sorted(expected["monthly"].items())]
        expected_titles = [{"code": code, "label": label, "amountCents": value} for (code, label), value in sorted(expected["titles"].items())]
        if period is None or period["status"] != "available" or period["amountCents"] != expected["amount"] or period["monthly"] != expected_monthly or period["titles"] != expected_titles:
            raise SiopeNonMunicipalError("Dettaglio SIOPE non municipale: totale divergente dal corpus canonico")
    for entity in detail["entities"]:
        key = (entity["taxCode"], entity["codiceIpa"], entity["entityType"])
        for period in entity["years"]:
            if period["status"] == "available" and (*key, period["year"]) not in aggregates:
                raise SiopeNonMunicipalError("Dettaglio SIOPE non municipale: righe assenti dal corpus canonico")

def validate_native_receipt(manifest: dict) -> None:
    receipt = manifest.get("inputReceipt")
    validate_input_receipt_metadata(receipt, manifest.get("acquiredAt"))
    digest = hashlib.sha256(canonical_json(receipt) + b"\n").hexdigest()
    if digest != manifest.get("inputReceiptSha256"):
        raise SiopeNonMunicipalError("Manifest SIOPE: ricevuta input divergente")
    expected_sources = {str(year): source_metadata(receipt, year, manifest["acquiredAt"]) for year in YEARS}
    if manifest.get("sources") != expected_sources:
        raise SiopeNonMunicipalError("Manifest SIOPE: provenienza divergente dalla ricevuta input")
    expected_release = hashlib.sha256(canonical_json({"inputReceiptSha256": digest, "projections": manifest.get("projections"), "sources": expected_sources})).hexdigest()
    if manifest.get("releaseId") != expected_release:
        raise SiopeNonMunicipalError("Manifest SIOPE: release divergente dalla ricevuta input")


def validate_native_provenance(detail: dict, manifest: dict, projections: dict) -> None:
    if manifest.get("releaseId") != detail["releaseId"] or manifest.get("projections") != projections:
        raise SiopeNonMunicipalError("Manifest SIOPE: provenienza/release divergente dal corpus")
    if manifest.get("schemaVersion") == 1 and manifest.get("attestation") == "historical-not-reattested":
        # Freeze the reviewed historical snapshot, without inventing a raw receipt.
        if set(manifest) != {"schemaVersion", "attestation", "releaseId", "detailSha256", "sources", "projections"} or manifest["detailSha256"] != hashlib.sha256(canonical_json(detail) + b"\n").hexdigest():
            raise SiopeNonMunicipalError("Manifest SIOPE: vista storica divergente, necessaria nuova acquisizione")
    elif manifest.get("schemaVersion") == 2:
        validate_native_receipt(manifest)
    else:
        raise SiopeNonMunicipalError("Manifest SIOPE: attestazione non ammessa")
    sources = manifest.get("sources")
    if not isinstance(sources, dict) or set(sources) != {str(year) for year in YEARS}:
        raise SiopeNonMunicipalError("Manifest SIOPE: provenienza annuale mancante")
    for entity in detail["entities"]:
        for period in entity["years"]:
            if period["provenance"] != sources[str(period["year"])]:
                raise SiopeNonMunicipalError("Manifest SIOPE: provenienza divergente fra enti o annualità")


def validate_candidate_detail(*, detail_path: Path, projection_dir: Path, manifest_path: Path) -> dict:
    detail = _load_and_validate_detail(detail_path)
    try:
        payload = manifest_path.read_bytes()
        manifest = json.loads(payload)
    except (OSError, UnicodeDecodeError, json.JSONDecodeError) as error:
        raise SiopeNonMunicipalError("Manifest candidato SIOPE illeggibile") from error
    expected_keys = {"schemaVersion", "scope", "flow", "unit", "accountingBasis", "releaseId", "acquiredAt", "inputReceiptSha256", "inputReceipt", "sources", "projections", "inventoryRows", "paymentRows", "unresolvedMovements"}
    if payload != canonical_json(manifest) + b"\n" or not isinstance(manifest, dict) or set(manifest) != expected_keys or manifest.get("schemaVersion") != 2:
        raise SiopeNonMunicipalError("Manifest candidato SIOPE divergente")
    if any(manifest.get(key) != detail[key] for key in ("scope", "flow", "unit", "accountingBasis")):
        raise SiopeNonMunicipalError("Manifest candidato SIOPE: contratto divergente")
    validate_native_receipt(manifest)
    if manifest.get("releaseId") != detail.get("releaseId"):
        raise SiopeNonMunicipalError("Dettaglio SIOPE non municipale: release mista")
    projection_paths = {
        "siope-inventario-enti": projection_dir / "siope-inventario-enti.psv",
        **{policy.dataset_id: projection_dir / f"{policy.dataset_id}.psv" for policy in POLICIES},
    }
    observed = {dataset_id: projection_metadata(path) for dataset_id, path in sorted(projection_paths.items())}
    if manifest.get("projections") != observed:
        raise SiopeNonMunicipalError("Manifest candidato SIOPE: proiezioni divergenti")
    expected_release = hashlib.sha256(canonical_json({"inputReceiptSha256": manifest.get("inputReceiptSha256"), "projections": observed, "sources": manifest.get("sources")})).hexdigest()
    if manifest.get("releaseId") != expected_release:
        raise SiopeNonMunicipalError("Manifest candidato SIOPE: release divergente")
    provenance_by_year: dict[str, dict] = {}
    for entity in detail["entities"]:
        for period in entity["years"]:
            year = str(period["year"])
            previous = provenance_by_year.setdefault(year, period["provenance"])
            if previous != period["provenance"] or not isinstance(manifest.get("sources"), dict) or manifest["sources"].get(year) != period["provenance"]:
                raise SiopeNonMunicipalError("Dettaglio SIOPE non municipale: provenienza divergente dalla release")
    _reconcile_detail_to_rows(detail, _projection_rows(projection_dir))
    return {"entities": len(detail["entities"]), "releaseId": detail["releaseId"]}

def _load_canonical_object(path: Path, label: str, *, newline: bool) -> tuple[dict, bytes]:
    try:
        payload = path.read_bytes()
        value = json.loads(payload)
    except (OSError, UnicodeDecodeError, json.JSONDecodeError) as error:
        raise SiopeNonMunicipalError(f"{label} illeggibile") from error
    expected = canonical_json(value) + (b"\n" if newline else b"")
    if not isinstance(value, dict) or payload != expected:
        raise SiopeNonMunicipalError(f"{label} non canonico")
    return value, payload

def _artifact_key(path: Path) -> str:
    try:
        return path.resolve().relative_to(REPO_ROOT).as_posix()
    except ValueError as error:
        raise SiopeNonMunicipalError(f"Artifact fuori dal repository: {path}") from error

def _committed_projection_rows(*, catalog_path: Path, rows_dir: Path, receipts_dir: Path, dataset_proof_path: Path) -> Iterable[dict[str, str]]:
    catalog, catalog_payload = _load_canonical_object(catalog_path, "Catalogo corpus", newline=True)
    proof, _ = _load_canonical_object(dataset_proof_path, "Dataset proof", newline=True)
    if proof.get("catalogSha256") != hashlib.sha256(catalog_payload).hexdigest():
        raise SiopeNonMunicipalError("Dataset proof: hash catalogo divergente")
    entries = {item.get("id"): item for item in catalog.get("datasets", []) if isinstance(item, dict)}
    artifact_hashes = proof.get("artifactSha256")
    if not isinstance(artifact_hashes, dict):
        raise SiopeNonMunicipalError("Dataset proof: artifact mancanti")
    for policy in POLICIES:
        entry = entries.get(policy.dataset_id)
        if not isinstance(entry, dict) or not isinstance(entry.get("publicRows"), int):
            raise SiopeNonMunicipalError(f"Catalogo corpus: dataset mancante {policy.dataset_id}")
        receipt_path = receipts_dir / f"{policy.dataset_id}.receipt.json"
        receipt, receipt_payload = _load_canonical_object(receipt_path, f"Ricevuta {policy.dataset_id}", newline=True)
        receipt_key = _artifact_key(receipt_path)
        if artifact_hashes.get(receipt_key) != hashlib.sha256(receipt_payload).hexdigest() or entry.get("receiptSha256") != hashlib.sha256(receipt_payload).hexdigest():
            raise SiopeNonMunicipalError(f"Ricevuta corpus divergente per {policy.dataset_id}")
        uncompressed: list[bytes] = []
        row_count = 0
        ordinal = 0
        while row_count < entry["publicRows"]:
            path = rows_dir / f"{policy.dataset_id}.part-{ordinal:05d}.jsonl.gz"
            try:
                compressed = path.read_bytes()
            except OSError as error:
                raise SiopeNonMunicipalError(f"Chunk corpus mancante per {policy.dataset_id}:{ordinal}") from error
            if artifact_hashes.get(_artifact_key(path)) != hashlib.sha256(compressed).hexdigest():
                raise SiopeNonMunicipalError(f"Chunk corpus divergente per {policy.dataset_id}:{ordinal}")
            try:
                payload = gzip.decompress(compressed)
            except (OSError, EOFError) as error:
                raise SiopeNonMunicipalError(f"Chunk corpus illeggibile per {policy.dataset_id}:{ordinal}") from error
            uncompressed.append(payload)
            for line in payload.splitlines():
                try:
                    public_row = json.loads(line)
                    cells = public_row["cells"]
                except (UnicodeDecodeError, json.JSONDecodeError, KeyError, TypeError) as error:
                    raise SiopeNonMunicipalError(f"Riga corpus illeggibile per {policy.dataset_id}:{ordinal}") from error
                row_count += 1
                yield cells
            ordinal += 1
        if row_count != entry["publicRows"] or hashlib.sha256(b"".join(uncompressed)).hexdigest() != receipt.get("rowsSha256"):
            raise SiopeNonMunicipalError(f"Riconciliazione chunk divergente per {policy.dataset_id}")

def expected_view_proof(*, provenance_path: Path = REPO_ROOT / "src/data/generated/siope-nonmunicipal-provenance.json", detail_path: Path = DEFAULT_DETAIL_PATH, catalog_path: Path = DEFAULT_CATALOG_PATH, receipts_dir: Path = DEFAULT_RECEIPTS_DIR, dataset_proof_path: Path = DEFAULT_DATASET_PROOF_PATH, release_proof_path: Path = DEFAULT_RELEASE_PROOF_PATH) -> dict:
    detail = _load_and_validate_detail(detail_path)
    detail_payload = detail_path.read_bytes()
    catalog, catalog_payload = _load_canonical_object(catalog_path, "Catalogo corpus", newline=True)
    dataset_proof, dataset_proof_payload = _load_canonical_object(dataset_proof_path, "Dataset proof", newline=True)
    release_proof, _ = _load_canonical_object(release_proof_path, "Release proof", newline=True)
    entries = {item.get("id"): item for item in catalog.get("datasets", []) if isinstance(item, dict)}
    dataset_ids = ["siope-inventario-enti", *[policy.dataset_id for policy in POLICIES]]
    native, native_payload = _load_canonical_object(provenance_path, "Manifest provenienza SIOPE", newline=True)
    projections = {}
    receipt_hashes: dict[str, str] = {}
    rows_hashes: dict[str, str] = {}
    for dataset_id in dataset_ids:
        entry = entries.get(dataset_id)
        receipt, receipt_payload = _load_canonical_object(receipts_dir / f"{dataset_id}.receipt.json", f"Ricevuta {dataset_id}", newline=True)
        digest = hashlib.sha256(receipt_payload).hexdigest()
        if not isinstance(entry, dict) or entry.get("receiptSha256") != digest:
            raise SiopeNonMunicipalError(f"Catalogo/ricevuta divergenti per {dataset_id}")
        projections[dataset_id] = {key: receipt["source"][key] for key in ("bytes", "sha256", "rows")}
        receipt_hashes[dataset_id] = digest
        if not isinstance(receipt.get("rowsSha256"), str):
            raise SiopeNonMunicipalError(f"Ricevuta priva di righe per {dataset_id}")
        rows_hashes[dataset_id] = receipt["rowsSha256"]
    if dataset_proof.get("catalogSha256") != hashlib.sha256(catalog_payload).hexdigest() or not isinstance(release_proof.get("releaseSetSha256"), str):
        raise SiopeNonMunicipalError("Release corpus divergente")
    validate_native_provenance(detail, native, projections)
    for dataset_id in dataset_ids:
        if entries[dataset_id]["sourceMetadata"]["acquisitionDate"] != next(iter(native["sources"].values()))["acquisitionDate"][:10]:
            raise SiopeNonMunicipalError("Manifest SIOPE: acquisizione divergente dal catalogo")
    return {
        "schemaVersion": 1,
        "nativeProvenanceSha256": hashlib.sha256(native_payload).hexdigest(),
        "scope": "non-municipal-payments-view",
        "releaseId": detail["releaseId"],
        "detailSha256": hashlib.sha256(detail_payload).hexdigest(),
        "catalogSha256": hashlib.sha256(catalog_payload).hexdigest(),
        "datasetProofSha256": hashlib.sha256(dataset_proof_payload).hexdigest(),
        "integratedReleaseSetSha256": release_proof["releaseSetSha256"],
        "datasetReceipts": receipt_hashes,
        "canonicalRowsSha256": rows_hashes,
    }

def build_committed_view_proof(*, provenance_path: Path = REPO_ROOT / "src/data/generated/siope-nonmunicipal-provenance.json", detail_path: Path = DEFAULT_DETAIL_PATH, view_proof_path: Path = DEFAULT_VIEW_PROOF_PATH, catalog_path: Path = DEFAULT_CATALOG_PATH, rows_dir: Path = DEFAULT_ROWS_DIR, receipts_dir: Path = DEFAULT_RECEIPTS_DIR, dataset_proof_path: Path = DEFAULT_DATASET_PROOF_PATH, release_proof_path: Path = DEFAULT_RELEASE_PROOF_PATH) -> dict:
    detail = _load_and_validate_detail(detail_path)
    proof = expected_view_proof(provenance_path=provenance_path, detail_path=detail_path, catalog_path=catalog_path, receipts_dir=receipts_dir, dataset_proof_path=dataset_proof_path, release_proof_path=release_proof_path)
    _reconcile_detail_to_rows(detail, _committed_projection_rows(catalog_path=catalog_path, rows_dir=rows_dir, receipts_dir=receipts_dir, dataset_proof_path=dataset_proof_path))
    view_proof_path.parent.mkdir(parents=True, exist_ok=True)
    descriptor, temporary_name = tempfile.mkstemp(prefix=f".{view_proof_path.name}.", dir=view_proof_path.parent)
    temporary = Path(temporary_name)
    try:
        with os.fdopen(descriptor, "wb") as handle:
            handle.write(canonical_json(proof) + b"\n")
            handle.flush(); os.fsync(handle.fileno())
        os.replace(temporary, view_proof_path)
    finally:
        temporary.unlink(missing_ok=True)
    return proof

def validate_committed_detail(path: Path = DEFAULT_DETAIL_PATH, *, provenance_path: Path = REPO_ROOT / "src/data/generated/siope-nonmunicipal-provenance.json", view_proof_path: Path = DEFAULT_VIEW_PROOF_PATH, catalog_path: Path = DEFAULT_CATALOG_PATH, rows_dir: Path = DEFAULT_ROWS_DIR, receipts_dir: Path = DEFAULT_RECEIPTS_DIR, dataset_proof_path: Path = DEFAULT_DATASET_PROOF_PATH, release_proof_path: Path = DEFAULT_RELEASE_PROOF_PATH) -> dict:
    detail = _load_and_validate_detail(path)
    committed, _ = _load_canonical_object(view_proof_path, "Proof vista SIOPE", newline=True)
    expected = expected_view_proof(provenance_path=provenance_path, detail_path=path, catalog_path=catalog_path, receipts_dir=receipts_dir, dataset_proof_path=dataset_proof_path, release_proof_path=release_proof_path)
    if committed != expected:
        raise SiopeNonMunicipalError("Proof vista SIOPE divergente dalla release")
    _reconcile_detail_to_rows(detail, _committed_projection_rows(catalog_path=catalog_path, rows_dir=rows_dir, receipts_dir=receipts_dir, dataset_proof_path=dataset_proof_path))
    return {"entities": len(detail["entities"]), "releaseId": detail["releaseId"]}

def main() -> int:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--input-dir", type=Path)
    parser.add_argument("--input-receipt", type=Path)
    parser.add_argument("--output-dir", type=Path)
    parser.add_argument("--acquired-at")
    parser.add_argument("--check", action="store_true", help="validate the committed compact detail without network access")
    parser.add_argument("--build-view-proof", action="store_true", help="rebuild the compact-view proof after an independently validated corpus release")
    parser.add_argument("--detail-path", type=Path, default=DEFAULT_DETAIL_PATH)
    args = parser.parse_args()
    if args.check and args.build_view_proof:
        parser.error("--check e --build-view-proof sono alternativi")
    if args.check:
        print(json.dumps({"status": "ok", **validate_committed_detail(args.detail_path)}, ensure_ascii=False, sort_keys=True))
        return 0
    if args.build_view_proof:
        print(json.dumps({"status": "ok", **build_committed_view_proof(detail_path=args.detail_path)}, ensure_ascii=False, sort_keys=True))
        return 0
    if not args.input_dir or not args.input_receipt or not args.output_dir or not args.acquired_at:
        parser.error("--input-dir, --input-receipt, --output-dir e --acquired-at sono obbligatori senza --check")
    print(json.dumps(build_release(input_dir=args.input_dir, input_receipt=args.input_receipt, output_dir=args.output_dir, acquired_at=args.acquired_at), ensure_ascii=False, sort_keys=True))
    return 0

if __name__ == "__main__":
    raise SystemExit(main())
