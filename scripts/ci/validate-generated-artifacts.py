#!/usr/bin/env python3
"""Validate the generated-artifact registry and run offline artifact checks.

Usage:
    python scripts/ci/validate-generated-artifacts.py            # validate registry only
    python scripts/ci/validate-generated-artifacts.py --run-checks  # validate + run offline checks

The validator:
  1. Validates the registry schema and structural integrity.
  2. Checks that all referenced files, tests, and workflows exist.
  3. Detects unregistered generated-data files.
  4. With --run-checks: executes unique standalone offline --check commands.
  5. With --run-checks: verifies worktree cleanliness (checks must not modify committed files).

It does NOT re-run the full ETL unittest suite.  Artifacts whose offline
guarantee is provided by the ETL suite are recorded as "covered-by-etl-suite"
and skipped.

Exit code is 0 on success, 1 on any validation failure.
"""

from __future__ import annotations

import argparse
import hashlib
import json
import os
import subprocess
import sys
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent.parent
REGISTRY_PATH = ROOT / "scripts" / "ci" / "generated-artifacts.json"

VALID_MODES = frozenset(
    {"online-refresh", "source-lock", "integrated-release", "curated-committed"}
)
VALID_COVERAGE = frozenset({"standalone", "etl-suite", "node-tests"})
# Extensions considered "generated data" for unregistered-file detection.
GENERATED_EXTENSIONS = frozenset({".json", ".jsonl", ".jsonl.gz", ".ts"})


class ValidationError(Exception):
    pass


def load_registry() -> dict:
    if not REGISTRY_PATH.exists():
        raise ValidationError(f"Registry not found: {REGISTRY_PATH}")
    try:
        return json.loads(REGISTRY_PATH.read_text(encoding="utf-8"))
    except json.JSONDecodeError as exc:
        raise ValidationError(f"Registry is not valid JSON: {exc}")


def validate_schema(registry: dict) -> list[str]:
    """Validate the registry schema. Returns a list of error strings."""
    errors = []

    if not isinstance(registry, dict):
        return ["Registry root must be a JSON object."]
    if registry.get("schemaVersion") != 1:
        errors.append(f"Unsupported schemaVersion: {registry.get('schemaVersion')!r} (expected 1)")

    artifacts = registry.get("artifacts")
    if not isinstance(artifacts, list):
        errors.append("'artifacts' must be a list.")
        return errors

    seen_ids: set[str] = set()
    seen_files: dict[str, str] = {}
    standalone_commands: set[str] = set()

    for i, art in enumerate(artifacts):
        prefix = f"artifact[{i}]"

        if not isinstance(art, dict):
            errors.append(f"{prefix}: must be an object.")
            continue

        # Required fields
        art_id = art.get("id")
        if not art_id or not isinstance(art_id, str):
            errors.append(f"{prefix}: missing or invalid 'id'.")
            art_id = f"<index-{i}>"
        elif art_id in seen_ids:
            errors.append(f"{prefix}: duplicate artifact id '{art_id}'.")
        else:
            seen_ids.add(art_id)

        if not art.get("owner"):
            errors.append(f"{art_id}: missing 'owner'.")

        files = art.get("files")
        if not isinstance(files, list) or not files:
            errors.append(f"{art_id}: 'files' must be a non-empty list.")
            files = []
        else:
            for f in files:
                if not isinstance(f, str):
                    errors.append(f"{art_id}: file entry must be a string, got {type(f).__name__}.")
                    continue
                if f in seen_files and seen_files[f] != art_id:
                    errors.append(
                        f"{art_id}: file '{f}' is also owned by '{seen_files[f]}' "
                        f"(duplicate file mapping)."
                    )
                else:
                    seen_files[f] = art_id

        mode = art.get("verificationMode")
        if mode not in VALID_MODES:
            errors.append(
                f"{art_id}: invalid verificationMode '{mode}'. "
                f"Expected one of: {', '.join(sorted(VALID_MODES))}."
            )

        offline = art.get("offlineCheck")
        if not isinstance(offline, dict):
            errors.append(f"{art_id}: 'offlineCheck' must be an object.")
        else:
            covered = offline.get("coveredBy")
            if covered not in VALID_COVERAGE:
                errors.append(
                    f"{art_id}: invalid offlineCheck.coveredBy '{covered}'. "
                    f"Expected one of: {', '.join(sorted(VALID_COVERAGE))}."
                )
            cmd = offline.get("command")
            if covered == "standalone":
                if not cmd or not isinstance(cmd, str):
                    errors.append(
                        f"{art_id}: standalone offlineCheck requires a non-null 'command'."
                    )
                else:
                    standalone_commands.add(cmd)

        # Optional: reconciliationTests
        tests = art.get("reconciliationTests", [])
        if not isinstance(tests, list):
            errors.append(f"{art_id}: 'reconciliationTests' must be a list.")
            tests = []

        # Optional: nodeTests
        node_tests = art.get("nodeTests", [])
        if not isinstance(node_tests, list):
            errors.append(f"{art_id}: 'nodeTests' must be a list.")

        # Optional: refreshWorkflow
        wf = art.get("refreshWorkflow")
        if wf is not None and not isinstance(wf, str):
            errors.append(f"{art_id}: 'refreshWorkflow' must be a string or null.")

        # Optional: sourceSpec (for source-lock)
        spec = art.get("sourceSpec")
        if spec is not None and not isinstance(spec, str):
            errors.append(f"{art_id}: 'sourceSpec' must be a string or null.")

        # generator
        gen = art.get("generator")
        if not isinstance(gen, dict):
            errors.append(f"{art_id}: 'generator' must be an object.")
        elif "requiresNetworkInput" not in gen:
            errors.append(f"{art_id}: 'generator.requiresNetworkInput' is required.")

    return errors


