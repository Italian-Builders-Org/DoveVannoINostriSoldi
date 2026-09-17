"""Build and verify a path-redacted, proof-carrying archive receipt."""

from __future__ import annotations

import hashlib
import json
import os
import shutil
import tarfile
import tempfile
import uuid
from collections import Counter
from pathlib import Path
from typing import BinaryIO, Iterable

from .classification import ClassificationError, Policy, classify_path, load_policy
from .publication_policy import (
    PolicyValidationError,
    SHA256_RE,
    payload_digest_is_private,
    validate_element_record,
)


ROOT = Path(__file__).resolve().parents[3]
DEFAULT_POLICY = ROOT / "scripts/etl/specs/source-corpus-policy.json"
DEFAULT_OUTPUT = ROOT / "data/source-ledger"
READ_CHUNK_BYTES = 1024 * 1024

RECEIPT_KEYS = frozenset(
    {"schemaVersion", "status", "archive", "policy", "id", "expected", "observed", "sharding"}
)
OBSERVED_KEYS = frozenset(
    {
        "entries",
        "regular",
        "hardlink",
        "symlink",
        "storedBytes",
        "logicalBytes",
        "families",
        "contentClasses",
        "dispositions",
    }
)
SHARD_KEYS = frozenset({"file", "records", "firstOrdinal", "lastOrdinal", "bytes", "sha256"})


class ReceiptError(ValueError):
    """The private source or public receipt fails a completeness invariant."""


def _reject_json_constant(value: str) -> object:
    raise ValueError(f"non-finite JSON constant is forbidden: {value}")


def canonical_json(value: object) -> bytes:
    return json.dumps(
        value,
        ensure_ascii=False,
        sort_keys=True,
        separators=(",", ":"),
        allow_nan=False,
    ).encode("utf-8")


def sha256_bytes(payload: bytes) -> str:
    return hashlib.sha256(payload).hexdigest()


def _tar_text_bytes(value: str, label: str) -> bytes:
    if not value or "\x00" in value:
        raise ReceiptError(f"{label} must be non-empty and contain no NUL byte")
    try:
        return value.encode("utf-8", errors="surrogateescape")
    except UnicodeEncodeError as exc:
        raise ReceiptError(f"{label} cannot be represented deterministically") from exc


def _hash_stream(stream: BinaryIO, expected_bytes: int) -> str:
    digest = hashlib.sha256()
    observed = 0
    while True:
        chunk = stream.read(READ_CHUNK_BYTES)
        if not chunk:
            break
        digest.update(chunk)
        observed += len(chunk)
    if observed != expected_bytes:
        raise ReceiptError("regular payload length diverges from its container header")
    return digest.hexdigest()


def _archive_fingerprint(stream: BinaryIO) -> tuple[int, str]:
    digest = hashlib.sha256()
    total = 0
    while True:
        chunk = stream.read(READ_CHUNK_BYTES)
        if not chunk:
            break
        digest.update(chunk)
        total += len(chunk)
    return total, digest.hexdigest()


def _source_identity(stat_result: os.stat_result) -> tuple[int, int, int, int]:
    return (stat_result.st_dev, stat_result.st_ino, stat_result.st_size, stat_result.st_mtime_ns)


def _opaque_id(ordinal: int, policy: Policy) -> str:
    return f"{policy.id_prefix}{ordinal:0{policy.id_width}d}"


def _element_kind(member: tarfile.TarInfo) -> str:
    if member.isreg():
        return "regular"
    if member.islnk():
        return "hardlink"
    if member.issym():
        return "symlink"
    raise ReceiptError("container includes an unsupported element kind")


