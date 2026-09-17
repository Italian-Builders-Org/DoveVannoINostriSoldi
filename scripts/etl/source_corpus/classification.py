"""Deterministic, conservative path classification for the receipt ledger."""

from __future__ import annotations

import fnmatch
import hashlib
import json
from dataclasses import dataclass
from pathlib import Path

from .publication_policy import (
    AUTHORITIES,
    CONTENT_CLASSES,
    DISPOSITIONS,
    FAMILY_RE,
    LICENSES,
    PRIVACY_STATES,
    SHA256_RE,
)


class ClassificationError(ValueError):
    """The configured classifier is incomplete or internally inconsistent."""


def _reject_json_constant(value: str) -> object:
    raise ValueError(f"non-finite JSON constant is forbidden: {value}")


@dataclass(frozen=True)
class Policy:
    raw: dict[str, object]
    sha256: str
    expected_archive: dict[str, object]
    expected_counts: dict[str, int]
    id_prefix: str
    id_width: int
    shard_size: int
    default_family: str
    family_rules: tuple[dict[str, object], ...]
    content_rules: tuple[dict[str, object], ...]
    class_defaults: dict[str, dict[str, str]]
    allowed_families: frozenset[str]


def _require_object(value: object, label: str) -> dict[str, object]:
    if not isinstance(value, dict):
        raise ClassificationError(f"{label} must be an object")
    return value


def _require_rules(value: object, label: str, result_key: str) -> tuple[dict[str, object], ...]:
    if not isinstance(value, list):
        raise ClassificationError(f"{label} must be an array")
    rules: list[dict[str, object]] = []
    for index, item in enumerate(value):
        rule = _require_object(item, f"{label}[{index}]")
        if set(rule) != {result_key, "patterns"}:
            raise ClassificationError(f"{label}[{index}] has unexpected fields")
        result = rule[result_key]
        patterns = rule["patterns"]
        if not isinstance(result, str) or not result:
            raise ClassificationError(f"{label}[{index}].{result_key} must be text")
        if not isinstance(patterns, list) or not patterns or not all(
            isinstance(pattern, str) and pattern for pattern in patterns
        ):
            raise ClassificationError(f"{label}[{index}].patterns must contain text")
        rules.append({result_key: result, "patterns": tuple(patterns)})
    return tuple(rules)


