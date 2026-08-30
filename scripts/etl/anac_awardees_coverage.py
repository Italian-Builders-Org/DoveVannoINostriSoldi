#!/usr/bin/env python3
"""Audit the ANAC awardees-to-awards data contract.

The committed artifact is aggregate-only. Raw fiscal identifiers and company
names are read while auditing, but are never written to the manifest.
"""

from __future__ import annotations

import argparse
import csv
import hashlib
import io
import json
import re
import sqlite3
import sys
import tempfile
import unicodedata
import zipfile
from collections import Counter
from contextlib import contextmanager
from dataclasses import dataclass
from datetime import date, datetime
from pathlib import Path
from typing import Iterator, Mapping, TextIO


ROOT = Path(__file__).resolve().parents[2]
DEFAULT_SPEC = ROOT / "scripts" / "etl" / "specs" / "anac-awardees.source.json"
DEFAULT_OUTPUT = ROOT / "src" / "data" / "generated" / "anac-awardees-coverage.json"

AWARDEE_HEADERS = (
    "cig",
    "ruolo",
    "codice_fiscale",
    "denominazione",
    "tipo_soggetto",
    "id_aggiudicazione",
)
AWARD_HEADERS = (
    "cig",
    "data_aggiudicazione_definitiva",
    "esito",
    "criterio_aggiudicazione",
    "data_comunicazione_esito",
    "numero_offerte_ammesse",
    "numero_offerte_escluse",
    "importo_aggiudicazione",
    "ribasso_aggiudicazione",
    "num_imprese_offerenti",
    "flag_subappalto",
    "id_aggiudicazione",
    "cod_esito",
    "num_imprese_richiedenti",
    "asta_elettronica",
    "num_imprese_invitate",
    "massimo_ribasso",
    "minimo_ribasso",
    "FLAG_SCOMPUTO",
    "COD_PRESTAZIONI_COMPRESE",
    "PRESTAZIONI_COMPRESE",
    "CIG_PROG_ESTERNA",
    "DATA_INCARICO_PROG",
    "DATA_CONS_PROG",
    "COD_MODO_RIAGGIUDICAZIONE",
    "MODO_RIAGGIUDICAZIONE",
    "FLAG_PROC_ACCELERATA",
    "N_MANIF_INTERESSE",
)

CIG_PATTERN = re.compile(r"^[A-Z0-9]{10}$")
POSITIVE_ID_PATTERN = re.compile(r"^[0-9]+$")
TAX_ID_11_PATTERN = re.compile(r"^[0-9]{11}$")
TAX_ID_16_PATTERN = re.compile(r"^[A-Z0-9]{16}$")
OTHER_ALNUM_PATTERN = re.compile(r"^[A-Z0-9]{2,20}$")
SHA256_PATTERN = re.compile(r"^[a-f0-9]{64}$")
LICENSE_NAME = "CC BY-SA 4.0"
LICENSE_URL = "https://w3id.org/italia/controlled-vocabulary/licences/A31_CCBYSA40"
PLACEHOLDERS = {
    "-",
    "N/A",
    "NA",
    "N.D.",
    "ND",
    "NON DISPONIBILE",
    "NULL",
    "00000000000",
    "XXXXXXXXXXX",
    "XXXXXXXXXXXXXXXX",
}
GROUP_MARKERS = (
    "RAGGRUPPAMENTO",
    "CONSORZ",
    "ASSOCIAZIONE TEMPORANEA",
    "GEIE",
)
GROUP_ROLES = {"MANDATARIA", "MANDANTE", "IMPRESA AUSILIARIA"}
TAX_CLASSIFICATIONS = (
    "foreign-or-anomalous",
    "italian-shape-11-checksum-invalid",
    "italian-shape-11-checksum-valid",
    "italian-shape-16-checksum-invalid",
    "italian-shape-16-checksum-valid",
    "missing",
    "other-alphanumeric",
    "redacted-or-placeholder",
)
DATE_STATUSES = ("before-1990", "future", "invalid", "missing", "valid")


class ContractError(ValueError):
    """Raised when an input or manifest violates the measured contract."""


@dataclass(frozen=True)
class TaxId:
    original: str
    normalized: str | None
    classification: str
    shape_valid: bool
    checksum_valid: bool | None


@dataclass(frozen=True)
class AwardeeRecord:
    row_number: int
    cig_original: str
    cig: str
    cig_valid: bool
    role_original: str
    tax_id: TaxId
    name_original: str
    subject_type_original: str
    award_id_original: str
    award_id: str | None
    award_id_status: str
    grouped_relationship: bool

    @property
    def join_eligible(self) -> bool:
        return self.cig_valid and self.award_id_status == "known"


@dataclass(frozen=True)
class AwardRecord:
    row_number: int
    cig_original: str
    cig: str
    cig_valid: bool
    award_id_original: str
    award_id: str | None
    award_id_status: str
    award_date_original: str
    award_year: str
    award_date_status: str

    @property
    def join_eligible(self) -> bool:
        return self.cig_valid and self.award_id_status == "known"


def normalized_text(raw: str) -> str:
    return unicodedata.normalize("NFKC", raw).strip().upper()


def valid_numeric_tax_checksum(value: str) -> bool:
    odd_sum = sum(int(value[index]) for index in range(0, 10, 2))
    even_sum = 0
    for index in range(1, 10, 2):
        doubled = int(value[index]) * 2
        even_sum += doubled if doubled < 10 else doubled - 9
    return (10 - ((odd_sum + even_sum) % 10)) % 10 == int(value[-1])


def valid_person_tax_checksum(value: str) -> bool:
    odd_map = {
        **{str(index): mapped for index, mapped in enumerate((1, 0, 5, 7, 9, 13, 15, 17, 19, 21))},
        **dict(
            zip(
                "ABCDEFGHIJKLMNOPQRSTUVWXYZ",
                (
                    1, 0, 5, 7, 9, 13, 15, 17, 19, 21, 2, 4, 18,
                    20, 11, 3, 6, 8, 12, 14, 16, 10, 22, 25, 24, 23,
                ),
                strict=True,
            )
        ),
    }
    even_map = {
        **{str(index): index for index in range(10)},
        **{letter: index for index, letter in enumerate("ABCDEFGHIJKLMNOPQRSTUVWXYZ")},
    }
    total = 0
    for index, character in enumerate(value[:15]):
        total += odd_map[character] if index % 2 == 0 else even_map[character]
    return chr(ord("A") + total % 26) == value[-1]


def classify_tax_id(raw: str) -> TaxId:
    normalized = normalized_text(raw)
    if not normalized:
        return TaxId(raw, None, "missing", False, None)
    if normalized in PLACEHOLDERS or set(normalized) == {"*"}:
        return TaxId(raw, normalized, "redacted-or-placeholder", False, None)
    if TAX_ID_11_PATTERN.fullmatch(normalized):
        checksum_valid = valid_numeric_tax_checksum(normalized)
        classification = (
            "italian-shape-11-checksum-valid"
            if checksum_valid
            else "italian-shape-11-checksum-invalid"
        )
        return TaxId(raw, normalized, classification, True, checksum_valid)
    if TAX_ID_16_PATTERN.fullmatch(normalized):
        checksum_valid = valid_person_tax_checksum(normalized)
        classification = (
            "italian-shape-16-checksum-valid"
            if checksum_valid
            else "italian-shape-16-checksum-invalid"
        )
        return TaxId(raw, normalized, classification, True, checksum_valid)
    if OTHER_ALNUM_PATTERN.fullmatch(normalized):
        return TaxId(raw, normalized, "other-alphanumeric", False, None)
    return TaxId(raw, normalized, "foreign-or-anomalous", False, None)


