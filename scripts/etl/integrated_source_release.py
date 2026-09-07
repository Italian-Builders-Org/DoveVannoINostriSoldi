#!/usr/bin/env python3
"""Seal the independently validated source gates into one deterministic release proof."""

from __future__ import annotations

import argparse
import hashlib
import json
import os
import re
import stat
import tempfile
from collections import Counter
from dataclasses import dataclass
from pathlib import Path
from typing import Any

import integrated_curated_datasets as dataset_etl
from curated_source_catalog import validate_public_entries
from source_corpus.archive_receipt import check_receipt
from source_catalog import canonical_json as source_canonical_json
from source_catalog import load_policy as load_source_policy


ROOT = Path(__file__).resolve().parents[2]
LEDGER = ROOT / "data/source-ledger"
DEFAULT_OUTPUT = LEDGER / "release-proof.json"
DEFAULT_ARCHIVE_POLICY = ROOT / "scripts/etl/specs/source-corpus-policy.json"
DEFAULT_SOURCE_POLICY = ROOT / "scripts/etl/specs/curated-source-catalog-policy.json"
DEFAULT_DATASET_SPEC = ROOT / "scripts/etl/specs/integrated-curated-datasets.source.json"
DEFAULT_DATASET_CATALOG = ROOT / "src/data/generated/integrated/catalog.json"
DEFAULT_DATASET_ROWS = ROOT / "src/data/generated/integrated/rows"

SHA256_RE = re.compile(r"[0-9a-f]{64}\Z")
SHORT_KEY_ID_RE = re.compile(r"[0-9a-f]{16}\Z")
MAX_SAFE_INTEGER = 9_007_199_254_740_991
EXPECTED_CORPUS = {
    "entries": 51_303,
    "regular": 46_438,
    "hardlink": 4_860,
    "symlink": 5,
}
EXPECTED_DATASETS = 91
EXPECTED_DATASET_ROWS = {
    "sourceRows": 14_457_856,
    "publicRows": 1_475_510,
    "catalogOnlyRows": 12_979_505,
    "derivedOnlyRows": 2_841,
}

SOURCE_PROOF_KEYS = frozenset({"schemaVersion", "catalogVersion", "coverage", "integrity"})
SOURCE_COVERAGE_KEYS = frozenset(
    {
        "inputRows",
        "uniqueIdentities",
        "accountedIdentities",
        "duplicateInputRows",
        "totalOccurrences",
        "publishedIdentities",
        "quarantinedIdentities",
        "byClassification",
        "byDisposition",
        "byReason",
    }
)
SOURCE_INTEGRITY_KEYS = frozenset(
    {
        "privateInputBytes",
        "privateInputSha256",
        "policySha256",
        "idKeyId",
        "publicCatalogBytes",
        "publicCatalogSha256",
        "identitySetSha256",
    }
)
DATASET_PROOF_KEYS = frozenset(
    {"schemaVersion", "generatedAt", "complete", "totals", "catalogSha256", "artifactSha256"}
)
DATASET_TOTAL_KEYS = frozenset(
    {"datasets", "sourceRows", "publicRows", "catalogOnlyRows", "derivedOnlyRows", "sourceBytes"}
)
DATASET_RECEIPT_KEYS = frozenset(
    {"schemaVersion", "datasetId", "source", "publication", "rowEquationClosed", "rowsSha256"}
)
DATASET_PUBLICATION_KEYS = frozenset(
    {
        "status",
        "publicRows",
        "catalogOnlyRows",
        "derivedOnlyRows",
        "redactions",
        "rowsWithPublicSource",
    }
)
DATASET_CATALOG_KEYS = frozenset(
    {"schemaVersion", "generatedAt", "corpusContract", "totals", "datasets"}
)
DATASET_CATALOG_ENTRY_KEYS = frozenset(
    {
        "id",
        "title",
        "domain",
        "authority",
        "licenseStatus",
        "publication",
        "evidenceLabel",
        "rows",
        "publicRows",
        "rowsWithPublicSource",
        "headers",
        "privateFields",
        "caveats",
        "sourceMetadata",
        "receiptSha256",
    }
)
DATASET_CATALOG_OPTIONAL_ENTRY_KEYS = frozenset({"inspection"})
RELEASE_KEYS = frozenset(
    {"schemaVersion", "complete", "contract", "archiveReceipt", "sourceCatalog", "datasets", "releaseSetSha256"}
)


class ReleaseError(ValueError):
    """One source gate or the aggregate release proof is incomplete or divergent."""


