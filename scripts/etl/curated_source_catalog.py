#!/usr/bin/env python3
"""Build a privacy-safe public catalog from a private curated source ledger.

The private TSV and HMAC key must stay outside the Git checkout. The build emits
one public JSONL receipt for every unique private identity, plus an aggregate
proof. Exact ID-to-value mappings are written only to an explicitly private
file outside the repository.
"""

from __future__ import annotations

import argparse
import base64
import csv
import hashlib
import hmac
import io
import json
import os
import re
import stat
import tempfile
from collections import Counter
from dataclasses import dataclass
from pathlib import Path

from source_catalog import (
    CatalogError,
    canonical_json,
    classify_identity,
    load_policy,
    sha256_bytes,
    validate_public_url,
)


ROOT = Path(__file__).resolve().parents[2]
DEFAULT_POLICY = ROOT / "scripts/etl/specs/curated-source-catalog-policy.json"
DEFAULT_PUBLIC_OUTPUT = ROOT / "data/source-ledger/sources.jsonl"
DEFAULT_PROOF_OUTPUT = ROOT / "data/source-ledger/source-catalog-proof.json"
MAX_SAFE_INTEGER = 9_007_199_254_740_991
SHA256_RE = re.compile(r"[0-9a-f]{64}\Z")
REASON_RE = re.compile(r"[a-z][a-z0-9_]*\Z")


@dataclass(frozen=True)
class ParsedLedger:
    payload_bytes: int
    payload_sha256: str
    input_rows: int
    total_occurrences: int
    identities: dict[tuple[str, str, str, str], tuple[int, int]]


@dataclass(frozen=True)
class BuiltCatalog:
    public_entries: list[dict[str, object]]
    public_bytes: bytes
    proof: dict[str, object]
    proof_bytes: bytes
    private_map: dict[str, object]
    private_bytes: bytes


def _is_within_repo(path: Path) -> bool:
    try:
        path.resolve(strict=False).relative_to(ROOT.resolve())
    except ValueError:
        return False
    return True


def require_private_path(path: Path, label: str, *, must_exist: bool) -> Path:
    """Reject private material in Git or behind an ambiguous symlink."""

    if _is_within_repo(path):
        raise CatalogError(f"{label} must remain outside the Git checkout")
    if path.is_symlink():
        raise CatalogError(f"{label} cannot be a symbolic link")
    resolved = path.resolve(strict=False)
    if must_exist:
        try:
            metadata = resolved.stat()
        except OSError as error:
            raise CatalogError(f"{label} is not readable") from error
        if not stat.S_ISREG(metadata.st_mode):
            raise CatalogError(f"{label} must be a regular file")
    return resolved


def require_distinct_paths(paths: dict[str, Path]) -> None:
    resolved: dict[Path, str] = {}
    for label, path in paths.items():
        canonical = path.resolve(strict=False)
        if canonical in resolved:
            raise CatalogError(f"{label} aliases {resolved[canonical]}")
        resolved[canonical] = label


def read_private_key(path: Path, policy: dict[str, object]) -> bytes:
    resolved = require_private_path(path, "ID key", must_exist=True)
    mode = stat.S_IMODE(resolved.stat().st_mode)
    if mode & 0o077:
        raise CatalogError("ID key permissions must deny group and other access")
    try:
        key = resolved.read_bytes()
    except OSError as error:
        raise CatalogError("ID key is not readable") from error
    identity_policy = policy.get("identityId")
    if not isinstance(identity_policy, dict):
        raise CatalogError("identityId policy is invalid")
    minimum = int(identity_policy["minimumKeyBytes"])
    if len(key) < minimum or len(key) > 4096:
        raise CatalogError("ID key length is outside the policy boundary")
    return key


