"""Conservative public classification and URL redaction for source identities."""

from __future__ import annotations

import ipaddress
import re
from dataclasses import dataclass
from urllib.parse import parse_qsl, unquote, urlencode, urlsplit, urlunsplit

from .contracts import CatalogError, require_dict
from .url_credentials import (
    contains_credential_like_hostname,
    contains_credential_like_url_component,
    is_exact_public_documentation_url,
    is_non_public_hostname,
    is_strong_credential_key,
)


INVALID_PERCENT_ESCAPE_RE = re.compile(r"%(?![0-9A-Fa-f]{2})")
CONTROL_OR_SPACE_RE = re.compile(r"[\x00-\x20\x7f]")
QUERY_KEY_NORMALIZER_RE = re.compile(r"[^a-z0-9]+")
WINDOWS_PATH_RE = re.compile(r"^[A-Za-z]:[\\/]")
FILE_URL_IN_PATH_RE = re.compile(r"(?:^|/)file:(?:/{2,3}|\\\\)", re.IGNORECASE)
UNC_IN_PATH_RE = re.compile(r"(?:^|/)(?:\\\\|//)[^\\/\s]+[\\/]")
WORKSTATION_URL_PATH_PREFIXES = (
    # Lowercase `/home/...` is intentionally absent: committed institutional
    # sites use it as a public route, while canonical macOS paths use `/Users`.
    "/Users",
    "/private",
    "/tmp",
    "/var",
    "/workspace",
)
DOMAIN_RE = re.compile(
    r"(?:[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?)"
    r"(?:\.(?:[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?))*\Z"
)
SENSITIVE_QUERY_SUFFIXES = ("credential", "password", "secret", "signature", "token")
SENSITIVE_QUERY_VALUE_RE = re.compile(
    r"(?:^|\s)bearer\s+|"
    r"(?:^|[^A-Za-z0-9_-])eyJ[A-Za-z0-9_-]{12,}\.[A-Za-z0-9_-]{8,}\.[A-Za-z0-9_-]{8,}",
    re.IGNORECASE,
)
NESTED_QUERY_KEY_RE = re.compile(r"(?:^|[?&#;])([^=?&#;\s]{1,256})=")
MAX_PERCENT_DECODE_PASSES = 8


@dataclass(frozen=True)
class ClassificationResult:
    public_kind: str
    classification: str
    disposition: str
    public_value: str | None
    reason_codes: tuple[str, ...]


def _patterns(values: object, label: str) -> list[re.Pattern[str]]:
    if not isinstance(values, list):
        raise CatalogError(f"{label} must be an array")
    return [re.compile(str(item), re.IGNORECASE) for item in values]


def _matches_any(value: str, patterns: list[re.Pattern[str]]) -> bool:
    return any(pattern.search(value) is not None for pattern in patterns)


def _host_matches(host: str, suffixes: object) -> bool:
    if not isinstance(suffixes, list):
        return False
    return any(host == suffix or host.endswith(f".{suffix}") for suffix in suffixes)


def _normalized_query_key(value: str) -> str:
    return QUERY_KEY_NORMALIZER_RE.sub("", value.casefold())


def _query_key_is_sensitive(value: str, sensitive_keys: set[str]) -> bool:
    normalized = _normalized_query_key(value)
    tokens = set(re.findall(r"[a-z0-9]+", value.casefold()))
    return (
        normalized in sensitive_keys
        or is_strong_credential_key(value)
        or normalized.endswith(SENSITIVE_QUERY_SUFFIXES)
        or bool(tokens & sensitive_keys)
    )


def _percent_decoded_layers(value: str) -> tuple[tuple[str, ...], bool]:
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


def _contains_nested_sensitive_query(value: str, sensitive_keys: set[str]) -> bool:
    """Detect credentials hidden inside encoded return URLs or query blobs."""

    layers, stable = _percent_decoded_layers(value)
    if not stable:
        return True
    for decoded in layers:
        if any(
            _query_key_is_sensitive(match.group(1), sensitive_keys)
            for match in NESTED_QUERY_KEY_RE.finditer(decoded)
        ):
            return True
    return False


def _url_candidate(kind: str, value: str) -> bool:
    normalized_kind = kind.casefold()
    return (
        normalized_kind in {"url", "uri", "link", "source_url", "sourceurl"}
        or value.casefold().startswith(("http://", "https://", "file://"))
    )


def _looks_local_text(value: str, policy: dict[str, object]) -> bool:
    text_rules = require_dict(policy.get("textRules"), "textRules")
    patterns = _patterns(text_rules.get("localPathPatterns"), "textRules.localPathPatterns")
    return WINDOWS_PATH_RE.search(value) is not None or _matches_any(value, patterns)