@dataclass(frozen=True)
class ReleasePaths:
    ledger_dir: Path = LEDGER
    archive_policy: Path = DEFAULT_ARCHIVE_POLICY
    source_policy: Path = DEFAULT_SOURCE_POLICY
    dataset_spec: Path = DEFAULT_DATASET_SPEC
    dataset_catalog: Path = DEFAULT_DATASET_CATALOG
    dataset_rows_dir: Path = DEFAULT_DATASET_ROWS
    output: Path = DEFAULT_OUTPUT

    @property
    def archive_receipt(self) -> Path:
        return self.ledger_dir / "receipt.json"

    @property
    def source_catalog(self) -> Path:
        return self.ledger_dir / "sources.jsonl"

    @property
    def source_proof(self) -> Path:
        return self.ledger_dir / "source-catalog-proof.json"

    @property
    def dataset_proof(self) -> Path:
        return self.ledger_dir / "dataset-proof.json"

    @property
    def dataset_receipts_dir(self) -> Path:
        return self.ledger_dir / "datasets"


def canonical_json(value: object) -> bytes:
    return json.dumps(
        value,
        ensure_ascii=False,
        sort_keys=True,
        separators=(",", ":"),
        allow_nan=False,
    ).encode("utf-8")


def canonical_document(value: object) -> bytes:
    return canonical_json(value) + b"\n"


def sha256_bytes(payload: bytes) -> str:
    return hashlib.sha256(payload).hexdigest()


def _reject_constant(value: str) -> object:
    raise ReleaseError(f"non-finite JSON constant is forbidden: {value}")


def _reject_duplicate_keys(pairs: list[tuple[str, object]]) -> dict[str, object]:
    result: dict[str, object] = {}
    for key, value in pairs:
        if key in result:
            raise ReleaseError("JSON contains a duplicate key")
        result[key] = value
    return result


def _read_regular(path: Path, label: str) -> bytes:
    if path.is_symlink():
        raise ReleaseError(f"{label} cannot be a symbolic link")
    try:
        metadata = path.stat()
        if not stat.S_ISREG(metadata.st_mode):
            raise ReleaseError(f"{label} must be a regular file")
        return path.read_bytes()
    except OSError as exc:
        raise ReleaseError(f"{label} is missing or unreadable") from exc


def _require_directory(path: Path, label: str) -> None:
    if path.is_symlink() or not path.is_dir():
        raise ReleaseError(f"{label} must be a real directory")


def _load_canonical_object(path: Path, label: str) -> tuple[dict[str, object], bytes]:
    payload = _read_regular(path, label)
    try:
        value = json.loads(
            payload.decode("utf-8"),
            object_pairs_hook=_reject_duplicate_keys,
            parse_constant=_reject_constant,
        )
    except (UnicodeDecodeError, json.JSONDecodeError) as exc:
        raise ReleaseError(f"{label} is not strict UTF-8 JSON") from exc
    if not isinstance(value, dict):
        raise ReleaseError(f"{label} must be an object")
    if payload != canonical_document(value):
        raise ReleaseError(f"{label} is not canonical JSON")
    return value, payload


def _load_canonical_jsonl(path: Path, label: str) -> tuple[list[dict[str, object]], bytes]:
    payload = _read_regular(path, label)
    if not payload or not payload.endswith(b"\n"):
        raise ReleaseError(f"{label} must be non-empty and newline-terminated")
    entries: list[dict[str, object]] = []
    for index, line in enumerate(payload.splitlines(keepends=True), start=1):
        if line == b"\n":
            raise ReleaseError(f"{label} contains a blank line")
        try:
            value = json.loads(
                line.decode("utf-8"),
                object_pairs_hook=_reject_duplicate_keys,
                parse_constant=_reject_constant,
            )
        except (UnicodeDecodeError, json.JSONDecodeError) as exc:
            raise ReleaseError(f"{label} line {index} is not strict JSON") from exc
        if not isinstance(value, dict) or line != canonical_document(value):
            raise ReleaseError(f"{label} line {index} is not a canonical object")
        entries.append(value)
    return entries, payload


def _require_dict(value: object, label: str) -> dict[str, object]:
    if not isinstance(value, dict):
        raise ReleaseError(f"{label} must be an object")
    return value


def _require_list(value: object, label: str) -> list[object]:
    if not isinstance(value, list):
        raise ReleaseError(f"{label} must be an array")
    return value


def _require_safe_int(value: object, label: str, *, positive: bool = False) -> int:
    minimum = 1 if positive else 0
    if (
        isinstance(value, bool)
        or not isinstance(value, int)
        or value < minimum
        or value > MAX_SAFE_INTEGER
    ):
        raise ReleaseError(f"{label} must be a safe integer >= {minimum}")
    return value


def _require_sha(value: object, label: str) -> str:
    if not isinstance(value, str) or SHA256_RE.fullmatch(value) is None:
        raise ReleaseError(f"{label} must be a lowercase SHA-256 digest")
    return value