def _scan_archive(
    archive_path: Path,
    policy: Policy,
) -> tuple[list[dict[str, object]], dict[str, object], dict[str, object]]:
    records: list[dict[str, object]] = []
    private_elements: list[dict[str, object]] = []
    latest_internal_by_path: dict[str, dict[str, object]] = {}
    counts: Counter[str] = Counter()

    try:
        source = archive_path.open("rb")
    except OSError as exc:
        raise ReceiptError("private source cannot be opened") from exc

    with source:
        identity_before = _source_identity(os.fstat(source.fileno()))
        archive_bytes, archive_sha256 = _archive_fingerprint(source)
        if archive_bytes != identity_before[2]:
            raise ReceiptError("private source byte count changed during fingerprinting")
        if {"bytes": archive_bytes, "sha256": archive_sha256} != policy.expected_archive:
            raise ReceiptError("private source fingerprint diverges from the pinned corpus")
        source.seek(0)

        try:
            container = tarfile.open(
                fileobj=source,
                mode="r|*",
                encoding="utf-8",
                errors="surrogateescape",
            )
            with container:
                for ordinal, member in enumerate(container, start=1):
                    kind = _element_kind(member)
                    _tar_text_bytes(member.name, "element path")
                    if member.size < 0:
                        raise ReceiptError("container includes a negative element size")

                    element_id = _opaque_id(ordinal, policy)
                    record: dict[str, object] = {
                        "id": element_id,
                        "ordinal": ordinal,
                        "kind": kind,
                        "storedBytes": member.size if kind == "regular" else 0,
                        "logicalBytes": 0,
                        **classify_path(member.name, policy),
                    }
                    private_record: dict[str, object] = {
                        "id": element_id,
                        "ordinal": ordinal,
                        "kind": kind,
                        "path": member.name,
                    }
                    internal_record: dict[str, object] = {
                        "id": element_id,
                        "kind": kind,
                        "logicalBytes": 0,
                    }

                    if kind == "regular":
                        payload = container.extractfile(member)
                        if payload is None:
                            raise ReceiptError("regular element payload cannot be read")
                        with payload:
                            payload_sha256 = _hash_stream(payload, member.size)
                        internal_record["payloadSha256"] = payload_sha256
                        digest_is_private = payload_digest_is_private(record)
                        internal_record["payloadDigestPrivate"] = digest_is_private
                        if digest_is_private:
                            private_record["payloadSha256"] = payload_sha256
                        else:
                            record["payloadSha256"] = payload_sha256
                        record["logicalBytes"] = member.size
                        internal_record["logicalBytes"] = member.size
                    elif kind == "hardlink":
                        if member.size != 0:
                            raise ReceiptError("hard-link header declares stored payload bytes")
                        _tar_text_bytes(member.linkname, "hard-link target")
                        target = latest_internal_by_path.get(member.linkname)
                        if target is None:
                            raise ReceiptError("hard link has no prior target")
                        if target["kind"] not in {"regular", "hardlink"}:
                            raise ReceiptError("hard link targets an unsupported link kind")
                        record["logicalBytes"] = target["logicalBytes"]
                        record["hardlinkTargetId"] = target["id"]
                        payload_sha256 = str(target["payloadSha256"])
                        target_digest_is_private = bool(target["payloadDigestPrivate"])
                        if target_digest_is_private and not payload_digest_is_private(record):
                            record["privacy"] = "restricted"
                            record["disposition"] = "private-quarantine"
                        digest_is_private = (
                            target_digest_is_private or payload_digest_is_private(record)
                        )
                        internal_record["logicalBytes"] = target["logicalBytes"]
                        internal_record["payloadSha256"] = payload_sha256
                        internal_record["payloadDigestPrivate"] = digest_is_private
                        if digest_is_private:
                            private_record["payloadSha256"] = payload_sha256
                        else:
                            record["payloadSha256"] = payload_sha256
                        private_record["hardlinkTargetId"] = target["id"]
                    else:
                        if member.size != 0:
                            raise ReceiptError("symbolic-link header declares stored payload bytes")
                        link_bytes = _tar_text_bytes(member.linkname, "symbolic-link text")
                        record["logicalBytes"] = len(link_bytes)
                        internal_record["logicalBytes"] = len(link_bytes)
                        private_record["linkText"] = member.linkname

                    records.append(record)
                    private_elements.append(private_record)
                    latest_internal_by_path[member.name] = internal_record
                    counts[kind] += 1
        except (tarfile.TarError, OSError, EOFError) as exc:
            raise ReceiptError("private source is not a readable tar container") from exc

        identity_after = _source_identity(os.fstat(source.fileno()))
        if identity_after != identity_before:
            raise ReceiptError("private source changed while its receipt was built")

    observed_counts = {
        "entries": len(records),
        "regular": counts["regular"],
        "hardlink": counts["hardlink"],
        "symlink": counts["symlink"],
    }
    if observed_counts != policy.expected_counts:
        raise ReceiptError("private source element counts diverge from the pinned corpus")

    envelope = {"bytes": archive_bytes, "sha256": archive_sha256}
    private_map = {
        "schemaVersion": 1,
        "archive": envelope,
        "policySha256": policy.sha256,
        "elements": private_elements,
    }
    return records, envelope, private_map