def _looks_workstation_url_path(value: str) -> bool:
    """Recognize workstation references without blocking public `/Home` routes."""

    rooted = "/" + value.lstrip("/")
    if WINDOWS_PATH_RE.search(value.lstrip("/")) is not None:
        return True
    if FILE_URL_IN_PATH_RE.search(value) is not None:
        return True
    if "\\" in value and UNC_IN_PATH_RE.search(value) is not None:
        return True
    return any(
        rooted == prefix or rooted.startswith(f"{prefix}/")
        for prefix in WORKSTATION_URL_PATH_PREFIXES
    )


def _host_classification(host: str, path: str, policy: dict[str, object]) -> str:
    rules = require_dict(policy.get("urlRules"), "urlRules")
    if _host_matches(host, rules.get("officialSecondaryHostSuffixes")):
        return "official_secondary"
    if _host_matches(host, rules.get("officialHostSuffixes")):
        primary_patterns = _patterns(
            rules.get("officialPrimaryPathPatterns"),
            "urlRules.officialPrimaryPathPatterns",
        )
        return "official_primary" if _matches_any(path, primary_patterns) else "official_index"
    if _host_matches(host, rules.get("commercialHostSuffixes")):
        return "commercial"
    if _host_matches(host, rules.get("newsHostSuffixes")):
        return "news"
    return "unknown"


def _is_non_public_host(host: str, policy: dict[str, object]) -> bool:
    rules = require_dict(policy.get("urlRules"), "urlRules")
    return (
        _host_matches(host, rules.get("localHostSuffixes"))
        or is_non_public_hostname(host)
    )


def _quarantine_url(
    *, classification: str, reasons: set[str]
) -> ClassificationResult:
    return ClassificationResult(
        public_kind="url",
        classification=classification,
        disposition="quarantined",
        public_value=None,
        reason_codes=tuple(sorted(reasons)),
    )