def parse_ledger(payload: bytes, policy: dict[str, object]) -> ParsedLedger:
    limits = policy.get("limits")
    headers = policy.get("inputHeaders")
    if not isinstance(limits, dict) or not isinstance(headers, list):
        raise CatalogError("policy input contract is invalid")
    if len(payload) > int(limits["maximumInputBytes"]):
        raise CatalogError("private ledger exceeds the policy byte limit")
    if payload.startswith(b"\xef\xbb\xbf"):
        raise CatalogError("private ledger must not contain a UTF-8 BOM")
    if b"\x00" in payload:
        raise CatalogError("private ledger contains a NUL byte")
    try:
        text = payload.decode("utf-8")
    except UnicodeDecodeError as error:
        raise CatalogError("private ledger is not strict UTF-8") from error

    reader = csv.reader(io.StringIO(text, newline=""), delimiter="\t", strict=True)
    try:
        actual_headers = next(reader)
    except StopIteration as error:
        raise CatalogError("private ledger is empty") from error
    except csv.Error as error:
        raise CatalogError("private ledger header is malformed") from error
    if actual_headers != headers:
        raise CatalogError("private ledger headers diverge from the closed contract")

    identities: dict[tuple[str, str, str, str], tuple[int, int]] = {}
    input_rows = 0
    total_occurrences = 0
    try:
        for row in reader:
            input_rows += 1
            if input_rows > int(limits["maximumRows"]):
                raise CatalogError("private ledger exceeds the policy row limit")
            if len(row) != len(headers):
                raise CatalogError(f"private ledger row {input_rows} has the wrong field count")
            dataset, field, kind, value, raw_occurrences = row
            if not dataset or not field or not kind or not value:
                raise CatalogError(
                    f"private ledger row {input_rows} contains an empty identity field"
                )
            if any(len(item) > int(limits["maximumTextChars"]) for item in row[:-1]):
                raise CatalogError(f"private ledger row {input_rows} exceeds the text limit")
            if re.fullmatch(r"[1-9][0-9]*", raw_occurrences) is None:
                raise CatalogError(f"private ledger row {input_rows} has invalid occurrences")
            occurrences = int(raw_occurrences)
            if occurrences > MAX_SAFE_INTEGER:
                raise CatalogError(f"private ledger row {input_rows} exceeds the integer limit")
            total_occurrences += occurrences
            if total_occurrences > MAX_SAFE_INTEGER:
                raise CatalogError("private ledger total occurrences exceed the integer limit")
            identity = (dataset, field, kind, value)
            previous_occurrences, previous_rows = identities.get(identity, (0, 0))
            combined = previous_occurrences + occurrences
            if combined > MAX_SAFE_INTEGER:
                raise CatalogError("one private identity exceeds the integer limit")
            identities[identity] = (combined, previous_rows + 1)
    except csv.Error as error:
        raise CatalogError("private ledger contains malformed TSV quoting") from error
    if input_rows == 0:
        raise CatalogError("private ledger contains no identity rows")

    return ParsedLedger(
        payload_bytes=len(payload),
        payload_sha256=sha256_bytes(payload),
        input_rows=input_rows,
        total_occurrences=total_occurrences,
        identities=identities,
    )


def opaque_identity_id(
    identity: tuple[str, str, str, str], key: bytes, policy: dict[str, object]
) -> str:
    identity_policy = policy.get("identityId")
    if not isinstance(identity_policy, dict):
        raise CatalogError("identityId policy is invalid")
    payload = canonical_json(
        {
            "dataset": identity[0],
            "field": identity[1],
            "kind": identity[2],
            "value": identity[3],
        }
    )
    digest = hmac.new(key, b"dvns-source-identity-v1\x00" + payload, hashlib.sha256).digest()
    encoded = base64.b32encode(digest).decode("ascii").rstrip("=").lower()
    return f'{identity_policy["prefix"]}{encoded[: int(identity_policy["base32Chars"])]}'


def key_identifier(key: bytes) -> str:
    return hmac.new(key, b"dvns-source-catalog-key-id-v1", hashlib.sha256).hexdigest()[:16]


def _count_map(values: Counter[str], domain: list[object] | None = None) -> dict[str, int]:
    keys = set(values)
    if domain is not None:
        keys.update(str(item) for item in domain)
    return {key: values.get(key, 0) for key in sorted(keys)}