def _require_exact_keys(value: object, keys: frozenset[str], label: str) -> dict[str, object]:
    result = _require_dict(value, label)
    if set(result) != keys:
        raise ReleaseError(f"{label} fields diverge from the closed schema")
    return result


def _validate_ledger_layout(paths: ReleasePaths) -> None:
    _require_directory(paths.ledger_dir, "source ledger")
    required = {
        "receipt.json",
        "elements",
        "sources.jsonl",
        "source-catalog-proof.json",
        "dataset-proof.json",
        "datasets",
    }
    allowed = set(required)
    try:
        output_in_ledger = paths.output.parent.resolve(strict=False) == paths.ledger_dir.resolve(
            strict=False
        )
    except OSError:
        output_in_ledger = False
    if output_in_ledger:
        allowed.add(paths.output.name)
    actual = {entry.name for entry in paths.ledger_dir.iterdir()}
    missing = required - actual
    extra = actual - allowed
    if missing:
        raise ReleaseError("source ledger is missing a required gate artifact")
    if extra:
        raise ReleaseError("source ledger contains an unaccounted root artifact")


def _validate_archive_receipt(paths: ReleasePaths) -> dict[str, object]:
    try:
        receipt = check_receipt(
            output_dir=paths.ledger_dir,
            policy_path=paths.archive_policy,
        )
    except Exception as exc:
        if isinstance(exc, (KeyboardInterrupt, SystemExit)):
            raise
        raise ReleaseError("archive receipt gate failed") from exc

    expected = _require_dict(receipt.get("expected"), "archive.expected")
    observed = _require_dict(receipt.get("observed"), "archive.observed")
    actual_contract = {
        "entries": observed.get("entries"),
        "regular": observed.get("regular"),
        "hardlink": observed.get("hardlink"),
        "symlink": observed.get("symlink"),
    }
    if expected != EXPECTED_CORPUS or actual_contract != EXPECTED_CORPUS:
        raise ReleaseError("archive receipt does not match the release corpus contract")

    receipt_payload = _read_regular(paths.archive_receipt, "archive aggregate receipt")
    sharding = _require_dict(receipt.get("sharding"), "archive.sharding")
    shards = _require_list(sharding.get("shards"), "archive.shards")
    archive = _require_dict(receipt.get("archive"), "archive envelope")
    for field in ("bytes",):
        _require_safe_int(archive.get(field), f"archive.{field}", positive=True)
    _require_sha(archive.get("sha256"), "archive.sha256")
    _require_sha(sharding.get("elementSetSha256"), "archive.elementSetSha256")
    shard_bytes = 0
    for index, raw_shard in enumerate(shards):
        shard = _require_dict(raw_shard, f"archive.shards[{index}]")
        shard_bytes += _require_safe_int(shard.get("bytes"), "archive shard bytes", positive=True)

    return {
        "receiptBytes": len(receipt_payload),
        "receiptSha256": sha256_bytes(receipt_payload),
        "archiveBytes": archive["bytes"],
        "archiveSha256": archive["sha256"],
        "elementSetSha256": sharding["elementSetSha256"],
        "shards": len(shards),
        "shardBytes": shard_bytes,
        "entries": observed["entries"],
        "regular": observed["regular"],
        "hardlink": observed["hardlink"],
        "symlink": observed["symlink"],
        "storedBytes": observed["storedBytes"],
        "logicalBytes": observed["logicalBytes"],
    }


def _count_map(counter: Counter[str], domain: list[object] | None = None) -> dict[str, int]:
    keys = set(counter)
    if domain is not None:
        keys.update(str(item) for item in domain)
    return {key: counter[key] for key in sorted(keys)}