def _sorted_counter(records: Iterable[dict[str, object]], field: str) -> dict[str, int]:
    counter = Counter(str(record[field]) for record in records)
    return {key: counter[key] for key in sorted(counter)}


def _observed_summary(records: list[dict[str, object]]) -> dict[str, object]:
    kinds = Counter(str(record["kind"]) for record in records)
    return {
        "entries": len(records),
        "regular": kinds["regular"],
        "hardlink": kinds["hardlink"],
        "symlink": kinds["symlink"],
        "storedBytes": sum(int(record["storedBytes"]) for record in records),
        "logicalBytes": sum(int(record["logicalBytes"]) for record in records),
        "families": _sorted_counter(records, "family"),
        "contentClasses": _sorted_counter(records, "contentClass"),
        "dispositions": _sorted_counter(records, "disposition"),
    }


def _write_artifacts(
    output_dir: Path,
    records: list[dict[str, object]],
    archive: dict[str, object],
    policy: Policy,
) -> dict[str, object]:
    elements_dir = output_dir / "elements"
    elements_dir.mkdir(parents=True, exist_ok=False)
    shard_receipts: list[dict[str, object]] = []
    element_digest = hashlib.sha256()

    for shard_index, start in enumerate(range(0, len(records), policy.shard_size), start=1):
        shard_records = records[start : start + policy.shard_size]
        payload = b"".join(canonical_json(record) + b"\n" for record in shard_records)
        filename = f"part-{shard_index:05d}.jsonl"
        (elements_dir / filename).write_bytes(payload)
        element_digest.update(payload)
        shard_receipts.append(
            {
                "file": filename,
                "records": len(shard_records),
                "firstOrdinal": int(shard_records[0]["ordinal"]),
                "lastOrdinal": int(shard_records[-1]["ordinal"]),
                "bytes": len(payload),
                "sha256": sha256_bytes(payload),
            }
        )

    receipt: dict[str, object] = {
        "schemaVersion": 1,
        "status": "complete",
        "archive": archive,
        "policy": {"schemaVersion": 1, "sha256": policy.sha256},
        "id": {"prefix": policy.id_prefix, "width": policy.id_width},
        "expected": policy.expected_counts,
        "observed": _observed_summary(records),
        "sharding": {
            "size": policy.shard_size,
            "elementSetSha256": element_digest.hexdigest(),
            "shards": shard_receipts,
        },
    }
    (output_dir / "receipt.json").write_bytes(canonical_json(receipt) + b"\n")
    return receipt


def _load_canonical_json(path: Path, label: str) -> dict[str, object]:
    try:
        payload = path.read_bytes()
        value = json.loads(payload, parse_constant=_reject_json_constant)
    except OSError as exc:
        raise ReceiptError(f"{label} is missing or unreadable") from exc
    except (UnicodeDecodeError, ValueError) as exc:
        raise ReceiptError(f"{label} is not valid UTF-8 JSON") from exc
    if not isinstance(value, dict):
        raise ReceiptError(f"{label} must be an object")
    if payload != canonical_json(value) + b"\n":
        raise ReceiptError(f"{label} is not canonical JSON")
    return value


