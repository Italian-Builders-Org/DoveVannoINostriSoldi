"""Offline checks for the INPS Assegno Unico snapshot."""

from __future__ import annotations

import copy
import json
import subprocess
import sys
import tempfile
import unittest
from pathlib import Path

import inps_assegno_unico_snapshot as auu


class InpsAssegnoUnicoTests(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        cls.spec = auu.load_spec()
        cls.data = json.loads(auu.DEFAULT_DATA.read_bytes())

    def test_committed_bundle_reprojects(self):
        auu.check()

    def test_write_rejects_unlocked_csv(self):
        with tempfile.TemporaryDirectory() as directory:
            root = Path(directory)
            fixture_dir = root / "fixtures"
            fixture_dir.mkdir()
            for asset in self.spec["source"]["assets"].values():
                src = auu.ROOT / asset["path"]
                dest = fixture_dir / Path(asset["path"]).name
                dest.write_bytes(src.read_bytes() + b"\n")
            spec_path = root / "source.json"
            data_path = root / "data.json"
            meta_path = root / "meta.json"
            spec_path.write_bytes(auu.DEFAULT_SPEC.read_bytes())
            data_path.write_bytes(b"previous")
            meta_path.write_bytes(b"previous")
            before = {path: path.read_bytes() for path in (spec_path, data_path, meta_path)}
            result = subprocess.run(
                [
                    sys.executable,
                    str(Path(auu.__file__)),
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
                capture_output=True,
                text=True,
                timeout=30,
            )
            self.assertNotEqual(result.returncode, 0)
            self.assertEqual({path: path.read_bytes() for path in before}, before)

    def test_millesimi_and_rdc_caveat(self):
        self.assertEqual(self.data["units"]["money"], "euro-millesimi")
        self.assertEqual(self.data["coverage"]["observedRows"], 4452)
        self.assertTrue(any("RdC" in item for item in self.data["caveats"]))
        row = next(
            item
            for item in self.data["observations"]
            if item["table"] == "nuclei" and item["province"] == "Alessandria" and item["year"] == 2022
            and item["childrenDisabilityFlag"] == 0
        )
        self.assertEqual(row["amountMilli"], 63_373_750_930)

    def test_tampered_data_fail_closed(self):
        broken = copy.deepcopy(self.data)
        broken["observations"][0]["amountMilli"] += 1
        with tempfile.TemporaryDirectory() as directory:
            data_path = Path(directory) / "data.json"
            meta_path = Path(directory) / "meta.json"
            data_path.write_bytes(auu.canonical_bytes(broken))
            meta_path.write_bytes(auu.DEFAULT_META.read_bytes())
            with self.assertRaises(auu.SnapshotError):
                auu.check(data_path=data_path, meta_path=meta_path)


if __name__ == "__main__":
    unittest.main()