def _validate_source_catalog(paths: ReleasePaths) -> dict[str, object]:
    try:
        policy, policy_bytes = load_source_policy(paths.source_policy)
        entries, catalog_payload = _load_canonical_jsonl(paths.source_catalog, "source catalog")
        proof, proof_payload = _load_canonical_object(paths.source_proof, "source catalog proof")
        validate_public_entries(entries, policy)
    except Exception as exc:
        if isinstance(exc, (KeyboardInterrupt, SystemExit, ReleaseError)):
            raise
        raise ReleaseError("source catalog gate failed") from exc

    _require_exact_keys(proof, SOURCE_PROOF_KEYS, "source catalog proof")
    if proof.get("schemaVersion") != 1 or proof.get("catalogVersion") != policy["catalogVersion"]:
        raise ReleaseError("source catalog proof version diverges from policy")

    coverage = _require_exact_keys(
        proof.get("coverage"), SOURCE_COVERAGE_KEYS, "source catalog coverage"
    )
    for field in (
        "inputRows",
        "uniqueIdentities",
        "accountedIdentities",
        "duplicateInputRows",
        "totalOccurrences",
        "publishedIdentities",
        "quarantinedIdentities",
    ):
        _require_safe_int(coverage.get(field), f"source coverage.{field}")

    classifications = Counter(str(entry["classification"]) for entry in entries)
    dispositions = Counter(str(entry["disposition"]) for entry in entries)
    reasons: Counter[str] = Counter()
    for entry in entries:
        for reason in _require_list(entry.get("reasonCodes"), "source reason codes"):
            reasons[str(reason)] += 1
    total_occurrences = sum(
        _require_safe_int(entry.get("occurrences"), "source occurrences", positive=True)
        for entry in entries
    )
    expected_coverage = {
        "inputRows": coverage["inputRows"],
        "uniqueIdentities": len(entries),
        "accountedIdentities": len(entries),
        "duplicateInputRows": coverage["duplicateInputRows"],
        "totalOccurrences": total_occurrences,
        "publishedIdentities": dispositions["published"],
        "quarantinedIdentities": dispositions["quarantined"],
        "byClassification": _count_map(classifications, policy.get("classifications")),
        "byDisposition": _count_map(dispositions, policy.get("dispositions")),
        "byReason": _count_map(reasons),
    }
    if coverage["inputRows"] != len(entries) + coverage["duplicateInputRows"]:
        raise ReleaseError("source catalog input-row equation does not close")
    if coverage != expected_coverage:
        raise ReleaseError("source catalog public coverage is not reproducible")

    integrity = _require_exact_keys(
        proof.get("integrity"), SOURCE_INTEGRITY_KEYS, "source catalog integrity"
    )
    _require_safe_int(integrity.get("privateInputBytes"), "private source bytes", positive=True)
    _require_safe_int(integrity.get("publicCatalogBytes"), "public catalog bytes", positive=True)
    for field in (
        "privateInputSha256",
        "policySha256",
        "publicCatalogSha256",
        "identitySetSha256",
    ):
        _require_sha(integrity.get(field), f"source integrity.{field}")
    if not isinstance(integrity.get("idKeyId"), str) or SHORT_KEY_ID_RE.fullmatch(
        str(integrity["idKeyId"])
    ) is None:
        raise ReleaseError("source catalog key identifier is invalid")

    expected_integrity = {
        "privateInputBytes": integrity["privateInputBytes"],
        "privateInputSha256": integrity["privateInputSha256"],
        "policySha256": sha256_bytes(policy_bytes),
        "idKeyId": integrity["idKeyId"],
        "publicCatalogBytes": len(catalog_payload),
        "publicCatalogSha256": sha256_bytes(catalog_payload),
        "identitySetSha256": sha256_bytes(
            source_canonical_json([str(entry["id"]) for entry in entries])
        ),
    }
    if integrity != expected_integrity:
        raise ReleaseError("source catalog proof does not bind the committed catalog bytes")

    return {
        "proofBytes": len(proof_payload),
        "proofSha256": sha256_bytes(proof_payload),
        "catalogBytes": len(catalog_payload),
        "catalogSha256": sha256_bytes(catalog_payload),
        "identities": len(entries),
        "published": dispositions["published"],
        "quarantined": dispositions["quarantined"],
        "totalOccurrences": total_occurrences,
    }


def _require_exact_files(directory: Path, expected_names: set[str], label: str) -> None:
    _require_directory(directory, label)
    entries = list(directory.iterdir())
    if any(entry.is_symlink() or not entry.is_file() for entry in entries):
        raise ReleaseError(f"{label} contains a non-regular entry")
    if {entry.name for entry in entries} != expected_names:
        raise ReleaseError(f"{label} contains a missing or extra artifact")


def _dataset_artifact_key(path: Path) -> str:
    try:
        return path.relative_to(dataset_etl.ROOT).as_posix()
    except ValueError as exc:
        raise ReleaseError("dataset artifact is outside the public repository root") from exc


def _expected_catalog_entry(
    item: dict[str, Any],
    receipt: dict[str, object],
    receipt_payload: bytes,
    source_metadata: dict[str, Any],
) -> dict[str, object]:
    source = _require_dict(receipt["source"], f"{item['id']}.source")
    publication = _require_dict(receipt["publication"], f"{item['id']}.publication")
    entry: dict[str, object] = {
        "id": item["id"],
        "title": item["title"],
        "domain": item["domain"],
        "authority": item["authority"],
        "licenseStatus": item["licenseStatus"],
        "publication": item["publication"],
        "evidenceLabel": item["evidenceLabel"],
        "rows": source["rows"],
        "publicRows": publication["publicRows"],
        "rowsWithPublicSource": publication["rowsWithPublicSource"],
        "headers": source["headers"],
        "privateFields": sorted(item["privateFields"]),
        "caveats": item["caveats"],
        "sourceMetadata": source_metadata,
        "receiptSha256": sha256_bytes(receipt_payload),
    }
    if "inspection" in item:
        entry["inspection"] = dataset_etl.inspection_receipt_projection(
            item["inspection"]
        )
    return entry


