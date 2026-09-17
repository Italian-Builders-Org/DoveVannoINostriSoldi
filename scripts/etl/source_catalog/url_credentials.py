"""Shared, bounded detection of credential-like material inside public URLs."""

from __future__ import annotations

import ipaddress
import re
from collections.abc import Collection
from functools import lru_cache
from urllib.parse import unquote, urlsplit


MAX_PERCENT_DECODE_PASSES = 8
MAX_URL_COMPONENT_CHARS = 8_192
MIN_OPAQUE_CREDENTIAL_CHARS = 16
MIN_STRONG_CONTEXT_CREDENTIAL_CHARS = 1

DEFAULT_SENSITIVE_KEYS = frozenset({
    "accesstoken", "apikey", "auth", "authorization", "clientsecret", "code",
    "cookie", "credential", "jwt", "key", "password", "secret", "session",
    "sessionid", "sig", "signature", "token", "xamzcredential",
    "xamzsignature", "xgoogcredential", "xgoogsignature",
})

# Generic words such as `code`, `key`, `auth`, or `session` occur frequently in
# ordinary public routes. Path matching therefore uses only labels whose exact
# meaning strongly implies that the following segment is credential material.
STRONG_PATH_KEYS = frozenset({
    "accesskey", "accesstoken", "apikey", "apitoken", "authtoken",
    "awsaccesskeyid", "awssecretaccesskey", "bearertoken", "clientkey",
    "clientsecret", "credential", "googleapikey", "idtoken", "jwt", "password",
    "privatekey", "privatetoken", "refreshtoken", "secret", "secretkey",
    "sessionid", "sessionkey", "sessiontoken", "signature", "signingkey",
    "token", "xamzcredential", "xamzsignature",
    "xgoogcredential", "xgoogsignature",
})

STRONG_PATH_KEY_SUFFIXES = (
    "accesskey", "apikey", "clientsecret", "credential", "encryptionkey",
    "password", "privatekey", "secret", "secretkey", "sessionid", "signature",
    "signingkey", "token",
)

STRONG_PATH_KEY_TOKENS = frozenset({
    "apikey", "clientsecret", "credential", "jwt", "password", "secret",
    "sessionid", "signature", "token",
})
STRONG_PATH_KEY_DESCRIPTORS = ("parameter", "param", "value")
STRONG_PATH_KEY_DESCRIPTOR_FORMS = frozenset(
    f"{key}{descriptor}"
    for key in STRONG_PATH_KEYS
    for descriptor in STRONG_PATH_KEY_DESCRIPTORS
)
STRONG_PATH_KEY_TOKEN_RE = re.compile(
    r"(?<![a-z0-9])(?:"
    + "|".join(sorted(map(re.escape, STRONG_PATH_KEY_TOKENS), key=len, reverse=True))
    + r")(?![a-z0-9])",
    re.IGNORECASE,
)

# These are route actions or documentation labels, not credential values. Keep
# the list exact and intentionally small so a strong `/token/<value>` context
# otherwise fails closed even when the value contains punctuation or low-entropy
# characters.
PUBLIC_OAUTH_TOKEN_ROUTE_SEGMENTS = frozenset({
    "callback", "create", "docs", "documentation", "endpoint", "exchange",
    "guida", "help", "index", "info", "instructions", "introspect",
    "istruzioni", "manuale", "openapi", "refresh", "request", "reset",
    "revoke", "schema", "spec", "status", "swagger", "validate",
})

