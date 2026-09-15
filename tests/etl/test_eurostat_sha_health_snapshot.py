"""Offline checks for the Eurostat SHA health-financing snapshot."""

from __future__ import annotations

import copy
import json
import subprocess
import sys
import tempfile
import unittest
from pathlib import Path

import eurostat_sha_health_snapshot as sha


class EurostatShaHealthTests(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        cls.spec = sha.load_spec()
        cls.data = json.loads(sha.DEFAULT_DATA.read_bytes())

    def test_committed_bundle_and_fixture_reprojection(self):
        sha.check()

    def test_write_rejects_unlocked_input_without_changing_outputs(self):
        with tempfile.TemporaryDirectory() as directory:
            root = Path(directory)
            spec_path, data_path, meta_path = [root / name for name in ("source.json", "data.json", "meta.json")]
            spec_path.write_bytes(sha.DEFAULT_SPEC.read_bytes())
            data_path.write_bytes(b"previous data")
            meta_path.write_bytes(b"previous metadata")
            before = {path: path.read_bytes() for path in (spec_path, data_path, meta_path)}
            fixture = root / "changed.json"
            fixture.write_bytes(sha.verified_payload(self.spec) + b"\n")
            result = subprocess.run([
                sys.executable, str(Path(sha.__file__)), "--write", "--spec", str(spec_path),
                "--data", str(data_path), "--meta", str(meta_path), "--input", str(fixture),
            ], capture_output=True, text=True, timeout=30)
            self.assertNotEqual(result.returncode, 0)
            self.assertEqual({path: path.read_bytes() for path in before}, before)

    def test_oop_2024_and_provisional_2025(self):
        row_2024 = next(
            item for item in self.data["observations"]
            if item["scheme"] == "HF3" and item["year"] == 2024
        )
        self.assertEqual(row_2024["amountCents"], 42_791 * 100_000_000)
        self.assertIsNone(row_2024["flag"])
        total_2025 = next(
            item for item in self.data["observations"]
            if item["scheme"] == "TOT_HF" and item["year"] == 2025
        )
        self.assertEqual(total_2025["amountCents"], 190_117 * 100_000_000)
        self.assertEqual(total_2025["flag"], "p")

    def test_tampered_total_fail_closed(self):
        broken = copy.deepcopy(self.data)
        row = next(
            item for item in broken["observations"]
            if item["scheme"] == "TOT_HF" and item["year"] == 2024
        )
        row["amountCents"] += 1
        with tempfile.TemporaryDirectory() as directory:
            data_path = Path(directory) / "data.json"
            meta_path = Path(directory) / "meta.json"
            data_path.write_bytes(sha.canonical_bytes(broken))
            meta_path.write_bytes(sha.DEFAULT_META.read_bytes())
            with self.assertRaises(sha.SnapshotError):
                sha.check(data_path=data_path, meta_path=meta_path)


if __name__ == "__main__":
    unittest.main()
