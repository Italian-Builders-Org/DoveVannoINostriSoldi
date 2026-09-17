"""Closed enums and structural validation for archive element receipts."""

from __future__ import annotations

import re
from typing import Final


ELEMENT_KINDS: Final = frozenset({"regular", "hardlink", "symlink"})
CONTENT_CLASSES: Final = frozenset(
    {
        "official-source-candidate",
        "secondary-source",
        "curated-dataset",
        "derived-data",
        "source-document",
        "backup-or-superseded",
        "draft-or-candidate",
        "error-or-failed-attempt",
        "quality-control",
        "tooling-or-presentation",
        "browser-or-session-state",
    }
)
AUTHORITIES: Final = frozenset({"primary", "official-mirror", "secondary", "unknown"})
LICENSES: Final = frozenset({"verified-open", "restricted", "not-declared", "unknown"})
PRIVACY_STATES: Final = frozenset(
    {
        "clear",
        "organization-identifiers",
        "named-professional-role",
        "review-required",
        "restricted",
    }
)
DISPOSITIONS: Final = frozenset(
    {"git-raw", "git-derived", "manifest-only", "private-quarantine", "non-product"}
)

SHA256_RE: Final = re.compile(r"[0-9a-f]{64}\Z")
FAMILY_RE: Final = re.compile(r"[a-z0-9]+(?:-[a-z0-9]+)*\Z")

BASE_KEYS: Final = frozenset(
    {
        "id",
        "ordinal",
        "kind",
        "storedBytes",
        "logicalBytes",
        "family",
        "contentClass",
        "authority",
        "license",
        "privacy",
        "disposition",
    }
)


class PolicyValidationError(ValueError):
    """A policy or public receipt violates the closed contract."""


def payload_digest_is_private(record: dict[str, object]) -> bool:
    """Return whether an element payload digest must remain outside public artifacts."""

    return (
        record.get("privacy") == "restricted"
        or record.get("disposition") == "private-quarantine"
    )


def require_non_negative_int(value: object, label: str) -> int:
    if isinstance(value, bool) or not isinstance(value, int) or value < 0:
        raise PolicyValidationError(f"{label} must be a non-negative integer")
    return value


def validate_element_record(
    record: object,
    *,
    expected_ordinal: int,
    id_prefix: str,
    id_width: int,
    allowed_families: frozenset[str],
) -> dict[str, object]:
    if not isinstance(record, dict):
        raise PolicyValidationError("element receipt must be an object")

    kind = record.get("kind")
    if kind not in ELEMENT_KINDS:
        raise PolicyValidationError("element kind is not supported")
    expected_keys = BASE_KEYS
    if kind == "hardlink":
        expected_keys = expected_keys | {"hardlinkTargetId"}
    if kind in {"regular", "hardlink"} and not payload_digest_is_private(record):
        expected_keys = expected_keys | {"payloadSha256"}
    if set(record) != expected_keys:
        raise PolicyValidationError("element receipt fields diverge from the closed schema")

    ordinal = require_non_negative_int(record.get("ordinal"), "ordinal")
    if ordinal != expected_ordinal or ordinal == 0:
        raise PolicyValidationError("element ordinals must be contiguous and one-based")
    expected_id = f"{id_prefix}{ordinal:0{id_width}d}"
    if record.get("id") != expected_id:
        raise PolicyValidationError("opaque element identifier does not match its ordinal")

    stored_bytes = require_non_negative_int(record.get("storedBytes"), "storedBytes")
    logical_bytes = require_non_negative_int(record.get("logicalBytes"), "logicalBytes")
    if kind == "regular" and stored_bytes != logical_bytes:
        raise PolicyValidationError("regular element byte counts disagree")
    if kind in {"hardlink", "symlink"} and stored_bytes != 0:
        raise PolicyValidationError("link elements cannot contain stored payload bytes")

    if kind in {"regular", "hardlink"} and not payload_digest_is_private(record):
        payload_sha256 = record.get("payloadSha256")
        if not isinstance(payload_sha256, str) or SHA256_RE.fullmatch(payload_sha256) is None:
            raise PolicyValidationError("payloadSha256 must be a lowercase SHA-256 digest")

    family = record.get("family")
    if (
        not isinstance(family, str)
        or FAMILY_RE.fullmatch(family) is None
        or family not in allowed_families
    ):
        raise PolicyValidationError("family is absent or outside the policy domain")
    if record.get("contentClass") not in CONTENT_CLASSES:
        raise PolicyValidationError("content class is absent or outside the contract")
    if record.get("authority") not in AUTHORITIES:
        raise PolicyValidationError("authority is absent or outside the contract")
    if record.get("license") not in LICENSES:
        raise PolicyValidationError("license is absent or outside the contract")
    if record.get("privacy") not in PRIVACY_STATES:
        raise PolicyValidationError("privacy is absent or outside the contract")
    if record.get("disposition") not in DISPOSITIONS:
        raise PolicyValidationError("disposition is absent or outside the contract")

    if kind == "hardlink":
        target_id = record.get("hardlinkTargetId")
        if not isinstance(target_id, str) or not target_id.startswith(id_prefix):
            raise PolicyValidationError("hard-link target identifier is invalid")

    return record
