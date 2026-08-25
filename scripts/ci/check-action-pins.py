#!/usr/bin/env python3
"""Verify that all GitHub Actions `uses:` references are SHA-pinned.

Pinned actions must match a commit SHA recorded in ``action-pins.json``.
Tag-based references (``actions/checkout@v6``) are rejected — only
``actions/checkout@<40-hex-sha>`` is accepted.

Local actions (``./.github/actions/foo``) and Docker actions
(``docker://image:tag``) are exempt.

Usage:
    python scripts/ci/check-action-pins.py          # check workflows and local actions

Exit code is 0 if all third-party actions are SHA-pinned, 1 otherwise.
"""

from __future__ import annotations

import argparse
import json
import re
import sys
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent.parent
WORKFLOWS_DIR = ROOT / ".github" / "workflows"
LOCAL_ACTIONS_DIR = ROOT / ".github" / "actions"
PINS_FILE = ROOT / "scripts" / "ci" / "action-pins.json"
YAML_SUFFIXES = frozenset({".yml", ".yaml"})
LOCAL_ACTION_FILENAMES = frozenset({"action.yml", "action.yaml"})

# Match both anonymous ``- uses:`` and named-step ``uses:`` lines. Matching
# one line at a time keeps extraction independent of a preceding ``name:`` key
# and prevents unrelated YAML values containing the word ``uses`` from being
# treated as action references. The optional quote is back-referenced, so a
# malformed or mismatched quoted scalar is not accepted.
USES_RE = re.compile(
    r"^[ \t]*(?:-[ \t]*)?(?:(?P<key_quote>['\"])uses(?P=key_quote)|uses):[ \t]+"
    r"(?:(?P<anchor>&[A-Za-z_][A-Za-z0-9_-]*)[ \t]+)?"
    r"(?P<quote>['\"]?)(?P<ref>[^\s#'\"]+)(?P=quote)"
    r"(?:[ \t]+#[ \t]*(?P<comment>.*))?[ \t]*$"
)

# A reachable YAML anchor may be declared on the ``uses:`` line or on a
# sibling key and later referenced as ``uses: *name``. Only scalar action refs
# are recorded; unresolved aliases remain outside the third-party reference
# set rather than being guessed.
ANCHOR_RE = re.compile(
    r"^[ \t]*(?:-[ \t]*)?"
    r"(?:[A-Za-z_][A-Za-z0-9_.-]*|['\"][^'\"]+['\"]):[ \t]*"
    r"&(?P<name>[A-Za-z_][A-Za-z0-9_-]*)[ \t]+"
    r"(?P<quote>['\"]?)(?P<ref>[^\s#'\"]+)(?P=quote)"
    r"(?=[ \t]*(?:#|$))"
)
ALIAS_RE = re.compile(r"^\*(?P<name>[A-Za-z_][A-Za-z0-9_-]*)$")
USES_KEY_RE = re.compile(
    r"^[ \t]*(?:-[ \t]*)?(?:(?P<key_quote>['\"])uses(?P=key_quote)|uses):[ \t]*(?P<value>.*)$"
)

# Block/folded YAML scalars can hide an action ref on following lines. The
# checker deliberately requires an explicit single-line scalar so these valid
# YAML forms fail closed instead of bypassing pin validation.
BLOCK_SCALAR_USES_RE = re.compile(
    r"^[ \t]*(?:-[ \t]*)?(?:(?P<key_quote>['\"])uses(?P=key_quote)|uses):[ \t]+"
    r"(?P<indicator>[>|](?:[+-]?[1-9]?|[1-9]?[+-]?))"
    r"(?:[ \t]+#[^\n]*)?[ \t]*$"
)

# A full 40-char lowercase hex SHA
SHA_RE = re.compile(r"^[0-9a-f]{40}$")
DOCKER_DIGEST_RE = re.compile(r"^docker://[^@\s]+@sha256:[0-9a-f]{64}$")
PIN_ACTION_RE = re.compile(r"^[A-Za-z0-9._-]+(?:/[A-Za-z0-9._-]+)+$")

