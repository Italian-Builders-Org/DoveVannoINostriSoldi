#!/usr/bin/env python3
"""Build the hash-pinned MEF municipal IRPEF snapshot for tax year 2024.

The checked-in source lock is the only authority for the release. Generation
is deliberately offline: callers must provide the already-downloaded ZIP and
an explicit observation timestamp. ``--check`` validates the two committed
artifacts without opening the network or reading the original ZIP.
"""

from __future__ import annotations

import argparse
import copy
import csv
import hashlib
import json
import os
import re
import tempfile
import zipfile
from dataclasses import dataclass, field
from datetime import datetime, timezone
from pathlib import Path
from typing import Iterable, Sequence


REPOSITORY_ROOT = Path(__file__).resolve().parents[2]
DEFAULT_LOCK = REPOSITORY_ROOT / "scripts/etl/specs/mef-irpef-2024.source.json"
DEFAULT_DATA_OUTPUT = REPOSITORY_ROOT / "src/data/generated/mef-irpef-2024.data.json"
DEFAULT_META_OUTPUT = REPOSITORY_ROOT / "src/data/generated/mef-irpef-2024.meta.json"

DATA_KEYS = (
    "schemaVersion",
    "datasetId",
    "taxYear",
    "measureOrder",
    "municipalities",
    "provinces",
    "regions",
    "national",
)
META_KEYS = (
    "schemaVersion",
    "datasetId",
    "period",
    "source",
    "coverage",
    "definitions",
    "methodology",
    "lockSha256",
    "dataArtifactBytes",
    "dataArtifactSha256",
)
MUNICIPALITY_TUPLE_SIZE = 17
MAX_SAFE_INTEGER = 9_007_199_254_740_991
NON_NEGATIVE_INTEGER = re.compile(r"^\d+$")
SIGNED_INTEGER = re.compile(r"^-?\d+$")
CADASTRAL_CODE = re.compile(r"^[A-Z]\d{3}$")
MUNICIPALITY_CODE = re.compile(r"^\d{6}$")
PROVINCE_CODE = re.compile(r"^\d{3}$")
PROVINCE_ABBREVIATION = re.compile(r"^[A-Z]{2}$")
REGION_CODE = re.compile(r"^\d{2}$")


class SnapshotError(ValueError):
    """Raised when an input or artifact diverges from the locked contract."""


MetricPair = tuple[int | None, int | None]


@dataclass(frozen=True)
class SourceRecord:
    cadastral_code: str
    municipality_code: str
    municipality_name: str
    province_code: str
    province_abbreviation: str
    source_region_name: str
    region_code: str
    taxpayers: int
    measures: tuple[MetricPair, ...]
    assigned: bool


@dataclass
class Aggregate:
    measure_count: int
    taxpayers: int = 0
    known_frequency: list[int] = field(default_factory=list)
    known_amount_cents: list[int] = field(default_factory=list)
    suppressed_rows: list[int] = field(default_factory=list)

    def __post_init__(self) -> None:
        if not self.known_frequency:
            self.known_frequency = [0] * self.measure_count
        if not self.known_amount_cents:
            self.known_amount_cents = [0] * self.measure_count
        if not self.suppressed_rows:
            self.suppressed_rows = [0] * self.measure_count

    def add(self, record: SourceRecord) -> None:
        if len(record.measures) != self.measure_count:
            raise SnapshotError("Numero di misure incoerente durante l'aggregazione")
        self.taxpayers = safe_add(self.taxpayers, record.taxpayers, "contribuenti")
        for index, (frequency, amount_cents) in enumerate(record.measures):
            if frequency is not None:
                self.known_frequency[index] = safe_add(
                    self.known_frequency[index], frequency, "frequenza aggregata"
                )
            if amount_cents is not None:
                self.known_amount_cents[index] = safe_add(
                    self.known_amount_cents[index], amount_cents, "ammontare aggregato"
                )
            if frequency is None or amount_cents is None:
                self.suppressed_rows[index] += 1

    def measures(self) -> list[list[int]]:
        return [
            [
                self.known_frequency[index],
                self.known_amount_cents[index],
                self.suppressed_rows[index],
            ]
            for index in range(self.measure_count)
        ]


def safe_add(left: int, right: int, label: str) -> int:
    result = left + right
    if abs(result) > MAX_SAFE_INTEGER:
        raise SnapshotError(f"{label} supera Number.MAX_SAFE_INTEGER")
    return result


def sha256_bytes(payload: bytes) -> str:
    return hashlib.sha256(payload).hexdigest()


def canonical_lock_sha256(lock: dict[str, object]) -> str:
    candidate = copy.deepcopy(lock)
    try:
        integrity = candidate["integrity"]
        if not isinstance(integrity, dict):
            raise TypeError
        del integrity["lockSha256"]
    except (KeyError, TypeError) as error:
        raise SnapshotError("Il source lock non contiene integrity.lockSha256") from error
    payload = json.dumps(
        candidate,
        ensure_ascii=False,
        sort_keys=True,
        separators=(",", ":"),
        allow_nan=False,
    ).encode("utf-8")
    return sha256_bytes(payload)


def require_dict(value: object, label: str) -> dict[str, object]:
    if not isinstance(value, dict):
        raise SnapshotError(f"{label} deve essere un oggetto")
    return value


def require_list(value: object, label: str) -> list[object]:
    if not isinstance(value, list):
        raise SnapshotError(f"{label} deve essere un array")
    return value


def expected_data_artifact(lock: dict[str, object]) -> tuple[int, str]:
    integrity = require_dict(lock.get("integrity"), "integrity")
    artifact = require_dict(integrity.get("dataArtifact"), "integrity.dataArtifact")
    expected_bytes = artifact.get("bytes")
    expected_sha256 = artifact.get("sha256")
    if not isinstance(expected_bytes, int) or isinstance(expected_bytes, bool) or expected_bytes <= 0:
        raise SnapshotError("integrity.dataArtifact.bytes non valido")
    if not isinstance(expected_sha256, str) or not re.fullmatch(r"[0-9a-f]{64}", expected_sha256):
        raise SnapshotError("integrity.dataArtifact.sha256 non valido")
    return expected_bytes, expected_sha256