def parse_award_id(raw: str) -> tuple[str | None, str]:
    value = normalized_text(raw)
    if not value:
        return None, "missing"
    if value == "-1":
        return None, "missing-sentinel"
    if POSITIVE_ID_PATTERN.fullmatch(value) and any(character != "0" for character in value):
        return value, "known"
    return None, "invalid"


def parse_awardee(row: Mapping[str, str], row_number: int) -> AwardeeRecord:
    cig_original = row["cig"]
    cig = normalized_text(cig_original)
    award_id_original = row["id_aggiudicazione"]
    award_id, award_id_status = parse_award_id(award_id_original)
    role_original = row["ruolo"]
    subject_type_original = row["tipo_soggetto"]
    role = normalized_text(role_original)
    subject_type = normalized_text(subject_type_original)
    return AwardeeRecord(
        row_number=row_number,
        cig_original=cig_original,
        cig=cig,
        cig_valid=bool(CIG_PATTERN.fullmatch(cig)),
        role_original=role_original,
        tax_id=classify_tax_id(row["codice_fiscale"]),
        name_original=row["denominazione"],
        subject_type_original=subject_type_original,
        award_id_original=award_id_original,
        award_id=award_id,
        award_id_status=award_id_status,
        grouped_relationship=(
            role in GROUP_ROLES or any(marker in subject_type for marker in GROUP_MARKERS)
        ),
    )


def parse_award_date(raw: str, observed_date: date) -> tuple[str, str]:
    value = raw.strip()
    if not value:
        return "unknown", "missing"
    try:
        parsed = date.fromisoformat(value)
    except ValueError:
        return "unknown", "invalid"
    if parsed.year < 1990:
        return "unknown", "before-1990"
    if parsed > observed_date:
        return "unknown", "future"
    return str(parsed.year), "valid"


def parse_award(row: Mapping[str, str], row_number: int, observed_date: date) -> AwardRecord:
    cig_original = row["cig"]
    cig = normalized_text(cig_original)
    award_id_original = row["id_aggiudicazione"]
    award_id, award_id_status = parse_award_id(award_id_original)
    award_year, date_status = parse_award_date(
        row["data_aggiudicazione_definitiva"], observed_date
    )
    return AwardRecord(
        row_number=row_number,
        cig_original=cig_original,
        cig=cig,
        cig_valid=bool(CIG_PATTERN.fullmatch(cig)),
        award_id_original=award_id_original,
        award_id=award_id,
        award_id_status=award_id_status,
        award_date_original=row["data_aggiudicazione_definitiva"],
        award_year=award_year,
        award_date_status=date_status,
    )


def sha256_path(path: Path) -> str:
    digest = hashlib.sha256()
    with path.open("rb") as source:
        for block in iter(lambda: source.read(1024 * 1024), b""):
            digest.update(block)
    return digest.hexdigest()


def sha256_zip_member(archive: zipfile.ZipFile, member: zipfile.ZipInfo) -> str:
    digest = hashlib.sha256()
    with archive.open(member) as source:
        for block in iter(lambda: source.read(1024 * 1024), b""):
            digest.update(block)
    return digest.hexdigest()


def source_lock_metadata(specification: Mapping[str, object]) -> dict[str, object]:
    member = specification.get("member")
    if not isinstance(member, Mapping):
        raise ContractError("Source lock: membro ZIP non valido")
    return {
        "archiveBytes": int(specification["archiveBytes"]),
        "archiveSha256": specification["archiveSha256"],
        "datasetPageUrl": specification["datasetPageUrl"],
        "delimiter": specification["delimiter"],
        "encoding": specification["encoding"],
        "headers": list(specification["headers"]),
        "member": dict(member),
        "resourceId": specification["resourceId"],
        "resourcePageUrl": specification["resourcePageUrl"],
        "resourceUrl": specification["resourceUrl"],
        "sourceLastModified": specification["sourceLastModified"],
    }


def verify_locked_input(path: Path, specification: Mapping[str, object]) -> dict[str, object]:
    if not path.is_file():
        raise ContractError(f"Input non trovato: {path}")
    expected_archive_bytes = int(specification["archiveBytes"])
    expected_archive_sha = str(specification["archiveSha256"])
    if path.stat().st_size != expected_archive_bytes:
        raise ContractError(f"{path.name}: dimensione archivio diversa dal source lock")
    if sha256_path(path) != expected_archive_sha:
        raise ContractError(f"{path.name}: SHA-256 archivio diverso dal source lock")
    if not zipfile.is_zipfile(path):
        raise ContractError(f"{path.name}: atteso un archivio ZIP valido")
    member_spec = specification["member"]
    if not isinstance(member_spec, Mapping):
        raise ContractError("Source lock: membro ZIP non valido")
    with zipfile.ZipFile(path) as archive:
        csv_members = [
            entry
            for entry in archive.infolist()
            if entry.filename.lower().endswith(".csv")
        ]
        if len(csv_members) != 1:
            raise ContractError(f"{path.name}: atteso un solo membro CSV")
        member = csv_members[0]
        if member.filename != member_spec["name"]:
            raise ContractError(f"{path.name}: nome del membro ZIP inatteso")
        if member.file_size != int(member_spec["bytes"]):
            raise ContractError(f"{path.name}: dimensione del membro ZIP inattesa")
        if f"{member.CRC:08x}" != member_spec["crc32"]:
            raise ContractError(f"{path.name}: CRC32 del membro ZIP inatteso")
        if sha256_zip_member(archive, member) != member_spec["sha256"]:
            raise ContractError(f"{path.name}: SHA-256 del membro ZIP inatteso")
    return source_lock_metadata(specification)


@contextmanager
def csv_rows(path: Path, expected_headers: tuple[str, ...]) -> Iterator[csv.DictReader]:
    archive: zipfile.ZipFile | None = None
    text_stream: TextIO
    if path.suffix.lower() == ".zip":
        if not zipfile.is_zipfile(path):
            raise ContractError(f"{path.name}: ZIP non valido")
        archive = zipfile.ZipFile(path)
        csv_members = [
            entry
            for entry in archive.infolist()
            if entry.filename.lower().endswith(".csv")
        ]
        if len(csv_members) != 1:
            archive.close()
            raise ContractError(f"{path.name}: atteso un solo membro CSV")
        text_stream = io.TextIOWrapper(
            archive.open(csv_members[0]), encoding="utf-8-sig", newline=""
        )
    else:
        text_stream = path.open("r", encoding="utf-8-sig", newline="")
    try:
        reader = csv.DictReader(text_stream, delimiter=";", strict=True)
        if tuple(reader.fieldnames or ()) != expected_headers:
            raise ContractError(
                f"{path.name}: header inatteso; atteso ordine esatto {', '.join(expected_headers)}"
            )
        yield reader
    except (UnicodeDecodeError, csv.Error) as exc:
        raise ContractError(f"{path.name}: CSV non valido: {exc}") from exc
    finally:
        text_stream.close()
        if archive is not None:
            archive.close()