# GitHub accepts compact mapping entries such as
# ``- { name: Checkout, \"uses\": actions/checkout@<sha> }``.  Keep the
# accepted grammar narrow: only a mapping boundary may introduce the key.
INLINE_USES_RE = re.compile(
    r"(?:^|[{,][ \t]*)(?:(?P<key_quote>['\"])uses(?P=key_quote)|uses):[ \t]+"
    r"(?:(?P<quote>['\"])(?P<ref>[^'\"]+)(?P=quote)|(?P<bare>[^,}\s#]+))"
    r"(?:[ \t]+#[ \t]*(?P<comment>.*))?"
)

# A valid GitHub action reference: owner/repo or owner/repo/subpath
ACTION_RE = re.compile(r"^[A-Za-z0-9._-]+(?:/[A-Za-z0-9._-]+)+$")


def load_pins() -> dict[str, dict]:
    """Load the pin lockfile and return a mapping of action-name → {tag, sha}."""
    try:
        data = json.loads(PINS_FILE.read_text(encoding="utf-8"))
    except (OSError, UnicodeDecodeError, json.JSONDecodeError) as exc:
        raise ValueError(f"invalid action pin lock: {exc}") from exc
    if not isinstance(data, dict) or set(data) != {"$schema", "description", "pinnedAt", "actions", "tools"}:
        raise ValueError("invalid action pin lock: unexpected top-level keys")
    actions = data.get("actions")
    if not isinstance(actions, dict) or not actions:
        raise ValueError("invalid action pin lock: actions must be a non-empty object")
    for name, entry in actions.items():
        if not isinstance(name, str) or not PIN_ACTION_RE.fullmatch(name):
            raise ValueError(f"invalid action pin lock: invalid action name {name!r}")
        if not isinstance(entry, dict) or set(entry) != {"tag", "sha"}:
            raise ValueError(f"invalid action pin lock: invalid entry for {name}")
        if not isinstance(entry["tag"], str) or not entry["tag"].strip():
            raise ValueError(f"invalid action pin lock: invalid tag for {name}")
        if not isinstance(entry["sha"], str) or not SHA_RE.fullmatch(entry["sha"]):
            raise ValueError(f"invalid action pin lock: invalid SHA for {name}")
    return actions


def workflow_files() -> list[Path]:
    """Return all YAML workflow files, including nested workflow directories."""
    if not WORKFLOWS_DIR.exists():
        return []
    return sorted(
        path
        for path in WORKFLOWS_DIR.rglob("*")
        if path.is_file() and path.suffix.lower() in YAML_SUFFIXES
    )


def local_action_files() -> list[Path]:
    """Return local action metadata files under ``.github/actions``."""
    if not LOCAL_ACTIONS_DIR.exists():
        return []
    return sorted(
        path
        for path in LOCAL_ACTIONS_DIR.rglob("*")
        if path.is_file() and path.name in LOCAL_ACTION_FILENAMES
    )