# Inline route labels can legitimately describe public documentation.  This
# exception is deliberately limited to human-readable route words; arbitrary
# opaque tails still fail closed.
PUBLIC_INLINE_DOCUMENTATION_WORDS = frozenset({
    "administrators", "amministratori", "authentication", "autenticazione",
    "bucket", "callback", "docs", "documentation", "endpoint", "for",
    "guida", "guide", "help", "instructions", "istruzioni", "manuale",
    "openapi", "per", "policy", "refresh", "request", "revoke", "route", "schema",
    "spec", "status", "swagger", "users", "utenti", "validate",
})
PUBLIC_INLINE_DOCUMENTATION_URLS = frozenset({
    (
        "www.trasparenza.ipzs.it",
        "/dettagli/attodigara/8765/fornitura-token-medaglia-as-roma.html",
    ),
    (
        "societatrasparente.sviluppolavoroitalia.it",
        "/page/10/details/45548/affidamento-diretto-ai-sensi-dellart-50-comma-1-"
        "lett-b-del-dlgs-362023-e-smi-tramite-piattaforma-mepa-numero-procedura-"
        "1205681-id-ordine-8660179-per-il-rinnovo-annuale-della-manutenzione-di-n-"
        "950-licenze-password-manager-per-managed-person-24x7.html",
    ),
})
PUBLIC_DOCUMENTATION_PARENT_SEGMENTS = frozenset({
    "doc", "docs", "documentation", "guida", "guide",
})
KNOWN_TOKEN_DOCUMENTATION_PREFIXES = (
    "ghp_", "gho_", "ghu_", "ghs_", "ghr_", "github_pat_", "glpat-",
    "xoxb-", "xoxa-", "xoxp-", "xoxr-", "xoxs-",
)

KEY_NORMALIZER_RE = re.compile(r"[^a-z0-9]+")
PATH_SEGMENT_SPLIT_RE = re.compile(r"[/;\\\\]")
ASSIGNMENT_RE = re.compile(
    r"(?<![A-Za-z0-9])(?P<key>[A-Za-z][A-Za-z0-9_.-]{0,127})"
    r"\s*[:=]\s*(?P<value>[^\s&#;/?]{1,4096})",
)
KNOWN_TOKEN_RE = re.compile(
    r"(?<![A-Za-z0-9])(?P<token>(?:bearer|basic)\s+[A-Za-z0-9._~+/=-]{12,}|"
    r"eyJ[A-Za-z0-9_-]{12,}\.[A-Za-z0-9_-]{8,}\.[A-Za-z0-9_-]{8,}|"
    r"gh[pousr]_[A-Za-z0-9]{20,}|github_pat_[A-Za-z0-9_]{20,}|"
    r"glpat-[A-Za-z0-9_-]{16,}|xox[baprs]-[A-Za-z0-9-]{20,})",
    re.IGNORECASE,
)
CASE_SENSITIVE_KNOWN_TOKEN_RE = re.compile(
    r"(?<![A-Za-z0-9])(?:"
    r"(?:AKIA|ASIA)[0-9A-Z]{16}|AIza[0-9A-Za-z_-]{24,})"
)
CASE_SENSITIVE_COMPONENT_TOKEN_RE = re.compile(
    r"(?<![A-Za-z0-9])(?P<token>sk[-_][A-Za-z0-9_-]{16,})"
)
OPAQUE_CREDENTIAL_RE = re.compile(r"[A-Za-z0-9._~+=-]+\Z")
INLINE_LABEL_BOUNDARY_RE = re.compile(r"[^A-Za-z0-9]")
INLINE_COMPOUND_KEY_HINT_RE = re.compile(
    r"(?<![A-Za-z0-9])(?:access|api|auth|bearer|client|id|private|refresh|session)"
    r"[^A-Za-z0-9]+(?:key|secret|token)(?![A-Za-z0-9])",
    re.IGNORECASE,
)
DOCUMENTATION_PARENT_RE = re.compile(
    r"(?:^|[/;\\])(?:docs?|documentation|guida|guide)(?:[/;\\])\Z",
    re.IGNORECASE,
)
HOSTNAME_PROVIDER_KEYS = frozenset({
    "aiza", "akia", "asia", "basic", "bearer", "gho", "ghp", "ghr", "ghs", "ghu",
    "githubpat", "glpat", "xoxa", "xoxb", "xoxp", "xoxr", "xoxs",
    "sk",
})
HOSTNAME_CREDENTIAL_CONTEXT_KEY_PARTS = frozenset({"api", "auth"})
HOSTNAME_PUBLIC_DOCUMENTATION_LABELS = frozenset({
    "doc", "docs", "documentation", "documentazione", "guida", "guide", "help",
    "istruzioni", "manuale",
})
HOSTNAME_PUBLIC_CONTEXT_WORDS = (
    PUBLIC_OAUTH_TOKEN_ROUTE_SEGMENTS
    | PUBLIC_INLINE_DOCUMENTATION_WORDS
    | HOSTNAME_PUBLIC_DOCUMENTATION_LABELS
    | frozenset({
        "amministrazione", "api", "auth", "developer", "developers",
        "digitali", "domain", "dominio", "example", "gov", "government",
        "foundation", "information", "institutional", "international",
        "istituzionale", "it", "management",
        "nazionali", "oauth", "portal", "portale", "public", "pubblica",
        "service", "services", "servizi", "trasparente", "utente", "utenti",
        "verylonginstitutionaldomain",
    })
)
HOSTNAME_OPAQUE_VALUE_RE = re.compile(r"[A-Za-z0-9-]+\Z")
HOSTNAME_DNS_LABEL_RE = re.compile(r"(?!-)[A-Za-z0-9-]{1,63}(?<!-)\Z")
URI_SCHEME_INTRODUCER_RE = re.compile(
    r"[A-Za-z][A-Za-z0-9+.-]{0,31}://",
)
SLASH_RUN_RE = re.compile(r"/{2,}")
URL_COMPONENT_CONTROL_RE = re.compile(r"[\x00-\x1f\x7f]")
NON_PUBLIC_HOST_SUFFIXES = frozenset({
    "home.arpa", "internal", "invalid", "local", "localdomain", "localhost",
    "test",
})