def _validate_dataset_receipt(
    item: dict[str, Any],
    receipt: dict[str, object],
) -> dict[str, int]:
    dataset_id = str(item["id"])
    _require_exact_keys(receipt, DATASET_RECEIPT_KEYS, f"{dataset_id} receipt")
    if (
        receipt.get("schemaVersion") != 1
        or receipt.get("datasetId") != dataset_id
        or receipt.get("rowEquationClosed") is not True
    ):
        raise ReleaseError(f"{dataset_id} receipt identity or closure diverges")

    source = _require_dict(receipt.get("source"), f"{dataset_id}.source")
    expected = item["expected"]
    expected_headers = expected.get("headers") or ["value"]
    expected_columns = expected.get("columns") or 1
    expected_source: dict[str, object] = {
        "bytes": expected["bytes"],
        "sha256": expected["sha256"],
        "rows": expected["rows"],
        "columns": expected_columns,
        "headers": expected_headers,
    }
    for key in ("reportedColumns", "reportedFiles"):
        if key in expected:
            expected_source[key] = expected[key]
    if "sources" in item:
        expected_source["sourceSet"] = {
            "sha256": expected["sha256"],
            "files": dataset_etl.source_part_commitments(item),
        }
    if "inspection" in item:
        expected_source["inspection"] = dataset_etl.inspection_receipt_projection(
            item["inspection"]
        )
    if source != expected_source:
        raise ReleaseError(f"{dataset_id} source identity diverges from its spec")

    publication = _require_exact_keys(
        receipt.get("publication"), DATASET_PUBLICATION_KEYS, f"{dataset_id}.publication"
    )
    for field in (
        "publicRows",
        "catalogOnlyRows",
        "derivedOnlyRows",
        "redactions",
        "rowsWithPublicSource",
    ):
        _require_safe_int(publication.get(field), f"{dataset_id}.{field}")
    if publication.get("status") != item["publication"]:
        raise ReleaseError(f"{dataset_id} publication status diverges")
    rows = int(source["rows"])
    expected_distribution = {
        "rows": (rows, 0, 0),
        "source-index": (rows, 0, 0),
        "catalog-only": (0, rows, 0),
        "derived-only": (0, 0, rows),
    }[str(item["publication"])]
    actual_distribution = (
        publication["publicRows"],
        publication["catalogOnlyRows"],
        publication["derivedOnlyRows"],
    )
    if actual_distribution != expected_distribution:
        raise ReleaseError(f"{dataset_id} row equation does not match its publication mode")
    if publication["rowsWithPublicSource"] > rows:
        raise ReleaseError(f"{dataset_id} source-link coverage exceeds source rows")

    rows_sha = receipt.get("rowsSha256")
    if item["publication"] in {"rows", "source-index"}:
        _require_sha(rows_sha, f"{dataset_id}.rowsSha256")
    elif rows_sha is not None:
        raise ReleaseError(f"{dataset_id} exposes an unexpected row artifact digest")
    return {
        "sourceRows": rows,
        "publicRows": int(publication["publicRows"]),
        "catalogOnlyRows": int(publication["catalogOnlyRows"]),
        "derivedOnlyRows": int(publication["derivedOnlyRows"]),
        "sourceBytes": int(source["bytes"]),
    }