def validate_data_artifact_binding(lock: dict[str, object], payload: bytes) -> None:
    expected_bytes, expected_sha256 = expected_data_artifact(lock)
    observed_bytes = len(payload)
    observed_sha256 = sha256_bytes(payload)
    if observed_bytes != expected_bytes or observed_sha256 != expected_sha256:
        raise SnapshotError(
            "Data artifact divergente dall'output revisionato del source lock: "
            f"bytes={observed_bytes}, sha256={observed_sha256}"
        )


def validate_lock(lock: dict[str, object]) -> None:
    if lock.get("schemaVersion") != 1:
        raise SnapshotError("Versione source lock non supportata")
    if lock.get("datasetId") != "mef_irpef_comunale":
        raise SnapshotError("datasetId MEF non canonico")
    if lock.get("taxYear") != 2024 or lock.get("declarationYear") != 2025:
        raise SnapshotError("Periodo del source lock inatteso")

    integrity = require_dict(lock.get("integrity"), "integrity")
    declared_hash = integrity.get("lockSha256")
    actual_hash = canonical_lock_sha256(lock)
    if declared_hash != actual_hash:
        raise SnapshotError(
            f"Source lock modificato senza aggiornare l'impronta: {actual_hash}"
        )
    expected_data_artifact(lock)

    csv_contract = require_dict(lock.get("csv"), "csv")
    headers = require_list(csv_contract.get("headers"), "csv.headers")
    if len(headers) != 52 or len(set(headers)) != 52 or not all(
        isinstance(header, str) and header for header in headers
    ):
        raise SnapshotError("Il source lock deve contenere 52 header univoci")
    if csv_contract.get("encoding") != "ascii":
        raise SnapshotError("Codifica CSV inattesa nel source lock")
    if csv_contract.get("delimiter") != ";" or csv_contract.get("lineEnding") != "CRLF":
        raise SnapshotError("Formato CSV inatteso nel source lock")

    measure_order = require_list(lock.get("measureOrder"), "measureOrder")
    measures = require_dict(lock.get("measures"), "measures")
    expected_order = [
        "comprehensiveIncome",
        "taxableIncome",
        "netTaxDeclared",
        "regionalSurtaxDue",
        "municipalSurtaxDue",
    ]
    if measure_order != expected_order or set(measures) != set(expected_order):
        raise SnapshotError("Ordine delle misure MEF inatteso")
    for key in expected_order:
        measure = require_dict(measures[key], f"measures.{key}")
        if measure.get("frequencyHeader") not in headers or measure.get("amountHeader") not in headers:
            raise SnapshotError(f"Header non trovato per la misura {key}")
        if measure.get("allowNegativeAmount") is not False:
            raise SnapshotError(f"La misura selezionata {key} deve essere non negativa")

    regions = require_list(lock.get("regions"), "regions")
    region_codes = [require_dict(region, "regions[]").get("code") for region in regions]
    if region_codes != [f"{code:02d}" for code in range(1, 21)]:
        raise SnapshotError("Il source lock deve contenere le 20 regioni in ordine ISTAT")

    source = require_dict(lock.get("source"), "source")
    if source.get("license") != "CC BY 3.0" or source.get("attribution") != "MEF – Dipartimento delle Finanze":
        raise SnapshotError("Licenza o attribuzione MEF inattesa")
    if source.get("licenseUrl") != "https://creativecommons.org/licenses/by/3.0/it/":
        raise SnapshotError("URL della licenza MEF inatteso")
    for key in ("landingUrl", "catalogUrl", "assetUrl", "methodologyUrl", "definitionsUrl"):
        value = source.get(key)
        if not isinstance(value, str) or not value.startswith("https://www1.finanze.gov.it/"):
            raise SnapshotError(f"URL ufficiale MEF non valido: {key}")


def load_lock(path: Path = DEFAULT_LOCK) -> dict[str, object]:
    try:
        lock = json.loads(path.read_text(encoding="utf-8"))
    except (OSError, UnicodeDecodeError, json.JSONDecodeError) as error:
        raise SnapshotError(f"Source lock illeggibile: {path}") from error
    lock = require_dict(lock, "source lock")
    validate_lock(lock)
    return lock


def parse_observed_at(raw: str) -> str:
    try:
        parsed = datetime.fromisoformat(raw.replace("Z", "+00:00"))
    except ValueError as error:
        raise argparse.ArgumentTypeError("--observed-at deve essere ISO 8601") from error
    if parsed.tzinfo is None:
        raise argparse.ArgumentTypeError("--observed-at deve includere il fuso orario")
    return parsed.astimezone(timezone.utc).isoformat().replace("+00:00", "Z")


def parse_integer(
    raw: str,
    *,
    label: str,
    line_number: int,
    nullable: bool,
    allow_negative: bool,
) -> int | None:
    if raw == "":
        if nullable:
            return None
        raise SnapshotError(f"{label} mancante alla riga {line_number}")
    pattern = SIGNED_INTEGER if allow_negative else NON_NEGATIVE_INTEGER
    if not pattern.fullmatch(raw):
        raise SnapshotError(f"{label} non valido alla riga {line_number}: {raw!r}")
    value = int(raw)
    if abs(value) > MAX_SAFE_INTEGER:
        raise SnapshotError(f"{label} fuori intervallo sicuro alla riga {line_number}")
    return value


def euros_to_cents(
    raw: str,
    *,
    label: str,
    line_number: int,
    allow_negative: bool,
) -> int | None:
    euros = parse_integer(
        raw,
        label=label,
        line_number=line_number,
        nullable=True,
        allow_negative=allow_negative,
    )
    if euros is None:
        return None
    cents = euros * 100
    if abs(cents) > MAX_SAFE_INTEGER:
        raise SnapshotError(f"{label} in centesimi fuori intervallo sicuro alla riga {line_number}")
    return cents


