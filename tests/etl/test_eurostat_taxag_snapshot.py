"""Offline checks for the Eurostat gov_10a_taxag snapshot."""

from __future__ import annotations

import copy
import json
import subprocess
import sys
import tempfile
import unittest
from pathlib import Path

import eurostat_taxag_snapshot as taxag


class EurostatTaxagTests(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        cls.spec = taxag.load_spec()
        cls.data = json.loads(taxag.DEFAULT_DATA.read_bytes())

    def test_committed_bundle_and_fixture_reprojection(self):
        taxag.check()

    def test_write_rejects_unlocked_input_without_changing_outputs(self):
        with tempfile.TemporaryDirectory() as directory:
            root = Path(directory)
            spec_path, data_path, meta_path = [root / name for name in ("source.json", "data.json", "meta.json")]
            spec_path.write_bytes(taxag.DEFAULT_SPEC.read_bytes())
            data_path.write_bytes(b"previous data")
            meta_path.write_bytes(b"previous metadata")
            before = {path: path.read_bytes() for path in (spec_path, data_path, meta_path)}
            fixture = root / "changed.json"
            fixture.write_bytes(taxag.verified_payload(self.spec) + b"\n")
            result = subprocess.run([
                sys.executable, str(Path(taxag.__file__)), "--write", "--spec", str(spec_path),
                "--data", str(data_path), "--meta", str(meta_path), "--input", str(fixture),
            ], capture_output=True, text=True, timeout=30)
            self.assertNotEqual(result.returncode, 0)
            self.assertEqual({path: path.read_bytes() for path in before}, before)

    def test_vat_2025_s13_and_scales(self):
        row = next(
            item for item in self.data["observations"]
            if item["naItem"] == "D211" and item["sector"] == "S13" and item["year"] == 2025
        )
        self.assertEqual(row["status"], "observed")
        self.assertEqual(row["amountCents"], 150_384 * 100_000_000)

    def test_s1314_tax_total_absent(self):
        row = next(
            item for item in self.data["observations"]
            if item["naItem"] == "D2_D5_D91" and item["sector"] == "S1314" and item["year"] == 2025
        )
        self.assertEqual(row["status"], "absent")
        self.assertIsNone(row["amountCents"])

    def test_tampered_amount_fail_closed(self):
        broken = copy.deepcopy(self.data)
        row = next(
            item for item in broken["observations"]
            if item["naItem"] == "D211" and item["sector"] == "S13" and item["year"] == 2025
        )
        row["amountCents"] += 1
        with tempfile.TemporaryDirectory() as directory:
            data_path = Path(directory) / "data.json"
            meta_path = Path(directory) / "meta.json"
            data_path.write_bytes(taxag.canonical_bytes(broken))
            meta_path.write_bytes(taxag.DEFAULT_META.read_bytes())
            with self.assertRaises(taxag.SnapshotError):
                taxag.check(data_path=data_path, meta_path=meta_path)


if __name__ == "__main__":
    unittest.main()
