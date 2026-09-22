"""Offline checks for the pinned OpenCivitas FC70SOCNID 2021 snapshot."""
from __future__ import annotations

import json
import unittest
from pathlib import Path

from opencivitas_2021_sociale_asili_snapshot import OUTPUT, SEMANTIC_SHA256, semantic_digest, validate_snapshot


class OpenCivitas2021SocialeAsiliSnapshotTest(unittest.TestCase):
    def test_committed_snapshot_matches_semantic_pin(self) -> None:
        snapshot = json.loads(OUTPUT.read_text(encoding="utf-8"))
        validate_snapshot(snapshot)
        self.assertEqual(semantic_digest(snapshot), SEMANTIC_SHA256)
        self.assertEqual(snapshot["coverage"]["municipalities"], 6555)
        self.assertEqual(snapshot["referenceYear"], 2021)
        self.assertEqual(snapshot["coverage"]["function"], "SOCIALE E NIDO")
        self.assertEqual(snapshot["source"]["family"], "FC70SOCNID")
        self.assertEqual(Path("scripts/etl/specs/opencivitas-2021-sociale-asili.source.json").exists(), True)
        self.assertIn("9 Comuni", snapshot["methodology"]["coverageWarning"])
        self.assertIn("066017", snapshot["methodology"]["coverageWarning"])
        self.assertIn("FC80SOCNID", snapshot["methodology"]["functionSeparationWarning"])


if __name__ == "__main__":
    unittest.main()