def _normalize_key(value: str) -> str:
    return KEY_NORMALIZER_RE.sub("", value.casefold())


def is_non_public_hostname(host: str) -> bool:
    normalized = host.rstrip(".").casefold()
    if not normalized or any(
        normalized == suffix or normalized.endswith(f".{suffix}")
        for suffix in NON_PUBLIC_HOST_SUFFIXES
    ):
        return True
    try:
        address = ipaddress.ip_address(normalized)
    except ValueError:
        labels = normalized.split(".")
        return len(labels) == 1 or all(
            re.fullmatch(r"(?:0x[0-9a-f]+|[0-9]+)", label) is not None
            for label in labels
        )
    return (
        not address.is_global
        or address.is_private
        or address.is_loopback
        or address.is_link_local
        or address.is_multicast
        or address.is_reserved
        or address.is_unspecified
        or bool(getattr(address, "is_site_local", False))
        or getattr(address, "scope_id", None) is not None
    )


def is_exact_public_documentation_url(
    scheme: str,
    raw_authority: str,
    path: str,
    *,
    has_query_or_fragment: bool,
) -> bool:
    """Match only the two reviewed source URLs, without mutable suffixes."""

    try:
        raw_authority.encode("ascii")
    except UnicodeEncodeError:
        return False
    return (
        scheme.casefold() == "https"
        and not has_query_or_fragment
        and (raw_authority.casefold(), path) in PUBLIC_INLINE_DOCUMENTATION_URLS
    )


@lru_cache(maxsize=32)
def _normalized_sensitive_keys_cached(
    configured: frozenset[str],
) -> frozenset[str]:
    return DEFAULT_SENSITIVE_KEYS | frozenset(
        _normalize_key(value) for value in configured if value
    )


def _normalized_sensitive_keys(values: Collection[str] | None) -> frozenset[str]:
    if values is None:
        return DEFAULT_SENSITIVE_KEYS
    configured = values if isinstance(values, frozenset) else frozenset(values)
    return _normalized_sensitive_keys_cached(configured)


def _is_strong_path_key(value: str) -> bool:
    normalized = _normalize_key(value)
    return (
        normalized in STRONG_PATH_KEYS
        or STRONG_PATH_KEY_TOKEN_RE.search(value) is not None
        or any(normalized.endswith(suffix) for suffix in STRONG_PATH_KEY_SUFFIXES)
        or normalized in STRONG_PATH_KEY_DESCRIPTOR_FORMS
    )


def is_strong_credential_key(value: str) -> bool:
    return _is_strong_path_key(value)


