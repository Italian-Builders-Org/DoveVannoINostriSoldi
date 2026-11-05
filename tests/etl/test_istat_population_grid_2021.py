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
        committed_data = ROOT / "src/data/generated/istat-population-grid-2021.data.json"
        committed_meta = ROOT / "src/data/generated/istat-population-grid-2021.meta.json"
        before = (committed_data.read_bytes(), committed_meta.read_bytes())
        # The drift is applied to a copy: the committed artifacts are never written.
        with tempfile.TemporaryDirectory() as tmp:
            data_path = Path(tmp) / committed_data.name
            meta_path = Path(tmp) / committed_meta.name
            shutil.copyfile(committed_meta, meta_path)
            payload = json.loads(committed_data.read_text(encoding="utf-8"))
            payload["totals"]["residentPopulation"] += 1
            data_path.write_text(json.dumps(payload), encoding="utf-8")
            with self.assertRaises(SnapshotError):
                validate_committed(load_spec(), data_path, meta_path)
        self.assertEqual((committed_data.read_bytes(), committed_meta.read_bytes()), before)


if __name__ == "__main__":
    unittest.main()
