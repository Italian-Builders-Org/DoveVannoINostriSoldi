#!/usr/bin/env python3
"""Project a locked OpenCUP projects ZIP without publishing private identifiers."""
from __future__ import annotations

import csv
import gzip
import hashlib
import io
import json
import re
import sqlite3
import tempfile
import zipfile
from dataclasses import dataclass
from datetime import datetime
from pathlib import Path, PurePosixPath
from typing import Callable, Iterator, Literal
from urllib.parse import urlsplit

import integrated_curated_datasets as corpus


DATASET_ID = "opencup-progetti-bulk"
SOURCE_URL = "https://www.opencup.gov.it/portale/web/opencup/accesso-agli-open-data"
OFFICIAL_HOST = "www.opencup.gov.it"
OFFICIAL_URL_PATHS = {
    "landingUrl": "/portale/web/opencup/accesso-agli-open-data",
    "initialUrl": "/portale/documents/21195/299152/OpendataProgetti.zip/",
    "finalUrl": "/portale/documents/21195/299152/OpendataProgetti.zip/",
    "licenseUrl": "/portale/web/opencup/licenza-cc-by",
    "metadata.url": "/portale/documents/21195/0/Metadati.xlsx/",
}
SYNTHETIC_SPEC_PATH = Path(__file__).with_name("specs") / "opencup-projects.synthetic.json"
OFFICIAL_SPEC_PATH = Path(__file__).with_name("specs") / "opencup-projects.source.json"
CUP_RE = re.compile(r"^[A-Z0-9]{15}$")
INTEGER_EUR_RE = re.compile(r"^[0-9]+$")
MEMBER_RE = re.compile(r"^OpenCup_Progetti[0-9]+\.csv$")

PRIVATE_FIELDS = {
    "PIVA_CODFISCALE_SOG_TITOLARE",
    "PIVA_CF_BENEFICIARIO",
}
MAX_CHUNK_ROWS = 1_000
MAX_CHUNK_RAW_BYTES = 2 * 1024 * 1024
MAX_INDEX_NODE_RAW_BYTES = 1024 * 1024
MAX_INDEX_CHILDREN = 256
MAX_INDEX_DEPTH = 4
MAX_POSTING_REFS = 1_000
INLINE_POSTING_REFS = 64
MAX_CHUNK_GROUP_CHUNKS = 256
INDEX_SCHEMA_VERSION = 2
MAX_POSTING_TREE_DEPTH = 4


class SourceError(ValueError):
    """The source archive or a projected row violates the OpenCUP contract."""


def synthetic_contract() -> dict[str, object]:
    """Load the versioned, bounded contract used only by synthetic tests."""

    try:
        value = json.loads(SYNTHETIC_SPEC_PATH.read_text(encoding="utf-8"))
    except (OSError, UnicodeError, json.JSONDecodeError) as error:
        raise SourceError("Source spec sintetica OpenCUP illeggibile") from error
    if not isinstance(value, dict):
        raise SourceError("Source spec sintetica OpenCUP non è un oggetto")
    _validate_contract(value)
    return value


def official_contract() -> dict[str, object]:
    """Load and validate the locked official source contract."""

    try:
        value = json.loads(OFFICIAL_SPEC_PATH.read_text(encoding="utf-8"))
    except (OSError, UnicodeError, json.JSONDecodeError) as error:
        raise SourceError("Source lock ufficiale OpenCUP illeggibile") from error
    if not isinstance(value, dict):
        raise SourceError("Source lock ufficiale OpenCUP non è un oggetto")
    _validate_contract(value)
    return value


def _is_official_contract(contract: dict[str, object]) -> bool:
    return contract.get("fixtureOnly") is False and "csv" in contract


def _source_headers(contract: dict[str, object]) -> list[str]:
    if _is_official_contract(contract):
        csv_contract = contract.get("csv")
        if not isinstance(csv_contract, dict) or not isinstance(csv_contract.get("headers"), list):
            raise SourceError("Header CSV OpenCUP mancanti nel source lock")
        return [str(header) for header in csv_contract["headers"]]
    return official_contract()["csv"]["headers"]


def _public_headers(contract: dict[str, object]) -> list[str]:
    if _is_official_contract(contract):
        headers = contract.get("publicHeaders")
        if not isinstance(headers, list):
            raise SourceError("Header pubblici OpenCUP mancanti nel source lock")
        return [str(header) for header in headers]
    return official_contract()["publicHeaders"]


def _redacted_fields(contract: dict[str, object]) -> set[str]:
    if _is_official_contract(contract):
        mapping = contract.get("fieldMapping")
        if not isinstance(mapping, dict):
            raise SourceError("Mapping OpenCUP mancante nel source lock")
        return {
            str(field)
            for field, value in mapping.items()
            if isinstance(value, dict) and value.get("disposition") == "redacted"
        }
    return PRIVATE_FIELDS


def _source_url(contract: dict[str, object]) -> str:
    if _is_official_contract(contract):
        value = contract.get("finalUrl")
        if not isinstance(value, str):
            raise SourceError("URL finale OpenCUP mancante nel source lock")
        return value
    return SOURCE_URL


def _validate_contract(contract: dict[str, object]) -> None:
    if _is_official_contract(contract):
        _validate_official_contract(contract)
        return
    if set(contract) != {
        "schemaVersion",
        "dataKind",
        "datasetId",
        "delimiter",
        "encoding",
        "evidenceLabel",
        "maxMembers",
        "maxMemberBytes",
        "maxTotalBytes",
        "moneyFormat",
        "moneyUnit",
        "sourceUrls",
        "licenseStatus",
        "observedAt",
        "publishedAt",
        "fixtureOnly",
    }:
        raise SourceError("Schema contratto OpenCUP divergente")
    if (
        contract["schemaVersion"] != 1
        or contract["dataKind"] != "opencup-projects"
        or contract["datasetId"] != DATASET_ID
        or contract["delimiter"] != ";"
        or contract["encoding"] != "utf-8"
        or contract["evidenceLabel"] != "synthetic-fixture"
        or contract["fixtureOnly"] is not True
        or contract["licenseStatus"] != "unverified"
        or contract["observedAt"] is not None
        or contract["publishedAt"] is not None
        or contract["moneyFormat"] != "integer-eur-exact-v1"
        or contract["moneyUnit"] != "EUR"
    ):
        raise SourceError("Contratto OpenCUP non autorizzato per la fixture")
    for key in ("maxMembers", "maxMemberBytes", "maxTotalBytes"):
        value = contract[key]
        if isinstance(value, bool) or not isinstance(value, int) or value <= 0:
            raise SourceError(f"Limite OpenCUP non valido: {key}")
    urls = contract["sourceUrls"]
    if urls != [SOURCE_URL]:
        raise SourceError("Provenienza OpenCUP divergente")


def _is_allowed_official_url(value: str, path: str) -> bool:
    try:
        parsed = urlsplit(value)
        parsed_port = parsed.port
    except ValueError:
        return False
    path_matches = parsed.path == path if not path.endswith("/") else parsed.path.startswith(path)
    return (
        parsed.scheme == "https"
        and parsed.netloc == OFFICIAL_HOST
        and parsed.hostname == OFFICIAL_HOST
        and parsed.username is None
        and parsed.password is None
        and parsed_port is None
        and not parsed.fragment
        and path_matches
    )