def build_catalog(
    parsed: ParsedLedger,
    key: bytes,
    policy: dict[str, object],
    policy_bytes: bytes,
) -> BuiltCatalog:
    public_entries: list[dict[str, object]] = []
    private_entries: list[dict[str, object]] = []
    id_to_identity: dict[str, tuple[str, str, str, str]] = {}

    for identity in sorted(parsed.identities):
        occurrences, source_rows = parsed.identities[identity]
        identifier = opaque_identity_id(identity, key, policy)
        collision = id_to_identity.get(identifier)
        if collision is not None and collision != identity:
            raise CatalogError("opaque identity collision; increase the configured ID length")
        id_to_identity[identifier] = identity
        result = classify_identity(identity[2], identity[3], policy)
        public_entry: dict[str, object] = {
            "id": identifier,
            "kind": result.public_kind,
            "classification": result.classification,
            "disposition": result.disposition,
            "occurrences": occurrences,
            "publicValue": result.public_value,
            "reasonCodes": list(result.reason_codes),
        }
        private_entry: dict[str, object] = {
            "id": identifier,
            "dataset": identity[0],
            "field": identity[1],
            "kind": identity[2],
            "value": identity[3],
            "occurrences": occurrences,
            "sourceRows": source_rows,
            "public": {
                "kind": result.public_kind,
                "classification": result.classification,
                "disposition": result.disposition,
                "publicValue": result.public_value,
                "reasonCodes": list(result.reason_codes),
            },
        }
        public_entries.append(public_entry)
        private_entries.append(private_entry)

    public_entries.sort(key=lambda item: str(item["id"]))
    private_entries.sort(key=lambda item: str(item["id"]))
    public_bytes = b"".join(canonical_json(item) + b"\n" for item in public_entries)

    classifications = Counter(str(item["classification"]) for item in public_entries)
    dispositions = Counter(str(item["disposition"]) for item in public_entries)
    reasons: Counter[str] = Counter()
    for item in public_entries:
        for reason in item["reasonCodes"]:
            reasons[str(reason)] += 1
    coverage = {
        "inputRows": parsed.input_rows,
        "uniqueIdentities": len(public_entries),
        "accountedIdentities": len(public_entries),
        "duplicateInputRows": parsed.input_rows - len(public_entries),
        "totalOccurrences": parsed.total_occurrences,
        "publishedIdentities": dispositions["published"],
        "quarantinedIdentities": dispositions["quarantined"],
        "byClassification": _count_map(classifications, policy.get("classifications")),
        "byDisposition": _count_map(dispositions, policy.get("dispositions")),
        "byReason": _count_map(reasons),
    }
    proof: dict[str, object] = {
        "schemaVersion": 1,
        "catalogVersion": policy["catalogVersion"],
        "coverage": coverage,
        "integrity": {
            "privateInputBytes": parsed.payload_bytes,
            "privateInputSha256": parsed.payload_sha256,
            "policySha256": sha256_bytes(policy_bytes),
            "idKeyId": key_identifier(key),
            "publicCatalogBytes": len(public_bytes),
            "publicCatalogSha256": sha256_bytes(public_bytes),
            "identitySetSha256": sha256_bytes(
                canonical_json([str(item["id"]) for item in public_entries])
            ),
        },
    }
    proof_bytes = canonical_json(proof) + b"\n"
    private_map: dict[str, object] = {
        "schemaVersion": 1,
        "catalogVersion": policy["catalogVersion"],
        "source": {
            "bytes": parsed.payload_bytes,
            "sha256": parsed.payload_sha256,
            "inputRows": parsed.input_rows,
            "uniqueIdentities": len(public_entries),
            "totalOccurrences": parsed.total_occurrences,
        },
        "integrity": {
            "policySha256": sha256_bytes(policy_bytes),
            "idKeyId": key_identifier(key),
            "publicCatalogSha256": sha256_bytes(public_bytes),
            "publicProofSha256": sha256_bytes(proof_bytes),
        },
        "entries": private_entries,
    }
    private_bytes = canonical_json(private_map) + b"\n"
    built = BuiltCatalog(
        public_entries=public_entries,
        public_bytes=public_bytes,
        proof=proof,
        proof_bytes=proof_bytes,
        private_map=private_map,
        private_bytes=private_bytes,
    )
    validate_built_catalog(built, parsed, key, policy, policy_bytes)
    return built


def _require_dict(value: object, label: str) -> dict[str, object]:
    if not isinstance(value, dict):
        raise CatalogError(f"{label} must be an object")
    return value


