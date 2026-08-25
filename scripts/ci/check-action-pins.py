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
    r"^[ \t]*(?:-[ \t]*)?uses:[ \t]+"
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
    r"^[ \t]*(?:-[ \t]*)?uses:[ \t]*(?P<value>.*)$"
)

# Block/folded YAML scalars can hide an action ref on following lines. The
# checker deliberately requires an explicit single-line scalar so these valid
# YAML forms fail closed instead of bypassing pin validation.
BLOCK_SCALAR_USES_RE = re.compile(
    r"^[ \t]*(?:-[ \t]*)?uses:[ \t]+"
    r"(?P<indicator>[>|](?:[+-]?[1-9]?|[1-9]?[+-]?))"
    r"(?:[ \t]+#[^\n]*)?[ \t]*$"
)

# A full 40-char lowercase hex SHA
SHA_RE = re.compile(r"^[0-9a-f]{40}$")

# A valid GitHub action reference: owner/repo or owner/repo/subpath
ACTION_RE = re.compile(r"^[A-Za-z0-9._-]+(?:/[A-Za-z0-9._-]+)+$")


def load_pins() -> dict[str, dict]:
    """Load the pin lockfile and return a mapping of action-name → {tag, sha}."""
    data = json.loads(PINS_FILE.read_text())
    return data.get("actions", {})


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


def extract_uses(workflow_path: Path) -> list[tuple[int, str, str | None]]:
    """Extract (line_number, action_ref, version_comment) from a YAML file.

    Only returns third-party action references (owner/repo@...).
    Local actions (./...) and Docker actions (docker://...) are skipped.
    """
    content = workflow_path.read_text()
    results = []
    anchors: dict[str, str] = {}
    for line_num, line in enumerate(content.splitlines(), start=1):
        for anchor_match in ANCHOR_RE.finditer(line):
            anchors[anchor_match.group("name")] = anchor_match.group("ref")

        match = USES_RE.match(line)
        if match is None:
            continue

        action_ref = match.group("ref")
        alias_match = ALIAS_RE.fullmatch(action_ref)
        if alias_match:
            action_ref = anchors.get(alias_match.group("name"))
            if action_ref is None:
                continue

        raw_comment = match.group("comment")
        version_comment = raw_comment.strip() if raw_comment is not None else None

        # Skip local actions (./.github/actions/...)
        if action_ref.startswith("./"):
            continue
        # Skip Docker actions
        if action_ref.startswith("docker://"):
            continue
        # Must be owner/repo@ref
        if "@" not in action_ref:
            continue
        action_name = action_ref.split("@")[0]
        if not ACTION_RE.match(action_name):
            continue

        results.append((line_num, action_ref, version_comment))

    return results


def unsupported_uses_lines(workflow_path: Path) -> list[tuple[int, str]]:
    """Return line numbers and reasons for unsupported ``uses:`` scalars."""
    results = []
    anchors: dict[str, str] = {}
    for line_num, line in enumerate(workflow_path.read_text().splitlines(), start=1):
        for anchor_match in ANCHOR_RE.finditer(line):
            anchors[anchor_match.group("name")] = anchor_match.group("ref")

        if USES_KEY_RE.match(line) is None:
            continue
        block_match = BLOCK_SCALAR_USES_RE.match(line)
        if block_match is not None:
            results.append((
                line_num,
                f"uses: {block_match.group('indicator')} — "
                "multiline block/folded scalar is unsupported; "
                "use an explicit single-line action reference",
            ))
            continue

        match = USES_RE.match(line)
        if match is None:
            results.append((
                line_num,
                "uses: unsupported scalar — use an explicit single-line "
                "action reference",
            ))
            continue

        action_ref = match.group("ref")
        alias_match = ALIAS_RE.fullmatch(action_ref)
        if alias_match:
            action_ref = anchors.get(alias_match.group("name"))
            if action_ref is None:
                results.append((
                    line_num,
                    "uses: unresolved YAML alias — use an explicit single-line "
                    "action reference",
                ))
                continue

        if (
            not action_ref.startswith(("./", "docker://"))
            and ("@" not in action_ref or not ACTION_RE.match(action_ref.split("@", 1)[0]))
        ):
            results.append((
                line_num,
                "uses: unsupported scalar — use an explicit single-line "
                "owner/repo@ref action reference",
            ))
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

    pins = load_pins()

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
