#!/usr/bin/env python3
"""Build and validate the public, sharded ANAC profile used by entity pages.

The producer reuses the source locks and identity/amount rules of the readiness
contract. Public-entity tax codes are retained so the runtime can fail closed
when live IPA identity drifts. Awardee tax codes are used only inside the
temporary SQLite database and are never written to an artifact.
"""

from __future__ import annotations

import argparse
import csv
import gzip
import hashlib
import importlib.util
import json
import os
import re
import sqlite3
import shutil
import sys
import tempfile
import unicodedata
from collections import Counter, defaultdict
from datetime import date, datetime, timezone
from decimal import Decimal, localcontext
from pathlib import Path
from typing import Iterable, Mapping


ROOT = Path(__file__).resolve().parents[2]
BASE_PATH = ROOT / "scripts" / "etl" / "anac_entity_procurement_coverage.py"
DEFAULT_SPEC = ROOT / "scripts" / "etl" / "specs" / "anac-entity-procurement-page.source.json"
DEFAULT_OUTPUT = ROOT / "src" / "data" / "generated" / "anac-entity-procurement-page"
PARENT_SPEC = ROOT / "scripts" / "etl" / "specs" / "anac-entity-procurement.source.json"

BASE_SPEC = importlib.util.spec_from_file_location("anac_entity_procurement_coverage", BASE_PATH)
if BASE_SPEC is None or BASE_SPEC.loader is None:  # pragma: no cover - import invariant
    raise RuntimeError("Impossibile caricare il contratto ANAC readiness")
base = importlib.util.module_from_spec(BASE_SPEC)
sys.modules[BASE_SPEC.name] = base
BASE_SPEC.loader.exec_module(base)

META_KEYS = (
    "schemaVersion", "dataset", "distributionKind", "observedAt", "generatedAt",
    "scope", "contract", "privacy", "provenance", "coverage", "totals", "shards",
    "sourceSpecSha256", "limitations",
)
RECORD_KEYS = (
    "schemaVersion", "codiceIpa", "codiceFiscaleEnte", "summary", "operators",
    "procedures", "awards",
)
SUMMARY_KEYS = (
    "procedureCount", "awardCount", "awardValue", "positiveAwardCount", "awardeeCount",
    "awardsWithStableAwardees", "awardsWithoutStableAwardees", "singleOperatorAwards",
    "multipartOrAmbiguousAwards", "attributedAwardValue", "unattributedAwardValue",
)
ATTRIBUTION_VALUES = {"single-operator", "multipart", "ambiguous", "no-awardee"}
AMOUNT_STATUS_VALUES = {
    "missing", "invalid", "negative", "zero", "positive-exact-cent", "positive-subcent",
    "conflicting",
}
OPERATOR_KEYS = (
    "ref", "name", "nameVariants", "awardCount", "attributedAwardCount",
    "attributedValue", "rankByCount", "rankByValue",
)
PROCEDURE_KEYS = ("cig", "publishedAt")
AWARD_KEYS = (
    "cig", "awardId", "awardedAt", "amount", "amountStatus", "operatorRefs", "attribution",
)
SHA256_RE = re.compile(r"^[a-f0-9]{64}$")
DECIMAL_RE = re.compile(r"^(?:0|[1-9][0-9]*)(?:\.[0-9]+)?$")
SIGNED_DECIMAL_RE = re.compile(r"^-?(?:0|[1-9][0-9]*)(?:\.[0-9]+)?$")
PUBLIC_DATE_RE = re.compile(r"^[0-9]{4}-[0-9]{2}-[0-9]{2}$")
LIMITATIONS = (
    "CIG, aggiudicazioni, aggiudicatari, stazioni e IPA sono snapshot cross-temporali",
    "la copertura nazionale corrente non e dichiarata",
    "il valore e importo di aggiudicazione dichiarato, non pagamento",
    "gli award multi-operatore o con identita irrisolte restano nel totale ente ma non nel ranking per valore",
    "ranking e drill-down sono descrittivi e non indicano illeciti",
)
MAX_TEMP_DB_BYTES = 1_200_000_000
MIN_FREE_BYTES = MAX_TEMP_DB_BYTES + 512_000_000
COVERAGE_KEYS = (
    "ipaRows", "ipaRowsWithUniqueValidTaxCode", "ipaAmbiguousTaxCodes", "ipaCodes",
    "ipaRowsWithMissingOrInvalidTaxCode", "resolvedAnacEntityTaxCodes",
    "linkedEntityProfiles", "resolvedAnacEntityTaxCodesWithoutIpa", "awardeeRows",
)
AWARDEE_COVERAGE_KEYS = (
    "rawRows", "ineligibleKeyRows", "knownKeyRows", "eligibleKeyRows",
    "outOfCohortRows", "resolvedRows", "unresolvedRows",
)
IPA_KEYS = (
    "datasetPageUrl", "resourcePageUrl", "resourceId", "downloadUrl",
    "sourceLastModified", "metadataModifiedAt", "assetObservedAt", "bytes", "sha256",
    "rows", "headers", "delimiter", "encoding", "license",
)


class ContractError(ValueError):
    """Raised when a source or committed public artifact violates the contract."""


def exact_keys(value: Mapping[str, object], keys: Iterable[str], label: str) -> None:
    expected = set(keys)
    if set(value) != expected:
        raise ContractError(
            f"{label}: chiavi inattese; missing={sorted(expected - set(value))}, "
            f"extra={sorted(set(value) - expected)}"
        )


def sha256_path(path: Path) -> str:
    digest = hashlib.sha256()
    with path.open("rb") as stream:
        for chunk in iter(lambda: stream.read(1024 * 1024), b""):
            digest.update(chunk)
    return digest.hexdigest()


def canonical_decimal(value: object, label: str) -> Decimal:
    if not isinstance(value, str) or not DECIMAL_RE.fullmatch(value):
        raise ContractError(f"{label}: decimale non canonico")
    parsed = Decimal(value)
    if not parsed.is_finite() or decimal_text(parsed) != value:
        raise ContractError(f"{label}: decimale non canonico")
    return parsed


def canonical_signed_decimal(value: object, label: str) -> Decimal:
    if not isinstance(value, str) or not SIGNED_DECIMAL_RE.fullmatch(value):
        raise ContractError(f"{label}: decimale non canonico")
    parsed = Decimal(value)
    if not parsed.is_finite() or decimal_text(parsed) != value:
        raise ContractError(f"{label}: decimale non canonico")
    return parsed


def decimal_text(value: Decimal) -> str:
    if value == 0:
        return "0"
    rendered = format(value, "f")
    if "." in rendered:
        rendered = rendered.rstrip("0").rstrip(".")
    return rendered


def normalized_name(value: str) -> str:
    return " ".join(unicodedata.normalize("NFKC", value).strip().split())


def validate_public_date(value: object, label: str) -> None:
    if value is None:
        return
    if not isinstance(value, str) or not PUBLIC_DATE_RE.fullmatch(value):
        raise ContractError(f"{label}: data non valida")
    try:
        date.fromisoformat(value)
    except ValueError as exc:
        raise ContractError(f"{label}: data non valida") from exc


def load_json(path: Path) -> dict[str, object]:
    try:
        value = json.loads(path.read_text(encoding="utf-8"))
    except (OSError, json.JSONDecodeError) as exc:
        raise ContractError(f"JSON non valido: {path}") from exc
    if not isinstance(value, dict):
        raise ContractError(f"radice JSON non valida: {path}")
    return value


def load_spec(path: Path) -> tuple[dict[str, object], str]:
    specification = load_json(path)
    exact_keys(
        specification,
        ("schemaVersion", "dataset", "distributionKind", "observedAt", "scope", "parent", "ipa", "contract", "privacy"),
        "source spec",
    )
    if specification.get("schemaVersion") != 1 or specification.get("dataset") != "anac-entity-procurement-page":
        raise ContractError("source spec ANAC pagina ente inatteso")
    parent = specification.get("parent")
    if not isinstance(parent, Mapping):
        raise ContractError("parent source spec mancante")
    exact_keys(parent, ("path", "sha256"), "parent")
    if parent.get("path") != "scripts/etl/specs/anac-entity-procurement.source.json":
        raise ContractError("parent source spec inatteso")
    current_parent_sha = sha256_path(PARENT_SPEC)
    if parent.get("sha256") != current_parent_sha:
        raise ContractError("hash parent source spec non riconciliato")
    validate_ipa_spec(specification["ipa"])
    return specification, sha256_path(path)


