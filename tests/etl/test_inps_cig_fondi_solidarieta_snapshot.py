"""Offline checks for the INPS CIG Fondi di Solidarietà snapshot."""

from __future__ import annotations

import json
import subprocess
import sys
import tempfile
import unittest
from pathlib import Path

import inps_cig_fondi_solidarieta_snapshot as cig


class InpsCigFondiSolidarietaTests(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        cls.spec = cig.load_spec()
        cls.data = json.loads(cig.DEFAULT_DATA.read_bytes())

    def test_committed_bundle_reprojects(self):
        cig.check()

    def test_write_rejects_unlocked_csv(self):
        with tempfile.TemporaryDirectory() as directory:
            root = Path(directory)
            fixture_dir = root / "fixtures"
            fixture_dir.mkdir()
            asset = self.spec["source"]["assets"]["hours"]
            src = cig.ROOT / asset["path"]
            dest = fixture_dir / Path(asset["path"]).name
            dest.write_bytes(src.read_bytes() + b"\n")
            spec_path = root / "source.json"
            data_path = root / "data.json"
            meta_path = root / "meta.json"
            spec_path.write_bytes(cig.DEFAULT_SPEC.read_bytes())
            data_path.write_bytes(b"previous")
            meta_path.write_bytes(b"previous")
            before = {path: path.read_bytes() for path in (spec_path, data_path, meta_path)}
            result = subprocess.run(
                [
                    sys.executable,
                    str(Path(cig.__file__)),
                    "--write",
                    "--spec",
                    str(spec_path),
                    "--data",
                    str(data_path),
                    "--meta",
                    str(meta_path),
                    "--fixture-dir",
                    str(fixture_dir),
                ],
                cwd=cig.ROOT,
                capture_output=True,
                text=True,
                check=False,
            )
            self.assertNotEqual(result.returncode, 0)
            self.assertIn("hash o byte divergenza", result.stderr)
            for path, payload in before.items():
                self.assertEqual(path.read_bytes(), payload)

    def test_hours_stay_hours_and_money_absent(self):
        self.assertEqual(self.data["units"]["money"], "nessuna — il dataset non contiene importi")
        self.assertEqual(self.data["units"]["hours"], "ore")
        self.assertEqual(self.data["coverage"]["observedRows"], 628)
        joined = " ".join(self.data["caveats"])
        self.assertRegex(joined, r"ore autorizzate")
        self.assertRegex(joined, r"NON euro")


if __name__ == "__main__":
    unittest.main()