def checked_row(
    row: dict[str | None, str | list[str] | None],
    *,
    path: Path,
    row_number: int,
) -> dict[str, str]:
    if None in row or any(value is None or isinstance(value, list) for value in row.values()):
        raise ContractError(f"{path.name}: riga {row_number} con numero di colonne inatteso")
    return {str(key): str(value) for key, value in row.items()}


def row_hash(values: tuple[str, ...]) -> str:
    payload = json.dumps(values, ensure_ascii=False, separators=(",", ":")).encode("utf-8")
    return hashlib.sha256(payload).hexdigest()


def scalar(connection: sqlite3.Connection, query: str, parameters: tuple[object, ...] = ()) -> int:
    value = connection.execute(query, parameters).fetchone()[0]
    return int(value or 0)


def make_database(path: Path) -> sqlite3.Connection:
    connection = sqlite3.connect(path)
    connection.executescript(
        """
        PRAGMA journal_mode = OFF;
        PRAGMA synchronous = OFF;
        PRAGMA temp_store = MEMORY;
        PRAGMA cache_size = -200000;

        CREATE TABLE awards (
          award_id TEXT NOT NULL,
          cig TEXT NOT NULL,
          award_year TEXT NOT NULL,
          row_count INTEGER NOT NULL,
          PRIMARY KEY (award_id, cig, award_year)
        ) WITHOUT ROWID;
        CREATE TABLE award_hashes (
          signature TEXT PRIMARY KEY,
          award_id TEXT NOT NULL,
          cig TEXT NOT NULL,
          row_count INTEGER NOT NULL
        ) WITHOUT ROWID;
        CREATE TABLE awardee_pairs (
          award_id TEXT NOT NULL,
          cig TEXT NOT NULL,
          row_count INTEGER NOT NULL,
          rows_with_tax INTEGER NOT NULL,
          shape_valid_rows INTEGER NOT NULL,
          checksum_valid_rows INTEGER NOT NULL,
          redacted_rows INTEGER NOT NULL,
          anomalous_rows INTEGER NOT NULL,
          grouped_rows INTEGER NOT NULL,
          PRIMARY KEY (award_id, cig)
        ) WITHOUT ROWID;
        CREATE TABLE awardee_parties (
          award_id TEXT NOT NULL,
          cig TEXT NOT NULL,
          tax_id TEXT NOT NULL,
          PRIMARY KEY (award_id, cig, tax_id)
        ) WITHOUT ROWID;
        CREATE TABLE tax_values (
          tax_id TEXT PRIMARY KEY
        ) WITHOUT ROWID;
        CREATE TABLE tax_name_pairs (
          tax_id TEXT NOT NULL,
          name TEXT NOT NULL,
          PRIMARY KEY (tax_id, name)
        ) WITHOUT ROWID;
        CREATE TABLE awardee_hashes (
          signature TEXT PRIMARY KEY,
          award_id TEXT NOT NULL,
          cig TEXT NOT NULL,
          row_count INTEGER NOT NULL
        ) WITHOUT ROWID;
        """
    )
    return connection


def flush_awards(
    connection: sqlite3.Connection,
    awards: list[tuple[str, str, str, int]],
    hashes: list[tuple[str, str, str, int]],
) -> None:
    connection.executemany(
        """
        INSERT INTO awards VALUES (?, ?, ?, ?)
        ON CONFLICT (award_id, cig, award_year)
        DO UPDATE SET row_count = row_count + excluded.row_count
        """,
        awards,
    )
    connection.executemany(
        """
        INSERT INTO award_hashes VALUES (?, ?, ?, ?)
        ON CONFLICT (signature)
        DO UPDATE SET row_count = row_count + excluded.row_count
        """,
        hashes,
    )
    awards.clear()
    hashes.clear()


def flush_awardees(
    connection: sqlite3.Connection,
    pairs: list[tuple[object, ...]],
    parties: list[tuple[str, str, str]],
    tax_values: list[tuple[str]],
    tax_names: list[tuple[str, str]],
    hashes: list[tuple[str, str, str, int]],
) -> None:
    connection.executemany(
        """
        INSERT INTO awardee_pairs VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
        ON CONFLICT (award_id, cig) DO UPDATE SET
          row_count = row_count + excluded.row_count,
          rows_with_tax = rows_with_tax + excluded.rows_with_tax,
          shape_valid_rows = shape_valid_rows + excluded.shape_valid_rows,
          checksum_valid_rows = checksum_valid_rows + excluded.checksum_valid_rows,
          redacted_rows = redacted_rows + excluded.redacted_rows,
          anomalous_rows = anomalous_rows + excluded.anomalous_rows,
          grouped_rows = grouped_rows + excluded.grouped_rows
        """,
        pairs,
    )
    connection.executemany(
        "INSERT OR IGNORE INTO awardee_parties VALUES (?, ?, ?)", parties
    )
    connection.executemany("INSERT OR IGNORE INTO tax_values VALUES (?)", tax_values)
    connection.executemany(
        "INSERT OR IGNORE INTO tax_name_pairs VALUES (?, ?)", tax_names
    )
    connection.executemany(
        """
        INSERT INTO awardee_hashes VALUES (?, ?, ?, ?)
        ON CONFLICT (signature)
        DO UPDATE SET row_count = row_count + excluded.row_count
        """,
        hashes,
    )
    pairs.clear()
    parties.clear()
    tax_values.clear()
    tax_names.clear()
    hashes.clear()


def load_awards(
    connection: sqlite3.Connection,
    path: Path,
    observed_date: date,
) -> tuple[Counter[str], Counter[str]]:
    counts: Counter[str] = Counter()
    date_statuses: Counter[str] = Counter()
    awards: list[tuple[str, str, str, int]] = []
    hashes: list[tuple[str, str, str, int]] = []
    with csv_rows(path, AWARD_HEADERS) as reader:
        for row_number, raw_row in enumerate(reader, start=2):
            row = checked_row(raw_row, path=path, row_number=row_number)
            record = parse_award(row, row_number, observed_date)
            counts["rowsTotal"] += 1
            counts["rowsWithCig"] += int(bool(record.cig_original.strip()))
            counts["rowsWithAwardId"] += int(bool(record.award_id_original.strip()))
            counts["validCigRows"] += int(record.cig_valid)
            counts[f"awardId:{record.award_id_status}"] += 1
            date_statuses[record.award_date_status] += 1
            signature = row_hash(tuple(row[header] for header in AWARD_HEADERS))
            hashes.append(
                (
                    signature,
                    record.award_id or record.award_id_original,
                    record.cig,
                    1,
                )
            )
            if record.join_eligible:
                awards.append((record.award_id or "", record.cig, record.award_year, 1))
                counts["joinEligibleRows"] += 1
            if len(awards) + len(hashes) >= 20_000:
                flush_awards(connection, awards, hashes)
            if counts["rowsTotal"] % 1_000_000 == 0:
                print(f"Aggiudicazioni lette: {counts['rowsTotal']:,}", file=sys.stderr)
    flush_awards(connection, awards, hashes)
    connection.commit()
    return counts, date_statuses


