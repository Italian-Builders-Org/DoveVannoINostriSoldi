#!/usr/bin/env python3
"""Validate and publish the curated row-level datasets selected for integration.

The source files remain outside the repository. This command validates their
exact bytes against a committed contract, preserves every source row in a
receipt, and emits only the explicitly approved public projection.
"""

from __future__ import annotations

import argparse
import csv
import gzip
import hashlib
import ipaddress
import io
import json
import os
import re
import stat
import tempfile
import zipfile
import xml.etree.ElementTree as ElementTree
import zlib
from contextlib import contextmanager
from dataclasses import dataclass
from importlib import metadata as importlib_metadata
from pathlib import Path, PurePosixPath
from typing import Any, Iterable
from urllib.parse import parse_qsl, unquote, urlsplit

try:
    from source_catalog.url_credentials import (
        contains_credential_like_hostname,
        contains_credential_like_url_component,
        is_exact_public_documentation_url,
        is_non_public_hostname,
        is_strong_credential_key,
    )
except ModuleNotFoundError:  # Imported by path in the isolated unittest module.
    from scripts.etl.source_catalog.url_credentials import (
        contains_credential_like_hostname,
        contains_credential_like_url_component,
        is_exact_public_documentation_url,
        is_non_public_hostname,
        is_strong_credential_key,
    )


ROOT = Path(__file__).resolve().parents[2]
DEFAULT_SPEC = ROOT / "scripts/etl/specs/integrated-curated-datasets.source.json"
DEFAULT_CATALOG = ROOT / "src/data/generated/integrated/catalog.json"
DEFAULT_ROWS_DIR = ROOT / "src/data/generated/integrated/rows"
DEFAULT_RECEIPTS_DIR = ROOT / "data/source-ledger/datasets"
DEFAULT_PROOF = ROOT / "data/source-ledger/dataset-proof.json"

SHA256_RE = re.compile(r"^[0-9a-f]{64}$")
CRC32_RE = re.compile(r"^[0-9a-f]{8}$")
DATASET_ID_RE = re.compile(r"^[a-z0-9]+(?:-[a-z0-9]+)*$")
HTTP_URL_RE = re.compile(r"https?://[^\s|;]+", re.IGNORECASE)
EMBEDDED_HTTP_URL_RE = re.compile(r"https?://[^\s|]+", re.IGNORECASE)
ABSOLUTE_INTERNAL_RE = re.compile(
    r"(^|[\s|;:(=[\"'])((?:file://)?/(?:workspace|Users|home|private/tmp|tmp)/[^|;\r\n\"']*)",
    re.IGNORECASE | re.MULTILINE,
)
RELATIVE_INTERNAL_RE = re.compile(
    r"(?<![/\w:-])(?:dashboard|affidamenti-work|at-catalog|buchi|releases|"
    r"voce-della-spesa)/[^|;\r\n\"']+",
    re.IGNORECASE,
)
INTERNAL_README_RE = re.compile(
    r"(?<![/\w:-])(?:[a-z0-9][a-z0-9._-]*-)?README\.md\b",
    re.IGNORECASE,
)
INTERNAL_NAME_RE = re.compile(
    r"(?:copy|ui)-[a-z]+\.(?:tsv|json|md)|"
    r"(?:other[-_ ]agent|private[-_ ]batch|browser[-_ ]session|raw[-_ ]internal)[^|;\r\n]*",
    re.IGNORECASE,
)
SENSITIVE_QUERY_KEYS = frozenset({
    "accesstoken", "apikey", "auth", "authorization", "clientsecret", "code",
    "cookie", "credential", "jwt", "key", "password", "secret", "session",
    "sessionid", "sig", "signature", "token", "xamzcredential",
    "xamzsignature", "xgoogcredential", "xgoogsignature",
})
SENSITIVE_QUERY_SUFFIXES = ("credential", "password", "secret", "signature", "token")
NESTED_QUERY_KEY_RE = re.compile(r"(?:^|[?&#;])([^=?&#;\s]{1,256})=")
INVALID_PERCENT_ESCAPE_RE = re.compile(r"%(?![0-9A-Fa-f]{2})")
CONTROL_OR_SPACE_RE = re.compile(r"[\x00-\x20\x7f]")
DOMAIN_RE = re.compile(
    r"(?:[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?)"
    r"(?:\.(?:[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?))*\Z"
)
WINDOWS_WORKSTATION_PATH_RE = re.compile(r"(?:^|[\s=])[A-Za-z]:[\\/]")
ENCODED_WORKSTATION_PATH_RE = re.compile(
    r"(?:^|[\s=?&#])(?:file://)?/{1,3}(?:Users|home|workspace|private/tmp|tmp)(?:/|$)",
    re.IGNORECASE,
)
LOCAL_FILE_URL_RE = re.compile(r"(?:^|[\s=])file://", re.IGNORECASE)
UNC_WORKSTATION_PATH_RE = re.compile(r"(?:^|[\s=])\\\\[^\\/\s]+[\\/]")
RAW_WORKSTATION_REFERENCE_RE = re.compile(
    r"(^|[\s|;,:?&#({=[\"'])("
    r"(?:file://[^\s|;\r\n\"'<>]+)|"
    r"(?:[A-Za-z]:[\\/][^\s|;\r\n\"'<>]+)|"
    r"(?:\\\\[^\\/\s|;\r\n\"'<>]+[\\/][^\s|;\r\n\"'<>]+)|"
    r"(?:/(?:Users|workspace|private/tmp|tmp)"
    r"(?=$|[\\/\s|;\r\n\"'<>),\]}])(?:[\\/][^\s|;\r\n\"'<>]+)?)"
    r")",
    re.IGNORECASE | re.MULTILINE,
)
PERCENT_ENCODED_TOKEN_RE = re.compile(
    r"(^|[\s|;,:?&#({=[\"'])"
    r"((?=[^\s|;\r\n\"'<>]*%[0-9A-Fa-f]{2})[^\s|;\r\n\"'<>]+)",
    re.MULTILINE,
)
DECODED_FORWARD_UNC_REFERENCE_RE = re.compile(
    # A colon is deliberately not a boundary: the `//host/` portion of an
    # HTTP(S) URL is not a UNC share.
    r"(?:^|[\s|;,?&#({=[\"'])//[^/\s|;\r\n\"'<>]+/"
)
URL_PATH_WORKSTATION_PREFIX_RE = re.compile(
    r"^/{1,3}(?:Users|workspace|private/tmp|tmp)(?:/|$)"
)
URL_PATH_ENCODED_HOME_PREFIX_RE = re.compile(r"^/{1,3}home(?:/|$)")
MAX_PERCENT_DECODE_PASSES = 8
CREDENTIAL_RE = re.compile(
    r"\b(?:authorization|proxy-authorization)\s*:\s*(?:bearer|basic)\s+[^\s|;]+|"
    r"\b(?:cookie|set-cookie)\s*:\s*[^|\r\n]+|"
    r"\b(?:access[\s_-]*token|api[\s_-]*key|password|secret|"
    r"session(?:[\s_-]*id)?)\s*[:=]\s*[^\s|;]+",
    re.IGNORECASE,
)
COMPACT_CREDENTIAL_ASSIGNMENT_RE = re.compile(
    r"(?<![A-Za-z0-9])(?P<key>[A-Za-z][A-Za-z0-9_.-]{0,127})"
    r"\s*[:=]\s*(?P<value>\"[^\"\r\n]*\"|'[^'\r\n]*'|[^\s|;]+)",
)
NON_IDENTIFIER_MARKERS = {
    "-", "--", "n.a.", "n.d.", "n/a", "na", "nd", "none", "null",
    "non disponibile", "non indicato", "s.d.",
}
PUBLICATIONS = {"rows", "catalog-only", "derived-only", "source-index"}
EVIDENCE_LABELS = {
    "documented-fact", "missing-data", "verified-difference",
    "needs-explanation", "official-finding",
}
SOURCE_METADATA_KEYS = {
    "holder", "referencePeriod", "publicationDate", "acquisitionDate",
    "checkedAt", "updateFrequency", "canonicalUrls",
}
SOURCE_METADATA_OVERRIDE_KEYS = SOURCE_METADATA_KEYS - {
    "publicationDate", "acquisitionDate", "checkedAt", "updateFrequency",
}
DATE_RE = re.compile(r"^\d{4}-\d{2}-\d{2}$")
PUBLIC_ROW_CHUNK_ROWS = 1_000
PUBLIC_ROW_CHUNK_MAX_RAW_BYTES = 2 * 1024 * 1024
# Deflate overhead for a canonical chunk is small; this independent ceiling
# also bounds allocations before the deterministic-byte check runs.
PUBLIC_ROW_CHUNK_MAX_COMPRESSED_BYTES = PUBLIC_ROW_CHUNK_MAX_RAW_BYTES + 64 * 1024
ROW_CHUNK_NAME_RE = re.compile(
    r"^(?P<dataset>[a-z0-9]+(?:-[a-z0-9]+)*)\.part-(?P<ordinal>[0-9]{5})\.jsonl\.gz$"
)
XLSX_CELL_RE = re.compile(r"^(?P<column>[A-Z]+)(?P<row>[1-9][0-9]*)$")
CATALOG_INSPECTION_KINDS = {
    "delimited-set", "zip-delimited-set", "zip-xls", "xlsx",
}
CATALOG_CSV_FIELD_LIMIT = 1024 * 1024
XLRD_VERSION = "2.0.1"


class DatasetBuildError(ValueError):
    """The private source or a committed artifact violates its contract."""


def canonical_json(value: object) -> bytes:
    return (
        json.dumps(value, ensure_ascii=False, sort_keys=True, separators=(",", ":"), allow_nan=False)
        + "\n"
    ).encode("utf-8")


def canonical_gzip(payload: bytes) -> bytes:
    """Return a gzip member with a stable header on every supported Python."""
    output = io.BytesIO()
    with gzip.GzipFile(
        filename="",
        mode="wb",
        fileobj=output,
        compresslevel=9,
        mtime=0,
    ) as handle:
        handle.write(payload)
    compressed = bytearray(output.getvalue())
    if len(compressed) < 10:
        raise DatasetBuildError("gzip canonico incompleto")
    compressed[9] = 255
    return bytes(compressed)


def sha256_bytes(payload: bytes) -> str:
    return hashlib.sha256(payload).hexdigest()


def row_chunk_name(dataset_id: str, ordinal: int) -> str:
    if not DATASET_ID_RE.fullmatch(dataset_id):
        raise DatasetBuildError(f"identificativo dataset non valido: {dataset_id}")
    if ordinal < 0 or ordinal > 99_999:
        raise DatasetBuildError(f"indice chunk non valido per {dataset_id}: {ordinal}")
    return f"{dataset_id}.part-{ordinal:05d}.jsonl.gz"


def row_payload_chunks(dataset_id: str, payload: bytes) -> list[bytes]:
    """Split canonical JSONL without changing, dropping, or reordering any byte."""
    if not payload:
        return []
    if not payload.endswith(b"\n"):
        raise DatasetBuildError(f"righe senza newline finale per {dataset_id}")
    lines = payload.splitlines(keepends=True)
    chunks: list[bytes] = []
    for start in range(0, len(lines), PUBLIC_ROW_CHUNK_ROWS):
        chunk = b"".join(lines[start:start + PUBLIC_ROW_CHUNK_ROWS])
        if not chunk or not chunk.endswith(b"\n"):
            raise DatasetBuildError(f"chunk righe non canonico per {dataset_id}")
        if len(chunk) > PUBLIC_ROW_CHUNK_MAX_RAW_BYTES:
            raise DatasetBuildError(
                f"chunk righe oltre {PUBLIC_ROW_CHUNK_MAX_RAW_BYTES} byte per "
                f"{dataset_id}:{start // PUBLIC_ROW_CHUNK_ROWS}"
            )
        chunks.append(chunk)
    if b"".join(chunks) != payload:
        raise DatasetBuildError(f"chunk righe non lossless per {dataset_id}")
    return chunks


def require_dict(value: object, label: str) -> dict[str, Any]:
    if not isinstance(value, dict):
        raise DatasetBuildError(f"{label} deve essere un oggetto")
    return value


def require_list(value: object, label: str) -> list[Any]:
    if not isinstance(value, list):
        raise DatasetBuildError(f"{label} deve essere un elenco")
    return value


def require_text(value: object, label: str) -> str:
    if not isinstance(value, str) or not value.strip():
        raise DatasetBuildError(f"{label} mancante")
    return value


def require_int(value: object, label: str, *, minimum: int = 0) -> int:
    if isinstance(value, bool) or not isinstance(value, int) or value < minimum:
        raise DatasetBuildError(f"{label} deve essere un intero >= {minimum}")
    return value


def ensure_outside_repository(path: Path, label: str) -> Path:
    resolved = path.expanduser().resolve()
    try:
        resolved.relative_to(ROOT.resolve())
    except ValueError:
        return resolved
    raise DatasetBuildError(f"{label} deve restare fuori dal repository")


def parse_delimiter(raw: object, label: str) -> str:
    names = {"tab": "\t", "pipe": "|", "comma": ",", "semicolon": ";"}
    value = require_text(raw, label)
    if value not in names:
        raise DatasetBuildError(f"{label} non supportato: {value}")
    return names[value]


def validate_relative_source_path(raw: object, label: str) -> str:
    value = require_text(raw, label)
    path = Path(value)
    if path.is_absolute() or ".." in path.parts or value.startswith("./"):
        raise DatasetBuildError(f"{label} deve essere relativo e normalizzato")
    return value


def source_part_commitments(item: dict[str, Any]) -> list[dict[str, Any]]:
    """Return the ordered, path-free commitments that define a source set."""

    raw_sources = item.get("sources")
    if raw_sources is None:
        expected = item["expected"]
        return [{
            "id": "source-0001",
            "bytes": expected["bytes"],
            "sha256": expected["sha256"],
            "rows": expected["rows"],
        }]
    return [
        {
            "id": f"source-{index:04d}",
            "bytes": source["expected"]["bytes"],
            "sha256": source["expected"]["sha256"],
            "rows": source["expected"]["rows"],
        }
        for index, source in enumerate(raw_sources, start=1)
    ]


def source_set_sha256(item: dict[str, Any]) -> str:
    """Commit to source order and each member's exact byte/row identity."""

    return sha256_bytes(canonical_json({
        "schemaVersion": 1,
        "sources": source_part_commitments(item),
    }))


def require_sha256(value: object, label: str) -> str:
    digest = require_text(value, label)
    if not SHA256_RE.fullmatch(digest):
        raise DatasetBuildError(f"{label} non e uno SHA-256")
    return digest


def require_crc32(value: object, label: str) -> str:
    digest = require_text(value, label)
    if not CRC32_RE.fullmatch(digest):
        raise DatasetBuildError(f"{label} non e un CRC32")
    return digest


def validate_inspection_totals(
    value: dict[str, Any],
    label: str,
    *,
    expected_rows: int,
) -> None:
    rows = require_int(value.get("rows"), f"{label}.rows")
    valid_rows = require_int(value.get("validRows"), f"{label}.validRows")
    malformed_rows = require_int(value.get("malformedRows"), f"{label}.malformedRows")
    if rows != expected_rows or valid_rows + malformed_rows != rows:
        raise DatasetBuildError(f"totali inspection divergenti per {label}")