def _decoded_layers(value: str) -> tuple[tuple[str, ...], bool]:
    """Decode a URL component to stability under explicit work ceilings."""

    if len(value) > MAX_URL_COMPONENT_CHARS:
        return (value[: MAX_URL_COMPONENT_CHARS + 1],), False
    layers = [value]
    decoded = value
    for _ in range(MAX_PERCENT_DECODE_PASSES):
        next_value = unquote(decoded)
        if len(next_value) > MAX_URL_COMPONENT_CHARS:
            return tuple(layers), False
        if next_value == decoded:
            return tuple(layers), True
        layers.append(next_value)
        decoded = next_value
    return tuple(layers), False


def _looks_like_opaque_credential(value: str, *, strong_context: bool = False) -> bool:
    candidate = value.strip("\"'()[]{}.,")
    if strong_context:
        return (
            len(candidate) >= MIN_STRONG_CONTEXT_CREDENTIAL_CHARS
            and len(candidate) <= MAX_URL_COMPONENT_CHARS
            and not any(char.isspace() or ord(char) < 0x20 for char in candidate)
        )
    if (
        len(candidate) < MIN_OPAQUE_CREDENTIAL_CHARS
        or len(candidate) > MAX_URL_COMPONENT_CHARS
        or OPAQUE_CREDENTIAL_RE.fullmatch(candidate) is None
    ):
        return False
    character_classes = sum((
        any(char.islower() for char in candidate),
        any(char.isupper() for char in candidate),
        any(char.isdigit() for char in candidate),
        any(char in "._~+=-" for char in candidate),
    ))
    return (
        len(set(candidate.casefold())) >= 6
        and (strong_context or character_classes >= 2)
    )


def _is_hostname_credential_key(value: str) -> bool:
    return (
        _normalize_key(value) in HOSTNAME_PROVIDER_KEYS
        or _is_strong_path_key(value)
        or INLINE_COMPOUND_KEY_HINT_RE.search(value) is not None
    )


def _is_hostname_public_context_label(value: str) -> bool:
    words = tuple(part for part in value.casefold().split("-") if part)
    return bool(words) and (
        all(word in HOSTNAME_PUBLIC_CONTEXT_WORDS for word in words)
        or (
            len(words) > 1
            and all(
                word in HOSTNAME_PUBLIC_CONTEXT_WORDS
                or _is_hostname_credential_key(word)
                for word in words
            )
        )
    )


def _is_hostname_credential_key_parts(
    parts: Collection[str],
    *,
    separator: str,
) -> bool:
    material = list(parts)
    raw = separator.join(material)
    if _is_hostname_credential_key(raw):
        return True
    without_documentation = [
        part
        for part in material
        if part.casefold() not in HOSTNAME_PUBLIC_DOCUMENTATION_LABELS
    ]
    if (
        without_documentation != material
        and bool(without_documentation)
        and _is_hostname_credential_key(separator.join(without_documentation))
    ):
        return True
    without_descriptive_context = [
        part
        for part in material
        if (
            not _is_hostname_public_context_label(part)
            or _normalize_key(part) in HOSTNAME_CREDENTIAL_CONTEXT_KEY_PARTS
        )
    ]
    if (
        without_descriptive_context != material
        and bool(without_descriptive_context)
        and _is_hostname_credential_key(
            separator.join(without_descriptive_context)
        )
    ):
        return True
    without_public_context = [
        part for part in material if not _is_hostname_public_context_label(part)
    ]
    return (
        without_public_context != material
        and bool(without_public_context)
        and _is_hostname_credential_key(separator.join(without_public_context))
    )


def _looks_like_hostname_opaque_credential(labels: Collection[str]) -> bool:
    material = list(labels)
    while material and _is_hostname_public_context_label(material[0]):
        material.pop(0)
    while material and _is_hostname_public_context_label(material[-1]):
        material.pop()
    candidate = "".join(material)
    return (
        len(candidate) >= MIN_OPAQUE_CREDENTIAL_CHARS
        and len(candidate) <= 253
        and HOSTNAME_OPAQUE_VALUE_RE.fullmatch(candidate) is not None
        and len(set(candidate.casefold())) >= 6
    )


