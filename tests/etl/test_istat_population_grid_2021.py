#!/usr/bin/env python3
from __future__ import annotations

import json
import shutil
import tempfile
import unittest
from pathlib import Path

from istat_population_grid_2021 import SnapshotError, load_spec, main, validate_committed

ROOT = Path(__file__).resolve().parents[2]


class IstatPopulationGrid2021Test(unittest.TestCase):
    def test_source_lock_and_committed_bundle(self) -> None:
        spec = load_spec()
        self.assertEqual(spec["datasetId"], "istat-population-grid-2021")
        self.assertIs(spec["semantics"]["soldi"]["present"], False)
        self.assertEqual(spec["source"]["licenseId"], "not-declared")
        validate_committed(spec)
        self.assertEqual(main(["--check"]), 0)

    def test_check_rejects_pin_drift(self) -> None:
        data_path = ROOT / "src/data/generated/istat-population-grid-2021.data.json"
        meta_path = ROOT / "src/data/generated/istat-population-grid-2021.meta.json"
        with tempfile.TemporaryDirectory() as tmp:
            tmp_root = Path(tmp)
            data_copy = tmp_root / data_path.name
            meta_copy = tmp_root / meta_path.name
            shutil.copyfile(data_path, data_copy)
            shutil.copyfile(meta_path, meta_copy)
            payload = json.loads(data_copy.read_text(encoding="utf-8"))
            payload["totals"]["residentPopulation"] += 1
            data_copy.write_text(json.dumps(payload), encoding="utf-8")
            with self.assertRaises(SnapshotError):
                validate_committed(load_spec(), data_copy, meta_copy)


if __name__ == "__main__":
    unittest.main()
