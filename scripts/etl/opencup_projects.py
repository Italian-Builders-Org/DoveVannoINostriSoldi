#!/usr/bin/env python3
"""Project a locked OpenCUP projects ZIP without publishing private identifiers."""
from __future__ import annotations

import csv
import gzip
import hashlib
import io
import itertools
import json
import re
import sqlite3
import tempfile
import zipfile
from dataclasses import dataclass
from pathlib import Path, PurePosixPath
from typing import Iterator

import integrated_curated_datasets as corpus


DATASET_ID = "opencup-progetti-bulk"
SOURCE_URL = "https://www.opencup.gov.it/portale/web/opencup/accesso-agli-open-data"
SYNTHETIC_SPEC_PATH = Path(__file__).with_name("specs") / "opencup-projects.synthetic.json"
CUP_RE = re.compile(r"^[A-Z0-9]{15}$")
MONEY_RE = re.compile(r"^[0-9]+(?:,[0-9]{1,2})?$")
MEMBER_RE = re.compile(r"^OpenCup_Progetti[0-9]+\.csv$")

SOURCE_HEADERS = [
    "CUP",
    "DESCRIZIONE_SINTETICA_CUP",
    "ANNO_DECISIONE",
    "DATA_GENERAZIONE_CUP",
    "STATO_PROGETTO",
    "COSTO_PROGETTO",
    "FINANZIAMENTO_PROGETTO",
    "SOGGETTO_TITOLARE",
    "PIVA_CODFISCALE_SOG_TITOLARE",
    "PIVA_CF_BENEFICIARIO",
    "CODICE_NATURA_INTERVENTO",
    "NATURA_INTERVENTO",
    "CODICE_TIPO_INTERVENTO",
    "TIPOLOGIA_INTERVENTO",
    "CODICE_REGIONE",
    "REGIONE",
    "CODICE_COMUNE",
    "COMUNE",
]
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