def contains_credential_like_hostname(
    host: str,
    *,
    raw_authority: str | None = None,
) -> bool:
    """Detect credentials encoded into bounded DNS-label sequences."""

    if len(host) > 253 or not host:
        return True
    labels = host.rstrip(".").split(".")
    if not labels or any(not label or len(label) > 63 for label in labels):
        return True
    raw_host_material = host if raw_authority is None else raw_authority
    if (
        KNOWN_TOKEN_RE.search(host) is not None
        or CASE_SENSITIVE_KNOWN_TOKEN_RE.search(raw_host_material) is not None
    ):
        return True

    for index, label in enumerate(labels):
        # A DNS label may keep the key and value together.  Try every hyphen
        # boundary so compound keys work in either order (for example
        # `api-key-<opaque>` and `<opaque>-client-secret`).  Hostname values do
        # not inherit the path detector's fail-closed strong context: they
        # must independently look opaque.
        parts = label.split("-")
        for key_start in range(len(parts)):
            for key_end in range(key_start + 1, len(parts) + 1):
                key_parts = parts[key_start:key_end]
                if not _is_hostname_credential_key_parts(
                    key_parts,
                    separator="-",
                ):
                    continue
                if (
                    _looks_like_hostname_opaque_credential(parts[:key_start])
                    or _looks_like_hostname_opaque_credential(parts[key_end:])
                    or _looks_like_hostname_opaque_credential(
                        [*parts[:key_start], *parts[key_end:]]
                    )
                ):
                    return True

        # Credential keys and values may each be chunked into any number of
        # adjacent labels.  Extend both to the hostname's natural 253-character
        # bound instead of imposing a bypassable chunk count.  Documentation
        # labels are retained internally, so they cannot be inserted between a
        # key and a credential to bypass the detector.
        for width in range(1, len(labels) - index + 1):
            end = index + width
            if end > len(labels):
                break
            key_parts = labels[index:end]
            if not _is_hostname_credential_key_parts(
                key_parts,
                separator=".",
            ):
                continue
            right_value: list[str] = []
            for value_index in range(end, len(labels)):
                value_label = labels[value_index]
                right_value.append(value_label)
                if _looks_like_hostname_opaque_credential(right_value):
                    return True
            left_value: list[str] = []
            for value_index in range(index - 1, -1, -1):
                value_label = labels[value_index]
                left_value.append(value_label)
                if _looks_like_hostname_opaque_credential(left_value):
                    return True
            if _looks_like_hostname_opaque_credential(
                [*reversed(left_value), *right_value]
            ):
                return True
    return False


def _looks_like_public_documentation_tail(value: str) -> bool:
    tokens = re.findall(r"[a-z]+|[0-9]+", value.casefold())
    if not tokens or not any(
        token in PUBLIC_INLINE_DOCUMENTATION_WORDS for token in tokens
    ):
        return False
    for index, token in enumerate(tokens):
        if token in PUBLIC_INLINE_DOCUMENTATION_WORDS:
            continue
        if token.isdigit() and len(token) <= 4:
            continue
        if (
            token == "x"
            and index > 0
            and index + 1 < len(tokens)
            and tokens[index - 1].isdigit()
            and tokens[index + 1].isdigit()
        ):
            continue
        return False
    return True


def _known_token_match_is_documentation(
    decoded: str,
    match: re.Match[str],
) -> bool:
    """Allow only explicit documentation routes containing token-prefix prose."""

    token = match.group("token").casefold()
    if DOCUMENTATION_PARENT_RE.search(decoded[: match.start("token")]) is None:
        return False
    if token.startswith(("bearer ", "basic ")):
        return _looks_like_public_documentation_tail(token.split(None, 1)[1])
    for prefix in KNOWN_TOKEN_DOCUMENTATION_PREFIXES:
        if token.startswith(prefix):
            return _looks_like_public_documentation_tail(token[len(prefix):])
    return False


def _component_token_match_is_documentation(match: re.Match[str]) -> bool:
    token = match.group("token")
    return token.startswith("sk-") and _looks_like_public_documentation_tail(
        token[3:]
    )


