"""Offline checks for the ISTAT building-permits national intro snapshot."""

from __future__ import annotations

import copy
import json
import tempfile
import unittest
from pathlib import Path

import istat_permessi_costruire_snapshot as permessi


class IstatPermessiCostruireTests(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        cls.spec = permessi.load_spec()
        cls.data = json.loads(permessi.DEFAULT_DATA.read_bytes())

    def test_committed_bundle_and_zip_reprojection(self):
        permessi.check()
        payload = permessi.verified_zip(self.spec)
        rebuilt = permessi.build_data(payload, self.spec)
        self.assertEqual(permessi.canonical_bytes(rebuilt), permessi.canonical_bytes(self.data))

    def test_2025_pins_match_intro_tables(self):
        a1 = next(row for row in self.data["tables"]["a1"]["years"] if row["year"] == 2025)
        self.assertEqual(a1["fabbricati"]["numero"]["value"], 16070)
        self.assertEqual(a1["abitazioni"]["numero"]["value"], 51908)
        a3 = next(row for row in self.data["tables"]["a3"]["years"] if row["year"] == 2025)
        self.assertEqual(a3["sectors"]["totale"]["fabbricati"]["value"], 7544)

    def test_soldi_absent_and_four_distinct_tables(self):
        self.assertIs(self.data["soldi"]["present"], False)
        self.assertEqual(set(self.data["tables"]), {"a1", "a2", "a3", "a4"})
        self.assertEqual(self.data["tables"]["a1"]["kind"], "nuova-edilizia-residenziale")
        self.assertEqual(self.data["tables"]["a3"]["kind"], "nuova-edilizia-non-residenziale")

    def test_tampered_cell_fail_closed(self):
        broken = copy.deepcopy(self.data)
        year_2025 = next(row for row in broken["tables"]["a1"]["years"] if row["year"] == 2025)
        year_2025["fabbricati"]["numero"]["value"] += 1
        with self.assertRaises(permessi.SnapshotError):
            permessi.validate_data(broken, self.spec)
        with tempfile.TemporaryDirectory() as directory:
            data_path = Path(directory) / "data.json"
            meta_path = Path(directory) / "meta.json"
            data_path.write_bytes(permessi.DEFAULT_DATA.read_bytes())
            meta_path.write_bytes(permessi.DEFAULT_META.read_bytes())
            data_path.write_bytes(permessi.canonical_bytes(broken))
            with self.assertRaises(permessi.SnapshotError):
                permessi.check(data_path=data_path, meta_path=meta_path)


if __name__ == "__main__":
    unittest.main()
