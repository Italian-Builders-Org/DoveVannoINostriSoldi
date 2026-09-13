"""Offline checks for the MEF national tax-gap snapshot."""

from __future__ import annotations

import copy
import json
import tempfile
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
        payload = gap.verified_payload(self.spec)
        gap_rows, prop_rows, _, _ = gap.extract_tables(self.spec, payload)
        rebuilt = gap.build_data(gap_rows, prop_rows)
        self.assertEqual(gap.canonical_bytes(rebuilt), gap.canonical_bytes(self.data))

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