def _uses_entries(line: str) -> list[tuple[str, str | None]]:
    """Lex YAML mapping keys named ``uses`` without interpreting quoted text.

    This intentionally supports only single-line scalar values. Unsupported
    YAML forms are reported by the caller instead of being silently skipped.
    """
    entries: list[tuple[str, str | None]] = []
    quote: str | None = None
    brace_depth = 0
    i = 0
    while i < len(line):
        char = line[i]
        if quote:
            if char == quote and (i == 0 or line[i - 1] != "\\"):
                quote = None
            i += 1
            continue
        quoted_key = char in "'\"" and line.startswith(char + "uses" + char, i)
        if char in "'\"" and not quoted_key:
            quote = char
            i += 1
            continue
        if char == "{":
            brace_depth += 1
            i += 1
            continue
        if char == "}" and brace_depth:
            brace_depth -= 1
            i += 1
            continue
        if char == "#":
            break

        key_start = i
        key_end = i
        if quoted_key:
            key_end = i + 6
        elif line.startswith("uses", i) and (i == 0 or not (line[i - 1].isalnum() or line[i - 1] in "_-")):
            key_end = i + 4
        else:
            i += 1
            continue

        after = key_end
        while after < len(line) and line[after].isspace():
            after += 1
        if after >= len(line) or line[after] != ":":
            i = key_end
            continue
        before = line[:key_start]
        if brace_depth == 0 and ":" in before:
            i = key_end
            continue
        value_start = after + 1
        while value_start < len(line) and line[value_start].isspace():
            value_start += 1
        value_chars: list[str] = []
        value_quote: str | None = None
        j = value_start
        local_brace = brace_depth
        comment: str | None = None
        while j < len(line):
            current = line[j]
            if value_quote:
                value_chars.append(current)
                if current == value_quote and line[j - 1] != "\\":
                    value_quote = None
                j += 1
                continue
            if current in "'\"":
                value_quote = current
                value_chars.append(current)
                j += 1
                continue
            if current == "#":
                comment = line[j + 1 :].strip()
                break
            if local_brace and current in ",}":
                break
            value_chars.append(current)
            j += 1
        entries.append(("".join(value_chars).strip(), comment))
        i = max(j, key_end)
    return entries


def _resolve_ref(raw: str, anchors: dict[str, str]) -> tuple[str | None, str | None]:
    if not raw:
        return None, "uses: unsupported scalar — use an explicit single-line action reference"
    if raw in {">", "|", ">-", "|-", ">+", "|+"}:
        return None, "uses: multiline block/folded scalar is unsupported; use an explicit single-line action reference"
    anchor = re.fullmatch(r"&([A-Za-z_][A-Za-z0-9_-]*)\s+(.+)", raw)
    if anchor:
        anchors[anchor.group(1)] = anchor.group(2).strip("'\"")
        return anchors[anchor.group(1)], None
    alias = ALIAS_RE.fullmatch(raw)
    if alias:
        resolved = anchors.get(alias.group("name"))
        if resolved is None:
            return None, "uses: unresolved YAML alias — use an explicit single-line action reference"
        return resolved, None
    if (raw.startswith("'") and raw.endswith("'")) or (raw.startswith('"') and raw.endswith('"')):
        raw = raw[1:-1]
    return raw, None


def extract_uses(workflow_path: Path) -> list[tuple[int, str, str | None]]:
    """Extract recognized ``uses`` references while ignoring quoted commands."""
    results = []
    anchors: dict[str, str] = {}
    for line_num, line in enumerate(workflow_path.read_text().splitlines(), start=1):
        for raw, comment in _uses_entries(line):
            action_ref, _ = _resolve_ref(raw, anchors)
            if action_ref is None or action_ref.startswith("./"):
                continue
            if action_ref.startswith("docker://") or (
                "@" in action_ref and ACTION_RE.match(action_ref.split("@", 1)[0])
            ):
                results.append((line_num, action_ref, comment))
    return results


def unsupported_uses_lines(workflow_path: Path) -> list[tuple[int, str]]:
    results = []
    anchors: dict[str, str] = {}
    for line_num, line in enumerate(workflow_path.read_text().splitlines(), start=1):
        for raw, _comment in _uses_entries(line):
            action_ref, reason = _resolve_ref(raw, anchors)
            if reason:
                results.append((line_num, reason))
                continue
            if action_ref and action_ref.startswith("./"):
                continue
            if action_ref and action_ref.startswith("docker://"):
                continue
            if not action_ref or "@" not in action_ref or not ACTION_RE.match(action_ref.split("@", 1)[0]):
                results.append((line_num, "uses: unsupported scalar — use an explicit single-line owner/repo@ref action reference"))
    return results