def read_locked_member(zip_path: Path, lock: dict[str, object]) -> bytes:
    source = require_dict(lock["source"], "source")
    zip_contract = require_dict(source["zip"], "source.zip")
    member_contract = require_dict(source["csvMember"], "source.csvMember")
    try:
        payload = zip_path.read_bytes()
    except OSError as error:
        raise SnapshotError(f"ZIP MEF illeggibile: {zip_path}") from error
    if len(payload) != zip_contract.get("bytes"):
        raise SnapshotError(f"Dimensione ZIP MEF inattesa: {len(payload)}")
    actual_zip_hash = sha256_bytes(payload)
    if actual_zip_hash != zip_contract.get("sha256"):
        raise SnapshotError(f"Hash ZIP MEF inatteso: {actual_zip_hash}")

    try:
        with zipfile.ZipFile(zip_path) as archive:
            members = archive.infolist()
            if len(members) != 1:
                raise SnapshotError("Il ZIP MEF deve contenere un solo membro")
            member = members[0]
            if member.filename != member_contract.get("name"):
                raise SnapshotError(f"Nome membro ZIP inatteso: {member.filename}")
            if member.is_dir() or member.flag_bits & 0x1:
                raise SnapshotError("Il membro ZIP MEF non può essere directory o cifrato")
            if member.file_size != member_contract.get("bytes"):
                raise SnapshotError(f"Dimensione CSV MEF inattesa: {member.file_size}")
            if f"{member.CRC:08x}" != member_contract.get("crc32"):
                raise SnapshotError(f"CRC CSV MEF inatteso: {member.CRC:08x}")
            raw_csv = archive.read(member)
    except (OSError, zipfile.BadZipFile, RuntimeError) as error:
        raise SnapshotError("Archivio ZIP MEF non valido") from error

    actual_member_hash = sha256_bytes(raw_csv)
    if actual_member_hash != member_contract.get("sha256"):
        raise SnapshotError(f"Hash CSV MEF inatteso: {actual_member_hash}")
    return raw_csv


def parse_csv_line(raw_line: bytes, line_number: int) -> list[str]:
    try:
        text = raw_line.decode("ascii", errors="strict")
    except UnicodeDecodeError as error:
        raise SnapshotError(f"CSV MEF non ASCII alla riga {line_number}") from error
    try:
        parsed = list(csv.reader([text], delimiter=";", strict=True))
    except csv.Error as error:
        raise SnapshotError(f"CSV MEF malformato alla riga {line_number}") from error
    if len(parsed) != 1:
        raise SnapshotError(f"Riga CSV MEF non univoca: {line_number}")
    return parsed[0]


