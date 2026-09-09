import unittest
from pathlib import Path
import subprocess
import sys

ROOT = Path(__file__).resolve().parents[2]
ETL = ROOT / "scripts/etl/mop_comparable_browse.py"
META = ROOT / "src/data/generated/mop-comparable-browse.meta.json"
DATA = ROOT / "src/data/generated/mop-comparable-browse.data.jsonl.gz"


class MopComparableBrowseTests(unittest.TestCase):
    def test_check_passes_on_generated_artifact(self):
        if not META.exists() or not DATA.exists():
            self.skipTest("snapshot mop-comparable-browse non presente")
        result = subprocess.run(
            [sys.executable, str(ETL), "--check"],
            cwd=ROOT,
            capture_output=True,
            text=True,
            check=False,
        )
        self.assertEqual(result.returncode, 0, result.stderr or result.stdout)
        self.assertIn("ok mop-comparable-browse", result.stdout)


if __name__ == "__main__":
    unittest.main()