def _require_exact_keys(value: object, expected: frozenset[str], label: str) -> dict[str, object]:
    if not isinstance(value, dict) or set(value) != expected:
        raise ReceiptError(f"{label} diverges from the closed schema")
    return value


def _require_non_negative_int(value: object, label: str) -> int:
    if isinstance(value, bool) or not isinstance(value, int) or value < 0:
        raise ReceiptError(f"{label} must be a non-negative integer")
    return value


def _require_sha256(value: object, label: str) -> str:
    if not isinstance(value, str) or SHA256_RE.fullmatch(value) is None:
        raise ReceiptError(f"{label} must be a lowercase SHA-256 digest")
    return value


def _validate_receipt_header(receipt: dict[str, object], policy: Policy) -> list[dict[str, object]]:
    if set(receipt) != RECEIPT_KEYS or receipt.get("schemaVersion") != 1:
        raise ReceiptError("aggregate receipt diverges from schema version 1")
    if receipt.get("status") != "complete":
        raise ReceiptError("aggregate receipt is not complete")

    archive = _require_exact_keys(receipt.get("archive"), frozenset({"bytes", "sha256"}), "archive")
    if _require_non_negative_int(archive["bytes"], "archive.bytes") == 0:
        raise ReceiptError("archive byte count cannot be zero")
    _require_sha256(archive["sha256"], "archive.sha256")
    if archive != policy.expected_archive:
        raise ReceiptError("aggregate receipt archive fingerprint diverges from policy")

    policy_receipt = _require_exact_keys(
        receipt.get("policy"), frozenset({"schemaVersion", "sha256"}), "policy receipt"
    )
    if policy_receipt.get("schemaVersion") != 1 or policy_receipt.get("sha256") != policy.sha256:
        raise ReceiptError("aggregate receipt was not built with the pinned policy bytes")

    id_contract = _require_exact_keys(receipt.get("id"), frozenset({"prefix", "width"}), "id contract")
    if id_contract != {"prefix": policy.id_prefix, "width": policy.id_width}:
        raise ReceiptError("aggregate receipt opaque identifier contract diverges")
    if receipt.get("expected") != policy.expected_counts:
        raise ReceiptError("aggregate receipt expected counts diverge from policy")

    observed = _require_exact_keys(receipt.get("observed"), OBSERVED_KEYS, "observed summary")
    for field in ("entries", "regular", "hardlink", "symlink", "storedBytes", "logicalBytes"):
        _require_non_negative_int(observed[field], f"observed.{field}")
    for field in ("families", "contentClasses", "dispositions"):
        values = observed[field]
        if not isinstance(values, dict) or list(values) != sorted(values):
            raise ReceiptError(f"observed.{field} must be an ordered count object")
        for key, value in values.items():
            if not isinstance(key, str) or not key or _require_non_negative_int(value, field) == 0:
                raise ReceiptError(f"observed.{field} has an invalid count")

    sharding = _require_exact_keys(
        receipt.get("sharding"),
        frozenset({"size", "elementSetSha256", "shards"}),
        "sharding contract",
    )
    if sharding.get("size") != policy.shard_size:
        raise ReceiptError("aggregate receipt shard size diverges from policy")
    _require_sha256(sharding.get("elementSetSha256"), "sharding.elementSetSha256")
    shards = sharding.get("shards")
    if not isinstance(shards, list):
        raise ReceiptError("aggregate receipt shards must be an array")
    validated: list[dict[str, object]] = []
    for index, shard in enumerate(shards, start=1):
        value = _require_exact_keys(shard, SHARD_KEYS, f"shard {index}")
        if value.get("file") != f"part-{index:05d}.jsonl":
            raise ReceiptError("shard filenames must be contiguous and deterministic")
        for field in ("records", "firstOrdinal", "lastOrdinal", "bytes"):
            _require_non_negative_int(value[field], f"shard.{field}")
        _require_sha256(value["sha256"], "shard.sha256")
        validated.append(value)
    return validated


