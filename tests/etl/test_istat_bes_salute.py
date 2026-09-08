"""Health-specific SDMX parsing, coverage and provenance checks, entirely offline."""
import copy
import csv
import io
import json
import tempfile
import unittest
from pathlib import Path

import istat_bes_salute as bes


class BesSaluteTests(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        cls.spec = bes.load_spec()
        cls.data = json.loads(bes.DATA.read_bytes())
        cls.rows = []
        units = {i["code"]: i["unit"] for i in cls.spec["indicators"]}
        for observation in cls.data["observations"]:
            code, value = observation["indicator"], observation["valueTenths"]
            row = {key: values[0] for key, values in cls.spec["attributes"].items()}
            row.update(cls.spec["fixedDimensions"])
            row.update(DATA_TYPE=code, REF_AREA=observation["territory"], SEX=observation["sex"],
                       TIME_PERIOD=str(observation["year"]), UNIT_MEAS=units[code],
                       NOTE_DATA_TYPE_DESCR=code, NOTE_DATA_TYPE_SOURCE=code + "_SOU",
                       OBS_STATUS=observation["status"] or "",
                       OBS_VALUE="" if value is None else f"{value // 10}.{value % 10}")
            cls.rows.append(row)

    def payload(self, mutate=None):
        rows = [dict(row) for row in self.rows]
        if mutate:
            mutate(rows)
        out = io.StringIO()
        writer = csv.DictWriter(out, fieldnames=self.spec["headers"])
        writer.writeheader()
        writer.writerows(rows)
        return out.getvalue().encode()

    def test_committed_bundle_and_parser_roundtrip(self):
        bes.check()
        self.assertEqual(bes.build_data(self.payload(), self.spec), self.data)

    def test_units_edition_and_domain_are_not_economic_defaults(self):
        for column, bad in [("UNIT_MEAS", "EURO"), ("DOMAIN", "BES_04"), ("EDITION", "2024"),
                            ("DATAFLOW", "IT1:DF_BES_TERRIT_4(1.0)")]:
            with self.subTest(column=column), self.assertRaises(bes.SnapshotError):
                bes.build_data(self.payload(lambda rows: rows[0].update({column: bad})), self.spec)

    def test_null_significance_and_observed_zero_stay_distinct(self):
        flagged = [r for r in self.data["observations"] if r["status"]]
        self.assertEqual(len(flagged), 1)
        self.assertIsNone(flagged[0]["valueTenths"])
        self.assertEqual(flagged[0]["status"], "n")
        self.assertTrue(any(r["valueTenths"] == 0 and r["status"] is None for r in self.data["observations"]))
        for raw, flag in [("0", "n"), ("", ""), ("", "g"), ("", "c")]:
            with self.subTest(raw=raw, flag=flag), self.assertRaises(bes.SnapshotError):
                bes.build_data(self.payload(lambda rows: rows[0].update(OBS_VALUE=raw, OBS_STATUS=flag)), self.spec)

    def test_unknown_territory_duplicate_and_missing_cells_fail(self):
        for mutate in [lambda rows: rows[0].update(REF_AREA="ITG2A"),
                       lambda rows: rows.append(rows[0]), lambda rows: rows.pop()]:
            with self.assertRaises(bes.SnapshotError):
                bes.build_data(self.payload(mutate), self.spec)

    def test_health_does_not_apply_total_between_sexes(self):
        data = copy.deepcopy(self.data)
        total = next(r for r in data["observations"] if r["sex"] == "T")
        total["valueTenths"] = 100000
        # A synthetic outlier is not rejected as an economic average. Its bytes
        # still cannot be published under the committed artifact hash.
        bes.validate_data(data, self.spec)
        self.assertNotEqual(bes.sha256_bytes(bes.canonical_bytes(data)), self.spec["integrity"]["dataArtifact"]["sha256"])
        self.assertFalse(data["reconciliation"]["totalBetweenSexes"])

    def test_contract_detects_metadata_and_data_tampering(self):
        with tempfile.TemporaryDirectory() as directory:
            data_path, meta_path = Path(directory) / "data.json", Path(directory) / "meta.json"
            data_path.write_bytes(bes.DATA.read_bytes())
            meta = json.loads(bes.META.read_bytes())
            meta["source"]["licenseId"] = "CC-BY-4.0"
            meta_path.write_text(json.dumps(meta))
            with self.assertRaises(bes.SnapshotError):
                bes.check(bes.SPEC, data_path, meta_path)
            meta_path.write_bytes(bes.META.read_bytes())
            changed = copy.deepcopy(self.data)
            changed["observations"][0]["valueTenths"] += 1
            data_path.write_bytes(bes.canonical_bytes(changed))
            with self.assertRaises(bes.SnapshotError):
                bes.check(bes.SPEC, data_path, meta_path)

    def test_exact_decimal_rejects_nonfinite_negative_or_precision_loss(self):
        self.assertEqual(bes.value_tenths("0"), 0)
        self.assertEqual(bes.value_tenths("82.3"), 823)
        for raw in ["NaN", "Infinity", "-1", "1.23", "n.d."]:
            with self.subTest(raw=raw), self.assertRaises(bes.SnapshotError):
                bes.value_tenths(raw)


if __name__ == "__main__":
    unittest.main()
