"""Offline checks for the pinned OpenCivitas FC70RIFIUTI 2021 snapshot."""
from __future__ import annotations

import json
import unittest
from pathlib import Path

from opencivitas_2021_rifiuti_snapshot import OUTPUT, SEMANTIC_SHA256, semantic_digest, validate_snapshot


class OpenCivitas2021RifiutiSnapshotTest(unittest.TestCase):
    def test_committed_snapshot_matches_semantic_pin(self) -> None:
        snapshot = json.loads(OUTPUT.read_text(encoding="utf-8"))
        validate_snapshot(snapshot)
        self.assertEqual(semantic_digest(snapshot), SEMANTIC_SHA256)
        self.assertEqual(snapshot["coverage"]["municipalities"], 6565)
        self.assertEqual(snapshot["referenceYear"], 2021)
        self.assertIn("FC80RIFIUTI", snapshot["methodology"]["functionSeparationWarning"])
        self.assertEqual(snapshot["coverage"]["function"], "RIFIUTI")
        self.assertEqual(snapshot["source"]["family"], "FC70RIFIUTI")
        self.assertEqual(Path("scripts/etl/specs/opencivitas-2021-rifiuti.source.json").exists(), True)


if __name__ == "__main__":
    unittest.main()