def validate_inspection_file_ids(files: list[Any], label: str, source_count: int) -> list[dict[str, Any]]:
    if len(files) != source_count:
        raise DatasetBuildError(f"numero file inspection divergente per {label}")
    validated: list[dict[str, Any]] = []
    for index, raw_file in enumerate(files, start=1):
        value = require_dict(raw_file, f"{label}.files[{index - 1}]")
        if value.get("id") != f"source-{index:04d}":
            raise DatasetBuildError(f"id file inspection divergente per {label}:{index}")
        validated.append(value)
    return validated


def validate_zip_member(
    raw: object,
    label: str,
    *,
    exact_keys: set[str],
) -> dict[str, Any]:
    member = require_dict(raw, label)
    if set(member) != exact_keys:
        raise DatasetBuildError(f"schema membro archivio divergente per {label}")
    require_text(member.get("id"), f"{label}.id")
    name = require_text(member.get("name"), f"{label}.name")
    member_path = PurePosixPath(name)
    if (
        member_path.is_absolute()
        or ".." in member_path.parts
        or "\\" in name
        or "\x00" in name
        or name.endswith("/")
    ):
        raise DatasetBuildError(f"nome membro archivio non sicuro per {label}")
    require_int(member.get("bytes"), f"{label}.bytes", minimum=1)
    require_int(member.get("compressedBytes"), f"{label}.compressedBytes", minimum=1)
    require_crc32(member.get("crc32"), f"{label}.crc32")
    require_int(member.get("flagBits"), f"{label}.flagBits")
    require_int(member.get("compression"), f"{label}.compression")
    return member


def validate_catalog_inspection(
    raw: object,
    label: str,
    *,
    source_count: int,
    expected_rows: int,
    source_rows: list[int],
) -> dict[str, Any]:
    inspection = require_dict(raw, label)
    if require_int(inspection.get("schemaVersion"), f"{label}.schemaVersion") != 1:
        raise DatasetBuildError(f"schemaVersion inspection non supportata per {label}")
    kind = require_text(inspection.get("kind"), f"{label}.kind")
    if kind not in CATALOG_INSPECTION_KINDS:
        raise DatasetBuildError(f"kind inspection non supportato per {label}: {kind}")
    validate_inspection_totals(inspection, label, expected_rows=expected_rows)
    files = require_list(inspection.get("files"), f"{label}.files")
    validated_files = validate_inspection_file_ids(files, label, source_count)

    common_keys = {
        "schemaVersion", "kind", "rows", "validRows", "malformedRows", "files",
    }
    observed_rows = 0
    observed_valid = 0
    observed_malformed = 0
    if kind == "delimited-set":
        if set(inspection) != common_keys:
            raise DatasetBuildError(f"schema inspection delimited divergente per {label}")
        for index, value in enumerate(validated_files):
            allowed = {
                "id", "encoding", "delimiter", "columns", "headerSha256",
                "rows", "validRows", "malformedRows",
            }
            terminal = value.get("terminalFragment")
            if terminal is not None:
                allowed.add("terminalFragment")
            if set(value) != allowed:
                raise DatasetBuildError(f"schema file delimited divergente per {label}:{index + 1}")
            if value.get("encoding") not in {"utf-8-sig", "latin-1"}:
                raise DatasetBuildError(f"encoding inspection non supportato per {label}:{index + 1}")
            parse_delimiter(value.get("delimiter"), f"{label}.files[{index}].delimiter")
            require_int(value.get("columns"), f"{label}.files[{index}].columns", minimum=1)
            require_sha256(value.get("headerSha256"), f"{label}.files[{index}].headerSha256")
            validate_inspection_totals(
                value,
                f"{label}.files[{index}]",
                expected_rows=source_rows[index],
            )
            malformed = value["malformedRows"]
            if malformed not in {0, 1}:
                raise DatasetBuildError(f"frammenti malformed inattesi per {label}:{index + 1}")
            if malformed:
                fragment = require_dict(terminal, f"{label}.files[{index}].terminalFragment")
                if set(fragment) != {"bytes", "sha256"}:
                    raise DatasetBuildError(f"schema frammento terminale divergente per {label}:{index + 1}")
                require_int(fragment.get("bytes"), f"{label}.files[{index}].terminalFragment.bytes", minimum=1)
                require_sha256(fragment.get("sha256"), f"{label}.files[{index}].terminalFragment.sha256")
            elif terminal is not None:
                raise DatasetBuildError(f"frammento terminale inatteso per {label}:{index + 1}")
            observed_rows += value["rows"]
            observed_valid += value["validRows"]
            observed_malformed += malformed
    elif kind == "zip-delimited-set":
        if set(inspection) != common_keys | {
            "encoding", "delimiter", "maxTotalUncompressedBytes",
        } or source_count != 1:
            raise DatasetBuildError(f"schema inspection ZIP CSV divergente per {label}")
        if inspection.get("encoding") not in {"utf-8-sig", "latin-1"}:
            raise DatasetBuildError(f"encoding ZIP CSV non supportato per {label}")
        parse_delimiter(inspection.get("delimiter"), f"{label}.delimiter")
        maximum = require_int(
            inspection.get("maxTotalUncompressedBytes"),
            f"{label}.maxTotalUncompressedBytes",
            minimum=1,
        )
        file_value = validated_files[0]
        if set(file_value) != {"id", "rows", "validRows", "malformedRows", "members"}:
            raise DatasetBuildError(f"schema file ZIP CSV divergente per {label}")
        validate_inspection_totals(file_value, f"{label}.files[0]", expected_rows=source_rows[0])
        if file_value["malformedRows"] != 0:
            raise DatasetBuildError(f"record malformed ZIP CSV inattesi per {label}")
        members = require_list(file_value.get("members"), f"{label}.files[0].members")
        if not members:
            raise DatasetBuildError(f"membri ZIP CSV mancanti per {label}")
        member_names: list[str] = []
        member_bytes = 0
        member_rows = 0
        for index, raw_member in enumerate(members, start=1):
            member = validate_zip_member(
                raw_member,
                f"{label}.files[0].members[{index - 1}]",
                exact_keys={
                    "id", "name", "bytes", "compressedBytes", "crc32", "flagBits",
                    "compression", "rows", "physicalDataLines", "columns", "headerSha256",
                },
            )
            if member["id"] != f"member-{index:04d}":
                raise DatasetBuildError(f"id membro ZIP CSV divergente per {label}:{index}")
            require_int(member.get("rows"), f"{label}.member[{index}].rows")
            physical_lines = require_int(
                member.get("physicalDataLines"), f"{label}.member[{index}].physicalDataLines"
            )
            if physical_lines < member["rows"]:
                raise DatasetBuildError(f"linee fisiche ZIP CSV divergenti per {label}:{index}")
            require_int(member.get("columns"), f"{label}.member[{index}].columns", minimum=1)
            require_sha256(member.get("headerSha256"), f"{label}.member[{index}].headerSha256")
            member_names.append(member["name"])
            member_bytes += member["bytes"]
            member_rows += member["rows"]
        if member_names != sorted(set(member_names)):
            raise DatasetBuildError(f"membri ZIP CSV non ordinati o duplicati per {label}")
        if member_bytes != maximum or member_rows != file_value["rows"]:
            raise DatasetBuildError(f"totali membri ZIP CSV divergenti per {label}")
        observed_rows = file_value["rows"]
        observed_valid = file_value["validRows"]
        observed_malformed = file_value["malformedRows"]
    elif kind == "zip-xls":
        if set(inspection) != common_keys | {"maxTotalUncompressedBytes"} or source_count != 1:
            raise DatasetBuildError(f"schema inspection ZIP XLS divergente per {label}")
        maximum = require_int(
            inspection.get("maxTotalUncompressedBytes"),
            f"{label}.maxTotalUncompressedBytes",
            minimum=1,
        )
        value = validated_files[0]
        if set(value) != {"id", "rows", "validRows", "malformedRows", "member", "sheet"}:
            raise DatasetBuildError(f"schema file ZIP XLS divergente per {label}")
        validate_inspection_totals(value, f"{label}.files[0]", expected_rows=source_rows[0])
        if value["malformedRows"] != 0:
            raise DatasetBuildError(f"righe malformed XLS inattese per {label}")
        member = validate_zip_member(
            value.get("member"),
            f"{label}.files[0].member",
            exact_keys={
                "id", "name", "bytes", "compressedBytes", "crc32", "flagBits",
                "compression", "sha256",
            },
        )
        if member["id"] != "member-0001" or member["bytes"] != maximum:
            raise DatasetBuildError(f"membro XLS divergente per {label}")
        require_sha256(member.get("sha256"), f"{label}.files[0].member.sha256")
        sheet = require_dict(value.get("sheet"), f"{label}.files[0].sheet")
        if set(sheet) != {
            "index", "name", "count", "headerRows", "physicalRows", "rows",
            "columns", "headerSha256",
        }:
            raise DatasetBuildError(f"schema foglio XLS divergente per {label}")
        require_int(sheet.get("index"), f"{label}.sheet.index")
        require_text(sheet.get("name"), f"{label}.sheet.name")
        require_int(sheet.get("count"), f"{label}.sheet.count", minimum=1)
        header_rows = require_int(sheet.get("headerRows"), f"{label}.sheet.headerRows", minimum=1)
        physical_rows = require_int(sheet.get("physicalRows"), f"{label}.sheet.physicalRows", minimum=1)
        require_int(sheet.get("rows"), f"{label}.sheet.rows")
        require_int(sheet.get("columns"), f"{label}.sheet.columns", minimum=1)
        require_sha256(sheet.get("headerSha256"), f"{label}.sheet.headerSha256")
        if physical_rows != header_rows + sheet["rows"] or sheet["rows"] != value["rows"]:
            raise DatasetBuildError(f"cardinalita foglio XLS divergente per {label}")
        observed_rows = value["rows"]
        observed_valid = value["validRows"]
        observed_malformed = value["malformedRows"]
    else:
        if set(inspection) != common_keys | {"maxTotalUncompressedBytes"} or source_count != 1:
            raise DatasetBuildError(f"schema inspection XLSX divergente per {label}")
        maximum = require_int(
            inspection.get("maxTotalUncompressedBytes"),
            f"{label}.maxTotalUncompressedBytes",
            minimum=1,
        )
        value = validated_files[0]
        if set(value) != {
            "id", "rows", "validRows", "malformedRows", "archiveMembers", "sheet",
        }:
            raise DatasetBuildError(f"schema file XLSX divergente per {label}")
        validate_inspection_totals(value, f"{label}.files[0]", expected_rows=source_rows[0])
        if value["malformedRows"] != 0:
            raise DatasetBuildError(f"righe malformed XLSX inattese per {label}")
        members = require_list(value.get("archiveMembers"), f"{label}.files[0].archiveMembers")
        names: list[str] = []
        total_bytes = 0
        for index, raw_member in enumerate(members, start=1):
            member = validate_zip_member(
                raw_member,
                f"{label}.files[0].archiveMembers[{index - 1}]",
                exact_keys={
                    "id", "name", "bytes", "compressedBytes", "crc32", "flagBits",
                    "compression",
                },
            )
            if member["id"] != f"member-{index:04d}":
                raise DatasetBuildError(f"id membro XLSX divergente per {label}:{index}")
            names.append(member["name"])
            total_bytes += member["bytes"]
        if names != sorted(set(names)) or total_bytes != maximum:
            raise DatasetBuildError(f"membri XLSX divergenti per {label}")
        sheet = require_dict(value.get("sheet"), f"{label}.files[0].sheet")
        if set(sheet) != {
            "index", "name", "count", "headerRows", "physicalRows", "rows",
            "columns", "dimension", "headerSha256",
        }:
            raise DatasetBuildError(f"schema foglio XLSX divergente per {label}")
        require_int(sheet.get("index"), f"{label}.sheet.index")
        require_text(sheet.get("name"), f"{label}.sheet.name")
        require_int(sheet.get("count"), f"{label}.sheet.count", minimum=1)
        header_rows = require_int(sheet.get("headerRows"), f"{label}.sheet.headerRows", minimum=1)
        physical_rows = require_int(sheet.get("physicalRows"), f"{label}.sheet.physicalRows", minimum=1)
        require_int(sheet.get("rows"), f"{label}.sheet.rows")
        require_int(sheet.get("columns"), f"{label}.sheet.columns", minimum=1)
        require_text(sheet.get("dimension"), f"{label}.sheet.dimension")
        require_sha256(sheet.get("headerSha256"), f"{label}.sheet.headerSha256")
        if physical_rows != header_rows + sheet["rows"] or sheet["rows"] != value["rows"]:
            raise DatasetBuildError(f"cardinalita foglio XLSX divergente per {label}")
        observed_rows = value["rows"]
        observed_valid = value["validRows"]
        observed_malformed = value["malformedRows"]

    if (
        observed_rows != inspection["rows"]
        or observed_valid != inspection["validRows"]
        or observed_malformed != inspection["malformedRows"]
    ):
        raise DatasetBuildError(f"totali file inspection divergenti per {label}")
    return inspection


def inspection_receipt_projection(inspection: dict[str, Any]) -> dict[str, Any]:
    """Return a path-free inspection commitment suitable for a public receipt."""

    def project(value: object) -> object:
        if isinstance(value, dict):
            return {
                key: project(item)
                for key, item in value.items()
                if key != "name"
            }
        if isinstance(value, list):
            return [project(item) for item in value]
        return value

    projected = require_dict(project(inspection), "inspection projection")
    projected["contractSha256"] = sha256_bytes(canonical_json(inspection))
    projected["sha256"] = sha256_bytes(canonical_json(projected))
    return projected


def validate_source_metadata(
    raw: object,
    dataset_ids: set[str],
) -> tuple[dict[str, Any], dict[str, dict[str, Any]]]:
    metadata = require_dict(raw, "sourceMetadata")
    if set(metadata) != {"default", "overrides"}:
        raise DatasetBuildError("sourceMetadata deve contenere default e overrides")
    default = require_dict(metadata.get("default"), "sourceMetadata.default")
    if set(default) != SOURCE_METADATA_KEYS:
        raise DatasetBuildError("campi sourceMetadata.default divergenti")
    require_text(default.get("holder"), "sourceMetadata.default.holder")
    for key in ("referencePeriod", "updateFrequency"):
        value = default.get(key)
        if value is not None:
            require_text(value, f"sourceMetadata.default.{key}")
    for key in ("publicationDate", "acquisitionDate", "checkedAt"):
        value = default.get(key)
        if value is not None and (
            not isinstance(value, str) or DATE_RE.fullmatch(value) is None
        ):
            raise DatasetBuildError(f"sourceMetadata.default.{key} non e una data ISO")
    if default.get("checkedAt") is None:
        raise DatasetBuildError("sourceMetadata.default.checkedAt e obbligatorio")
    urls = require_list(default.get("canonicalUrls"), "sourceMetadata.default.canonicalUrls")
    if any(not isinstance(url, str) or not is_safe_public_url(url) for url in urls):
        raise DatasetBuildError("sourceMetadata.default.canonicalUrls contiene URL non sicuri")
    if urls != sorted(set(urls)):
        raise DatasetBuildError("sourceMetadata.default.canonicalUrls deve essere ordinato e unico")

    raw_overrides = require_dict(metadata.get("overrides"), "sourceMetadata.overrides")
    unknown_ids = sorted(set(raw_overrides) - dataset_ids)
    if unknown_ids:
        raise DatasetBuildError(
            "sourceMetadata.overrides contiene dataset sconosciuti: " + ", ".join(unknown_ids)
        )
    overrides: dict[str, dict[str, Any]] = {}
    for dataset_id, raw_override in raw_overrides.items():
        override = require_dict(raw_override, f"sourceMetadata.overrides.{dataset_id}")
        if not set(override).issubset(SOURCE_METADATA_OVERRIDE_KEYS):
            raise DatasetBuildError(
                f"campi sourceMetadata.overrides.{dataset_id} non supportati"
            )
        if "holder" in override:
            require_text(override["holder"], f"sourceMetadata.overrides.{dataset_id}.holder")
        if "referencePeriod" in override and override["referencePeriod"] is not None:
            require_text(
                override["referencePeriod"],
                f"sourceMetadata.overrides.{dataset_id}.referencePeriod",
            )
        if "canonicalUrls" in override:
            override_urls = require_list(
                override["canonicalUrls"],
                f"sourceMetadata.overrides.{dataset_id}.canonicalUrls",
            )
            if any(
                not isinstance(url, str) or not is_safe_public_url(url)
                for url in override_urls
            ):
                raise DatasetBuildError(
                    f"sourceMetadata.overrides.{dataset_id}.canonicalUrls contiene URL non sicuri"
                )
            if override_urls != sorted(set(override_urls)):
                raise DatasetBuildError(
                    f"sourceMetadata.overrides.{dataset_id}.canonicalUrls deve essere ordinato e unico"
                )
        overrides[dataset_id] = override
    return default, overrides