def _validate_official_contract(contract: dict[str, object]) -> None:
    expected_keys = {
        "schemaVersion", "dataKind", "datasetId", "fixtureOnly", "evidenceLabel",
        "holder", "landingUrl", "initialUrl", "finalUrl", "licenseUrl", "licenseStatus",
        "referenceDate", "publicationDate", "lastModified", "observedAt", "acquiredAt",
        "contentType", "contentDisposition", "sourceBytes", "sourceSha256", "metadata",
        "archive", "csv", "observedProfile", "publicHeaders", "fieldMapping",
        "geography", "caveats",
    }
    if set(contract) != expected_keys:
        raise SourceError("Schema source lock ufficiale OpenCUP divergente")
    if (
        contract["schemaVersion"] != 1
        or contract["dataKind"] != "opencup-projects"
        or contract["datasetId"] != DATASET_ID
        or contract["fixtureOnly"] is not False
        or contract["evidenceLabel"] != "documented-fact"
        or contract["licenseStatus"] != "CC-BY-4.0"
        or contract["contentType"] != "application/zip"
    ):
        raise SourceError("Source lock ufficiale OpenCUP non autorizzato")
    if not isinstance(contract["holder"], str) or not contract["holder"]:
        raise SourceError("Titolare source lock OpenCUP mancante")
    for key in ("landingUrl", "initialUrl", "finalUrl", "licenseUrl"):
        value = contract[key]
        if not isinstance(value, str) or not _is_allowed_official_url(
            value, OFFICIAL_URL_PATHS[key]
        ):
            raise SourceError(f"URL source lock OpenCUP non valido: {key}")
    for key in ("sourceSha256",):
        if not isinstance(contract[key], str) or not re.fullmatch(r"[0-9a-f]{64}", contract[key]):
            raise SourceError(f"Digest source lock OpenCUP non valido: {key}")
    if (
        isinstance(contract["sourceBytes"], bool)
        or not isinstance(contract["sourceBytes"], int)
        or contract["sourceBytes"] <= 0
    ):
        raise SourceError("Byte source lock OpenCUP non validi")
    try:
        parsed_dates = {
            key: datetime.fromisoformat(str(contract[key]).replace("Z", "+00:00"))
            for key in ("lastModified", "observedAt", "acquiredAt")
        }
    except ValueError as error:
        raise SourceError("Date source lock OpenCUP non valide") from error
    if any(value.tzinfo is None for value in parsed_dates.values()):
        raise SourceError("Date source lock OpenCUP prive di timezone")
    if contract["publicationDate"] is not None:
        raise SourceError("Publication date source lock OpenCUP non autorizzata")
    if not isinstance(contract["referenceDate"], str) or not re.fullmatch(
        r"\d{4}-\d{2}-\d{2}", contract["referenceDate"]
    ):
        raise SourceError("Data riferimento source lock OpenCUP non valida")
    try:
        datetime.strptime(contract["referenceDate"], "%Y-%m-%d")
    except ValueError as error:
        raise SourceError("Data riferimento source lock OpenCUP non valida") from error
    if contract["contentDisposition"] != 'attachment; filename="OpendataProgetti.zip"':
        raise SourceError("Content-Disposition source lock OpenCUP divergente")

    metadata = contract["metadata"]
    if not isinstance(metadata, dict) or set(metadata) != {"url", "bytes", "sha256", "lastModified"}:
        raise SourceError("Metadati source lock OpenCUP divergenti")
    if not isinstance(metadata["url"], str) or not _is_allowed_official_url(
        metadata["url"], OFFICIAL_URL_PATHS["metadata.url"]
    ):
        raise SourceError("URL metadati source lock OpenCUP non valido")
    if (
        isinstance(metadata["bytes"], bool)
        or not isinstance(metadata["bytes"], int)
        or metadata["bytes"] <= 0
        or not isinstance(metadata["sha256"], str)
        or not re.fullmatch(r"[0-9a-f]{64}", metadata["sha256"])
    ):
        raise SourceError("Digest o byte metadati source lock OpenCUP non validi")
    try:
        metadata_date = datetime.fromisoformat(str(metadata["lastModified"]).replace("Z", "+00:00"))
    except ValueError as error:
        raise SourceError("Data metadati source lock OpenCUP non valida") from error
    if metadata_date.tzinfo is None:
        raise SourceError("Data metadati source lock OpenCUP priva di timezone")

    archive = contract["archive"]
    if not isinstance(archive, dict) or set(archive) != {
        "compression", "totalRawBytes", "expectedRows", "expectedDistinctCups", "members"
    }:
        raise SourceError("Archivio source lock OpenCUP divergente")
    members = archive["members"]
    if archive["compression"] != "zip-deflate" or not isinstance(members, list) or not members:
        raise SourceError("Membri source lock OpenCUP mancanti")
    if len({member.get("name") for member in members if isinstance(member, dict)}) != len(members):
        raise SourceError("Membri source lock OpenCUP duplicati")
    member_names = []
    raw_sum = 0
    for member in members:
        if not isinstance(member, dict) or set(member) != {
            "name", "compressedBytes", "rawBytes", "crc32", "flagBits",
            "rows", "physicalLines", "quotedNewlineDelta",
        }:
            raise SourceError("Descrittore membro source lock OpenCUP divergente")
        if not isinstance(member["name"], str) or not MEMBER_RE.fullmatch(member["name"]):
            raise SourceError("Nome membro source lock OpenCUP non valido")
        for key in ("compressedBytes", "rawBytes", "flagBits"):
            if isinstance(member[key], bool) or not isinstance(member[key], int) or member[key] < 0:
                raise SourceError(f"Limite membro source lock OpenCUP non valido: {key}")
        for key in ("rows", "physicalLines", "quotedNewlineDelta"):
            if isinstance(member[key], bool) or not isinstance(member[key], int) or member[key] < 0:
                raise SourceError(f"Profilo membro source lock OpenCUP non valido: {key}")
        if not isinstance(member["crc32"], str) or not re.fullmatch(r"[0-9a-f]{8}", member["crc32"]):
            raise SourceError("CRC membro source lock OpenCUP non valido")
        raw_sum += member["rawBytes"]
        member_names.append(member["name"])
    for key in ("totalRawBytes", "expectedRows", "expectedDistinctCups"):
        value = archive[key]
        if isinstance(value, bool) or not isinstance(value, int) or value < 0:
            raise SourceError(f"Limite archivio source lock OpenCUP non valido: {key}")
    rows_sum = sum(member["rows"] for member in members)
    if any(member["physicalLines"] != member["rows"] + member["quotedNewlineDelta"] + 1 for member in members):
        raise SourceError("Linee fisiche source lock OpenCUP divergenti")
    if (
        archive["totalRawBytes"] != raw_sum
        or member_names != sorted(member_names)
        or archive["expectedRows"] != rows_sum
    ):
        raise SourceError("Totale membri source lock OpenCUP divergente")

    csv_contract = contract["csv"]
    if not isinstance(csv_contract, dict) or set(csv_contract) != {
        "encoding", "bom", "delimiter", "quotechar", "doublequote", "escapechar",
        "lineTerminator", "nullRule", "moneyFormat", "moneyUnit", "dateFormat",
        "headerSha256", "headers",
    }:
        raise SourceError("Contratto CSV source lock OpenCUP divergente")
    source_headers = csv_contract["headers"]
    if (
        csv_contract["encoding"] != "utf-8"
        or csv_contract["bom"] is not False
        or csv_contract["delimiter"] != ";"
        or csv_contract["quotechar"] != '"'
        or csv_contract["doublequote"] is not True
        or csv_contract["escapechar"] is not None
        or csv_contract["lineTerminator"] != "LF"
        or csv_contract["nullRule"] != "empty-string-only"
        or csv_contract["moneyFormat"] != "integer-eur-exact-v1"
        or csv_contract["moneyUnit"] != "EUR"
        or csv_contract["dateFormat"] != "DD-MON-YYYY"
        or not isinstance(csv_contract["headerSha256"], str)
        or not re.fullmatch(r"[0-9a-f]{64}", csv_contract["headerSha256"])
        or not isinstance(source_headers, list)
        or len(source_headers) != 62
        or len(set(source_headers)) != 62
        or any(not isinstance(header, str) or not header for header in source_headers)
    ):
        raise SourceError("Dialetto o header CSV source lock OpenCUP non autorizzato")
    expected_header_sha = hashlib.sha256((";".join(source_headers) + "\n").encode("utf-8")).hexdigest()
    if csv_contract["headerSha256"] != expected_header_sha:
        raise SourceError("Digest header CSV source lock OpenCUP divergente")
    profile = contract["observedProfile"]
    if not isinstance(profile, dict) or set(profile) != {
        "probeSeconds", "maximumResidentSetBytes", "totalRows", "distinctCups",
        "duplicateCups", "emptyCups", "invalidCups", "maxCupOccurrences",
        "nonAsciiCells", "states", "literalNullLikeTokens", "publicSanitization", "note",
    }:
        raise SourceError("Profilo osservato source lock OpenCUP divergente")
    for key in (
        "probeSeconds", "maximumResidentSetBytes", "totalRows", "distinctCups",
        "duplicateCups", "emptyCups", "invalidCups", "maxCupOccurrences", "nonAsciiCells",
    ):
        value = profile[key]
        if isinstance(value, bool) or not isinstance(value, (int, float)) or value < 0:
            raise SourceError(f"Profilo osservato source lock OpenCUP non valido: {key}")
    if not isinstance(profile["states"], dict) or not profile["states"]:
        raise SourceError("Stati osservati source lock OpenCUP mancanti")
    if any(
        not isinstance(key, str)
        or not isinstance(value, int)
        or isinstance(value, bool)
        or value < 0
        for key, value in profile["states"].items()
    ):
        raise SourceError("Stati osservati source lock OpenCUP non validi")
    if not isinstance(profile["literalNullLikeTokens"], dict) or any(
        not isinstance(key, str)
        or not isinstance(value, int)
        or isinstance(value, bool)
        or value < 0
        for key, value in profile["literalNullLikeTokens"].items()
    ):
        raise SourceError("Token null-like source lock OpenCUP non validi")
    public_sanitization = profile["publicSanitization"]
    if (
        not isinstance(public_sanitization, dict)
        or set(public_sanitization) != {"field", "affectedRows", "changedRows", "reasons"}
        or public_sanitization["field"] != "DESCRIZIONE_SINTETICA_CUP"
        or not isinstance(public_sanitization["affectedRows"], int)
        or isinstance(public_sanitization["affectedRows"], bool)
        or not isinstance(public_sanitization["changedRows"], int)
        or isinstance(public_sanitization["changedRows"], bool)
        or public_sanitization["affectedRows"] != public_sanitization["changedRows"]
        or public_sanitization["changedRows"] < 0
        or not isinstance(public_sanitization["reasons"], dict)
        or any(
            reason not in {"credential", "internal-path", "unsafe-url"}
            or not isinstance(count, int)
            or isinstance(count, bool)
            or count < 0
            for reason, count in public_sanitization["reasons"].items()
        )
        or sum(public_sanitization["reasons"].values()) != public_sanitization["affectedRows"]
    ):
        raise SourceError("Profilo sanitizzazione pubblica source lock OpenCUP divergente")
    if not isinstance(profile["note"], str) or not profile["note"]:
        raise SourceError("Nota profilo source lock OpenCUP mancante")
    if (
        profile["totalRows"] != archive["expectedRows"]
        or profile["distinctCups"] != archive["expectedDistinctCups"]
        or profile["distinctCups"] + profile["duplicateCups"] != profile["totalRows"]
        or sum(profile["states"].values()) != profile["totalRows"]
        or profile["maxCupOccurrences"] < 1
        or profile["emptyCups"] + profile["invalidCups"] > profile["totalRows"]
    ):
        raise SourceError("Riconciliazione profilo source lock OpenCUP divergente")

    public_headers = contract["publicHeaders"]
    if (
        not isinstance(public_headers, list)
        or len(public_headers) != 24
        or len(set(public_headers)) != 24
        or any(header not in source_headers for header in public_headers)
    ):
        raise SourceError("Header pubblici source lock OpenCUP divergenti")
    mapping = contract["fieldMapping"]
    if not isinstance(mapping, dict) or set(mapping) != set(source_headers):
        raise SourceError("Mapping source lock OpenCUP divergente")
    allowed_transforms = {
        "uppercase-ascii-exact-15",
        "trim-none-preserve",
        "preserve-newline-tab-replace-other-c0",
        "preserve-newline-tab-replace-other-c0-sanitize-public-cell",
        "four-digit-year-string",
        "observed-code-string",
        "validate-integer-eur-preserve-string",
        "preserve-leading-zeroes",
        "preserve",
        "validate-DD-MON-YYYY-preserve-string",
    }
    for field, value in mapping.items():
        if not isinstance(value, dict) or not isinstance(value.get("dictionaryField"), str):
            raise SourceError(f"Mapping source lock OpenCUP non valido per {field}")
        disposition = value.get("disposition")
        if disposition == "public":
            if set(value) != {"dictionaryField", "disposition", "transform", "nullRule"}:
                raise SourceError(f"Mapping source lock OpenCUP divergente per {field}")
            if value["transform"] not in allowed_transforms or value["nullRule"] != (
                "forbidden" if field == "CUP" else "empty-to-null"
            ):
                raise SourceError(f"Trasformazione source lock OpenCUP non autorizzata per {field}")
        elif disposition == "redacted":
            if set(value) != {
                "dictionaryField", "disposition", "transform", "redactionReason", "nullRule"
            }:
                raise SourceError(f"Mapping source lock OpenCUP divergente per {field}")
        elif disposition == "excluded":
            if set(value) != {"dictionaryField", "disposition", "reason"} or not value["reason"]:
                raise SourceError(f"Campo escluso source lock OpenCUP non motivato: {field}")
        else:
            raise SourceError(f"Disposition source lock OpenCUP non autorizzata per {field}")
    redacted = {
        field for field, value in mapping.items()
        if isinstance(value, dict) and value.get("disposition") == "redacted"
    }
    if any(
        not isinstance(value, dict)
        or value.get("transform") != "null"
        or value.get("nullRule") != "always-null-redacted"
        or value.get("redactionReason") != "personal-identifier"
        for field, value in mapping.items()
        if field in redacted
    ):
        raise SourceError("Null redaction source lock OpenCUP divergente")
    excluded = {
        field for field, value in mapping.items()
        if isinstance(value, dict) and value.get("disposition") == "excluded"
    }
    if redacted != PRIVATE_FIELDS or any(field not in public_headers for field in redacted):
        raise SourceError("Redazioni source lock OpenCUP divergenti")
    if any(field in public_headers for field in excluded):
        raise SourceError("Campo escluso presente negli header pubblici OpenCUP")
    if set(public_headers) != {
        field for field, value in mapping.items()
        if isinstance(value, dict) and value.get("disposition") in {"public", "redacted"}
    }:
        raise SourceError("Proiezione pubblica source lock OpenCUP divergente")
    geography = contract["geography"]
    if (
        not isinstance(geography, dict)
        or set(geography) != {"status", "note"}
        or geography["status"] != "not-present-in-projects-release"
        or not isinstance(geography["note"], str)
        or not geography["note"]
    ):
        raise SourceError("Geografia source lock OpenCUP divergente")
    caveats = contract["caveats"]
    if not isinstance(caveats, list) or not caveats or any(
        not isinstance(caveat, str) or not caveat for caveat in caveats
    ):
        raise SourceError("Caveat source lock OpenCUP mancanti")


