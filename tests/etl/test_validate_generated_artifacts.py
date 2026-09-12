"""Regression tests for the generated-artifact registry boundary."""

from __future__ import annotations

import copy
import importlib.util
import json
import sys
from pathlib import Path
from unittest import TestCase


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


if __name__ == "__main__":
    import unittest

    unittest.main()
