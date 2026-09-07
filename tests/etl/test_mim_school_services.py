"""Reconcile every school code and test municipal join failures without the hash gate."""

import copy
import csv
import io
import json
import tempfile
import unittest
from pathlib import Path

import mim_school_services as etl


class SchoolServicesTests(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        cls.spec = json.loads(etl.SPEC.read_text())
        cls.rows = etl.read_registry(cls.spec)
        cls.identities = etl.municipal_identities(cls.spec)

    def sample(self):
        spec = copy.deepcopy(self.spec)
        records = [dict(zip(spec["fixture"]["headers"], row, strict=True)) for row in [
            ["202627", "CAMPANIA", "BENEVENTO", "BNAA000001", "A783", "BENEVENTO", "SI"],
            ["202627", "CAMPANIA", "BENEVENTO", "BNAA000002", "A783", "BENEVENTO", "NO"],
            ["202627", "BASILICATA", "POTENZA", "PZAA000003", "B743", "CARBONE", "NO"],
        ]]
        spec["expected"] = {
            "sourceRecords": 3, "recordsByRegion": {"CAMPANIA": 2, "BASILICATA": 1},
            "siteFlags": {"SI": 1, "NO": 2}, "municipalities": 2, "municipalitiesWithSites": 1,
        }
        return records, spec

    def test_all_original_records_reproduce_committed_rows_and_receipt(self):
        payload = etl.projection(self.rows, self.identities, self.spec)
        etl.check_committed(self.spec, payload)
        rows = list(csv.DictReader(io.StringIO(payload.decode()), delimiter="|"))
        self.assertEqual(len(rows), 6648)
        self.assertEqual(sum(int(row["Sedi scolastiche statali"]) for row in rows), 39713)
        self.assertEqual(sum(int(row["Altri codici anagrafici"]) for row in rows), 10560)
        self.assertEqual(sum(row["Sedi scolastiche statali"] == "0" for row in rows), 130)
        self.assertNotIn("001019", {row["Codice ISTAT comune"] for row in rows})

    def test_counting_uses_unique_codes_and_literal_site_flag_not_names(self):
        rows, spec = self.sample()
        etl.validate_registry(rows, spec)
        # A name differs from the MEF identity; the exact cadastral/region join still succeeds.
        rows[0]["DESCRIZIONECOMUNE"] = rows[1]["DESCRIZIONECOMUNE"] = "OFFICIAL SOURCE NAME"
        result = etl.projection(rows, self.identities, spec).decode()
        self.assertIn("062008|A783|OFFICIAL SOURCE NAME|BENEVENTO|CAMPANIA|1|1", result)
        self.assertIn("076019|B743|CARBONE|POTENZA|BASILICATA|0|1", result)

    def test_duplicate_codes_missing_fields_year_flags_and_coverage_fail_closed(self):
        for field, value in [
            ("CODICESCUOLA", "BNAA000002"), ("CODICESCUOLA", "short"),
            ("CODICECOMUNESCUOLA", "062008"), ("SEDESCOLASTICA", ""),
            ("SEDESCOLASTICA", "YES"), ("ANNOSCOLASTICO", "202526"),
            ("REGIONE", "VALLE D'AOSTA"), ("PROVINCIA", ""),
        ]:
            with self.subTest(field=field, value=value), self.assertRaises(etl.SourceError):
                rows, spec = self.sample()
                rows[0][field] = value
                etl.validate_registry(rows, spec)
        rows, spec = self.sample()
        with self.assertRaisesRegex(etl.SourceError, "copertura"):
            etl.validate_registry(rows[:-1], spec)

    def test_unmapped_code_wrong_region_and_conflicting_geography_are_rejected(self):
        for field, value in [("CODICECOMUNESCUOLA", "Z999"), ("REGIONE", "LAZIO"), ("PROVINCIA", "NAPOLI")]:
            with self.subTest(field=field), self.assertRaises(etl.SourceError):
                rows, spec = self.sample()
                rows[0][field] = value
                etl.projection(rows, self.identities, spec)

    def test_reordered_or_missing_columns_and_extra_cells_fail_closed(self):
        for payload in [b"b,a\n1,2\n", b"a\n1\n", b"a,b\n1,2,3\n"]:
            with self.subTest(payload=payload), self.assertRaises(etl.SourceError):
                etl.csv_rows(payload, ["a", "b"])

    def test_byte_and_selected_cell_commitments_reject_drift(self):
        with tempfile.TemporaryDirectory() as directory:
            changed = Path(directory) / "source.csv"
            changed.write_bytes(b"changed source")
            with self.assertRaisesRegex(etl.SourceError, "byte sorgente"):
                etl.read_registry(self.spec, changed)
        changed = copy.deepcopy(self.spec)
        changed["fixture"]["selectedCells"]["sha256"] = "0" * 64
        with self.assertRaisesRegex(etl.SourceError, "celle selezionate"):
            etl.read_registry(changed)
        changed = copy.deepcopy(self.spec)
        changed["municipalJoin"]["sha256"] = "0" * 64
        with self.assertRaisesRegex(etl.SourceError, "byte sorgente"):
            etl.municipal_identities(changed)

    def test_fixture_retains_every_code_without_school_contacts_or_names(self):
        self.assertEqual(len(self.rows), 50273)
        self.assertEqual(set(self.rows[0]), set(self.spec["fixture"]["headers"]))
        self.assertNotIn("INDIRIZZOEMAILSCUOLA", self.rows[0])
        self.assertNotIn("DENOMINAZIONESCUOLA", self.rows[0])
        self.assertNotIn("INDIRIZZOSCUOLA", self.rows[0])


if __name__ == "__main__":
    unittest.main()