def parse_csv_member(raw_csv: bytes, lock: dict[str, object]) -> list[SourceRecord]:
    csv_contract = require_dict(lock["csv"], "csv")
    expected = require_dict(lock["expected"], "expected")
    if not raw_csv.endswith(b"\r\n"):
        raise SnapshotError("Il CSV MEF deve terminare con CRLF")
    without_crlf = raw_csv.replace(b"\r\n", b"")
    if b"\r" in without_crlf or b"\n" in without_crlf:
        raise SnapshotError("Il CSV MEF contiene terminatori di riga non CRLF")
    physical_lines = raw_csv[:-2].split(b"\r\n")
    if len(physical_lines) < 2:
        raise SnapshotError("Il CSV MEF non contiene record")

    raw_header = physical_lines[0]
    if sha256_bytes(raw_header) != csv_contract.get("rawHeaderSha256"):
        raise SnapshotError("Hash dell'header CSV MEF inatteso")
    parsed_header = parse_csv_line(raw_header, 1)
    trailing_field = csv_contract.get("trailingHeaderField")
    if len(parsed_header) != 53 or parsed_header[-1] != trailing_field:
        raise SnapshotError("Quirk terminale `; ` dell'header MEF assente o modificato")
    headers = parsed_header[:-1]
    if headers != csv_contract.get("headers"):
        raise SnapshotError("Schema CSV MEF divergente dal source lock")
    normalized_header = "\n".join(headers).encode("ascii")
    if sha256_bytes(normalized_header) != csv_contract.get("normalizedHeaderSha256"):
        raise SnapshotError("Hash normalizzato dei 52 header MEF inatteso")

    data_lines = physical_lines[1:]
    if len(data_lines) != expected.get("sourceRows"):
        raise SnapshotError(f"Numero righe MEF inatteso: {len(data_lines)}")

    header_index = {header: index for index, header in enumerate(headers)}
    allowed_negative_headers = set(
        require_list(csv_contract.get("allowedNegativeAmountHeaders"), "allowedNegativeAmountHeaders")
    )
    measure_order = require_list(lock["measureOrder"], "measureOrder")
    measures = require_dict(lock["measures"], "measures")
    region_contracts = {
        str(region["code"]): require_dict(region, "regions[]")
        for region in require_list(lock["regions"], "regions")
    }
    residual_identity = require_list(expected["unassignedIdentity"], "unassignedIdentity")

    records: list[SourceRecord] = []
    municipality_codes: set[str] = set()
    cadastral_codes: set[str] = set()
    province_hierarchy: dict[str, tuple[str, str]] = {}
    seen_region_names: dict[str, set[str]] = {}
    assigned_count = 0
    residual_count = 0

    for line_number, raw_line in enumerate(data_lines, start=2):
        row = parse_csv_line(raw_line, line_number)
        if len(row) != 52:
            raise SnapshotError(f"La riga {line_number} ha {len(row)} campi anziché 52")
        if row[0] != str(lock["taxYear"]):
            raise SnapshotError(f"Anno d'imposta inatteso alla riga {line_number}: {row[0]!r}")

        taxpayers = parse_integer(
            row[7],
            label="Numero contribuenti",
            line_number=line_number,
            nullable=False,
            allow_negative=False,
        )
        assert taxpayers is not None

        for index in range(8, len(headers), 2):
            frequency_header = headers[index]
            amount_header = headers[index + 1]
            if not frequency_header.endswith(" - Frequenza") or not amount_header.endswith(
                " - Ammontare in euro"
            ):
                raise SnapshotError(f"Coppia frequenza/ammontare inattesa alle colonne {index + 1}-{index + 2}")
            parse_integer(
                row[index],
                label=frequency_header,
                line_number=line_number,
                nullable=True,
                allow_negative=False,
            )
            euros_to_cents(
                row[index + 1],
                label=amount_header,
                line_number=line_number,
                allow_negative=amount_header in allowed_negative_headers,
            )

        parsed_measures: list[MetricPair] = []
        for key in measure_order:
            contract = require_dict(measures[str(key)], f"measures.{key}")
            frequency_header = str(contract["frequencyHeader"])
            amount_header = str(contract["amountHeader"])
            frequency = parse_integer(
                row[header_index[frequency_header]],
                label=frequency_header,
                line_number=line_number,
                nullable=True,
                allow_negative=False,
            )
            amount_cents = euros_to_cents(
                row[header_index[amount_header]],
                label=amount_header,
                line_number=line_number,
                allow_negative=False,
            )
            if (frequency is None) != (amount_cents is None):
                raise SnapshotError(
                    f"Coppia frequenza/ammontare parzialmente oscurata alla riga {line_number}: {key}"
                )
            parsed_measures.append((frequency, amount_cents))

        is_residual = row[:7] == residual_identity
        if is_residual:
            residual_count += 1
            records.append(
                SourceRecord("0", "0", "0", "", "", "Mancante/errata", "0", taxpayers, tuple(parsed_measures), False)
            )
            continue
        if "0" in row[1:7]:
            raise SnapshotError(f"Geografia parzialmente mancante alla riga {line_number}")

        cadastral_code, municipality_code, municipality_name = row[1], row[2], row[3]
        province_abbreviation, source_region_name, region_code = row[4], row[5], row[6]
        if not CADASTRAL_CODE.fullmatch(cadastral_code):
            raise SnapshotError(f"Codice catastale non valido alla riga {line_number}")
        if not MUNICIPALITY_CODE.fullmatch(municipality_code) or municipality_code == "000000":
            raise SnapshotError(f"Codice ISTAT comune non valido alla riga {line_number}")
        if not municipality_name or municipality_name != municipality_name.strip():
            raise SnapshotError(f"Denominazione comune non valida alla riga {line_number}")
        if not PROVINCE_ABBREVIATION.fullmatch(province_abbreviation):
            raise SnapshotError(f"Sigla provincia non valida alla riga {line_number}")
        if not REGION_CODE.fullmatch(region_code) or region_code not in region_contracts:
            raise SnapshotError(f"Codice regione non valido alla riga {line_number}")
        allowed_source_names = require_list(region_contracts[region_code]["sourceNames"], "sourceNames")
        if source_region_name not in allowed_source_names:
            raise SnapshotError(
                f"Nome regione sorgente inatteso alla riga {line_number}: {source_region_name!r}"
            )
        if municipality_code in municipality_codes or cadastral_code in cadastral_codes:
            raise SnapshotError(f"Comune duplicato alla riga {line_number}: {municipality_code}")
        municipality_codes.add(municipality_code)
        cadastral_codes.add(cadastral_code)

        province_code = municipality_code[:3]
        if not PROVINCE_CODE.fullmatch(province_code) or province_code == "000":
            raise SnapshotError(f"Codice provincia derivato non valido: {province_code}")
        hierarchy = (province_abbreviation, region_code)
        if province_code in province_hierarchy and province_hierarchy[province_code] != hierarchy:
            raise SnapshotError(f"Gerarchia provincia divergente per {province_code}")
        province_hierarchy[province_code] = hierarchy
        seen_region_names.setdefault(region_code, set()).add(source_region_name)

        assigned_count += 1
        records.append(
            SourceRecord(
                cadastral_code,
                municipality_code,
                municipality_name,
                province_code,
                province_abbreviation,
                source_region_name,
                region_code,
                taxpayers,
                tuple(parsed_measures),
                True,
            )
        )

    if assigned_count != expected.get("municipalities"):
        raise SnapshotError(f"Numero comuni MEF inatteso: {assigned_count}")
    if residual_count != expected.get("unassignedRows"):
        raise SnapshotError(f"Numero righe non assegnate inatteso: {residual_count}")
    if len(province_hierarchy) != expected.get("provinces"):
        raise SnapshotError(f"Numero province MEF inatteso: {len(province_hierarchy)}")
    if len(seen_region_names) != expected.get("regions"):
        raise SnapshotError(f"Numero regioni MEF inatteso: {len(seen_region_names)}")
    expected_source_names = {
        code: set(require_list(contract["sourceNames"], "sourceNames"))
        for code, contract in region_contracts.items()
    }
    if seen_region_names != expected_source_names:
        raise SnapshotError("Copertura dei nomi regione sorgente divergente dal source lock")
    return records


def municipality_tuple(record: SourceRecord) -> list[object]:
    if not record.assigned:
        raise SnapshotError("Una riga non assegnata non può diventare un comune")
    packed: list[object] = [
        record.municipality_code,
        record.cadastral_code,
        record.municipality_name,
        record.province_code,
        record.province_abbreviation,
        record.region_code,
        record.taxpayers,
    ]
    for frequency, amount_cents in record.measures:
        packed.extend((frequency, amount_cents))
    if len(packed) != MUNICIPALITY_TUPLE_SIZE:
        raise SnapshotError("Tuple comune MEF di dimensione inattesa")
    return packed


def aggregate_records(records: Sequence[SourceRecord], measure_count: int) -> Aggregate:
    aggregate = Aggregate(measure_count)
    for record in records:
        aggregate.add(record)
    return aggregate


def combine_summaries(left: dict[str, object], right: dict[str, object]) -> dict[str, object]:
    left_measures = require_list(left.get("measures"), "left.measures")
    right_measures = require_list(right.get("measures"), "right.measures")
    if len(left_measures) != len(right_measures):
        raise SnapshotError("Misure nazionali non combinabili")
    measures: list[list[int]] = []
    for left_measure, right_measure in zip(left_measures, right_measures):
        left_tuple = require_list(left_measure, "left.measure")
        right_tuple = require_list(right_measure, "right.measure")
        if len(left_tuple) != 3 or len(right_tuple) != 3:
            raise SnapshotError("Tripla aggregata non valida")
        measures.append(
            [safe_add(int(left_tuple[index]), int(right_tuple[index]), "totale nazionale") for index in range(3)]
        )
    return {
        "taxpayers": safe_add(int(left["taxpayers"]), int(right["taxpayers"]), "contribuenti nazionali"),
        "measures": measures,
    }