def check_receipt(
    *,
    output_dir: Path = DEFAULT_OUTPUT,
    policy_path: Path = DEFAULT_POLICY,
) -> dict[str, object]:
    """Validate committed receipt bytes without access to the private source."""

    if output_dir.is_symlink():
        raise ReceiptError("public receipt directory cannot be a symbolic link")
    if any(output_dir.glob(".elements-backup-*")) or any(output_dir.glob(".receipt-backup-*")):
        raise ReceiptError("public receipt contains an incomplete install backup")
    policy = load_policy(policy_path)
    receipt = _load_canonical_json(output_dir / "receipt.json", "aggregate receipt")
    shard_receipts = _validate_receipt_header(receipt, policy)
    elements_dir = output_dir / "elements"
    if elements_dir.is_symlink() or not elements_dir.is_dir():
        raise ReceiptError("element shard directory is missing or is a symbolic link")

    expected_names = {str(shard["file"]) for shard in shard_receipts}
    observed_entries = list(elements_dir.iterdir())
    if any(not entry.is_file() or entry.is_symlink() for entry in observed_entries):
        raise ReceiptError("element shard directory contains a non-regular entry")
    observed_names = {entry.name for entry in observed_entries}
    if observed_names != expected_names:
        raise ReceiptError("element shard set has a missing or extra file")

    expected_shards = (
        policy.expected_counts["entries"] + policy.shard_size - 1
    ) // policy.shard_size
    if len(shard_receipts) != expected_shards:
        raise ReceiptError("element shard count does not close against expected entries")

    records: list[dict[str, object]] = []
    seen_by_id: dict[str, dict[str, object]] = {}
    element_digest = hashlib.sha256()
    next_ordinal = 1

    for shard_index, shard_receipt in enumerate(shard_receipts, start=1):
        shard_path = elements_dir / str(shard_receipt["file"])
        payload = shard_path.read_bytes()
        if len(payload) != shard_receipt["bytes"] or sha256_bytes(payload) != shard_receipt["sha256"]:
            raise ReceiptError("element shard bytes diverge from its receipt")
        element_digest.update(payload)

        lines = payload.splitlines(keepends=True)
        if len(lines) != shard_receipt["records"] or not lines:
            raise ReceiptError("element shard record count diverges")
        if shard_index < len(shard_receipts) and len(lines) != policy.shard_size:
            raise ReceiptError("non-final element shard is not full")
        if len(lines) > policy.shard_size:
            raise ReceiptError("element shard exceeds the policy size")

        first_ordinal = next_ordinal
        for line in lines:
            if not line.endswith(b"\n"):
                raise ReceiptError("element shard line is not newline terminated")
            try:
                value = json.loads(line, parse_constant=_reject_json_constant)
            except (UnicodeDecodeError, ValueError) as exc:
                raise ReceiptError("element shard contains invalid UTF-8 JSON") from exc
            if line != canonical_json(value) + b"\n":
                raise ReceiptError("element shard contains a non-canonical JSON line")
            try:
                record = validate_element_record(
                    value,
                    expected_ordinal=next_ordinal,
                    id_prefix=policy.id_prefix,
                    id_width=policy.id_width,
                    allowed_families=policy.allowed_families,
                )
            except PolicyValidationError as exc:
                raise ReceiptError(str(exc)) from exc

            hardlink_target: dict[str, object] | None = None
            if record["kind"] == "hardlink":
                target_id = str(record["hardlinkTargetId"])
                hardlink_target = seen_by_id.get(target_id)
                if hardlink_target is None:
                    raise ReceiptError("hard-link relation is broken, forward, or cyclic")
                if hardlink_target["kind"] not in {"regular", "hardlink"}:
                    raise ReceiptError("hard-link relation targets an unsupported element")
                public_hashes_diverge = (
                    "payloadSha256" in record
                    and "payloadSha256" in hardlink_target
                    and record["payloadSha256"] != hardlink_target["payloadSha256"]
                )
                if (
                    record["logicalBytes"] != hardlink_target["logicalBytes"]
                    or public_hashes_diverge
                ):
                    raise ReceiptError("hard-link payload identity diverges from its target")

            defaults = policy.class_defaults[str(record["contentClass"])]
            publication_state = {
                field: str(record[field])
                for field in ("authority", "license", "privacy", "disposition")
            }
            allowed_states = [defaults]
            if hardlink_target is not None and payload_digest_is_private(hardlink_target):
                allowed_states.append(
                    {
                        **defaults,
                        "privacy": "restricted",
                        "disposition": "private-quarantine",
                    }
                )
            if publication_state not in allowed_states:
                raise ReceiptError("element publication state diverges from its policy class")

            record_id = str(record["id"])
            if record_id in seen_by_id:
                raise ReceiptError("opaque element identifier is duplicated")
            seen_by_id[record_id] = record
            records.append(record)
            next_ordinal += 1

        if shard_receipt["firstOrdinal"] != first_ordinal:
            raise ReceiptError("element shard first ordinal diverges")
        if shard_receipt["lastOrdinal"] != next_ordinal - 1:
            raise ReceiptError("element shard last ordinal diverges")

    sharding = receipt["sharding"]
    if not isinstance(sharding, dict):
        raise ReceiptError("sharding contract is invalid")
    if element_digest.hexdigest() != sharding["elementSetSha256"]:
        raise ReceiptError("ordered element-set digest diverges")

    summary = _observed_summary(records)
    if summary != receipt["observed"]:
        raise ReceiptError("observed summary does not match element receipts")
    counts = {field: summary[field] for field in ("entries", "regular", "hardlink", "symlink")}
    if counts != policy.expected_counts:
        raise ReceiptError("element receipts do not close against the pinned corpus")
    return receipt