def _member_infos(archive: zipfile.ZipFile, contract: dict[str, object]) -> list[zipfile.ZipInfo]:
    infos = archive.infolist()
    if _is_official_contract(contract):
        archive_contract = contract["archive"]
        if not isinstance(archive_contract, dict):
            raise SourceError("Archivio source lock OpenCUP mancante")
        expected_members = archive_contract["members"]
        if not isinstance(expected_members, list) or len(infos) != len(expected_members):
            raise SourceError("Numero membri ZIP OpenCUP divergente dal source lock")
        expected_by_name = {member["name"]: member for member in expected_members}
        actual_names = [info.filename for info in infos]
        if len(set(actual_names)) != len(actual_names) or set(actual_names) != set(expected_by_name):
            raise SourceError("Membri ZIP OpenCUP divergenti dal source lock")
        for info in infos:
            expected = expected_by_name[info.filename]
            if (
                info.is_dir()
                or info.compress_type != zipfile.ZIP_DEFLATED
                or info.file_size != expected["rawBytes"]
                or info.compress_size != expected["compressedBytes"]
                or f"{info.CRC:08x}" != expected["crc32"]
                or info.flag_bits != expected["flagBits"]
            ):
                raise SourceError("Membro ZIP OpenCUP non conforme al source lock")
        return sorted(infos, key=lambda info: info.filename)
    if not infos or len(infos) > contract["maxMembers"]:
        raise SourceError("Numero membri ZIP OpenCUP fuori contratto")
    names = [info.filename for info in infos]
    if len(set(names)) != len(names):
        raise SourceError("Membri ZIP OpenCUP duplicati")
    for info in infos:
        path = PurePosixPath(info.filename)
        if (
            info.is_dir()
            or path.is_absolute()
            or ".." in path.parts
            or "\\" in info.filename
            or not MEMBER_RE.fullmatch(info.filename)
        ):
            raise SourceError("Membro ZIP OpenCUP inatteso o non sicuro")
        if info.flag_bits & 0x1:
            raise SourceError("Archivio OpenCUP cifrato")
        if info.compress_type not in {zipfile.ZIP_STORED, zipfile.ZIP_DEFLATED}:
            raise SourceError("Compressione ZIP OpenCUP non supportata")
        if info.file_size <= 0 or info.file_size > contract["maxMemberBytes"]:
            raise SourceError("Dimensione membro OpenCUP fuori contratto")
    if sum(info.file_size for info in infos) > contract["maxTotalBytes"]:
        raise SourceError("Dimensione decompressa OpenCUP fuori contratto")
    return sorted(infos, key=lambda info: info.filename)


def _verify_locked_archive(archive_path: Path, contract: dict[str, object]) -> None:
    if not _is_official_contract(contract):
        return
    try:
        byte_count, digest = _sha256_file(archive_path)
    except OSError as error:
        raise SourceError("Archivio OpenCUP illeggibile") from error
    if byte_count != contract["sourceBytes"] or digest != contract["sourceSha256"]:
        raise SourceError("Hash o byte ZIP OpenCUP divergenti dal source lock")


def _validate_official_date(value: str) -> str:
    if not re.fullmatch(r"[0-9]{2}-[A-Z]{3}-[0-9]{4}", value):
        raise SourceError("Data OpenCUP fuori contratto")
    try:
        datetime.strptime(value, "%d-%b-%Y")
    except ValueError as error:
        raise SourceError("Data OpenCUP fuori contratto") from error
    return value


def parse_euro_integer(value: str) -> int | None:
    """Parse the official integer-EUR amount exactly, without float."""

    if value == "":
        return None
    if INTEGER_EUR_RE.fullmatch(value) is None:
        raise SourceError("Importo OpenCUP fuori contratto")
    return int(value)


def _official_cell(
    field: str,
    value: str,
    mapping: dict[str, object],
    source_row: int,
    allowed_states: set[str] | None = None,
) -> str | None:
    disposition = mapping.get("disposition")
    if disposition == "redacted":
        return None
    if disposition != "public":
        raise SourceError(f"Campo OpenCUP non proiettabile: {field}")
    transform = mapping.get("transform")
    if value == "":
        if mapping.get("nullRule") == "forbidden":
            raise SourceError(f"Campo OpenCUP obbligatorio vuoto alla registrazione {source_row}")
        return None
    if transform == "uppercase-ascii-exact-15":
        normalized = value.upper()
        if not CUP_RE.fullmatch(normalized):
            raise SourceError(f"CUP OpenCUP non valido alla registrazione {source_row}")
        return normalized
    if transform == "four-digit-year-string":
        if re.fullmatch(r"[0-9]{4}", value) is None or int(value) == 0:
            raise SourceError(f"Anno OpenCUP non valido alla registrazione {source_row}")
        return value
    if transform == "validate-integer-eur-preserve-string":
        parse_euro_integer(value)
        return value
    if transform == "validate-DD-MON-YYYY-preserve-string":
        return _validate_official_date(value)
    if transform in {
        "preserve-newline-tab-replace-other-c0",
        "preserve-newline-tab-replace-other-c0-sanitize-public-cell",
    }:
        return "".join(
            character
            if ord(character) >= 0x20 or character in {"\n", "\t"}
            else "\ufffd"
            for character in value
        )
    if transform == "trim-none-preserve":
        if any(ord(character) < 0x20 for character in value):
            raise SourceError(f"Valore OpenCUP non valido alla registrazione {source_row}")
        return value
    if transform in {"preserve", "preserve-leading-zeroes", "observed-code-string"}:
        if any(ord(character) < 0x20 for character in value):
            raise SourceError(f"Valore OpenCUP non valido alla registrazione {source_row}")
        if transform == "observed-code-string" and (
            allowed_states is None or value not in allowed_states
        ):
            raise SourceError(f"Stato OpenCUP non osservato alla registrazione {source_row}")
        return value
    raise SourceError(f"Trasformazione OpenCUP non autorizzata: {field}")


def _public_row_official(values: dict[str, str], source_row: int, contract: dict[str, object]) -> dict[str, object]:
    public_headers = _public_headers(contract)
    mapping = contract["fieldMapping"]
    if not isinstance(mapping, dict):
        raise SourceError("Mapping OpenCUP mancante")
    profile = contract.get("observedProfile")
    allowed_states = (
        set(profile["states"])
        if isinstance(profile, dict) and isinstance(profile.get("states"), dict)
        else None
    )
    cells: dict[str, str | None] = {}
    redactions: list[dict[str, str]] = []
    for field in public_headers:
        field_mapping = mapping.get(field)
        if not isinstance(field_mapping, dict):
            raise SourceError(f"Mapping OpenCUP mancante per {field}")
        cell = _official_cell(
            field,
            values[field],
            field_mapping,
            source_row,
            allowed_states,
        )
        if (
            field_mapping.get("transform")
            == "preserve-newline-tab-replace-other-c0-sanitize-public-cell"
            and isinstance(cell, str)
        ):
            cell, reasons = corpus.sanitize_public_cell(field, cell, set())
            redactions.extend({"field": field, "reason": reason} for reason in reasons)
        if field_mapping.get("disposition") == "redacted":
            cells[field] = None
            redactions.append({"field": field, "reason": "personal-identifier"})
        else:
            cells[field] = cell
    public_digest = corpus.sha256_bytes(corpus.canonical_json(cells))
    row_id = "row-" + corpus.sha256_bytes(
        f"{DATASET_ID}:{source_row}:{public_digest}".encode("utf-8")
    )[:24]
    return {
        "id": row_id,
        "cells": cells,
        "evidenceLabel": contract["evidenceLabel"],
        "redactions": redactions,
        "sourceRow": source_row,
        "sourceRowSha256": public_digest,
        "sourceUrls": [] if contract["evidenceLabel"] == "synthetic-fixture" else [_source_url(contract)],
    }


def _project_records(
    archive_path: Path,
    contract: dict[str, object],
) -> Iterator[tuple[dict[str, object], zipfile.ZipInfo, int]]:
    """Yield public rows with their private member/record provenance."""

    _validate_contract(contract)
    _verify_locked_archive(archive_path, contract)
    source_headers = _source_headers(contract)
    projection_contract = contract if _is_official_contract(contract) else {
        **official_contract(), "evidenceLabel": "synthetic-fixture",
    }
    csv_contract = contract.get("csv") if _is_official_contract(contract) else contract
    try:
        with zipfile.ZipFile(archive_path) as archive:
            infos = _member_infos(archive, contract)
            source_row = 0
            for info in infos:
                with archive.open(info) as binary:
                    with io.TextIOWrapper(
                        binary,
                        encoding=str(csv_contract["encoding"]),
                        newline="",
                    ) as text:
                        reader = csv.DictReader(
                            text,
                            delimiter=str(csv_contract["delimiter"]),
                            quotechar=str(csv_contract.get("quotechar", '"')),
                            doublequote=bool(csv_contract.get("doublequote", True)),
                            escapechar=csv_contract.get("escapechar"),
                            strict=True,
                        )
                        if reader.fieldnames != source_headers:
                            raise SourceError(f"Header OpenCUP divergente in {info.filename}")
                        member_record = 0
                        for values in reader:
                            source_row += 1
                            member_record += 1
                            if None in values or any(value is None for value in values.values()):
                                raise SourceError(
                                    f"Riga OpenCUP troncata o eccedente alla registrazione {source_row}"
                                )
                            yield (
                                _public_row_official(
                                    values,
                                    source_row,
                                    projection_contract,
                                ),
                                info,
                                member_record,
                            )
    except SourceError:
        raise
    except (OSError, UnicodeError, csv.Error, zipfile.BadZipFile) as error:
        raise SourceError("Archivio OpenCUP illeggibile o corrotto") from error


def project_archive(
    archive_path: Path,
    contract: dict[str, object],
) -> Iterator[dict[str, object]]:
    """Yield public rows in member/record order while keeping the ZIP on disk."""

    for row, _member, _member_record in _project_records(archive_path, contract):
        yield row