def _validate_datasets(paths: ReleasePaths) -> dict[str, object]:
    spec_payload = _read_regular(paths.dataset_spec, "integrated dataset spec")
    try:
        spec, dataset_items = dataset_etl.load_spec(paths.dataset_spec)
    except Exception as exc:
        if isinstance(exc, (KeyboardInterrupt, SystemExit)):
            raise
        raise ReleaseError("integrated dataset spec gate failed") from exc
    if len(dataset_items) != EXPECTED_DATASETS:
        raise ReleaseError("integrated dataset count diverges from the release contract")
    corpus = _require_dict(spec.get("corpusContract"), "dataset corpus contract")
    if corpus != {
        "elements": EXPECTED_CORPUS["entries"],
        "regularFiles": EXPECTED_CORPUS["regular"],
        "hardlinks": EXPECTED_CORPUS["hardlink"],
        "symlinks": EXPECTED_CORPUS["symlink"],
    }:
        raise ReleaseError("dataset corpus contract diverges from the archive receipt")

    receipt_names = {f"{item['id']}.receipt.json" for item in dataset_items}
    row_names: set[str] = set()
    for item in dataset_items:
        if item["publication"] not in {"rows", "source-index"}:
            continue
        row_count = int(item["expected"]["rows"])
        chunk_count = (
            row_count + dataset_etl.PUBLIC_ROW_CHUNK_ROWS - 1
        ) // dataset_etl.PUBLIC_ROW_CHUNK_ROWS
        row_names.update(
            dataset_etl.row_chunk_name(str(item["id"]), ordinal)
            for ordinal in range(chunk_count)
        )
    _require_exact_files(paths.dataset_receipts_dir, receipt_names, "dataset receipts")
    _require_exact_files(paths.dataset_rows_dir, row_names, "dataset row artifacts")

    proof, proof_payload = _load_canonical_object(paths.dataset_proof, "dataset proof")
    catalog, catalog_payload = _load_canonical_object(paths.dataset_catalog, "dataset catalog")
    _require_exact_keys(proof, DATASET_PROOF_KEYS, "dataset proof")
    _require_exact_keys(catalog, DATASET_CATALOG_KEYS, "dataset catalog")
    if proof.get("schemaVersion") != 1 or proof.get("complete") is not True:
        raise ReleaseError("dataset proof is not complete")
    if catalog.get("schemaVersion") != 1:
        raise ReleaseError("dataset catalog schema version diverges")
    if proof.get("generatedAt") != spec["generatedAt"] or catalog.get("generatedAt") != spec["generatedAt"]:
        raise ReleaseError("dataset release timestamp diverges from the pinned spec")
    if catalog.get("corpusContract") != corpus:
        raise ReleaseError("dataset catalog corpus contract diverges")
    if proof.get("catalogSha256") != sha256_bytes(catalog_payload):
        raise ReleaseError("dataset proof does not bind the catalog bytes")

    artifact_hashes = _require_dict(proof.get("artifactSha256"), "dataset artifact hashes")
    expected_paths = {paths.dataset_catalog}
    expected_paths.update(paths.dataset_receipts_dir / name for name in receipt_names)
    expected_paths.update(paths.dataset_rows_dir / name for name in row_names)
    expected_artifact_keys = {_dataset_artifact_key(path) for path in expected_paths}
    if set(artifact_hashes) != expected_artifact_keys:
        raise ReleaseError("dataset proof artifact set has a missing or extra member")
    for key, digest in artifact_hashes.items():
        _require_sha(digest, f"dataset artifact {key}")

    catalog_entries = _require_list(catalog.get("datasets"), "dataset catalog entries")
    if len(catalog_entries) != EXPECTED_DATASETS:
        raise ReleaseError(
            f"dataset catalog does not contain exactly {EXPECTED_DATASETS} entries"
        )
    catalog_by_id: dict[str, dict[str, object]] = {}
    catalog_ids: list[str] = []
    for raw_entry in catalog_entries:
        raw_catalog_entry = _require_dict(raw_entry, "dataset catalog entry")
        entry_keys = set(raw_catalog_entry)
        if not DATASET_CATALOG_ENTRY_KEYS.issubset(entry_keys) or not entry_keys.issubset(
            DATASET_CATALOG_ENTRY_KEYS | DATASET_CATALOG_OPTIONAL_ENTRY_KEYS
        ):
            raise ReleaseError("dataset catalog entry fields diverge from the closed schema")
        entry = raw_catalog_entry
        dataset_id = entry.get("id")
        if not isinstance(dataset_id, str) or dataset_id in catalog_by_id:
            raise ReleaseError("dataset catalog identifier is invalid or duplicated")
        catalog_by_id[dataset_id] = entry
        catalog_ids.append(dataset_id)
    if catalog_ids != sorted(catalog_ids):
        raise ReleaseError("dataset catalog entries are not ordered by identifier")

    totals = {
        "datasets": 0,
        "sourceRows": 0,
        "publicRows": 0,
        "catalogOnlyRows": 0,
        "derivedOnlyRows": 0,
        "sourceBytes": 0,
    }
    receipt_set: list[dict[str, str]] = []
    for item in dataset_items:
        dataset_id = str(item["id"])
        receipt_path = paths.dataset_receipts_dir / f"{dataset_id}.receipt.json"
        receipt, receipt_payload = _load_canonical_object(
            receipt_path, f"dataset receipt {dataset_id}"
        )
        receipt_totals = _validate_dataset_receipt(item, receipt)
        expected_catalog = _expected_catalog_entry(
            item,
            receipt,
            receipt_payload,
            dataset_etl.resolved_source_metadata(spec, dataset_id),
        )
        if catalog_by_id.get(dataset_id) != expected_catalog:
            raise ReleaseError(f"dataset catalog entry diverges for {dataset_id}")
        receipt_hash = sha256_bytes(receipt_payload)
        if artifact_hashes.get(_dataset_artifact_key(receipt_path)) != receipt_hash:
            raise ReleaseError(f"dataset proof receipt hash diverges for {dataset_id}")
        receipt_set.append({"id": dataset_id, "sha256": receipt_hash})
        totals["datasets"] += 1
        for field in ("sourceRows", "publicRows", "catalogOnlyRows", "derivedOnlyRows", "sourceBytes"):
            totals[field] += receipt_totals[field]

    for path in expected_paths:
        payload = _read_regular(path, "dataset public artifact")
        if artifact_hashes.get(_dataset_artifact_key(path)) != sha256_bytes(payload):
            raise ReleaseError("dataset artifact bytes diverge from the proof")
    _require_exact_keys(proof.get("totals"), DATASET_TOTAL_KEYS, "dataset totals")
    if proof.get("totals") != totals or catalog.get("totals") != totals:
        raise ReleaseError("dataset totals do not close across receipts, proof, and catalog")
    if totals["sourceRows"] != (
        totals["publicRows"] + totals["catalogOnlyRows"] + totals["derivedOnlyRows"]
    ):
        raise ReleaseError("global dataset row equation does not close")
    if any(totals[field] != expected for field, expected in EXPECTED_DATASET_ROWS.items()):
        raise ReleaseError("dataset row dispositions diverge from the release contract")

    try:
        dataset_etl.check_committed(
            spec_path=paths.dataset_spec,
            catalog_path=paths.dataset_catalog,
            rows_dir=paths.dataset_rows_dir,
            receipts_dir=paths.dataset_receipts_dir,
            proof_path=paths.dataset_proof,
        )
    except Exception as exc:
        if isinstance(exc, (KeyboardInterrupt, SystemExit)):
            raise
        raise ReleaseError("deep dataset artifact gate failed") from exc

    return {
        "specBytes": len(spec_payload),
        "specSha256": sha256_bytes(spec_payload),
        "proofBytes": len(proof_payload),
        "proofSha256": sha256_bytes(proof_payload),
        "catalogBytes": len(catalog_payload),
        "catalogSha256": sha256_bytes(catalog_payload),
        "receipts": len(receipt_names),
        "rowArtifacts": len(row_names),
        "artifactCount": len(artifact_hashes),
        "receiptSetSha256": sha256_bytes(canonical_json(receipt_set)),
        "artifactSetSha256": sha256_bytes(canonical_json(artifact_hashes)),
        **{key: totals[key] for key in ("sourceRows", "publicRows", "catalogOnlyRows", "derivedOnlyRows", "sourceBytes")},
    }