def _contains_inline_labeled_credential(
    segment: str,
    *,
    documentation_parent: bool,
) -> bool:
    if (
        not _is_strong_path_key(segment)
        and INLINE_COMPOUND_KEY_HINT_RE.search(segment) is None
    ):
        return False
    for boundary in INLINE_LABEL_BOUNDARY_RE.finditer(segment):
        label = segment[: boundary.start()]
        candidate = segment[boundary.end():]
        if _is_strong_path_key(label) and _looks_like_opaque_credential(
            candidate,
            strong_context=True,
        ):
            return not (
                documentation_parent
                and _looks_like_public_documentation_tail(candidate)
            )
    return False


def _path_payload(decoded: str) -> tuple[str, bool]:
    """Keep path-pair semantics out of hosts when scanning a complete URL."""

    if not decoded.casefold().startswith(("http://", "https://")):
        return decoded, True
    try:
        parsed = urlsplit(decoded)
    except ValueError:
        return decoded, True
    if parsed.scheme.casefold() in {"http", "https"} and parsed.netloc:
        return parsed.path, not (parsed.query or parsed.fragment)
    return decoded, True


def _embedded_uri_introducer_starts(
    decoded: str,
    *,
    allow_scheme_relative: bool,
) -> tuple[int, ...]:
    starts = {match.start() for match in URI_SCHEME_INTRODUCER_RE.finditer(decoded)}
    if allow_scheme_relative:
        for match in SLASH_RUN_RE.finditer(decoded):
            run_start, run_end = match.span()
            if (
                run_end - run_start >= 3
                or run_start == 0
                or not decoded[run_start - 1].isalnum()
            ):
                # A decoded `%2F%2F` after an existing path separator creates
                # a three-slash run.  Parse the final pair as the possible
                # authority introducer and avoid overlapping false failures.
                starts.add(run_end - 2)
    return tuple(sorted(starts))


def _embedded_uri_authority(
    decoded: str,
    start: int,
    *,
    allow_root_path_label: bool,
) -> tuple[bool, tuple[int, int] | None]:
    candidate = decoded[start:]
    try:
        parsed = urlsplit(candidate)
        parsed.port
    except ValueError:
        return True, None
    if not parsed.netloc:
        return True, None
    if parsed.username is not None or parsed.password is not None:
        return True, None
    if not parsed.hostname:
        return True, None
    try:
        host = parsed.hostname.encode("idna").decode("ascii").casefold().rstrip(".")
    except UnicodeError:
        return True, None
    is_ip_literal = False
    try:
        ipaddress.ip_address(host)
        is_ip_literal = True
    except ValueError:
        labels = host.split(".")
        if (
            len(host) > 253
            or any(HOSTNAME_DNS_LABEL_RE.fullmatch(label) is None for label in labels)
        ):
            return True, None
    if contains_credential_like_hostname(host, raw_authority=parsed.netloc):
        return True, None
    # A leading double slash is present in a small number of reviewed public
    # document paths (for example ``//wp-content/...``).  In a top-level URL
    # path, a single DNS-like label is therefore a path segment, not enough on
    # its own to prove a nested authority.  Userinfo, credential-shaped hosts,
    # and non-public hosts were already rejected above.
    if not is_ip_literal and "." not in host and allow_root_path_label and start == 0:
        if (
            host in NON_PUBLIC_HOST_SUFFIXES
            or re.fullmatch(r"(?:0x[0-9a-f]+|[0-9]+)", host) is not None
        ):
            return True, None
        return False, None
    if is_non_public_hostname(host):
        return True, None
    if not is_ip_literal and "." not in host:
        return True, None
    authority_offset = candidate.find("//") + 2
    authority_start = start + authority_offset
    return False, (authority_start, authority_start + len(parsed.netloc))