def build_data(lock: dict[str, object], records: Sequence[SourceRecord]) -> dict[str, object]:
    measure_order = [str(value) for value in require_list(lock["measureOrder"], "measureOrder")]
    measure_count = len(measure_order)
    assigned = sorted((record for record in records if record.assigned), key=lambda record: record.municipality_code)
    unassigned = [record for record in records if not record.assigned]

    provinces: dict[str, tuple[str, str, list[SourceRecord]]] = {}
    regions: dict[str, list[SourceRecord]] = {}
    for record in assigned:
        province = provinces.setdefault(
            record.province_code,
            (record.province_abbreviation, record.region_code, []),
        )
        if province[:2] != (record.province_abbreviation, record.region_code):
            raise SnapshotError(f"Gerarchia provincia divergente per {record.province_code}")
        province[2].append(record)
        regions.setdefault(record.region_code, []).append(record)

    region_contracts = {
        str(region["code"]): require_dict(region, "regions[]")
        for region in require_list(lock["regions"], "regions")
    }
    province_output: list[dict[str, object]] = []
    for code in sorted(provinces):
        abbreviation, region_code, province_records = provinces[code]
        aggregate = aggregate_records(province_records, measure_count)
        province_output.append(
            {
                "code": code,
                "abbreviation": abbreviation,
                "regionCode": region_code,
                "taxpayers": aggregate.taxpayers,
                "measures": aggregate.measures(),
            }
        )

    region_output: list[dict[str, object]] = []
    for code in sorted(regions):
        contract = region_contracts[code]
        aggregate = aggregate_records(regions[code], measure_count)
        region_output.append(
            {
                "code": code,
                "name": contract["canonicalName"],
                "sourceNames": contract["sourceNames"],
                "taxpayers": aggregate.taxpayers,
                "measures": aggregate.measures(),
            }
        )

    assigned_aggregate = aggregate_records(assigned, measure_count)
    unassigned_aggregate = aggregate_records(unassigned, measure_count)
    assigned_summary = {
        "taxpayers": assigned_aggregate.taxpayers,
        "measures": assigned_aggregate.measures(),
    }
    unassigned_summary = {
        "label": "Mancante/errata",
        "taxpayers": unassigned_aggregate.taxpayers,
        "measures": unassigned_aggregate.measures(),
    }
    all_source = combine_summaries(assigned_summary, unassigned_summary)

    data = {
        "schemaVersion": 1,
        "datasetId": lock["datasetId"],
        "taxYear": lock["taxYear"],
        "measureOrder": measure_order,
        "municipalities": [municipality_tuple(record) for record in assigned],
        "provinces": province_output,
        "regions": region_output,
        "national": {
            "assigned": assigned_summary,
            "unassigned": unassigned_summary,
            "allSource": all_source,
        },
    }
    if tuple(data) != DATA_KEYS:
        raise SnapshotError("Ordine delle chiavi del data artifact inatteso")
    validate_data(data, lock)
    return data


def validate_nonnegative_integer(value: object, label: str) -> int:
    if isinstance(value, bool) or not isinstance(value, int) or value < 0 or value > MAX_SAFE_INTEGER:
        raise SnapshotError(f"{label} deve essere un intero non negativo sicuro")
    return value


def validate_measures(value: object, label: str, measure_count: int) -> list[list[int]]:
    measures = require_list(value, label)
    if len(measures) != measure_count:
        raise SnapshotError(f"{label} deve contenere {measure_count} misure")
    validated: list[list[int]] = []
    for index, raw_measure in enumerate(measures):
        measure = require_list(raw_measure, f"{label}[{index}]")
        if len(measure) != 3:
            raise SnapshotError(f"{label}[{index}] deve essere una tripla")
        validated.append(
            [
                validate_nonnegative_integer(measure[0], f"{label}[{index}].knownFrequency"),
                validate_nonnegative_integer(measure[1], f"{label}[{index}].knownAmountCents"),
                validate_nonnegative_integer(measure[2], f"{label}[{index}].suppressedRows"),
            ]
        )
    return validated


def record_from_municipality_tuple(value: object, measure_count: int) -> SourceRecord:
    row = require_list(value, "municipalities[]")
    if len(row) != MUNICIPALITY_TUPLE_SIZE:
        raise SnapshotError("Tuple comune MEF di dimensione inattesa")
    municipality_code, cadastral_code, name, province_code, abbreviation, region_code = row[:6]
    if not isinstance(municipality_code, str) or not MUNICIPALITY_CODE.fullmatch(municipality_code):
        raise SnapshotError("Codice ISTAT comune non valido nel data artifact")
    if not isinstance(cadastral_code, str) or not CADASTRAL_CODE.fullmatch(cadastral_code):
        raise SnapshotError("Codice catastale non valido nel data artifact")
    if not isinstance(name, str) or not name or name != name.strip():
        raise SnapshotError("Denominazione comune non valida nel data artifact")
    if province_code != municipality_code[:3] or not isinstance(province_code, str):
        raise SnapshotError("Codice provincia incoerente nel data artifact")
    if not isinstance(abbreviation, str) or not PROVINCE_ABBREVIATION.fullmatch(abbreviation):
        raise SnapshotError("Sigla provincia non valida nel data artifact")
    if not isinstance(region_code, str) or not REGION_CODE.fullmatch(region_code):
        raise SnapshotError("Codice regione non valido nel data artifact")
    taxpayers = validate_nonnegative_integer(row[6], "municipality.taxpayers")
    measures: list[MetricPair] = []
    for index in range(measure_count):
        frequency = row[7 + index * 2]
        amount_cents = row[8 + index * 2]
        if frequency is not None:
            frequency = validate_nonnegative_integer(frequency, "municipality.frequency")
        if amount_cents is not None:
            amount_cents = validate_nonnegative_integer(amount_cents, "municipality.amountCents")
        if (frequency is None) != (amount_cents is None):
            raise SnapshotError(
                f"municipality.measures[{index}] deve avere frequenza e ammontare entrambi presenti o entrambi oscurati"
            )
        measures.append((frequency, amount_cents))
    return SourceRecord(
        cadastral_code,
        municipality_code,
        name,
        province_code,
        abbreviation,
        "",
        region_code,
        taxpayers,
        tuple(measures),
        True,
    )