def _require_list(value: object, label: str) -> list[object]:
    if not isinstance(value, list):
        raise CatalogError(f"{label} must be an array")
    return value


def _require_non_negative_int(value: object, label: str) -> int:
    if (
        isinstance(value, bool)
        or not isinstance(value, int)
        or value < 0
        or value > MAX_SAFE_INTEGER
    ):
        raise CatalogError(f"{label} must be a non-negative safe integer")
    return value


def validate_public_entries(
    entries: list[dict[str, object]], policy: dict[str, object]
) -> None:
    identity_policy = _require_dict(policy.get("identityId"), "identityId")
    prefix = str(identity_policy["prefix"])
    width = int(identity_policy["base32Chars"])
    identifier_re = re.compile(rf"{re.escape(prefix)}[a-z2-7]{{{width}}}\Z")
    classifications = set(
        str(item)
        for item in _require_list(policy.get("classifications"), "classifications")
    )
    dispositions = set(
        str(item) for item in _require_list(policy.get("dispositions"), "dispositions")
    )
    expected_keys = {
        "id",
        "kind",
        "classification",
        "disposition",
        "occurrences",
        "publicValue",
        "reasonCodes",
    }
    identifiers: list[str] = []
    for index, raw_entry in enumerate(entries):
        entry = _require_dict(raw_entry, f"public[{index}]")
        if set(entry) != expected_keys:
            raise CatalogError("public catalog entry fields diverge from the closed schema")
        identifier = entry.get("id")
        if not isinstance(identifier, str) or identifier_re.fullmatch(identifier) is None:
            raise CatalogError("public catalog contains an invalid opaque identity")
        identifiers.append(identifier)
        if entry.get("kind") not in {"text", "url"}:
            raise CatalogError("public catalog contains an unsupported identity kind")
        if entry.get("classification") not in classifications:
            raise CatalogError("public catalog contains an unsupported classification")
        if entry.get("disposition") not in dispositions:
            raise CatalogError("public catalog contains an unsupported disposition")
        _require_non_negative_int(entry.get("occurrences"), f"public[{index}].occurrences")
        if entry.get("occurrences") == 0:
            raise CatalogError("public catalog occurrences cannot be zero")
        raw_reasons = _require_list(entry.get("reasonCodes"), f"public[{index}].reasonCodes")
        reasons = [str(item) for item in raw_reasons]
        if reasons != sorted(set(reasons)) or any(
            REASON_RE.fullmatch(reason) is None for reason in reasons
        ):
            raise CatalogError("public catalog reason codes are not canonical")

        if entry.get("disposition") == "published":
            value = entry.get("publicValue")
            if entry.get("kind") != "url" or not isinstance(value, str) or not value:
                raise CatalogError("only a safe URL can be published")
            validate_public_url(value, policy)
            classified = classify_identity("url", value, policy)
            if classified.classification != entry.get("classification"):
                raise CatalogError("published URL classification is not reproducible")
        elif entry.get("publicValue") is not None:
            raise CatalogError("quarantined identities cannot expose a public value")
    if identifiers != sorted(set(identifiers)):
        raise CatalogError("public catalog identities must be unique and sorted")


def _recompute_coverage(
    entries: list[dict[str, object]], parsed: ParsedLedger, policy: dict[str, object]
) -> dict[str, object]:
    classifications = Counter(str(item["classification"]) for item in entries)
    dispositions = Counter(str(item["disposition"]) for item in entries)
    reasons: Counter[str] = Counter()
    for item in entries:
        for reason in _require_list(item.get("reasonCodes"), "reasonCodes"):
            reasons[str(reason)] += 1
    return {
        "inputRows": parsed.input_rows,
        "uniqueIdentities": len(entries),
        "accountedIdentities": len(entries),
        "duplicateInputRows": parsed.input_rows - len(entries),
        "totalOccurrences": sum(int(item["occurrences"]) for item in entries),
        "publishedIdentities": dispositions["published"],
        "quarantinedIdentities": dispositions["quarantined"],
        "byClassification": _count_map(classifications, policy.get("classifications")),
        "byDisposition": _count_map(dispositions, policy.get("dispositions")),
        "byReason": _count_map(reasons),
    }