def resolved_source_metadata(spec: dict[str, Any], dataset_id: str) -> dict[str, Any]:
    default = require_dict(spec["sourceMetadata"]["default"], "sourceMetadata.default")
    overrides = require_dict(spec["sourceMetadata"]["overrides"], "sourceMetadata.overrides")
    override = require_dict(overrides.get(dataset_id, {}), f"sourceMetadata.{dataset_id}")
    return {**default, **override}


def validate_spec(spec: dict[str, Any]) -> list[dict[str, Any]]:
    if require_int(spec.get("schemaVersion"), "schemaVersion") != 1:
        raise DatasetBuildError("schemaVersion non supportata")
    corpus = require_dict(spec.get("corpusContract"), "corpusContract")
    if (
        corpus.get("elements") != 51_303
        or corpus.get("regularFiles") != 46_438
        or corpus.get("hardlinks") != 4_860
        or corpus.get("symlinks") != 5
    ):
        raise DatasetBuildError("contratto globale del corpus divergente")
    generated_at = require_text(spec.get("generatedAt"), "generatedAt")
    if not re.fullmatch(r"\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}Z", generated_at):
        raise DatasetBuildError("generatedAt non e un timestamp UTC")

    datasets = require_list(spec.get("datasets"), "datasets")
    if not datasets:
        raise DatasetBuildError("datasets vuoto")
    seen_ids: set[str] = set()
    seen_paths: set[str] = set()
    validated: list[dict[str, Any]] = []
    for index, raw in enumerate(datasets):
        item = require_dict(raw, f"datasets[{index}]")
        dataset_id = require_text(item.get("id"), f"datasets[{index}].id")
        if not DATASET_ID_RE.fullmatch(dataset_id) or dataset_id in seen_ids:
            raise DatasetBuildError(f"dataset id non valido o duplicato: {dataset_id}")
        seen_ids.add(dataset_id)
        for key in ("title", "domain", "authority", "licenseStatus"):
            require_text(item.get(key), f"datasets[{index}].{key}")
        publication = require_text(item.get("publication"), f"datasets[{index}].publication")
        if publication not in PUBLICATIONS:
            raise DatasetBuildError(f"publication non supportata: {publication}")
        evidence_label = require_text(item.get("evidenceLabel"), f"datasets[{index}].evidenceLabel")
        if evidence_label not in EVIDENCE_LABELS:
            raise DatasetBuildError(f"evidenceLabel non supportata: {evidence_label}")

        expected = require_dict(item.get("expected"), f"datasets[{index}].expected")
        require_int(expected.get("bytes"), f"datasets[{index}].expected.bytes", minimum=1)
        require_int(expected.get("rows"), f"datasets[{index}].expected.rows")
        source_sha = require_text(expected.get("sha256"), f"datasets[{index}].expected.sha256")
        if not SHA256_RE.fullmatch(source_sha):
            raise DatasetBuildError(f"SHA-256 non valido per {dataset_id}")

        has_single_source = "relativePath" in item
        has_source_set = "sources" in item
        if has_single_source == has_source_set:
            raise DatasetBuildError(
                f"{dataset_id} deve dichiarare esattamente relativePath oppure sources"
            )
        if has_single_source:
            declared_source_rows = [expected["rows"]]
            relative_path = validate_relative_source_path(
                item.get("relativePath"), f"datasets[{index}].relativePath"
            )
            if relative_path in seen_paths:
                raise DatasetBuildError(f"source path duplicato: {relative_path}")
            seen_paths.add(relative_path)
        else:
            raw_sources = require_list(item.get("sources"), f"datasets[{index}].sources")
            if len(raw_sources) < 2:
                raise DatasetBuildError(f"source set troppo piccolo per {dataset_id}")
            source_rows = 0
            declared_source_rows = []
            source_bytes = 0
            ordered_paths: list[str] = []
            for source_index, raw_source in enumerate(raw_sources):
                source = require_dict(
                    raw_source,
                    f"datasets[{index}].sources[{source_index}]",
                )
                if set(source) != {"relativePath", "expected"}:
                    raise DatasetBuildError(
                        f"schema source set divergente per {dataset_id}:{source_index + 1}"
                    )
                relative_path = validate_relative_source_path(
                    source.get("relativePath"),
                    f"datasets[{index}].sources[{source_index}].relativePath",
                )
                if relative_path in seen_paths:
                    raise DatasetBuildError(f"source path duplicato: {relative_path}")
                seen_paths.add(relative_path)
                ordered_paths.append(relative_path)
                source_expected = require_dict(
                    source.get("expected"),
                    f"datasets[{index}].sources[{source_index}].expected",
                )
                if set(source_expected) != {"bytes", "sha256", "rows"}:
                    raise DatasetBuildError(
                        f"schema expected source divergente per {dataset_id}:{source_index + 1}"
                    )
                source_bytes += require_int(
                    source_expected.get("bytes"),
                    f"datasets[{index}].sources[{source_index}].expected.bytes",
                    minimum=1,
                )
                part_rows = require_int(
                    source_expected.get("rows"),
                    f"datasets[{index}].sources[{source_index}].expected.rows",
                )
                source_rows += part_rows
                declared_source_rows.append(part_rows)
                part_sha = require_text(
                    source_expected.get("sha256"),
                    f"datasets[{index}].sources[{source_index}].expected.sha256",
                )
                if not SHA256_RE.fullmatch(part_sha):
                    raise DatasetBuildError(
                        f"SHA-256 source set non valido per {dataset_id}:{source_index + 1}"
                    )
            if ordered_paths != sorted(ordered_paths):
                raise DatasetBuildError(f"sources non ordinate per {dataset_id}")
            if source_bytes != expected["bytes"] or source_rows != expected["rows"]:
                raise DatasetBuildError(f"totali source set divergenti per {dataset_id}")
            if source_set_sha256(item) != expected["sha256"]:
                raise DatasetBuildError(f"hash source set divergente per {dataset_id}")

        data_kind = require_text(item.get("dataKind"), f"datasets[{index}].dataKind")
        if data_kind in {
            "delimited",
            "delimited-edge-split",
            "json-object-items",
            "catalog-file",
        }:
            if data_kind in {"delimited", "delimited-edge-split"}:
                parse_delimiter(item.get("delimiter"), f"datasets[{index}].delimiter")
            headers = require_list(expected.get("headers"), f"datasets[{index}].expected.headers")
            if not headers or any(not isinstance(header, str) or not header for header in headers):
                raise DatasetBuildError(f"header non validi per {dataset_id}")
            if len(set(headers)) != len(headers) or expected.get("columns") != len(headers):
                raise DatasetBuildError(f"numero o identita colonne divergente per {dataset_id}")
            if data_kind == "json-object-items":
                if has_source_set:
                    raise DatasetBuildError(
                        f"json-object-items multi-file non supportato per {dataset_id}"
                    )
                items_field = require_text(
                    item.get("itemsField"), f"datasets[{index}].itemsField"
                )
                count_field = require_text(
                    item.get("countField"), f"datasets[{index}].countField"
                )
                if items_field == count_field:
                    raise DatasetBuildError(f"campi JSON sovrapposti per {dataset_id}")
                object_keys = require_list(
                    expected.get("objectKeys"),
                    f"datasets[{index}].expected.objectKeys",
                )
                if (
                    not object_keys
                    or any(not isinstance(key, str) or not key for key in object_keys)
                    or object_keys != sorted(set(object_keys))
                    or items_field not in object_keys
                    or count_field not in object_keys
                ):
                    raise DatasetBuildError(f"chiavi oggetto JSON divergenti per {dataset_id}")
            if data_kind == "delimited-edge-split":
                edge_split = require_dict(
                    item.get("edgeSplit"), f"datasets[{index}].edgeSplit"
                )
                if set(edge_split) != {"left", "right"}:
                    raise DatasetBuildError(
                        f"schema edgeSplit divergente per {dataset_id}"
                    )
                left = require_int(
                    edge_split.get("left"),
                    f"datasets[{index}].edgeSplit.left",
                    minimum=1,
                )
                right = require_int(
                    edge_split.get("right"),
                    f"datasets[{index}].edgeSplit.right",
                    minimum=1,
                )
                if left + right + 1 != len(headers):
                    raise DatasetBuildError(
                        f"edgeSplit non chiude lo schema per {dataset_id}"
                    )
            if data_kind == "catalog-file":
                if publication not in {"catalog-only", "derived-only"}:
                    raise DatasetBuildError(
                        f"catalog-file non pubblicabile per righe in {dataset_id}"
                    )
                if "reportedColumns" in expected:
                    require_int(
                        expected.get("reportedColumns"),
                        f"datasets[{index}].expected.reportedColumns",
                        minimum=1,
                    )
                if "reportedFiles" in expected:
                    require_int(
                        expected.get("reportedFiles"),
                        f"datasets[{index}].expected.reportedFiles",
                        minimum=1,
                    )
                validate_catalog_inspection(
                    item.get("inspection"),
                    f"datasets[{index}].inspection",
                    source_count=len(declared_source_rows),
                    expected_rows=expected["rows"],
                    source_rows=declared_source_rows,
                )
        elif data_kind == "json-object":
            if expected.get("columns") is not None or expected.get("headers") is not None:
                raise DatasetBuildError(f"schema tabellare inatteso per {dataset_id}")
        else:
            raise DatasetBuildError(f"dataKind non supportato: {data_kind}")
        if data_kind != "catalog-file" and "inspection" in item:
            raise DatasetBuildError(f"inspection inattesa per {dataset_id}")

        source_fields = require_list(item.get("sourceFields"), f"datasets[{index}].sourceFields")
        private_fields = require_list(item.get("privateFields"), f"datasets[{index}].privateFields")
        caveats = require_list(item.get("caveats"), f"datasets[{index}].caveats")
        if any(not isinstance(value, str) or not value for value in source_fields + private_fields + caveats):
            raise DatasetBuildError(f"metadati testuali non validi per {dataset_id}")
        if data_kind in {
            "delimited",
            "delimited-edge-split",
            "json-object-items",
            "catalog-file",
        }:
            header_set = set(expected["headers"])
            if not set(source_fields).issubset(header_set) or not set(private_fields).issubset(header_set):
                raise DatasetBuildError(f"campo dichiarato non presente nello schema di {dataset_id}")
            if data_kind == "catalog-file" and (source_fields or private_fields):
                raise DatasetBuildError(
                    f"catalog-file non espone campi riga per {dataset_id}"
                )
        overlapping_fields = sorted(set(source_fields) & set(private_fields))
        if overlapping_fields:
            raise DatasetBuildError(
                f"sourceFields e privateFields devono essere disgiunti per {dataset_id}: "
                + ", ".join(overlapping_fields)
            )
        validated.append(item)
    validate_source_metadata(spec.get("sourceMetadata"), seen_ids)
    return validated


def load_spec(path: Path) -> tuple[dict[str, Any], list[dict[str, Any]]]:
    try:
        spec = json.loads(path.read_text(encoding="utf-8"))
    except (OSError, UnicodeDecodeError, json.JSONDecodeError) as error:
        raise DatasetBuildError(f"source spec illeggibile: {path}") from error
    if not isinstance(spec, dict):
        raise DatasetBuildError("source spec deve essere un oggetto")
    return spec, validate_spec(spec)


def query_key_is_sensitive(key: str) -> bool:
    compact = re.sub(r"[^a-z0-9]+", "", key.casefold())
    tokens = set(re.findall(r"[a-z0-9]+", key.casefold()))
    return (
        compact in SENSITIVE_QUERY_KEYS
        or is_strong_credential_key(key)
        or compact.endswith(SENSITIVE_QUERY_SUFFIXES)
        or bool(tokens & SENSITIVE_QUERY_KEYS)
    )


def percent_decoded_layers(value: str) -> tuple[tuple[str, ...], bool]:
    """Decode to stability within a fixed ceiling and retain the terminal layer."""

    layers = [value]
    decoded = value
    for _ in range(MAX_PERCENT_DECODE_PASSES):
        next_value = unquote(decoded)
        if next_value == decoded:
            return tuple(layers), True
        layers.append(next_value)
        decoded = next_value
    return tuple(layers), unquote(decoded) == decoded


def contains_nested_sensitive_query(value: str) -> bool:
    """Reject sensitive assignments hidden in encoded callback/query values."""

    layers, stable = percent_decoded_layers(value)
    if not stable:
        return True
    for decoded in layers:
        if any(query_key_is_sensitive(match.group(1)) for match in NESTED_QUERY_KEY_RE.finditer(decoded)):
            return True
    return False


def contains_workstation_path(value: str) -> bool:
    """Reject local workstation paths, including recursively encoded forms."""

    layers, stable = percent_decoded_layers(value)
    if not stable:
        return True
    return any(
        LOCAL_FILE_URL_RE.search(layer) is not None
        or UNC_WORKSTATION_PATH_RE.search(layer) is not None
        or WINDOWS_WORKSTATION_PATH_RE.search(layer) is not None
        or ABSOLUTE_INTERNAL_RE.search(layer) is not None
        or ENCODED_WORKSTATION_PATH_RE.search(layer) is not None
        for layer in layers
    )


def contains_url_path_workstation_prefix(value: str) -> bool:
    """Reject only canonical workstation prefixes in a public URL path."""

    layers, stable = percent_decoded_layers(value)
    if not stable:
        return True
    for index, layer in enumerate(layers):
        path_payload = layer.lstrip("/")
        if (
            LOCAL_FILE_URL_RE.search(path_payload) is not None
            or UNC_WORKSTATION_PATH_RE.search(path_payload) is not None
            or (
                re.match(r"^[A-Za-z]:[\\/]", path_payload) is not None
                and WINDOWS_WORKSTATION_PATH_RE.search(path_payload) is not None
            )
        ):
            return True
        if URL_PATH_WORKSTATION_PREFIX_RE.search(layer) is not None:
            return True
        # Lowercase `/home/...` is also a common institutional web route. It is
        # workstation material only when percent decoding reveals the prefix.
        if index > 0 and URL_PATH_ENCODED_HOME_PREFIX_RE.search(layer) is not None:
            return True
    return False


def contains_redactable_workstation_reference(value: str) -> bool:
    """Detect the workstation path classes that must never enter a public cell."""

    return (
        RAW_WORKSTATION_REFERENCE_RE.search(value) is not None
        or DECODED_FORWARD_UNC_REFERENCE_RE.search(value) is not None
    )