def validate_data(data: dict[str, object], lock: dict[str, object]) -> None:
    if tuple(data) != DATA_KEYS or set(data) != set(DATA_KEYS):
        raise SnapshotError("Chiavi top-level del data artifact inattese")
    if data.get("schemaVersion") != 1 or data.get("datasetId") != lock.get("datasetId"):
        raise SnapshotError("Identità del data artifact inattesa")
    if data.get("taxYear") != lock.get("taxYear") or data.get("measureOrder") != lock.get("measureOrder"):
        raise SnapshotError("Periodo o misure del data artifact inattesi")

    measure_count = len(require_list(lock["measureOrder"], "measureOrder"))
    raw_municipalities = require_list(data["municipalities"], "municipalities")
    expected = require_dict(lock["expected"], "expected")
    if len(raw_municipalities) != expected.get("municipalities"):
        raise SnapshotError("Numero comuni nel data artifact inatteso")
    records = [record_from_municipality_tuple(row, measure_count) for row in raw_municipalities]
    codes = [record.municipality_code for record in records]
    cadastral_codes = [record.cadastral_code for record in records]
    if codes != sorted(codes) or len(codes) != len(set(codes)):
        raise SnapshotError("I comuni devono essere ordinati e univoci per codice ISTAT")
    if len(cadastral_codes) != len(set(cadastral_codes)):
        raise SnapshotError("I codici catastali devono essere univoci")

    recomputed = build_aggregates_for_validation(records, lock)
    if data["provinces"] != recomputed["provinces"]:
        raise SnapshotError("Aggregati provinciali divergenti dai comuni")
    if data["regions"] != recomputed["regions"]:
        raise SnapshotError("Aggregati regionali divergenti dai comuni")

    national = require_dict(data["national"], "national")
    if tuple(national) != ("assigned", "unassigned", "allSource"):
        raise SnapshotError("Chiavi dell'aggregato nazionale inattese")
    assigned = require_dict(national["assigned"], "national.assigned")
    if assigned != recomputed["assigned"]:
        raise SnapshotError("Aggregato nazionale assegnato divergente dai comuni")
    if tuple(assigned) != ("taxpayers", "measures"):
        raise SnapshotError("Shape national.assigned inattesa")

    unassigned = require_dict(national["unassigned"], "national.unassigned")
    if tuple(unassigned) != ("label", "taxpayers", "measures") or unassigned.get("label") != "Mancante/errata":
        raise SnapshotError("Shape national.unassigned inattesa")
    validate_nonnegative_integer(unassigned.get("taxpayers"), "national.unassigned.taxpayers")
    unassigned_measures = validate_measures(unassigned.get("measures"), "national.unassigned.measures", measure_count)
    for measure in unassigned_measures:
        if measure[2] > expected.get("unassignedRows", 0):
            raise SnapshotError("suppressedRows non assegnate supera le righe sorgente")

    all_source = require_dict(national["allSource"], "national.allSource")
    if tuple(all_source) != ("taxpayers", "measures"):
        raise SnapshotError("Shape national.allSource inattesa")
    expected_all_source = combine_summaries(assigned, unassigned)
    if all_source != expected_all_source:
        raise SnapshotError("Aggregato allSource divergente da assigned + unassigned")


def build_aggregates_for_validation(
    records: Sequence[SourceRecord], lock: dict[str, object]
) -> dict[str, object]:
    measure_count = len(require_list(lock["measureOrder"], "measureOrder"))
    province_groups: dict[str, list[SourceRecord]] = {}
    province_metadata: dict[str, tuple[str, str]] = {}
    region_groups: dict[str, list[SourceRecord]] = {}
    for record in records:
        metadata = (record.province_abbreviation, record.region_code)
        if record.province_code in province_metadata and province_metadata[record.province_code] != metadata:
            raise SnapshotError(f"Gerarchia provincia divergente per {record.province_code}")
        province_metadata[record.province_code] = metadata
        province_groups.setdefault(record.province_code, []).append(record)
        region_groups.setdefault(record.region_code, []).append(record)

    expected = require_dict(lock["expected"], "expected")
    if len(province_groups) != expected.get("provinces") or len(region_groups) != expected.get("regions"):
        raise SnapshotError("Copertura territoriale del data artifact inattesa")
    region_contracts = {
        str(region["code"]): require_dict(region, "regions[]")
        for region in require_list(lock["regions"], "regions")
    }
    if set(region_groups) != set(region_contracts):
        raise SnapshotError("Codici regione del data artifact inattesi")

    provinces: list[dict[str, object]] = []
    for code in sorted(province_groups):
        abbreviation, region_code = province_metadata[code]
        aggregate = aggregate_records(province_groups[code], measure_count)
        provinces.append(
            {
                "code": code,
                "abbreviation": abbreviation,
                "regionCode": region_code,
                "taxpayers": aggregate.taxpayers,
                "measures": aggregate.measures(),
            }
        )
    regions: list[dict[str, object]] = []
    for code in sorted(region_groups):
        aggregate = aggregate_records(region_groups[code], measure_count)
        contract = region_contracts[code]
        regions.append(
            {
                "code": code,
                "name": contract["canonicalName"],
                "sourceNames": contract["sourceNames"],
                "taxpayers": aggregate.taxpayers,
                "measures": aggregate.measures(),
            }
        )
    assigned = aggregate_records(records, measure_count)
    return {
        "provinces": provinces,
        "regions": regions,
        "assigned": {"taxpayers": assigned.taxpayers, "measures": assigned.measures()},
    }


