#!/usr/bin/env python3
"""Audit the ANAC contracting-authority/entity data contract.

This ETL deliberately emits only aggregate coverage.  The inputs contain
names and tax identifiers, but those values are used only while resolving the
station/entity relationship and are never written to the manifest.
"""

from __future__ import annotations

import argparse
import csv
import hashlib
import io
import json
import re
import sqlite3
import tempfile
import unicodedata
import zipfile
from collections import Counter
from contextlib import contextmanager
from datetime import date, datetime, timezone
from decimal import Decimal, InvalidOperation, localcontext
from pathlib import Path
from typing import Iterator, Mapping, TextIO


ROOT = Path(__file__).resolve().parents[2]
DEFAULT_SPEC = ROOT / "scripts" / "etl" / "specs" / "anac-entity-procurement.source.json"
DEFAULT_OUTPUT = ROOT / "src" / "data" / "generated" / "anac-entity-procurement-coverage.json"

CIG_HEADERS = (
    "cig", "cig_accordo_quadro", "numero_gara", "oggetto_gara",
    "importo_complessivo_gara", "n_lotti_componenti", "oggetto_lotto",
    "importo_lotto", "oggetto_principale_contratto", "stato", "settore",
    "luogo_istat", "provincia", "data_pubblicazione", "data_scadenza_offerta",
    "cod_tipo_scelta_contraente", "tipo_scelta_contraente",
    "cod_modalita_realizzazione", "modalita_realizzazione", "codice_ausa",
    "cf_amministrazione_appaltante", "denominazione_amministrazione_appaltante",
    "sezione_regionale", "id_centro_costo", "denominazione_centro_costo",
    "anno_pubblicazione", "mese_pubblicazione", "cod_cpv", "descrizione_cpv",
    "flag_prevalente", "COD_MOTIVO_CANCELLAZIONE", "MOTIVO_CANCELLAZIONE",
    "DATA_CANCELLAZIONE", "DATA_ULTIMO_PERFEZIONAMENTO",
    "COD_MODALITA_INDIZIONE_SPECIALI", "MODALITA_INDIZIONE_SPECIALI",
    "COD_MODALITA_INDIZIONE_SERVIZI", "MODALITA_INDIZIONE_SERVIZI",
    "DURATA_PREVISTA", "COD_STRUMENTO_SVOLGIMENTO", "STRUMENTO_SVOLGIMENTO",
    "FLAG_URGENZA", "COD_MOTIVO_URGENZA", "MOTIVO_URGENZA", "FLAG_DELEGA",
    "FUNZIONI_DELEGATE", "CF_SA_DELEGANTE", "DENOMINAZIONE_SA_DELEGANTE",
    "CF_SA_DELEGATA", "DENOMINAZIONE_SA_DELEGATA", "IMPORTO_SICUREZZA",
    "TIPO_APPALTO_RISERVATO", "CUI_PROGRAMMA", "FLAG_PREV_RIPETIZIONI",
    "COD_IPOTESI_COLLEGAMENTO", "IPOTESI_COLLEGAMENTO", "CIG_COLLEGAMENTO",
    "COD_ESITO", "ESITO", "DATA_COMUNICAZIONE_ESITO", "FLAG_PNRR_PNC",
)
STATION_HEADERS = (
    "codice_fiscale", "partita_iva", "denominazione", "codice_ausa",
    "natura_giuridica_codice", "natura_giuridica_descrizione", "soggetto_estero",
    "provincia_codice", "provincia_nome", "citta_codice", "citta_nome",
    "indirizzo_odonimo", "cap", "flag_inHouse", "flag_partecipata", "stato",
    "data_inizio", "data_fine",
)
AWARD_HEADERS = (
    "cig", "data_aggiudicazione_definitiva", "esito", "criterio_aggiudicazione",
    "data_comunicazione_esito", "numero_offerte_ammesse", "numero_offerte_escluse",
    "importo_aggiudicazione", "ribasso_aggiudicazione", "num_imprese_offerenti",
    "flag_subappalto", "id_aggiudicazione", "cod_esito", "num_imprese_richiedenti",
    "asta_elettronica", "num_imprese_invitate", "massimo_ribasso", "minimo_ribasso",
    "FLAG_SCOMPUTO", "COD_PRESTAZIONI_COMPRESE", "PRESTAZIONI_COMPRESE",
    "CIG_PROG_ESTERNA", "DATA_INCARICO_PROG", "DATA_CONS_PROG",
    "COD_MODO_RIAGGIUDICAZIONE", "MODO_RIAGGIUDICAZIONE", "FLAG_PROC_ACCELERATA",
    "N_MANIF_INTERESSE",
)
AWARDEE_HEADERS = (
    "cig", "ruolo", "codice_fiscale", "denominazione", "tipo_soggetto",
    "id_aggiudicazione",
)

CIG_PATTERN = re.compile(r"^[A-Z0-9]{10}$")
AUSA_PATTERN = re.compile(r"^[0-9]{10}$")
CF_PATTERN = re.compile(r"^(?:[0-9]{11}|[A-Z0-9]{16})$")
REGISTRY_CF_PATTERN = re.compile(r"^[A-Z0-9-]{2,32}$")
POSITIVE_ID_PATTERN = re.compile(r"^[0-9]+$")
AMOUNT_PATTERN = re.compile(r"^[+-]?(?:[0-9]+(?:\.[0-9]*)?|\.[0-9]+)$")
SHA256_PATTERN = re.compile(r"^[a-f0-9]{64}$")
UTC_INSTANT_PATTERN = re.compile(r"^[0-9]{4}-[0-9]{2}-[0-9]{2}T[0-9]{2}:[0-9]{2}:[0-9]{2}Z$")
CANONICAL_DECIMAL_PATTERN = re.compile(r"^(?:0|[1-9][0-9]*)(?:\.[0-9]+)?$")
MISSING_AMOUNT = {"", "N/A", "NA", "N.D.", "ND", "NULL"}
AMOUNT_STATUSES = (
    "missing", "invalid", "negative", "zero", "positive-exact-cent", "positive-subcent",
    "conflicting",
)
DATE_STATUSES = ("missing", "invalid", "before-1990", "future", "valid", "conflicting")
DEFAULT_OBSERVED_AT = "2026-08-30T00:00:00Z"

# These are deliberately closed sets.  Aggregate consumers can therefore
# detect a producer drift instead of silently accepting a newly invented
# counter or limitation.
PROCEDURE_COUNTER_KEYS = (
    "rawRows", "nonPrimaryRows", "primaryRows", "distinctRawCigs",
    "cigsWithExactlyOnePrimary", "cigsWithoutPrimary", "cigsWithMultiplePrimary",
    "distinctCigs",
    *(f"publicationDate:{status}" for status in DATE_STATUSES if status != "conflicting"),
    *(f"lotAmount:{status}" for status in AMOUNT_STATUSES),
    *(f"identity:{status}" for status in ("resolved", "unresolved", "conflict")),
)
IDENTITY_COUNTER_KEYS = (
    "resolved", "unresolved", "conflict",
    "via:ausa-and-cf", "via:ausa-only", "via:cf-fallback", "via:missing-both",
    "via:ausa-invalid", "via:ausa-not-in-registry", "via:ausa-cf-conflict",
    "via:cf-invalid", "via:cf-placeholder", "via:cf-not-in-registry",
    "via:ambiguous-cf", "via:registry-cf-nonstandard", "via:ausa-without-entity-cf",
    "via:publication-date-unusable", "via:ausa-outside-registry-interval",
    "via:cf-no-active-station",
)
REGISTRY_COUNTER_KEYS = (
    "rowsTotal", "rowsWithAusa", "rowsWithCf", "rowsWithEntityCf", "rowsWithNonstandardCf",
    "status:ATTIVO", "status:CESSATO", "status:(other)", "status:(missing)",
    "distinctAusa", "distinctCf", "cfWithMultipleAusa",
)
AWARD_COUNTER_KEYS = (
    "rawRows", "ineligibleKeyRows", "knownKeyRows", "duplicateKeyRows",
    "exactDuplicateRows", "nonIdenticalDuplicateRows", "distinctAwards",
    "duplicateKeyGroups", "amountConflictGroups", "awardDateConflictGroups",
    "criticalConflictGroups", "conflictingAwardKeys",
    *(f"id:{status}" for status in ("missing", "missing-sentinel", "invalid", "known")),
    *(f"amount:{status}" for status in AMOUNT_STATUSES),
    *(f"awardDate:{status}" for status in DATE_STATUSES if status != "conflicting"),
)
AWARDEE_COUNTER_KEYS = (
    "rawRows", "ineligibleKeyRows", "knownKeyRows", "distinctJoinPairs",
    "exactDuplicateRows", "pairsWithMultipleAwardeeRows",
    *(f"id:{status}" for status in ("missing", "missing-sentinel", "invalid", "known")),
)
AMOUNT_COVERAGE_KEYS = (
    "distinctRows", "statusRows", "positive-exact-centSum", "positive-subcentSum",
    "positiveRows", "positiveSum",
)
ROOT_KEYS = (
    "schemaVersion", "dataset", "distributionKind", "observedAt", "generatedAt",
    "scope", "contract", "privacy", "inputs", "provenance", "coverage", "amounts",
    "reconciliation", "sourceSpecSha256", "limitations",
)
SCOPE_CONTRACT = {
    "cohort": "cig-2025-full",
    "publicationMonths": list(range(1, 13)),
    "nationalPopulationClaim": "not-asserted",
    "temporalAlignment": "cross-snapshot",
}
ENTITY_CONTRACT = {
    "stationIdentity": "codice_ausa",
    "entityIdentity": "cf_amministrazione_appaltante",
    "stationKey": "ausa:<CODICE_AUSA>",
    "entityKey": "cf:<CF_AMMINISTRAZIONE_APPALTANTE>",
    "procedureKey": ["cig"],
    "awardKey": ["cig", "id_aggiudicazione"],
    "procedurePeriod": "data_pubblicazione",
    "awardPeriod": "data_aggiudicazione_definitiva",
    "procedureAmount": "importo_lotto",
    "awardAmount": "importo_aggiudicazione",
    "amountRepresentation": "exact-decimal",
    "awardAmountAggregation": "once-per-distinct-award-pair",
    "awardeeMultipartyPolicy": "awardee-rows-never-multiply-award-amount",
}
PRIVACY_CONTRACT = {
    "aggregateOnly": True,
    "containsRawRows": False,
    "containsRawTaxIds": False,
    "containsNames": False,
}
INPUT_KEYS = ("cig", "stations", "awards", "awardees")
PROVENANCE_KEYS = (
    "catalogObservedAt", "catalogMetadataModifiedAt", "assetObservedAt", "sourceSpec", "parentSpec",
)
COVERAGE_KEYS = ("registry", "procedures", "identity", "awards", "awardees")
AMOUNTS_KEYS = (
    "procedureLot", "awardRows", "awardContributionInCohort",
    "awardeeMultiplication", "lotAndAwardAmountsAreDistinctFields",
)
RECONCILIATION_KEYS = (
    "awardPairsTotal", "awardPairsInCohort", "awardPairsOutOfCohort",
    "awardPairsWithAwardees", "awardPairsWithoutAwardees", "awardeePairsTotal",
    "awardeePairsInCohort", "awardeePairsOutOfCohort", "awardeePairsWithoutAward",
)
LIMITATIONS = (
    "full-snapshot cross-temporal: CIG, aggiudicazioni e aggiudicatari non sono una fotografia sincronizzata",
    "nationalPopulationClaim non-asserted: il risultato non è una copertura nazionale corrente",
    "nessuna inferenza di spreco, illecito, ranking o HHI in questo slice",
    "denominazioni e deleghe sono conservate nella sorgente ma non sono chiavi dell'identita",
)
ENTITY_PLACEHOLDERS = {
    "", "-", "*", "N/A", "NA", "N.D.", "ND", "NULL", "NONE",
    "00000000000", "XXXXXXXXXXX", "XXXXXXXXXXXXXXXX",
}


