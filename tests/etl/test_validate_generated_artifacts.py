"""Regression tests for the generated-artifact registry boundary."""

from __future__ import annotations

import copy
import importlib.util
import json
import sys
from pathlib import Path
from subprocess import CompletedProcess
from unittest import TestCase, main
from unittest.mock import patch


ROOT = Path(__file__).resolve().parents[2]
SCRIPT = ROOT / "scripts" / "ci" / "validate-generated-artifacts.py"
SPEC = importlib.util.spec_from_file_location("validate_generated_artifacts", SCRIPT)
assert SPEC and SPEC.loader
validator = importlib.util.module_from_spec(SPEC)
sys.modules[SPEC.name] = validator
SPEC.loader.exec_module(validator)


class GeneratedArtifactsRegistryTests(TestCase):
    def test_committed_registry_passes_schema_validation_with_education_atlas(self) -> None:
        registry = json.loads(
            (ROOT / "scripts/ci/generated-artifacts.json").read_text(encoding="utf-8")
        )

        self.assertEqual(validator.validate_schema(registry), [])

    def test_shared_inventory_rejects_an_unapproved_third_owner(self) -> None:
        registry = json.loads(
            (ROOT / "scripts/ci/generated-artifacts.json").read_text(encoding="utf-8")
        )
        education = next(
            item for item in registry["artifacts"] if item["id"] == "education-atlas"
        )
        third_owner = copy.deepcopy(education)
        third_owner["id"] = "unrelated-artifact"
        third_owner["publication"] = None
        registry["artifacts"].append(third_owner)

        errors = validator.validate_schema(registry)

        self.assertTrue(
            any(
                "docs/SOURCE_SNAPSHOT_INVENTORY.md" in error
                and "duplicate file mapping" in error
                for error in errors
            ),
            errors,
        )


class OfflineCheckCommandTests(TestCase):
    REGISTRY = {
        "artifacts": [
            {"id": "shell-check", "offlineCheck": {"coveredBy": "standalone", "command": "bash scripts/etl/x_check.sh"}}
        ]
    }

    def test_command_runs_with_the_executable_resolved_on_path(self) -> None:
        # On Windows a bare "bash" reaches System32's WSL launcher before PATH.
        with patch("shutil.which", return_value="/resolved/bash") as which, patch.object(
            validator.subprocess, "run", return_value=CompletedProcess([], 0, "", "")
        ) as run:
            executed, _, failed, _ = validator.run_offline_checks(self.REGISTRY)

        which.assert_called_once_with("bash")
        self.assertEqual(run.call_args.args[0], ["/resolved/bash", "scripts/etl/x_check.sh"])
        self.assertEqual((executed, failed), (["shell-check: bash scripts/etl/x_check.sh"], []))

    def test_missing_executable_fails_the_check_without_running_it(self) -> None:
        with patch("shutil.which", return_value=None), patch.object(validator.subprocess, "run") as run:
            executed, _, failed, _ = validator.run_offline_checks(self.REGISTRY)

        run.assert_not_called()
        self.assertEqual(executed, [])
        self.assertEqual(len(failed), 1)
        self.assertIn("eseguibile non trovato nel PATH", failed[0])


if __name__ == "__main__":
    main()