def contains_encoded_public_cell_hazard(value: str) -> bool:
    """Detect recursively encoded local paths or credential assignments."""

    for match in PERCENT_ENCODED_TOKEN_RE.finditer(value):
        layers, stable = percent_decoded_layers(match.group(2))
        if (
            not stable
            or any(contains_sensitive_assignment(layer) for layer in layers)
            or any(contains_redactable_workstation_reference(layer) for layer in layers)
        ):
            return True
    return False


def contains_sensitive_assignment(value: str) -> bool:
    """Detect compact, separated, and camelCase secret assignments."""

    return any(
        query_key_is_sensitive(match.group("key"))
        for match in COMPACT_CREDENTIAL_ASSIGNMENT_RE.finditer(value)
    )


def is_non_public_host(host: str) -> bool:
    return is_non_public_hostname(host)


def is_safe_public_url(url: str) -> bool:
    try:
        if (
            CONTROL_OR_SPACE_RE.search(url) is not None
            or "\\" in url
            or INVALID_PERCENT_ESCAPE_RE.search(url) is not None
        ):
            return False
        parts = urlsplit(url)
        if parts.scheme.lower() not in {"http", "https"} or not parts.hostname:
            return False
        if parts.username is not None or parts.password is not None:
            return False
        port = parts.port
        try:
            host = parts.hostname.encode("idna").decode("ascii").casefold()
        except UnicodeError:
            return False
        try:
            ipaddress.ip_address(host.rstrip("."))
        except ValueError:
            if len(host) > 253 or DOMAIN_RE.fullmatch(host.rstrip(".")) is None:
                return False
        if is_non_public_host(host):
            return False
        if contains_credential_like_hostname(host, raw_authority=parts.netloc):
            return False
        has_query_or_fragment = "?" in url or "#" in url
        exact_documentation_url = is_exact_public_documentation_url(
            parts.scheme,
            parts.netloc,
            parts.path,
            has_query_or_fragment=has_query_or_fragment,
        )
        # URL path checks are case-aware so ordinary public routes such as
        # `/Home/AmministrazioneTrasparente` do not become local `/home` paths.
        if contains_url_path_workstation_prefix(parts.path):
            return False
        if not exact_documentation_url and contains_credential_like_url_component(
            parts.path,
            has_query_or_fragment=has_query_or_fragment,
            is_url_path=True,
        ):
            return False
        # Query and fragment values can carry nested local references, so their
        # path checks are intentionally broader than the public URL path check.
        if any(
            contains_workstation_path(component)
            for component in (parts.query, parts.fragment)
        ):
            return False
        key_values = [
            *parse_qsl(parts.query, keep_blank_values=True),
            *parse_qsl(parts.fragment, keep_blank_values=True),
        ]
        for key, value in key_values:
            key_layers, key_stable = percent_decoded_layers(key)
            if (
                not key_stable
                or any(query_key_is_sensitive(layer) for layer in key_layers)
                or any(
                    contains_credential_like_url_component(
                        layer,
                    )
                    for layer in key_layers
                )
                or contains_workstation_path(value)
                or contains_nested_sensitive_query(value)
                or contains_credential_like_url_component(
                    value,
                )
            ):
                return False
        return True
    except (UnicodeError, ValueError):
        return False


def extract_public_urls(values: Iterable[str]) -> list[str]:
    urls: set[str] = set()
    for value in values:
        for match in HTTP_URL_RE.findall(value):
            candidate = match.rstrip(".,)]}\"")
            if is_safe_public_url(candidate):
                urls.add(candidate)
    return sorted(urls)


def sanitize_public_cell(
    field: str,
    value: str,
    private_fields: set[str],
    private_values: set[str] | None = None,
) -> tuple[str | None, list[str]]:
    if field in private_fields and value:
        return None, ["personal-identifier"]
    reasons: list[str] = []
    sanitized = value
    unsafe_url_found = False

    def redact_unsafe_url(match: re.Match[str]) -> str:
        nonlocal unsafe_url_found
        raw = match.group(0)
        candidate = raw.rstrip(".,)]}\"'")
        suffix = raw[len(candidate):]
        if is_safe_public_url(candidate):
            return raw
        unsafe_url_found = True
        return "[URL riservato rimosso]" + suffix

    sanitized = EMBEDDED_HTTP_URL_RE.sub(redact_unsafe_url, sanitized)
    if unsafe_url_found:
        reasons.append("unsafe-url")
    if RAW_WORKSTATION_REFERENCE_RE.search(sanitized):
        sanitized = RAW_WORKSTATION_REFERENCE_RE.sub(
            lambda match: match.group(1) + "[riferimento interno rimosso]",
            sanitized,
        )
        reasons.append("internal-path")

    encoded_internal_path_found = False
    encoded_credential_found = False

    def redact_encoded_reference(match: re.Match[str]) -> str:
        nonlocal encoded_internal_path_found, encoded_credential_found
        token = match.group(2)
        layers, stable = percent_decoded_layers(token)
        if any(contains_sensitive_assignment(layer) for layer in layers):
            encoded_credential_found = True
            return match.group(1) + "[credenziale rimossa]"
        if not stable or any(
            contains_redactable_workstation_reference(layer) for layer in layers
        ):
            encoded_internal_path_found = True
            return match.group(1) + "[riferimento interno rimosso]"
        return match.group(0)

    sanitized = PERCENT_ENCODED_TOKEN_RE.sub(redact_encoded_reference, sanitized)
    if encoded_internal_path_found and "internal-path" not in reasons:
        reasons.append("internal-path")
    if encoded_credential_found:
        reasons.append("credential")
    if RELATIVE_INTERNAL_RE.search(sanitized):
        sanitized = RELATIVE_INTERNAL_RE.sub("[riferimento interno rimosso]", sanitized)
        reasons.append("internal-path")
    if INTERNAL_README_RE.search(sanitized):
        sanitized = INTERNAL_README_RE.sub("[riferimento interno rimosso]", sanitized)
        reasons.append("internal-path")
    if INTERNAL_NAME_RE.search(sanitized):
        sanitized = INTERNAL_NAME_RE.sub("[riferimento interno rimosso]", sanitized)
        reasons.append("internal-process-name")
    for private_value in sorted(private_values or set(), key=len, reverse=True):
        if private_value and private_value in sanitized:
            sanitized = sanitized.replace(private_value, "[identificativo privato rimosso]")
            reasons.append("private-value-copy")
    if CREDENTIAL_RE.search(sanitized):
        sanitized = CREDENTIAL_RE.sub("[credenziale rimossa]", sanitized)
        if "credential" not in reasons:
            reasons.append("credential")

    compact_credential_found = False

    def redact_compact_credential(match: re.Match[str]) -> str:
        nonlocal compact_credential_found
        if not query_key_is_sensitive(match.group("key")):
            return match.group(0)
        compact_credential_found = True
        return "[credenziale rimossa]"

    sanitized = COMPACT_CREDENTIAL_ASSIGNMENT_RE.sub(
        redact_compact_credential,
        sanitized,
    )
    if compact_credential_found and "credential" not in reasons:
        reasons.append("credential")
    return sanitized, reasons


def repeated_private_identifiers(
    canonical_cells: dict[str, str],
    private_fields: set[str],
) -> set[str]:
    values: set[str] = set()
    for field in private_fields:
        value = canonical_cells[field].strip()
        if (
            len(value) < 4
            or value.casefold() in NON_IDENTIFIER_MARKERS
            or re.fullmatch(r"(?:0+|x+|\*+)", value, re.IGNORECASE)
        ):
            continue
        values.add(value)
    return values


@dataclass(frozen=True)
class ParsedSource:
    id: str
    relative_path: str
    sha256: str
    bytes: int
    rows: int


@dataclass(frozen=True)
class ParsedDataset:
    headers: list[str]
    rows: list[list[str]]
    raw_sha256: str
    raw_bytes: int
    sources: list[ParsedSource]
    row_origins: list[tuple[str, int]]
    is_source_set: bool
    logical_rows: int
    inspection: dict[str, Any] | None


def read_pinned_source(path: Path, expected_bytes: int, dataset_id: str) -> bytes:
    """Read only the exact pinned regular file and cap allocation to its receipt."""

    try:
        metadata = path.lstat()
    except OSError as error:
        raise DatasetBuildError(f"sorgente illeggibile per {dataset_id}") from error
    if stat.S_ISLNK(metadata.st_mode) or not stat.S_ISREG(metadata.st_mode):
        raise DatasetBuildError(f"sorgente non regolare per {dataset_id}")
    if metadata.st_size != expected_bytes:
        raise DatasetBuildError(f"dimensione sorgente divergente per {dataset_id}")

    descriptor = -1
    flags = os.O_RDONLY | getattr(os, "O_NOFOLLOW", 0)
    try:
        descriptor = os.open(path, flags)
        opened = os.fstat(descriptor)
        if (
            not stat.S_ISREG(opened.st_mode)
            or opened.st_size != expected_bytes
            or (opened.st_dev, opened.st_ino) != (metadata.st_dev, metadata.st_ino)
        ):
            raise DatasetBuildError(f"sorgente cambiata prima della lettura per {dataset_id}")
        with os.fdopen(descriptor, "rb") as handle:
            descriptor = -1
            payload = handle.read(expected_bytes + 1)
    except DatasetBuildError:
        raise
    except OSError as error:
        raise DatasetBuildError(f"sorgente illeggibile per {dataset_id}") from error
    finally:
        if descriptor >= 0:
            os.close(descriptor)
    if len(payload) != expected_bytes:
        raise DatasetBuildError(f"dimensione sorgente divergente per {dataset_id}")
    return payload


def read_bounded_regular_file(path: Path, maximum_bytes: int, label: str) -> bytes:
    """Read a committed artifact without following links or trusting a path race."""

    if maximum_bytes < 1:
        raise DatasetBuildError(f"limite lettura non valido per {label}")
    try:
        metadata = path.lstat()
    except OSError as error:
        raise DatasetBuildError(f"artefatto illeggibile per {label}") from error
    if stat.S_ISLNK(metadata.st_mode) or not stat.S_ISREG(metadata.st_mode):
        raise DatasetBuildError(f"artefatto non regolare per {label}")
    if metadata.st_size < 1 or metadata.st_size > maximum_bytes:
        raise DatasetBuildError(f"artefatto compresso troppo grande per {label}")

    descriptor = -1
    flags = os.O_RDONLY | getattr(os, "O_NOFOLLOW", 0)
    try:
        descriptor = os.open(path, flags)
        opened = os.fstat(descriptor)
        if (
            not stat.S_ISREG(opened.st_mode)
            or opened.st_size != metadata.st_size
            or (opened.st_dev, opened.st_ino) != (metadata.st_dev, metadata.st_ino)
        ):
            raise DatasetBuildError(f"artefatto cambiato prima della lettura per {label}")
        with os.fdopen(descriptor, "rb") as handle:
            descriptor = -1
            payload = handle.read(maximum_bytes + 1)
            final = os.fstat(handle.fileno())
        if (
            len(payload) != opened.st_size
            or final.st_size != opened.st_size
            or final.st_mtime_ns != opened.st_mtime_ns
            or final.st_ctime_ns != opened.st_ctime_ns
        ):
            raise DatasetBuildError(f"artefatto cambiato durante la lettura per {label}")
    except DatasetBuildError:
        raise
    except OSError as error:
        raise DatasetBuildError(f"artefatto illeggibile per {label}") from error
    finally:
        if descriptor >= 0:
            os.close(descriptor)
    return payload


def decompress_public_row_chunk(
    compressed: bytes,
    dataset_id: str,
    ordinal: int,
) -> bytes:
    """Inflate at most the public chunk limit plus one sentinel byte."""

    label = f"{dataset_id}:{ordinal}"
    if len(compressed) > PUBLIC_ROW_CHUNK_MAX_COMPRESSED_BYTES:
        raise DatasetBuildError(f"artefatto compresso troppo grande per {label}")
    try:
        with gzip.GzipFile(fileobj=io.BytesIO(compressed), mode="rb") as handle:
            chunk = handle.read(PUBLIC_ROW_CHUNK_MAX_RAW_BYTES + 1)
    except (EOFError, gzip.BadGzipFile, OSError, zlib.error) as error:
        raise DatasetBuildError(f"chunk righe compresso illeggibile per {label}") from error
    if len(chunk) > PUBLIC_ROW_CHUNK_MAX_RAW_BYTES:
        raise DatasetBuildError(f"chunk righe troppo grande per {label}")
    return chunk


def hash_pinned_source(
    path: Path,
    expected_bytes: int,
    expected_sha256: str,
    dataset_id: str,
    *,
    chunk_bytes: int = 1024 * 1024,
) -> None:
    """Verify a pinned regular file with bounded memory, including multi-GB archives."""

    try:
        metadata = path.lstat()
    except OSError as error:
        raise DatasetBuildError(f"sorgente illeggibile per {dataset_id}") from error
    if stat.S_ISLNK(metadata.st_mode) or not stat.S_ISREG(metadata.st_mode):
        raise DatasetBuildError(f"sorgente non regolare per {dataset_id}")
    if metadata.st_size != expected_bytes:
        raise DatasetBuildError(f"dimensione sorgente divergente per {dataset_id}")
    if chunk_bytes < 1:
        raise DatasetBuildError("chunk streaming non valido")

    descriptor = -1
    digest = hashlib.sha256()
    total = 0
    flags = os.O_RDONLY | getattr(os, "O_NOFOLLOW", 0)
    try:
        descriptor = os.open(path, flags)
        opened = os.fstat(descriptor)
        if (
            not stat.S_ISREG(opened.st_mode)
            or opened.st_size != expected_bytes
            or (opened.st_dev, opened.st_ino) != (metadata.st_dev, metadata.st_ino)
        ):
            raise DatasetBuildError(f"sorgente cambiata prima della lettura per {dataset_id}")
        with os.fdopen(descriptor, "rb") as handle:
            descriptor = -1
            while True:
                chunk = handle.read(chunk_bytes)
                if not chunk:
                    break
                total += len(chunk)
                if total > expected_bytes:
                    raise DatasetBuildError(f"dimensione sorgente divergente per {dataset_id}")
                digest.update(chunk)
    except DatasetBuildError:
        raise
    except OSError as error:
        raise DatasetBuildError(f"sorgente illeggibile per {dataset_id}") from error
    finally:
        if descriptor >= 0:
            os.close(descriptor)
    if total != expected_bytes:
        raise DatasetBuildError(f"dimensione sorgente divergente per {dataset_id}")
    if digest.hexdigest() != expected_sha256:
        raise DatasetBuildError(f"byte sorgente divergenti per {dataset_id}")