def _guard_private_map_path(
    path: Path,
    output_dir: Path,
    *,
    forbidden_files: Iterable[Path] = (),
) -> Path:
    expanded = path.expanduser()
    if expanded.is_symlink():
        raise ReceiptError("private path map cannot be a symbolic link")
    resolved = expanded.resolve(strict=False)
    repo_root = ROOT.resolve()
    public_root = output_dir.expanduser().resolve(strict=False)
    if resolved == repo_root or repo_root in resolved.parents:
        raise ReceiptError("private path map must remain outside the repository")
    if resolved == public_root or public_root in resolved.parents:
        raise ReceiptError("private path map must remain outside public receipt artifacts")
    if any(resolved == item.expanduser().resolve(strict=False) for item in forbidden_files):
        raise ReceiptError("private path map cannot replace an intake input")
    return resolved


def _atomic_write(path: Path, payload: bytes, *, private: bool = False) -> None:
    path.parent.mkdir(parents=True, exist_ok=True)
    descriptor, temporary_name = tempfile.mkstemp(prefix=f".{path.name}.", dir=path.parent)
    temporary = Path(temporary_name)
    try:
        if private:
            os.fchmod(descriptor, 0o600)
        with os.fdopen(descriptor, "wb") as stream:
            stream.write(payload)
            stream.flush()
            os.fsync(stream.fileno())
        os.replace(temporary, path)
    except Exception:
        temporary.unlink(missing_ok=True)
        raise


def _remove_install_entry(path: Path) -> None:
    if path.is_dir() and not path.is_symlink():
        shutil.rmtree(path)
    else:
        path.unlink(missing_ok=True)