def validate_ipa_spec(value: object) -> None:
    if not isinstance(value, Mapping):
        raise ContractError("source lock IPA mancante")
    exact_keys(value, IPA_KEYS, "ipa source lock")
    for key in ("datasetPageUrl", "resourcePageUrl", "downloadUrl"):
        if not isinstance(value[key], str) or not value[key].startswith("https://"):
            raise ContractError(f"IPA {key} non e un URL HTTPS")
    resource_id = value["resourceId"]
    if not isinstance(resource_id, str) or not resource_id or resource_id not in value["resourcePageUrl"]:
        raise ContractError("resourceId IPA non riconciliato")
    for key in ("sourceLastModified", "metadataModifiedAt", "assetObservedAt"):
        if value[key] is not None and not isinstance(value[key], str):
            raise ContractError(f"IPA {key} non valido")
    for key in ("bytes", "rows"):
        if not isinstance(value[key], int) or isinstance(value[key], bool) or value[key] <= 0:
            raise ContractError(f"IPA {key} non valido")
    if not isinstance(value["sha256"], str) or not SHA256_RE.fullmatch(value["sha256"]):
        raise ContractError("hash IPA non valido")
    headers = value["headers"]
    if not isinstance(headers, list) or not headers or not all(isinstance(item, str) and item for item in headers):
        raise ContractError("header IPA non valido")
    if value["delimiter"] != "," or value["encoding"] != "utf-8-sig":
        raise ContractError("format contract IPA inatteso")
    license_value = value["license"]
    if not isinstance(license_value, Mapping):
        raise ContractError("licenza IPA mancante")
    exact_keys(license_value, ("name", "url"), "licenza IPA")
    if license_value["name"] != "CC BY 4.0" or not isinstance(license_value["url"], str):
        raise ContractError("licenza IPA inattesa")
    if license_value["url"] not in {
        "https://w3id.org/italia/controlled-vocabulary/licences/A21_CCBY40",
        "https://creativecommons.org/licenses/by/4.0/",
    }:
        raise ContractError("URL licenza IPA inatteso")


def verify_ipa(path: Path, specification: Mapping[str, object]) -> tuple[dict[str, str], dict[str, int]]:
    ipa = specification.get("ipa")
    if not isinstance(ipa, Mapping):
        raise ContractError("source lock IPA mancante")
    if path.stat().st_size != ipa.get("bytes") or sha256_path(path) != ipa.get("sha256"):
        raise ContractError("snapshot IPA diverso dal source lock")
    expected_headers = ipa.get("headers")
    if not isinstance(expected_headers, list) or not all(isinstance(item, str) for item in expected_headers):
        raise ContractError("header contract IPA non valido")
    by_cf: dict[str, list[str]] = defaultdict(list)
    by_code: dict[str, tuple[str, ...]] = {}
    conflicting_codes: set[str] = set()
    rows = 0
    with path.open(encoding=str(ipa.get("encoding", "utf-8-sig")), newline="") as stream:
        reader = csv.DictReader(stream, delimiter=str(ipa.get("delimiter", ",")))
        if reader.fieldnames != expected_headers:
            raise ContractError("header snapshot IPA inatteso")
        for raw in reader:
            rows += 1
            cf = base.normalize_cf(raw.get("Codice_fiscale_ente", ""))
            code = normalized_name(raw.get("Codice_IPA", ""))
            if not code:
                raise ContractError(f"snapshot IPA senza Codice_IPA alla riga {rows + 1}")
            fingerprint = tuple(str(raw.get(header, "")) for header in expected_headers)
            previous = by_code.get(code)
            if previous is not None and previous != fingerprint:
                conflicting_codes.add(code)
            elif previous is not None:
                # An exact duplicate source row cannot create a second entity.
                continue
            by_code[code] = fingerprint
            if cf and code and base.valid_entity_cf(cf):
                by_cf[cf].append(code)
    if rows != ipa.get("rows"):
        raise ContractError("numero righe IPA diverso dal source lock")
    if conflicting_codes:
        raise ContractError(f"righe IPA confliggenti per {len(conflicting_codes)} codici")
    duplicates = {cf: sorted(set(codes)) for cf, codes in by_cf.items() if len(set(codes)) != 1}
    if duplicates:
        raise ContractError(f"crosswalk IPA ambiguo per {len(duplicates)} codici fiscali")
    crosswalk = {cf: codes[0] for cf, codes in by_cf.items()}
    return crosswalk, {
        "ipaRows": rows,
        "ipaRowsWithUniqueValidTaxCode": len(crosswalk),
        "ipaAmbiguousTaxCodes": len(duplicates),
        "ipaCodes": len(by_code),
        "ipaRowsWithMissingOrInvalidTaxCode": len(by_code) - len(crosswalk),
    }


def verify_anac_inputs(
    cig_paths: list[Path], stations: Path, awards: Path, awardees: Path,
) -> tuple[dict[str, object], dict[str, object]]:
    parent_spec, _ = base.load_source_spec(PARENT_SPEC)
    parent_parent, _ = base.verify_parent_spec(parent_spec, PARENT_SPEC)
    parent_inputs = parent_spec.get("inputs")
    if not isinstance(parent_inputs, Mapping):
        raise ContractError("input parent ANAC mancanti")
    cig_entries = parent_inputs.get("cig")
    if not isinstance(cig_entries, list) or len(cig_entries) != 12 or len(cig_paths) != 12:
        raise ContractError("servono dodici input CIG bloccati")
    for path, entry in zip(cig_paths, cig_entries, strict=True):
        if not isinstance(entry, Mapping):
            raise ContractError("source lock CIG non valido")
        base.verify_locked_input(path, base.input_lock_from_spec(entry, base.CIG_HEADERS))
    station_entry = parent_inputs.get("stations")
    if not isinstance(station_entry, Mapping):
        raise ContractError("source lock stazioni mancante")
    base.verify_locked_input(stations, base.input_lock_from_spec(station_entry, base.STATION_HEADERS))
    award_inputs = parent_parent.get("inputs")
    if not isinstance(award_inputs, Mapping):
        raise ContractError("source lock aggiudicazioni mancante")
    for key, path in (("awards", awards), ("awardees", awardees)):
        entry = award_inputs.get(key)
        if not isinstance(entry, Mapping):
            raise ContractError(f"source lock {key} mancante")
        base.verify_locked_input(path, entry)
    return parent_spec, parent_parent


def configure_bounded_database(connection: sqlite3.Connection, temporary: Path) -> None:
    """Bound the staging DB and fail before ingest if the volume is too full."""
    free_bytes = shutil.disk_usage(temporary).free
    if free_bytes < MIN_FREE_BYTES:
        raise ContractError(
            f"spazio temporaneo insufficiente: {free_bytes} < {MIN_FREE_BYTES} bytes"
        )
    page_size = int(connection.execute("PRAGMA page_size").fetchone()[0])
    max_pages = MAX_TEMP_DB_BYTES // page_size
    connection.execute(f"PRAGMA max_page_count = {max_pages}")
    actual_pages = int(connection.execute("PRAGMA max_page_count").fetchone()[0])
    if actual_pages * page_size > MAX_TEMP_DB_BYTES:
        raise ContractError("limite dimensione SQLite temporanea non applicato")


def prepare_slim_awards(connection: sqlite3.Connection) -> None:
    """Replace the readiness awards table with the page-only projection."""
    connection.executescript(
        """
        DROP TABLE awards;
        CREATE TABLE awards (
          cig TEXT NOT NULL, award_id TEXT NOT NULL, amount_status TEXT NOT NULL,
          amount TEXT, award_date_status TEXT NOT NULL, award_date TEXT,
          PRIMARY KEY (cig, award_id)
        ) WITHOUT ROWID;
        """
    )