def load_policy(path: Path) -> Policy:
    payload = path.read_bytes()
    try:
        raw = json.loads(payload, parse_constant=_reject_json_constant)
    except (UnicodeDecodeError, ValueError) as exc:
        raise ClassificationError("policy must be valid UTF-8 JSON") from exc
    root = _require_object(raw, "policy")
    required_root = {
        "schemaVersion",
        "expectedArchive",
        "expectedCorpus",
        "idPrefix",
        "idWidth",
        "shardSize",
        "defaultFamily",
        "familyRules",
        "contentRules",
        "contentClassDefaults",
    }
    if set(root) != required_root or root.get("schemaVersion") != 1:
        raise ClassificationError("policy root diverges from schema version 1")

    expected_archive_raw = _require_object(root["expectedArchive"], "expectedArchive")
    if set(expected_archive_raw) != {"bytes", "sha256"}:
        raise ClassificationError("expected archive fingerprint is incomplete")
    archive_bytes = expected_archive_raw.get("bytes")
    archive_sha256 = expected_archive_raw.get("sha256")
    if isinstance(archive_bytes, bool) or not isinstance(archive_bytes, int) or archive_bytes <= 0:
        raise ClassificationError("expectedArchive.bytes must be a positive integer")
    if not isinstance(archive_sha256, str) or SHA256_RE.fullmatch(archive_sha256) is None:
        raise ClassificationError("expectedArchive.sha256 must be a lowercase SHA-256 digest")
    expected_archive = {"bytes": archive_bytes, "sha256": archive_sha256}

    expected = _require_object(root["expectedCorpus"], "expectedCorpus")
    if set(expected) != {"entries", "regular", "hardlink", "symlink"}:
        raise ClassificationError("expected corpus counts are incomplete")
    counts: dict[str, int] = {}
    for key, value in expected.items():
        if isinstance(value, bool) or not isinstance(value, int) or value < 0:
            raise ClassificationError(f"expectedCorpus.{key} must be a non-negative integer")
        counts[key] = value
    if counts["entries"] != counts["regular"] + counts["hardlink"] + counts["symlink"]:
        raise ClassificationError("expected corpus counts do not close")

    id_prefix = root["idPrefix"]
    id_width = root["idWidth"]
    shard_size = root["shardSize"]
    default_family = root["defaultFamily"]
    if not isinstance(id_prefix, str) or not id_prefix or any(char.isspace() for char in id_prefix):
        raise ClassificationError("idPrefix must be non-empty and contain no whitespace")
    if isinstance(id_width, bool) or not isinstance(id_width, int) or id_width < 1:
        raise ClassificationError("idWidth must be a positive integer")
    if len(str(max(1, counts["entries"]))) > id_width:
        raise ClassificationError("idWidth is too small for the expected corpus")
    if isinstance(shard_size, bool) or not isinstance(shard_size, int) or shard_size < 1:
        raise ClassificationError("shardSize must be a positive integer")
    if not isinstance(default_family, str) or FAMILY_RE.fullmatch(default_family) is None:
        raise ClassificationError("defaultFamily must be a neutral slug")

    family_rules = _require_rules(root["familyRules"], "familyRules", "family")
    content_rules = _require_rules(root["contentRules"], "contentRules", "contentClass")
    families = {default_family}
    for rule in family_rules:
        family = rule["family"]
        if not isinstance(family, str) or FAMILY_RE.fullmatch(family) is None:
            raise ClassificationError("family rule result must be a neutral slug")
        families.add(family)
    for rule in content_rules:
        if rule["contentClass"] not in CONTENT_CLASSES:
            raise ClassificationError("content rule result is outside the closed class domain")

    defaults_raw = _require_object(root["contentClassDefaults"], "contentClassDefaults")
    if set(defaults_raw) != CONTENT_CLASSES:
        raise ClassificationError("every content class must have one conservative default")
    class_defaults: dict[str, dict[str, str]] = {}
    for content_class, value in defaults_raw.items():
        fields = _require_object(value, f"contentClassDefaults.{content_class}")
        if set(fields) != {"authority", "license", "privacy", "disposition"}:
            raise ClassificationError(f"defaults for {content_class} are incomplete")
        if fields.get("authority") not in AUTHORITIES:
            raise ClassificationError(f"authority default for {content_class} is invalid")
        if fields.get("license") not in LICENSES:
            raise ClassificationError(f"license default for {content_class} is invalid")
        if fields.get("privacy") not in PRIVACY_STATES:
            raise ClassificationError(f"privacy default for {content_class} is invalid")
        if fields.get("disposition") not in DISPOSITIONS:
            raise ClassificationError(f"disposition default for {content_class} is invalid")
        if fields.get("disposition") in {"git-raw", "git-derived"} and (
            fields.get("authority") not in {"primary", "official-mirror"}
            or fields.get("license") != "verified-open"
            or fields.get("privacy") not in {
                "clear",
                "organization-identifiers",
                "named-professional-role",
            }
        ):
            raise ClassificationError(
                f"public Git disposition for {content_class} lacks authority, license, or privacy proof"
            )
        class_defaults[content_class] = {key: str(item) for key, item in fields.items()}

    return Policy(
        raw=root,
        sha256=hashlib.sha256(payload).hexdigest(),
        expected_archive=expected_archive,
        expected_counts=counts,
        id_prefix=id_prefix,
        id_width=id_width,
        shard_size=shard_size,
        default_family=default_family,
        family_rules=family_rules,
        content_rules=content_rules,
        class_defaults=class_defaults,
        allowed_families=frozenset(families),
    )


def _matches(path: str, patterns: tuple[str, ...]) -> bool:
    normalized = path.casefold()
    rooted = "/" + normalized.lstrip("/")
    return any(
        fnmatch.fnmatchcase(candidate, pattern.casefold())
        for pattern in patterns
        for candidate in (normalized, rooted)
    )


def classify_path(path: str, policy: Policy) -> dict[str, str]:
    family = policy.default_family
    for rule in policy.family_rules:
        patterns = rule["patterns"]
        if isinstance(patterns, tuple) and _matches(path, patterns):
            family = str(rule["family"])
            break

    content_class = "source-document"
    for rule in policy.content_rules:
        patterns = rule["patterns"]
        if isinstance(patterns, tuple) and _matches(path, patterns):
            content_class = str(rule["contentClass"])
            break

    defaults = policy.class_defaults[content_class]
    return {
        "family": family,
        "contentClass": content_class,
        "authority": defaults["authority"],
        "license": defaults["license"],
        "privacy": defaults["privacy"],
        "disposition": defaults["disposition"],
    }
