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