@contextmanager
def open_verified_pinned_source(
    path: Path,
    expected_bytes: int,
    expected_sha256: str,
    dataset_id: str,
    *,
    chunk_bytes: int = 1024 * 1024,
) -> Iterable[Any]:
    """Hash a pinned regular file in bounded memory and inspect that same fd."""

    try:
        metadata = path.lstat()
    except OSError as error:
        raise DatasetBuildError(f"sorgente illeggibile per {dataset_id}") from error
    if stat.S_ISLNK(metadata.st_mode) or not stat.S_ISREG(metadata.st_mode):
        raise DatasetBuildError(f"sorgente non regolare per {dataset_id}")
    if metadata.st_size != expected_bytes or chunk_bytes < 1:
        raise DatasetBuildError(f"dimensione sorgente divergente per {dataset_id}")

    descriptor = -1
    flags = os.O_RDONLY | getattr(os, "O_NOFOLLOW", 0)
    try:
        descriptor = os.open(path, flags)
        opened = os.fstat(descriptor)
        if (
            not stat.S_ISREG(opened.st_mode)
            or opened.st_size != expected_bytes
            or (opened.st_dev, opened.st_ino) != (metadata.st_dev, metadata.st_ino)
        ):
            raise DatasetBuildError(f"sorgente cambiata prima della lettura per {dataset_id}")
        with os.fdopen(descriptor, "rb") as handle:
            descriptor = -1
            digest = hashlib.sha256()
            total = 0
            while True:
                chunk = handle.read(chunk_bytes)
                if not chunk:
                    break
                total += len(chunk)
                if total > expected_bytes:
                    raise DatasetBuildError(f"dimensione sorgente divergente per {dataset_id}")
                digest.update(chunk)
            if total != expected_bytes or digest.hexdigest() != expected_sha256:
                raise DatasetBuildError(f"byte sorgente divergenti per {dataset_id}")
            handle.seek(0)
            yield handle
            final = os.fstat(handle.fileno())
            if (
                final.st_size != opened.st_size
                or final.st_mtime_ns != opened.st_mtime_ns
                or final.st_ctime_ns != opened.st_ctime_ns
            ):
                raise DatasetBuildError(f"sorgente cambiata durante la lettura per {dataset_id}")
    except DatasetBuildError:
        raise
    except OSError as error:
        raise DatasetBuildError(f"sorgente illeggibile per {dataset_id}") from error
    finally:
        if descriptor >= 0:
            os.close(descriptor)


class _LimitedReader(io.RawIOBase):
    """A non-closing, bounded view over a binary stream."""

    def __init__(self, source: Any, limit: int) -> None:
        super().__init__()
        self.source = source
        self.remaining = limit
        self.consumed = 0

    def readable(self) -> bool:
        return True

    def readinto(self, target: bytearray) -> int:
        if self.remaining == 0:
            return 0
        amount = min(len(target), self.remaining)
        payload = self.source.read(amount)
        if not payload:
            return 0
        target[:len(payload)] = payload
        self.remaining -= len(payload)
        self.consumed += len(payload)
        return len(payload)


def _header_sha256(header: list[Any]) -> str:
    return sha256_bytes(canonical_json(header))


def inspect_delimited_stream(
    binary: Any,
    *,
    byte_limit: int,
    encoding: str,
    delimiter: str,
    columns: int,
    expected_valid_rows: int,
    dataset_id: str,
) -> tuple[int, int, str]:
    """Strictly recount a delimited stream while retaining only one row."""

    limited = _LimitedReader(binary, byte_limit)
    buffered = io.BufferedReader(limited, buffer_size=64 * 1024)
    text = io.TextIOWrapper(buffered, encoding=encoding, errors="strict", newline="")
    previous_limit = csv.field_size_limit()
    csv.field_size_limit(CATALOG_CSV_FIELD_LIMIT)
    try:
        reader = csv.reader(text, delimiter=delimiter, strict=True)
        try:
            header = next(reader)
        except StopIteration as error:
            raise DatasetBuildError(f"sorgente delimitata vuota per {dataset_id}") from error
        header_lines = reader.line_num
        if len(header) != columns:
            raise DatasetBuildError(f"header delimitato divergente per {dataset_id}")
        rows = 0
        for row in reader:
            rows += 1
            if rows > expected_valid_rows:
                raise DatasetBuildError(f"troppe righe delimitate per {dataset_id}")
            if len(row) != columns:
                raise DatasetBuildError(f"larghezza riga delimitata divergente per {dataset_id}:{rows}")
        physical_data_lines = reader.line_num - header_lines
    except (csv.Error, UnicodeDecodeError) as error:
        raise DatasetBuildError(f"sorgente delimitata non valida per {dataset_id}") from error
    finally:
        csv.field_size_limit(previous_limit)
        text.close()
    if limited.remaining != 0 or limited.consumed != byte_limit:
        raise DatasetBuildError(f"lettura delimitata incompleta per {dataset_id}")
    if rows != expected_valid_rows:
        raise DatasetBuildError(f"conteggio righe delimitate divergente per {dataset_id}")
    return rows, physical_data_lines, _header_sha256(header)


def terminal_fragment_is_malformed(
    payload: bytes,
    *,
    encoding: str,
    delimiter: str,
    columns: int,
) -> bool:
    try:
        text = payload.decode(encoding)
        rows = list(csv.reader(io.StringIO(text, newline=""), delimiter=delimiter, strict=True))
    except (UnicodeDecodeError, csv.Error):
        return True
    return len(rows) != 1 or len(rows[0]) != columns


def inspect_delimited_file(
    handle: Any,
    expected_bytes: int,
    config: dict[str, Any],
    dataset_id: str,
) -> dict[str, Any]:
    fragment = config.get("terminalFragment")
    parse_bytes = expected_bytes
    observed_fragment: dict[str, Any] | None = None
    if fragment is not None:
        fragment_bytes = fragment["bytes"]
        if fragment_bytes >= expected_bytes:
            raise DatasetBuildError(f"frammento terminale troppo grande per {dataset_id}")
        parse_bytes -= fragment_bytes
        handle.seek(parse_bytes)
        payload = handle.read(fragment_bytes + 1)
        if len(payload) != fragment_bytes or sha256_bytes(payload) != fragment["sha256"]:
            raise DatasetBuildError(f"frammento terminale divergente per {dataset_id}")
        handle.seek(parse_bytes - 1)
        if handle.read(1) not in {b"\n", b"\r"}:
            raise DatasetBuildError(f"confine frammento terminale divergente per {dataset_id}")
        if not terminal_fragment_is_malformed(
            payload,
            encoding=config["encoding"],
            delimiter=parse_delimiter(config["delimiter"], f"{dataset_id}.delimiter"),
            columns=config["columns"],
        ):
            raise DatasetBuildError(f"frammento terminale non malformed per {dataset_id}")
        observed_fragment = {"bytes": len(payload), "sha256": sha256_bytes(payload)}
    handle.seek(0)
    rows, _, header_sha256 = inspect_delimited_stream(
        handle,
        byte_limit=parse_bytes,
        encoding=config["encoding"],
        delimiter=parse_delimiter(config["delimiter"], f"{dataset_id}.delimiter"),
        columns=config["columns"],
        expected_valid_rows=config["validRows"],
        dataset_id=dataset_id,
    )
    malformed = 1 if observed_fragment is not None else 0
    result: dict[str, Any] = {
        "id": config["id"],
        "encoding": config["encoding"],
        "delimiter": config["delimiter"],
        "columns": config["columns"],
        "headerSha256": header_sha256,
        "rows": rows + malformed,
        "validRows": rows,
        "malformedRows": malformed,
    }
    if observed_fragment is not None:
        result["terminalFragment"] = observed_fragment
    return result


def zip_info_projection(info: zipfile.ZipInfo, member_id: str) -> dict[str, Any]:
    return {
        "id": member_id,
        "name": info.filename,
        "bytes": info.file_size,
        "compressedBytes": info.compress_size,
        "crc32": f"{info.CRC:08x}",
        "flagBits": info.flag_bits,
        "compression": info.compress_type,
    }


def inspect_zip_members(
    archive: zipfile.ZipFile,
    expected_members: list[dict[str, Any]],
    *,
    max_total_uncompressed_bytes: int,
    dataset_id: str,
) -> list[tuple[zipfile.ZipInfo, dict[str, Any]]]:
    infos = sorted(archive.infolist(), key=lambda info: info.filename)
    names = [info.filename for info in infos]
    if len(names) != len(set(names)) or len(infos) != len(expected_members):
        raise DatasetBuildError(f"insieme membri ZIP divergente per {dataset_id}")
    total = 0
    observed: list[tuple[zipfile.ZipInfo, dict[str, Any]]] = []
    for index, (info, expected) in enumerate(zip(infos, expected_members, strict=True), start=1):
        name = info.filename
        member_path = PurePosixPath(name)
        if (
            info.is_dir()
            or member_path.is_absolute()
            or ".." in member_path.parts
            or "\\" in name
            or "\x00" in name
            or info.flag_bits & 1
            or info.compress_type not in {zipfile.ZIP_STORED, zipfile.ZIP_DEFLATED}
        ):
            raise DatasetBuildError(f"membro ZIP non sicuro per {dataset_id}:{index}")
        projection = zip_info_projection(info, expected["id"])
        expected_projection = {
            key: expected[key]
            for key in projection
        }
        if projection != expected_projection:
            raise DatasetBuildError(f"metadati membro ZIP divergenti per {dataset_id}:{index}")
        total += info.file_size
        if total > max_total_uncompressed_bytes:
            raise DatasetBuildError(f"limite decompressione ZIP superato per {dataset_id}")
        observed.append((info, projection))
    if total != max_total_uncompressed_bytes:
        raise DatasetBuildError(f"dimensione decompressa ZIP divergente per {dataset_id}")
    return observed


def inspect_zip_delimited_file(
    handle: Any,
    config: dict[str, Any],
    dataset_id: str,
) -> dict[str, Any]:
    file_config = config["files"][0]
    try:
        with zipfile.ZipFile(handle) as archive:
            inspected = inspect_zip_members(
                archive,
                file_config["members"],
                max_total_uncompressed_bytes=config["maxTotalUncompressedBytes"],
                dataset_id=dataset_id,
            )
            members: list[dict[str, Any]] = []
            valid_rows = 0
            for index, ((info, metadata), member_config) in enumerate(
                zip(inspected, file_config["members"], strict=True), start=1
            ):
                with archive.open(info, "r") as member_stream:
                    rows, physical_lines, header_sha256 = inspect_delimited_stream(
                        member_stream,
                        byte_limit=info.file_size,
                        encoding=config["encoding"],
                        delimiter=parse_delimiter(config["delimiter"], f"{dataset_id}.delimiter"),
                        columns=member_config["columns"],
                        expected_valid_rows=member_config["rows"],
                        dataset_id=f"{dataset_id}:member-{index:04d}",
                    )
                members.append({
                    **metadata,
                    "rows": rows,
                    "physicalDataLines": physical_lines,
                    "columns": member_config["columns"],
                    "headerSha256": header_sha256,
                })
                valid_rows += rows
    except (zipfile.BadZipFile, zipfile.LargeZipFile, RuntimeError) as error:
        raise DatasetBuildError(f"ZIP non valido per {dataset_id}") from error
    return {
        "id": file_config["id"],
        "rows": valid_rows,
        "validRows": valid_rows,
        "malformedRows": 0,
        "members": members,
    }


def import_pinned_xlrd(dataset_id: str) -> Any:
    try:
        installed = importlib_metadata.version("xlrd")
        xlrd = __import__("xlrd")
    except (ImportError, importlib_metadata.PackageNotFoundError) as error:
        raise DatasetBuildError(f"dipendenza xlrd mancante per {dataset_id}") from error
    if installed != XLRD_VERSION or getattr(xlrd, "__version__", None) != XLRD_VERSION:
        raise DatasetBuildError(f"versione xlrd divergente per {dataset_id}")
    return xlrd


def xlrd_header_value(cell: Any, xlrd: Any) -> object:
    if cell.ctype in {xlrd.XL_CELL_EMPTY, xlrd.XL_CELL_BLANK}:
        return None
    if cell.ctype == xlrd.XL_CELL_BOOLEAN:
        return bool(cell.value)
    if cell.ctype == xlrd.XL_CELL_NUMBER and float(cell.value).is_integer():
        return int(cell.value)
    return cell.value


def inspect_zip_xls_file(handle: Any, config: dict[str, Any], dataset_id: str) -> dict[str, Any]:
    file_config = config["files"][0]
    member_config = file_config["member"]
    try:
        with zipfile.ZipFile(handle) as archive:
            inspected = inspect_zip_members(
                archive,
                [member_config],
                max_total_uncompressed_bytes=config["maxTotalUncompressedBytes"],
                dataset_id=dataset_id,
            )
            info, metadata = inspected[0]
            with archive.open(info, "r") as member_stream:
                payload = member_stream.read(info.file_size + 1)
            if len(payload) != info.file_size:
                raise DatasetBuildError(f"lettura XLS incompleta per {dataset_id}")
    except (zipfile.BadZipFile, zipfile.LargeZipFile, RuntimeError) as error:
        raise DatasetBuildError(f"ZIP XLS non valido per {dataset_id}") from error
    digest = sha256_bytes(payload)
    if digest != member_config["sha256"]:
        raise DatasetBuildError(f"hash XLS interno divergente per {dataset_id}")
    xlrd = import_pinned_xlrd(dataset_id)
    try:
        workbook = xlrd.open_workbook(file_contents=payload, on_demand=True)
        sheet_config = file_config["sheet"]
        if workbook.nsheets != sheet_config["count"]:
            raise DatasetBuildError(f"numero fogli XLS divergente per {dataset_id}")
        sheet = workbook.sheet_by_index(sheet_config["index"])
        header = [xlrd_header_value(sheet.cell(0, column), xlrd) for column in range(sheet.ncols)]
        observed_sheet = {
            "index": sheet_config["index"],
            "name": sheet.name,
            "count": workbook.nsheets,
            "headerRows": 1,
            "physicalRows": sheet.nrows,
            "rows": max(sheet.nrows - 1, 0),
            "columns": sheet.ncols,
            "headerSha256": _header_sha256(header),
        }
    except (IndexError, ValueError, TypeError) as error:
        raise DatasetBuildError(f"foglio XLS non valido per {dataset_id}") from error
    finally:
        if "workbook" in locals():
            workbook.release_resources()
    return {
        "id": file_config["id"],
        "rows": observed_sheet["rows"],
        "validRows": observed_sheet["rows"],
        "malformedRows": 0,
        "member": {**metadata, "sha256": digest},
        "sheet": observed_sheet,
    }


def safe_xml(payload: bytes, dataset_id: str, member: str) -> ElementTree.Element:
    upper = payload.upper()
    if b"<!DOCTYPE" in upper or b"<!ENTITY" in upper:
        raise DatasetBuildError(f"costrutto XML non sicuro per {dataset_id}:{member}")
    try:
        return ElementTree.fromstring(payload)
    except ElementTree.ParseError as error:
        raise DatasetBuildError(f"XML non valido per {dataset_id}:{member}") from error


def local_xml_name(tag: str) -> str:
    return tag.rsplit("}", 1)[-1]


def xlsx_column_number(reference: str) -> int:
    match = XLSX_CELL_RE.fullmatch(reference)
    if match is None:
        raise DatasetBuildError(f"riferimento cella XLSX non valido: {reference}")
    number = 0
    for character in match.group("column"):
        number = number * 26 + ord(character) - ord("A") + 1
    return number


def xlsx_cell_value(cell: ElementTree.Element, shared: list[str]) -> object:
    cell_type = cell.attrib.get("t")
    if cell_type == "inlineStr":
        return "".join(node.text or "" for node in cell.iter() if local_xml_name(node.tag) == "t")
    value_node = next((node for node in cell if local_xml_name(node.tag) == "v"), None)
    if value_node is None or value_node.text is None:
        return None
    value = value_node.text
    if cell_type == "s":
        try:
            return shared[int(value)]
        except (ValueError, IndexError) as error:
            raise DatasetBuildError("indice shared string XLSX non valido") from error
    if cell_type == "b":
        if value not in {"0", "1"}:
            raise DatasetBuildError("booleano XLSX non valido")
        return value == "1"
    return value


