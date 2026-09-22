"""Offline checks for the pinned OpenCivitas FC80ISTRUZ 2022 snapshot."""
from __future__ import annotations

import json
import unittest
from pathlib import Path

from opencivitas_2022_istruzione_snapshot import OUTPUT, SEMANTIC_SHA256, semantic_digest, validate_snapshot


class OpenCivitas2022IstruzioneSnapshotTest(unittest.TestCase):
    def test_committed_snapshot_matches_semantic_pin(self) -> None:
        snapshot = json.loads(OUTPUT.read_text(encoding="utf-8"))
        validate_snapshot(snapshot)
        self.assertEqual(semantic_digest(snapshot), SEMANTIC_SHA256)
        self.assertEqual(snapshot["coverage"]["municipalities"], 6550)
        self.assertEqual(snapshot["coverage"]["function"], "ISTRUZIONE")
        self.assertEqual(snapshot["source"]["family"], "FC80ISTRUZ")
        self.assertEqual(Path("scripts/etl/specs/opencivitas-2022-istruzione.source.json").exists(), True)
        self.assertIn("6 Comuni", snapshot["methodology"]["coverageWarning"])
        self.assertIn("Fascia", snapshot["methodology"]["coverageWarning"])


if __name__ == "__main__":
    unittest.main()
