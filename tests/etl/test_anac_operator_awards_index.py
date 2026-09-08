#!/usr/bin/env python3
from __future__ import annotations

import json
import subprocess
import sys
import tempfile
import unittest
from pathlib import Path


ROOT = Path(__file__).resolve().parents[2]
SCRIPT = ROOT / "scripts" / "etl" / "anac_operator_awards_index.py"
FIXTURE_AWARDEES = ROOT / "tests" / "fixtures" / "anac-awardees" / "awardees.csv"
FIXTURE_AWARDS = ROOT / "tests" / "fixtures" / "anac-awardees" / "awards.csv"


class AnacOperatorAwardsIndexTests(unittest.TestCase):
    def test_fixture_build_has_no_tax_ids_and_searchable_names(self) -> None:
        with tempfile.TemporaryDirectory() as temp_dir:
            output = Path(temp_dir) / "index"
            completed = subprocess.run(
                [
                    sys.executable,
                    str(SCRIPT),
                    "--fixture",
                    "--awardees-input",
                    str(FIXTURE_AWARDEES),
                    "--awards-input",
                    str(FIXTURE_AWARDS),
                    "--output",
                    str(output),
                ],
                cwd=ROOT,
                capture_output=True,
                text=True,
                check=False,
            )
            self.assertEqual(completed.returncode, 0, completed.stderr)
            meta = json.loads((output / "meta.json").read_text(encoding="utf-8"))
            self.assertEqual(meta["dataset"], "anac-operator-awards-index")
            self.assertEqual(meta["privacy"]["containsOperatorTaxIds"], False)
            self.assertEqual(meta["privacy"]["containsOperatorTaxIdHashes"], False)
            self.assertGreaterEqual(meta["totals"]["operators"], 2)
            check = subprocess.run(
                [sys.executable, str(SCRIPT), "--check", "--output", str(output)],
                cwd=ROOT,
                capture_output=True,
                text=True,
                check=False,
            )
            self.assertEqual(check.returncode, 0, check.stderr)


if __name__ == "__main__":
    unittest.main()