def check_workflow(
    workflow_path: Path, pins: dict[str, dict]
) -> list[str]:
    """Check a single workflow file. Returns a list of error strings."""
    errors = []
    try:
        file_label = workflow_path.relative_to(ROOT)
    except ValueError:
        file_label = workflow_path

    for line_num, reason in unsupported_uses_lines(workflow_path):
        errors.append(f"{file_label}:{line_num}: {reason}")

    for line_num, action_ref, comment in extract_uses(workflow_path):
        if action_ref.startswith("docker://"):
            if not DOCKER_DIGEST_RE.fullmatch(action_ref):
                errors.append(
                    f"{file_label}:{line_num}: {action_ref} — "
                    "mutable Docker action reference; pin the image with @sha256:<digest>"
                )
            continue

        action_name, ref = action_ref.split("@", 1)

        # Must be a 40-char SHA
        if not SHA_RE.match(ref):
            # Check if it's a tag that we have a pin for
            if action_name in pins:
                expected_sha = pins[action_name]["sha"]
                expected_tag = pins[action_name]["tag"]
                errors.append(
                    f"{file_label}:{line_num}: {action_ref} — "
                    f"tag-based ref, pin to "
                    f"{action_name}@{expected_sha} # {expected_tag}"
                )
            else:
                errors.append(
                    f"{file_label}:{line_num}: {action_ref} — "
                    f"unpinned action (not in {PINS_FILE.name})"
                )
            continue

        # It's a SHA — verify it matches the lockfile
        if action_name not in pins:
            errors.append(
                f"{file_label}:{line_num}: {action_name}@{ref} — "
                f"SHA-pinned but not recorded in {PINS_FILE.name}"
            )
            continue

        expected_sha = pins[action_name]["sha"]
        if ref != expected_sha:
            expected_tag = pins[action_name]["tag"]
            errors.append(
                f"{file_label}:{line_num}: {action_name}@{ref} — "
                f"SHA does not match {PINS_FILE.name} "
                f"(expected {expected_sha} # {expected_tag})"
            )
            continue

        # SHA matches — verify the version comment is present and agrees with
        # the semantic tag recorded in the lockfile.
        expected_tag = pins[action_name]["tag"]
        if not comment:
            errors.append(
                f"{file_label}:{line_num}: {action_name}@{ref} — "
                f"missing version comment (add ' # {expected_tag}')"
            )
        elif comment != expected_tag:
            errors.append(
                f"{file_label}:{line_num}: {action_name}@{ref} — "
                f"version comment '{comment}' does not match {PINS_FILE.name} "
                f"(expected '# {expected_tag}')"
            )

    return errors


def main(argv: list[str] | None = None) -> int:
    parser = argparse.ArgumentParser(
        description="Verify that all GitHub Actions uses are SHA-pinned."
    )
    parser.parse_args(argv)

    if not PINS_FILE.exists():
        print(f"ERROR: Pin file not found: {PINS_FILE}", file=sys.stderr)
        return 1

    try:
        pins = load_pins()
    except ValueError as exc:
        print(f"ERROR: {exc}", file=sys.stderr)
        return 1

    if not pins:
        print("ERROR: No pinned actions in lockfile", file=sys.stderr)
        return 1

    errors: list[str] = []
    workflow_paths = workflow_files()
    action_paths = local_action_files()
    reference_count = 0

    for workflow_path in [*workflow_paths, *action_paths]:
        reference_count += len(extract_uses(workflow_path))
        errors.extend(check_workflow(workflow_path, pins))

    file_count = len(workflow_paths) + len(action_paths)
    print(
        f"Checked {file_count} workflow/action file(s) "
        f"({len(workflow_paths)} workflow, {len(action_paths)} local action), "
        f"{reference_count} third-party action reference(s), "
        f"{len(pins)} pinned action(s)"
    )

    if errors:
        print(
            f"\n❌ {len(errors)} pin violation(s):\n", file=sys.stderr
        )
        for err in errors:
            print(f"  • {err}", file=sys.stderr)
        return 1

    print("✅ All third-party actions are SHA-pinned")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
