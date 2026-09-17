"""Closed policy contract for the private-to-public source catalog boundary."""

from __future__ import annotations

import hashlib
import json
import re
from pathlib import Path


class CatalogError(ValueError):
    """The source ledger, policy, or generated artifact violates the contract."""


def canonical_json(value: object) -> bytes:
    """Serialize without platform or dictionary-order drift."""

    return json.dumps(
        value,
        ensure_ascii=False,
        sort_keys=True,
        separators=(",", ":"),
        allow_nan=False,
    ).encode("utf-8")


def sha256_bytes(payload: bytes) -> str:
    return hashlib.sha256(payload).hexdigest()


def _reject_duplicate_keys(pairs: list[tuple[str, object]]) -> dict[str, object]:
    output: dict[str, object] = {}
    for key, value in pairs:
        if key in output:
            raise CatalogError("policy JSON contains a duplicate key")
        output[key] = value
    return output


def require_dict(value: object, label: str) -> dict[str, object]:
    if not isinstance(value, dict):
        raise CatalogError(f"{label} must be an object")
    return value


def require_list(value: object, label: str) -> list[object]:
    if not isinstance(value, list):
        raise CatalogError(f"{label} must be an array")
    return value


def require_text(value: object, label: str) -> str:
    if not isinstance(value, str) or not value:
        raise CatalogError(f"{label} must be non-empty text")
    return value


def require_positive_int(value: object, label: str) -> int:
    if isinstance(value, bool) or not isinstance(value, int) or value <= 0:
        raise CatalogError(f"{label} must be a positive integer")
    return value


def _require_sorted_texts(value: object, label: str) -> list[str]:
    items = require_list(value, label)
    texts = [require_text(item, f"{label}[]") for item in items]
    if texts != sorted(set(texts)):
        raise CatalogError(f"{label} must contain sorted unique text values")
    return texts


def _require_patterns(value: object, label: str) -> list[str]:
    patterns = _require_sorted_texts(value, label)
    for pattern in patterns:
        try:
            re.compile(pattern, re.IGNORECASE)
        except re.error as error:
            raise CatalogError(f"{label} contains an invalid regular expression") from error
    return patterns


