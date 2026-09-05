import runpy
import subprocess
import sys
import unittest
from pathlib import Path


ROOT = Path(__file__).resolve().parents[2]
SCRIPT = ROOT / "scripts" / "ci" / "source-snapshot-inventory.py"
DOC = ROOT / "docs" / "SOURCE_SNAPSHOT_INVENTORY.md"


class SourceSnapshotInventoryTests(unittest.TestCase):
    def test_inventory_is_generated_from_the_registry(self):
        result = subprocess.run(
            [sys.executable, str(SCRIPT), "--check"],
            cwd=ROOT,
            capture_output=True,
            text=True,
        )
        self.assertEqual(result.returncode, 0, result.stderr or result.stdout)
        text = DOC.read_text(encoding="utf-8")
        self.assertIn("#189", text)
        self.assertIn("PR automatica", text)
        self.assertIn("solo rilevamento", text)
        self.assertIn("manuale", text)
        self.assertIn("`siope-municipal`", text)
        self.assertIn("workflow scrive su `main`", text)
        self.assertNotRegex(text, r"[—–]")

    def test_reference_period_is_distinct_from_nested_observation_date(self):
        module = runpy.run_path(str(SCRIPT))
        payload = {"series": {"years": [2017, 2026]}, "source": {"observedAt": "2026-09-05"}}
        self.assertEqual(module["pick_period"](payload), "2017-2026")
        self.assertEqual(module["pick_observed"](payload), "2026-09-05")
        self.assertIsNone(module["pick_period"]({"source": payload["source"]}))

    def test_tax_period_takes_precedence_over_declaration_period(self):
        module = runpy.run_path(str(SCRIPT))
        payload = {"period": {"from": 2017, "to": 2025}, "taxPeriod": {"from": 2016, "to": 2024}}
        self.assertEqual(module["pick_period"](payload), "2016-2024 (anni di imposta)")