def load_cohort_awards(
    connection: sqlite3.Connection, path: Path, observed_date: date,
    relevant_cfs: set[str] | None = None,
) -> None:
    """Scan the official awards snapshot but persist only resolved cohort CIGs."""
    cohort_cigs = {
        str(row[0])
        for row in connection.execute(
            "SELECT cig, entity_key FROM procedures WHERE identity_status = 'resolved'"
        )
        if relevant_cfs is None
        or str(row[1]).removeprefix("cf:") in relevant_cfs
    }
    with base.csv_rows(path, base.AWARD_HEADERS) as reader:
        for row_number, raw in enumerate(reader, start=2):
            row = base.checked_row(raw, path=path, row_number=row_number)
            cig = base.normalize_cig(row["cig"])
            award_id, _ = base.parse_award_id(row["id_aggiudicazione"])
            if cig not in cohort_cigs or award_id is None:
                continue
            amount_status, amount, _ = base.parse_amount(row["importo_aggiudicazione"])
            date_status, award_date = base.parse_date_status(
                row["data_aggiudicazione_definitiva"], observed_date
            )
            existing = connection.execute(
                "SELECT amount_status, amount, award_date_status, award_date "
                "FROM awards WHERE cig = ? AND award_id = ?",
                (cig, award_id),
            ).fetchone()
            if existing is None:
                connection.execute(
                    "INSERT INTO awards VALUES (?, ?, ?, ?, ?, ?)",
                    (cig, award_id, amount_status, amount, date_status, award_date),
                )
                continue
            stored_amount_status, stored_amount, stored_date_status, stored_date = existing
            amount_conflict = stored_amount_status == "conflicting" or (
                stored_amount_status, stored_amount
            ) != (amount_status, amount)
            date_conflict = stored_date_status == "conflicting" or (
                stored_date_status, stored_date
            ) != (date_status, award_date)
            connection.execute(
                "UPDATE awards SET amount_status = ?, amount = ?, award_date_status = ?, "
                "award_date = ? WHERE cig = ? AND award_id = ?",
                (
                    "conflicting" if amount_conflict else stored_amount_status,
                    None if amount_conflict else stored_amount,
                    "conflicting" if date_conflict else stored_date_status,
                    None if date_conflict else stored_date,
                    cig,
                    award_id,
                ),
            )
            if row_number % 50_000 == 0:
                connection.commit()
    connection.commit()


def expected_provenance(
    specification: Mapping[str, object], spec_hash: str, parent_spec: Mapping[str, object],
    parent_parent: Mapping[str, object] | None = None,
) -> dict[str, object]:
    """Return the complete, non-row provenance contract for the page artifact."""
    parent = specification.get("parent")
    ipa = specification.get("ipa")
    if not isinstance(parent, Mapping) or not isinstance(ipa, Mapping):
        raise ContractError("provenance source incompleta")
    parent_inputs = parent_spec.get("inputs")
    if not isinstance(parent_inputs, Mapping):
        raise ContractError("provenance parent inputs mancanti")
    cig_inputs = parent_inputs.get("cig")
    stations = parent_inputs.get("stations")
    if not isinstance(cig_inputs, list) or not isinstance(stations, Mapping):
        raise ContractError("provenance input ANAC incompleti")
    parent_parent_hash: str
    if parent_parent is None:
        parent_parent, parent_parent_hash = base.verify_parent_spec(parent_spec, PARENT_SPEC)
    else:
        parent_dependencies = parent_spec.get("parentDependencies")
        if (
            not isinstance(parent_dependencies, Mapping)
            or not isinstance(parent_dependencies.get("parentSpecSha256"), str)
        ):
            raise ContractError("hash parent awards/awardees mancante")
        parent_parent_hash = str(parent_dependencies["parentSpecSha256"])
    parent_parent_inputs = parent_parent.get("inputs")
    parent_license = parent_parent.get("license")
    if not isinstance(parent_parent_inputs, Mapping) or not isinstance(parent_license, Mapping):
        raise ContractError("provenance snapshot awards/awardees incompleta")

    parent_dependencies = parent_spec.get("parentDependencies")
    if not isinstance(parent_dependencies, Mapping):
        raise ContractError("dipendenza parent awards/awardees mancante")
    parent_spec_path = parent_dependencies.get("parentSpecPath")
    if not isinstance(parent_spec_path, str) or not parent_spec_path:
        raise ContractError("percorso parent awards/awardees mancante")
    if parent_spec_path != "anac-awardees.source.json":
        raise ContractError("percorso parent awards/awardees inatteso")

    def lock_projection(entry: object, input_key: str) -> dict[str, object]:
        if not isinstance(entry, Mapping):
            raise ContractError("lock input snapshot non valido")
        result = {
            "datasetPageUrl": entry.get("datasetPageUrl"),
            "resourcePageUrl": entry.get("resourcePageUrl"),
            "resourceId": entry.get("resourceId"),
            "resourceUrl": entry.get("resourceUrl"),
            "sourceLastModified": entry.get("sourceLastModified"),
            # The parent awards/awardees lock has no per-asset observation
            # instant.  Keep the field explicit and null rather than copying
            # an unrelated catalog timestamp.
            "assetObservedAt": entry.get("assetObservedAt"),
            "archiveBytes": entry.get("archiveBytes"),
            "archiveSha256": entry.get("archiveSha256"),
            "member": entry.get("member"),
            "delimiter": entry.get("delimiter", ";"),
            "encoding": entry.get("encoding", "utf-8-sig"),
            "headers": entry.get("headers"),
            "parentSpecPath": "scripts/etl/specs/" + parent_spec_path,
            "parentSpecSha256": parent_parent_hash,
            "parentInputKey": input_key,
            "license": entry.get("license", dict(parent_license)),
        }
        for key in ("datasetPageUrl", "resourcePageUrl", "resourceUrl"):
            if not isinstance(result[key], str) or not result[key].startswith("https://"):
                raise ContractError(f"lock snapshot {key} mancante o non HTTPS")
        if not isinstance(result["resourceId"], str) or not result["resourceId"]:
            raise ContractError("lock snapshot resourceId mancante")
        if result["resourceId"] not in result["resourcePageUrl"]:
            raise ContractError("lock snapshot resourceId non riconciliato")
        if not isinstance(result["sourceLastModified"], str) or not result["sourceLastModified"]:
            raise ContractError("lock snapshot sourceLastModified mancante")
        if result["assetObservedAt"] is not None and not isinstance(result["assetObservedAt"], str):
            raise ContractError("lock snapshot assetObservedAt non valido")
        if (
            not isinstance(result["archiveBytes"], int)
            or isinstance(result["archiveBytes"], bool)
            or result["archiveBytes"] <= 0
            or not isinstance(result["archiveSha256"], str)
            or not SHA256_RE.fullmatch(result["archiveSha256"])
        ):
            raise ContractError("lock snapshot hash/bytes mancanti")
        member = result["member"]
        if not isinstance(member, Mapping):
            raise ContractError("lock snapshot member/header mancanti")
        exact_keys(member, ("name", "bytes", "sha256", "crc32"), "lock snapshot member")
        if (
            not isinstance(member["name"], str) or not member["name"]
            or not isinstance(member["bytes"], int) or isinstance(member["bytes"], bool)
            or member["bytes"] <= 0
            or not isinstance(member["sha256"], str) or not SHA256_RE.fullmatch(member["sha256"])
            or not isinstance(member["crc32"], str) or not member["crc32"]
        ):
            raise ContractError("lock snapshot member non valido")
        headers = result["headers"]
        if not isinstance(headers, list) or not headers or not all(
            isinstance(header, str) and header for header in headers
        ):
            raise ContractError("lock snapshot header non valido")
        if result["delimiter"] != ";" or result["encoding"] != "utf-8-sig":
            raise ContractError("lock snapshot format inatteso")
        if result["parentSpecPath"] != "scripts/etl/specs/anac-awardees.source.json":
            raise ContractError("lock snapshot parent path inatteso")
        if not isinstance(result["parentSpecSha256"], str) or not SHA256_RE.fullmatch(result["parentSpecSha256"]):
            raise ContractError("lock snapshot parent hash non valido")
        if result["parentInputKey"] not in {"awards", "awardees"}:
            raise ContractError("lock snapshot parent input inatteso")
        license_value = result["license"]
        if not isinstance(license_value, Mapping):
            raise ContractError("lock snapshot licenza mancante")
        exact_keys(license_value, ("name", "url"), "lock snapshot license")
        if license_value != parent_license:
            raise ContractError("lock snapshot licenza non riconciliata")
        return result

    snapshot_inputs = {
        "awards": lock_projection(parent_parent_inputs.get("awards"), "awards"),
        "awardees": lock_projection(parent_parent_inputs.get("awardees"), "awardees"),
    }
    return {
        "sourceSpec": {
            "path": "scripts/etl/specs/anac-entity-procurement-page.source.json",
            "sha256": spec_hash,
        },
        "parentSourceSpec": dict(parent),
        "anacCatalogObservedAt": parent_spec.get("catalogObservedAt"),
        "anacCatalogMetadataModifiedAt": parent_spec.get("catalogMetadataModifiedAt"),
        "anacAssetObservedAt": {
            "cig": [entry.get("assetObservedAt") for entry in cig_inputs if isinstance(entry, Mapping)],
            "stations": stations.get("assetObservedAt"),
        },
        "ipa": dict(ipa),
        # Keep the two parent snapshot locks flat: this is the v1 shape used
        # by the page runtime and makes each input independently auditable.
        "awards": snapshot_inputs["awards"],
        "awardees": snapshot_inputs["awardees"],
    }