def xlsx_member_payload(
    archive: zipfile.ZipFile,
    name: str,
    expected_size: int,
    dataset_id: str,
) -> bytes:
    try:
        with archive.open(name, "r") as stream:
            payload = stream.read(expected_size + 1)
    except KeyError as error:
        raise DatasetBuildError(f"membro XLSX mancante per {dataset_id}") from error
    if len(payload) != expected_size:
        raise DatasetBuildError(f"membro XLSX incompleto per {dataset_id}:{name}")
    return payload


def inspect_xlsx_file(handle: Any, config: dict[str, Any], dataset_id: str) -> dict[str, Any]:
    file_config = config["files"][0]
    expected_members = file_config["archiveMembers"]
    try:
        with zipfile.ZipFile(handle) as archive:
            inspected = inspect_zip_members(
                archive,
                expected_members,
                max_total_uncompressed_bytes=config["maxTotalUncompressedBytes"],
                dataset_id=dataset_id,
            )
            size_by_name = {info.filename: info.file_size for info, _ in inspected}
            workbook_name = "xl/workbook.xml"
            relationships_name = "xl/_rels/workbook.xml.rels"
            workbook_root = safe_xml(
                xlsx_member_payload(archive, workbook_name, size_by_name[workbook_name], dataset_id),
                dataset_id,
                workbook_name,
            )
            relationships_root = safe_xml(
                xlsx_member_payload(
                    archive, relationships_name, size_by_name[relationships_name], dataset_id
                ),
                dataset_id,
                relationships_name,
            )
            sheets = [node for node in workbook_root.iter() if local_xml_name(node.tag) == "sheet"]
            sheet_config = file_config["sheet"]
            if len(sheets) != sheet_config["count"] or sheet_config["index"] >= len(sheets):
                raise DatasetBuildError(f"numero fogli XLSX divergente per {dataset_id}")
            selected = sheets[sheet_config["index"]]
            relationship_id = next(
                (value for key, value in selected.attrib.items() if local_xml_name(key) == "id"),
                None,
            )
            targets = {
                node.attrib.get("Id"): node.attrib.get("Target")
                for node in relationships_root
                if local_xml_name(node.tag) == "Relationship"
            }
            target = targets.get(relationship_id)
            if not isinstance(target, str):
                raise DatasetBuildError(f"relazione foglio XLSX mancante per {dataset_id}")
            target_path = PurePosixPath(target.lstrip("/"))
            if target_path.is_absolute() or ".." in target_path.parts or "\\" in target:
                raise DatasetBuildError(f"relazione foglio XLSX non sicura per {dataset_id}")
            sheet_name = str(PurePosixPath("xl") / target_path)
            if sheet_name not in size_by_name:
                raise DatasetBuildError(f"foglio XLSX mancante per {dataset_id}")

            shared: list[str] = []
            shared_name = "xl/sharedStrings.xml"
            if shared_name in size_by_name:
                shared_root = safe_xml(
                    xlsx_member_payload(
                        archive, shared_name, size_by_name[shared_name], dataset_id
                    ),
                    dataset_id,
                    shared_name,
                )
                for item in shared_root:
                    if local_xml_name(item.tag) == "si":
                        shared.append("".join(
                            node.text or "" for node in item.iter()
                            if local_xml_name(node.tag) == "t"
                        ))

            sheet_root = safe_xml(
                xlsx_member_payload(archive, sheet_name, size_by_name[sheet_name], dataset_id),
                dataset_id,
                sheet_name,
            )
            dimension_node = next(
                (node for node in sheet_root if local_xml_name(node.tag) == "dimension"), None
            )
            dimension = dimension_node.attrib.get("ref") if dimension_node is not None else None
            if not isinstance(dimension, str):
                raise DatasetBuildError(f"dimensione foglio XLSX mancante per {dataset_id}")
            row_nodes = [node for node in sheet_root.iter() if local_xml_name(node.tag) == "row"]
            row_numbers: list[int] = []
            values_by_row: dict[int, dict[int, object]] = {}
            max_column = 0
            for row_node in row_nodes:
                try:
                    row_number = int(row_node.attrib["r"])
                except (KeyError, ValueError) as error:
                    raise DatasetBuildError(f"indice riga XLSX non valido per {dataset_id}") from error
                if row_number in values_by_row:
                    raise DatasetBuildError(f"riga XLSX duplicata per {dataset_id}")
                values_by_row[row_number] = {}
                row_numbers.append(row_number)
                for cell in row_node:
                    if local_xml_name(cell.tag) != "c":
                        continue
                    reference = cell.attrib.get("r")
                    if not isinstance(reference, str) or not reference.endswith(str(row_number)):
                        raise DatasetBuildError(f"cella XLSX fuori riga per {dataset_id}")
                    match = XLSX_CELL_RE.fullmatch(reference)
                    if match is None or int(match.group("row")) != row_number:
                        raise DatasetBuildError(f"riferimento cella XLSX divergente per {dataset_id}")
                    column = xlsx_column_number(reference)
                    if column in values_by_row[row_number]:
                        raise DatasetBuildError(f"cella XLSX duplicata per {dataset_id}")
                    values_by_row[row_number][column] = xlsx_cell_value(cell, shared)
                    max_column = max(max_column, column)
            if row_numbers != list(range(1, len(row_numbers) + 1)):
                raise DatasetBuildError(f"righe XLSX non contigue per {dataset_id}")
            if ":" in dimension:
                start_ref, end_ref = dimension.split(":", 1)
            else:
                start_ref = end_ref = dimension
            end_match = XLSX_CELL_RE.fullmatch(end_ref)
            if (
                start_ref != "A1"
                or end_match is None
                or xlsx_column_number(end_ref) != max_column
                or int(end_match.group("row")) != len(row_numbers)
            ):
                raise DatasetBuildError(f"dimensione XLSX non corroborata per {dataset_id}")
            header = [values_by_row.get(1, {}).get(column) for column in range(1, max_column + 1)]
            observed_sheet = {
                "index": sheet_config["index"],
                "name": selected.attrib.get("name"),
                "count": len(sheets),
                "headerRows": 1,
                "physicalRows": len(row_numbers),
                "rows": max(len(row_numbers) - 1, 0),
                "columns": max_column,
                "dimension": dimension,
                "headerSha256": _header_sha256(header),
            }
            archive_members = [metadata for _, metadata in inspected]
    except (zipfile.BadZipFile, zipfile.LargeZipFile, RuntimeError, KeyError) as error:
        raise DatasetBuildError(f"XLSX non valido per {dataset_id}") from error
    return {
        "id": file_config["id"],
        "rows": observed_sheet["rows"],
        "validRows": observed_sheet["rows"],
        "malformedRows": 0,
        "archiveMembers": archive_members,
        "sheet": observed_sheet,
    }


def compose_catalog_inspection(
    config: dict[str, Any],
    files: list[dict[str, Any]],
) -> dict[str, Any]:
    result: dict[str, Any] = {
        "schemaVersion": 1,
        "kind": config["kind"],
        "rows": sum(file["rows"] for file in files),
        "validRows": sum(file["validRows"] for file in files),
        "malformedRows": sum(file["malformedRows"] for file in files),
        "files": files,
    }
    for key in ("encoding", "delimiter", "maxTotalUncompressedBytes"):
        if key in config:
            result[key] = config[key]
    return result


def reject_json_constant(value: str) -> None:
    raise ValueError(f"costante JSON non finita: {value}")


def reject_duplicate_json_keys(pairs: list[tuple[str, Any]]) -> dict[str, Any]:
    value: dict[str, Any] = {}
    for key, item in pairs:
        if key in value:
            raise ValueError(f"chiave JSON duplicata: {key}")
        value[key] = item
    return value


def parse_strict_json(payload: bytes, dataset_id: str) -> object:
    try:
        return json.loads(
            payload,
            parse_constant=reject_json_constant,
            object_pairs_hook=reject_duplicate_json_keys,
        )
    except (UnicodeDecodeError, json.JSONDecodeError, ValueError) as error:
        raise DatasetBuildError(f"JSON non valido per {dataset_id}") from error


def json_scalar_cell(value: object, dataset_id: str, row_number: int, field: str) -> str:
    if value is None:
        return ""
    if isinstance(value, str):
        return value
    if isinstance(value, (bool, int, float)):
        try:
            return json.dumps(value, ensure_ascii=False, allow_nan=False)
        except ValueError as error:
            raise DatasetBuildError(
                f"valore JSON non finito per {dataset_id}:{row_number}:{field}"
            ) from error
    if isinstance(value, (dict, list)):
        try:
            return json.dumps(
                value,
                ensure_ascii=False,
                sort_keys=True,
                separators=(",", ":"),
                allow_nan=False,
            )
        except (TypeError, ValueError) as error:
            raise DatasetBuildError(
                f"valore JSON annidato non canonico per {dataset_id}:{row_number}:{field}"
            ) from error
    raise DatasetBuildError(f"tipo JSON non supportato per {dataset_id}:{row_number}:{field}")


def parse_delimited_edge_split(
    text: str,
    *,
    delimiter: str,
    headers: list[str],
    left_splits: int,
    right_splits: int,
    dataset_id: str,
    source_id: str,
) -> list[list[str]]:
    """Parse rows with a free-text middle cell without rewriting source bytes.

    Some source indexes use an unquoted delimiter inside the penultimate free-text
    note. The schema still has fixed columns on both edges. Splitting exactly the
    declared number of delimiters from the left and right keeps the entire middle
    cell verbatim, including any literal delimiters.
    """

    lines = text.split("\n")
    if lines and lines[-1] == "":
        lines.pop()
    lines = [line[:-1] if line.endswith("\r") else line for line in lines]
    if not lines:
        raise DatasetBuildError(f"sorgente vuota per {dataset_id}")
    source_headers = lines[0].split(delimiter)
    if source_headers != headers:
        raise DatasetBuildError(
            f"schema sorgente divergente per {dataset_id}:{source_id}"
        )

    source_rows: list[list[str]] = []
    malformed: list[int] = []
    for row_number, line in enumerate(lines[1:], start=2):
        left = line.split(delimiter, left_splits)
        if len(left) != left_splits + 1:
            malformed.append(row_number)
            continue
        right = left[-1].rsplit(delimiter, right_splits)
        row = left[:-1] + right
        if len(row) != len(headers):
            malformed.append(row_number)
            continue
        source_rows.append(row)
    if malformed:
        raise DatasetBuildError(
            f"righe malformed per {dataset_id}:{source_id}: {malformed[:5]}"
        )
    return source_rows


def parse_dataset(source_root: Path, item: dict[str, Any]) -> ParsedDataset:
    expected = item["expected"]
    raw_sources = item.get("sources")
    is_source_set = raw_sources is not None
    if raw_sources is None:
        source_specs = [{
            "relativePath": item["relativePath"],
            "expected": {
                "bytes": expected["bytes"],
                "sha256": expected["sha256"],
                "rows": expected["rows"],
            },
        }]
    else:
        source_specs = raw_sources

    headers = expected.get("headers") or ["value"]
    rows: list[list[str]] = []
    sources: list[ParsedSource] = []
    row_origins: list[tuple[str, int]] = []
    inspection_files: list[dict[str, Any]] = []
    for source_index, source_spec in enumerate(source_specs, start=1):
        source_id = f"source-{source_index:04d}"
        source_expected = source_spec["expected"]
        source_path = source_root / source_spec["relativePath"]
        if item["dataKind"] == "catalog-file":
            inspection_config = item["inspection"]
            file_config = inspection_config["files"][source_index - 1]
            with open_verified_pinned_source(
                source_path,
                source_expected["bytes"],
                source_expected["sha256"],
                f"{item['id']}:{source_id}",
            ) as source_handle:
                if inspection_config["kind"] == "delimited-set":
                    inspected_file = inspect_delimited_file(
                        source_handle,
                        source_expected["bytes"],
                        file_config,
                        f"{item['id']}:{source_id}",
                    )
                elif inspection_config["kind"] == "zip-delimited-set":
                    inspected_file = inspect_zip_delimited_file(
                        source_handle, inspection_config, item["id"]
                    )
                elif inspection_config["kind"] == "zip-xls":
                    inspected_file = inspect_zip_xls_file(
                        source_handle, inspection_config, item["id"]
                    )
                else:
                    inspected_file = inspect_xlsx_file(
                        source_handle, inspection_config, item["id"]
                    )
            if inspected_file["rows"] != source_expected["rows"]:
                raise DatasetBuildError(
                    f"conteggio catalogo divergente per {item['id']}:{source_id}"
                )
            inspection_files.append(inspected_file)
            sources.append(ParsedSource(
                id=source_id,
                relative_path=source_spec["relativePath"],
                sha256=source_expected["sha256"],
                bytes=source_expected["bytes"],
                rows=inspected_file["rows"],
            ))
            continue
        payload = read_pinned_source(
            source_path,
            source_expected["bytes"],
            f"{item['id']}:{source_id}",
        )
        if sha256_bytes(payload) != source_expected["sha256"]:
            raise DatasetBuildError(
                f"byte sorgente divergenti per {item['id']}:{source_id}"
            )

        source_rows: list[list[str]]
        if item["dataKind"] == "json-object":
            value = parse_strict_json(payload, item["id"])
            source_rows = [[
                json.dumps(
                    value,
                    ensure_ascii=False,
                    sort_keys=True,
                    separators=(",", ":"),
                    allow_nan=False,
                )
            ]]
        elif item["dataKind"] == "json-object-items":
            value = parse_strict_json(payload, item["id"])
            if not isinstance(value, dict) or set(value) != set(expected["objectKeys"]):
                raise DatasetBuildError(f"schema oggetto JSON divergente per {item['id']}")
            raw_items = value.get(item["itemsField"])
            count = value.get(item["countField"])
            if not isinstance(raw_items, list):
                raise DatasetBuildError(f"array items mancante per {item['id']}")
            if isinstance(count, bool) or not isinstance(count, int) or count != len(raw_items):
                raise DatasetBuildError(f"conteggio items divergente per {item['id']}")
            source_rows = []
            expected_header_set = set(headers)
            for row_number, raw_item in enumerate(raw_items, start=1):
                if not isinstance(raw_item, dict) or set(raw_item) != expected_header_set:
                    raise DatasetBuildError(
                        f"schema item JSON divergente per {item['id']}:{row_number}"
                    )
                source_rows.append([
                    json_scalar_cell(raw_item[field], item["id"], row_number, field)
                    for field in headers
                ])
        else:
            try:
                text = payload.decode("utf-8-sig")
            except UnicodeDecodeError as error:
                raise DatasetBuildError(f"encoding inatteso per {item['id']}") from error
            delimiter = parse_delimiter(item["delimiter"], f"{item['id']}.delimiter")
            if item["dataKind"] == "delimited-edge-split":
                edge_split = item["edgeSplit"]
                source_rows = parse_delimited_edge_split(
                    text,
                    delimiter=delimiter,
                    headers=headers,
                    left_splits=edge_split["left"],
                    right_splits=edge_split["right"],
                    dataset_id=item["id"],
                    source_id=source_id,
                )
            else:
                # `newline=""` is the csv module contract: quoted embedded line breaks
                # remain part of the cell instead of being deleted before parsing.
                reader = csv.reader(io.StringIO(text, newline=""), delimiter=delimiter)
                try:
                    source_headers = next(reader)
                except StopIteration as error:
                    raise DatasetBuildError(f"sorgente vuota per {item['id']}") from error
                source_rows = list(reader)
                if source_headers != headers:
                    raise DatasetBuildError(
                        f"schema sorgente divergente per {item['id']}:{source_id}"
                    )
                malformed = [
                    row_number
                    for row_number, row in enumerate(source_rows, start=2)
                    if len(row) != len(headers)
                ]
                if malformed:
                    raise DatasetBuildError(
                        f"righe malformed per {item['id']}:{source_id}: {malformed[:5]}"
                    )

        if len(source_rows) != source_expected["rows"]:
            raise DatasetBuildError(
                f"conteggio righe divergente per {item['id']}:{source_id}"
            )
        sources.append(ParsedSource(
            id=source_id,
            relative_path=source_spec["relativePath"],
            sha256=source_expected["sha256"],
            bytes=source_expected["bytes"],
            rows=len(source_rows),
        ))
        rows.extend(source_rows)
        row_origins.extend((source_id, row_number) for row_number in range(1, len(source_rows) + 1))

    observed_inspection: dict[str, Any] | None = None
    if item["dataKind"] == "catalog-file":
        observed_inspection = compose_catalog_inspection(item["inspection"], inspection_files)
        if observed_inspection != item["inspection"]:
            raise DatasetBuildError(f"inspection sorgente divergente per {item['id']}")
        logical_rows = observed_inspection["rows"]
    else:
        logical_rows = len(rows)
    if item["dataKind"] != "catalog-file" and (
        len(rows) != expected["rows"] or len(row_origins) != len(rows)
    ):
        raise DatasetBuildError(f"totale righe divergente per {item['id']}")
    raw_sha256 = source_set_sha256(item) if is_source_set else expected["sha256"]
    return ParsedDataset(
        headers,
        rows,
        raw_sha256,
        expected["bytes"],
        sources,
        row_origins,
        is_source_set,
        logical_rows,
        (
            inspection_receipt_projection(observed_inspection)
            if observed_inspection is not None
            else None
        ),
    )


