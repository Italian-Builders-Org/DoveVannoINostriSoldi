"""Offline checks for Consip program bandi projection."""

import csv
import io
import json
import unittest

import consip_bandi_programma as etl


class ConsipBandiProgrammaTests(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        cls.spec = json.loads(etl.SPEC.read_text(encoding="utf-8"))

    def test_committed_csv_projection(self):
        payload = etl.projection(etl.read_rows(self.spec), self.spec)
        rows = list(csv.DictReader(io.StringIO(payload.decode()), delimiter="|"))
        self.assertEqual(len(rows), 1839)
        self.assertTrue(all(row["URL dataset"] == "https://dati.consip.it/dataset/dataset-bandi-e-gare" for row in rows))

    def test_amount_parse_rejects_invalid_values(self):
        rows = etl.read_rows(self.spec)
        rows[0]["Base_Asta"] = "non-numero"
        with self.assertRaises(etl.SourceError):
            etl.projection(rows, self.spec)


if __name__ == "__main__":
    unittest.main()
