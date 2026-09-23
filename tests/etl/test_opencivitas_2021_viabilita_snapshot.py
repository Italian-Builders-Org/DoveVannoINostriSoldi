"""Offline checks for the pinned OpenCivitas FC70TERRVIAB 2021 snapshot."""
from __future__ import annotations

import json
import unittest
from pathlib import Path

from opencivitas_2021_viabilita_snapshot import OUTPUT, SEMANTIC_SHA256, semantic_digest, validate_snapshot


class OpenCivitas2021ViabilitaSnapshotTest(unittest.TestCase):
    def test_committed_snapshot_matches_semantic_pin(self) -> None:
        snapshot = json.loads(OUTPUT.read_text(encoding="utf-8"))
        validate_snapshot(snapshot)
        self.assertEqual(semantic_digest(snapshot), SEMANTIC_SHA256)
        self.assertEqual(snapshot["coverage"]["municipalities"], 6551)
        self.assertEqual(snapshot["referenceYear"], 2021)
        self.assertEqual(snapshot["coverage"]["function"], "TERR_VIAB")
        self.assertEqual(snapshot["source"]["family"], "FC70TERRVIAB")
        self.assertEqual(Path("scripts/etl/specs/opencivitas-2021-viabilita.source.json").exists(), True)
        self.assertIn("14 Comuni", snapshot["methodology"]["coverageWarning"])
        self.assertIn("FC80TERRVIAB", snapshot["methodology"]["functionSeparationWarning"])


if __name__ == "__main__":
    unittest.main()