def validate_proof(
    proof: dict[str, object],
    public_entries: list[dict[str, object]],
    public_bytes: bytes,
    parsed: ParsedLedger,
    key: bytes,
    policy: dict[str, object],
    policy_bytes: bytes,
) -> None:
    if set(proof) != {"schemaVersion", "catalogVersion", "coverage", "integrity"}:
        raise CatalogError("public proof fields diverge from the closed schema")
    if (
        type(proof.get("schemaVersion")) is not int
        or proof.get("schemaVersion") != 1
        or proof.get("catalogVersion") != policy["catalogVersion"]
    ):
        raise CatalogError("public proof version diverges from policy")
    coverage = _require_dict(proof.get("coverage"), "coverage")
    for field in (
        "inputRows",
        "uniqueIdentities",
        "accountedIdentities",
        "duplicateInputRows",
        "totalOccurrences",
        "publishedIdentities",
        "quarantinedIdentities",
    ):
        _require_non_negative_int(coverage.get(field), f"coverage.{field}")
    for field in ("byClassification", "byDisposition", "byReason"):
        values = _require_dict(coverage.get(field), f"coverage.{field}")
        for key_name, value in values.items():
            _require_non_negative_int(value, f"coverage.{field}.{key_name}")
    expected_coverage = _recompute_coverage(public_entries, parsed, policy)
    if (
        coverage != expected_coverage
        or coverage.get("totalOccurrences") != parsed.total_occurrences
    ):
        raise CatalogError("public proof coverage does not account for the private ledger")
    integrity = _require_dict(proof.get("integrity"), "integrity")
    for field in ("privateInputBytes", "publicCatalogBytes"):
        _require_non_negative_int(integrity.get(field), f"integrity.{field}")
    expected_integrity = {
        "privateInputBytes": parsed.payload_bytes,
        "privateInputSha256": parsed.payload_sha256,
        "policySha256": sha256_bytes(policy_bytes),
        "idKeyId": key_identifier(key),
        "publicCatalogBytes": len(public_bytes),
        "publicCatalogSha256": sha256_bytes(public_bytes),
        "identitySetSha256": sha256_bytes(
            canonical_json([str(item["id"]) for item in public_entries])
        ),
    }
    if integrity != expected_integrity:
        raise CatalogError("public proof integrity fields diverge from generated bytes")
    for key_name in (
        "privateInputSha256",
        "policySha256",
        "publicCatalogSha256",
        "identitySetSha256",
    ):
        value = integrity.get(key_name)
        if not isinstance(value, str) or SHA256_RE.fullmatch(value) is None:
            raise CatalogError("public proof contains an invalid SHA-256 digest")