def build_dataset(
    item: dict[str, Any],
    parsed: ParsedDataset,
    source_metadata: dict[str, Any],
) -> tuple[dict[str, Any], bytes | None, dict[str, Any], list[dict[str, Any]]]:
    dataset_id = item["id"]
    private_fields = set(item["privateFields"])
    source_fields = set(item["sourceFields"])
    publication = item["publication"]
    public_rows: list[dict[str, Any]] = []
    private_rows: list[dict[str, Any]] = []
    source_rows = 0
    public_redactions = 0
    for index, values in enumerate(parsed.rows, start=1):
        source_id, source_file_row = parsed.row_origins[index - 1]
        canonical_cells = dict(zip(parsed.headers, values, strict=True))
        private_row_digest = sha256_bytes(canonical_json(canonical_cells))
        private_values = repeated_private_identifiers(canonical_cells, private_fields)
        urls = [
            url
            for url in extract_public_urls(canonical_cells[field] for field in source_fields)
            if not any(private_value in url for private_value in private_values)
        ]
        if urls:
            source_rows += 1
        if publication not in {"rows", "source-index"}:
            private_row_id = "row-" + sha256_bytes(
                f"{dataset_id}:{index}:{private_row_digest}".encode("utf-8")
            )[:24]
            private_rows.append({
                "id": private_row_id,
                "sourceRow": index,
                "sourceId": source_id,
                "sourceFileRow": source_file_row,
                "sourceRowSha256": private_row_digest,
            })
            continue
        cells: dict[str, str | None] = {}
        redactions: list[dict[str, str]] = []
        for field, value in canonical_cells.items():
            sanitized, reasons = sanitize_public_cell(
                field,
                value,
                private_fields,
                private_values if field not in private_fields else set(),
            )
            cells[field] = sanitized
            for reason in reasons:
                redactions.append({"field": field, "reason": reason})
        # The public commitment is deliberately computed after redaction. A
        # hash of the raw cells would let a reader confirm guesses about a
        # private identifier with a dictionary attack. The exact raw digest
        # stays only in the private row map.
        public_row_digest = sha256_bytes(canonical_json(cells))
        row_id = "row-" + sha256_bytes(
            f"{dataset_id}:{index}:{public_row_digest}".encode("utf-8")
        )[:24]
        private_rows.append({
            "id": row_id,
            "sourceRow": index,
            "sourceId": source_id,
            "sourceFileRow": source_file_row,
            "sourceRowSha256": private_row_digest,
        })
        public_redactions += len(redactions)
        public_rows.append({
            "id": row_id,
            "sourceRow": index,
            "sourceRowSha256": public_row_digest,
            "evidenceLabel": item["evidenceLabel"],
            "cells": cells,
            "sourceUrls": urls,
            "redactions": redactions,
        })
    public_row_count = len(public_rows)
    catalog_only_rows = parsed.logical_rows if publication == "catalog-only" else 0
    derived_only_rows = parsed.logical_rows if publication == "derived-only" else 0
    if publication in {"rows", "source-index"} and public_row_count != parsed.logical_rows:
        raise DatasetBuildError(f"perdita righe nella proiezione {dataset_id}")
    if parsed.logical_rows != public_row_count + catalog_only_rows + derived_only_rows:
        raise DatasetBuildError(f"equazione righe non chiusa per {dataset_id}")
    rows_payload = b"".join(canonical_json(row) for row in public_rows) if public_rows else None
    receipt_source: dict[str, Any] = {
        "bytes": parsed.raw_bytes,
        "sha256": parsed.raw_sha256,
        "rows": parsed.logical_rows,
        "columns": len(parsed.headers),
        "headers": parsed.headers,
    }
    for key in ("reportedColumns", "reportedFiles"):
        if key in item["expected"]:
            receipt_source[key] = item["expected"][key]
    if parsed.inspection is not None:
        receipt_source["inspection"] = parsed.inspection
    if parsed.is_source_set:
        receipt_source["sourceSet"] = {
            "sha256": parsed.raw_sha256,
            "files": [
                {
                    "id": source.id,
                    "bytes": source.bytes,
                    "sha256": source.sha256,
                    "rows": source.rows,
                }
                for source in parsed.sources
            ],
        }
    receipt = {
        "schemaVersion": 1,
        "datasetId": dataset_id,
        "source": receipt_source,
        "publication": {
            "status": publication, "publicRows": public_row_count,
            "catalogOnlyRows": catalog_only_rows, "derivedOnlyRows": derived_only_rows,
            "redactions": public_redactions, "rowsWithPublicSource": source_rows,
        },
        "rowEquationClosed": True,
        "rowsSha256": sha256_bytes(rows_payload) if rows_payload is not None else None,
    }
    catalog_entry = {
        "id": dataset_id, "title": item["title"], "domain": item["domain"],
        "authority": item["authority"], "licenseStatus": item["licenseStatus"],
        "publication": publication, "evidenceLabel": item["evidenceLabel"],
        "rows": parsed.logical_rows, "publicRows": public_row_count,
        "rowsWithPublicSource": source_rows, "headers": parsed.headers,
        "privateFields": sorted(private_fields), "caveats": item["caveats"],
        "sourceMetadata": source_metadata,
        "receiptSha256": sha256_bytes(canonical_json(receipt)),
    }
    if parsed.inspection is not None:
        catalog_entry["inspection"] = parsed.inspection
    return catalog_entry, rows_payload, receipt, private_rows


def write_bytes(path: Path, payload: bytes) -> None:
    path.parent.mkdir(parents=True, exist_ok=True)
    descriptor, temporary_name = tempfile.mkstemp(prefix=f".{path.name}.", dir=path.parent)
    temporary_path = Path(temporary_name)
    try:
        with os.fdopen(descriptor, "wb") as handle:
            handle.write(payload)
            handle.flush()
            os.fsync(handle.fileno())
        os.replace(temporary_path, path)
    finally:
        if temporary_path.exists():
            temporary_path.unlink()


def build_artifacts(*, spec_path: Path, source_root: Path, catalog_path: Path, rows_dir: Path, receipts_dir: Path, proof_path: Path, private_map_out: Path | None) -> dict[str, bytes]:
    spec, datasets = load_spec(spec_path)
    artifacts: dict[str, bytes] = {}
    catalog_entries: list[dict[str, Any]] = []
    private_map: dict[str, Any] = {"schemaVersion": 2, "datasets": []}
    totals = {"datasets": 0, "sourceRows": 0, "publicRows": 0, "catalogOnlyRows": 0, "derivedOnlyRows": 0, "sourceBytes": 0}
    for item in datasets:
        parsed = parse_dataset(source_root, item)
        catalog_entry, rows_payload, receipt, private_rows = build_dataset(
            item,
            parsed,
            resolved_source_metadata(spec, item["id"]),
        )
        catalog_entries.append(catalog_entry)
        artifacts[str(receipts_dir / f"{item['id']}.receipt.json")] = canonical_json(receipt)
        if rows_payload is not None:
            for ordinal, chunk in enumerate(row_payload_chunks(item["id"], rows_payload)):
                artifacts[str(rows_dir / row_chunk_name(item["id"], ordinal))] = canonical_gzip(chunk)
        source_row_cursor = 1
        row_ranges: list[dict[str, Any]] = []
        for source in parsed.sources:
            if source.rows:
                row_ranges.append({
                    "sourceId": source.id,
                    "sourceRowStart": source_row_cursor,
                    "sourceRowEnd": source_row_cursor + source.rows - 1,
                    "sourceFileRowStart": 1,
                    "sourceFileRowEnd": source.rows,
                })
            source_row_cursor += source.rows
        if source_row_cursor != parsed.logical_rows + 1:
            raise DatasetBuildError(f"range sorgenti divergenti per {item['id']}")
        private_map["datasets"].append({
            "datasetId": item["id"],
            "sourceSetSha256": parsed.raw_sha256,
            "sources": [
                {
                    "id": source.id,
                    "sourceRelativePath": source.relative_path,
                    "sourceSha256": source.sha256,
                    "bytes": source.bytes,
                    "rows": source.rows,
                }
                for source in parsed.sources
            ],
            "rowRanges": row_ranges,
            "rows": private_rows,
        })
        totals["datasets"] += 1
        totals["sourceRows"] += receipt["source"]["rows"]
        totals["publicRows"] += receipt["publication"]["publicRows"]
        totals["catalogOnlyRows"] += receipt["publication"]["catalogOnlyRows"]
        totals["derivedOnlyRows"] += receipt["publication"]["derivedOnlyRows"]
        totals["sourceBytes"] += receipt["source"]["bytes"]
    if totals["sourceRows"] != totals["publicRows"] + totals["catalogOnlyRows"] + totals["derivedOnlyRows"]:
        raise DatasetBuildError("equazione globale delle righe non chiusa")
    catalog = {
        "schemaVersion": 1, "generatedAt": spec["generatedAt"],
        "corpusContract": spec["corpusContract"], "totals": totals,
        "datasets": sorted(catalog_entries, key=lambda entry: entry["id"]),
    }
    catalog_payload = canonical_json(catalog)
    artifacts[str(catalog_path)] = catalog_payload
    proof = {
        "schemaVersion": 1, "generatedAt": spec["generatedAt"], "complete": True,
        "totals": totals, "catalogSha256": sha256_bytes(catalog_payload),
        "artifactSha256": {
            Path(path).relative_to(ROOT).as_posix(): sha256_bytes(payload)
            for path, payload in sorted(artifacts.items())
        },
    }
    artifacts[str(proof_path)] = canonical_json(proof)
    if private_map_out is not None:
        ensure_outside_repository(private_map_out, "private-map-out")
        write_bytes(private_map_out, canonical_json(private_map))
    return artifacts


def commit_artifacts(artifacts: dict[str, bytes]) -> None:
    row_artifacts = [
        Path(raw_path)
        for raw_path in artifacts
        if ROW_CHUNK_NAME_RE.fullmatch(Path(raw_path).name)
    ]
    row_directories = {path.parent for path in row_artifacts}
    expected_rows = {path for path in row_artifacts}
    for directory in row_directories:
        if not directory.exists():
            continue
        directory_metadata = directory.lstat()
        if not stat.S_ISDIR(directory_metadata.st_mode) or stat.S_ISLNK(directory_metadata.st_mode):
            raise DatasetBuildError(f"directory artefatti righe non regolare: {directory}")
        for candidate in directory.iterdir():
            if not candidate.name.endswith(".jsonl.gz") or candidate in expected_rows:
                continue
            metadata = candidate.lstat()
            if not stat.S_ISREG(metadata.st_mode) or stat.S_ISLNK(metadata.st_mode):
                raise DatasetBuildError(f"artefatto righe stale non regolare: {candidate}")
            candidate.unlink()
    for raw_path, payload in sorted(artifacts.items()):
        path = Path(raw_path)
        if path.suffix not in {".json", ".jsonl", ".gz"}:
            raise DatasetBuildError(f"estensione artefatto inattesa: {path}")
        write_bytes(path, payload)


def check_artifacts(artifacts: dict[str, bytes]) -> None:
    mismatches: list[str] = []
    for raw_path, expected in sorted(artifacts.items()):
        path = Path(raw_path)
        try:
            actual = path.read_bytes()
        except OSError:
            mismatches.append(f"mancante: {path.relative_to(ROOT).as_posix()}")
            continue
        if actual != expected:
            mismatches.append(f"divergente: {path.relative_to(ROOT).as_posix()}")
    if mismatches:
        raise DatasetBuildError("artefatti non riproducibili:\n" + "\n".join(mismatches))


def expected_committed_paths(
    datasets: list[dict[str, Any]],
    *,
    catalog_path: Path,
    rows_dir: Path,
    receipts_dir: Path,
) -> set[Path]:
    paths = {catalog_path}
    for item in datasets:
        paths.add(receipts_dir / f"{item['id']}.receipt.json")
        if item["publication"] in {"rows", "source-index"}:
            chunk_count = (
                item["expected"]["rows"] + PUBLIC_ROW_CHUNK_ROWS - 1
            ) // PUBLIC_ROW_CHUNK_ROWS
            paths.update(
                rows_dir / row_chunk_name(item["id"], ordinal)
                for ordinal in range(chunk_count)
            )
    return paths