def validate_coverage(value: object, label: str = "coverage") -> None:
    if not isinstance(value, Mapping):
        raise ContractError(f"{label}: oggetto richiesto")
    exact_keys(value, COVERAGE_KEYS, label)
    for key in COVERAGE_KEYS[:-1]:
        item = value[key]
        if not isinstance(item, int) or isinstance(item, bool) or item < 0:
            raise ContractError(f"{label}.{key}: contatore non valido")
    awardee = value["awardeeRows"]
    if not isinstance(awardee, Mapping):
        raise ContractError(f"{label}.awardeeRows: oggetto richiesto")
    exact_keys(awardee, AWARDEE_COVERAGE_KEYS, f"{label}.awardeeRows")
    for key in AWARDEE_COVERAGE_KEYS:
        item = awardee[key]
        if not isinstance(item, int) or isinstance(item, bool) or item < 0:
            raise ContractError(f"{label}.awardeeRows.{key}: contatore non valido")
    if value["ipaRows"] != value["ipaRowsWithUniqueValidTaxCode"] + value["ipaRowsWithMissingOrInvalidTaxCode"]:
        raise ContractError(f"{label}: partizione IPA non riconciliata")
    if (
        value["ipaCodes"] != value["ipaRows"]
        or value["ipaAmbiguousTaxCodes"] != 0
        or value["linkedEntityProfiles"] != value["ipaRowsWithUniqueValidTaxCode"]
    ):
        raise ContractError(f"{label}: crosswalk IPA non riconciliato")
    if value["resolvedAnacEntityTaxCodesWithoutIpa"] > value["resolvedAnacEntityTaxCodes"]:
        raise ContractError(f"{label}: differenza CF ANAC/IPA non valida")
    if awardee["rawRows"] != awardee["ineligibleKeyRows"] + awardee["knownKeyRows"]:
        raise ContractError(f"{label}: partizione raw/chiavi awardee non riconciliata")
    if awardee["knownKeyRows"] != awardee["eligibleKeyRows"] + awardee["outOfCohortRows"]:
        raise ContractError(f"{label}: partizione coorte awardee non riconciliata")
    if awardee["eligibleKeyRows"] != awardee["resolvedRows"] + awardee["unresolvedRows"]:
        raise ContractError(f"{label}: partizione identita awardee non riconciliata")


def prepare_detail_tables(connection: sqlite3.Connection) -> None:
    connection.executescript(
        """
        CREATE INDEX procedures_entity_profile ON procedures(entity_key, identity_status, cig);
        CREATE TABLE awardee_pair_quality (
          cig TEXT NOT NULL, award_id TEXT NOT NULL, raw_rows INTEGER NOT NULL,
          unresolved_rows INTEGER NOT NULL, PRIMARY KEY (cig, award_id)
        ) WITHOUT ROWID;
        CREATE TABLE awardee_resolved (
          cig TEXT NOT NULL, award_id TEXT NOT NULL, operator_cf TEXT NOT NULL,
          name TEXT NOT NULL, row_count INTEGER NOT NULL,
          PRIMARY KEY (cig, award_id, operator_cf, name)
        ) WITHOUT ROWID;
        CREATE INDEX awardee_resolved_key ON awardee_resolved(cig, award_id);
        """
    )


def load_awardee_details(connection: sqlite3.Connection, path: Path) -> dict[str, int]:
    counts = Counter(
        rawRows=0, ineligibleKeyRows=0, knownKeyRows=0, eligibleKeyRows=0,
        outOfCohortRows=0, resolvedRows=0, unresolvedRows=0,
    )
    # The official awardee snapshot is national and much larger than the
    # twelve-month cohort.  Keep the full stream audit count, but write only
    # pairs that can contribute to a resolved public entity profile.
    eligible_pairs = {
        (str(cig), str(award_id))
        for cig, award_id in connection.execute(
            "SELECT a.cig, a.award_id FROM awards a "
            "JOIN procedures p ON p.cig = a.cig "
            "WHERE p.identity_status = 'resolved'"
        )
    }
    with base.csv_rows(path, base.AWARDEE_HEADERS) as reader:
        for row_number, raw in enumerate(reader, start=2):
            row = base.checked_row(raw, path=path, row_number=row_number)
            counts["rawRows"] += 1
            cig = base.normalize_cig(row["cig"])
            award_id, _ = base.parse_award_id(row["id_aggiudicazione"])
            if not base.CIG_PATTERN.fullmatch(cig) or award_id is None:
                counts["ineligibleKeyRows"] += 1
                continue
            counts["knownKeyRows"] += 1
            if (cig, award_id) not in eligible_pairs:
                counts["outOfCohortRows"] += 1
                continue
            counts["eligibleKeyRows"] += 1
            cf = base.normalize_cf(row["codice_fiscale"])
            resolved = bool(cf and base.valid_entity_cf(cf))
            counts["resolvedRows" if resolved else "unresolvedRows"] += 1
            connection.execute(
                "INSERT INTO awardee_pair_quality VALUES (?, ?, 1, ?) "
                "ON CONFLICT(cig, award_id) DO UPDATE SET raw_rows = raw_rows + 1, "
                "unresolved_rows = unresolved_rows + excluded.unresolved_rows",
                (cig, award_id, 0 if resolved else 1),
            )
            if resolved:
                name = normalized_name(row["denominazione"])
                connection.execute(
                    "INSERT INTO awardee_resolved VALUES (?, ?, ?, ?, 1) "
                    "ON CONFLICT(cig, award_id, operator_cf, name) "
                    "DO UPDATE SET row_count = row_count + 1",
                    (cig, award_id, cf, name),
                )
            if counts["rawRows"] % 50_000 == 0:
                connection.commit()
    connection.commit()
    return dict(counts)


def ranked(values: dict[str, Decimal | int], refs_to_names: Mapping[str, str]) -> dict[str, int]:
    order = sorted(values, key=lambda ref: (-values[ref], refs_to_names[ref], ref))
    ranks: dict[str, int] = {}
    previous: Decimal | int | None = None
    current_rank = 0
    for position, ref in enumerate(order, start=1):
        value = values[ref]
        if previous is None or value != previous:
            current_rank = position
            previous = value
        ranks[ref] = current_rank
    return ranks


CONCENTRATION_MIN_OBSERVATIONS = 30
CONCENTRATION_TOP_K = 10
CONCENTRATION_FORMULA = "sum-of-squared-percent-shares-0-10000"


def _gcd(left: int, right: int) -> int:
    while right:
        left, right = right, left % right
    return abs(left)


