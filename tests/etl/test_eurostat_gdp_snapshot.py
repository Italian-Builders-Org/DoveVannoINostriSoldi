from __future__ import annotations

import json
import unittest
from pathlib import Path

ROOT = Path(__file__).resolve().parents[2]
SPEC_PATH = ROOT / "scripts/etl/specs/eurostat-gdp-2015-2026.source.json"
DATA_PATH = ROOT / "src/data/generated/eurostat-gdp-2015-2026.data.json"
META_PATH = ROOT / "src/data/generated/eurostat-gdp-2015-2026.meta.json"


class EurostatGdpSnapshotTests(unittest.TestCase):
    def test_check_passes_offline(self) -> None:
        import eurostat_gdp_snapshot as etl

        etl.check(SPEC_PATH, DATA_PATH, META_PATH)

    def test_coverage_matches_lock(self) -> None:
        data = json.loads(DATA_PATH.read_text(encoding="utf-8"))
        self.assertEqual(data["coverage"]["expectedCells"], data["coverage"]["observedCells"])
        self.assertEqual(data["quarterlyObservations"][-1]["period"], "2026-Q2")
        self.assertEqual(data["annualObservations"][-1]["period"], "2025")


if __name__ == "__main__":
    unittest.main()