def load_awardees(
    connection: sqlite3.Connection,
    path: Path,
) -> tuple[Counter[str], Counter[str], Counter[str]]:
    counts: Counter[str] = Counter()
    tax_classes: Counter[str] = Counter()
    roles: Counter[str] = Counter()
    pairs: list[tuple[object, ...]] = []
    parties: list[tuple[str, str, str]] = []
    tax_values: list[tuple[str]] = []
    tax_names: list[tuple[str, str]] = []
    hashes: list[tuple[str, str, str, int]] = []
    with csv_rows(path, AWARDEE_HEADERS) as reader:
        for row_number, raw_row in enumerate(reader, start=2):
            row = checked_row(raw_row, path=path, row_number=row_number)
            record = parse_awardee(row, row_number)
            tax_id = record.tax_id
            counts["rowsTotal"] += 1
            counts["rowsWithCig"] += int(bool(record.cig_original.strip()))
            counts["rowsWithAwardId"] += int(bool(record.award_id_original.strip()))
            counts["rowsWithTaxId"] += int(bool(tax_id.original.strip()))
            counts["rowsWithName"] += int(bool(record.name_original.strip()))
            counts["rowsWithRole"] += int(bool(record.role_original.strip()))
            counts["rowsWithSubjectType"] += int(bool(record.subject_type_original.strip()))
            counts["validCigRows"] += int(record.cig_valid)
            counts[f"awardId:{record.award_id_status}"] += 1
            counts["normalizedTaxIdRows"] += int(tax_id.normalized is not None)
            counts["normalizationChangedRows"] += int(
                tax_id.normalized is not None and tax_id.normalized != tax_id.original
            )
            counts["taxIdShapeValidRows"] += int(tax_id.shape_valid)
            counts["taxIdChecksumValidRows"] += int(tax_id.checksum_valid is True)
            counts["groupedRelationshipRows"] += int(record.grouped_relationship)
            tax_classes[tax_id.classification] += 1
            roles[normalized_text(record.role_original) or "(missing)"] += 1
            signature = row_hash(tuple(row[header] for header in AWARDEE_HEADERS))
            hashes.append(
                (
                    signature,
                    record.award_id or record.award_id_original,
                    record.cig,
                    1,
                )
            )
            if tax_id.normalized and tax_id.classification not in {"redacted-or-placeholder"}:
                tax_values.append((tax_id.normalized,))
                name = normalized_text(record.name_original)
                if name:
                    tax_names.append((tax_id.normalized, name))
            if record.join_eligible:
                counts["joinEligibleRows"] += 1
                anomalous = tax_id.classification in {
                    "other-alphanumeric",
                    "foreign-or-anomalous",
                    "italian-shape-11-checksum-invalid",
                    "italian-shape-16-checksum-invalid",
                }
                pairs.append(
                    (
                        record.award_id,
                        record.cig,
                        1,
                        int(bool(tax_id.original.strip())),
                        int(tax_id.shape_valid),
                        int(tax_id.checksum_valid is True),
                        int(tax_id.classification == "redacted-or-placeholder"),
                        int(anomalous),
                        int(record.grouped_relationship),
                    )
                )
                if tax_id.normalized and tax_id.classification != "redacted-or-placeholder":
                    parties.append((record.award_id or "", record.cig, tax_id.normalized))
            if sum(map(len, (pairs, parties, tax_values, tax_names, hashes))) >= 40_000:
                flush_awardees(
                    connection, pairs, parties, tax_values, tax_names, hashes
                )
            if counts["rowsTotal"] % 1_000_000 == 0:
                print(f"Aggiudicatari letti: {counts['rowsTotal']:,}", file=sys.stderr)
    flush_awardees(connection, pairs, parties, tax_values, tax_names, hashes)
    connection.commit()
    return counts, tax_classes, roles


def source_input_for_fixture(path: Path) -> dict[str, object]:
    return {
        "archiveBytes": path.stat().st_size,
        "archiveSha256": sha256_path(path),
        "fileName": path.name,
        "official": False,
    }


def query_reconciliation(connection: sqlite3.Connection) -> dict[str, int | list[str]]:
    exact_filter = (
        "EXISTS (SELECT 1 FROM award_pair_year a "
        "WHERE a.award_id = e.award_id AND a.cig = e.cig)"
    )
    id_filter = "EXISTS (SELECT 1 FROM award_pair_year a WHERE a.award_id = e.award_id)"
    cig_filter = "EXISTS (SELECT 1 FROM award_pair_year a WHERE a.cig = e.cig)"
    matched_rows = scalar(
        connection, f"SELECT SUM(row_count) FROM awardee_pairs e WHERE {exact_filter}"
    )
    both_different_rows = scalar(
        connection,
        f"SELECT SUM(row_count) FROM awardee_pairs e WHERE NOT ({exact_filter}) "
        f"AND {id_filter} AND {cig_filter}",
    )
    id_only_rows = scalar(
        connection,
        f"SELECT SUM(row_count) FROM awardee_pairs e WHERE NOT ({exact_filter}) "
        f"AND {id_filter} AND NOT ({cig_filter})",
    )
    cig_only_rows = scalar(
        connection,
        f"SELECT SUM(row_count) FROM awardee_pairs e WHERE NOT ({exact_filter}) "
        f"AND NOT ({id_filter}) AND {cig_filter}",
    )
    neither_rows = scalar(
        connection,
        f"SELECT SUM(row_count) FROM awardee_pairs e WHERE NOT ({exact_filter}) "
        f"AND NOT ({id_filter}) AND NOT ({cig_filter})",
    )
    return {
        "joinKey": ["cig", "id_aggiudicazione"],
        "matchedAwardeeRows": matched_rows,
        "bothKeysExistButPairDiffersRows": both_different_rows,
        "awardIdOnlyMatchRows": id_only_rows,
        "cigOnlyMatchRows": cig_only_rows,
        "neitherKeyMatchesRows": neither_rows,
        "matchedAwardeePairs": scalar(
            connection,
            f"SELECT COUNT(*) FROM awardee_pairs e WHERE {exact_filter}",
        ),
        "unmatchedAwardeePairs": scalar(
            connection,
            f"SELECT COUNT(*) FROM awardee_pairs e WHERE NOT ({exact_filter})",
        ),
        "awardPairsWithAwardees": scalar(
            connection,
            """
            SELECT COUNT(*) FROM award_pair_year a
            WHERE EXISTS (
              SELECT 1 FROM awardee_pairs e
              WHERE e.award_id = a.award_id AND e.cig = a.cig
            )
            """,
        ),
        "awardPairsWithoutAwardees": scalar(
            connection,
            """
            SELECT COUNT(*) FROM award_pair_year a
            WHERE NOT EXISTS (
              SELECT 1 FROM awardee_pairs e
              WHERE e.award_id = a.award_id AND e.cig = a.cig
            )
            """,
        ),
    }