def _sha256_file(path: Path) -> tuple[int, str]:
    digest = hashlib.sha256()
    size = 0
    with path.open("rb") as handle:
        for block in iter(lambda: handle.read(1024 * 1024), b""):
            size += len(block)
            digest.update(block)
    return size, digest.hexdigest()


def _write_object(output: Path, raw: bytes, *, compressed: bool) -> dict[str, object]:
    if not raw or len(raw) > (MAX_CHUNK_RAW_BYTES if compressed else MAX_INDEX_NODE_RAW_BYTES):
        raise SourceError("Oggetto OpenCUP vuoto o oltre il budget raw")
    payload = corpus.canonical_gzip(raw) if compressed else raw
    digest = corpus.sha256_bytes(payload)
    key = f"sha256/{digest}"
    corpus.write_bytes(output / key, payload)
    return {
        "sha256": digest,
        "bytes": len(payload),
        "rawBytes": len(raw),
        "format": "jsonl-gzip-v1" if compressed else "json-v1",
        "key": key,
    }


@dataclass(frozen=True)
class _NodeRange:
    minimum: str
    maximum: str
    descriptor: dict[str, object]
    depth: int


def _posting_directory_node(output: Path, children: list[_NodeRange]) -> _NodeRange:
    raw = corpus.canonical_json(
        {
            "children": [
                {
                    "end": int(child.maximum),
                    "node": child.descriptor,
                    "start": int(child.minimum),
                }
                for child in children
            ],
            "kind": "posting-directory",
            "schemaVersion": INDEX_SCHEMA_VERSION,
        }
    )
    descriptor = _write_object(output, raw, compressed=False)
    depth = children[0].depth + 1
    if depth > MAX_POSTING_TREE_DEPTH:
        raise SourceError("Profondità posting OpenCUP oltre il contratto")
    return _NodeRange(children[0].minimum, children[-1].maximum, descriptor, depth)


def _assemble_directory_levels(
    output: Path,
    connection: sqlite3.Connection,
    table: Literal["index_nodes", "posting_nodes"],
    child_count: int,
    directory_node: Callable[[Path, list[_NodeRange]], _NodeRange],
) -> _NodeRange:
    """Assemble either tree with at most one directory of descriptors in RAM."""

    if table not in {"index_nodes", "posting_nodes"}:
        raise SourceError("Tabella nodi OpenCUP non valida")
    depth = 1

    def children_at_depth():
        return connection.execute(
            f"SELECT minimum, maximum, descriptor FROM {table} WHERE depth = ? ORDER BY ordinal",
            (depth,),
        )

    def nodes(rows) -> list[_NodeRange]:
        return [
            _NodeRange(str(minimum), str(maximum), json.loads(payload), depth)
            for minimum, maximum, payload in rows
        ]

    while child_count > MAX_INDEX_CHILDREN:
        cursor = children_at_depth()
        next_ordinal = 0
        connection.execute(f"DELETE FROM {table} WHERE depth = ?", (depth + 1,))
        while rows := cursor.fetchmany(MAX_INDEX_CHILDREN):
            node = directory_node(output, nodes(rows))
            connection.execute(
                f"INSERT INTO {table} VALUES (?, ?, ?, ?, ?)",
                (
                    depth + 1, next_ordinal, node.minimum, node.maximum,
                    json.dumps(node.descriptor, sort_keys=True, separators=(",", ":")),
                ),
            )
            next_ordinal += 1
        depth += 1
        child_count = next_ordinal
    return directory_node(output, nodes(children_at_depth()))


def _build_posting_tree(
    output: Path,
    cup: str,
    connection: sqlite3.Connection,
    matched_rows: int,
    staging: Path,
) -> dict[str, object]:
    """Build a random-access posting tree without retaining all refs in RAM.

    Pages are staged one at a time, then materialised in reverse order so an
    optional ``next`` descriptor points only to the adjacent page.  Page and
    directory descriptors are kept in SQLite while the bounded tree levels
    are assembled, never in an all-pages Python list.
    """

    if matched_rows <= INLINE_POSTING_REFS:
        raise SourceError("Posting list OpenCUP non abbastanza grande")
    connection.execute(
        """
        CREATE TABLE IF NOT EXISTS posting_nodes (
            depth INTEGER NOT NULL,
            ordinal INTEGER NOT NULL,
            minimum TEXT NOT NULL,
            maximum TEXT NOT NULL,
            descriptor TEXT NOT NULL,
            PRIMARY KEY (depth, ordinal)
        )
        """
    )
    connection.execute("DELETE FROM posting_nodes")
    page_count = 0
    last_source_row = 0
    page_start = 0
    while True:
        page = list(
            connection.execute(
                """
                SELECT source_row, chunk_ordinal
                FROM refs
                WHERE cup = ? AND source_row > ?
                ORDER BY source_row
                LIMIT ?
                """,
                (cup, last_source_row, MAX_POSTING_REFS),
            )
        )
        if not page:
            break
        raw = corpus.canonical_json(
            {
                "cup": cup,
                "kind": "postings",
                "refs": [
                    {"chunkOrdinal": chunk_ordinal, "sourceRow": source_row}
                    for source_row, chunk_ordinal in page
                ],
                "schemaVersion": INDEX_SCHEMA_VERSION,
                "start": page_start,
            }
        )
        corpus.write_bytes(staging / f"{cup}-{page_count:08d}.json", raw)
        page_count += 1
        last_source_row = int(page[-1][0])
        page_start += len(page)
        if len(page) < MAX_POSTING_REFS:
            break

    if page_count == 0 or last_source_row == 0:
        raise SourceError("Posting list OpenCUP vuota")
    next_page: dict[str, object] | None = None
    for page_ordinal in range(page_count - 1, -1, -1):
        page_path = staging / f"{cup}-{page_ordinal:08d}.json"
        page = json.loads(page_path.read_text(encoding="utf-8"))
        if next_page is not None:
            page["next"] = next_page
        next_page = _write_object(
            output,
            corpus.canonical_json(page),
            compressed=False,
        )
        page_start = int(page["start"])
        page_end = page_start + len(page["refs"])
        connection.execute(
            "INSERT INTO posting_nodes VALUES (?, ?, ?, ?, ?)",
            (
                1,
                page_ordinal,
                page_start,
                page_end,
                json.dumps(next_page, sort_keys=True, separators=(",", ":")),
            ),
        )
        page_path.unlink()
    if next_page is None:
        raise SourceError("Posting list OpenCUP vuota")
    if page_count != (matched_rows + MAX_POSTING_REFS - 1) // MAX_POSTING_REFS:
        raise SourceError("Conteggio posting list OpenCUP divergente")

    return _assemble_directory_levels(
        output, connection, "posting_nodes", page_count, _posting_directory_node,
    ).descriptor


def _directory_node(output: Path, children: list[_NodeRange]) -> _NodeRange:
    raw = corpus.canonical_json(
        {
            "children": [
                {
                    "maxCup": child.maximum,
                    "minCup": child.minimum,
                    "node": child.descriptor,
                }
                for child in children
            ],
            "kind": "directory",
            "schemaVersion": INDEX_SCHEMA_VERSION,
        }
    )
    descriptor = _write_object(output, raw, compressed=False)
    depth = children[0].depth + 1
    if depth > MAX_INDEX_DEPTH:
        raise SourceError("Profondità indice OpenCUP oltre il contratto")
    return _NodeRange(children[0].minimum, children[-1].maximum, descriptor, depth)


def _build_index(
    output: Path,
    connection: sqlite3.Connection,
    staging: Path,
) -> tuple[dict[str, object], int, int, dict[str, object]]:
    indexed_rows = 0
    distinct_cups = 0
    connection.execute(
        """
        CREATE TABLE index_nodes (
            depth INTEGER NOT NULL,
            ordinal INTEGER NOT NULL,
            minimum TEXT NOT NULL,
            maximum TEXT NOT NULL,
            descriptor TEXT NOT NULL,
            PRIMARY KEY (depth, ordinal)
        )
        """
    )
    pending_entries: list[dict[str, object]] = []
    leaf_prefix = b'{"entries":['
    leaf_suffix = b'],"kind":"leaf","schemaVersion":' + str(INDEX_SCHEMA_VERSION).encode("ascii") + b'}\n'
    pending_leaf_size = len(leaf_prefix) + len(leaf_suffix)
    leaf_ordinal = 0

    def write_leaf() -> None:
        nonlocal leaf_ordinal, pending_leaf_size
        if not pending_entries:
            return
        raw = corpus.canonical_json(
            {
                "entries": list(pending_entries),
                "kind": "leaf",
                "schemaVersion": INDEX_SCHEMA_VERSION,
            }
        )
        descriptor = _write_object(output, raw, compressed=False)
        connection.execute(
            "INSERT INTO index_nodes VALUES (?, ?, ?, ?, ?)",
            (
                1,
                leaf_ordinal,
                str(pending_entries[0]["cup"]),
                str(pending_entries[-1]["cup"]),
                json.dumps(descriptor, sort_keys=True, separators=(",", ":")),
            ),
        )
        leaf_ordinal += 1
        pending_entries.clear()
        pending_leaf_size = len(leaf_prefix) + len(leaf_suffix)

    def emit_entry(cup: str, matched_rows: int, refs: list[dict[str, int]]) -> None:
        nonlocal indexed_rows, distinct_cups, pending_leaf_size
        if matched_rows <= INLINE_POSTING_REFS:
            entry: dict[str, object] = {
                "cup": cup,
                "matchedRows": matched_rows,
                "refs": refs,
            }
        else:
            posting_root = _build_posting_tree(
                output,
                cup,
                connection,
                matched_rows,
                staging,
            )
            entry = {
                "cup": cup,
                "matchedRows": matched_rows,
                "postingRoot": posting_root,
            }
        # The canonical leaf envelope is fixed.  Serialize only the new
        # descriptor to maintain an exact bounded-size counter; rebuilding the
        # complete candidate list here is quadratic at national CUP counts.
        entry_size = len(corpus.canonical_json(entry)) - 1  # strip final LF
        candidate_size = pending_leaf_size + (1 if pending_entries else 0) + entry_size
        if pending_entries and (
            len(pending_entries) >= MAX_INDEX_CHILDREN
            or candidate_size > MAX_INDEX_NODE_RAW_BYTES
        ):
            write_leaf()
        pending_entries.append(entry)
        pending_leaf_size += (1 if len(pending_entries) > 1 else 0) + entry_size
        indexed_rows += matched_rows
        distinct_cups += 1

    # References are read once in primary-key order and counted while they are
    # streamed.  Avoiding a GROUP BY join here matters at national scale: with
    # mostly unique CUPs it would materialise another table of nearly the same
    # cardinality.  Inline lists retain at most INLINE_POSTING_REFS entries;
    # only large lists perform the deliberate per-CUP queries used for pages.
    refs_cursor = connection.execute(
        """
        SELECT cup, source_row, chunk_ordinal
        FROM refs
        ORDER BY cup, source_row
        """
    )
    current_cup: str | None = None
    current_count = 0
    current_refs: list[dict[str, int]] = []

    def emit_current() -> None:
        nonlocal current_cup, current_count, current_refs
        if current_cup is None:
            return
        emit_entry(current_cup, current_count, current_refs)
        current_cup = None
        current_count = 0
        current_refs = []

    for cup_value, source_row, chunk_ordinal in refs_cursor:
        cup = str(cup_value)
        if current_cup != cup:
            emit_current()
            current_cup = cup
        current_count += 1
        if current_count <= INLINE_POSTING_REFS:
            current_refs.append(
                {"chunkOrdinal": int(chunk_ordinal), "sourceRow": int(source_row)}
            )
    emit_current()
    write_leaf()
    if leaf_ordinal == 0:
        raise SourceError("La fixture OpenCUP non contiene CUP indicizzabili")

    root = _assemble_directory_levels(
        output, connection, "index_nodes", leaf_ordinal, _directory_node,
    )
    canary_cup, canary_source_row = connection.execute(
        "SELECT cup, source_row FROM refs ORDER BY cup, source_row LIMIT 1"
    ).fetchone()
    return (
        root.descriptor,
        indexed_rows,
        distinct_cups,
        {"cup": canary_cup, "sourceRow": canary_source_row},
    )


