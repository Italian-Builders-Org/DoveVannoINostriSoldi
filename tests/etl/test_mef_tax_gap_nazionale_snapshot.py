"""Offline checks for the MEF national tax-gap snapshot."""

from __future__ import annotations

import copy
import json
import tempfile
import subprocess
import sys
import unittest
from pathlib import Path

import mef_tax_gap_nazionale_snapshot as gap


class MefTaxGapNazionaleTests(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        cls.spec = gap.load_spec()
        cls.data = json.loads(gap.DEFAULT_DATA.read_bytes())

    def test_committed_bundle_and_pdf_reprojection(self):
        gap.check()

    def test_write_rejects_unlocked_input_without_changing_outputs(self):
        with tempfile.TemporaryDirectory() as directory:
            root = Path(directory)
            spec_path, data_path, meta_path = [root / name for name in ("source.json", "data.json", "meta.json")]
            spec_path.write_bytes(gap.DEFAULT_SPEC.read_bytes())
            data_path.write_bytes(b"previous data")
            meta_path.write_bytes(b"previous metadata")
            before = {path: path.read_bytes() for path in (spec_path, data_path, meta_path)}
            pdf_path = root / "changed.pdf"
            pdf_path.write_bytes(gap.verified_payload(self.spec) + b"\nchanged source bytes\n")
            result = subprocess.run([
                sys.executable, str(Path(gap.__file__)), "--write", "--spec", str(spec_path),
                "--data", str(data_path), "--meta", str(meta_path), "--input", str(pdf_path),
            ], capture_output=True, text=True, timeout=30)
            self.assertNotEqual(result.returncode, 0)
            self.assertEqual({path: path.read_bytes() for path in before}, before)

    def test_iva_2022_and_scales(self):
        iva = next(row for row in self.data["taxRows"] if row["id"] == "iva")
        year = next(item for item in iva["series"] if item["year"] == 2022)
        self.assertEqual(year["gap"]["valueCents"], 28_966 * 100_000_000)
        self.assertEqual(year["propensione"]["valueTenthsPp"], 184)

    def test_range_forks_and_absent_propensione_on_contributive(self):
        total = next(
            row for row in self.data["taxRows"]
            if row["id"] == "totale-entrate-tributarie-e-contributive"
        )
        year = next(item for item in total["series"] if item["year"] == 2022)
        self.assertEqual(year["gap"]["shape"], "range")
        self.assertEqual(year["gap"]["minCents"], 98_123 * 100_000_000)
        self.assertEqual(year["gap"]["maxCents"], 102_482 * 100_000_000)
        self.assertEqual(year["propensione"]["status"], "absent")

    def test_tampered_gap_fail_closed(self):
        broken = copy.deepcopy(self.data)
        iva = next(row for row in broken["taxRows"] if row["id"] == "iva")
        iva["series"][0]["gap"]["valueCents"] += 1
        with tempfile.TemporaryDirectory() as directory:
            data_path = Path(directory) / "data.json"
            meta_path = Path(directory) / "meta.json"
            data_path.write_bytes(gap.artifact_bytes(broken))
            meta_path.write_bytes(gap.DEFAULT_META.read_bytes())
            with self.assertRaises(gap.SnapshotError):
                gap.check(data_path=data_path, meta_path=meta_path)


if __name__ == "__main__":
    unittest.main()