def _classify_url(value: str, policy: dict[str, object]) -> ClassificationResult:
    limits = require_dict(policy.get("limits"), "limits")
    rules = require_dict(policy.get("urlRules"), "urlRules")
    reasons: set[str] = set()
    if CONTROL_OR_SPACE_RE.search(value) is not None or "\\" in value:
        return _quarantine_url(classification="unresolved", reasons={"malformed_url"})
    if INVALID_PERCENT_ESCAPE_RE.search(value) is not None:
        return _quarantine_url(classification="unresolved", reasons={"malformed_url"})
    try:
        parsed = urlsplit(value)
        port = parsed.port
    except ValueError:
        return _quarantine_url(classification="unresolved", reasons={"malformed_url"})
    scheme = parsed.scheme.casefold()
    allowed_schemes = rules.get("allowedSchemes")
    if not isinstance(allowed_schemes, list) or scheme not in allowed_schemes:
        classification = "local" if scheme == "file" else "unresolved"
        reason = "local_reference" if scheme == "file" else "unsupported_url_scheme"
        return _quarantine_url(classification=classification, reasons={reason})
    if parsed.username is not None or parsed.password is not None:
        return _quarantine_url(classification="unresolved", reasons={"url_userinfo"})
    if not parsed.hostname:
        return _quarantine_url(classification="unresolved", reasons={"malformed_url"})
    try:
        host = parsed.hostname.encode("idna").decode("ascii").casefold()
    except UnicodeError:
        return _quarantine_url(classification="unresolved", reasons={"malformed_url"})
    try:
        ipaddress.ip_address(host)
    except ValueError:
        if len(host) > 253 or DOMAIN_RE.fullmatch(host) is None:
            return _quarantine_url(classification="unresolved", reasons={"malformed_url"})
    if _is_non_public_host(host, policy):
        return _quarantine_url(classification="local", reasons={"non_public_host"})

    classification = _host_classification(host, parsed.path, policy)
    process_patterns = _patterns(rules.get("processPathPatterns"), "urlRules.processPathPatterns")
    text_rules = require_dict(policy.get("textRules"), "textRules")
    query_process_patterns = _patterns(
        text_rules.get("processPatterns"), "textRules.processPatterns"
    )
    sensitive_keys = frozenset(
        str(item) for item in rules.get("sensitiveQueryKeys", [])
    )
    if contains_credential_like_hostname(host, raw_authority=parsed.netloc):
        reasons.add("sensitive_url_value")
    has_query_or_fragment = "?" in value or "#" in value
    exact_documentation_url = is_exact_public_documentation_url(
        scheme,
        parsed.netloc,
        parsed.path,
        has_query_or_fragment=has_query_or_fragment,
    )
    path_layers, path_decoding_stable = _percent_decoded_layers(parsed.path)
    if not path_decoding_stable:
        reasons.add("process_path")
    elif any(_looks_workstation_url_path(layer) for layer in path_layers):
        return _quarantine_url(classification="local", reasons={"local_reference"})
    elif any(_matches_any(layer, process_patterns) for layer in path_layers):
        reasons.add("process_path")
    elif not exact_documentation_url and contains_credential_like_url_component(
        parsed.path,
        sensitive_keys=sensitive_keys,
        has_query_or_fragment=has_query_or_fragment,
        is_url_path=True,
    ):
        reasons.add("sensitive_path_value")

    try:
        query_pairs = parse_qsl(parsed.query, keep_blank_values=True, strict_parsing=False)
    except ValueError:
        return _quarantine_url(classification="unresolved", reasons={"malformed_url"})
    if len(query_pairs) > int(limits["maximumQueryPairs"]):
        reasons.add("excessive_query")

    tracking_keys = set(str(item) for item in rules.get("trackingQueryKeys", []))
    public_pairs: list[tuple[str, str]] = []
    for key, query_value in query_pairs:
        key_layers, key_decoding_stable = _percent_decoded_layers(key)
        decoded_layers, decoding_stable = _percent_decoded_layers(query_value)
        if (
            len(key) > int(limits["maximumQueryPartChars"])
            or len(query_value) > int(limits["maximumQueryPartChars"])
        ):
            reasons.add("excessive_query")
        normalized_keys = {_normalized_query_key(layer) for layer in key_layers}
        if not key_decoding_stable:
            reasons.add("sensitive_query_parameter")
        elif not decoding_stable:
            reasons.add("sensitive_query_value")
        elif any(
            _looks_local_text(layer, policy)
            for layer in (*key_layers, *decoded_layers)
        ):
            reasons.add("local_query")
        elif any(
            _query_key_is_sensitive(layer, sensitive_keys)
            or contains_credential_like_url_component(
                layer,
                sensitive_keys=sensitive_keys,
            )
            for layer in key_layers
        ):
            reasons.add("sensitive_query_parameter")
        elif (
            len(query_value) > int(limits["maximumPublicQueryValueChars"])
            or any(SENSITIVE_QUERY_VALUE_RE.search(layer) is not None for layer in decoded_layers)
            or _contains_nested_sensitive_query(query_value, sensitive_keys)
            or contains_credential_like_url_component(
                query_value,
                sensitive_keys=sensitive_keys,
            )
        ):
            reasons.add("sensitive_query_value")
        elif any(
            _matches_any(f"{key_layer}-{value_layer}", query_process_patterns)
            for key_layer in key_layers
            for value_layer in decoded_layers
        ):
            reasons.add("process_query")
        elif normalized_keys & tracking_keys:
            reasons.add("tracking_query_removed")
        else:
            public_pairs.append((key, query_value))
    if parsed.fragment and contains_credential_like_url_component(
        parsed.fragment,
        sensitive_keys=sensitive_keys,
    ):
        reasons.add("sensitive_url_value")
    if parsed.fragment:
        reasons.add("fragment_removed")

    quarantine_reasons = {
        "excessive_query",
        "local_query",
        "process_path",
        "process_query",
        "sensitive_query_parameter",
        "sensitive_query_value",
        "sensitive_path_value",
        "sensitive_url_value",
    }
    if reasons & quarantine_reasons:
        return _quarantine_url(classification=classification, reasons=reasons)

    public_host = f"[{host}]" if ":" in host else host
    if port is not None and not (
        (scheme == "http" and port == 80) or (scheme == "https" and port == 443)
    ):
        public_host = f"{public_host}:{port}"
    public_query = urlencode(public_pairs, doseq=True)
    public_value = urlunsplit((scheme, public_host, parsed.path, public_query, ""))
    if len(public_value) > int(limits["maximumPublicUrlChars"]):
        return _quarantine_url(classification=classification, reasons={"url_too_long"})
    return ClassificationResult(
        public_kind="url",
        classification=classification,
        disposition="published",
        public_value=public_value,
        reason_codes=tuple(sorted(reasons)),
    )


def classify_identity(kind: str, value: str, policy: dict[str, object]) -> ClassificationResult:
    """Classify without exposing unreviewed text or unsafe URL material."""

    if _looks_local_text(value, policy):
        return ClassificationResult(
            public_kind="url" if _url_candidate(kind, value) else "text",
            classification="local",
            disposition="quarantined",
            public_value=None,
            reason_codes=("local_reference",),
        )
    if _url_candidate(kind, value):
        return _classify_url(value, policy)

    text_rules = require_dict(policy.get("textRules"), "textRules")
    process_patterns = _patterns(text_rules.get("processPatterns"), "textRules.processPatterns")
    reason = (
        "process_label"
        if _matches_any(value, process_patterns)
        else "unreviewed_text_identity"
    )
    return ClassificationResult(
        public_kind="text",
        classification="unresolved",
        disposition="quarantined",
        public_value=None,
        reason_codes=(reason,),
    )


def validate_public_url(value: str, policy: dict[str, object]) -> None:
    """Require a published URL to remain public under a second classification pass."""

    result = _classify_url(value, policy)
    if result.disposition != "published" or result.public_value != value:
        raise CatalogError("public catalog contains a URL that is not publication-safe")
