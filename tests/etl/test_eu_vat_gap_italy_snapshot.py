"""Offline checks for the DG TAXUD VAT gap Italy snapshot."""

from __future__ import annotations

import copy
import json
import tempfile
import unittest
from pathlib import Path

import eu_vat_gap_italy_snapshot as vat


class EuVatGapItalyTests(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        cls.spec = vat.load_spec()
        cls.data = json.loads(vat.DEFAULT_DATA.read_bytes())

    def test_committed_bundle_and_workbook_reprojection(self):
        vat.check()
        payload = vat.verified_payload(self.spec)
        cells = vat.workbook_italy_cells(payload, self.spec)
        rebuilt = vat.build_data(cells, self.spec)
        self.assertEqual(vat.canonical_bytes(rebuilt), vat.canonical_bytes(self.data))

    def test_vttl_minus_revenue_equals_gap_exactly(self):
        for year in self.data["years"]:
            vttl = year["vttlCents"]["value"]
            revenue = year["vatRevenueCents"]["value"]
            gap = year["complianceGapCents"]["value"]
            self.assertEqual(year["vttlCents"]["status"], "observed")
            self.assertEqual(year["vatRevenueCents"]["status"], "observed")
            self.assertEqual(year["complianceGapCents"]["status"], "observed")
            self.assertEqual(vttl - revenue, gap)

    def test_2024_is_rapid_estimate_and_composition_unavailable(self):
        year = next(row for row in self.data["years"] if row["year"] == 2024)
        self.assertEqual(year["estimateKind"], "rapid-estimate")
        self.assertEqual(year["sourceYearLabel"], "2024 (e)")
        for component in year["vttlComposition"]:
            self.assertEqual(component["amountCents"]["status"], "unavailable")
            self.assertIsNone(component["amountCents"]["value"])

    def test_million_euro_to_cents_and_share_scale(self):
        year = next(row for row in self.data["years"] if row["year"] == 2019)
        self.assertEqual(year["vttlCents"]["value"], 14_083_200_000_000)
        self.assertEqual(year["complianceGapShareMillionths"]["value"], 193_000)
        change = self.data["gapChangeSince2019"]
        self.assertEqual(change["asOfYear"], 2023)
        self.assertEqual(change["valueTenthsOfPp"]["value"], -42)

    def test_tampered_gap_or_license_inference_fail_closed(self):
        broken = copy.deepcopy(self.data)
        broken["years"][0]["complianceGapCents"]["value"] += 1
        with self.assertRaises(vat.SnapshotError):
            vat.validate_data(broken, self.spec)
        with tempfile.TemporaryDirectory() as directory:
            data_path = Path(directory) / "data.json"
            meta_path = Path(directory) / "meta.json"
            data_path.write_bytes(vat.DEFAULT_DATA.read_bytes())
            meta_path.write_bytes(vat.DEFAULT_META.read_bytes())
            data_path.write_bytes(vat.canonical_bytes(broken))
            with self.assertRaises(vat.SnapshotError):
                vat.check(data_path=data_path, meta_path=meta_path)


if __name__ == "__main__":
    unittest.main()