def _neutralize_embedded_uri_authorities(
    decoded: str,
    *,
    allow_scheme_relative: bool,
    allow_root_path_label: bool,
) -> tuple[str, bool]:
    authority_spans: set[tuple[int, int]] = set()
    for start in _embedded_uri_introducer_starts(
        decoded,
        allow_scheme_relative=allow_scheme_relative,
    ):
        sensitive, authority_span = _embedded_uri_authority(
            decoded,
            start,
            allow_root_path_label=allow_root_path_label,
        )
        if sensitive:
            return decoded, True
        if authority_span is not None:
            authority_spans.add(authority_span)
    neutralized = decoded
    for start, end in sorted(authority_spans, reverse=True):
        neutralized = f"{neutralized[:start]}public.example{neutralized[end:]}"
    return neutralized, False


def contains_credential_like_url_component(
    value: str,
    *,
    sensitive_keys: Collection[str] | None = None,
    has_query_or_fragment: bool = False,
    is_url_path: bool = False,
) -> bool:
    """Reject credentials in a path/value without treating normal IDs as secrets.

    A generic opaque segment is never sufficient on its own. It must either be
    a recognizable token form or follow an exact, high-confidence credential
    label. Recursively encoded material is inspected with fixed pass/size caps.
    """

    layers, stable = _decoded_layers(value)
    if not stable:
        return True
    normalized_keys = _normalized_sensitive_keys(sensitive_keys)
    for decoded in layers:
        if not is_url_path and (
            URL_COMPONENT_CONTROL_RE.search(decoded) is not None or "\\" in decoded
        ):
            return True
        # Public paths may contain encoded slashes, backslashes, or a control
        # byte around a nested URI introducer.  Normalize only a bounded scan
        # copy: the outer URL parser still preserves the source value exactly.
        # This catches disguised nested authorities without blanket-rejecting
        # reviewed public slugs that contain an encoded tab.
        authority_scan = decoded
        if is_url_path:
            authority_scan = URL_COMPONENT_CONTROL_RE.sub("", authority_scan)
            authority_scan = authority_scan.replace("\\", "/")
        decoded_for_scan, sensitive_authority = _neutralize_embedded_uri_authorities(
            authority_scan,
            allow_scheme_relative=True,
            allow_root_path_label=is_url_path,
        )
        if sensitive_authority:
            return True
        if CASE_SENSITIVE_KNOWN_TOKEN_RE.search(decoded_for_scan) is not None:
            return True
        if any(
            not _component_token_match_is_documentation(match)
            for match in CASE_SENSITIVE_COMPONENT_TOKEN_RE.finditer(decoded_for_scan)
        ):
            return True
        if any(
            not _known_token_match_is_documentation(decoded_for_scan, match)
            for match in KNOWN_TOKEN_RE.finditer(decoded_for_scan)
        ):
            return True
        for match in ASSIGNMENT_RE.finditer(decoded_for_scan):
            normalized_key = _normalize_key(match.group("key"))
            strong_key = _is_strong_path_key(match.group("key"))
            if (
                (normalized_key in normalized_keys or strong_key)
                and _looks_like_opaque_credential(
                    match.group("value"),
                    strong_context=strong_key,
                )
            ):
                return True
        path_payload, oauth_route_has_no_suffix = _path_payload(decoded_for_scan)
        segments = [
            segment
            for segment in PATH_SEGMENT_SPLIT_RE.split(path_payload)
            if segment
        ]
        if any(
            _contains_inline_labeled_credential(
                segment,
                documentation_parent=(
                    index > 0
                    and segments[index - 1].casefold()
                    in PUBLIC_DOCUMENTATION_PARENT_SEGMENTS
                ),
            )
            for index, segment in enumerate(segments)
        ):
            return True
        for index, (key, candidate) in enumerate(zip(segments, segments[1:])):
            is_public_oauth_token_route = (
                index > 0
                and index + 2 == len(segments)
                and oauth_route_has_no_suffix
                and not has_query_or_fragment
                and _normalize_key(segments[index - 1]) in {"oauth", "oauth2"}
                and _normalize_key(key) == "token"
                and candidate.casefold() in PUBLIC_OAUTH_TOKEN_ROUTE_SEGMENTS
            )
            if (
                not is_public_oauth_token_route
                and _is_strong_path_key(key)
                and _looks_like_opaque_credential(candidate, strong_context=True)
            ):
                return True
    return False