def zero_counter(keys: tuple[str, ...]) -> Counter[str]:
    return Counter({key: 0 for key in keys})


def closed_counter(counter: Counter[str], keys: tuple[str, ...], label: str) -> Counter[str]:
    unexpected = set(counter) - set(keys)
    if unexpected:
        raise ContractError(f"contatore {label} inatteso: {', '.join(sorted(unexpected))}")
    return Counter({key: int(counter.get(key, 0)) for key in keys})


def validate_closed_counter(value: Mapping[str, object], keys: tuple[str, ...], label: str) -> None:
    if set(value) != set(keys):
        missing = sorted(set(keys) - set(value))
        extra = sorted(set(value) - set(keys))
        raise ContractError(f"contatore {label} non chiuso; missing={missing}, extra={extra}")
    for key in keys:
        item = value[key]
        if not isinstance(item, int) or isinstance(item, bool) or item < 0:
            raise ContractError(f"contatore {label}.{key} non intero non-negativo")


def validate_exact_keys(value: Mapping[str, object], keys: tuple[str, ...], label: str) -> None:
    if set(value) != set(keys):
        missing = sorted(set(keys) - set(value), key=str)
        extra = sorted(set(value) - set(keys), key=str)
        raise ContractError(f"sezione {label} non chiusa; missing={missing}, extra={extra}")


def validate_nonnegative_integers(value: Mapping[str, object], keys: tuple[str, ...], label: str) -> None:
    validate_exact_keys(value, keys, label)
    for key in keys:
        item = value[key]
        if not isinstance(item, int) or isinstance(item, bool) or item < 0:
            raise ContractError(f"valore {label}.{key} non intero non-negativo")


def canonical_decimal(value: object, label: str) -> Decimal:
    if not isinstance(value, str) or CANONICAL_DECIMAL_PATTERN.fullmatch(value) is None:
        raise ContractError(f"decimale {label} non canonico")
    try:
        result = Decimal(value)
    except InvalidOperation as exc:
        raise ContractError(f"decimale {label} non valido") from exc
    if not result.is_finite() or result < 0:
        raise ContractError(f"decimale {label} non valido")
    return result


def validate_amount_coverage(value: Mapping[str, object], label: str) -> None:
    if set(value) != set(AMOUNT_COVERAGE_KEYS):
        raise ContractError(f"sezione importi {label} con chiavi inattese")
    status_rows = value.get("statusRows")
    if not isinstance(status_rows, Mapping) or set(status_rows) != set(AMOUNT_STATUSES):
        raise ContractError(f"stati importo {label} non chiusi")
    validate_closed_counter(status_rows, AMOUNT_STATUSES, f"{label}.statusRows")
    if sum(status_rows.values()) != value["distinctRows"]:
        raise ContractError(f"partizione stati importo {label} incoerente")
    positive_rows = status_rows["positive-exact-cent"] + status_rows["positive-subcent"]
    if value["positiveRows"] != positive_rows:
        raise ContractError(f"partizione righe positive {label} incoerente")
    decimal_fields = (
        "positive-exact-centSum", "positive-subcentSum", "positiveSum",
    )
    decimal_strings = tuple(value[key] for key in decimal_fields)
    decimals = tuple(
        canonical_decimal(item, f"{label}.{key}")
        for key, item in zip(decimal_fields, decimal_strings, strict=True)
    )
    precision = max(len(item.replace(".", "")) for item in decimal_strings) + 2
    with localcontext() as context:
        context.prec = precision
        exact_sum, subcent_sum, positive_sum = decimals
        if positive_sum != exact_sum + subcent_sum:
            raise ContractError(f"riconciliazione decimale {label} incoerente")


class ContractError(ValueError):
    """Raised when an input, source lock, or aggregate invariant is invalid."""


def normalized_text(value: str) -> str:
    return unicodedata.normalize("NFKC", value).strip().upper()


def normalize_cig(value: str) -> str:
    return normalized_text(value)


def normalize_ausa(value: str) -> str | None:
    result = normalized_text(value)
    return result or None


def normalize_cf(value: str) -> str | None:
    result = normalized_text(value)
    return result or None


def normalize_registry_cf(value: str) -> str | None:
    result = normalize_cf(value)
    if result in ENTITY_PLACEHOLDERS:
        return None
    return result


def valid_numeric_tax_checksum(value: str) -> bool:
    """Validate the Italian 11-digit VAT/tax identifier checksum."""
    if not re.fullmatch(r"[0-9]{11}", value):
        return False
    odd = sum(int(value[index]) for index in (0, 2, 4, 6, 8, 10))
    even = sum(
        (2 * int(value[index]) if 2 * int(value[index]) < 10 else 2 * int(value[index]) - 9)
        for index in (1, 3, 5, 7, 9)
    )
    return (odd + even) % 10 == 0