def query_periods(connection: sqlite3.Connection) -> list[dict[str, int | str]]:
    rows_by_year: dict[str, dict[str, int | str]] = {}
    for row in connection.execute(
        """
        SELECT a.award_year,
               COUNT(*) AS distinct_pairs,
               SUM(e.row_count),
               SUM(e.rows_with_tax),
               SUM(e.shape_valid_rows),
               SUM(e.checksum_valid_rows),
               SUM(e.redacted_rows),
               SUM(e.anomalous_rows),
               SUM(e.grouped_rows)
        FROM award_pair_year a
        JOIN awardee_pairs e USING (award_id, cig)
        GROUP BY a.award_year
        """
    ):
        year = str(row[0])
        rows_by_year[year] = {
            "year": year,
            "distinctMatchedAwardPairs": int(row[1]),
            "matchedAwardeeRows": int(row[2]),
            "rowsWithTaxId": int(row[3]),
            "taxIdShapeValidRows": int(row[4]),
            "taxIdChecksumValidRows": int(row[5]),
            "redactedOrPlaceholderRows": int(row[6]),
            "anomalousTaxIdRows": int(row[7]),
            "groupedRelationshipRows": int(row[8]),
            "exactDuplicateRows": 0,
            "awardPairsWithMultipleTaxIds": 0,
        }
    for year, duplicates in connection.execute(
        """
        SELECT a.award_year, SUM(h.row_count - 1)
        FROM awardee_hashes h
        JOIN award_pair_year a USING (award_id, cig)
        WHERE h.row_count > 1
        GROUP BY a.award_year
        """
    ):
        rows_by_year[str(year)]["exactDuplicateRows"] = int(duplicates)
    for year, multiple in connection.execute(
        """
        SELECT a.award_year, COUNT(*)
        FROM award_pair_year a
        JOIN (
          SELECT award_id, cig
          FROM awardee_parties
          GROUP BY award_id, cig
          HAVING COUNT(*) > 1
        ) p USING (award_id, cig)
        GROUP BY a.award_year
        """
    ):
        rows_by_year[str(year)]["awardPairsWithMultipleTaxIds"] = int(multiple)
    return [
        rows_by_year[key]
        for key in sorted(rows_by_year, key=lambda value: (value == "unknown", value))
    ]