def _install_artifacts(staging: Path, output_dir: Path) -> None:
    if output_dir.is_symlink():
        raise ReceiptError("public receipt directory cannot be a symbolic link")
    output_dir.mkdir(parents=True, exist_ok=True)
    target_elements = output_dir / "elements"
    target_receipt = output_dir / "receipt.json"
    if target_elements.is_symlink() or target_receipt.is_symlink():
        raise ReceiptError("public receipt targets cannot be symbolic links")
    if target_elements.exists() and not target_elements.is_dir():
        raise ReceiptError("public element target is not a directory")
    if target_receipt.exists() and not target_receipt.is_file():
        raise ReceiptError("public aggregate receipt target is not a file")

    token = uuid.uuid4().hex
    backup_elements = output_dir / f".elements-backup-{token}"
    backup_receipt = output_dir / f".receipt-backup-{token}"
    elements_backed_up = False
    receipt_backed_up = False
    try:
        if target_elements.exists():
            os.replace(target_elements, backup_elements)
            elements_backed_up = True
        if target_receipt.exists():
            os.replace(target_receipt, backup_receipt)
            receipt_backed_up = True
        os.replace(staging / "elements", target_elements)
        os.replace(staging / "receipt.json", target_receipt)
    except Exception:
        _remove_install_entry(target_elements)
        _remove_install_entry(target_receipt)
        if elements_backed_up:
            os.replace(backup_elements, target_elements)
        if receipt_backed_up:
            os.replace(backup_receipt, target_receipt)
        raise
    else:
        _remove_install_entry(backup_elements)
        _remove_install_entry(backup_receipt)


def build_receipt(
    *,
    archive_path: Path,
    private_map_out: Path,
    output_dir: Path = DEFAULT_OUTPUT,
    policy_path: Path = DEFAULT_POLICY,
) -> dict[str, object]:
    """Build validated public artifacts, then atomically install them."""

    policy = load_policy(policy_path)
    private_target = _guard_private_map_path(
        private_map_out,
        output_dir,
        forbidden_files=(archive_path, policy_path),
    )
    records, archive, private_map = _scan_archive(archive_path, policy)
    output_dir.parent.mkdir(parents=True, exist_ok=True)
    with tempfile.TemporaryDirectory(prefix=".archive-receipt-", dir=output_dir.parent) as name:
        staging = Path(name)
        _write_artifacts(staging, records, archive, policy)
        check_receipt(output_dir=staging, policy_path=policy_path)
        _atomic_write(private_target, canonical_json(private_map) + b"\n", private=True)
        _install_artifacts(staging, output_dir)
    return check_receipt(output_dir=output_dir, policy_path=policy_path)


def _compare_public_artifacts(expected: Path, observed: Path) -> None:
    for filename in ("receipt.json",):
        if (expected / filename).read_bytes() != (observed / filename).read_bytes():
            raise ReceiptError("private source rebuild diverges from the public aggregate receipt")
    expected_elements = expected / "elements"
    observed_elements = observed / "elements"
    expected_names = sorted(path.name for path in expected_elements.iterdir())
    observed_names = sorted(path.name for path in observed_elements.iterdir())
    if expected_names != observed_names:
        raise ReceiptError("private source rebuild diverges from the public shard set")
    for filename in expected_names:
        if (expected_elements / filename).read_bytes() != (observed_elements / filename).read_bytes():
            raise ReceiptError("private source rebuild diverges from a public element shard")


def verify_source(
    *,
    archive_path: Path,
    output_dir: Path = DEFAULT_OUTPUT,
    policy_path: Path = DEFAULT_POLICY,
) -> dict[str, object]:
    """Rebuild from the private source and compare every public receipt byte."""

    committed = check_receipt(output_dir=output_dir, policy_path=policy_path)
    policy = load_policy(policy_path)
    records, archive, _private_map = _scan_archive(archive_path, policy)
    with tempfile.TemporaryDirectory(prefix="archive-receipt-verify-") as name:
        staging = Path(name)
        _write_artifacts(staging, records, archive, policy)
        check_receipt(output_dir=staging, policy_path=policy_path)
        _compare_public_artifacts(output_dir, staging)
    return committed


def run_checked(action: str, **kwargs: Path) -> dict[str, object]:
    """Translate lower-level policy errors into one stable CLI error type."""

    try:
        if action == "build":
            return build_receipt(**kwargs)
        if action == "check":
            return check_receipt(**kwargs)
        if action == "verify-source":
            return verify_source(**kwargs)
    except (ClassificationError, PolicyValidationError) as exc:
        raise ReceiptError(str(exc)) from exc
    raise ReceiptError("unknown receipt action")