def validate_policy(policy: dict[str, object]) -> None:
    expected_keys = {
        "schemaVersion",
        "catalogVersion",
        "inputHeaders",
        "identityId",
        "classifications",
        "dispositions",
        "limits",
        "urlRules",
        "textRules",
    }
    if set(policy) != expected_keys:
        raise CatalogError("policy top-level fields diverge from the closed schema")
    if type(policy.get("schemaVersion")) is not int or policy.get("schemaVersion") != 1:
        raise CatalogError("unsupported policy schema version")
    require_text(policy.get("catalogVersion"), "catalogVersion")

    if policy.get("inputHeaders") != ["dataset", "field", "kind", "value", "occurrences"]:
        raise CatalogError("inputHeaders must match the private ledger contract exactly")

    identity = require_dict(policy.get("identityId"), "identityId")
    if set(identity) != {"algorithm", "prefix", "base32Chars", "minimumKeyBytes"}:
        raise CatalogError("identityId fields diverge from the closed schema")
    if identity.get("algorithm") != "hmac-sha256":
        raise CatalogError("only HMAC-SHA256 opaque identities are supported")
    prefix = require_text(identity.get("prefix"), "identityId.prefix")
    if re.fullmatch(r"[a-z][a-z0-9_]*_", prefix) is None:
        raise CatalogError("identityId.prefix is invalid")
    base32_chars = require_positive_int(identity.get("base32Chars"), "identityId.base32Chars")
    if not 20 <= base32_chars <= 52:
        raise CatalogError("identityId.base32Chars must be between 20 and 52")
    minimum_key_bytes = require_positive_int(
        identity.get("minimumKeyBytes"), "identityId.minimumKeyBytes"
    )
    if minimum_key_bytes < 32:
        raise CatalogError("identityId.minimumKeyBytes cannot be below 32")

    classifications = _require_sorted_texts(policy.get("classifications"), "classifications")
    expected_classifications = sorted(
        {
            "commercial",
            "local",
            "news",
            "official_index",
            "official_primary",
            "official_secondary",
            "unknown",
            "unresolved",
        }
    )
    if classifications != expected_classifications:
        raise CatalogError("classification domain is incomplete or unsupported")
    dispositions = _require_sorted_texts(policy.get("dispositions"), "dispositions")
    if dispositions != ["published", "quarantined"]:
        raise CatalogError("disposition domain is incomplete or unsupported")

    limits = require_dict(policy.get("limits"), "limits")
    if set(limits) != {
        "maximumInputBytes",
        "maximumRows",
        "maximumTextChars",
        "maximumPublicUrlChars",
        "maximumQueryPairs",
        "maximumQueryPartChars",
        "maximumPublicQueryValueChars",
    }:
        raise CatalogError("limits fields diverge from the closed schema")
    for key, value in limits.items():
        require_positive_int(value, f"limits.{key}")
    if int(limits["maximumPublicUrlChars"]) > int(limits["maximumTextChars"]):
        raise CatalogError("public URL limit cannot exceed the private text limit")
    if int(limits["maximumPublicQueryValueChars"]) > int(limits["maximumQueryPartChars"]):
        raise CatalogError("public query value limit cannot exceed the private query limit")

    url_rules = require_dict(policy.get("urlRules"), "urlRules")
    if set(url_rules) != {
        "allowedSchemes",
        "sensitiveQueryKeys",
        "trackingQueryKeys",
        "localHostSuffixes",
        "officialSecondaryHostSuffixes",
        "officialHostSuffixes",
        "commercialHostSuffixes",
        "newsHostSuffixes",
        "officialPrimaryPathPatterns",
        "processPathPatterns",
    }:
        raise CatalogError("urlRules fields diverge from the closed schema")
    if url_rules.get("allowedSchemes") != ["http", "https"]:
        raise CatalogError("only HTTP and HTTPS public URLs are supported")
    for key in ("sensitiveQueryKeys", "trackingQueryKeys"):
        values = _require_sorted_texts(url_rules.get(key), f"urlRules.{key}")
        if any(re.fullmatch(r"[a-z0-9]+", item) is None for item in values):
            raise CatalogError(f"urlRules.{key} values must be normalized tokens")
    for key in (
        "localHostSuffixes",
        "officialSecondaryHostSuffixes",
        "officialHostSuffixes",
        "commercialHostSuffixes",
        "newsHostSuffixes",
    ):
        values = _require_sorted_texts(url_rules.get(key), f"urlRules.{key}")
        if any(item != item.lower() or item.startswith(".") or "/" in item for item in values):
            raise CatalogError(f"urlRules.{key} contains an invalid host suffix")
    _require_patterns(
        url_rules.get("officialPrimaryPathPatterns"),
        "urlRules.officialPrimaryPathPatterns",
    )
    _require_patterns(url_rules.get("processPathPatterns"), "urlRules.processPathPatterns")

    text_rules = require_dict(policy.get("textRules"), "textRules")
    if set(text_rules) != {"publicationMode", "localPathPatterns", "processPatterns"}:
        raise CatalogError("textRules fields diverge from the closed schema")
    if text_rules.get("publicationMode") != "quarantine_all":
        raise CatalogError("unreviewed text identities must be quarantined")
    _require_patterns(text_rules.get("localPathPatterns"), "textRules.localPathPatterns")
    _require_patterns(text_rules.get("processPatterns"), "textRules.processPatterns")


def load_policy(path: Path) -> tuple[dict[str, object], bytes]:
    try:
        payload = path.read_bytes()
    except OSError as error:
        raise CatalogError("policy file is not readable") from error
    try:
        decoded = payload.decode("utf-8")
    except UnicodeDecodeError as error:
        raise CatalogError("policy file is not UTF-8") from error
    try:
        policy = json.loads(decoded, object_pairs_hook=_reject_duplicate_keys)
    except json.JSONDecodeError as error:
        raise CatalogError("policy file is not valid JSON") from error
    validated = require_dict(policy, "policy")
    validate_policy(validated)
    return validated, payload