def _guard_output(paths: ReleasePaths) -> None:
    output = paths.output.resolve(strict=False)
    forbidden = {
        paths.archive_receipt.resolve(strict=False),
        paths.source_catalog.resolve(strict=False),
        paths.source_proof.resolve(strict=False),
        paths.dataset_proof.resolve(strict=False),
        paths.dataset_catalog.resolve(strict=False),
        paths.archive_policy.resolve(strict=False),
        paths.source_policy.resolve(strict=False),
        paths.dataset_spec.resolve(strict=False),
    }
    if output in forbidden:
        raise ReleaseError("release proof cannot replace a gate input")
    for directory in (
        paths.ledger_dir / "elements",
        paths.dataset_receipts_dir,
        paths.dataset_rows_dir,
    ):
        resolved_directory = directory.resolve(strict=False)
        if output == resolved_directory or resolved_directory in output.parents:
            raise ReleaseError("release proof cannot be written inside an artifact set")
    if paths.output.suffix != ".json":
        raise ReleaseError("release proof output must use the .json extension")


def build_expected_release(paths: ReleasePaths = ReleasePaths()) -> dict[str, object]:
    """Recalculate every sub-gate and return the deterministic aggregate proof."""

    _guard_output(paths)
    _validate_ledger_layout(paths)
    archive = _validate_archive_receipt(paths)
    source_catalog = _validate_source_catalog(paths)
    datasets = _validate_datasets(paths)
    contract = {
        "archiveEntries": EXPECTED_CORPUS["entries"],
        "regularFiles": EXPECTED_CORPUS["regular"],
        "hardlinks": EXPECTED_CORPUS["hardlink"],
        "symlinks": EXPECTED_CORPUS["symlink"],
        "datasets": EXPECTED_DATASETS,
        "datasetSourceRows": EXPECTED_DATASET_ROWS["sourceRows"],
        "datasetPublicRows": EXPECTED_DATASET_ROWS["publicRows"],
        "datasetCatalogOnlyRows": EXPECTED_DATASET_ROWS["catalogOnlyRows"],
        "datasetDerivedOnlyRows": EXPECTED_DATASET_ROWS["derivedOnlyRows"],
    }
    release_set = {
        "contract": contract,
        "archiveReceipt": archive,
        "sourceCatalog": source_catalog,
        "datasets": datasets,
    }
    return {
        "schemaVersion": 1,
        "complete": True,
        **release_set,
        "releaseSetSha256": sha256_bytes(canonical_json(release_set)),
    }