def _contract_spec_path(contract: dict[str, object]) -> Path:
    return OFFICIAL_SPEC_PATH if _is_official_contract(contract) else SYNTHETIC_SPEC_PATH


def _require_locked_official_contract(contract: dict[str, object]) -> None:
    if contract != official_contract():
        raise SourceError("Contratto build ufficiale OpenCUP divergente dal source lock")


def build_release(
    archive_path: Path,
    output: Path,
    contract: dict[str, object],
    *,
    sample_rows: int | None = None,
) -> dict[str, object]:
    """Build a content-addressed release from a synthetic or locked source."""

    _validate_contract(contract)
    if sample_rows is not None and (
        isinstance(sample_rows, bool) or not isinstance(sample_rows, int) or sample_rows <= 0
    ):
        raise SourceError("sample_rows OpenCUP deve essere un intero positivo")
    if sample_rows is not None and not _is_official_contract(contract):
        raise SourceError("sample_rows OpenCUP richiede il source lock ufficiale")
    if _is_official_contract(contract) and sample_rows is None:
        _require_locked_official_contract(contract)
    if output.exists():
        if not output.is_dir() or any(output.iterdir()):
            raise SourceError("Output release OpenCUP già esistente e non vuoto")
    else:
        output.mkdir(parents=True)
    archive_bytes, archive_sha256 = _sha256_file(archive_path)
    _source_spec_bytes, source_spec_sha256 = _sha256_file(_contract_spec_path(contract))
    chunk_groups: list[dict[str, object]] = []
    pending_chunk_group: list[dict[str, object]] = []
    pending_chunk_group_rows = 0
    pending_chunk_group_size = (
        len(b'{"chunks":[')
        + len(b'],"kind":"chunk-group","schemaVersion":')
        + len(str(INDEX_SCHEMA_VERSION).encode("ascii"))
        + len(b'}\n')
    )
    completed_chunk_count = 0
    pending_rows: list[bytes] = []
    pending_bytes = 0
    pending_first_source_row = 0
    source_rows = 0
    redactions = 0
    sanitized_rows = 0
    sanitization_reasons: dict[str, int] = {}
    member_ranges: list[dict[str, object]] = []
    current_member: str | None = None
    current_member_info: zipfile.ZipInfo | None = None
    current_member_first = 0
    current_member_rows = 0

    def flush_chunk_group() -> None:
        nonlocal pending_chunk_group, pending_chunk_group_rows
        nonlocal pending_chunk_group_size, completed_chunk_count
        if not pending_chunk_group:
            return
        raw = corpus.canonical_json(
            {
                "chunks": list(pending_chunk_group),
                "kind": "chunk-group",
                "schemaVersion": INDEX_SCHEMA_VERSION,
            }
        )
        descriptor = _write_object(output, raw, compressed=False)
        first = pending_chunk_group[0]
        chunk_groups.append(
            {
                "chunkCount": len(pending_chunk_group),
                "firstOrdinal": first["ordinal"],
                "firstSourceRow": first["firstSourceRow"],
                "object": descriptor,
                "rowCount": pending_chunk_group_rows,
            }
        )
        completed_chunk_count += len(pending_chunk_group)
        pending_chunk_group = []
        pending_chunk_group_rows = 0
        pending_chunk_group_size = (
            len(b'{"chunks":[')
            + len(b'],"kind":"chunk-group","schemaVersion":')
            + len(str(INDEX_SCHEMA_VERSION).encode("ascii"))
            + len(b'}\n')
        )

    def flush_chunk() -> None:
        nonlocal pending_rows, pending_bytes, pending_first_source_row
        nonlocal pending_chunk_group_rows, pending_chunk_group_size
        if not pending_rows:
            return
        descriptor = _write_object(output, b"".join(pending_rows), compressed=True)
        chunk_descriptor = {
            **descriptor,
            "firstSourceRow": pending_first_source_row,
            "ordinal": completed_chunk_count + len(pending_chunk_group),
            "rowCount": len(pending_rows),
        }
        chunk_descriptor_size = len(corpus.canonical_json(chunk_descriptor)) - 1
        candidate_group_size = (
            pending_chunk_group_size
            + (1 if pending_chunk_group else 0)
            + chunk_descriptor_size
        )
        if pending_chunk_group and (
            len(pending_chunk_group) >= MAX_CHUNK_GROUP_CHUNKS
            or candidate_group_size > MAX_INDEX_NODE_RAW_BYTES
        ):
            flush_chunk_group()
            chunk_descriptor["ordinal"] = completed_chunk_count
            chunk_descriptor_size = len(corpus.canonical_json(chunk_descriptor)) - 1
            candidate_group_size = pending_chunk_group_size + chunk_descriptor_size
        pending_chunk_group.append(chunk_descriptor)
        pending_chunk_group_rows += len(pending_rows)
        pending_chunk_group_size = candidate_group_size
        pending_rows = []
        pending_bytes = 0
        pending_first_source_row = 0

    def flush_member() -> None:
        nonlocal current_member, current_member_info, current_member_rows
        if current_member is None or current_member_info is None:
            return
        member_ranges.append(
            {
                "bytes": current_member_info.file_size,
                "compressedBytes": current_member_info.compress_size,
                "crc32": f"{current_member_info.CRC:08x}",
                "firstSourceRow": current_member_first,
                "name": current_member,
                "rowCount": current_member_rows,
            }
        )
        current_member = None
        current_member_info = None
        current_member_rows = 0

    with tempfile.TemporaryDirectory(prefix="opencup-index-") as temporary:
        connection = sqlite3.connect(Path(temporary) / "refs.sqlite3")
        try:
            connection.execute(
                "CREATE TABLE refs (cup TEXT NOT NULL, source_row INTEGER NOT NULL, chunk_ordinal INTEGER NOT NULL, PRIMARY KEY (cup, source_row))"
            )
            for row, info, member_record in _project_records(archive_path, contract):
                if sample_rows is not None and source_rows >= sample_rows:
                    break
                if current_member != info.filename:
                    flush_member()
                    current_member = info.filename
                    current_member_info = info
                    current_member_first = source_rows + 1
                source_rows += 1
                current_member_rows = member_record
                payload = corpus.canonical_json(row)
                if len(payload) > MAX_CHUNK_RAW_BYTES:
                    raise SourceError("Riga OpenCUP oltre il budget del chunk")
                if pending_rows and (
                    len(pending_rows) >= MAX_CHUNK_ROWS
                    or pending_bytes + len(payload) > MAX_CHUNK_RAW_BYTES
                ):
                    flush_chunk()
                if not pending_rows:
                    pending_first_source_row = source_rows
                chunk_ordinal = completed_chunk_count + len(pending_chunk_group)
                pending_rows.append(payload)
                pending_bytes += len(payload)
                redactions += len(row["redactions"])
                public_redactions = [
                    item for item in row["redactions"]
                    if item["reason"] != "personal-identifier"
                ]
                if public_redactions:
                    sanitized_rows += 1
                    for item in public_redactions:
                        reason = item["reason"]
                        sanitization_reasons[reason] = sanitization_reasons.get(reason, 0) + 1
                cup = row["cells"]["CUP"]
                if cup:
                    connection.execute(
                        "INSERT INTO refs(cup, source_row, chunk_ordinal) VALUES (?, ?, ?)",
                        (cup, source_rows, chunk_ordinal),
                    )
            flush_member()
            flush_chunk()
            flush_chunk_group()
            connection.commit()
            root_index, indexed_rows, distinct_cups, canary = _build_index(
                output,
                connection,
                Path(temporary) / "posting-pages",
            )
        finally:
            connection.close()

    official = _is_official_contract(contract)
    sample_only = sample_rows is not None
    if sample_only and source_rows != sample_rows:
        raise SourceError("sample_rows OpenCUP oltre le righe disponibili")
    if official and not sample_only:
        archive_contract = contract["archive"]
        if not isinstance(archive_contract, dict):
            raise SourceError("Archivio source lock OpenCUP mancante")
        expected_members = archive_contract["members"]
        if (
            source_rows != archive_contract["expectedRows"]
            or distinct_cups != archive_contract["expectedDistinctCups"]
            or not isinstance(expected_members, list)
            or len(member_ranges) != len(expected_members)
        ):
            raise SourceError("Conteggi release OpenCUP divergenti dal source lock")
        expected_first_source_row = 1
        for actual, expected in zip(member_ranges, expected_members):
            if (
                actual["name"] != expected["name"]
                or actual["rowCount"] != expected["rows"]
                or actual["firstSourceRow"] != expected_first_source_row
            ):
                raise SourceError("Intervallo membro release OpenCUP divergente dal source lock")
            expected_first_source_row += expected["rows"]
        expected_sanitization = contract["observedProfile"]["publicSanitization"]
        if (
            sanitized_rows != expected_sanitization["affectedRows"]
            or sanitization_reasons != expected_sanitization["reasons"]
        ):
            raise SourceError("Sanitizzazione release OpenCUP divergente dal source lock")
    source_headers = _source_headers(contract)
    public_headers = _public_headers(contract)
    source_url = _source_url(contract)
    provenance = {
        "referenceDate": contract["referenceDate"] if official else None,
        "publicationDate": contract["publicationDate"] if official else None,
        "lastModified": contract["lastModified"] if official else None,
        "observedAt": contract["observedAt"] if official else None,
        "acquiredAt": contract["acquiredAt"] if official else None,
        "landingUrl": contract["landingUrl"] if official else None,
        "licenseUrl": contract["licenseUrl"] if official else None,
    }
    receipt = {
        "datasetId": DATASET_ID,
        "delimiter": contract["csv"]["delimiter"] if official else contract["delimiter"],
        "encoding": contract["csv"]["encoding"] if official else contract["encoding"],
        "evidenceLabel": contract["evidenceLabel"],
        "headers": source_headers,
        "indexedRows": indexed_rows,
        "members": member_ranges,
        "moneyFormat": contract["csv"]["moneyFormat"] if official else contract["moneyFormat"],
        "moneyUnit": contract["csv"]["moneyUnit"] if official else contract["moneyUnit"],
        "publicHeaders": public_headers,
        "licenseStatus": contract["licenseStatus"],
        "publicRows": source_rows,
        "redactions": redactions,
        "schemaVersion": 1,
        "sourceBytes": archive_bytes,
        "sourceRows": source_rows,
        "sourceSha256": archive_sha256,
        "sourceUrl": source_url,
    }
    receipt.update(provenance)
    if not official:
        receipt["fixtureOnly"] = True
    if sample_only:
        receipt["sampleOnly"] = True
        receipt["sampleDefinition"] = {"kind": "global-prefix", "rows": sample_rows}
    receipt_payload = corpus.canonical_json(receipt)
    corpus.write_bytes(output / "receipt.json", receipt_payload)
    manifest = {
        "canary": canary,
        "chunkCount": sum(group["chunkCount"] for group in chunk_groups),
        "chunkGroups": chunk_groups,
        "datasetId": DATASET_ID,
        "distinctCups": distinct_cups,
        "evidenceLabel": contract["evidenceLabel"],
        "headers": public_headers,
        "indexedRows": indexed_rows,
        "projectionVersion": 1,
        "publicRows": source_rows,
        "licenseStatus": contract["licenseStatus"],
        "receiptSha256": corpus.sha256_bytes(receipt_payload),
        "rootIndex": root_index,
        "schemaVersion": INDEX_SCHEMA_VERSION,
        "sourceRows": source_rows,
        "sourceSha256": archive_sha256,
        "sourceSpecSha256": source_spec_sha256,
        "sourceUrl": source_url,
    }
    manifest.update(provenance)
    if not official:
        manifest["fixtureOnly"] = True
    if sample_only:
        manifest["sampleOnly"] = True
        manifest["sampleDefinition"] = {"kind": "global-prefix", "rows": sample_rows}
    corpus.write_bytes(output / "manifest.json", corpus.canonical_json(manifest))
    return manifest