def build_manifest(
    connection: sqlite3.Connection,
    *,
    observed_at: str,
    source_spec: Mapping[str, object] | None,
    source_spec_sha256: str | None,
    input_metadata: Mapping[str, dict[str, object]],
    award_counts: Counter[str],
    award_date_statuses: Counter[str],
    awardee_counts: Counter[str],
    tax_classes: Counter[str],
    roles: Counter[str],
) -> dict[str, object]:
    connection.executescript(
        """
        CREATE INDEX awards_id_idx ON awards (award_id);
        CREATE INDEX awards_cig_idx ON awards (cig);
        CREATE TABLE award_pair_year AS
        SELECT award_id,
               cig,
               CASE
                 WHEN COUNT(DISTINCT CASE WHEN award_year != 'unknown' THEN award_year END) = 1
                 THEN MAX(CASE WHEN award_year != 'unknown' THEN award_year END)
                 ELSE 'unknown'
               END AS award_year,
               SUM(row_count) AS row_count
        FROM awards
        GROUP BY award_id, cig;
        CREATE UNIQUE INDEX award_pair_year_key ON award_pair_year (award_id, cig);
        CREATE INDEX award_pair_year_id ON award_pair_year (award_id);
        CREATE INDEX award_pair_year_cig ON award_pair_year (cig);
        """
    )
    reconciliation = query_reconciliation(connection)
    eligible_awardee_rows = int(awardee_counts["joinEligibleRows"])
    classified_reconciliation_rows = sum(
        int(reconciliation[key])
        for key in (
            "matchedAwardeeRows",
            "bothKeysExistButPairDiffersRows",
            "awardIdOnlyMatchRows",
            "cigOnlyMatchRows",
            "neitherKeyMatchesRows",
        )
    )
    if classified_reconciliation_rows != eligible_awardee_rows:
        raise ContractError("Le classi di riconciliazione non partizionano le righe eleggibili")

    awardee_exact_duplicates = scalar(
        connection, "SELECT SUM(row_count - 1) FROM awardee_hashes WHERE row_count > 1"
    )
    award_exact_duplicates = scalar(
        connection, "SELECT SUM(row_count - 1) FROM award_hashes WHERE row_count > 1"
    )
    awardee_rows_total = int(awardee_counts["rowsTotal"])
    awards_rows_total = int(award_counts["rowsTotal"])
    manifest: dict[str, object] = {
        "schemaVersion": 1,
        "dataset": "anac-awardees-coverage",
        "observedAt": observed_at,
        "scope": {
            "distributionKind": "full-snapshot" if source_spec else "synthetic-fixture",
            "deltasApplied": [],
            "nationalPopulationClaim": "not-asserted",
            "temporalAlignment": "cross-snapshot" if source_spec else "synthetic-fixture",
            "note": (
                "Misura i due full snapshot ANAC hash-pinned. I delta mensili "
                "successivi non sono sommati: "
                "la loro semantica di aggiornamento richiede una slice separata."
            ),
            "temporalCaveat": (
                "Le risorse sono snapshot editoriali indipendenti con date di "
                "ultima modifica diverse; "
                "gli unmatched non misurano una mancanza allo stesso istante."
            ),
        },
        "sourceSpecSha256": source_spec_sha256,
        "license": (
            source_spec["license"]
            if source_spec
            else {"name": "synthetic fixture", "url": None}
        ),
        "inputs": input_metadata,
        "contract": {
            "awardeeGrain": (
                "una riga sorgente per relazione fra aggiudicazione e "
                "soggetto aggiudicatario"
            ),
            "awardGrain": "una riga sorgente di aggiudicazione",
            "joinKey": ["cig", "id_aggiudicazione"],
            "awardIdRepresentation": "string",
            "missingAwardIdSentinel": "-1",
            "namesAreIdentifiers": False,
            "taxIdNormalization": (
                "Unicode NFKC, trim e maiuscole; nessuna rimozione di "
                "punteggiatura o zeri"
            ),
            "awardAmountPolicy": "not-measured-in-this-slice",
            "distinctPartyPolicy": (
                "codice fiscale normalizzato distinto per coppia di join; "
                "i ruoli ripetuti non creano soggetti aggiuntivi"
            ),
        },
        "coverage": {
            "awardees": {
                "rowsTotal": awardee_rows_total,
                "rowsWithCig": int(awardee_counts["rowsWithCig"]),
                "validCigRows": int(awardee_counts["validCigRows"]),
                "rowsWithAwardId": int(awardee_counts["rowsWithAwardId"]),
                "knownAwardIdRows": int(awardee_counts["awardId:known"]),
                "missingAwardIdRows": int(awardee_counts["awardId:missing"]),
                "missingAwardIdSentinelRows": int(awardee_counts["awardId:missing-sentinel"]),
                "invalidAwardIdRows": int(awardee_counts["awardId:invalid"]),
                "joinEligibleRows": eligible_awardee_rows,
                "rowsWithTaxId": int(awardee_counts["rowsWithTaxId"]),
                "rowsWithName": int(awardee_counts["rowsWithName"]),
                "rowsWithRole": int(awardee_counts["rowsWithRole"]),
                "rowsWithSubjectType": int(awardee_counts["rowsWithSubjectType"]),
                "normalizedTaxIdRows": int(awardee_counts["normalizedTaxIdRows"]),
                "normalizationChangedRows": int(awardee_counts["normalizationChangedRows"]),
                "taxIdShapeValidRows": int(awardee_counts["taxIdShapeValidRows"]),
                "taxIdChecksumValidRows": int(awardee_counts["taxIdChecksumValidRows"]),
                "taxIdClassRows": {
                    key: int(tax_classes[key]) for key in TAX_CLASSIFICATIONS
                },
                "distinctNormalizedTaxIds": scalar(connection, "SELECT COUNT(*) FROM tax_values"),
                "exactDuplicateRows": awardee_exact_duplicates,
                "exactDuplicateGroups": scalar(
                    connection, "SELECT COUNT(*) FROM awardee_hashes WHERE row_count > 1"
                ),
                "distinctJoinPairs": scalar(connection, "SELECT COUNT(*) FROM awardee_pairs"),
                "awardPairsWithMultipleTaxIds": scalar(
                    connection,
                    """
                    SELECT COUNT(*) FROM (
                      SELECT award_id, cig FROM awardee_parties
                      GROUP BY award_id, cig HAVING COUNT(*) > 1
                    )
                    """,
                ),
                "maxTaxIdsPerAwardPair": scalar(
                    connection,
                    """
                    SELECT MAX(parties) FROM (
                      SELECT COUNT(*) AS parties FROM awardee_parties GROUP BY award_id, cig
                    )
                    """,
                ),
                "groupedRelationshipRows": int(awardee_counts["groupedRelationshipRows"]),
                "roleRows": dict(sorted(roles.items())),
                "taxIdsWithMultipleNames": scalar(
                    connection,
                    """
                    SELECT COUNT(*) FROM (
                      SELECT tax_id FROM tax_name_pairs GROUP BY tax_id HAVING COUNT(*) > 1
                    )
                    """,
                ),
                "namesWithMultipleTaxIds": scalar(
                    connection,
                    """
                    SELECT COUNT(*) FROM (
                      SELECT name FROM tax_name_pairs GROUP BY name HAVING COUNT(*) > 1
                    )
                    """,
                ),
            },
            "awards": {
                "rowsTotal": awards_rows_total,
                "rowsWithCig": int(award_counts["rowsWithCig"]),
                "validCigRows": int(award_counts["validCigRows"]),
                "rowsWithAwardId": int(award_counts["rowsWithAwardId"]),
                "knownAwardIdRows": int(award_counts["awardId:known"]),
                "missingAwardIdRows": int(award_counts["awardId:missing"]),
                "missingAwardIdSentinelRows": int(award_counts["awardId:missing-sentinel"]),
                "invalidAwardIdRows": int(award_counts["awardId:invalid"]),
                "joinEligibleRows": int(award_counts["joinEligibleRows"]),
                "distinctJoinPairs": scalar(connection, "SELECT COUNT(*) FROM award_pair_year"),
                "exactDuplicateRows": award_exact_duplicates,
                "exactDuplicateGroups": scalar(
                    connection, "SELECT COUNT(*) FROM award_hashes WHERE row_count > 1"
                ),
                "awardIdsWithMultipleCigs": scalar(
                    connection,
                    """
                    SELECT COUNT(*) FROM (
                      SELECT award_id FROM award_pair_year GROUP BY award_id HAVING COUNT(*) > 1
                    )
                    """,
                ),
                "cigsWithMultipleAwardIds": scalar(
                    connection,
                    """
                    SELECT COUNT(*) FROM (
                      SELECT cig FROM award_pair_year GROUP BY cig HAVING COUNT(*) > 1
                    )
                    """,
                ),
                "dateStatusRows": {
                    key: int(award_date_statuses[key]) for key in DATE_STATUSES
                },
            },
        },
        "reconciliation": {
            **reconciliation,
            "eligibleAwardeeRows": eligible_awardee_rows,
            "ineligibleAwardeeRows": awardee_rows_total - eligible_awardee_rows,
        },
        "byAwardYear": query_periods(connection),
        "privacy": {
            "containsRawTaxIds": False,
            "containsNormalizedTaxIds": False,
            "containsCompanyNames": False,
            "fixturePolicy": "synthetic-only",
        },
        "limitations": [
            "La validità sintattica o del checksum non certifica l'identità "
            "anagrafica del soggetto.",
            "Più soggetti sulla stessa aggiudicazione possono rappresentare "
            "RTI, consorzi o altri ruoli legittimi.",
            "Questa slice non analizza qualità, segno o scala degli importi di aggiudicazione.",
            "Le due risorse hanno date di ultima modifica diverse: gli unmatched "
            "descrivono un join cross-snapshot.",
            "Il manifest non autorizza ranking, HHI, soglie, benchmark o inferenze di illecito.",
            "L'identità dell'ente richiede un ulteriore join ufficiale con i dati "
            "CIG/stazione appaltante.",
        ],
    }
    validate_manifest(
        manifest,
        source_spec=source_spec,
        source_spec_sha256=source_spec_sha256,
    )
    return manifest


def validate_official_url(value: object) -> bool:
    return isinstance(value, str) and value.startswith("https://dati.anticorruzione.it/")


def manifest_integer(value: object, label: str, maximum: int | None = None) -> int:
    if (
        isinstance(value, bool)
        or not isinstance(value, int)
        or value < 0
        or (maximum is not None and value > maximum)
    ):
        raise ContractError(f"Manifest ANAC aggiudicatari: {label} non valido")
    return value


def manifest_integer_map(
    value: object,
    label: str,
    maximum: int,
    expected_keys: set[str] | None = None,
) -> int:
    if not isinstance(value, Mapping) or (
        expected_keys is not None and set(value) != expected_keys
    ):
        raise ContractError(f"Manifest ANAC aggiudicatari: {label} non valido")
    total = 0
    for key, candidate in value.items():
        if not isinstance(key, str) or not key:
            raise ContractError(f"Manifest ANAC aggiudicatari: {label} non valido")
        total += manifest_integer(candidate, f"{label}.{key}", maximum)
    return total