def _reduce_ratio(numerator: int, denominator: int) -> dict[str, str]:
    if denominator <= 0 or numerator < 0:
        raise ContractError("rapporto di concentrazione non valido")
    if numerator == 0:
        return {"numerator": "0", "denominator": "1"}
    divisor = _gcd(numerator, denominator)
    return {"numerator": str(numerator // divisor), "denominator": str(denominator // divisor)}


def _withheld_concentration(
    dimension: str, reason: str, observation_count: int, operator_count: int,
) -> dict[str, object]:
    return {
        "status": "withheld",
        "dimension": dimension,
        "formula": CONCENTRATION_FORMULA,
        "reason": reason,
        "observationCount": observation_count,
        "minimumObservations": CONCENTRATION_MIN_OBSERVATIONS,
        "operatorCount": operator_count,
    }


def _sort_operators(operators: list[dict[str, object]], dimension: str) -> list[dict[str, object]]:
    if dimension == "value":
        selected = [item for item in operators if item.get("rankByValue") is not None]
        return sorted(
            selected,
            key=lambda item: (int(item["rankByValue"]), str(item["name"]), str(item["ref"])),
        )
    return sorted(operators, key=lambda item: (int(item["rankByCount"]), str(item["name"]), str(item["ref"])))


def _scaled_integers(values: list[Decimal]) -> tuple[list[int], int]:
    scales = [max(0, -value.as_tuple().exponent) if value.as_tuple().exponent < 0 else 0 for value in values]
    scale = max(scales, default=0)
    integers = [int(value * (Decimal(10) ** scale)) for value in values]
    return integers, sum(integers)


def _published_concentration(
    dimension: str,
    operators: list[dict[str, object]],
    weights: list[Decimal],
    observation_count: int,
    market_total: str,
) -> dict[str, object]:
    integers, total = _scaled_integers(weights)
    if total <= 0:
        raise ContractError("mercato di concentrazione vuoto")
    included_top = min(CONCENTRATION_TOP_K, len(operators))
    top1 = operators[0]
    top1_integer = integers[0]
    top10_integer = sum(integers[:included_top])
    sum_squares = sum(value * value for value in integers)
    top10_amount = sum(weights[:included_top], start=Decimal(0))
    return {
        "status": "published",
        "dimension": dimension,
        "formula": CONCENTRATION_FORMULA,
        "observationCount": observation_count,
        "minimumObservations": CONCENTRATION_MIN_OBSERVATIONS,
        "operatorCount": len(operators),
        "includedTop": included_top,
        "top1Ref": top1["ref"],
        "top1Name": top1["name"],
        "marketTotal": market_total,
        "top1Amount": decimal_text(weights[0]),
        "top10Amount": decimal_text(top10_amount),
        "top1Share": _reduce_ratio(top1_integer, total),
        "top10Share": _reduce_ratio(top10_integer, total),
        "hhi10000": _reduce_ratio(sum_squares * 10_000, total * total),
    }


def derive_concentration(record: Mapping[str, object]) -> dict[str, object]:
    """Top 1 / Top 10 and HHI derived from the public ranking; never written to shards."""
    summary = record["summary"]
    operators = list(record["operators"])
    if not isinstance(summary, Mapping):
        raise ContractError("summary mancante per la concentrazione")

    count_ranked = _sort_operators(operators, "count")
    award_count = int(summary["awardCount"])
    if award_count < CONCENTRATION_MIN_OBSERVATIONS:
        count_metric: dict[str, object] = _withheld_concentration(
            "count", "below-minimum-observations", award_count, len(count_ranked),
        )
    elif not count_ranked:
        count_metric = _withheld_concentration("count", "zero-denominator", award_count, 0)
    else:
        weights = [Decimal(int(item["awardCount"])) for item in count_ranked]
        count_metric = _published_concentration(
            "count", count_ranked, weights, award_count, str(sum(int(item["awardCount"]) for item in count_ranked)),
        )

    value_ranked = _sort_operators(operators, "value")
    observation_count = sum(int(item["attributedAwardCount"]) for item in value_ranked)
    if observation_count < CONCENTRATION_MIN_OBSERVATIONS:
        value_metric: dict[str, object] = _withheld_concentration(
            "value", "below-minimum-observations", observation_count, len(value_ranked),
        )
    else:
        market = sum((Decimal(str(item["attributedValue"])) for item in value_ranked), start=Decimal(0))
        attributed = Decimal(str(summary["attributedAwardValue"]))
        if market == 0:
            value_metric = _withheld_concentration("value", "zero-denominator", observation_count, len(value_ranked))
        elif market != attributed:
            raise ContractError("mercato valore di concentrazione non riconciliato")
        else:
            weights = [Decimal(str(item["attributedValue"])) for item in value_ranked]
            value_metric = _published_concentration(
                "value", value_ranked, weights, observation_count, decimal_text(market),
            )
    return {"count": count_metric, "value": value_metric}


def profile_record(
    connection: sqlite3.Connection, cf: str, codice_ipa: str,
) -> dict[str, object]:
    procedure_rows = connection.execute(
        "SELECT cig, publication_date FROM procedures "
        "WHERE identity_status = 'resolved' AND entity_key = ? ORDER BY cig",
        (f"cf:{cf}",),
    ).fetchall()
    procedures = [{"cig": row[0], "publishedAt": row[1]} for row in procedure_rows]
    award_rows = connection.execute(
        "SELECT a.cig, a.award_id, a.award_date, a.amount, a.amount_status "
        "FROM awards a JOIN procedures p ON p.cig = a.cig "
        "WHERE p.identity_status = 'resolved' AND p.entity_key = ? "
        "ORDER BY a.cig, CAST(a.award_id AS INTEGER), a.award_id",
        (f"cf:{cf}",),
    ).fetchall()
    detail_rows = connection.execute(
        "SELECT d.cig, d.award_id, d.operator_cf, d.name, d.row_count, q.unresolved_rows "
        "FROM awardee_resolved d JOIN procedures p ON p.cig = d.cig "
        "JOIN awards a ON a.cig = d.cig AND a.award_id = d.award_id "
        "JOIN awardee_pair_quality q ON q.cig = d.cig AND q.award_id = d.award_id "
        "WHERE p.identity_status = 'resolved' AND p.entity_key = ? "
        "ORDER BY d.cig, CAST(d.award_id AS INTEGER), d.award_id, d.operator_cf, d.name",
        (f"cf:{cf}",),
    ).fetchall()
    quality_rows = connection.execute(
        "SELECT q.cig, q.award_id, q.raw_rows, q.unresolved_rows "
        "FROM awardee_pair_quality q JOIN procedures p ON p.cig = q.cig "
        "JOIN awards a ON a.cig = q.cig AND a.award_id = q.award_id "
        "WHERE p.identity_status = 'resolved' AND p.entity_key = ?",
        (f"cf:{cf}",),
    ).fetchall()
    quality = {(row[0], row[1]): (int(row[2]), int(row[3])) for row in quality_rows}

    pair_operators: dict[tuple[str, str], set[str]] = defaultdict(set)
    name_counts: dict[str, Counter[str]] = defaultdict(Counter)
    for cig, award_id, operator_cf, name, row_count, _ in detail_rows:
        pair_operators[(cig, award_id)].add(operator_cf)
        if name:
            name_counts[operator_cf][name] += int(row_count)
    operator_cfs = sorted({item for values in pair_operators.values() for item in values})
    refs = {operator_cf: f"op-{index:06d}" for index, operator_cf in enumerate(operator_cfs, start=1)}
    names: dict[str, str] = {}
    variants: dict[str, int] = {}
    for operator_cf in operator_cfs:
        choices = name_counts.get(operator_cf, Counter())
        names[refs[operator_cf]] = (
            sorted(choices, key=lambda item: (-choices[item], item))[0]
            if choices else "Denominazione non disponibile nei dati ANAC"
        )
        variants[refs[operator_cf]] = len(choices)

    award_count_by_ref: Counter[str] = Counter()
    attributed_count_by_ref: Counter[str] = Counter()
    attributed_value_by_ref: dict[str, Decimal] = defaultdict(Decimal)
    award_value = Decimal(0)
    attributed_value = Decimal(0)
    unattributed_value = Decimal(0)
    positive_awards = 0
    with_stable = 0
    without_stable = 0
    single_awards = 0
    multipart = 0
    awards: list[dict[str, object]] = []
    for cig, award_id, awarded_at, amount, amount_status in award_rows:
        operator_cfs_for_pair = sorted(pair_operators.get((cig, award_id), set()))
        operator_refs = [refs[item] for item in operator_cfs_for_pair]
        raw_rows, unresolved_rows = quality.get((cig, award_id), (0, 0))
        if operator_refs and unresolved_rows == 0:
            with_stable += 1
        else:
            without_stable += 1
        for ref in operator_refs:
            # Count is a relation count, not an amount allocation.  A member
            # of a multi-operator award is counted once as a relationship,
            # while the value is attributed only for a stable single operator.
            award_count_by_ref[ref] += 1
        if len(operator_refs) == 1 and unresolved_rows == 0:
            attribution = "single-operator"
            single_awards += 1
        elif raw_rows > 0:
            attribution = "multipart" if unresolved_rows == 0 and len(operator_refs) > 1 else "ambiguous"
            multipart += 1
        else:
            attribution = "no-awardee"
        positive = amount_status in {"positive-exact-cent", "positive-subcent"} and amount is not None
        if positive:
            parsed_amount = Decimal(amount)
            positive_awards += 1
            award_value += parsed_amount
            if attribution == "single-operator":
                ref = operator_refs[0]
                attributed_count_by_ref[ref] += 1
                attributed_value_by_ref[ref] += parsed_amount
                attributed_value += parsed_amount
            else:
                unattributed_value += parsed_amount
        awards.append({
            "cig": cig,
            "awardId": award_id,
            "awardedAt": awarded_at,
            "amount": decimal_text(Decimal(amount)) if amount is not None else None,
            "amountStatus": amount_status,
            "operatorRefs": operator_refs,
            "attribution": attribution,
        })

    count_values = {ref: int(award_count_by_ref[ref]) for ref in names}
    value_values = {ref: attributed_value_by_ref[ref] for ref in names if attributed_value_by_ref[ref] > 0}
    count_ranks = ranked(count_values, names)
    value_ranks = ranked(value_values, names) if value_values else {}
    operators = [
        {
            "ref": ref,
            "name": names[ref],
            "nameVariants": variants[ref],
            "awardCount": int(award_count_by_ref[ref]),
            "attributedAwardCount": int(attributed_count_by_ref[ref]),
            "attributedValue": decimal_text(attributed_value_by_ref[ref]),
            "rankByCount": count_ranks[ref],
            "rankByValue": value_ranks.get(ref),
        }
        for ref in sorted(names)
    ]
    return {
        "schemaVersion": 1,
        "codiceIpa": codice_ipa,
        "codiceFiscaleEnte": cf,
        "summary": {
            "procedureCount": len(procedures),
            "awardCount": len(awards),
            "awardValue": decimal_text(award_value),
            "positiveAwardCount": positive_awards,
            # Number of unique public operator profiles.  The distinct
            # operator-award relationship count is kept separately in meta.
            "awardeeCount": len(operators),
            "awardsWithStableAwardees": with_stable,
            "awardsWithoutStableAwardees": without_stable,
            "singleOperatorAwards": single_awards,
            "multipartOrAmbiguousAwards": multipart,
            "attributedAwardValue": decimal_text(attributed_value),
            "unattributedAwardValue": decimal_text(unattributed_value),
        },
        "operators": operators,
        "procedures": procedures,
        "awards": awards,
    }


def canonical_line(value: Mapping[str, object]) -> bytes:
    return (json.dumps(value, ensure_ascii=False, sort_keys=True, separators=(",", ":")) + "\n").encode("utf-8")


def atomic_publish(staging: Path, output: Path) -> Path | None:
    """Publish a checked directory and return the old artifact backup.

    The caller must remove the returned backup only after validating the
    published directory.  Keeping it alive across that validation makes a
    post-publish failure recoverable as well as an ``os.replace`` failure.
    """
    backup = output.parent / f".{output.name}.backup-{os.getpid()}"
    if backup.exists():
        shutil.rmtree(backup)
    moved_previous = False
    try:
        if output.exists():
            os.replace(output, backup)
            moved_previous = True
        os.replace(staging, output)
    except Exception:
        if output.exists():
            shutil.rmtree(output)
        if moved_previous and backup.exists():
            os.replace(backup, output)
        raise
    return backup if moved_previous else None


def build(
    cig_paths: list[Path], stations: Path, awards_path: Path, awardees_path: Path,
    ipa_path: Path, output: Path, *, specification_path: Path = DEFAULT_SPEC,
    generated_at: str | None = None,
) -> dict[str, object]:
    specification, spec_hash = load_spec(specification_path)
    parent_spec, parent_parent = verify_anac_inputs(cig_paths, stations, awards_path, awardees_path)
    crosswalk, ipa_coverage = verify_ipa(ipa_path, specification)
    observed_at = specification["observedAt"]
    generated = generated_at or datetime.now(timezone.utc).replace(microsecond=0).isoformat().replace("+00:00", "Z")
    try:
        if datetime.fromisoformat(generated.replace("Z", "+00:00")) < datetime.fromisoformat(str(observed_at).replace("Z", "+00:00")):
            raise ContractError("generatedAt precede observedAt")
    except ValueError as exc:
        raise ContractError("timestamp source spec non valido") from exc

    output.parent.mkdir(parents=True, exist_ok=True)
    destination = output
    staging = Path(tempfile.mkdtemp(prefix=f".{output.name}.staging-", dir=output.parent))
    output = staging
    shard_dir = output / "entities"
    shard_dir.mkdir(parents=True, exist_ok=True)
    connection: sqlite3.Connection | None = None
    try:
        with tempfile.TemporaryDirectory(prefix="anac-entity-page-") as temporary:
            connection = base.make_database(Path(temporary) / "profile.sqlite")
            configure_bounded_database(connection, Path(temporary))
            print("anac entity page: loading station registry", file=sys.stderr, flush=True)
            registry_by_ausa, registry_by_cf, _ = base.load_registry(connection, stations)
            print("anac entity page: loading 12 CIG snapshots", file=sys.stderr, flush=True)
            base.load_cig_inputs(
                connection, cig_paths, list(range(1, 13)), registry_by_ausa, registry_by_cf,
                datetime.fromisoformat(str(observed_at).replace("Z", "+00:00")).date(),
            )
            print("anac entity page: loading awards snapshot", file=sys.stderr, flush=True)
            prepare_slim_awards(connection)
            load_cohort_awards(
                connection, awards_path,
                datetime.fromisoformat(str(observed_at).replace("Z", "+00:00")).date(),
                set(crosswalk),
            )
            print("anac entity page: awards snapshot loaded", file=sys.stderr, flush=True)
            print("anac entity page: loading awardees snapshot", file=sys.stderr, flush=True)
            prepare_detail_tables(connection)
            awardee_coverage = load_awardee_details(connection, awardees_path)
            print("anac entity page: awardees snapshot loaded", file=sys.stderr, flush=True)
            print("anac entity page: projecting profiles", file=sys.stderr, flush=True)

            # Emit every uniquely crosswalked IPA entity, including entities
            # with a valid zero-procedure profile. Absence from the crosswalk
            # remains unavailable rather than being rendered as zero.
            linked = [(code, cf) for cf, code in crosswalk.items()]
            linked.sort()
            resolved_cfs = {
                row[0]
                for row in connection.execute(
                    "SELECT DISTINCT substr(entity_key, 4) FROM procedures "
                    "WHERE identity_status = 'resolved' AND entity_key LIKE 'cf:%'"
                )
            }
            handles: dict[str, tuple[object, gzip.GzipFile]] = {}
            shard_entities: Counter[str] = Counter()
            totals = Counter(
                entities=0, procedures=0, awards=0, operators=0,
                awardeeRelations=0, positiveAwards=0,
            )
            decimal_totals = {
                "awardValue": Decimal(0),
                "attributedAwardValue": Decimal(0),
                "unattributedAwardValue": Decimal(0),
            }
            try:
                for code in (f"{value:02x}" for value in range(256)):
                    raw = (shard_dir / f"{code}.jsonl.gz").open("wb")
                    handles[code] = (raw, gzip.GzipFile(filename="", mode="wb", fileobj=raw, mtime=0))
                for codice_ipa, cf in linked:
                    record = profile_record(connection, cf, codice_ipa)
                    bucket = hashlib.sha256(codice_ipa.encode("utf-8")).hexdigest()[:2]
                    handles[bucket][1].write(canonical_line(record))
                    shard_entities[bucket] += 1
                    summary = record["summary"]
                    assert isinstance(summary, Mapping)
                    totals["entities"] += 1
                    totals["procedures"] += int(summary["procedureCount"])
                    totals["awards"] += int(summary["awardCount"])
                    totals["operators"] += len(record["operators"])
                    totals["awardeeRelations"] += int(
                        sum(int(item["awardCount"]) for item in record["operators"])
                    )
                    totals["positiveAwards"] += int(summary["positiveAwardCount"])
                    for key in decimal_totals:
                        decimal_totals[key] += Decimal(str(summary[key]))
            finally:
                for raw, compressed in handles.values():
                    compressed.close()
                    raw.close()

            shards = []
            for code in (f"{value:02x}" for value in range(256)):
                path = shard_dir / f"{code}.jsonl.gz"
                shards.append({
                    "id": code,
                    "path": f"src/data/generated/anac-entity-procurement-page/entities/{code}.jsonl.gz",
                    "bytes": path.stat().st_size,
                    "sha256": sha256_path(path),
                    "entities": int(shard_entities[code]),
                })
            scope = specification["scope"]
            contract = specification["contract"]
            privacy = specification["privacy"]
            assert isinstance(scope, Mapping) and isinstance(contract, Mapping) and isinstance(privacy, Mapping)
            meta: dict[str, object] = {
                "schemaVersion": 1,
                "dataset": "anac-entity-procurement-page",
                "distributionKind": "sharded-public-profile",
                "observedAt": observed_at,
                "generatedAt": generated,
                "scope": dict(scope),
                "contract": dict(contract),
                "privacy": dict(privacy),
                "provenance": expected_provenance(specification, spec_hash, parent_spec, parent_parent),
                "coverage": {
                    **ipa_coverage,
                    "resolvedAnacEntityTaxCodes": len(resolved_cfs),
                    "linkedEntityProfiles": len(linked),
                    "resolvedAnacEntityTaxCodesWithoutIpa": len(
                        resolved_cfs - {cf for _, cf in linked}
                    ),
                    "awardeeRows": awardee_coverage,
                },
                "totals": {
                    **dict(totals),
                    **{key: decimal_text(value) for key, value in decimal_totals.items()},
                },
                "shards": shards,
                "sourceSpecSha256": spec_hash,
                "limitations": list(LIMITATIONS),
            }
            (output / "meta.json").write_text(
                json.dumps(meta, ensure_ascii=False, indent=2, sort_keys=True) + "\n", encoding="utf-8"
            )
        check_artifact(output, specification_path)
        backup = atomic_publish(output, destination)
        try:
            check_artifact(destination, specification_path)
        except Exception:
            if backup is not None and backup.exists():
                if destination.exists():
                    shutil.rmtree(destination)
                os.replace(backup, destination)
            elif destination.exists():
                shutil.rmtree(destination)
            raise
        if backup is not None and backup.exists():
            shutil.rmtree(backup)
        return meta
    finally:
        if connection is not None:
            connection.close()
        if staging.exists():
            shutil.rmtree(staging)


def validate_record(record: Mapping[str, object], label: str) -> dict[str, Decimal | int]:
    exact_keys(record, RECORD_KEYS, label)
    if record.get("schemaVersion") != 1:
        raise ContractError(f"{label}: schemaVersion inattesa")
    code = record.get("codiceIpa")
    cf = record.get("codiceFiscaleEnte")
    if not isinstance(code, str) or not code or not isinstance(cf, str) or not base.valid_entity_cf(cf):
        raise ContractError(f"{label}: identita ente non valida")
    summary = record.get("summary")
    if not isinstance(summary, Mapping):
        raise ContractError(f"{label}: summary mancante")
    exact_keys(summary, SUMMARY_KEYS, f"{label}.summary")
    for key in SUMMARY_KEYS:
        if key.endswith("Value"):
            canonical_decimal(summary[key], f"{label}.summary.{key}")
        elif not isinstance(summary[key], int) or isinstance(summary[key], bool) or int(summary[key]) < 0:
            raise ContractError(f"{label}.summary.{key}: intero non-negativo richiesto")
    procedures = record.get("procedures")
    awards = record.get("awards")
    operators = record.get("operators")
    if not isinstance(procedures, list) or not isinstance(awards, list) or not isinstance(operators, list):
        raise ContractError(f"{label}: collezioni non valide")
    if len(procedures) != summary["procedureCount"] or len(awards) != summary["awardCount"]:
        raise ContractError(f"{label}: cardinalita non riconciliate")
    cigs: set[str] = set()
    for index, item in enumerate(procedures):
        if not isinstance(item, Mapping):
            raise ContractError(f"{label}.procedures[{index}] non valido")
        exact_keys(item, PROCEDURE_KEYS, f"{label}.procedures[{index}]")
        cig = item.get("cig")
        if not isinstance(cig, str) or not base.CIG_PATTERN.fullmatch(cig) or cig in cigs:
            raise ContractError(f"{label}: CIG non valido o duplicato")
        validate_public_date(item.get("publishedAt"), f"{label}.publishedAt")
        cigs.add(cig)
    refs: set[str] = set()
    count_ranks: set[tuple[int, str]] = set()
    for index, item in enumerate(operators):
        if not isinstance(item, Mapping):
            raise ContractError(f"{label}.operators[{index}] non valido")
        exact_keys(item, OPERATOR_KEYS, f"{label}.operators[{index}]")
        ref = item.get("ref")
        if not isinstance(ref, str) or not re.fullmatch(r"op-[0-9]{6}", ref) or ref in refs:
            raise ContractError(f"{label}: ref operatore non valido")
        refs.add(ref)
        if not isinstance(item.get("name"), str) or not item.get("name"):
            raise ContractError(f"{label}: denominazione operatore mancante")
        name_variants = item.get("nameVariants")
        if not isinstance(name_variants, int) or isinstance(name_variants, bool) or name_variants < 0:
            raise ContractError(f"{label}.nameVariants: conteggio non valido")
        for key in ("awardCount", "attributedAwardCount", "rankByCount"):
            if not isinstance(item.get(key), int) or isinstance(item.get(key), bool) or int(item[key]) < 0:
                raise ContractError(f"{label}.{key}: intero non valido")
        canonical_decimal(item.get("attributedValue"), f"{label}.attributedValue")
        rank_value = item.get("rankByValue")
        if rank_value is not None and (not isinstance(rank_value, int) or isinstance(rank_value, bool) or rank_value < 1):
            raise ContractError(f"{label}: rankByValue non valido")
        count_ranks.add((int(item["rankByCount"]), ref))
    positive = 0
    value = Decimal(0)
    attributed = Decimal(0)
    unattributed = Decimal(0)
    stable = 0
    unstable = 0
    single = 0
    multipart_or_ambiguous = 0
    relation_counts: Counter[str] = Counter()
    attributed_counts: Counter[str] = Counter()
    attributed_values: dict[str, Decimal] = defaultdict(Decimal)
    award_keys: set[tuple[str, str]] = set()
    for index, item in enumerate(awards):
        if not isinstance(item, Mapping):
            raise ContractError(f"{label}.awards[{index}] non valido")
        exact_keys(item, AWARD_KEYS, f"{label}.awards[{index}]")
        key = (str(item.get("cig")), str(item.get("awardId")))
        if key in award_keys or key[0] not in cigs:
            raise ContractError(f"{label}: award duplicato o fuori CIG")
        award_keys.add(key)
        operator_refs = item.get("operatorRefs")
        if (
            not isinstance(operator_refs, list)
            or not all(isinstance(ref, str) for ref in operator_refs)
            or len(set(operator_refs)) != len(operator_refs)
            or any(ref not in refs for ref in operator_refs)
        ):
            raise ContractError(f"{label}: operatorRefs non valide")
        amount_status = item.get("amountStatus")
        amount = item.get("amount")
        attribution = item.get("attribution")
        award_id = item.get("awardId")
        if not isinstance(award_id, str) or base.parse_award_id(award_id)[0] is None:
            raise ContractError(f"{label}: chiave award non valida")
        validate_public_date(item.get("awardedAt"), f"{label}.awardedAt")
        if amount_status not in AMOUNT_STATUS_VALUES:
            raise ContractError(f"{label}: amountStatus non valido")
        if attribution not in ATTRIBUTION_VALUES:
            raise ContractError(f"{label}: attribuzione award non valida")
        if attribution == "single-operator" and len(operator_refs) != 1:
            raise ContractError(f"{label}: award single senza un operatore")
        if attribution == "no-awardee" and operator_refs:
            raise ContractError(f"{label}: award senza awardee con operatori")
        if attribution == "multipart" and len(operator_refs) < 2:
            raise ContractError(f"{label}: award multipart senza piu operatori")
        for ref in operator_refs:
            relation_counts[ref] += 1
        if attribution in {"single-operator", "multipart"}:
            stable += 1
        else:
            unstable += 1
        if attribution == "single-operator":
            single += 1
        elif attribution in {"multipart", "ambiguous"}:
            multipart_or_ambiguous += 1
        if amount_status in {"missing", "invalid", "conflicting"}:
            if amount is not None:
                raise ContractError(f"{label}: importo presente con stato {amount_status}")
        else:
            parsed = canonical_signed_decimal(amount, f"{label}.awards[{index}].amount")
            if amount_status == "negative" and parsed >= 0:
                raise ContractError(f"{label}: stato negative incoerente")
            if amount_status == "zero" and parsed != 0:
                raise ContractError(f"{label}: stato zero incoerente")
            if amount_status in {"positive-exact-cent", "positive-subcent"}:
                if parsed <= 0:
                    raise ContractError(f"{label}: importo positivo non positivo")
                with localcontext() as context:
                    context.prec = max(80, len(str(amount)) + 10)
                    cents = parsed * Decimal(100)
                    exact_cent = cents.to_integral_value() == cents
                if (amount_status == "positive-exact-cent") != exact_cent:
                    raise ContractError(f"{label}: stato centesimi incoerente")
                positive += 1
                value += parsed
                if attribution == "single-operator":
                    attributed += parsed
                    ref = operator_refs[0]
                    attributed_counts[ref] += 1
                    attributed_values[ref] += parsed
                else:
                    unattributed += parsed
    names_by_ref = {str(item["ref"]): str(item["name"]) for item in operators}
    expected_count_ranks = ranked(
        {ref: int(relation_counts[ref]) for ref in refs}, names_by_ref,
    )
    expected_value_ranks = ranked(
        {ref: attributed_values[ref] for ref in refs if attributed_values[ref] > 0}, names_by_ref,
    )
    for item in operators:
        ref = str(item["ref"])
        if relation_counts[ref] <= 0:
            raise ContractError(f"{label}: operatore senza relazioni award")
        if (
            int(item["awardCount"]) != relation_counts[ref]
            or int(item["attributedAwardCount"]) != attributed_counts[ref]
            or item["attributedValue"] != decimal_text(attributed_values[ref])
            or int(item["rankByCount"]) != expected_count_ranks[ref]
            or item["rankByValue"] != expected_value_ranks.get(ref)
        ):
            raise ContractError(f"{label}: metriche operatore non riconciliate")
    if (
        positive != summary["positiveAwardCount"]
        or decimal_text(value) != summary["awardValue"]
        or len(operators) != summary["awardeeCount"]
        or stable != summary["awardsWithStableAwardees"]
        or unstable != summary["awardsWithoutStableAwardees"]
        or single != summary["singleOperatorAwards"]
        or multipart_or_ambiguous != summary["multipartOrAmbiguousAwards"]
    ):
        raise ContractError(f"{label}: importi award non riconciliati")
    if decimal_text(attributed) != summary["attributedAwardValue"] or decimal_text(unattributed) != summary["unattributedAwardValue"]:
        raise ContractError(f"{label}: attribuzione valore non riconciliata")
    return {
        "entities": 1,
        "procedures": len(procedures),
        "awards": len(awards),
        "operators": len(operators),
        "awardeeRelations": sum(int(item["awardCount"]) for item in operators),
        "positiveAwards": positive,
        "awardValue": value,
        "attributedAwardValue": attributed,
        "unattributedAwardValue": unattributed,
    }


def check_artifact(output: Path, specification_path: Path = DEFAULT_SPEC) -> None:
    specification, spec_hash = load_spec(specification_path)
    meta = load_json(output / "meta.json")
    exact_keys(meta, META_KEYS, "meta")
    if meta.get("schemaVersion") != 1 or meta.get("dataset") != "anac-entity-procurement-page":
        raise ContractError("meta artifact inatteso")
    if meta.get("sourceSpecSha256") != spec_hash:
        raise ContractError("source spec hash diverso dal meta")
    if meta.get("scope") != specification.get("scope") or meta.get("contract") != specification.get("contract") or meta.get("privacy") != specification.get("privacy"):
        raise ContractError("contratto meta diverso dal source spec")
    parent_spec, parent_hash = base.load_source_spec(PARENT_SPEC)
    parent_parent, _ = base.verify_parent_spec(parent_spec, PARENT_SPEC)
    if parent_hash != specification["parent"]["sha256"]:  # type: ignore[index]
        raise ContractError("hash parent source spec non riconciliato")
    expected = expected_provenance(specification, spec_hash, parent_spec, parent_parent)
    if meta.get("provenance") != expected:
        raise ContractError("provenance meta diversa dai source spec")
    if meta.get("limitations") != list(LIMITATIONS):
        raise ContractError("limitations meta non riconciliate")
    privacy_forbidden = {
        "operator_cf", "operatorcf", "codiceausa", "ausa", "ruolo", "raw", "rawrow",
        "records", "entityperiods", "codice_fiscale_operatore",
    }

    def reject_private_keys(value: object, path_text: str = "meta") -> None:
        if isinstance(value, Mapping):
            for key, child in value.items():
                normalized_key = str(key).replace("-", "_").lower()
                if normalized_key in privacy_forbidden:
                    raise ContractError(f"privacy: chiave non pubblicabile in {path_text}.{key}")
                if normalized_key == "rawrows" and not isinstance(child, int):
                    raise ContractError(f"privacy: payload raw in {path_text}.{key}")
                reject_private_keys(child, f"{path_text}.{key}")
        elif isinstance(value, list):
            for index, child in enumerate(value):
                reject_private_keys(child, f"{path_text}[{index}]")

    reject_private_keys(meta)
    validate_coverage(meta.get("coverage"))
    shards = meta.get("shards")
    if not isinstance(shards, list) or len(shards) != 256:
        raise ContractError("servono 256 shard")
    aggregate_ints = Counter(
        entities=0, procedures=0, awards=0, operators=0,
        awardeeRelations=0, positiveAwards=0,
    )
    aggregate_decimals = {
        "awardValue": Decimal(0),
        "attributedAwardValue": Decimal(0),
        "unattributedAwardValue": Decimal(0),
    }
    seen_codes: set[str] = set()
    for expected, entry in zip((f"{value:02x}" for value in range(256)), shards, strict=True):
        if not isinstance(entry, Mapping):
            raise ContractError("descriptor shard non valido")
        exact_keys(entry, ("id", "path", "bytes", "sha256", "entities"), f"shard {expected}")
        if entry.get("id") != expected or entry.get("path") != f"src/data/generated/anac-entity-procurement-page/entities/{expected}.jsonl.gz":
            raise ContractError(f"shard {expected}: id o path inatteso")
        # The descriptor path is a repository-relative public path, but the
        # checker must read the artifact selected by its caller (including an
        # isolated staging directory), never a second copy under ROOT.
        path = output / "entities" / f"{expected}.jsonl.gz"
        if path.stat().st_size != entry.get("bytes") or sha256_path(path) != entry.get("sha256"):
            raise ContractError(f"shard {expected}: integrita non valida")
        rows = 0
        with gzip.open(path, "rt", encoding="utf-8") as stream:
            for line_number, line in enumerate(stream, start=1):
                try:
                    record = json.loads(line)
                except json.JSONDecodeError as exc:
                    raise ContractError(f"shard {expected}:{line_number} JSON non valido") from exc
                if not isinstance(record, Mapping):
                    raise ContractError(f"shard {expected}:{line_number} record non valido")
                code = record.get("codiceIpa")
                if not isinstance(code, str) or hashlib.sha256(code.encode("utf-8")).hexdigest()[:2] != expected or code in seen_codes:
                    raise ContractError(f"shard {expected}:{line_number} Codice IPA non valido")
                seen_codes.add(code)
                measured = validate_record(record, f"shard {expected}:{line_number}")
                reject_private_keys(record, f"shard {expected}:{line_number}")
                for key in ("entities", "procedures", "awards", "operators", "positiveAwards"):
                    aggregate_ints[key] += int(measured[key])
                aggregate_ints["awardeeRelations"] += int(
                    sum(int(item["awardCount"]) for item in record["operators"])
                )
                for key in ("awardValue", "attributedAwardValue", "unattributedAwardValue"):
                    aggregate_decimals[key] += Decimal(measured[key])
                rows += 1
        if rows != entry.get("entities"):
            raise ContractError(f"shard {expected}: conteggio enti non riconciliato")
    totals = meta.get("totals")
    if not isinstance(totals, Mapping):
        raise ContractError("totali meta mancanti")
    exact_keys(totals, (*aggregate_ints.keys(), *aggregate_decimals.keys()), "totals")
    if meta["coverage"]["linkedEntityProfiles"] != totals["entities"]:  # type: ignore[index]
        raise ContractError("coverage linkedEntityProfiles non riconciliato con totals.entities")
    for key, value in aggregate_ints.items():
        if totals.get(key) != value:
            raise ContractError(f"totale {key} non riconciliato")
    for key, value in aggregate_decimals.items():
        if totals.get(key) != decimal_text(value):
            raise ContractError(f"totale decimale {key} non riconciliato")


def parse_cig_paths(value: str) -> list[Path]:
    paths = [Path(item) for item in value.split(",") if item]
    if len(paths) != 12:
        raise argparse.ArgumentTypeError("--cig richiede dodici percorsi")
    return paths


def main(argv: list[str] | None = None) -> int:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--cig", type=parse_cig_paths)
    parser.add_argument("--stations", type=Path)
    parser.add_argument("--awards", type=Path)
    parser.add_argument("--awardees", type=Path)
    parser.add_argument("--ipa", type=Path)
    parser.add_argument("--spec", type=Path, default=DEFAULT_SPEC)
    parser.add_argument("--output", type=Path, default=DEFAULT_OUTPUT)
    parser.add_argument("--generated-at")
    parser.add_argument("--check", action="store_true")
    args = parser.parse_args(argv)
    try:
        if args.check:
            check_artifact(args.output, args.spec)
        else:
            if not all((args.cig, args.stations, args.awards, args.awardees, args.ipa)):
                parser.error("senza --check servono --cig, --stations, --awards, --awardees e --ipa")
            build(
                args.cig, args.stations, args.awards, args.awardees, args.ipa, args.output,
                specification_path=args.spec, generated_at=args.generated_at,
            )
    except (ContractError, base.ContractError, OSError, sqlite3.Error) as exc:
        parser.exit(1, f"errore: {exc}\n")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