def validate_public_rows(
    *,
    item: dict[str, Any],
    rows_payload: bytes,
    expected_rows: int,
) -> tuple[int, int]:
    dataset_id = item["id"]
    if expected_rows == 0:
        if rows_payload:
            raise DatasetBuildError(f"conteggio righe divergente per {dataset_id}")
        return 0, 0
    if not rows_payload.endswith(b"\n"):
        raise DatasetBuildError(f"righe senza newline finale per {dataset_id}")
    try:
        text = rows_payload.decode("utf-8")
    except UnicodeDecodeError as error:
        raise DatasetBuildError(f"encoding righe divergente per {dataset_id}") from error
    lines = text[:-1].split("\n")
    if len(lines) != expected_rows:
        raise DatasetBuildError(
            f"conteggio righe divergente per {dataset_id}: {len(lines)} != {expected_rows}"
        )

    expected_headers = item["expected"].get("headers") or ["value"]
    header_set = set(expected_headers)
    private_fields = set(item["privateFields"])
    rows_with_public_source = 0
    redaction_count = 0
    seen_ids: set[str] = set()
    allowed_redactions = {
        "personal-identifier", "internal-path", "internal-process-name",
        "private-value-copy", "credential", "unsafe-url",
    }
    for source_row, line in enumerate(lines, start=1):
        try:
            row = json.loads(line)
        except json.JSONDecodeError as error:
            raise DatasetBuildError(
                f"JSONL righe non valido per {dataset_id}:{source_row}"
            ) from error
        if not isinstance(row, dict) or canonical_json(row) != (line + "\n").encode("utf-8"):
            raise DatasetBuildError(f"riga non canonica per {dataset_id}:{source_row}")
        if set(row) != {
            "id", "sourceRow", "sourceRowSha256", "evidenceLabel",
            "cells", "sourceUrls", "redactions",
        }:
            raise DatasetBuildError(f"schema riga divergente per {dataset_id}:{source_row}")
        if row.get("sourceRow") != source_row or row.get("evidenceLabel") != item["evidenceLabel"]:
            raise DatasetBuildError(f"identita riga divergente per {dataset_id}:{source_row}")
        public_digest = row.get("sourceRowSha256")
        if not isinstance(public_digest, str) or not SHA256_RE.fullmatch(public_digest):
            raise DatasetBuildError(f"digest riga divergente per {dataset_id}:{source_row}")
        cells = row.get("cells")
        if not isinstance(cells, dict) or set(cells) != header_set:
            raise DatasetBuildError(f"celle riga divergenti per {dataset_id}:{source_row}")
        if any(value is not None and not isinstance(value, str) for value in cells.values()):
            raise DatasetBuildError(f"tipo cella divergente per {dataset_id}:{source_row}")
        if sha256_bytes(canonical_json(cells)) != public_digest:
            raise DatasetBuildError(f"commitment riga divergente per {dataset_id}:{source_row}")
        expected_id = "row-" + sha256_bytes(
            f"{dataset_id}:{source_row}:{public_digest}".encode("utf-8")
        )[:24]
        if row.get("id") != expected_id or expected_id in seen_ids:
            raise DatasetBuildError(f"id riga divergente o duplicato per {dataset_id}:{source_row}")
        seen_ids.add(expected_id)

        for field, value in cells.items():
            if isinstance(value, str) and (
                RAW_WORKSTATION_REFERENCE_RE.search(value)
                or contains_encoded_public_cell_hazard(value)
                or INTERNAL_NAME_RE.search(value)
                or CREDENTIAL_RE.search(value)
                or contains_sensitive_assignment(value)
                or any(
                    not is_safe_public_url(match.group(0).rstrip(".,)]}\"'"))
                    for match in EMBEDDED_HTTP_URL_RE.finditer(value)
                )
            ):
                raise DatasetBuildError(
                    f"metadato interno pubblico in {dataset_id}:{source_row}:{field}"
                )

        urls = row.get("sourceUrls")
        if (
            not isinstance(urls, list)
            or any(not isinstance(url, str) or not is_safe_public_url(url) for url in urls)
            or urls != sorted(set(urls))
        ):
            raise DatasetBuildError(f"URL pubblici divergenti per {dataset_id}:{source_row}")
        if urls:
            rows_with_public_source += 1

        redactions = row.get("redactions")
        if not isinstance(redactions, list):
            raise DatasetBuildError(f"redazioni divergenti per {dataset_id}:{source_row}")
        for redaction in redactions:
            if (
                not isinstance(redaction, dict)
                or set(redaction) != {"field", "reason"}
                or redaction.get("field") not in header_set
                or redaction.get("reason") not in allowed_redactions
            ):
                raise DatasetBuildError(f"redazione non valida per {dataset_id}:{source_row}")
        for private_field in private_fields:
            if cells[private_field] not in {None, ""}:
                raise DatasetBuildError(
                    f"campo privato pubblico in {dataset_id}:{source_row}:{private_field}"
                )
            if cells[private_field] is None and not any(
                redaction.get("field") == private_field
                and redaction.get("reason") == "personal-identifier"
                for redaction in redactions
            ):
                raise DatasetBuildError(
                    f"receipt redazione mancante in {dataset_id}:{source_row}:{private_field}"
                )
        redaction_count += len(redactions)
    return rows_with_public_source, redaction_count


def check_committed(
    *,
    spec_path: Path,
    catalog_path: Path,
    rows_dir: Path,
    receipts_dir: Path,
    proof_path: Path,
) -> None:
    spec, datasets = load_spec(spec_path)
    try:
        proof_payload = proof_path.read_bytes()
        proof = json.loads(proof_payload)
        catalog_payload = catalog_path.read_bytes()
        catalog = json.loads(catalog_payload)
    except (OSError, UnicodeDecodeError, json.JSONDecodeError) as error:
        raise DatasetBuildError("proof o catalogo committato illeggibile") from error
    if not isinstance(proof, dict) or proof.get("complete") is not True:
        raise DatasetBuildError("dataset proof non completo")
    if canonical_json(proof) != proof_payload or canonical_json(catalog) != catalog_payload:
        raise DatasetBuildError("proof o catalogo non canonico")
    if set(proof) != {
        "schemaVersion", "generatedAt", "complete", "totals",
        "catalogSha256", "artifactSha256",
    } or proof.get("schemaVersion") != 1:
        raise DatasetBuildError("schema dataset proof divergente")
    if proof.get("generatedAt") != spec["generatedAt"]:
        raise DatasetBuildError("timestamp proof divergente")
    if proof.get("catalogSha256") != sha256_bytes(catalog_payload):
        raise DatasetBuildError("hash catalogo divergente")
    if not isinstance(catalog, dict) or catalog.get("corpusContract") != spec["corpusContract"]:
        raise DatasetBuildError("contratto corpus del catalogo divergente")

    expected_paths = expected_committed_paths(
        datasets,
        catalog_path=catalog_path,
        rows_dir=rows_dir,
        receipts_dir=receipts_dir,
    )
    expected_rows_paths = {
        path for path in expected_paths if path.parent == rows_dir
    }
    expected_receipt_paths = {
        path for path in expected_paths if path.parent == receipts_dir
    }
    actual_rows_paths = set(rows_dir.iterdir()) if rows_dir.is_dir() else set()
    actual_receipt_paths = set(receipts_dir.iterdir()) if receipts_dir.is_dir() else set()
    if actual_rows_paths != expected_rows_paths or actual_receipt_paths != expected_receipt_paths:
        raise DatasetBuildError("artefatti extra, inattesi, stale o mancanti nelle directory dataset")
    artifact_hashes = require_dict(proof.get("artifactSha256"), "proof.artifactSha256")
    expected_keys = {path.relative_to(ROOT).as_posix() for path in expected_paths}
    if set(artifact_hashes) != expected_keys:
        raise DatasetBuildError("insieme artefatti nel proof divergente")

    totals = {
        "datasets": 0,
        "sourceRows": 0,
        "publicRows": 0,
        "catalogOnlyRows": 0,
        "derivedOnlyRows": 0,
        "sourceBytes": 0,
    }
    expected_catalog_entries: list[dict[str, Any]] = []
    for item in datasets:
        receipt_path = receipts_dir / f"{item['id']}.receipt.json"
        try:
            receipt_payload = receipt_path.read_bytes()
            receipt = json.loads(receipt_payload)
        except (OSError, UnicodeDecodeError, json.JSONDecodeError) as error:
            raise DatasetBuildError(f"receipt illeggibile per {item['id']}") from error
        if canonical_json(receipt) != receipt_payload or set(receipt) != {
            "schemaVersion", "datasetId", "source", "publication",
            "rowEquationClosed", "rowsSha256",
        } or receipt.get("schemaVersion") != 1:
            raise DatasetBuildError(f"schema receipt divergente per {item['id']}")
        expected = item["expected"]
        if receipt.get("datasetId") != item["id"] or receipt.get("rowEquationClosed") is not True:
            raise DatasetBuildError(f"receipt non chiuso per {item['id']}")
        source = require_dict(receipt.get("source"), f"{item['id']}.source")
        expected_headers = expected.get("headers") or ["value"]
        expected_columns = expected.get("columns") or 1
        expected_source: dict[str, Any] = {
            "bytes": expected["bytes"],
            "sha256": expected["sha256"],
            "rows": expected["rows"],
            "columns": expected_columns,
            "headers": expected_headers,
        }
        for key in ("reportedColumns", "reportedFiles"):
            if key in expected:
                expected_source[key] = expected[key]
        expected_inspection = None
        if item["dataKind"] == "catalog-file":
            expected_inspection = inspection_receipt_projection(item["inspection"])
            expected_source["inspection"] = expected_inspection
        if "sources" in item:
            expected_source["sourceSet"] = {
                "sha256": expected["sha256"],
                "files": source_part_commitments(item),
            }
        if source != expected_source:
            raise DatasetBuildError(f"identita sorgente divergente per {item['id']}")
        publication = require_dict(receipt.get("publication"), f"{item['id']}.publication")
        if set(publication) != {
            "status", "publicRows", "catalogOnlyRows", "derivedOnlyRows",
            "redactions", "rowsWithPublicSource",
        }:
            raise DatasetBuildError(f"schema publication divergente per {item['id']}")
        for key in (
            "publicRows", "catalogOnlyRows", "derivedOnlyRows",
            "redactions", "rowsWithPublicSource",
        ):
            require_int(publication.get(key), f"{item['id']}.{key}")
        expected_public_rows = (
            expected["rows"] if item["publication"] in {"rows", "source-index"} else 0
        )
        expected_catalog_only_rows = (
            expected["rows"] if item["publication"] == "catalog-only" else 0
        )
        expected_derived_only_rows = (
            expected["rows"] if item["publication"] == "derived-only" else 0
        )
        if (
            publication.get("status") != item["publication"]
            or publication.get("publicRows") != expected_public_rows
            or publication.get("catalogOnlyRows") != expected_catalog_only_rows
            or publication.get("derivedOnlyRows") != expected_derived_only_rows
        ):
            raise DatasetBuildError(f"equazione righe divergente per {item['id']}")
        if item["publication"] in {"rows", "source-index"}:
            chunk_count = (
                expected_public_rows + PUBLIC_ROW_CHUNK_ROWS - 1
            ) // PUBLIC_ROW_CHUNK_ROWS
            row_chunks: list[bytes] = []
            for ordinal in range(chunk_count):
                rows_path = rows_dir / row_chunk_name(item["id"], ordinal)
                label = f"{item['id']}:{ordinal}"
                compressed = read_bounded_regular_file(
                    rows_path,
                    PUBLIC_ROW_CHUNK_MAX_COMPRESSED_BYTES,
                    label,
                )
                chunk = decompress_public_row_chunk(compressed, item["id"], ordinal)
                expected_chunk_rows = min(
                    PUBLIC_ROW_CHUNK_ROWS,
                    expected_public_rows - ordinal * PUBLIC_ROW_CHUNK_ROWS,
                )
                if len(chunk.splitlines()) != expected_chunk_rows:
                    raise DatasetBuildError(
                        f"cardinalita chunk divergente per {item['id']}:{ordinal}"
                    )
                if canonical_gzip(chunk) != compressed:
                    raise DatasetBuildError(
                        f"gzip non deterministico per {item['id']}:{ordinal}"
                    )
                row_chunks.append(chunk)
            rows_payload = b"".join(row_chunks)
            if sha256_bytes(rows_payload) != receipt.get("rowsSha256"):
                raise DatasetBuildError(f"hash righe divergente per {item['id']}")
            rows_with_source, redactions = validate_public_rows(
                item=item,
                rows_payload=rows_payload,
                expected_rows=expected_public_rows,
            )
            if (
                publication.get("rowsWithPublicSource") != rows_with_source
                or publication.get("redactions") != redactions
            ):
                raise DatasetBuildError(f"conteggi proiezione divergenti per {item['id']}")
        else:
            if receipt.get("rowsSha256") is not None:
                raise DatasetBuildError(f"hash righe inatteso per {item['id']}")
            if publication.get("redactions") != 0:
                raise DatasetBuildError(f"redazioni inattese per {item['id']}")

        expected_catalog_entry = {
            "id": item["id"],
            "title": item["title"],
            "domain": item["domain"],
            "authority": item["authority"],
            "licenseStatus": item["licenseStatus"],
            "publication": item["publication"],
            "evidenceLabel": item["evidenceLabel"],
            "rows": expected["rows"],
            "publicRows": expected_public_rows,
            "rowsWithPublicSource": publication["rowsWithPublicSource"],
            "headers": expected_headers,
            "privateFields": sorted(item["privateFields"]),
            "caveats": item["caveats"],
            "sourceMetadata": resolved_source_metadata(spec, item["id"]),
            "receiptSha256": sha256_bytes(receipt_payload),
        }
        if expected_inspection is not None:
            expected_catalog_entry["inspection"] = expected_inspection
        expected_catalog_entries.append(expected_catalog_entry)

        totals["datasets"] += 1
        totals["sourceRows"] += source["rows"]
        totals["publicRows"] += publication["publicRows"]
        totals["catalogOnlyRows"] += publication["catalogOnlyRows"]
        totals["derivedOnlyRows"] += publication["derivedOnlyRows"]
        totals["sourceBytes"] += source["bytes"]

    expected_catalog = {
        "schemaVersion": 1,
        "generatedAt": spec["generatedAt"],
        "corpusContract": spec["corpusContract"],
        "totals": totals,
        "datasets": sorted(expected_catalog_entries, key=lambda entry: entry["id"]),
    }
    if catalog != expected_catalog:
        raise DatasetBuildError("metadati catalogo divergenti dalla specifica")
    if proof.get("totals") != totals:
        raise DatasetBuildError("totali proof/catalogo divergenti")
    for path in expected_paths:
        relative = path.relative_to(ROOT).as_posix()
        if path in expected_rows_paths:
            payload = read_bounded_regular_file(
                path,
                PUBLIC_ROW_CHUNK_MAX_COMPRESSED_BYTES,
                relative,
            )
        else:
            try:
                payload = path.read_bytes()
            except OSError as error:
                raise DatasetBuildError(f"artefatto mancante: {relative}") from error
        if artifact_hashes.get(relative) != sha256_bytes(payload):
            raise DatasetBuildError(f"hash artefatto divergente: {relative}")


def parse_args() -> argparse.Namespace:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("action", choices=("build", "check", "verify-source"))
    parser.add_argument("--spec", type=Path, default=DEFAULT_SPEC)
    parser.add_argument("--source-root", type=Path)
    parser.add_argument("--catalog", type=Path, default=DEFAULT_CATALOG)
    parser.add_argument("--rows-dir", type=Path, default=DEFAULT_ROWS_DIR)
    parser.add_argument("--receipts-dir", type=Path, default=DEFAULT_RECEIPTS_DIR)
    parser.add_argument("--proof", type=Path, default=DEFAULT_PROOF)
    parser.add_argument("--private-map-out", type=Path)
    return parser.parse_args()


def main() -> int:
    args = parse_args()
    if args.action == "check":
        check_committed(
            spec_path=args.spec,
            catalog_path=args.catalog,
            rows_dir=args.rows_dir,
            receipts_dir=args.receipts_dir,
            proof_path=args.proof,
        )
        print(json.dumps({"status": "ok", "action": args.action, "sourceRequired": False}, sort_keys=True))
        return 0
    if args.source_root is None:
        raise DatasetBuildError(f"{args.action} richiede --source-root")
    source_root = args.source_root.expanduser().resolve()
    if not source_root.is_dir():
        raise DatasetBuildError("source-root non e una directory")
    if args.action == "build" and args.private_map_out is None:
        raise DatasetBuildError("build richiede --private-map-out fuori dal repository")
    artifacts = build_artifacts(
        spec_path=args.spec, source_root=source_root, catalog_path=args.catalog,
        rows_dir=args.rows_dir, receipts_dir=args.receipts_dir,
        proof_path=args.proof, private_map_out=args.private_map_out,
    )
    if args.action == "build":
        commit_artifacts(artifacts)
    else:
        check_artifacts(artifacts)
    print(json.dumps({"status": "ok", "action": args.action, "artifacts": len(artifacts), "sourceRootRecorded": False}, sort_keys=True))
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