def coverage_from_data(
    data: dict[str, object], lock: dict[str, object]
) -> dict[str, object]:
    national = require_dict(data["national"], "national")
    assigned = require_dict(national["assigned"], "national.assigned")
    unassigned = require_dict(national["unassigned"], "national.unassigned")
    all_source = require_dict(national["allSource"], "national.allSource")
    expected = require_dict(lock["expected"], "expected")
    unassigned_rows = validate_nonnegative_integer(
        expected["unassignedRows"], "expected.unassignedRows"
    )
    return {
        "sourceRows": len(require_list(data["municipalities"], "municipalities")) + unassigned_rows,
        "municipalities": len(require_list(data["municipalities"], "municipalities")),
        "provinces": len(require_list(data["provinces"], "provinces")),
        "regions": len(require_list(data["regions"], "regions")),
        "unassignedRows": unassigned_rows,
        "taxpayers": {
            "assigned": assigned["taxpayers"],
            "unassigned": unassigned["taxpayers"],
            "allSource": all_source["taxpayers"],
        },
    }


def build_meta(
    lock: dict[str, object],
    data: dict[str, object],
    observed_at: str,
    data_bytes: bytes,
) -> dict[str, object]:
    source = require_dict(lock["source"], "source")
    csv_contract = require_dict(lock["csv"], "csv")
    zip_contract = require_dict(source["zip"], "source.zip")
    member = require_dict(source["csvMember"], "source.csvMember")
    methodology_document = require_dict(source["methodologyDocument"], "source.methodologyDocument")
    definitions_document = require_dict(source["definitionsDocument"], "source.definitionsDocument")
    integrity = require_dict(lock["integrity"], "integrity")
    meta = {
        "schemaVersion": 1,
        "datasetId": lock["datasetId"],
        "period": {
            "taxYear": lock["taxYear"],
            "declarationYear": lock["declarationYear"],
            "publishedAt": lock["publishedAt"],
            "observedAt": observed_at,
            "municipalityAssignmentDateRule": "domicilio fiscale al 31 dicembre dell'anno di presentazione della dichiarazione",
            "surtaxDomicileDate": "2024-01-01",
        },
        "source": {
            "owner": source["owner"],
            "landingUrl": source["landingUrl"],
            "assetUrl": source["assetUrl"],
            "methodologyUrl": source["methodologyUrl"],
            "definitionsUrl": source["definitionsUrl"],
            "license": source["license"],
            "licenseUrl": source["licenseUrl"],
            "attribution": source["attribution"],
            "zip": {
                "bytes": zip_contract["bytes"],
                "sha256": zip_contract["sha256"],
                "lastModified": zip_contract["lastModified"],
            },
            "csvMember": {
                "name": member["name"],
                "bytes": member["bytes"],
                "sha256": member["sha256"],
                "crc32": member["crc32"],
            },
            "methodologyDocument": {
                "bytes": methodology_document["bytes"],
                "sha256": methodology_document["sha256"],
                "lastModified": methodology_document["lastModified"],
            },
            "definitionsDocument": {
                "bytes": definitions_document["bytes"],
                "sha256": definitions_document["sha256"],
                "lastModified": definitions_document["lastModified"],
            },
            "format": {
                "encoding": csv_contract["encoding"],
                "delimiter": csv_contract["delimiter"],
                "lineEnding": csv_contract["lineEnding"],
                "rawHeaderSha256": csv_contract["rawHeaderSha256"],
                "normalizedHeaderSha256": csv_contract["normalizedHeaderSha256"],
            },
        },
        "coverage": coverage_from_data(data, lock),
        "definitions": {
            "taxpayers": "Persone fisiche presenti nelle statistiche da Redditi, 730 o CU; non coincide con la frequenza del reddito complessivo.",
            "comprehensiveIncome": "Reddito complessivo dichiarato secondo la definizione MEF, comprensiva dei redditi soggetti a cedolare secca previsti dalla variabile.",
            "taxableIncome": "Reddito imponibile IRPEF dopo perdite compensabili e deduzioni; non può essere negativo.",
            "netTaxDeclared": "Imposta netta dichiarata: imposta lorda meno detrazioni e crediti d'imposta; non è gettito riscosso o saldo versato.",
            "regionalSurtaxDue": "Addizionale regionale dovuta sul reddito imponibile addizionale, secondo domicilio fiscale al 1 gennaio 2024.",
            "municipalSurtaxDue": "Addizionale comunale dovuta sul reddito imponibile addizionale, secondo domicilio fiscale al 1 gennaio 2024.",
        },
        "methodology": {
            "municipalityAssignment": "Il comune del dataset segue il domicilio fiscale al 31 dicembre dell'anno di dichiarazione; può differire dal domicilio usato per le addizionali.",
            "missingValues": "Frequenze inferiori a 4 e ammontari collegati possono essere soppressi: null non significa zero e non viene imputato.",
            "amounts": "Gli interi in euro della fonte sono convertiti esattamente in centesimi; le cinque misure selezionate sono non negative.",
            "aggregation": "Ogni tripla è [frequenza nota, ammontare noto in centesimi, righe con almeno un elemento soppresso].",
            "semanticWarning": "Non chiamare l'imposta netta gettito fiscale totale, non sottrarla alla spesa o al saldo CPT e non inferire evasione, frode o responsabilità individuali.",
        },
        "lockSha256": integrity["lockSha256"],
        "dataArtifactBytes": len(data_bytes),
        "dataArtifactSha256": sha256_bytes(data_bytes),
    }
    if tuple(meta) != META_KEYS:
        raise SnapshotError("Ordine delle chiavi del meta artifact inatteso")
    return meta


def artifact_bytes(value: dict[str, object]) -> bytes:
    return (
        json.dumps(
            value,
            ensure_ascii=False,
            separators=(",", ":"),
            allow_nan=False,
        )
        + "\n"
    ).encode("utf-8")