def validate_manifest(
    manifest: Mapping[str, object],
    *,
    source_spec: Mapping[str, object] | None,
    source_spec_sha256: str | None = None,
) -> None:
    if manifest.get("schemaVersion") != 1 or manifest.get("dataset") != "anac-awardees-coverage":
        raise ContractError("Manifest ANAC aggiudicatari: schema inatteso")
    scope = manifest.get("scope")
    expected_distribution = "full-snapshot" if source_spec else "synthetic-fixture"
    expected_alignment = "cross-snapshot" if source_spec else "synthetic-fixture"
    if (
        not isinstance(scope, Mapping)
        or scope.get("distributionKind") != expected_distribution
        or scope.get("deltasApplied") != []
        or scope.get("nationalPopulationClaim") != "not-asserted"
        or scope.get("temporalAlignment") != expected_alignment
        or not isinstance(scope.get("note"), str)
        or not str(scope.get("note")).strip()
        or not isinstance(scope.get("temporalCaveat"), str)
        or not str(scope.get("temporalCaveat")).strip()
    ):
        raise ContractError("Manifest ANAC aggiudicatari: perimetro non valido")
    privacy = manifest.get("privacy")
    if not isinstance(privacy, Mapping) or any(
        privacy.get(key) is not False
        for key in ("containsRawTaxIds", "containsNormalizedTaxIds", "containsCompanyNames")
    ):
        raise ContractError("Manifest ANAC aggiudicatari: privacy contract violato")
    contract = manifest.get("contract")
    if (
        not isinstance(contract, Mapping)
        or contract.get("joinKey") != ["cig", "id_aggiudicazione"]
        or contract.get("awardAmountPolicy") != "not-measured-in-this-slice"
        or not isinstance(contract.get("distinctPartyPolicy"), str)
    ):
        raise ContractError("Manifest ANAC aggiudicatari: chiave di join inattesa")
    coverage = manifest.get("coverage")
    reconciliation = manifest.get("reconciliation")
    if not isinstance(coverage, Mapping) or not isinstance(reconciliation, Mapping):
        raise ContractError("Manifest ANAC aggiudicatari: copertura mancante")
    awardees = coverage.get("awardees")
    awards = coverage.get("awards")
    if not isinstance(awardees, Mapping) or not isinstance(awards, Mapping):
        raise ContractError("Manifest ANAC aggiudicatari: sezioni di copertura mancanti")
    totals: list[int] = []
    for section in (awardees, awards):
        total = manifest_integer(section.get("rowsTotal"), "totale righe")
        totals.append(total)
        aggregate_maps = {"taxIdClassRows", "roleRows", "dateStatusRows"}
        for key, value in section.items():
            if key.endswith("Rows") and key != "rowsTotal" and key not in aggregate_maps:
                manifest_integer(value, key, total)
    awardee_total, _ = totals
    award_total = totals[1]
    eligible = manifest_integer(
        reconciliation.get("eligibleAwardeeRows"), "righe eleggibili", awardee_total
    )
    reconciliation_keys = (
        "matchedAwardeeRows",
        "bothKeysExistButPairDiffersRows",
        "awardIdOnlyMatchRows",
        "cigOnlyMatchRows",
        "neitherKeyMatchesRows",
    )
    reconciled = sum(
        manifest_integer(reconciliation.get(key), key, awardee_total)
        for key in reconciliation_keys
    )
    if reconciled != eligible:
        raise ContractError("Manifest ANAC aggiudicatari: riconciliazione incoerente")
    if (
        manifest_integer(
            reconciliation.get("ineligibleAwardeeRows"),
            "righe non eleggibili",
            awardee_total,
        )
        + eligible
        != awardee_total
    ):
        raise ContractError("Manifest ANAC aggiudicatari: eleggibilità incoerente")
    tax_classes = awardees.get("taxIdClassRows")
    if manifest_integer_map(
        tax_classes,
        "classi fiscali",
        awardee_total,
        set(TAX_CLASSIFICATIONS),
    ) != awardee_total:
        raise ContractError("Manifest ANAC aggiudicatari: classi fiscali incoerenti")
    if manifest_integer_map(
        awardees.get("roleRows"), "ruoli", awardee_total
    ) != awardee_total:
        raise ContractError("Manifest ANAC aggiudicatari: ruoli incoerenti")
    if manifest_integer_map(
        awards.get("dateStatusRows"),
        "stati data",
        award_total,
        set(DATE_STATUSES),
    ) != award_total:
        raise ContractError("Manifest ANAC aggiudicatari: stati data incoerenti")
    for key in (
        "distinctNormalizedTaxIds",
        "exactDuplicateGroups",
        "distinctJoinPairs",
        "awardPairsWithMultipleTaxIds",
        "maxTaxIdsPerAwardPair",
        "taxIdsWithMultipleNames",
        "namesWithMultipleTaxIds",
    ):
        manifest_integer(awardees.get(key), f"aggiudicatari.{key}", awardee_total)
    for key in (
        "distinctJoinPairs",
        "exactDuplicateGroups",
        "awardIdsWithMultipleCigs",
        "cigsWithMultipleAwardIds",
    ):
        manifest_integer(awards.get(key), f"aggiudicazioni.{key}", award_total)
    if (
        manifest_integer(awardees.get("distinctJoinPairs"), "coppie aggiudicatario")
        > manifest_integer(awardees.get("joinEligibleRows"), "righe eleggibili")
        or manifest_integer(
            awardees.get("awardPairsWithMultipleTaxIds"), "coppie multi-soggetto"
        )
        > manifest_integer(awardees.get("distinctJoinPairs"), "coppie aggiudicatario")
        or manifest_integer(awards.get("distinctJoinPairs"), "coppie aggiudicazione")
        > manifest_integer(awards.get("joinEligibleRows"), "aggiudicazioni eleggibili")
    ):
        raise ContractError("Manifest ANAC aggiudicatari: metriche distinte incoerenti")
    if (
        manifest_integer(reconciliation.get("matchedAwardeePairs"), "coppie abbinate")
        + manifest_integer(reconciliation.get("unmatchedAwardeePairs"), "coppie non abbinate")
        != manifest_integer(awardees.get("distinctJoinPairs"), "coppie aggiudicatario")
        or manifest_integer(
            reconciliation.get("awardPairsWithAwardees"), "aggiudicazioni con soggetti"
        )
        + manifest_integer(
            reconciliation.get("awardPairsWithoutAwardees"), "aggiudicazioni senza soggetti"
        )
        != manifest_integer(awards.get("distinctJoinPairs"), "coppie aggiudicazione")
    ):
        raise ContractError("Manifest ANAC aggiudicatari: cardinalità del join incoerenti")
    periods = manifest.get("byAwardYear")
    if not isinstance(periods, list) or not periods:
        raise ContractError("Manifest ANAC aggiudicatari: copertura annuale mancante")
    years: set[str] = set()
    matched_by_year = 0
    for period in periods:
        if not isinstance(period, Mapping):
            raise ContractError("Manifest ANAC aggiudicatari: periodo annuale non valido")
        year = period.get("year")
        if not isinstance(year, str) or year in years:
            raise ContractError("Manifest ANAC aggiudicatari: anno duplicato o non valido")
        years.add(year)
        period_rows = manifest_integer(
            period.get("matchedAwardeeRows"), f"righe {year}", awardee_total
        )
        matched_by_year += period_rows
        for key in (
            "rowsWithTaxId",
            "taxIdShapeValidRows",
            "taxIdChecksumValidRows",
            "redactedOrPlaceholderRows",
            "anomalousTaxIdRows",
            "groupedRelationshipRows",
            "exactDuplicateRows",
        ):
            manifest_integer(period.get(key), f"{year}.{key}", period_rows)
        period_pairs = manifest_integer(
            period.get("distinctMatchedAwardPairs"), f"{year}.distinctMatchedAwardPairs"
        )
        if (
            period_pairs > period_rows
            or manifest_integer(
                period.get("awardPairsWithMultipleTaxIds"),
                f"{year}.awardPairsWithMultipleTaxIds",
            )
            > period_pairs
        ):
            raise ContractError("Manifest ANAC aggiudicatari: periodo incoerente")
    if matched_by_year != manifest_integer(
        reconciliation.get("matchedAwardeeRows"), "righe abbinate"
    ):
        raise ContractError("Manifest ANAC aggiudicatari: anni non riconciliati")
    inputs = manifest.get("inputs")
    if not isinstance(inputs, Mapping) or set(inputs) != {"awardees", "awards"}:
        raise ContractError("Manifest ANAC aggiudicatari: input mancanti")
    if source_spec is not None:
        if not source_spec_sha256 or not SHA256_PATTERN.fullmatch(source_spec_sha256):
            raise ContractError("Manifest ANAC aggiudicatari: hash del source spec mancante")
        if manifest.get("sourceSpecSha256") != source_spec_sha256:
            raise ContractError("Manifest ANAC aggiudicatari: source spec drift")
        expected_license = {"name": LICENSE_NAME, "url": LICENSE_URL}
        if (
            source_spec.get("license") != expected_license
            or manifest.get("license") != expected_license
        ):
            raise ContractError("Manifest ANAC aggiudicatari: licenza inattesa")
        source_inputs = source_spec.get("inputs")
        if not isinstance(source_inputs, Mapping):
            raise ContractError("Manifest ANAC aggiudicatari: input del source spec mancanti")
        for label in ("awardees", "awards"):
            metadata = inputs.get(label)
            input_spec = source_inputs.get(label)
            if not isinstance(metadata, Mapping):
                raise ContractError("Manifest ANAC aggiudicatari: metadati input non validi")
            if not isinstance(input_spec, Mapping) or dict(
                metadata
            ) != source_lock_metadata(input_spec):
                raise ContractError("Manifest ANAC aggiudicatari: source lock input drift")
            if not validate_official_url(metadata.get("resourceUrl")):
                raise ContractError("Manifest ANAC aggiudicatari: URL sorgente non ufficiale")
            if not SHA256_PATTERN.fullmatch(str(metadata.get("archiveSha256", ""))):
                raise ContractError("Manifest ANAC aggiudicatari: SHA-256 non valido")


