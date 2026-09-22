import unittest
from pathlib import Path
import subprocess
import sys

ROOT = Path(__file__).resolve().parents[2]
ETL = ROOT / "scripts/etl/eurostat_arope.py"


class EurostatAropeEtlTest(unittest.TestCase):
    def test_offline_check(self):
        completed = subprocess.run(
            [sys.executable, str(ETL), "--check"],
            cwd=ROOT,
            capture_output=True,
            text=True,
            check=False,
        )
        self.assertEqual(completed.returncode, 0, completed.stderr)
        self.assertIn("coherent", completed.stdout)


if __name__ == "__main__":
    unittest.main()