def parse_artifact(payload: bytes, label: str) -> dict[str, object]:
    try:
        value = json.loads(payload.decode("utf-8", errors="strict"))
    except (UnicodeDecodeError, json.JSONDecodeError) as error:
        raise SnapshotError(f"{label} non è JSON UTF-8 valido") from error
    value = require_dict(value, label)
    if artifact_bytes(value) != payload:
        raise SnapshotError(f"{label} non usa la serializzazione canonica prevista")
    return value


def validate_artifacts(
    lock: dict[str, object], data_path: Path, meta_path: Path
) -> tuple[dict[str, object], dict[str, object]]:
    try:
        data_bytes = data_path.read_bytes()
        meta_bytes = meta_path.read_bytes()
    except OSError as error:
        raise SnapshotError("Artifact MEF mancante o illeggibile") from error
    validate_data_artifact_binding(lock, data_bytes)
    data = parse_artifact(data_bytes, "data artifact")
    meta = parse_artifact(meta_bytes, "meta artifact")
    validate_data(data, lock)
    if tuple(meta) != META_KEYS or set(meta) != set(META_KEYS):
        raise SnapshotError("Chiavi top-level del meta artifact inattese")
    period = require_dict(meta.get("period"), "meta.period")
    observed_at = period.get("observedAt")
    if not isinstance(observed_at, str):
        raise SnapshotError("meta.period.observedAt mancante")
    try:
        normalized_observed_at = parse_observed_at(observed_at)
    except argparse.ArgumentTypeError as error:
        raise SnapshotError("meta.period.observedAt non valido") from error
    expected_meta = build_meta(lock, data, normalized_observed_at, data_bytes)
    if meta != expected_meta:
        raise SnapshotError("Meta artifact divergente da lock e data artifact")
    return data, meta


def stage_file(path: Path, payload: bytes) -> Path:
    path.parent.mkdir(parents=True, exist_ok=True)
    descriptor, temporary_name = tempfile.mkstemp(prefix=f".{path.name}.", dir=path.parent)
    temporary_path = Path(temporary_name)
    try:
        with os.fdopen(descriptor, "wb") as handle:
            handle.write(payload)
            handle.flush()
            os.fsync(handle.fileno())
    except Exception:
        temporary_path.unlink(missing_ok=True)
        raise
    return temporary_path


def restore_file(path: Path, previous: bytes | None) -> None:
    if previous is None:
        path.unlink(missing_ok=True)
        return
    temporary = stage_file(path, previous)
    os.replace(temporary, path)


def write_artifacts_atomically(
    data_path: Path,
    meta_path: Path,
    data_bytes: bytes,
    meta_bytes: bytes,
) -> None:
    previous_data = data_path.read_bytes() if data_path.exists() else None
    previous_meta = meta_path.read_bytes() if meta_path.exists() else None
    staged_data: Path | None = None
    staged_meta: Path | None = None
    data_replaced = False
    meta_replaced = False
    try:
        staged_data = stage_file(data_path, data_bytes)
        staged_meta = stage_file(meta_path, meta_bytes)
        os.replace(staged_data, data_path)
        data_replaced = True
        os.replace(staged_meta, meta_path)
        meta_replaced = True
    except Exception:
        if data_replaced:
            restore_file(data_path, previous_data)
        if meta_replaced:
            restore_file(meta_path, previous_meta)
        raise
    finally:
        if staged_data is not None:
            staged_data.unlink(missing_ok=True)
        if staged_meta is not None:
            staged_meta.unlink(missing_ok=True)


def generate(
    lock: dict[str, object],
    input_path: Path,
    observed_at: str,
    data_path: Path,
    meta_path: Path,
) -> tuple[dict[str, object], dict[str, object]]:
    raw_csv = read_locked_member(input_path, lock)
    records = parse_csv_member(raw_csv, lock)
    data = build_data(lock, records)
    data_payload = artifact_bytes(data)
    validate_data_artifact_binding(lock, data_payload)
    meta = build_meta(lock, data, observed_at, data_payload)
    meta_payload = artifact_bytes(meta)

    # Validate the complete pair before either previous artifact is touched.
    if sha256_bytes(data_payload) != meta["dataArtifactSha256"]:
        raise SnapshotError("Binding hash data/meta divergente prima della scrittura")
    previous_data = data_path.read_bytes() if data_path.exists() else None
    previous_meta = meta_path.read_bytes() if meta_path.exists() else None
    write_artifacts_atomically(data_path, meta_path, data_payload, meta_payload)
    try:
        return validate_artifacts(lock, data_path, meta_path)
    except Exception:
        try:
            restore_file(data_path, previous_data)
            restore_file(meta_path, previous_meta)
        except Exception as rollback_error:
            raise SnapshotError(
                "Validazione post-scrittura fallita e rollback degli artifact non riuscito"
            ) from rollback_error
        # Disk corruption after a successful atomic replace is never accepted,
        # and the last valid pair remains in place.
        raise


def main(argv: Iterable[str] | None = None) -> int:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--spec", type=Path, default=DEFAULT_LOCK)
    parser.add_argument("--input", type=Path, help="ZIP MEF locale già scaricato")
    parser.add_argument("--observed-at", type=parse_observed_at)
    parser.add_argument("--data-output", type=Path, default=DEFAULT_DATA_OUTPUT)
    parser.add_argument("--meta-output", type=Path, default=DEFAULT_META_OUTPUT)
    parser.add_argument("--check", action="store_true", help="Valida lock e artifact senza rete")
    args = parser.parse_args(argv)

    lock = load_lock(args.spec)
    if args.check:
        if args.input is not None or args.observed_at is not None:
            parser.error("--check non accetta --input o --observed-at")
        data, meta = validate_artifacts(lock, args.data_output, args.meta_output)
    else:
        if args.input is None or args.observed_at is None:
            parser.error("la generazione richiede --input e --observed-at")
        data, meta = generate(lock, args.input, args.observed_at, args.data_output, args.meta_output)

    coverage = require_dict(meta["coverage"], "coverage")
    print(
        f"MEF IRPEF {data['taxYear']}: {coverage['municipalities']} comuni, "
        f"{coverage['provinces']} province, {coverage['regions']} regioni; "
        f"data sha256 {meta['dataArtifactSha256']}"
    )
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