def audit(
    awardees_path: Path,
    awards_path: Path,
    *,
    observed_at: str,
    source_spec: Mapping[str, object] | None,
    source_spec_sha256: str | None,
) -> dict[str, object]:
    try:
        observed_datetime = datetime.fromisoformat(observed_at.replace("Z", "+00:00"))
    except ValueError as exc:
        raise ContractError("observed-at deve essere un timestamp ISO 8601") from exc
    input_metadata: dict[str, dict[str, object]] = {}
    if source_spec:
        inputs = source_spec.get("inputs")
        if not isinstance(inputs, Mapping):
            raise ContractError("Source spec: input mancanti")
        awardees_spec = inputs.get("awardees")
        awards_spec = inputs.get("awards")
        if not isinstance(awardees_spec, Mapping) or not isinstance(awards_spec, Mapping):
            raise ContractError("Source spec: input non validi")
        if tuple(awardees_spec.get("headers", ())) != AWARDEE_HEADERS:
            raise ContractError("Source spec: header aggiudicatari inatteso")
        if tuple(awards_spec.get("headers", ())) != AWARD_HEADERS:
            raise ContractError("Source spec: header aggiudicazioni inatteso")
        input_metadata["awardees"] = verify_locked_input(awardees_path, awardees_spec)
        input_metadata["awards"] = verify_locked_input(awards_path, awards_spec)
    else:
        input_metadata["awardees"] = source_input_for_fixture(awardees_path)
        input_metadata["awards"] = source_input_for_fixture(awards_path)

    with tempfile.TemporaryDirectory(prefix="dvns-anac-awardees-") as temporary_directory:
        connection = make_database(Path(temporary_directory) / "audit.sqlite")
        try:
            award_counts, date_statuses = load_awards(
                connection, awards_path, observed_datetime.date()
            )
            awardee_counts, tax_classes, roles = load_awardees(connection, awardees_path)
            return build_manifest(
                connection,
                observed_at=observed_at,
                source_spec=source_spec,
                source_spec_sha256=source_spec_sha256,
                input_metadata=input_metadata,
                award_counts=award_counts,
                award_date_statuses=date_statuses,
                awardee_counts=awardee_counts,
                tax_classes=tax_classes,
                roles=roles,
            )
        finally:
            connection.close()


def load_source_spec(path: Path) -> tuple[dict[str, object], str]:
    raw = path.read_bytes()
    try:
        specification = json.loads(raw)
    except json.JSONDecodeError as exc:
        raise ContractError(f"Source spec JSON non valido: {exc}") from exc
    if not isinstance(specification, dict):
        raise ContractError("Source spec non valido")
    return specification, hashlib.sha256(raw).hexdigest()


def write_json(path: Path, value: Mapping[str, object]) -> None:
    path.parent.mkdir(parents=True, exist_ok=True)
    path.write_text(json.dumps(value, ensure_ascii=False, indent=2) + "\n", encoding="utf-8")


def main() -> int:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--awardees-input", type=Path)
    parser.add_argument("--awards-input", type=Path)
    parser.add_argument("--observed-at")
    parser.add_argument("--source-spec", type=Path, default=DEFAULT_SPEC)
    parser.add_argument("--output", type=Path, default=DEFAULT_OUTPUT)
    parser.add_argument("--fixture", action="store_true", help="Skip official source-lock checks")
    parser.add_argument(
        "--check",
        action="store_true",
        help="Validate the committed manifest offline",
    )
    args = parser.parse_args()
    try:
        if args.check:
            specification, specification_sha = load_source_spec(args.source_spec)
            manifest = json.loads(args.output.read_text(encoding="utf-8"))
            validate_manifest(
                manifest,
                source_spec=specification,
                source_spec_sha256=specification_sha,
            )
            print(f"PASS {args.output.relative_to(ROOT)}")
            return 0
        if not args.awardees_input or not args.awards_input or not args.observed_at:
            parser.error("generation requires --awardees-input, --awards-input and --observed-at")
        specification: dict[str, object] | None
        specification_sha: str | None
        if args.fixture:
            specification = None
            specification_sha = None
        else:
            specification, specification_sha = load_source_spec(args.source_spec)
        manifest = audit(
            args.awardees_input,
            args.awards_input,
            observed_at=args.observed_at,
            source_spec=specification,
            source_spec_sha256=specification_sha,
        )
        write_json(args.output, manifest)
        print(f"Wrote {args.output}")
        return 0
    except (ContractError, OSError, json.JSONDecodeError) as exc:
        print(f"ERROR: {exc}", file=sys.stderr)
        return 1


if __name__ == "__main__":
    raise SystemExit(main())