def verify_release(manifest_path: Path) -> dict[str, int]:
    """Verify a release by streaming rows and using SQLite for reconciliation.

    The verifier deliberately keeps only one object/chunk in memory.  The
    temporary SQLite tables are the durable working set for row and posting
    reconciliation; they are removed with the temporary directory.
    """

    root = manifest_path.parent

    def canonical_object(payload: bytes, label: str) -> dict[str, object]:
        try:
            value = json.loads(payload.decode("utf-8"))
        except (UnicodeError, json.JSONDecodeError) as error:
            raise SourceError(f"{label} non è JSON UTF-8 valido") from error
        if not isinstance(value, dict) or corpus.canonical_json(value) != payload:
            raise SourceError(f"{label} non è un oggetto JSON canonico")
        return value

    try:
        manifest_payload = manifest_path.read_bytes()
    except OSError as error:
        raise SourceError("Manifest fixture OpenCUP illeggibile") from error
    manifest = canonical_object(manifest_payload, "Manifest fixture OpenCUP")
    fixture_only = manifest.get("fixtureOnly") is True
    sample_only = manifest.get("sampleOnly") is True
    if sample_only and fixture_only:
        raise SourceError("Manifest OpenCUP non può essere fixture e sample insieme")
    contract = synthetic_contract() if fixture_only else official_contract()
    expected_public_headers = _public_headers(contract)
    expected_source_url = _source_url(contract)
    expected_provenance = {
        "referenceDate": contract["referenceDate"] if not fixture_only else None,
        "publicationDate": contract["publicationDate"] if not fixture_only else None,
        "lastModified": contract["lastModified"] if not fixture_only else None,
        "observedAt": contract["observedAt"] if not fixture_only else None,
        "acquiredAt": contract["acquiredAt"] if not fixture_only else None,
        "landingUrl": contract["landingUrl"] if not fixture_only else None,
        "licenseUrl": contract["licenseUrl"] if not fixture_only else None,
    }
    expected_money_format = contract["moneyFormat"] if fixture_only else contract["csv"]["moneyFormat"]
    expected_money_unit = contract["moneyUnit"] if fixture_only else contract["csv"]["moneyUnit"]
    expected_manifest_keys = {
        "canary", "chunkCount", "chunkGroups", "datasetId", "distinctCups",
        "evidenceLabel", "headers", "indexedRows", "licenseStatus",
        "projectionVersion", "publicRows",
        "receiptSha256", "rootIndex", "schemaVersion", "sourceRows", "sourceSha256",
        "sourceSpecSha256", "sourceUrl", *expected_provenance,
    }
    if fixture_only:
        expected_manifest_keys.add("fixtureOnly")
    if sample_only:
        expected_manifest_keys.update({"sampleOnly", "sampleDefinition"})
    if set(manifest) != expected_manifest_keys or (
        manifest["schemaVersion"] != INDEX_SCHEMA_VERSION
        or manifest["projectionVersion"] != 1
        or manifest["datasetId"] != DATASET_ID
        or manifest["evidenceLabel"] != contract["evidenceLabel"]
        or manifest["headers"] != expected_public_headers
        or manifest["licenseStatus"] != contract["licenseStatus"]
        or manifest["sourceUrl"] != expected_source_url
        or any(manifest[field] != value for field, value in expected_provenance.items())
        or (fixture_only and manifest["fixtureOnly"] is not True)
        or (sample_only and manifest["sampleOnly"] is not True)
    ):
        raise SourceError("Contratto manifest fixture OpenCUP divergente")
    if sample_only:
        sample_definition = manifest.get("sampleDefinition")
        if (
            not isinstance(sample_definition, dict)
            or set(sample_definition) != {"kind", "rows"}
            or sample_definition["kind"] != "global-prefix"
            or isinstance(sample_definition["rows"], bool)
            or not isinstance(sample_definition["rows"], int)
            or sample_definition["rows"] <= 0
            or sample_definition["rows"] != manifest["sourceRows"]
        ):
            raise SourceError("Definizione sample OpenCUP divergente")
    for field in ("sourceSha256", "receiptSha256", "sourceSpecSha256"):
        if not isinstance(manifest[field], str) or not re.fullmatch(r"[0-9a-f]{64}", manifest[field]):
            raise SourceError(f"Digest manifest OpenCUP non valido: {field}")
    spec_path = _contract_spec_path(contract)
    _spec_bytes, spec_digest = _sha256_file(spec_path)
    if manifest["sourceSpecSha256"] != spec_digest:
        raise SourceError("Digest source lock OpenCUP divergente")
    if not fixture_only and not sample_only:
        locked_archive = contract["archive"]
        if (
            manifest["sourceSha256"] != contract["sourceSha256"]
            or manifest["sourceRows"] != locked_archive["expectedRows"]
            or manifest["publicRows"] != locked_archive["expectedRows"]
            or manifest["indexedRows"] != locked_archive["expectedRows"]
            or manifest["distinctCups"] != locked_archive["expectedDistinctCups"]
        ):
            raise SourceError("Release ufficiale OpenCUP divergente dal source lock")
    if (
        not isinstance(manifest["chunkCount"], int)
        or isinstance(manifest["chunkCount"], bool)
        or manifest["chunkCount"] <= 0
        or not isinstance(manifest["chunkGroups"], list)
        or not manifest["chunkGroups"]
    ):
        raise SourceError("Gruppi chunk fixture OpenCUP mancanti")

    try:
        receipt_payload = (root / "receipt.json").read_bytes()
    except OSError as error:
        raise SourceError("Ricevuta fixture OpenCUP illeggibile") from error
    receipt = canonical_object(receipt_payload, "Ricevuta fixture OpenCUP")
    expected_receipt_keys = {
        "datasetId", "delimiter", "encoding", "evidenceLabel", "headers", "indexedRows",
        "members", "moneyFormat", "moneyUnit", "publicHeaders", "licenseStatus",
        "publicRows", "redactions", "schemaVersion", "sourceBytes", "sourceRows",
        "sourceSha256", "sourceUrl", *expected_provenance,
    }
    if fixture_only:
        expected_receipt_keys.add("fixtureOnly")
    if sample_only:
        expected_receipt_keys.update({"sampleOnly", "sampleDefinition"})
    if set(receipt) != expected_receipt_keys:
        raise SourceError("Schema ricevuta fixture OpenCUP divergente")
    if corpus.sha256_bytes(receipt_payload) != manifest["receiptSha256"]:
        raise SourceError("Digest ricevuta fixture OpenCUP divergente")
    if (
        receipt.get("sourceSha256") != manifest["sourceSha256"]
        or receipt.get("sourceRows") != manifest["sourceRows"]
        or receipt.get("publicRows") != manifest["publicRows"]
        or receipt.get("indexedRows") != manifest["indexedRows"]
        or receipt.get("evidenceLabel") != manifest["evidenceLabel"]
        or receipt.get("moneyFormat") != expected_money_format
        or receipt.get("moneyUnit") != expected_money_unit
        or receipt.get("publicHeaders") != expected_public_headers
        or receipt.get("licenseStatus") != contract["licenseStatus"]
        or receipt.get("sourceUrl") != expected_source_url
        or any(receipt.get(field) != value for field, value in expected_provenance.items())
        or (fixture_only and receipt.get("fixtureOnly") is not True)
        or (sample_only and receipt.get("sampleOnly") is not True)
        or (sample_only and receipt.get("sampleDefinition") != manifest.get("sampleDefinition"))
    ):
        raise SourceError("Ricevuta e manifest fixture OpenCUP non riconciliati")
    if not fixture_only and not sample_only:
        expected_members = []
        first_source_row = 1
        for member in contract["archive"]["members"]:
            expected_members.append(
                {
                    "bytes": member["rawBytes"],
                    "compressedBytes": member["compressedBytes"],
                    "crc32": member["crc32"],
                    "firstSourceRow": first_source_row,
                    "name": member["name"],
                    "rowCount": member["rows"],
                }
            )
            first_source_row += member["rows"]
        if (
            receipt.get("sourceBytes") != contract["sourceBytes"]
            or receipt.get("members") != expected_members
        ):
            raise SourceError("Ricevuta ufficiale OpenCUP divergente dal source lock")

    descriptor_keys = {"bytes", "format", "key", "rawBytes", "sha256"}

    def descriptor(value: object, label: str) -> dict[str, object]:
        if not isinstance(value, dict) or set(value) != descriptor_keys:
            raise SourceError(f"Descrittore {label} non valido")
        digest = value.get("sha256")
        byte_count = value.get("bytes")
        raw_bytes = value.get("rawBytes")
        if (
            not isinstance(digest, str)
            or not re.fullmatch(r"[0-9a-f]{64}", digest)
            or value.get("key") != f"sha256/{digest}"
            or isinstance(byte_count, bool)
            or not isinstance(byte_count, int)
            or byte_count <= 0
            or isinstance(raw_bytes, bool)
            or not isinstance(raw_bytes, int)
            or raw_bytes <= 0
            or value.get("format") not in {"json-v1", "jsonl-gzip-v1"}
        ):
            raise SourceError(f"Descrittore {label} fuori contratto")
        return value

    with tempfile.TemporaryDirectory(prefix="opencup-verify-") as temporary:
        connection = sqlite3.connect(Path(temporary) / "verify.sqlite3")
        try:
            connection.executescript(
                """
                CREATE TABLE rows (
                    source_row INTEGER PRIMARY KEY,
                    cup TEXT,
                    chunk_ordinal INTEGER NOT NULL
                );
                CREATE TABLE chunks (
                    ordinal INTEGER PRIMARY KEY,
                    first_source_row INTEGER NOT NULL,
                    row_count INTEGER NOT NULL
                );
                CREATE TABLE index_refs (
                    source_row INTEGER PRIMARY KEY,
                    cup TEXT NOT NULL
                );
                CREATE TABLE index_cups (cup TEXT PRIMARY KEY, matched_rows INTEGER NOT NULL);
                CREATE TABLE posting_nodes_seen (digest TEXT PRIMARY KEY);
                CREATE TABLE posting_page_ranges (
                    cup TEXT NOT NULL,
                    start INTEGER NOT NULL,
                    end INTEGER NOT NULL,
                    digest TEXT NOT NULL,
                    next_digest TEXT,
                    PRIMARY KEY (cup, start)
                );
                CREATE TABLE verified_objects (digest TEXT PRIMARY KEY);
                """
            )

            def read_object(value: object, label: str) -> bytes:
                item = descriptor(value, label)
                key = str(item["key"])
                path = root / key
                try:
                    if path.is_symlink() or not path.is_file():
                        raise SourceError(f"Oggetto {label} assente o non regolare")
                    payload = path.read_bytes()
                except OSError as error:
                    raise SourceError(f"Oggetto {label} illeggibile") from error
                if len(payload) != item["bytes"] or corpus.sha256_bytes(payload) != item["sha256"]:
                    raise SourceError(f"Oggetto {label} alterato")
                try:
                    raw = gzip.decompress(payload) if item["format"] == "jsonl-gzip-v1" else payload
                except (OSError, EOFError) as error:
                    raise SourceError(f"Oggetto {label} non decomprimibile") from error
                if len(raw) != item["rawBytes"]:
                    raise SourceError(f"Dimensione raw oggetto {label} divergente")
                connection.execute(
                    "INSERT OR IGNORE INTO verified_objects(digest) VALUES (?)",
                    (key,),
                )
                return raw

            chunk_groups = manifest["chunkGroups"]
            expected_ordinal = 0
            expected_source_row = 1
            for group_ordinal, group in enumerate(chunk_groups):
                if not isinstance(group, dict) or set(group) != {
                    "chunkCount", "firstOrdinal", "firstSourceRow", "object", "rowCount"
                }:
                    raise SourceError("Gruppo chunk fixture OpenCUP non valido")
                if (
                    group["firstOrdinal"] != expected_ordinal
                    or group["firstSourceRow"] != expected_source_row
                    or not isinstance(group["chunkCount"], int)
                    or isinstance(group["chunkCount"], bool)
                    or not 1 <= group["chunkCount"] <= MAX_CHUNK_GROUP_CHUNKS
                    or not isinstance(group["rowCount"], int)
                    or isinstance(group["rowCount"], bool)
                    or group["rowCount"] <= 0
                ):
                    raise SourceError("Intervalli gruppo chunk fixture OpenCUP divergenti")
                group_descriptor = descriptor(group["object"], f"gruppo chunk {group_ordinal}")
                if (
                    group_descriptor["format"] != "json-v1"
                    or group_descriptor["rawBytes"] > MAX_INDEX_NODE_RAW_BYTES
                ):
                    raise SourceError("Formato o budget gruppo chunk fixture OpenCUP divergente")
                group_payload = canonical_object(
                    read_object(group_descriptor, f"gruppo chunk {group_ordinal}"),
                    f"Gruppo chunk fixture OpenCUP {group_ordinal}",
                )
                if set(group_payload) != {"chunks", "kind", "schemaVersion"} or (
                    group_payload["kind"] != "chunk-group"
                    or group_payload["schemaVersion"] != INDEX_SCHEMA_VERSION
                    or not isinstance(group_payload["chunks"], list)
                    or len(group_payload["chunks"]) != group["chunkCount"]
                ):
                    raise SourceError("Schema gruppo chunk fixture OpenCUP divergente")
                group_rows = 0
                for item in group_payload["chunks"]:
                    if not isinstance(item, dict) or set(item) != descriptor_keys | {
                        "firstSourceRow", "ordinal", "rowCount"
                    }:
                        raise SourceError("Chunk fixture OpenCUP non valido")
                    base = {key: item[key] for key in descriptor_keys}
                    if (
                        item["ordinal"] != expected_ordinal
                        or item["firstSourceRow"] != expected_source_row
                        or not isinstance(item["rowCount"], int)
                        or isinstance(item["rowCount"], bool)
                        or not 1 <= item["rowCount"] <= MAX_CHUNK_ROWS
                        or base["format"] != "jsonl-gzip-v1"
                        or base["rawBytes"] > MAX_CHUNK_RAW_BYTES
                    ):
                        raise SourceError("Intervalli chunk fixture OpenCUP divergenti")
                    connection.execute(
                        "INSERT INTO chunks VALUES (?, ?, ?)",
                        (expected_ordinal, expected_source_row, item["rowCount"]),
                    )
                    raw = read_object(base, f"chunk {expected_ordinal}")
                    if not raw.endswith(b"\n"):
                        raise SourceError("Chunk fixture OpenCUP non canonico")
                    rows_in_chunk = 0
                    for line in io.BytesIO(raw):
                        row = canonical_object(line, "Riga fixture OpenCUP")
                        source_row = expected_source_row + rows_in_chunk
                        cells = row.get("cells")
                        public_digest = corpus.sha256_bytes(
                            corpus.canonical_json(cells)
                        ) if isinstance(cells, dict) else ""
                        expected_id = "row-" + corpus.sha256_bytes(
                            f"{DATASET_ID}:{source_row}:{public_digest}".encode("utf-8")
                        )[:24]
                        if (
                            set(row) != {
                                "cells", "evidenceLabel", "id", "redactions", "sourceRow",
                                "sourceRowSha256", "sourceUrls",
                            }
                            or row.get("sourceRow") != source_row
                            or not isinstance(cells, dict)
                            or set(cells) != set(expected_public_headers)
                            or row.get("sourceRowSha256") != public_digest
                            or row.get("id") != expected_id
                            or row.get("evidenceLabel") != contract["evidenceLabel"]
                            or row.get("sourceUrls") != ([] if fixture_only else [expected_source_url])
                        ):
                            raise SourceError("Proiezione riga fixture OpenCUP divergente")
                        redactions = row.get("redactions")
                        if not isinstance(redactions, list):
                            raise SourceError("Redazioni riga fixture OpenCUP divergenti")
                        for private_field in _redacted_fields(contract):
                            cell = cells[private_field]
                            matches = [
                                redaction for redaction in redactions
                                if isinstance(redaction, dict)
                                and redaction.get("field") == private_field
                                and redaction.get("reason") == "personal-identifier"
                            ]
                            if cell is not None or len(matches) != 1:
                                raise SourceError("Campo privato fixture OpenCUP non redatto")
                        for money_field in ("COSTO_PROGETTO", "FINANZIAMENTO_PROGETTO"):
                            if cells[money_field] is not None:
                                parse_euro_integer(cells[money_field])
                        for field, value in cells.items():
                            if not isinstance(value, str):
                                continue
                            if (
                                corpus.RAW_WORKSTATION_REFERENCE_RE.search(value)
                                or corpus.contains_encoded_public_cell_hazard(value)
                                or corpus.CREDENTIAL_RE.search(value)
                                or corpus.contains_sensitive_assignment(value)
                                or any(
                                    not corpus.is_safe_public_url(match.group(0).rstrip(".,)]}\"'"))
                                    for match in corpus.EMBEDDED_HTTP_URL_RE.finditer(value)
                                )
                            ):
                                raise SourceError(
                                    "Metadato non pubblico nella fixture OpenCUP "
                                    f"alla registrazione {source_row}, campo {field}"
                                )
                        cup = cells.get("CUP")
                        if cup is not None and (not isinstance(cup, str) or not CUP_RE.fullmatch(cup)):
                            raise SourceError("CUP fixture OpenCUP non valido")
                        connection.execute(
                            "INSERT INTO rows VALUES (?, ?, ?)",
                            (source_row, cup, expected_ordinal),
                        )
                        rows_in_chunk += 1
                    if rows_in_chunk != item["rowCount"]:
                        raise SourceError("Conteggio righe chunk fixture OpenCUP divergente")
                    expected_ordinal += 1
                    expected_source_row += rows_in_chunk
                    group_rows += rows_in_chunk
                if group_rows != group["rowCount"]:
                    raise SourceError("Conteggio gruppo chunk fixture OpenCUP divergente")
            if (
                expected_ordinal != manifest["chunkCount"]
                or expected_source_row != manifest["publicRows"] + 1
                or manifest["sourceRows"] != manifest["publicRows"]
            ):
                raise SourceError("Copertura righe fixture OpenCUP divergente")

            def register_ref(cup: str, ref: object, previous_source_row: int) -> int:
                if not isinstance(ref, dict) or set(ref) != {"chunkOrdinal", "sourceRow"}:
                    raise SourceError("Riferimento posting fixture OpenCUP non valido")
                source_row = ref["sourceRow"]
                chunk_ordinal = ref["chunkOrdinal"]
                if (
                    not isinstance(source_row, int)
                    or isinstance(source_row, bool)
                    or not isinstance(chunk_ordinal, int)
                    or isinstance(chunk_ordinal, bool)
                    or source_row <= previous_source_row
                ):
                    raise SourceError("Posting fixture OpenCUP non ordinata o duplicata")
                row = connection.execute(
                    "SELECT cup, chunk_ordinal FROM rows WHERE source_row = ?",
                    (source_row,),
                ).fetchone()
                chunk = connection.execute(
                    "SELECT first_source_row, row_count FROM chunks WHERE ordinal = ?",
                    (chunk_ordinal,),
                ).fetchone()
                if (
                    row is None
                    or row[0] != cup
                    or chunk is None
                    or not chunk[0] <= source_row < chunk[0] + chunk[1]
                    or row[1] != chunk_ordinal
                ):
                    raise SourceError("Riferimento posting fixture OpenCUP divergente")
                try:
                    connection.execute(
                        "INSERT INTO index_refs VALUES (?, ?)",
                        (source_row, cup),
                    )
                except sqlite3.IntegrityError as error:
                    raise SourceError("Riferimento posting fixture OpenCUP duplicato") from error
                return source_row

            def read_posting_tree(value: object, cup: str, matched_rows: int) -> int:
                """Verify a posting tree while visiting only each node once."""

                previous_source_row = 0

                def read_node(node_value: object, depth: int) -> tuple[int, int, int]:
                    nonlocal previous_source_row
                    if depth > MAX_POSTING_TREE_DEPTH:
                        raise SourceError("Profondità posting fixture OpenCUP oltre contratto")
                    item = descriptor(node_value, "posting indice")
                    if item["format"] != "json-v1" or item["rawBytes"] > MAX_INDEX_NODE_RAW_BYTES:
                        raise SourceError("Nodo posting fixture OpenCUP fuori budget")
                    inserted = connection.execute(
                        "INSERT OR IGNORE INTO posting_nodes_seen VALUES (?)",
                        (item["sha256"],),
                    )
                    if inserted.rowcount != 1:
                        raise SourceError("Ciclo posting fixture OpenCUP")
                    node = canonical_object(
                        read_object(item, "posting indice"),
                        "Indice posting fixture OpenCUP",
                    )
                    if node.get("kind") == "posting-directory":
                        if set(node) != {"children", "kind", "schemaVersion"} or (
                            node["schemaVersion"] != INDEX_SCHEMA_VERSION
                        ):
                            raise SourceError("Directory posting fixture OpenCUP divergente")
                        children = node["children"]
                        if not isinstance(children, list) or not 1 <= len(children) <= MAX_INDEX_CHILDREN:
                            raise SourceError("Figli directory posting fixture OpenCUP fuori contratto")
                        expected_start: int | None = None
                        total_refs = 0
                        actual_end = 0
                        actual_start = 0
                        for child in children:
                            if not isinstance(child, dict) or set(child) != {"end", "node", "start"}:
                                raise SourceError("Intervallo directory posting fixture OpenCUP non valido")
                            start = child["start"]
                            end = child["end"]
                            if (
                                not isinstance(start, int)
                                or isinstance(start, bool)
                                or not isinstance(end, int)
                                or isinstance(end, bool)
                                or (expected_start is not None and start != expected_start)
                                or not start < end <= matched_rows
                            ):
                                raise SourceError("Intervalli directory posting fixture OpenCUP divergenti")
                            child_start, child_end, child_refs = read_node(child["node"], depth + 1)
                            if child_start != start or child_end != end:
                                raise SourceError("Intervallo directory posting fixture OpenCUP divergente")
                            if expected_start is None:
                                actual_start = start
                            expected_start = end
                            actual_end = end
                            total_refs += child_refs
                        return actual_start, actual_end, total_refs

                    allowed_keys = {"cup", "kind", "refs", "schemaVersion", "start"}
                    if set(node) not in (allowed_keys, allowed_keys | {"next"}) or (
                        node["schemaVersion"] != INDEX_SCHEMA_VERSION
                        or node["kind"] != "postings"
                        or node["cup"] != cup
                        or not isinstance(node["start"], int)
                        or isinstance(node["start"], bool)
                        or node["start"] < 0
                        or not isinstance(node["refs"], list)
                        or not 1 <= len(node["refs"])
                        <= MAX_POSTING_REFS
                    ):
                        raise SourceError("Schema pagina posting fixture OpenCUP divergente")
                    start = node["start"]
                    end = start + len(node["refs"])
                    if end > matched_rows:
                        raise SourceError("Intervallo pagina posting fixture OpenCUP fuori contratto")
                    for ref in node["refs"]:
                        previous_source_row = register_ref(cup, ref, previous_source_row)
                    next_value = node.get("next")
                    next_digest: str | None = None
                    if next_value is not None:
                        next_descriptor = descriptor(next_value, "next posting")
                        next_digest = str(next_descriptor["sha256"])
                        if end >= matched_rows:
                            raise SourceError("Pagina posting finale con continuazione inattesa")
                    try:
                        connection.execute(
                            "INSERT INTO posting_page_ranges VALUES (?, ?, ?, ?, ?)",
                            (cup, start, end, item["sha256"], next_digest),
                        )
                    except sqlite3.IntegrityError as error:
                        raise SourceError("Intervallo pagina posting duplicato") from error
                    return start, end, len(node["refs"])

                actual_start, actual_end, count = read_node(value, 1)
                if actual_start != 0 or actual_end != matched_rows or count != matched_rows:
                    raise SourceError("Copertura albero posting fixture OpenCUP divergente")
                for start, end, digest, next_digest in connection.execute(
                    """
                    SELECT start, end, digest, next_digest
                    FROM posting_page_ranges WHERE cup = ? ORDER BY start
                    """,
                    (cup,),
                ):
                    if next_digest is None:
                        continue
                    target = connection.execute(
                        """
                        SELECT start, cup FROM posting_page_ranges
                        WHERE digest = ?
                        """,
                        (next_digest,),
                    ).fetchone()
                    if target is None or target[0] != end or target[1] != cup:
                        raise SourceError("Continuazione pagina posting non adiacente")
                return count

            def read_node(value: object, depth: int) -> tuple[str, str]:
                if depth > MAX_INDEX_DEPTH:
                    raise SourceError("Profondità indice fixture OpenCUP oltre contratto")
                item = descriptor(value, "indice")
                if item["format"] != "json-v1" or item["rawBytes"] > MAX_INDEX_NODE_RAW_BYTES:
                    raise SourceError("Nodo indice fixture OpenCUP fuori contratto")
                node = canonical_object(read_object(item, "indice"), "Indice fixture OpenCUP")
                if node.get("kind") == "directory":
                    if set(node) != {"children", "kind", "schemaVersion"} or node["schemaVersion"] != INDEX_SCHEMA_VERSION:
                        raise SourceError("Directory indice fixture OpenCUP divergente")
                    children = node["children"]
                    if not isinstance(children, list) or not 1 <= len(children) <= MAX_INDEX_CHILDREN:
                        raise SourceError("Figli directory fixture OpenCUP fuori contratto")
                    previous_max: str | None = None
                    for child in children:
                        if not isinstance(child, dict) or set(child) != {"minCup", "maxCup", "node"}:
                            raise SourceError("Intervallo directory fixture OpenCUP non valido")
                        actual_min, actual_max = read_node(child["node"], depth + 1)
                        if child["minCup"] != actual_min or child["maxCup"] != actual_max or (
                            previous_max is not None and child["minCup"] <= previous_max
                        ):
                            raise SourceError("Intervalli directory fixture OpenCUP divergenti")
                        previous_max = child["maxCup"]
                    return children[0]["minCup"], children[-1]["maxCup"]
                if set(node) != {"entries", "kind", "schemaVersion"} or (
                    node.get("kind") != "leaf" or node["schemaVersion"] != INDEX_SCHEMA_VERSION
                ):
                    raise SourceError("Foglia indice fixture OpenCUP divergente")
                entries = node["entries"]
                if not isinstance(entries, list) or not 1 <= len(entries) <= MAX_INDEX_CHILDREN:
                    raise SourceError("Voci foglia fixture OpenCUP fuori contratto")
                cups: list[str] = []
                for entry in entries:
                    if not isinstance(entry, dict):
                        raise SourceError("Voce foglia fixture OpenCUP non valida")
                    cup = entry.get("cup")
                    matched_rows = entry.get("matchedRows")
                    if not isinstance(cup, str) or not CUP_RE.fullmatch(cup) or (
                        not isinstance(matched_rows, int) or isinstance(matched_rows, bool) or matched_rows <= 0
                    ):
                        raise SourceError("CUP foglia fixture OpenCUP non valido")
                    if "refs" in entry:
                        if set(entry) != {"cup", "matchedRows", "refs"} or matched_rows > INLINE_POSTING_REFS:
                            raise SourceError("Voce inline fixture OpenCUP divergente")
                        refs = entry["refs"]
                        if not isinstance(refs, list) or len(refs) != matched_rows:
                            raise SourceError("Conteggio posting fixture OpenCUP divergente")
                        count = 0
                        previous_source_row = 0
                        for ref in refs:
                            previous_source_row = register_ref(cup, ref, previous_source_row)
                            count += 1
                    else:
                        if set(entry) != {"cup", "matchedRows", "postingRoot"} or matched_rows <= INLINE_POSTING_REFS:
                            raise SourceError("Voce posting fixture OpenCUP divergente")
                        count = read_posting_tree(entry["postingRoot"], cup, matched_rows)
                    if count != matched_rows:
                        raise SourceError("Conteggio posting fixture OpenCUP divergente")
                    try:
                        connection.execute(
                            "INSERT INTO index_cups VALUES (?, ?)",
                            (cup, matched_rows),
                        )
                    except sqlite3.IntegrityError as error:
                        raise SourceError("CUP foglia fixture OpenCUP duplicato") from error
                    cups.append(cup)
                if cups != sorted(cups):
                    raise SourceError("CUP foglia fixture OpenCUP non ordinati")
                return cups[0], cups[-1]

            read_node(manifest["rootIndex"], 1)
            indexed_rows = connection.execute("SELECT COUNT(*) FROM index_refs").fetchone()[0]
            distinct_cups = connection.execute("SELECT COUNT(*) FROM index_cups").fetchone()[0]
            cup_rows = connection.execute(
                "SELECT COUNT(*) FROM rows WHERE cup IS NOT NULL"
            ).fetchone()[0]
            uncovered = connection.execute(
                """
                SELECT COUNT(*) FROM rows
                WHERE cup IS NOT NULL AND source_row NOT IN (SELECT source_row FROM index_refs)
                """
            ).fetchone()[0]
            if (
                indexed_rows != manifest["indexedRows"]
                or distinct_cups != manifest["distinctCups"]
                or indexed_rows != cup_rows
                or uncovered != 0
            ):
                raise SourceError("Indice e righe fixture OpenCUP non riconciliati")
            canary = manifest["canary"]
            if (
                not isinstance(canary, dict)
                or set(canary) != {"cup", "sourceRow"}
                or connection.execute(
                    "SELECT 1 FROM index_refs WHERE cup = ? AND source_row = ?",
                    (canary.get("cup"), canary.get("sourceRow")),
                ).fetchone() is None
            ):
                raise SourceError("Canary fixture OpenCUP non riconciliata")
            return {
                "verifiedObjects": connection.execute(
                    "SELECT COUNT(*) FROM verified_objects"
                ).fetchone()[0],
                "verifiedPostingRefs": indexed_rows,
                "verifiedRows": connection.execute("SELECT COUNT(*) FROM rows").fetchone()[0],
            }
        finally:
            connection.close()