def validate_private_map(
    private_map: dict[str, object],
    public_entries: list[dict[str, object]],
    public_bytes: bytes,
    proof_bytes: bytes,
    parsed: ParsedLedger,
    key: bytes,
    policy: dict[str, object],
    policy_bytes: bytes,
) -> None:
    if set(private_map) != {
        "schemaVersion",
        "catalogVersion",
        "source",
        "integrity",
        "entries",
    }:
        raise CatalogError("private map fields diverge from the closed schema")
    if (
        type(private_map.get("schemaVersion")) is not int
        or private_map.get("schemaVersion") != 1
        or private_map.get("catalogVersion") != policy["catalogVersion"]
    ):
        raise CatalogError("private map version diverges from policy")
    expected_source = {
        "bytes": parsed.payload_bytes,
        "sha256": parsed.payload_sha256,
        "inputRows": parsed.input_rows,
        "uniqueIdentities": len(public_entries),
        "totalOccurrences": parsed.total_occurrences,
    }
    source = _require_dict(private_map.get("source"), "private.source")
    for field in ("bytes", "inputRows", "uniqueIdentities", "totalOccurrences"):
        _require_non_negative_int(source.get(field), f"private.source.{field}")
    if source != expected_source:
        raise CatalogError("private map source receipt diverges from the private ledger")
    expected_integrity = {
        "policySha256": sha256_bytes(policy_bytes),
        "idKeyId": key_identifier(key),
        "publicCatalogSha256": sha256_bytes(public_bytes),
        "publicProofSha256": sha256_bytes(proof_bytes),
    }
    if private_map.get("integrity") != expected_integrity:
        raise CatalogError("private map integrity fields diverge from public artifacts")

    entries = _require_list(private_map.get("entries"), "private.entries")
    if len(entries) != len(public_entries):
        raise CatalogError("private map does not account for every public identity")
    public_by_id = {str(item["id"]): item for item in public_entries}
    identifiers: list[str] = []
    source_rows = 0
    occurrences = 0
    seen_identities: set[tuple[str, str, str, str]] = set()
    expected_keys = {
        "id",
        "dataset",
        "field",
        "kind",
        "value",
        "occurrences",
        "sourceRows",
        "public",
    }
    public_keys = {"kind", "classification", "disposition", "publicValue", "reasonCodes"}
    for index, raw_entry in enumerate(entries):
        entry = _require_dict(raw_entry, f"private.entries[{index}]")
        if set(entry) != expected_keys:
            raise CatalogError("private map entry fields diverge from the closed schema")
        raw_identity = tuple(
            entry.get(key_name) for key_name in ("dataset", "field", "kind", "value")
        )
        if not all(isinstance(item, str) and item for item in raw_identity):
            raise CatalogError("private map contains an invalid exact identity")
        identity = (
            str(raw_identity[0]),
            str(raw_identity[1]),
            str(raw_identity[2]),
            str(raw_identity[3]),
        )
        if identity in seen_identities:
            raise CatalogError("private map contains a duplicate exact identity")
        seen_identities.add(identity)
        identifier = entry.get("id")
        if identifier != opaque_identity_id(identity, key, policy):
            raise CatalogError("private exact mapping does not match its opaque identity")
        identifiers.append(str(identifier))
        entry_occurrences = _require_non_negative_int(entry.get("occurrences"), "occurrences")
        entry_source_rows = _require_non_negative_int(entry.get("sourceRows"), "sourceRows")
        if entry_occurrences == 0 or entry_source_rows == 0:
            raise CatalogError("private exact mapping counts cannot be zero")
        occurrences += entry_occurrences
        source_rows += entry_source_rows

        public_projection = _require_dict(entry.get("public"), "private.public")
        if set(public_projection) != public_keys:
            raise CatalogError("private public projection fields diverge from the schema")
        result = classify_identity(identity[2], identity[3], policy)
        expected_projection = {
            "kind": result.public_kind,
            "classification": result.classification,
            "disposition": result.disposition,
            "publicValue": result.public_value,
            "reasonCodes": list(result.reason_codes),
        }
        if public_projection != expected_projection:
            raise CatalogError("private public projection is not reproducible")
        expected_public = {
            "id": identifier,
            "occurrences": entry_occurrences,
            **expected_projection,
        }
        if public_by_id.get(str(identifier)) != expected_public:
            raise CatalogError("private and public identity receipts diverge")
    if identifiers != sorted(set(identifiers)):
        raise CatalogError("private map identities must be unique and sorted")
    if source_rows != parsed.input_rows or occurrences != parsed.total_occurrences:
        raise CatalogError("private exact mapping counts do not reconcile")


def validate_built_catalog(
    built: BuiltCatalog,
    parsed: ParsedLedger,
    key: bytes,
    policy: dict[str, object],
    policy_bytes: bytes,
) -> None:
    validate_public_entries(built.public_entries, policy)
    expected_public_bytes = b"".join(
        canonical_json(item) + b"\n" for item in built.public_entries
    )
    if built.public_bytes != expected_public_bytes:
        raise CatalogError("public JSONL is not canonical")
    validate_proof(
        built.proof,
        built.public_entries,
        built.public_bytes,
        parsed,
        key,
        policy,
        policy_bytes,
    )
    if built.proof_bytes != canonical_json(built.proof) + b"\n":
        raise CatalogError("public proof is not canonical JSON")
    validate_private_map(
        built.private_map,
        built.public_entries,
        built.public_bytes,
        built.proof_bytes,
        parsed,
        key,
        policy,
        policy_bytes,
    )
    if built.private_bytes != canonical_json(built.private_map) + b"\n":
        raise CatalogError("private exact map is not canonical JSON")


def _reject_duplicate_json_keys(pairs: list[tuple[str, object]]) -> dict[str, object]:
    output: dict[str, object] = {}
    for key, value in pairs:
        if key in output:
            raise CatalogError("generated JSON contains a duplicate key")
        output[key] = value
    return output


