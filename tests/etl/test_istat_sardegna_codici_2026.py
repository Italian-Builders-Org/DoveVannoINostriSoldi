"""Offline checks for the source-locked ISTAT 2026 Sardinian code crosswalk."""

from __future__ import annotations

import copy
import json
import tempfile
import unittest
from pathlib import Path

import istat_sardegna_codici_2026 as crosswalk


class IstatSardegnaCodici2026Tests(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        cls.spec = crosswalk.load_spec()
        cls.rows = crosswalk.parse_rows(crosswalk.verified_csv(cls.spec), cls.spec)

    def test_committed_table_is_the_reprojection_of_the_locked_istat_file(self):
        crosswalk.check()

    def test_documented_cases_match_the_official_table(self):
        by_code = {row[0]: row for row in self.rows}
        self.assertEqual(by_code["119014"][:3], ["119014", "111054", "Perdaxius"])
        self.assertEqual(by_code["119009"][:3], ["119009", "111035", "Iglesias"])
        # Città metropolitana di Cagliari: provincia 318, Comuni 118xxx, precedenti 292/092xxx.
        cagliari = next(row for row in self.rows if row[2] == "Cagliari")
        self.assertEqual((cagliari[0][:3], cagliari[3], cagliari[1][:3], cagliari[4]), ("118", "318", "092", "292"))

    def test_altered_archive_bytes_fail_closed(self):
        source = crosswalk.ROOT / self.spec["source"]["path"]
        with tempfile.TemporaryDirectory() as directory:
            tampered = Path(directory) / "tampered.zip"
            payload = bytearray(source.read_bytes())
            payload[len(payload) // 2] ^= 0xFF
            tampered.write_bytes(bytes(payload))
            with self.assertRaisesRegex(crosswalk.CrosswalkError, "SHA-256"):
                crosswalk.verified_csv(self.spec, tampered)

    def test_duplicate_previous_code_fails_closed(self):
        rows = copy.deepcopy(self.rows)
        rows[1][1] = rows[0][1]
        with self.assertRaisesRegex(crosswalk.CrosswalkError, "duplicati"):
            crosswalk.validate_rows(rows, self.spec)

    def test_new_code_reused_as_previous_code_fails_closed(self):
        rows = copy.deepcopy(self.rows)
        rows[1][1] = rows[0][0]
        with self.assertRaisesRegex(crosswalk.CrosswalkError, "coincide"):
            crosswalk.validate_rows(rows, self.spec)

    def test_missing_municipality_fails_closed(self):
        with self.assertRaisesRegex(crosswalk.CrosswalkError, "376 Comuni"):
            crosswalk.validate_rows(self.rows[:-1], self.spec)

    def test_pair_not_confirmed_by_situas_tax_code_fails_closed(self):
        geography = json.loads(crosswalk.DEFAULT_GEOGRAPHY.read_text(encoding="utf-8"))
        tax_index = geography["columns"].index("taxCode")
        year_2026 = next(year for year in geography["years"] if year["year"] == 2026)
        row = next(item for item in year_2026["rows"] if item[0] == "119014")
        row[tax_index] = "00000000000"
        with tempfile.TemporaryDirectory() as directory:
            path = Path(directory) / "geography.json"
            path.write_text(json.dumps(geography), encoding="utf-8")
            with self.assertRaisesRegex(crosswalk.CrosswalkError, "111054->119014"):
                crosswalk.reconcile_with_geography(self.rows, path)

    def test_swapped_pair_fails_closed_against_situas(self):
        rows = copy.deepcopy(self.rows)
        first, second = rows[0][1], rows[1][1]
        rows[0][1], rows[1][1] = second, first
        with self.assertRaisesRegex(crosswalk.CrosswalkError, "codice fiscale diverso"):
            crosswalk.reconcile_with_geography(rows)


if __name__ == "__main__":
    unittest.main()