def validate_references(registry: dict) -> list[str]:
    """Check that referenced files, tests, and workflows exist."""
    errors = []

    for art in registry.get("artifacts", []):
        art_id = art.get("id", "<unknown>")

        for f in art.get("files", []):
            if not isinstance(f, str):
                continue
            path = ROOT / f
            if not path.exists():
                errors.append(f"{art_id}: file not found: {f}")
            elif path.is_dir():
                # Directories (e.g., integrated/rows) are valid file references
                if not any(path.iterdir()):
                    errors.append(f"{art_id}: directory is empty: {f}")

        for t in art.get("reconciliationTests", []):
            if not isinstance(t, str):
                continue
            path = ROOT / t
            if not path.exists():
                errors.append(f"{art_id}: reconciliation test not found: {t}")

        for t in art.get("nodeTests", []):
            if not isinstance(t, str):
                continue
            path = ROOT / t
            if not path.exists():
                errors.append(f"{art_id}: node test not found: {t}")

        wf = art.get("refreshWorkflow")
        if wf:
            path = ROOT / wf
            if not path.exists():
                errors.append(f"{art_id}: refresh workflow not found: {wf}")

        spec = art.get("sourceSpec")
        if spec:
            path = ROOT / spec
            if not path.exists():
                errors.append(f"{art_id}: source spec not found: {spec}")

    return errors


def collect_registered_files(registry: dict) -> set[str]:
    """Return the set of all registered file paths + exclusions."""
    registered = set()
    for art in registry.get("artifacts", []):
        for f in art.get("files", []):
            if isinstance(f, str):
                registered.add(f)
    for exc in registry.get("exclusions", []):
        if isinstance(exc, dict) and isinstance(exc.get("path"), str):
            registered.add(exc["path"])
    return registered


def detect_unregistered_files(registry: dict) -> list[str]:
    """Detect generated-data files not accounted for by the registry."""
    errors = []
    registered = collect_registered_files(registry)
    roots = registry.get("generatedDataRoots", [])

    for root_rel in roots:
        root = ROOT / root_rel
        if not root.exists():
            continue
        for dirpath, dirnames, filenames in os.walk(root):
            # Skip hidden directories
            dirnames[:] = [d for d in dirnames if not d.startswith(".")]
            for fname in filenames:
                full = Path(dirpath) / fname
                rel = str(full.relative_to(ROOT))
                if rel in registered:
                    continue

                ext = Path(fname).suffix.lower()
                # Handle .jsonl.gz
                if fname.endswith(".jsonl.gz"):
                    ext = ".jsonl.gz"

                if ext in GENERATED_EXTENSIONS:
                    # Check if this file is inside a registered directory
                    # (e.g., integrated/rows/ is registered as a directory)
                    in_registered_dir = any(
                        rel.startswith(r + "/") and (ROOT / r).is_dir()
                        for r in registered
                        if (ROOT / r).is_dir()
                    )
                    if in_registered_dir:
                        continue

                    errors.append(
                        f"Unregistered generated file: {rel} "
                        f"(add it to the registry or list it in 'exclusions' with a reason)"
                    )

    return errors


def git_porcelain() -> str:
    """Return `git status --porcelain` output."""
    result = subprocess.run(
        ["git", "status", "--porcelain"],
        cwd=ROOT,
        capture_output=True,
        text=True,
    )
    return result.stdout