_CF_ODD_VALUE = {
    **dict(zip("0123456789", (1, 0, 5, 7, 9, 13, 15, 17, 19, 21), strict=True)),
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
_CF_EVEN_LETTER = {letter: index for index, letter in enumerate("ABCDEFGHIJKLMNOPQRSTUVWXYZ")}


def valid_person_tax_checksum(value: str) -> bool:
    """Validate the control character of a 16-character Italian codice fiscale."""
    if not re.fullmatch(r"[A-Z0-9]{16}", value):
        return False
    total = 0
    for index, char in enumerate(value[:15]):
        if index % 2 == 0:
            total += _CF_ODD_VALUE.get(char, -100)
        else:
            total += _CF_EVEN_LETTER.get(char, int(char) if char.isdigit() else -100)
    return 0 <= total and chr(ord("A") + total % 26) == value[-1]


def classify_entity_cf(value: str | None) -> str:
    """Return a closed validation class for an entity identifier."""
    normalized = normalize_cf(value or "")
    if normalized is None:
        return "missing"
    if normalized in ENTITY_PLACEHOLDERS:
        return "placeholder"
    if normalized is not None and re.fullmatch(r"[0-9]{11}", normalized):
        return "valid" if valid_numeric_tax_checksum(normalized) else "invalid-checksum"
    if normalized is not None and re.fullmatch(r"[A-Z0-9]{16}", normalized):
        return "valid" if valid_person_tax_checksum(normalized) else "invalid-checksum"
    return "invalid-shape"


def valid_entity_cf(value: str | None) -> bool:
    return classify_entity_cf(value) == "valid"


def parse_award_id(value: str) -> tuple[str | None, str]:
    result = normalized_text(value)
    if not result:
        return None, "missing"
    if result == "-1":
        return None, "missing-sentinel"
    if POSITIVE_ID_PATTERN.fullmatch(result) and any(ch != "0" for ch in result):
        return result, "known"
    return None, "invalid"


def parse_amount(raw: str) -> tuple[str, str | None, int | None]:
    """Return status, exact canonical decimal, and lexical scale.

    Decimal is used only for validation and aggregate summation.  Values are
    never converted to float or rounded to cents.
    """
    value = raw.strip()
    if value.upper() in MISSING_AMOUNT:
        return "missing", None, None
    if not AMOUNT_PATTERN.fullmatch(value):
        return "invalid", None, None
    try:
        parsed = Decimal(value)
    except InvalidOperation:
        return "invalid", None, None
    if not parsed.is_finite():
        return "invalid", None, None
    canonical = format(parsed, "f")
    scale = max(0, -parsed.as_tuple().exponent)
    if parsed < 0:
        return "negative", canonical, scale
    if parsed == 0:
        return "zero", canonical, scale
    # A value such as 1.000 is still exactly representable in cents.  Keep the
    # lexical scale as a separate value, but classify by mathematical value.
    with localcontext() as context:
        context.prec = max(80, len(value) + 10)
        cents = parsed * Decimal(100)
        exact_cent = cents.to_integral_value() == cents
    return ("positive-exact-cent" if exact_cent else "positive-subcent"), canonical, scale


def parse_date_status(raw: str, observed_date: date) -> tuple[str, str | None]:
    value = raw.strip()
    if not value:
        return "missing", None
    try:
        parsed = parse_iso_date_or_datetime(value)
    except ValueError:
        return "invalid", None
    if parsed.year < 1990:
        return "before-1990", None
    if parsed > observed_date:
        return "future", None
    return "valid", parsed.isoformat()


def parse_iso_date_or_datetime(value: str) -> date:
    """Parse ANAC date fields, which may be date-only or timestamp strings."""
    try:
        return date.fromisoformat(value)
    except ValueError:
        return datetime.fromisoformat(value.replace("Z", "+00:00")).date()


def sha256_path(path: Path) -> str:
    digest = hashlib.sha256()
    with path.open("rb") as stream:
        for block in iter(lambda: stream.read(1024 * 1024), b""):
            digest.update(block)
    return digest.hexdigest()


def sha256_zip_member(archive: zipfile.ZipFile, member: zipfile.ZipInfo) -> str:
    digest = hashlib.sha256()
    with archive.open(member) as stream:
        for block in iter(lambda: stream.read(1024 * 1024), b""):
            digest.update(block)
    return digest.hexdigest()


def checked_row(
    row: dict[str | None, str | list[str] | None], *, path: Path, row_number: int
) -> dict[str, str]:
    if None in row or any(value is None or isinstance(value, list) for value in row.values()):
        raise ContractError(f"{path.name}: riga {row_number} con numero di colonne inatteso")
    return {str(key): str(value) for key, value in row.items()}


@contextmanager
def csv_rows(path: Path, expected_headers: tuple[str, ...]) -> Iterator[csv.DictReader]:
    if not path.is_file():
        raise ContractError(f"Input non trovato: {path}")
    archive: zipfile.ZipFile | None = None
    stream: TextIO
    if path.suffix.lower() == ".zip":
        if not zipfile.is_zipfile(path):
            raise ContractError(f"{path.name}: ZIP non valido")
        archive = zipfile.ZipFile(path)
        members = [entry for entry in archive.infolist() if entry.filename.lower().endswith(".csv")]
        if len(members) != 1:
            archive.close()
            raise ContractError(f"{path.name}: atteso un solo membro CSV")
        stream = io.TextIOWrapper(archive.open(members[0]), encoding="utf-8-sig", newline="")
    else:
        stream = path.open("r", encoding="utf-8-sig", newline="")
    try:
        reader = csv.DictReader(stream, delimiter=";", strict=True)
        if tuple(reader.fieldnames or ()) != expected_headers:
            raise ContractError(
                f"{path.name}: header inatteso; atteso ordine esatto {', '.join(expected_headers)}"
            )
        yield reader
    except (UnicodeDecodeError, csv.Error) as exc:
        raise ContractError(f"{path.name}: CSV non valido: {exc}") from exc
    finally:
        stream.close()
        if archive is not None:
            archive.close()


def source_lock_metadata(specification: Mapping[str, object]) -> dict[str, object]:
    member = specification.get("member")
    if not isinstance(member, Mapping):
        raise ContractError("Source lock: membro ZIP non valido")
    required = ("archiveBytes", "archiveSha256", "delimiter", "encoding", "headers")
    missing = [key for key in required if key not in specification]
    if missing:
        raise ContractError(f"Source lock incompleto: {', '.join(missing)}")
    if not SHA256_PATTERN.fullmatch(str(specification["archiveSha256"])):
        raise ContractError("Source lock: SHA-256 archivio non valido")
    return {
        "archiveBytes": int(specification["archiveBytes"]),
        "archiveSha256": str(specification["archiveSha256"]),
        "delimiter": str(specification["delimiter"]),
        "encoding": str(specification["encoding"]),
        "headers": list(specification["headers"]),
        "member": dict(member),
        "datasetPageUrl": specification.get("datasetPageUrl"),
        "resourceName": specification.get("resourceName"),
        "resourcePageUrl": specification.get("resourcePageUrl"),
        "resourceUrl": specification.get("resourceUrl"),
        "sourceLastModified": specification.get("sourceLastModified"),
    }


def verify_locked_input(path: Path, specification: Mapping[str, object]) -> dict[str, object]:
    """Verify archive bytes/hash, the sole CSV member, CRC, member hash, and header."""
    lock = source_lock_metadata(specification)
    if not path.is_file():
        raise ContractError(f"Input non trovato: {path}")
    if path.stat().st_size != int(lock["archiveBytes"]):
        raise ContractError(f"{path.name}: dimensione archivio diversa dal source lock")
    if sha256_path(path) != lock["archiveSha256"]:
        raise ContractError(f"{path.name}: SHA-256 archivio diverso dal source lock")
    if not zipfile.is_zipfile(path):
        raise ContractError(f"{path.name}: atteso un archivio ZIP valido")
    member_spec = lock["member"]
    if not isinstance(member_spec, Mapping):
        raise ContractError("Source lock: membro ZIP non valido")
    with zipfile.ZipFile(path) as archive:
        members = [entry for entry in archive.infolist() if entry.filename.lower().endswith(".csv")]
        if len(members) != 1:
            raise ContractError(f"{path.name}: atteso un solo membro CSV")
        member = members[0]
        if member.filename != member_spec.get("name"):
            raise ContractError(f"{path.name}: nome del membro ZIP inatteso")
        if member.file_size != int(member_spec["bytes"]):
            raise ContractError(f"{path.name}: dimensione del membro ZIP inattesa")
        if f"{member.CRC:08x}" != str(member_spec["crc32"]).lower():
            raise ContractError(f"{path.name}: CRC32 del membro ZIP inatteso")
        if sha256_zip_member(archive, member) != member_spec["sha256"]:
            raise ContractError(f"{path.name}: SHA-256 del membro ZIP inatteso")
        with io.TextIOWrapper(archive.open(member), encoding=str(lock["encoding"]), newline="") as stream:
            reader = csv.reader(stream, delimiter=str(lock["delimiter"]), strict=True)
            header = tuple(next(reader, []))
        if header != tuple(lock["headers"]):
            raise ContractError(f"{path.name}: header diverso dal source lock")
    return lock


def load_source_spec(path: Path) -> tuple[dict[str, object], str]:
    try:
        specification = json.loads(path.read_text(encoding="utf-8"))
    except (OSError, json.JSONDecodeError) as exc:
        raise ContractError(f"source spec non leggibile: {path}") from exc
    if not isinstance(specification, dict):
        raise ContractError("source spec: oggetto JSON atteso")
    return specification, sha256_path(path)


def _station_record(value: object) -> tuple[str | None, date | None, date | None]:
    """Accept old CF-only test mappings and interval-aware registry records."""
    if isinstance(value, Mapping):
        cf = value.get("cf")
        start = value.get("start_date")
        end = value.get("end_date")
        return (
            str(cf) if cf is not None else None,
            start if isinstance(start, date) else None,
            end if isinstance(end, date) else None,
        )
    if isinstance(value, tuple):
        cf = value[0] if value else None
        start = value[1] if len(value) > 1 and isinstance(value[1], date) else None
        end = value[2] if len(value) > 2 and isinstance(value[2], date) else None
        return (str(cf) if cf is not None else None, start, end)
    return (str(value) if value is not None else None, None, None)


def _station_active(value: object, publication_date: date | None) -> bool:
    _, start, end = _station_record(value)
    if publication_date is None:
        return True
    return (start is None or publication_date >= start) and (end is None or publication_date <= end)


def resolve_identity(
    ausa_raw: str,
    cf_raw: str,
    registry_by_ausa: Mapping[str, object],
    registry_by_cf: Mapping[str, tuple[str, ...]],
    *,
    publication_date: date | None = None,
    publication_date_status: str | None = None,
) -> dict[str, str | None]:
    """Resolve identity without using denomination or IPA as an identifier."""
    ausa = normalize_ausa(ausa_raw)
    cf = normalize_cf(cf_raw)
    ausa_valid = ausa is not None and bool(AUSA_PATTERN.fullmatch(ausa)) and set(ausa) != {"0"}
    cf_class = classify_entity_cf(cf)
    cf_valid = cf_class == "valid"

    def result(
        status: str, reason: str, station: str | None = None, entity: str | None = None
    ) -> dict[str, str | None]:
        if status == "resolved" and (
            entity is None or not re.fullmatch(r"cf:(?:[0-9]{11}|[A-Z0-9]{16})", entity)
        ):
            raise ContractError("risoluzione identity senza entityKey valido")
        return {"status": status, "reason": reason, "stationKey": station, "entityKey": entity}

    if ausa is not None and not ausa_valid:
        return result("conflict", "ausa-invalid")
    if ausa_valid:
        if ausa not in registry_by_ausa:
            return result("conflict", "ausa-not-in-registry")
        station_key = f"ausa:{ausa}"
        registry_cf_raw, _, _ = _station_record(registry_by_ausa[ausa])
        registry_cf = normalize_cf(registry_cf_raw or "")
        registry_cf_class = classify_entity_cf(registry_cf)
        if publication_date_status is not None and (
            publication_date_status != "valid" or publication_date is None
        ):
            return result("unresolved", "publication-date-unusable", station_key)
        if not _station_active(registry_by_ausa[ausa], publication_date):
            return result("unresolved", "ausa-outside-registry-interval", station_key)
        if cf_class == "placeholder":
            return result("unresolved", "cf-placeholder", station_key)
        if cf is not None and not cf_valid:
            if registry_cf == cf and registry_cf_class != "valid":
                return result("unresolved", "registry-cf-nonstandard", station_key)
            return result("conflict", "cf-invalid", station_key)
        if registry_cf is not None and registry_cf_class != "valid":
            return result(
                "unresolved" if cf is None or cf == registry_cf else "conflict",
                "registry-cf-nonstandard" if cf is None or cf == registry_cf else "ausa-cf-conflict",
                station_key,
            )
        if cf is not None and registry_cf is not None and cf != registry_cf:
            return result("conflict", "ausa-cf-conflict", station_key)
        entity_cf = registry_cf or (cf if cf_valid else None)
        if entity_cf is None:
            return result("unresolved", "ausa-without-entity-cf", station_key)
        return result(
            "resolved",
            "ausa-and-cf" if cf is not None and registry_cf == cf else "ausa-only",
            station_key,
            f"cf:{entity_cf}",
        )
    if publication_date_status is not None and (
        publication_date_status != "valid" or publication_date is None
    ):
        return result("unresolved", "publication-date-unusable")
    if cf_class == "missing":
        return result("unresolved", "missing-both")
    if cf_class == "placeholder":
        return result("unresolved", "cf-placeholder")
    if not cf_valid:
        return result("unresolved", "cf-invalid")
    entity_key = f"cf:{cf}"
    candidates = [
        candidate for candidate in registry_by_cf.get(cf, ())
        if candidate in registry_by_ausa
        and normalize_cf(_station_record(registry_by_ausa[candidate])[0] or "") == cf
        and valid_entity_cf(_station_record(registry_by_ausa[candidate])[0])
        and _station_active(registry_by_ausa[candidate], publication_date)
    ]
    if not candidates:
        return result("unresolved", "cf-no-active-station", None, entity_key)
    if len(candidates) > 1:
        return result("unresolved", "ambiguous-cf", None, entity_key)
    return result("resolved", "cf-fallback", f"ausa:{candidates[0]}", entity_key)


def make_database(path: Path) -> sqlite3.Connection:
    connection = sqlite3.connect(path)
    connection.executescript(
        """
        PRAGMA journal_mode = OFF;
        PRAGMA synchronous = OFF;
        PRAGMA temp_store = MEMORY;
        PRAGMA cache_size = -100000;
        CREATE TABLE stations (
          ausa TEXT PRIMARY KEY, cf TEXT, status TEXT, start_date TEXT, end_date TEXT
        ) WITHOUT ROWID;
        CREATE INDEX stations_cf ON stations(cf);
        CREATE TABLE cig_observed (
          cig TEXT PRIMARY KEY, raw_count INTEGER NOT NULL, primary_count INTEGER NOT NULL
        ) WITHOUT ROWID;
        CREATE TABLE procedures (
          cig TEXT PRIMARY KEY, month INTEGER NOT NULL, ausa TEXT, cf TEXT,
          station_key TEXT, entity_key TEXT, identity_status TEXT NOT NULL,
          identity_reason TEXT NOT NULL, publication_date_status TEXT NOT NULL,
          publication_date TEXT, lot_amount_status TEXT NOT NULL,
          lot_amount TEXT
        ) WITHOUT ROWID;
        CREATE TABLE awards (
          cig TEXT NOT NULL, award_id TEXT NOT NULL, amount_status TEXT NOT NULL,
          amount TEXT, award_date_status TEXT NOT NULL, award_date TEXT,
          row_signature TEXT NOT NULL, row_count INTEGER NOT NULL,
          PRIMARY KEY (cig, award_id)
        ) WITHOUT ROWID;
        CREATE TABLE awardees (
          cig TEXT NOT NULL, award_id TEXT NOT NULL, row_count INTEGER NOT NULL,
          PRIMARY KEY (cig, award_id)
        ) WITHOUT ROWID;
        CREATE TABLE awardee_signatures (signature TEXT PRIMARY KEY, row_count INTEGER NOT NULL) WITHOUT ROWID;
        """
    )
    return connection


def load_registry(
    connection: sqlite3.Connection, path: Path
) -> tuple[dict[str, object], dict[str, tuple[str, ...]], Counter[str]]:
    by_ausa: dict[str, object] = {}
    by_cf_work: dict[str, list[str]] = {}
    counts: Counter[str] = zero_counter(REGISTRY_COUNTER_KEYS)
    with csv_rows(path, STATION_HEADERS) as reader:
        for row_number, raw in enumerate(reader, start=2):
            row = checked_row(raw, path=path, row_number=row_number)
            ausa = normalize_ausa(row["codice_ausa"])
            cf = normalize_registry_cf(row["codice_fiscale"])
            if ausa is None or not AUSA_PATTERN.fullmatch(ausa) or set(ausa) == {"0"}:
                raise ContractError(f"{path.name}: AUSA non valido alla riga {row_number}")
            if cf is not None and not REGISTRY_CF_PATTERN.fullmatch(cf):
                raise ContractError(f"{path.name}: codice fiscale non valido alla riga {row_number}")
            if ausa in by_ausa:
                raise ContractError(f"{path.name}: AUSA duplicato {ausa}")
            start = row["data_inizio"].strip()
            end = row["data_fine"].strip()
            try:
                start_date = parse_iso_date_or_datetime(start) if start else None
                end_date = parse_iso_date_or_datetime(end) if end else None
            except ValueError as exc:
                raise ContractError(
                    f"{path.name}: intervallo data stazione non valido alla riga {row_number}"
                ) from exc
            if start_date and end_date and end_date < start_date:
                raise ContractError(f"{path.name}: intervallo data stazione invertito alla riga {row_number}")
            status = normalized_text(row["stato"])
            status_key = status if status in {"ATTIVO", "CESSATO"} else "(other)"
            by_ausa[ausa] = {
                "cf": cf,
                "start_date": start_date,
                "end_date": end_date,
                "status": status,
            }
            if cf and valid_entity_cf(cf):
                by_cf_work.setdefault(cf, []).append(ausa)
            connection.execute(
                "INSERT INTO stations VALUES (?, ?, ?, ?, ?)",
                (
                    ausa,
                    cf,
                    status,
                    start_date.isoformat() if start_date else None,
                    end_date.isoformat() if end_date else None,
                ),
            )
            counts["rowsTotal"] += 1
            counts["rowsWithAusa"] += 1
            counts["rowsWithCf"] += int(cf is not None)
            counts["rowsWithEntityCf"] += int(cf is not None and valid_entity_cf(cf))
            counts["rowsWithNonstandardCf"] += int(cf is not None and not valid_entity_cf(cf))
            counts[f"status:{status_key if status else '(missing)'}"] += 1
    connection.commit()
    counts["distinctAusa"] = len(by_ausa)
    counts["distinctCf"] = len(by_cf_work)
    counts["cfWithMultipleAusa"] = sum(len(items) > 1 for items in by_cf_work.values())
    by_cf = {key: tuple(values) for key, values in by_cf_work.items()}
    return by_ausa, by_cf, closed_counter(counts, REGISTRY_COUNTER_KEYS, "registry")


def load_cig_inputs(
    connection: sqlite3.Connection,
    paths: list[Path],
    expected_months: list[int],
    registry_by_ausa: Mapping[str, object],
    registry_by_cf: Mapping[str, tuple[str, ...]],
    observed_date: date,
) -> tuple[Counter[str], Counter[str]]:
    if len(paths) != len(expected_months):
        raise ContractError(f"attesi {len(expected_months)} input CIG, ricevuti {len(paths)}")
    counts: Counter[str] = zero_counter(PROCEDURE_COUNTER_KEYS)
    identity: Counter[str] = zero_counter(IDENTITY_COUNTER_KEYS)
    for path, expected_month in zip(paths, expected_months, strict=True):
        with csv_rows(path, CIG_HEADERS) as reader:
            for row_number, raw in enumerate(reader, start=2):
                row = checked_row(raw, path=path, row_number=row_number)
                counts["rawRows"] += 1
                raw_cig = normalize_cig(row["cig"])
                if raw_cig:
                    existing_raw = connection.execute(
                        "SELECT primary_count FROM cig_observed WHERE cig = ?", (raw_cig,)
                    ).fetchone()
                    if existing_raw:
                        connection.execute(
                            "UPDATE cig_observed SET raw_count = raw_count + 1 WHERE cig = ?",
                            (raw_cig,),
                        )
                    else:
                        connection.execute(
                            "INSERT INTO cig_observed VALUES (?, 1, 0)", (raw_cig,)
                        )
                if row["flag_prevalente"].strip() != "1":
                    counts["nonPrimaryRows"] += 1
                    continue
                cig = raw_cig
                if not CIG_PATTERN.fullmatch(cig):
                    raise ContractError(f"{path.name}: CIG non valido alla riga {row_number}")
                if row["anno_pubblicazione"].strip() not in {"", "2025"}:
                    raise ContractError(f"{path.name}: anno pubblicazione fuori perimetro alla riga {row_number}")
                month_text = row["mese_pubblicazione"].strip()
                if month_text and month_text != str(expected_month):
                    raise ContractError(f"{path.name}: mese pubblicazione incoerente alla riga {row_number}")
                previous_primary = connection.execute(
                    "SELECT primary_count FROM cig_observed WHERE cig = ?", (cig,)
                ).fetchone()[0]
                connection.execute(
                    "UPDATE cig_observed SET primary_count = primary_count + 1 WHERE cig = ?", (cig,)
                )
                if previous_primary:
                    raise ContractError(f"CIG con piu righe prevalenti: {cig}")
                date_status, publication_date = parse_date_status(row["data_pubblicazione"], observed_date)
                parsed_publication_date = date.fromisoformat(publication_date) if publication_date else None
                if publication_date:
                    if parsed_publication_date.year != 2025 or parsed_publication_date.month != expected_month:
                        raise ContractError(f"{path.name}: data pubblicazione incoerente alla riga {row_number}")
                lot_status, lot_amount, _ = parse_amount(row["importo_lotto"])
                resolved = resolve_identity(
                    row["codice_ausa"], row["cf_amministrazione_appaltante"],
                    registry_by_ausa, registry_by_cf,
                    publication_date=parsed_publication_date,
                    publication_date_status=date_status,
                )
                connection.execute(
                    "INSERT INTO procedures VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)",
                    (
                        cig, expected_month,
                        normalize_ausa(row["codice_ausa"]), normalize_cf(row["cf_amministrazione_appaltante"]),
                        resolved["stationKey"], resolved["entityKey"], resolved["status"], resolved["reason"],
                        date_status, publication_date, lot_status, lot_amount,
                    ),
                )
                counts["primaryRows"] += 1
                counts[f"publicationDate:{date_status}"] += 1
                counts[f"lotAmount:{lot_status}"] += 1
                identity[str(resolved["status"])] += 1
                identity[f"via:{resolved['reason']}"] += 1
                counts[f"identity:{resolved['status']}"] += 1
    connection.commit()
    counts["distinctRawCigs"] = scalar(connection, "SELECT COUNT(*) FROM cig_observed")
    counts["cigsWithExactlyOnePrimary"] = scalar(
        connection, "SELECT COUNT(*) FROM cig_observed WHERE primary_count = 1"
    )
    counts["cigsWithoutPrimary"] = scalar(
        connection, "SELECT COUNT(*) FROM cig_observed WHERE primary_count = 0"
    )
    counts["cigsWithMultiplePrimary"] = scalar(
        connection, "SELECT COUNT(*) FROM cig_observed WHERE primary_count > 1"
    )
    counts["distinctCigs"] = scalar(connection, "SELECT COUNT(*) FROM procedures")
    if counts["cigsWithMultiplePrimary"]:
        raise ContractError("CIG con piu righe prevalenti nel perimetro")
    return (
        closed_counter(counts, PROCEDURE_COUNTER_KEYS, "procedures"),
        closed_counter(identity, IDENTITY_COUNTER_KEYS, "identity"),
    )


def load_awards(
    connection: sqlite3.Connection, path: Path, observed_date: date
) -> Counter[str]:
    counts: Counter[str] = zero_counter(AWARD_COUNTER_KEYS)
    with csv_rows(path, AWARD_HEADERS) as reader:
        for row_number, raw in enumerate(reader, start=2):
            row = checked_row(raw, path=path, row_number=row_number)
            counts["rawRows"] += 1
            cig = normalize_cig(row["cig"])
            award_id, id_status = parse_award_id(row["id_aggiudicazione"])
            amount_status, amount, _ = parse_amount(row["importo_aggiudicazione"])
            date_status, award_date = parse_date_status(
                row["data_aggiudicazione_definitiva"], observed_date
            )
            counts[f"id:{id_status}"] += 1
            counts[f"amount:{amount_status}"] += 1
            counts[f"awardDate:{date_status}"] += 1
            if not CIG_PATTERN.fullmatch(cig) or award_id is None:
                counts["ineligibleKeyRows"] += 1
                continue
            row_signature = hashlib.sha256(
                json.dumps(
                    tuple(row[header] for header in AWARD_HEADERS), ensure_ascii=False
                ).encode("utf-8")
            ).hexdigest()
            existing = connection.execute(
                "SELECT amount_status, amount, award_date_status, award_date, "
                "row_signature, row_count FROM awards WHERE cig = ? AND award_id = ?",
                (cig, award_id),
            ).fetchone()
            if existing:
                stored_amount_status, stored_amount, stored_date_status, stored_date = existing[:4]
                amount_conflict = stored_amount_status == "conflicting" or (
                    stored_amount_status, stored_amount
                ) != (amount_status, amount)
                date_conflict = stored_date_status == "conflicting" or (
                    stored_date_status, stored_date
                ) != (date_status, award_date)
                connection.execute(
                    "UPDATE awards SET amount_status = ?, amount = ?, award_date_status = ?, "
                    "award_date = ?, row_count = row_count + 1 WHERE cig = ? AND award_id = ?",
                    (
                        "conflicting" if amount_conflict else stored_amount_status,
                        None if amount_conflict else stored_amount,
                        "conflicting" if date_conflict else stored_date_status,
                        None if date_conflict else stored_date,
                        cig,
                        award_id,
                    ),
                )
                counts["duplicateKeyRows"] += 1
                if existing[4] == row_signature:
                    counts["exactDuplicateRows"] += 1
            else:
                connection.execute(
                    "INSERT INTO awards VALUES (?, ?, ?, ?, ?, ?, ?, 1)",
                    (cig, award_id, amount_status, amount, date_status, award_date, row_signature),
                )
            counts["knownKeyRows"] += 1
            if counts["rawRows"] % 50_000 == 0:
                connection.commit()
    connection.commit()
    counts["distinctAwards"] = scalar(connection, "SELECT COUNT(*) FROM awards")
    counts["duplicateKeyGroups"] = scalar(connection, "SELECT COUNT(*) FROM awards WHERE row_count > 1")
    counts["amountConflictGroups"] = scalar(
        connection, "SELECT COUNT(*) FROM awards WHERE amount_status = 'conflicting'"
    )
    counts["awardDateConflictGroups"] = scalar(
        connection, "SELECT COUNT(*) FROM awards WHERE award_date_status = 'conflicting'"
    )
    counts["criticalConflictGroups"] = scalar(
        connection,
        "SELECT COUNT(*) FROM awards WHERE amount_status = 'conflicting' OR award_date_status = 'conflicting'",
    )
    counts["conflictingAwardKeys"] = counts["criticalConflictGroups"]
    counts.setdefault("exactDuplicateRows", 0)
    counts["nonIdenticalDuplicateRows"] = counts["duplicateKeyRows"] - counts["exactDuplicateRows"]
    return closed_counter(counts, AWARD_COUNTER_KEYS, "awards")


def load_awardees(connection: sqlite3.Connection, path: Path) -> Counter[str]:
    counts: Counter[str] = zero_counter(AWARDEE_COUNTER_KEYS)
    with csv_rows(path, AWARDEE_HEADERS) as reader:
        for row_number, raw in enumerate(reader, start=2):
            row = checked_row(raw, path=path, row_number=row_number)
            counts["rawRows"] += 1
            cig = normalize_cig(row["cig"])
            award_id, id_status = parse_award_id(row["id_aggiudicazione"])
            counts[f"id:{id_status}"] += 1
            if not CIG_PATTERN.fullmatch(cig) or award_id is None:
                counts["ineligibleKeyRows"] += 1
                continue
            existing = connection.execute(
                "SELECT row_count FROM awardees WHERE cig = ? AND award_id = ?", (cig, award_id)
            ).fetchone()
            if existing:
                connection.execute(
                    "UPDATE awardees SET row_count = row_count + 1 WHERE cig = ? AND award_id = ?",
                    (cig, award_id),
                )
            else:
                connection.execute("INSERT INTO awardees VALUES (?, ?, 1)", (cig, award_id))
            signature = hashlib.sha256(
                json.dumps(tuple(row[header] for header in AWARDEE_HEADERS), ensure_ascii=False).encode("utf-8")
            ).hexdigest()
            connection.execute(
                "INSERT INTO awardee_signatures(signature, row_count) VALUES (?, 1) "
                "ON CONFLICT(signature) DO UPDATE SET row_count = row_count + 1",
                (signature,),
            )
            counts["knownKeyRows"] += 1
            if counts["rawRows"] % 50_000 == 0:
                connection.commit()
    connection.commit()
    counts["distinctJoinPairs"] = scalar(connection, "SELECT COUNT(*) FROM awardees")
    counts["exactDuplicateRows"] = scalar(
        connection, "SELECT COALESCE(SUM(row_count - 1), 0) FROM awardee_signatures WHERE row_count > 1"
    )
    counts["pairsWithMultipleAwardeeRows"] = scalar(
        connection, "SELECT COUNT(*) FROM awardees WHERE row_count > 1"
    )
    return closed_counter(counts, AWARDEE_COUNTER_KEYS, "awardees")


def scalar(connection: sqlite3.Connection, query: str, parameters: tuple[object, ...] = ()) -> int:
    value = connection.execute(query, parameters).fetchone()[0]
    return int(value or 0)


def sum_amounts(connection: sqlite3.Connection, query: str, params: tuple[object, ...] = ()) -> str:
    with localcontext() as context:
        context.prec = 80
        total = Decimal(0)
        for (value,) in connection.execute(query, params):
            if value is not None:
                total += Decimal(value)
        return format(total, "f")


def amount_coverage(
    connection: sqlite3.Connection,
    table: str,
    where: str = "",
    params: tuple[object, ...] = (),
) -> dict[str, object]:
    if table not in {"procedures", "awards"}:
        raise ContractError("tabella importi non autorizzata")
    status_column = "lot_amount_status" if table == "procedures" else "amount_status"
    value_column = "lot_amount" if table == "procedures" else "amount"
    condition = f" WHERE {where}" if where else ""
    status_query = (
        f"SELECT COUNT(*) FROM {table}{condition} AND {status_column} = ?"
        if where
        else f"SELECT COUNT(*) FROM {table} WHERE {status_column} = ?"
    )
    rows = {
        status: scalar(connection, status_query, (*params, status))
        for status in AMOUNT_STATUSES
    }
    result: dict[str, object] = {"distinctRows": sum(rows.values()), "statusRows": rows}
    for status in ("positive-exact-cent", "positive-subcent"):
        query = (
            f"SELECT {value_column} FROM {table}{condition} AND {status_column} = ?"
            if where
            else f"SELECT {value_column} FROM {table} WHERE {status_column} = ?"
        )
        result[f"{status}Sum"] = sum_amounts(connection, query, (*params, status))
    result["positiveRows"] = rows["positive-exact-cent"] + rows["positive-subcent"]
    result["positiveSum"] = sum_amounts(
        connection,
        (
            f"SELECT {value_column} FROM {table}{condition} "
            f"AND {status_column} IN (?, ?)"
            if where
            else f"SELECT {value_column} FROM {table} WHERE {status_column} IN (?, ?)"
        ),
        (*params, "positive-exact-cent", "positive-subcent"),
    )
    validate_amount_coverage(result, table)
    return result


def validate_manifest(manifest: Mapping[str, object]) -> None:
    validate_exact_keys(manifest, ROOT_KEYS, "radice")
    if (
        manifest.get("schemaVersion") != 1
        or manifest.get("dataset") != "anac-entity-procurement-coverage"
        or manifest.get("distributionKind") != "full-snapshot"
    ):
        raise ContractError("manifest schema/dataset inatteso")
    instants: dict[str, datetime] = {}
    for key in ("observedAt", "generatedAt"):
        value = manifest.get(key)
        if not isinstance(value, str) or UTC_INSTANT_PATTERN.fullmatch(value) is None:
            raise ContractError(f"manifest {key} non valido")
        try:
            parsed = datetime.fromisoformat(value.replace("Z", "+00:00"))
        except ValueError as exc:
            raise ContractError(f"manifest {key} non valido") from exc
        if parsed.tzinfo is None:
            raise ContractError(f"manifest {key} non valido")
        instants[key] = parsed
    if instants["generatedAt"] < instants["observedAt"]:
        raise ContractError("cronologia manifest non valida")
    source_spec_sha256 = manifest.get("sourceSpecSha256")
    if source_spec_sha256 is not None and (
        not isinstance(source_spec_sha256, str)
        or SHA256_PATTERN.fullmatch(source_spec_sha256) is None
    ):
        raise ContractError("sourceSpecSha256 manifest non valido")
    scope = manifest.get("scope")
    if not isinstance(scope, Mapping) or dict(scope) != SCOPE_CONTRACT:
        raise ContractError("perimetro manifest non valido")
    if manifest.get("limitations") != list(LIMITATIONS):
        raise ContractError("limitations manifest non valide")
    contract = manifest.get("contract")
    if not isinstance(contract, Mapping) or dict(contract) != ENTITY_CONTRACT:
        raise ContractError("contratto manifest non valido")
    privacy = manifest.get("privacy")
    if not isinstance(privacy, Mapping) or dict(privacy) != PRIVACY_CONTRACT:
        raise ContractError("privacy manifest non valida")
    inputs = manifest.get("inputs")
    if not isinstance(inputs, Mapping):
        raise ContractError("inputs manifest mancanti")
    validate_exact_keys(inputs, INPUT_KEYS, "inputs")
    provenance = manifest.get("provenance")
    if not isinstance(provenance, Mapping):
        raise ContractError("provenance manifest mancante")
    validate_exact_keys(provenance, PROVENANCE_KEYS, "provenance")
    amounts = manifest.get("amounts")
    if not isinstance(amounts, Mapping):
        raise ContractError("sezioni importi mancanti")
    validate_exact_keys(amounts, AMOUNTS_KEYS, "amounts")
    if (
        amounts.get("awardeeMultiplication") is not False
        or amounts.get("lotAndAwardAmountsAreDistinctFields") is not True
    ):
        raise ContractError("invariante multi-party importi non valida")
    coverage = manifest.get("coverage")
    if not isinstance(coverage, Mapping):
        raise ContractError("coverage manifest mancante")
    validate_exact_keys(coverage, COVERAGE_KEYS, "coverage")
    registry = coverage.get("registry")
    procedures = coverage.get("procedures")
    identity = coverage.get("identity")
    awards = coverage.get("awards")
    awardees = coverage.get("awardees")
    if not all(isinstance(item, Mapping) for item in (registry, procedures, identity, awards, awardees)):
        raise ContractError("partizione procedure/identita mancante")
    assert isinstance(registry, Mapping) and isinstance(procedures, Mapping)
    assert isinstance(identity, Mapping) and isinstance(awards, Mapping) and isinstance(awardees, Mapping)
    validate_closed_counter(registry, REGISTRY_COUNTER_KEYS, "registry")
    validate_closed_counter(procedures, PROCEDURE_COUNTER_KEYS, "procedures")
    validate_closed_counter(identity, IDENTITY_COUNTER_KEYS, "identity")
    validate_closed_counter(awards, AWARD_COUNTER_KEYS, "awards")
    validate_closed_counter(awardees, AWARDEE_COUNTER_KEYS, "awardees")
    if not (
        registry["rowsTotal"] == registry["rowsWithAusa"] == registry["distinctAusa"]
        and registry["rowsWithCf"] <= registry["rowsTotal"]
        and registry["distinctCf"] <= registry["rowsWithCf"]
        and registry["cfWithMultipleAusa"] <= registry["distinctCf"]
        and registry["rowsWithEntityCf"] + registry["rowsWithNonstandardCf"]
        == registry["rowsWithCf"]
    ):
        raise ContractError("partizione registro stazioni incoerente")
    if procedures.get("primaryRows") != procedures.get("distinctCigs"):
        raise ContractError("partizione CIG prevalenti incoerente")
    if procedures.get("rawRows") != procedures.get("primaryRows") + procedures.get("nonPrimaryRows"):
        raise ContractError("partizione righe CIG prevalenti/non prevalenti incoerente")
    if procedures.get("distinctRawCigs") != sum(
        int(procedures.get(key, 0))
        for key in ("cigsWithExactlyOnePrimary", "cigsWithoutPrimary", "cigsWithMultiplePrimary")
    ):
        raise ContractError("partizione CIG raw incoerente")
    identity_rows = sum(
        int(identity.get(status, 0))
        for status in ("resolved", "unresolved", "conflict")
    )
    identity_reasons = sum(
        int(value)
        for key, value in identity.items()
        if key.startswith("via:")
    )
    if identity_rows != procedures.get("primaryRows") or identity_reasons != procedures.get("primaryRows"):
        raise ContractError("partizione identita incoerente")
    for prefix, keys in (
        (
            "publicationDate",
            tuple(
                f"publicationDate:{status}"
                for status in DATE_STATUSES
                if status != "conflicting"
            ),
        ),
        ("lotAmount", tuple(f"lotAmount:{status}" for status in AMOUNT_STATUSES)),
    ):
        if sum(int(procedures.get(key, 0)) for key in keys) != procedures.get("primaryRows"):
            raise ContractError(f"partizione {prefix} procedure incoerente")
    if awards.get("rawRows") != awards.get("knownKeyRows") + awards.get("ineligibleKeyRows"):
        raise ContractError("partizione righe aggiudicazioni eleggibili incoerente")
    if awards.get("knownKeyRows") != awards.get("distinctAwards") + awards.get("duplicateKeyRows"):
        raise ContractError("partizione chiavi aggiudicazioni duplicate incoerente")
    if awards.get("duplicateKeyRows") != awards.get("exactDuplicateRows") + awards.get("nonIdenticalDuplicateRows"):
        raise ContractError("partizione duplicate aggiudicazioni incoerente")
    if (
        awards.get("distinctAwards", 0) > awards.get("knownKeyRows", 0)
        or awards.get("duplicateKeyGroups", 0) > awards.get("distinctAwards", 0)
        or awards.get("exactDuplicateRows", 0) > awards.get("duplicateKeyRows", 0)
    ):
        raise ContractError("cardinalita chiavi aggiudicazioni incoerente")
    if awards.get("conflictingAwardKeys") != awards.get("criticalConflictGroups"):
        raise ContractError("partizione chiavi conflitto aggiudicazioni incoerente")
    amount_conflicts = awards.get("amountConflictGroups", 0)
    date_conflicts = awards.get("awardDateConflictGroups", 0)
    critical_conflicts = awards.get("criticalConflictGroups", 0)
    if (
        critical_conflicts < max(amount_conflicts, date_conflicts)
        or critical_conflicts > amount_conflicts + date_conflicts
        or critical_conflicts > awards.get("duplicateKeyGroups", 0)
    ):
        raise ContractError("partizione gruppi conflitto aggiudicazioni incoerente")
    for prefix, statuses in (
        ("id", ("missing", "missing-sentinel", "invalid", "known")),
        ("amount", AMOUNT_STATUSES),
        ("awardDate", tuple(status for status in DATE_STATUSES if status != "conflicting")),
    ):
        if sum(int(awards.get(f"{prefix}:{status}", 0)) for status in statuses) != awards.get("rawRows"):
            raise ContractError(f"partizione {prefix} aggiudicazioni incoerente")
    if awardees.get("rawRows") != awardees.get("knownKeyRows") + awardees.get("ineligibleKeyRows"):
        raise ContractError("partizione righe aggiudicatari eleggibili incoerente")
    if sum(
        int(awardees.get(f"id:{status}", 0))
        for status in ("missing", "missing-sentinel", "invalid", "known")
    ) != awardees.get("rawRows"):
        raise ContractError("partizione id aggiudicatari incoerente")
    if (
        awardees.get("distinctJoinPairs", 0) > awardees.get("knownKeyRows", 0)
        or awardees.get("exactDuplicateRows", 0) > awardees.get("knownKeyRows", 0)
        or awardees.get("pairsWithMultipleAwardeeRows", 0) > awardees.get("distinctJoinPairs", 0)
    ):
        raise ContractError("cardinalita aggiudicatari incoerente")
    award_coverage = amounts.get("awardRows")
    procedure_amount = amounts.get("procedureLot")
    contribution_amount = amounts.get("awardContributionInCohort")
    if not all(isinstance(item, Mapping) for item in (procedure_amount, award_coverage, contribution_amount)):
        raise ContractError("sezioni importi mancanti")
    assert isinstance(procedure_amount, Mapping) and isinstance(award_coverage, Mapping)
    assert isinstance(contribution_amount, Mapping)
    validate_amount_coverage(procedure_amount, "procedureLot")
    validate_amount_coverage(award_coverage, "awardRows")
    validate_amount_coverage(contribution_amount, "awardContributionInCohort")
    for status in AMOUNT_STATUSES:
        if contribution_amount["statusRows"][status] > award_coverage["statusRows"][status]:
            raise ContractError("partizione importi coorte superiore al totale")
    if procedure_amount["distinctRows"] != procedures["distinctCigs"]:
        raise ContractError("righe importo lotto non riconciliate con CIG")
    if award_coverage["distinctRows"] != awards["distinctAwards"]:
        raise ContractError("righe importo aggiudicazione non riconciliate con chiavi")
    if award_coverage["statusRows"]["conflicting"] != awards["amountConflictGroups"]:
        raise ContractError("conflitti importo aggiudicazione non riconciliati")
    reconciliation = manifest.get("reconciliation")
    if not isinstance(reconciliation, Mapping):
        raise ContractError("riconciliazione mancante")
    validate_nonnegative_integers(reconciliation, RECONCILIATION_KEYS, "reconciliation")
    if reconciliation.get("awardPairsTotal") != (
        reconciliation.get("awardPairsInCohort", 0)
        + reconciliation.get("awardPairsOutOfCohort", 0)
    ):
        raise ContractError("partizione aggiudicazioni in/out coorte incoerente")
    if reconciliation.get("awardeePairsTotal") != (
        reconciliation.get("awardeePairsInCohort", 0)
        + reconciliation.get("awardeePairsOutOfCohort", 0)
    ):
        raise ContractError("partizione aggiudicatari in/out coorte incoerente")
    if reconciliation.get("awardeePairsTotal") != awardees.get("distinctJoinPairs"):
        raise ContractError("riconciliazione aggiudicatari/chiavi incoerente")
    if reconciliation.get("awardPairsInCohort") != (
        reconciliation.get("awardPairsWithAwardees", 0)
        + reconciliation.get("awardPairsWithoutAwardees", 0)
    ):
        raise ContractError("partizione award pairs con/senza aggiudicatari incoerente")
    if reconciliation.get("awardPairsTotal") != award_coverage["distinctRows"]:
        raise ContractError("riconciliazione award pairs/importi incoerente")
    if reconciliation.get("awardPairsInCohort") != contribution_amount["distinctRows"]:
        raise ContractError("riconciliazione coorte/importi incoerente")
    if reconciliation.get("awardeePairsInCohort") != (
        reconciliation.get("awardPairsWithAwardees", 0)
        + reconciliation.get("awardeePairsWithoutAward", 0)
    ):
        raise ContractError("partizione aggiudicatari con/senza award incoerente")


def validate_source_spec(specification: Mapping[str, object]) -> None:
    if specification.get("schemaVersion") != 1 or specification.get("dataset") != "anac-entity-procurement-coverage":
        raise ContractError("source spec schema/dataset inatteso")
    catalog_observed = specification.get("catalogObservedAt")
    if not isinstance(catalog_observed, str) or not catalog_observed.endswith("Z"):
        raise ContractError("source spec: catalogObservedAt non valido")
    try:
        parsed_catalog_observed = datetime.fromisoformat(catalog_observed.replace("Z", "+00:00"))
    except ValueError as exc:
        raise ContractError("source spec: catalogObservedAt non valido") from exc
    if parsed_catalog_observed.tzinfo is None:
        raise ContractError("source spec: catalogObservedAt deve essere UTC")
    scope = specification.get("scope")
    if not isinstance(scope, Mapping) or scope.get("publicationMonths") != list(range(1, 13)):
        raise ContractError("source spec: devono esserci i dodici mesi CIG")
    inputs = specification.get("inputs")
    if (
        not isinstance(inputs, Mapping)
        or not isinstance(inputs.get("cig"), list)
        or len(inputs["cig"]) != 12
    ):
        raise ContractError("source spec: dodici input CIG obbligatori")
    station = inputs.get("stations")
    station_license = station.get("license") if isinstance(station, Mapping) else None
    if (
        not isinstance(station, Mapping)
        or not isinstance(station_license, Mapping)
        or station_license.get("url")
        != "https://w3id.org/italia/controlled-vocabulary/licences/A21_CCBY40"
    ):
        raise ContractError("source spec: licenza stazioni inattesa")
    header_contract = specification.get("headerContract")
    if not isinstance(header_contract, Mapping):
        raise ContractError("source spec: header contract mancante")
    if list(header_contract.get("cig", ())) != list(CIG_HEADERS):
        raise ContractError("source spec: header CIG inatteso")
    if list(header_contract.get("stations", ())) != list(STATION_HEADERS):
        raise ContractError("source spec: header stazioni inatteso")
    contract = specification.get("contract")
    wire_format = contract.get("wireFormat") if isinstance(contract, Mapping) else None
    if (
        not isinstance(wire_format, Mapping)
        or wire_format.get("delimiter") != ";"
        or wire_format.get("encoding") != "utf-8-sig"
        or wire_format.get("headers") != "headerContract"
    ):
        raise ContractError("source spec: wire format inatteso")
    if (
        not isinstance(contract, Mapping)
        or contract.get("stationIdentity") != "codice_ausa"
        or contract.get("entityIdentity") != "cf_amministrazione_appaltante"
        or contract.get("awardAmountAggregation") != "once-per-distinct-award-pair"
    ):
        raise ContractError("source spec: contratto identita/importi inatteso")
    for month, entry in enumerate(inputs["cig"], start=1):
        if not isinstance(entry, Mapping) or entry.get("month") != month:
            raise ContractError("source spec: ordine mesi CIG inatteso")
        asset_observed = entry.get("assetObservedAt")
        if not isinstance(asset_observed, str) or not asset_observed.endswith("Z"):
            raise ContractError("source spec: assetObservedAt CIG non valido")
        try:
            parsed_asset_observed = datetime.fromisoformat(asset_observed.replace("Z", "+00:00"))
        except ValueError as exc:
            raise ContractError("source spec: assetObservedAt CIG non valido") from exc
        if parsed_asset_observed.tzinfo is None:
            raise ContractError("source spec: assetObservedAt CIG deve essere UTC")
    station_asset_observed = station.get("assetObservedAt")
    if not isinstance(station_asset_observed, str) or not station_asset_observed.endswith("Z"):
        raise ContractError("source spec: assetObservedAt stazioni non valido")
    try:
        parsed_station_asset = datetime.fromisoformat(station_asset_observed.replace("Z", "+00:00"))
    except ValueError as exc:
        raise ContractError("source spec: assetObservedAt stazioni non valido") from exc
    if parsed_station_asset.tzinfo is None:
        raise ContractError("source spec: assetObservedAt stazioni deve essere UTC")
    for key in ("awards", "awardees"):
        entry = inputs.get(key)
        license_entry = entry.get("license") if isinstance(entry, Mapping) else None
        if (
            not isinstance(license_entry, Mapping)
            or license_entry.get("url")
            != "https://w3id.org/italia/controlled-vocabulary/licences/A31_CCBYSA40"
        ):
            raise ContractError(f"source spec: licenza {key} mancante o inattesa")
    parent = specification.get("parentDependencies")
    if not isinstance(parent, Mapping) or not SHA256_PATTERN.fullmatch(
        str(parent.get("parentSpecSha256", ""))
    ):
        raise ContractError("source spec: hash parent spec mancante o invalido")


def verify_parent_spec(specification: Mapping[str, object], spec_path: Path) -> tuple[dict[str, object], str]:
    parent = specification["parentDependencies"]
    assert isinstance(parent, Mapping)
    parent_path = Path(str(parent["parentSpecPath"]))
    if not parent_path.is_absolute():
        parent_path = (spec_path.parent / parent_path).resolve()
    parent_spec, actual_hash = load_source_spec(parent_path)
    if actual_hash != parent["parentSpecSha256"]:
        raise ContractError("parent source spec hash diverso")
    if not isinstance(parent_spec.get("inputs"), Mapping):
        raise ContractError("parent source spec senza inputs")
    return parent_spec, actual_hash


PUBLIC_INPUT_KEYS = (
    "month", "fileName", "resourceName", "datasetPageUrl", "datasetLegacyUuid",
    "resourcePageUrl", "resourceId", "resourceUrl", "sourceLastModified",
    "assetObservedAt", "archiveBytes", "catalogMetadataModifiedAt", "archiveSha256",
    "member", "delimiter", "encoding", "headers", "license",
)


def public_input(entry: Mapping[str, object], *, include_month: bool = False) -> dict[str, object]:
    """Project a source entry to public provenance fields only."""
    return {
        key: entry[key]
        for key in PUBLIC_INPUT_KEYS
        if key in entry and (include_month or key != "month")
    }


def repository_relative(path: Path) -> str:
    try:
        return path.resolve().relative_to(ROOT.resolve()).as_posix()
    except ValueError as exc:
        raise ContractError("source spec fuori dal repository") from exc


def expected_source_contract(
    specification: Mapping[str, object],
    *,
    spec_path: Path | None,
    spec_hash: str | None,
    parent_spec: Mapping[str, object] | None,
    parent_hash: str | None,
) -> tuple[dict[str, object], dict[str, object]]:
    """Derive the exact public input/provenance contract from both specs."""
    inputs = specification.get("inputs")
    if not isinstance(inputs, Mapping):
        raise ContractError("source spec inputs mancanti")
    cig_entries = inputs.get("cig")
    station_entry = inputs.get("stations")
    if not isinstance(cig_entries, list) or not isinstance(station_entry, Mapping):
        raise ContractError("source spec input CIG/stazioni mancanti")
    source_inputs: dict[str, object] = {
        "cig": [
            public_input(entry, include_month=True)
            for entry in cig_entries
            if isinstance(entry, Mapping)
        ],
        "stations": public_input(station_entry),
    }
    parent_provenance: dict[str, object] = {}
    if parent_spec is not None:
        if spec_path is None:
            raise ContractError("source spec path necessario per la provenance parent")
        dependencies = specification.get("parentDependencies")
        parent_inputs = parent_spec.get("inputs")
        if not isinstance(dependencies, Mapping) or not isinstance(parent_inputs, Mapping):
            raise ContractError("parent source spec/provenance incompleto")
        resolved_parent = (spec_path.parent / str(dependencies["parentSpecPath"])).resolve()
        parent_relative = repository_relative(resolved_parent)
        expected_parent_hash = str(dependencies["parentSpecSha256"])
        if parent_hash != expected_parent_hash:
            raise ContractError("parent source spec hash inatteso")
        parent_provenance = {
            "path": parent_relative,
            "sha256": expected_parent_hash,
            "catalogObservedAt": parent_spec.get("catalogObservedAt"),
            "catalogMetadataModifiedAt": parent_spec.get("catalogMetadataModifiedAt"),
        }
        for key in ("awards", "awardees"):
            parent_entry = parent_inputs.get(key)
            child_entry = inputs.get(key)
            if not isinstance(parent_entry, Mapping) or not isinstance(child_entry, Mapping):
                raise ContractError(f"source spec input parent {key} mancante")
            source_inputs[key] = {
                **public_input(parent_entry),
                "parentSpecPath": parent_relative,
                "parentSpecSha256": expected_parent_hash,
                "parentInputKey": key,
                "license": child_entry.get("license"),
            }
    else:
        source_inputs["awards"] = {"official": False}
        source_inputs["awardees"] = {"official": False}
    provenance = {
        "catalogObservedAt": specification.get("catalogObservedAt"),
        "catalogMetadataModifiedAt": specification.get("catalogMetadataModifiedAt"),
        "assetObservedAt": {
            "cig": [entry.get("assetObservedAt") for entry in cig_entries if isinstance(entry, Mapping)],
            "stations": station_entry.get("assetObservedAt"),
        },
        "sourceSpec": {
            "path": repository_relative(spec_path) if spec_path is not None else None,
            "sha256": spec_hash,
        },
        "parentSpec": parent_provenance,
    }
    return source_inputs, provenance


def input_lock_from_spec(entry: Mapping[str, object], headers: tuple[str, ...]) -> dict[str, object]:
    result = dict(entry)
    result["headers"] = list(headers)
    result.setdefault("delimiter", ";")
    result.setdefault("encoding", "utf-8-sig")
    return result


def audit(
    cig_paths: list[Path],
    stations_path: Path,
    awards_path: Path,
    awardees_path: Path,
    *,
    observed_at: str | date | None = None,
    generated_at: str | None = None,
    source_spec: Path | Mapping[str, object] | None = None,
    source_spec_sha256: str | None = None,
) -> dict[str, object]:
    if observed_at is None:
        observed_iso = DEFAULT_OBSERVED_AT
        observed_date = date.fromisoformat(DEFAULT_OBSERVED_AT[:10])
    elif isinstance(observed_at, date):
        observed_date = observed_at
        observed_iso = f"{observed_date.isoformat()}T00:00:00Z"
    else:
        observed_iso = str(observed_at)
        try:
            observed_date = datetime.fromisoformat(observed_iso.replace("Z", "+00:00")).date()
        except ValueError as exc:
            raise ContractError("observed_at non valido") from exc
    if generated_at is None:
        generated_iso = datetime.now(timezone.utc).replace(microsecond=0).isoformat().replace("+00:00", "Z")
    else:
        generated_iso = generated_at
        try:
            parsed_generated_at = datetime.fromisoformat(generated_iso.replace("Z", "+00:00"))
        except ValueError as exc:
            raise ContractError("generated_at non valido") from exc
        if parsed_generated_at.tzinfo is None or not generated_iso.endswith("Z"):
            raise ContractError("generated_at deve essere un istante UTC con suffisso Z")
    spec_path: Path | None = None
    specification: dict[str, object] | None = None
    spec_hash: str | None = None
    parent_spec: dict[str, object] | None = None
    if source_spec is not None:
        if isinstance(source_spec, Path):
            spec_path = source_spec
            specification, spec_hash = load_source_spec(source_spec)
        else:
            specification = dict(source_spec)
            spec_hash = source_spec_sha256
        validate_source_spec(specification)
        if source_spec_sha256 is not None and spec_hash != source_spec_sha256:
            raise ContractError("source spec hash diverso")
        if spec_path is not None:
            parent_spec, _ = verify_parent_spec(specification, spec_path)
        cig_entries = specification["inputs"]["cig"]
        assert isinstance(cig_entries, list)
        if len(cig_paths) != len(cig_entries):
            raise ContractError("numero input CIG diverso dal source spec")
        for path, entry in zip(cig_paths, cig_entries, strict=True):
            if not isinstance(entry, Mapping):
                raise ContractError("source spec input CIG non valido")
            verify_locked_input(path, input_lock_from_spec(entry, CIG_HEADERS))
        station_entry = specification["inputs"]["stations"]
        assert isinstance(station_entry, Mapping)
        verify_locked_input(stations_path, input_lock_from_spec(station_entry, STATION_HEADERS))
        if parent_spec is not None:
            parent_inputs = parent_spec.get("inputs")
            assert isinstance(parent_inputs, Mapping)
            for key, path in (("awards", awards_path), ("awardees", awardees_path)):
                entry = parent_inputs.get(key)
                if not isinstance(entry, Mapping):
                    raise ContractError(f"parent source spec: input {key} mancante")
                verify_locked_input(path, entry)
    expected_months = list(range(1, 13))
    with tempfile.TemporaryDirectory(prefix="anac-entity-procurement-") as temporary:
        connection = make_database(Path(temporary) / "audit.sqlite")
        try:
            registry_by_ausa, registry_by_cf, registry_counts = load_registry(connection, stations_path)
            cig_counts, identity_counts = load_cig_inputs(
                connection, cig_paths, expected_months, registry_by_ausa, registry_by_cf, observed_date
            )
            award_counts = load_awards(connection, awards_path, observed_date)
            awardee_counts = load_awardees(connection, awardees_path)
            procedure_lot = amount_coverage(connection, "procedures")
            award_amount = amount_coverage(connection, "awards")
            award_contribution = amount_coverage(
                connection, "awards", "EXISTS (SELECT 1 FROM procedures p WHERE p.cig = awards.cig)"
            )
            reconciliation = {
                "awardPairsTotal": scalar(connection, "SELECT COUNT(*) FROM awards"),
                "awardPairsInCohort": scalar(
                    connection,
                    "SELECT COUNT(*) FROM awards a "
                    "WHERE EXISTS (SELECT 1 FROM procedures p WHERE p.cig = a.cig)",
                ),
                "awardPairsOutOfCohort": scalar(
                    connection,
                    "SELECT COUNT(*) FROM awards a "
                    "WHERE NOT EXISTS (SELECT 1 FROM procedures p WHERE p.cig = a.cig)",
                ),
                "awardPairsWithAwardees": scalar(
                    connection,
                    "SELECT COUNT(*) FROM awards a "
                    "WHERE EXISTS (SELECT 1 FROM procedures p WHERE p.cig = a.cig) "
                    "AND EXISTS (SELECT 1 FROM awardees e "
                    "WHERE e.cig = a.cig AND e.award_id = a.award_id)",
                ),
                "awardPairsWithoutAwardees": scalar(
                    connection,
                    "SELECT COUNT(*) FROM awards a "
                    "WHERE EXISTS (SELECT 1 FROM procedures p WHERE p.cig = a.cig) "
                    "AND NOT EXISTS (SELECT 1 FROM awardees e "
                    "WHERE e.cig = a.cig AND e.award_id = a.award_id)",
                ),
                "awardeePairsTotal": scalar(connection, "SELECT COUNT(*) FROM awardees"),
                "awardeePairsInCohort": scalar(
                    connection,
                    "SELECT COUNT(*) FROM awardees e "
                    "WHERE EXISTS (SELECT 1 FROM procedures p WHERE p.cig = e.cig)",
                ),
                "awardeePairsOutOfCohort": scalar(
                    connection,
                    "SELECT COUNT(*) FROM awardees e "
                    "WHERE NOT EXISTS (SELECT 1 FROM procedures p WHERE p.cig = e.cig)",
                ),
                "awardeePairsWithoutAward": scalar(
                    connection,
                    "SELECT COUNT(*) FROM awardees e "
                    "WHERE EXISTS (SELECT 1 FROM procedures p WHERE p.cig = e.cig) "
                    "AND NOT EXISTS (SELECT 1 FROM awards a "
                    "WHERE a.cig = e.cig AND a.award_id = e.award_id)",
                ),
            }
            if specification is not None:
                source_inputs, provenance = expected_source_contract(
                    specification,
                    spec_path=spec_path,
                    spec_hash=spec_hash,
                    parent_spec=parent_spec,
                    parent_hash=(
                        specification.get("parentDependencies", {}).get("parentSpecSha256")
                        if isinstance(specification.get("parentDependencies"), Mapping)
                        else None
                    ),
                )
            else:
                source_inputs = {
                    "cig": [{"fileName": path.name, "official": False} for path in cig_paths],
                    "stations": {"fileName": stations_path.name, "official": False},
                    "awards": {"official": False},
                    "awardees": {"official": False},
                }
                provenance = {
                    "catalogObservedAt": None,
                    "catalogMetadataModifiedAt": None,
                    "assetObservedAt": {"cig": None, "stations": None},
                    "sourceSpec": {"path": None, "sha256": None},
                    "parentSpec": {},
                }
            manifest: dict[str, object] = {
                "schemaVersion": 1,
                "dataset": "anac-entity-procurement-coverage",
                "distributionKind": "full-snapshot",
                "observedAt": observed_iso,
                "generatedAt": generated_iso,
                "scope": {
                    "cohort": "cig-2025-full",
                    "publicationMonths": expected_months,
                    "nationalPopulationClaim": "not-asserted",
                    "temporalAlignment": "cross-snapshot",
                },
                "contract": {
                    "stationIdentity": "codice_ausa",
                    "entityIdentity": "cf_amministrazione_appaltante",
                    "stationKey": "ausa:<CODICE_AUSA>",
                    "entityKey": "cf:<CF_AMMINISTRAZIONE_APPALTANTE>",
                    "procedureKey": ["cig"],
                    "awardKey": ["cig", "id_aggiudicazione"],
                    "procedurePeriod": "data_pubblicazione",
                    "awardPeriod": "data_aggiudicazione_definitiva",
                    "procedureAmount": "importo_lotto",
                    "awardAmount": "importo_aggiudicazione",
                    "amountRepresentation": "exact-decimal",
                    "awardAmountAggregation": "once-per-distinct-award-pair",
                    "awardeeMultipartyPolicy": "awardee-rows-never-multiply-award-amount",
                },
                "privacy": {
                    "aggregateOnly": True,
                    "containsRawRows": False,
                    "containsRawTaxIds": False,
                    "containsNames": False,
                },
                "inputs": source_inputs,
                "provenance": provenance,
                "coverage": {
                    "registry": dict(registry_counts),
                    "procedures": dict(cig_counts),
                    "identity": dict(identity_counts),
                    "awards": dict(award_counts),
                    "awardees": dict(awardee_counts),
                },
                "amounts": {
                    "procedureLot": procedure_lot,
                    "awardRows": award_amount,
                    "awardContributionInCohort": award_contribution,
                    "awardeeMultiplication": False,
                    "lotAndAwardAmountsAreDistinctFields": True,
                },
                "reconciliation": reconciliation,
                "sourceSpecSha256": spec_hash,
                "limitations": list(LIMITATIONS),
            }
            validate_manifest(manifest)
            return manifest
        finally:
            connection.close()


def parse_paths(value: str) -> list[Path]:
    paths = [Path(item) for item in value.split(",") if item]
    if len(paths) != 12:
        raise argparse.ArgumentTypeError("--cig richiede dodici percorsi separati da virgola")
    return paths


def check_artifact(path: Path, specification_path: Path = DEFAULT_SPEC) -> None:
    """Offline check for a committed aggregate artifact; never refreshes inputs."""
    if not path.is_file():
        raise ContractError(f"artifact non trovato: {path}")
    try:
        manifest = json.loads(path.read_text(encoding="utf-8"))
    except (OSError, json.JSONDecodeError) as exc:
        raise ContractError(f"artifact non leggibile: {path}") from exc
    if not isinstance(manifest, Mapping):
        raise ContractError("artifact: oggetto JSON atteso")
    validate_manifest(manifest)
    specification, spec_hash = load_source_spec(specification_path)
    validate_source_spec(specification)
    if manifest.get("sourceSpecSha256") != spec_hash:
        raise ContractError("artifact: source spec hash diverso")
    parent_spec, parent_hash = verify_parent_spec(specification, specification_path)
    expected_inputs, expected_provenance = expected_source_contract(
        specification,
        spec_path=specification_path,
        spec_hash=spec_hash,
        parent_spec=parent_spec,
        parent_hash=parent_hash,
    )
    if manifest.get("inputs") != expected_inputs:
        raise ContractError("artifact: inputs non corrispondono ai source spec")
    provenance = manifest.get("provenance")
    if not isinstance(provenance, Mapping):
        raise ContractError("artifact: provenance mancante")
    if dict(provenance) != expected_provenance:
        raise ContractError("artifact: provenance non corrisponde ai source spec")
    serialized = json.dumps(manifest, ensure_ascii=False)
    if manifest.get("privacy", {}).get("containsRawRows") is not False:
        raise ContractError("artifact: raw rows dichiarate")
    if any(token in serialized for token in ("SYNTH AUTH", "SYNTH PARTY", "codice_ipa", "entityPeriods")):
        raise ContractError("artifact: identificatore o record raw inatteso")
    def reject_nested_raw(value: object, path_text: str = "artifact") -> None:
        if isinstance(value, Mapping):
            for key, item in value.items():
                key_text = str(key)
                lower_key = key_text.lower()
                if lower_key in {"raw", "rawrow", "records", "rows"} or (
                    lower_key == "rawrows" and not isinstance(item, int)
                ):
                    raise ContractError(f"artifact: record raw annidato in {path_text}.{key_text}")
                reject_nested_raw(item, f"{path_text}.{key_text}")
        elif isinstance(value, list):
            for index, item in enumerate(value):
                reject_nested_raw(item, f"{path_text}[{index}]")
    reject_nested_raw(manifest)


def main(argv: list[str] | None = None) -> int:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--cig", type=parse_paths, help="dodici ZIP CIG in ordine gennaio-dicembre")
    parser.add_argument("--stations", type=Path)
    parser.add_argument("--awards", type=Path)
    parser.add_argument("--awardees", type=Path)
    parser.add_argument("--source-spec", type=Path, default=DEFAULT_SPEC)
    parser.add_argument("--observed-at", default=DEFAULT_OBSERVED_AT)
    parser.add_argument("--generated-at", help="istante UTC riproducibile della generazione")
    parser.add_argument("--output", type=Path)
    parser.add_argument("--check", action="store_true", help="verifica un artifact gia generato senza input di rete")
    args = parser.parse_args(argv)
    if args.check:
        try:
            check_artifact(args.output or DEFAULT_OUTPUT, args.source_spec)
        except ContractError as exc:
            parser.error(str(exc))
            return 2
        return 0
    if not all((args.cig, args.stations, args.awards, args.awardees)):
        parser.error("--cig, --stations, --awards e --awardees sono obbligatori senza --check")
        return 2
    try:
        manifest = audit(
            args.cig, args.stations, args.awards, args.awardees,
            observed_at=args.observed_at, generated_at=args.generated_at, source_spec=args.source_spec,
        )
    except ContractError as exc:
        parser.error(str(exc))
        return 2
    encoded = json.dumps(manifest, ensure_ascii=False, indent=2) + "\n"
    if args.output:
        args.output.parent.mkdir(parents=True, exist_ok=True)
        args.output.write_text(encoded, encoding="utf-8")
    else:
        print(encoded, end="")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