def _validate_contract(contract: dict[str, object]) -> None:
    if set(contract) != {
        "schemaVersion",
        "dataKind",
        "datasetId",
        "delimiter",
        "encoding",
        "evidenceLabel",
        "headers",
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
        or contract["encoding"] != "utf-8-sig"
        or contract["evidenceLabel"] != "synthetic-fixture"
        or contract["headers"] != SOURCE_HEADERS
        or contract["fixtureOnly"] is not True
        or contract["licenseStatus"] != "unverified"
        or contract["observedAt"] is not None
        or contract["publishedAt"] is not None
        or contract["moneyFormat"] != "decimal-comma-exact-v1"
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


def _member_infos(archive: zipfile.ZipFile, contract: dict[str, object]) -> list[zipfile.ZipInfo]:
    infos = archive.infolist()
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


def _public_row(values: dict[str, str], source_row: int) -> dict[str, object]:
    cup = values["CUP"]
    if cup and not CUP_RE.fullmatch(cup):
        raise SourceError(f"CUP OpenCUP non valido alla registrazione {source_row}")
    for field in ("COSTO_PROGETTO", "FINANZIAMENTO_PROGETTO"):
        value = values[field]
        try:
            parse_euro_cents(value)
        except SourceError as error:
            raise SourceError(
                f"Importo OpenCUP non valido alla registrazione {source_row}"
            ) from error

    cells: dict[str, str | None] = {}
    redactions: list[dict[str, str]] = []
    for field in SOURCE_HEADERS:
        value = values[field]
        if field in PRIVATE_FIELDS:
            if value:
                cells[field] = None
                redactions.append({"field": field, "reason": "personal-identifier"})
            else:
                cells[field] = ""
        else:
            cells[field] = value or None

    public_digest = corpus.sha256_bytes(corpus.canonical_json(cells))
    row_id = "row-" + corpus.sha256_bytes(
        f"{DATASET_ID}:{source_row}:{public_digest}".encode("utf-8")
    )[:24]
    return {
        "id": row_id,
        "cells": cells,
        "evidenceLabel": "synthetic-fixture",
        "redactions": redactions,
        "sourceRow": source_row,
        "sourceRowSha256": public_digest,
        "sourceUrls": [],
    }


def parse_euro_cents(value: str) -> int | None:
    """Parse the locked decimal-comma EUR value exactly, without float."""

    if value == "":
        return None
    match = MONEY_RE.fullmatch(value)
    if match is None:
        raise SourceError("Importo OpenCUP fuori contratto")
    whole, _, fraction = value.partition(",")
    return int(whole) * 100 + int(fraction.ljust(2, "0") or "0")


def _project_records(
    archive_path: Path,
    contract: dict[str, object],
) -> Iterator[tuple[dict[str, object], zipfile.ZipInfo, int]]:
    """Yield public rows with their private member/record provenance."""

    _validate_contract(contract)
    try:
        with zipfile.ZipFile(archive_path) as archive:
            infos = _member_infos(archive, contract)
            source_row = 0
            for info in infos:
                with archive.open(info) as binary:
                    with io.TextIOWrapper(
                        binary,
                        encoding=str(contract["encoding"]),
                        newline="",
                    ) as text:
                        reader = csv.DictReader(
                            text,
                            delimiter=str(contract["delimiter"]),
                            strict=True,
                        )
                        if reader.fieldnames != SOURCE_HEADERS:
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
                                _public_row(
                                    values,
                                    source_row,
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


def _build_postings(
    output: Path,
    cup: str,
    refs: list[tuple[int, int]],
) -> dict[str, object]:
    next_page: dict[str, object] | None = None
    for start in range(len(refs), 0, -MAX_POSTING_REFS):
        page_refs = refs[max(0, start - MAX_POSTING_REFS):start]
        raw = corpus.canonical_json(
            {
                "cup": cup,
                "kind": "postings",
                "next": next_page,
                "refs": [
                    {"chunkOrdinal": chunk_ordinal, "sourceRow": source_row}
                    for source_row, chunk_ordinal in page_refs
                ],
                "schemaVersion": 1,
            }
        )
        next_page = _write_object(output, raw, compressed=False)
    if next_page is None:
        raise SourceError("Posting list OpenCUP vuota")
    return next_page


def _pack_leaf_nodes(
    output: Path,
    entries: list[dict[str, object]],
) -> list[_NodeRange]:
    leaves: list[_NodeRange] = []
    pending: list[dict[str, object]] = []

    def flush() -> None:
        if not pending:
            return
        raw = corpus.canonical_json(
            {"entries": list(pending), "kind": "leaf", "schemaVersion": 1}
        )
        descriptor = _write_object(output, raw, compressed=False)
        leaves.append(
            _NodeRange(
                minimum=str(pending[0]["cup"]),
                maximum=str(pending[-1]["cup"]),
                descriptor=descriptor,
                depth=1,
            )
        )
        pending.clear()

    for entry in entries:
        candidate = [*pending, entry]
        candidate_raw = corpus.canonical_json(
            {"entries": candidate, "kind": "leaf", "schemaVersion": 1}
        )
        if pending and (
            len(candidate) > MAX_INDEX_CHILDREN
            or len(candidate_raw) > MAX_INDEX_NODE_RAW_BYTES
        ):
            flush()
        pending.append(entry)
    flush()
    return leaves


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
            "schemaVersion": 1,
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
) -> tuple[dict[str, object], int, int, dict[str, object]]:
    entries: list[dict[str, object]] = []
    indexed_rows = 0
    distinct_cups = 0
    cups = connection.execute("SELECT DISTINCT cup FROM refs ORDER BY cup")
    for (cup,) in cups:
        refs = list(
            connection.execute(
                "SELECT source_row, chunk_ordinal FROM refs WHERE cup = ? ORDER BY source_row",
                (cup,),
            )
        )
        first_page = _build_postings(output, cup, refs)
        entries.append({"cup": cup, "firstPage": first_page, "matchedRows": len(refs)})
        indexed_rows += len(refs)
        distinct_cups += 1
    if not entries:
        raise SourceError("La fixture OpenCUP non contiene CUP indicizzabili")

    nodes = _pack_leaf_nodes(output, entries)
    while len(nodes) > MAX_INDEX_CHILDREN:
        nodes = [
            _directory_node(output, nodes[start:start + MAX_INDEX_CHILDREN])
            for start in range(0, len(nodes), MAX_INDEX_CHILDREN)
        ]
    root = _directory_node(output, nodes)
    canary_cup, canary_source_row = connection.execute(
        "SELECT cup, source_row FROM refs ORDER BY cup, source_row LIMIT 1"
    ).fetchone()
    return (
        root.descriptor,
        indexed_rows,
        distinct_cups,
        {"cup": canary_cup, "sourceRow": canary_source_row},
    )


def build_fixture_release(
    archive_path: Path,
    output: Path,
    contract: dict[str, object],
) -> dict[str, object]:
    """Build a content-addressed local release that cannot be mistaken for production."""

    _validate_contract(contract)
    output.mkdir(parents=True, exist_ok=True)
    archive_bytes, archive_sha256 = _sha256_file(archive_path)
    _source_spec_bytes, source_spec_sha256 = _sha256_file(SYNTHETIC_SPEC_PATH)
    chunks: list[dict[str, object]] = []
    pending_rows: list[bytes] = []
    pending_bytes = 0
    pending_first_source_row = 0
    source_rows = 0
    redactions = 0
    member_ranges: list[dict[str, object]] = []
    current_member: str | None = None
    current_member_info: zipfile.ZipInfo | None = None
    current_member_first = 0
    current_member_rows = 0

    def flush_chunk() -> None:
        nonlocal pending_rows, pending_bytes, pending_first_source_row
        if not pending_rows:
            return
        descriptor = _write_object(output, b"".join(pending_rows), compressed=True)
        chunks.append(
            {
                **descriptor,
                "firstSourceRow": pending_first_source_row,
                "ordinal": len(chunks),
                "rowCount": len(pending_rows),
            }
        )
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
                chunk_ordinal = len(chunks)
                pending_rows.append(payload)
                pending_bytes += len(payload)
                redactions += len(row["redactions"])
                cup = row["cells"]["CUP"]
                if cup:
                    connection.execute(
                        "INSERT INTO refs(cup, source_row, chunk_ordinal) VALUES (?, ?, ?)",
                        (cup, source_rows, chunk_ordinal),
                    )
            flush_member()
            flush_chunk()
            connection.commit()
            root_index, indexed_rows, distinct_cups, canary = _build_index(output, connection)
        finally:
            connection.close()

    receipt = {
        "datasetId": DATASET_ID,
        "delimiter": contract["delimiter"],
        "encoding": contract["encoding"],
        "evidenceLabel": contract["evidenceLabel"],
        "fixtureOnly": True,
        "headers": SOURCE_HEADERS,
        "indexedRows": indexed_rows,
        "members": member_ranges,
        "moneyFormat": contract["moneyFormat"],
        "moneyUnit": contract["moneyUnit"],
        "publicRows": source_rows,
        "redactions": redactions,
        "schemaVersion": 1,
        "sourceBytes": archive_bytes,
        "sourceRows": source_rows,
        "sourceSha256": archive_sha256,
    }
    receipt_payload = corpus.canonical_json(receipt)
    corpus.write_bytes(output / "receipt.json", receipt_payload)
    manifest = {
        "canary": canary,
        "chunks": chunks,
        "datasetId": DATASET_ID,
        "distinctCups": distinct_cups,
        "evidenceLabel": contract["evidenceLabel"],
        "fixtureOnly": True,
        "headers": SOURCE_HEADERS,
        "indexedRows": indexed_rows,
        "projectionVersion": 1,
        "publicRows": source_rows,
        "licenseStatus": contract["licenseStatus"],
        "observedAt": contract["observedAt"],
        "publishedAt": contract["publishedAt"],
        "receiptSha256": corpus.sha256_bytes(receipt_payload),
        "rootIndex": root_index,
        "schemaVersion": 1,
        "sourceRows": source_rows,
        "sourceSha256": archive_sha256,
        "sourceSpecSha256": source_spec_sha256,
        "sourceUrl": SOURCE_URL,
    }
    corpus.write_bytes(output / "manifest.json", corpus.canonical_json(manifest))
    return manifest


def verify_fixture_release(manifest_path: Path) -> dict[str, int]:
    """Verify every object and reconciliation equation in a synthetic release."""

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
    expected_manifest_keys = {
        "canary", "chunks", "datasetId", "distinctCups", "evidenceLabel", "fixtureOnly", "headers",
        "indexedRows", "licenseStatus", "observedAt", "projectionVersion",
        "publicRows", "publishedAt", "receiptSha256", "rootIndex",
        "schemaVersion", "sourceRows", "sourceSha256", "sourceSpecSha256",
        "sourceUrl",
    }
    if set(manifest) != expected_manifest_keys or (
        manifest["schemaVersion"] != 1
        or manifest["projectionVersion"] != 1
        or manifest["datasetId"] != DATASET_ID
        or manifest["fixtureOnly"] is not True
        or manifest["evidenceLabel"] != "synthetic-fixture"
        or manifest["headers"] != SOURCE_HEADERS
        or manifest["licenseStatus"] != "unverified"
        or manifest["observedAt"] is not None
        or manifest["publishedAt"] is not None
        or manifest["sourceUrl"] != SOURCE_URL
    ):
        raise SourceError("Contratto manifest fixture OpenCUP divergente")
    for field in ("sourceSha256", "receiptSha256", "sourceSpecSha256"):
        if not isinstance(manifest[field], str) or not re.fullmatch(r"[0-9a-f]{64}", manifest[field]):
            raise SourceError(f"Digest manifest OpenCUP non valido: {field}")

    try:
        receipt_payload = (root / "receipt.json").read_bytes()
    except OSError as error:
        raise SourceError("Ricevuta fixture OpenCUP illeggibile") from error
    receipt = canonical_object(receipt_payload, "Ricevuta fixture OpenCUP")
    if corpus.sha256_bytes(receipt_payload) != manifest["receiptSha256"]:
        raise SourceError("Digest ricevuta fixture OpenCUP divergente")
    if (
        receipt.get("sourceSha256") != manifest["sourceSha256"]
        or receipt.get("sourceRows") != manifest["sourceRows"]
        or receipt.get("publicRows") != manifest["publicRows"]
        or receipt.get("indexedRows") != manifest["indexedRows"]
        or receipt.get("evidenceLabel") != manifest["evidenceLabel"]
        or receipt.get("moneyFormat") != "decimal-comma-exact-v1"
        or receipt.get("moneyUnit") != "EUR"
    ):
        raise SourceError("Ricevuta e manifest fixture OpenCUP non riconciliati")

    descriptor_keys = {"bytes", "format", "key", "rawBytes", "sha256"}
    verified_payloads: dict[str, tuple[dict[str, object], bytes]] = {}

    def descriptor(value: object, label: str) -> dict[str, object]:
        if not isinstance(value, dict) or set(value) != descriptor_keys:
            raise SourceError(f"Descrittore {label} non valido")
        digest = value.get("sha256")
        key = value.get("key")
        byte_count = value.get("bytes")
        raw_bytes = value.get("rawBytes")
        if (
            not isinstance(digest, str)
            or not re.fullmatch(r"[0-9a-f]{64}", digest)
            or key != f"sha256/{digest}"
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

    def read_object(value: object, label: str) -> bytes:
        item = descriptor(value, label)
        key = str(item["key"])
        cached = verified_payloads.get(key)
        if cached is not None:
            cached_descriptor, cached_raw = cached
            if cached_descriptor != item:
                raise SourceError(f"Descrittore {label} divergente per oggetto già verificato")
            return cached_raw
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
        verified_payloads[key] = (dict(item), raw)
        return raw

    chunks = manifest["chunks"]
    if not isinstance(chunks, list) or not chunks:
        raise SourceError("Chunk fixture OpenCUP mancanti")
    rows_by_source: dict[int, dict[str, object]] = {}
    expected_source_row = 1
    for ordinal, item in enumerate(chunks):
        if not isinstance(item, dict):
            raise SourceError("Chunk fixture OpenCUP non valido")
        chunk_keys = descriptor_keys | {"firstSourceRow", "ordinal", "rowCount"}
        if set(item) != chunk_keys or (
            item["ordinal"] != ordinal
            or item["firstSourceRow"] != expected_source_row
            or not isinstance(item["rowCount"], int)
            or isinstance(item["rowCount"], bool)
            or not 1 <= item["rowCount"] <= MAX_CHUNK_ROWS
        ):
            raise SourceError("Intervalli chunk fixture OpenCUP divergenti")
        base = {key: item[key] for key in descriptor_keys}
        if base["format"] != "jsonl-gzip-v1" or base["rawBytes"] > MAX_CHUNK_RAW_BYTES:
            raise SourceError("Formato o budget chunk fixture OpenCUP divergente")
        raw = read_object(base, f"chunk {ordinal}")
        if not raw.endswith(b"\n"):
            raise SourceError("Chunk fixture OpenCUP non canonico")
        lines = raw[:-1].split(b"\n")
        if len(lines) != item["rowCount"]:
            raise SourceError("Conteggio righe chunk fixture OpenCUP divergente")
        for offset, line in enumerate(lines):
            row = canonical_object(line + b"\n", "Riga fixture OpenCUP")
            source_row = expected_source_row + offset
            cells = row.get("cells")
            public_digest = corpus.sha256_bytes(corpus.canonical_json(cells)) if isinstance(cells, dict) else ""
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
                or set(cells) != set(SOURCE_HEADERS)
                or row.get("sourceRowSha256") != public_digest
                or row.get("id") != expected_id
                or row.get("evidenceLabel") != "synthetic-fixture"
                or row.get("sourceUrls") != []
            ):
                raise SourceError("Proiezione riga fixture OpenCUP divergente")
            redactions = row.get("redactions")
            if not isinstance(redactions, list):
                raise SourceError("Redazioni riga fixture OpenCUP divergenti")
            for private_field in PRIVATE_FIELDS:
                cell = cells[private_field]
                matches = [
                    redaction for redaction in redactions
                    if isinstance(redaction, dict)
                    and redaction.get("field") == private_field
                    and redaction.get("reason") == "personal-identifier"
                ]
                if cell not in {None, ""} or (cell is None and len(matches) != 1) or (
                    cell == "" and matches
                ):
                    raise SourceError("Campo privato fixture OpenCUP non redatto")
            for value in cells.values():
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
                    raise SourceError("Metadato non pubblico nella fixture OpenCUP")
            rows_by_source[source_row] = row
        expected_source_row += item["rowCount"]
    if expected_source_row - 1 != manifest["publicRows"] or manifest["sourceRows"] != manifest["publicRows"]:
        raise SourceError("Copertura righe fixture OpenCUP divergente")

    postings: dict[str, list[int]] = {}

    def read_postings(value: object, cup: str) -> list[int]:
        refs: list[int] = []
        current = value
        seen: set[str] = set()
        while current is not None:
            item = descriptor(current, "posting list")
            if item["sha256"] in seen:
                raise SourceError("Ciclo posting list fixture OpenCUP")
            seen.add(str(item["sha256"]))
            page = canonical_object(read_object(item, "posting list"), "Posting list fixture OpenCUP")
            if set(page) != {"cup", "kind", "next", "refs", "schemaVersion"} or (
                page["schemaVersion"] != 1 or page["kind"] != "postings" or page["cup"] != cup
            ):
                raise SourceError("Schema posting list fixture OpenCUP divergente")
            page_refs = page["refs"]
            if not isinstance(page_refs, list) or not 1 <= len(page_refs) <= MAX_POSTING_REFS:
                raise SourceError("Pagina posting fixture OpenCUP fuori contratto")
            for ref in page_refs:
                if not isinstance(ref, dict) or set(ref) != {"chunkOrdinal", "sourceRow"}:
                    raise SourceError("Riferimento posting fixture OpenCUP non valido")
                source_row = ref["sourceRow"]
                chunk_ordinal = ref["chunkOrdinal"]
                if (
                    not isinstance(source_row, int)
                    or isinstance(source_row, bool)
                    or not isinstance(chunk_ordinal, int)
                    or isinstance(chunk_ordinal, bool)
                    or source_row not in rows_by_source
                    or rows_by_source[source_row]["cells"]["CUP"] != cup
                    or not 0 <= chunk_ordinal < len(chunks)
                    or not chunks[chunk_ordinal]["firstSourceRow"] <= source_row
                    < chunks[chunk_ordinal]["firstSourceRow"] + chunks[chunk_ordinal]["rowCount"]
                ):
                    raise SourceError("Riferimento posting fixture OpenCUP divergente")
                refs.append(source_row)
            current = page["next"]
        if refs != sorted(set(refs)):
            raise SourceError("Posting fixture OpenCUP non ordinata o duplicata")
        return refs

    def read_node(value: object, depth: int) -> tuple[str, str]:
        if depth > MAX_INDEX_DEPTH:
            raise SourceError("Profondità indice fixture OpenCUP oltre contratto")
        item = descriptor(value, "indice")
        if item["format"] != "json-v1" or item["rawBytes"] > MAX_INDEX_NODE_RAW_BYTES:
            raise SourceError("Nodo indice fixture OpenCUP fuori contratto")
        node = canonical_object(read_object(item, "indice"), "Indice fixture OpenCUP")
        if node.get("kind") == "directory":
            if set(node) != {"children", "kind", "schemaVersion"} or node["schemaVersion"] != 1:
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
            node.get("kind") != "leaf" or node["schemaVersion"] != 1
        ):
            raise SourceError("Foglia indice fixture OpenCUP divergente")
        entries = node["entries"]
        if not isinstance(entries, list) or not 1 <= len(entries) <= MAX_INDEX_CHILDREN:
            raise SourceError("Voci foglia fixture OpenCUP fuori contratto")
        cups: list[str] = []
        for entry in entries:
            if not isinstance(entry, dict) or set(entry) != {"cup", "firstPage", "matchedRows"}:
                raise SourceError("Voce foglia fixture OpenCUP non valida")
            cup = entry["cup"]
            if not isinstance(cup, str) or not CUP_RE.fullmatch(cup) or cup in postings:
                raise SourceError("CUP foglia fixture OpenCUP non valido o duplicato")
            refs = read_postings(entry["firstPage"], cup)
            if entry["matchedRows"] != len(refs):
                raise SourceError("Conteggio posting fixture OpenCUP divergente")
            postings[cup] = refs
            cups.append(cup)
        if cups != sorted(cups):
            raise SourceError("CUP foglia fixture OpenCUP non ordinati")
        return cups[0], cups[-1]

    read_node(manifest["rootIndex"], 1)
    expected_postings: dict[str, list[int]] = {}
    for source_row, row in rows_by_source.items():
        cup = row["cells"]["CUP"]
        if cup:
            expected_postings.setdefault(cup, []).append(source_row)
    if postings != expected_postings or (
        sum(map(len, postings.values())) != manifest["indexedRows"]
        or len(postings) != manifest["distinctCups"]
    ):
        raise SourceError("Indice e righe fixture OpenCUP non riconciliati")
    canary = manifest["canary"]
    if (
        not isinstance(canary, dict)
        or set(canary) != {"cup", "sourceRow"}
        or canary.get("cup") not in postings
        or canary.get("sourceRow") not in postings[canary["cup"]]
    ):
        raise SourceError("Canary fixture OpenCUP non riconciliata")
    return {
        "verifiedObjects": len(verified_payloads),
        "verifiedPostingRefs": sum(map(len, postings.values())),
        "verifiedRows": len(rows_by_source),
    }