def _load_json(payload: bytes, label: str) -> dict[str, object]:
    try:
        text = payload.decode("utf-8")
    except UnicodeDecodeError as error:
        raise CatalogError(f"{label} is not UTF-8") from error
    try:
        value = json.loads(text, object_pairs_hook=_reject_duplicate_json_keys)
    except json.JSONDecodeError as error:
        raise CatalogError(f"{label} is not valid JSON") from error
    return _require_dict(value, label)


def _load_jsonl(payload: bytes) -> list[dict[str, object]]:
    if not payload or not payload.endswith(b"\n"):
        raise CatalogError("public JSONL must be non-empty and newline-terminated")
    output: list[dict[str, object]] = []
    for index, line in enumerate(payload.splitlines(), start=1):
        if not line:
            raise CatalogError("public JSONL contains a blank record")
        output.append(_load_json(line, f"public JSONL line {index}"))
    return output


def _read_bytes(path: Path, label: str) -> bytes:
    try:
        return path.read_bytes()
    except OSError as error:
        raise CatalogError(f"{label} is not readable") from error


def _read_private_ledger(path: Path, policy: dict[str, object]) -> bytes:
    """Reject an oversized ledger before opening it and bound the subsequent read."""

    limits = policy.get("limits")
    if not isinstance(limits, dict):
        raise CatalogError("policy input contract is invalid")
    maximum_bytes = int(limits["maximumInputBytes"])
    try:
        metadata = path.lstat()
    except OSError as error:
        raise CatalogError("private ledger is not readable") from error
    if stat.S_ISLNK(metadata.st_mode) or not stat.S_ISREG(metadata.st_mode):
        raise CatalogError("private ledger must be a regular file")
    if metadata.st_size > maximum_bytes:
        raise CatalogError("private ledger exceeds the policy byte limit")

    descriptor = -1
    flags = os.O_RDONLY | getattr(os, "O_NOFOLLOW", 0)
    try:
        descriptor = os.open(path, flags)
        opened = os.fstat(descriptor)
        if (
            not stat.S_ISREG(opened.st_mode)
            or opened.st_size > maximum_bytes
            or (opened.st_dev, opened.st_ino) != (metadata.st_dev, metadata.st_ino)
        ):
            raise CatalogError("private ledger changed before it could be read safely")
        with os.fdopen(descriptor, "rb") as handle:
            descriptor = -1
            payload = handle.read(maximum_bytes + 1)
    except CatalogError:
        raise
    except OSError as error:
        raise CatalogError("private ledger is not readable") from error
    finally:
        if descriptor >= 0:
            os.close(descriptor)
    if len(payload) > maximum_bytes:
        raise CatalogError("private ledger exceeds the policy byte limit")
    return payload


def _stage_bytes(payload: bytes, target: Path, mode: int) -> Path:
    if target.is_symlink():
        raise CatalogError("output paths cannot be symbolic links")
    target.parent.mkdir(parents=True, exist_ok=True)
    descriptor, temporary_name = tempfile.mkstemp(prefix=f".{target.name}.", dir=target.parent)
    temporary = Path(temporary_name)
    try:
        os.fchmod(descriptor, mode)
        with os.fdopen(descriptor, "wb") as handle:
            handle.write(payload)
            handle.flush()
            os.fsync(handle.fileno())
    except Exception:
        try:
            os.close(descriptor)
        except OSError:
            pass
        temporary.unlink(missing_ok=True)
        raise
    return temporary


def write_catalog(
    built: BuiltCatalog,
    private_path: Path,
    public_path: Path,
    proof_path: Path,
) -> None:
    private_target = require_private_path(private_path, "private exact map", must_exist=False)
    require_distinct_paths(
        {
            "private exact map": private_target,
            "public catalog": public_path,
            "public proof": proof_path,
        }
    )
    staged: list[Path] = []
    try:
        private_temporary = _stage_bytes(built.private_bytes, private_target, 0o600)
        staged.append(private_temporary)
        public_temporary = _stage_bytes(built.public_bytes, public_path, 0o644)
        staged.append(public_temporary)
        proof_temporary = _stage_bytes(built.proof_bytes, proof_path, 0o644)
        staged.append(proof_temporary)
        private_temporary.replace(private_target)
        staged.remove(private_temporary)
        public_temporary.replace(public_path)
        staged.remove(public_temporary)
        proof_temporary.replace(proof_path)
        staged.remove(proof_temporary)
    finally:
        for temporary in staged:
            temporary.unlink(missing_ok=True)