def run_offline_checks(registry: dict) -> tuple[list[str], list[str], list[str]]:
    """Run unique standalone offline checks. Returns (executed, covered_by_etl, failed)."""
    executed = []
    covered_by_etl = []
    failed = []
    seen_commands: set[str] = set()

    # Set PYTHONPATH so ETL scripts can import sibling modules
    env = os.environ.copy()
    etl_dir = str(ROOT / "scripts" / "etl")
    env["PYTHONPATH"] = etl_dir + os.pathsep + env.get("PYTHONPATH", "")

    for art in registry.get("artifacts", []):
        art_id = art.get("id", "<unknown>")
        offline = art.get("offlineCheck", {})
        covered = offline.get("coveredBy")
        cmd = offline.get("command")

        if covered == "standalone" and cmd:
            if cmd in seen_commands:
                continue  # Deduplicate identical commands
            seen_commands.add(cmd)

            # Parse the command string
            parts = cmd.split()
            result = subprocess.run(parts, cwd=ROOT, env=env, capture_output=True, text=True)
            if result.returncode == 0:
                executed.append(f"{art_id}: {cmd}")
            else:
                failed.append(
                    f"{art_id}: {cmd}\n"
                    f"  exit code: {result.returncode}\n"
                    f"  stderr: {result.stderr[:500] if result.stderr else '(empty)'}"
                )
        elif covered == "etl-suite":
            covered_by_etl.append(art_id)
        elif covered == "node-tests":
            covered_by_etl.append(f"{art_id} (node-tests)")

    return executed, covered_by_etl, failed


def main() -> int:
    parser = argparse.ArgumentParser(
        description="Validate the generated-artifact registry and optionally run offline checks."
    )
    parser.add_argument(
        "--run-checks",
        action="store_true",
        help="Execute unique standalone offline --check commands and verify worktree cleanliness.",
    )
    parser.add_argument(
        "--json",
        action="store_true",
        help="Output results as JSON (for CI summary).",
    )
    args = parser.parse_args()

    errors = []

    # 1. Load and validate schema
    try:
        registry = load_registry()
    except ValidationError as exc:
        print(f"ERROR: {exc}", file=sys.stderr)
        return 1

    errors.extend(validate_schema(registry))
    errors.extend(validate_references(registry))
    errors.extend(detect_unregistered_files(registry))

    if errors:
        print(f"\n❌ Registry validation failed ({len(errors)} error(s)):\n", file=sys.stderr)
        for err in errors:
            print(f"  • {err}", file=sys.stderr)
        return 1

    artifact_count = len(registry.get("artifacts", []))
    file_count = sum(
        len(art.get("files", [])) for art in registry.get("artifacts", [])
    )
    standalone_count = sum(
        1
        for art in registry.get("artifacts", [])
        if art.get("offlineCheck", {}).get("coveredBy") == "standalone"
    )
    etl_covered_count = sum(
        1
        for art in registry.get("artifacts", [])
        if art.get("offlineCheck", {}).get("coveredBy") == "etl-suite"
    )
    node_covered_count = sum(
        1
        for art in registry.get("artifacts", [])
        if art.get("offlineCheck", {}).get("coveredBy") == "node-tests"
    )

    print(f"✅ Registry valid: {artifact_count} artifact groups, {file_count} files covered")
    print(f"   Standalone offline checks: {standalone_count}")
    print(f"   Covered by ETL suite: {etl_covered_count}")
    print(f"   Covered by Node tests: {node_covered_count}")
    print(f"   Unregistered files: 0")

    if not args.run_checks:
        print("\n(Run with --run-checks to execute offline artifact checks)")
        return 0

    # 2. Capture worktree baseline
    baseline = git_porcelain()

    # 3. Run offline checks
    print("\n--- Running standalone offline checks ---")
    executed, covered_by_etl, failed = run_offline_checks(registry)

    for entry in executed:
        print(f"  ✓ {entry}")

    if covered_by_etl:
        print(f"\n--- Covered by ETL suite (not re-run) ---")
        for entry in covered_by_etl:
            print(f"  → {entry}")

    if failed:
        print(f"\n❌ {len(failed)} offline check(s) FAILED:\n", file=sys.stderr)
        for entry in failed:
            print(f"  ✗ {entry}", file=sys.stderr)
        return 1

    print(f"\n✅ {len(executed)} standalone check(s) passed")

    # 4. Worktree cleanliness
    after = git_porcelain()
    new_changes = []
    baseline_lines = set(baseline.strip().split("\n")) if baseline.strip() else set()
    after_lines = set(after.strip().split("\n")) if after.strip() else set()

    new_lines = after_lines - baseline_lines
    if new_lines:
        new_changes = sorted(new_lines)

    if new_changes:
        print(
            f"\n❌ Worktree cleanliness check FAILED: "
            f"offline checks introduced {len(new_changes)} new modification(s):\n",
            file=sys.stderr,
        )
        for line in new_changes:
            print(f"  {line}", file=sys.stderr)
        return 1

    print("✅ Working tree clean after validation")

    # 5. CI summary
    if args.json:
        summary = {
            "artifactGroups": artifact_count,
            "generatedFilesCovered": file_count,
            "standaloneChecksExecuted": len(executed),
            "coveredByEtlSuite": len(covered_by_etl),
            "unregisteredFiles": 0,
            "worktreeClean": True,
        }
        print("\n" + json.dumps(summary, indent=2))

    return 0


if __name__ == "__main__":
    raise SystemExit(main())