def _atomic_write(path: Path, payload: bytes) -> None:
    if path.is_symlink():
        raise ReleaseError("release proof output cannot be a symbolic link")
    if path.exists() and not path.is_file():
        raise ReleaseError("release proof output must be a regular file")
    path.parent.mkdir(parents=True, exist_ok=True)
    descriptor, temporary_name = tempfile.mkstemp(prefix=f".{path.name}.", dir=path.parent)
    temporary = Path(temporary_name)
    try:
        os.fchmod(descriptor, 0o644)
        with os.fdopen(descriptor, "wb") as stream:
            stream.write(payload)
            stream.flush()
            os.fsync(stream.fileno())
        os.replace(temporary, path)
    except Exception:
        temporary.unlink(missing_ok=True)
        raise


def check_release(paths: ReleasePaths = ReleasePaths()) -> dict[str, object]:
    """Recalculate all gates and require byte equality with the committed release proof."""

    expected = build_expected_release(paths)
    committed, payload = _load_canonical_object(paths.output, "integrated source release proof")
    _require_exact_keys(committed, RELEASE_KEYS, "integrated source release proof")
    if committed.get("schemaVersion") != 1 or committed.get("complete") is not True:
        raise ReleaseError("integrated source release proof is not complete")
    expected_payload = canonical_document(expected)
    if payload != expected_payload or committed != expected:
        raise ReleaseError("integrated source release proof is stale or divergent")
    return committed


def build_release(paths: ReleasePaths = ReleasePaths()) -> dict[str, object]:
    """Validate every gate, then atomically replace only the aggregate proof."""

    expected = build_expected_release(paths)
    _atomic_write(paths.output, canonical_document(expected))
    return check_release(paths)


def _summary(proof: dict[str, object]) -> dict[str, object]:
    archive = _require_dict(proof.get("archiveReceipt"), "archive release summary")
    sources = _require_dict(proof.get("sourceCatalog"), "source catalog release summary")
    datasets = _require_dict(proof.get("datasets"), "dataset release summary")
    return {
        "complete": proof.get("complete"),
        "archiveEntries": archive.get("entries"),
        "sourceIdentities": sources.get("identities"),
        "datasets": datasets.get("receipts"),
        "sourceRows": datasets.get("sourceRows"),
        "publicRows": datasets.get("publicRows"),
        "releaseSetSha256": proof.get("releaseSetSha256"),
    }


def build_parser() -> argparse.ArgumentParser:
    parser = argparse.ArgumentParser(description=__doc__)
    action = parser.add_mutually_exclusive_group(required=True)
    action.add_argument("--build", action="store_true")
    action.add_argument("--check", action="store_true")
    parser.add_argument("--ledger-dir", type=Path, default=LEDGER)
    parser.add_argument("--archive-policy", type=Path, default=DEFAULT_ARCHIVE_POLICY)
    parser.add_argument("--source-policy", type=Path, default=DEFAULT_SOURCE_POLICY)
    parser.add_argument("--dataset-spec", type=Path, default=DEFAULT_DATASET_SPEC)
    parser.add_argument("--dataset-catalog", type=Path, default=DEFAULT_DATASET_CATALOG)
    parser.add_argument("--dataset-rows-dir", type=Path, default=DEFAULT_DATASET_ROWS)
    parser.add_argument("--output", type=Path, default=DEFAULT_OUTPUT)
    return parser


def main(argv: list[str] | None = None) -> int:
    args = build_parser().parse_args(argv)
    paths = ReleasePaths(
        ledger_dir=args.ledger_dir,
        archive_policy=args.archive_policy,
        source_policy=args.source_policy,
        dataset_spec=args.dataset_spec,
        dataset_catalog=args.dataset_catalog,
        dataset_rows_dir=args.dataset_rows_dir,
        output=args.output,
    )
    try:
        proof = build_release(paths) if args.build else check_release(paths)
    except ReleaseError as exc:
        raise SystemExit(f"integrated source release failed: {exc}") from exc
    print(json.dumps(_summary(proof), ensure_ascii=False, sort_keys=True, separators=(",", ":")))
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