def check_catalog(
    expected: BuiltCatalog,
    parsed: ParsedLedger,
    key: bytes,
    policy: dict[str, object],
    policy_bytes: bytes,
    private_path: Path,
    public_path: Path,
    proof_path: Path,
) -> None:
    private_target = require_private_path(private_path, "private exact map", must_exist=True)
    if stat.S_IMODE(private_target.stat().st_mode) & 0o077:
        raise CatalogError("private exact map permissions must deny group and other access")
    require_distinct_paths(
        {
            "private exact map": private_target,
            "public catalog": public_path,
            "public proof": proof_path,
        }
    )
    public_bytes = _read_bytes(public_path, "public catalog")
    proof_bytes = _read_bytes(proof_path, "public proof")
    private_bytes = _read_bytes(private_target, "private exact map")
    public_entries = _load_jsonl(public_bytes)
    proof = _load_json(proof_bytes, "public proof")
    private_map = _load_json(private_bytes, "private exact map")
    committed = BuiltCatalog(
        public_entries=public_entries,
        public_bytes=public_bytes,
        proof=proof,
        proof_bytes=proof_bytes,
        private_map=private_map,
        private_bytes=private_bytes,
    )
    validate_built_catalog(committed, parsed, key, policy, policy_bytes)
    if public_bytes != expected.public_bytes:
        raise CatalogError("public catalog diverges from a deterministic rebuild")
    if proof_bytes != expected.proof_bytes:
        raise CatalogError("public proof diverges from a deterministic rebuild")
    if private_bytes != expected.private_bytes:
        raise CatalogError("private exact map diverges from a deterministic rebuild")


def safe_summary(built: BuiltCatalog) -> dict[str, object]:
    coverage = _require_dict(built.proof.get("coverage"), "coverage")
    integrity = _require_dict(built.proof.get("integrity"), "integrity")
    return {
        "identities": coverage["uniqueIdentities"],
        "published": coverage["publishedIdentities"],
        "quarantined": coverage["quarantinedIdentities"],
        "publicCatalogSha256": integrity["publicCatalogSha256"],
    }


def main() -> int:
    parser = argparse.ArgumentParser(description=__doc__)
    action = parser.add_mutually_exclusive_group(required=True)
    action.add_argument("--build", action="store_true")
    action.add_argument("--check", action="store_true")
    parser.add_argument("--input", type=Path, required=True)
    parser.add_argument("--id-key-file", type=Path, required=True)
    parser.add_argument("--private-map", type=Path, required=True)
    parser.add_argument("--policy", type=Path, default=DEFAULT_POLICY)
    parser.add_argument("--public-output", type=Path, default=DEFAULT_PUBLIC_OUTPUT)
    parser.add_argument("--proof-output", type=Path, default=DEFAULT_PROOF_OUTPUT)
    args = parser.parse_args()

    try:
        private_input = require_private_path(args.input, "private ledger", must_exist=True)
        require_distinct_paths(
            {
                "private ledger": private_input,
                "ID key": args.id_key_file,
                "private exact map": args.private_map,
                "public catalog": args.public_output,
                "public proof": args.proof_output,
            }
        )
        policy, policy_bytes = load_policy(args.policy)
        key = read_private_key(args.id_key_file, policy)
        payload = _read_private_ledger(private_input, policy)
        parsed = parse_ledger(payload, policy)
        built = build_catalog(parsed, key, policy, policy_bytes)
        if args.build:
            write_catalog(built, args.private_map, args.public_output, args.proof_output)
        else:
            check_catalog(
                built,
                parsed,
                key,
                policy,
                policy_bytes,
                args.private_map,
                args.public_output,
                args.proof_output,
            )
        print(canonical_json(safe_summary(built)).decode("utf-8"))
    except CatalogError as error:
        parser.exit(2, f"error: {error}\n")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
