"""BES_10-specific SDMX parsing, coverage and provenance checks, entirely offline."""
import copy
import csv
import io
import json
import tempfile
import unittest
from pathlib import Path

import istat_bes_ambiente as bes


class BesAmbienteTests(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        cls.spec = bes.load_spec()
        cls.data = json.loads(bes.DATA.read_bytes())
        cls.rows = []
        units = {item["code"]: item["unit"] for item in cls.spec["indicators"]}
        for observation in cls.data["observations"]:
            code, value = observation["indicator"], observation["valueHundredths"]
            row = {key: values[0] for key, values in cls.spec["attributes"].items()}
            row.update(cls.spec["fixedDimensions"])
            if value is None:
                obs_value = ""
            else:
                obs_value = f"{value // 100}.{value % 100:02d}".rstrip("0").rstrip(".")
                if obs_value == "":
                    obs_value = "0"
            descr = "" if code == "10AMB018P" else code
            source = "" if code == "10AMB018P" else code + "_SOU"
            row.update(DATA_TYPE=code, REF_AREA=observation["territory"], SEX=observation["sex"],
                       TIME_PERIOD=str(observation["year"]), UNIT_MEAS=units[code],
                       NOTE_DATA_TYPE_DESCR=descr, NOTE_DATA_TYPE_SOURCE=source,
                       OBS_STATUS=observation["status"] or "", OBS_VALUE=obs_value)
            cls.rows.append(row)

    def payload(self, mutate=None):
        rows = [dict(row) for row in self.rows]
        if mutate:
            mutate(rows)
        output = io.StringIO()
        writer = csv.DictWriter(output, fieldnames=self.spec["headers"])
        writer.writeheader()
        writer.writerows(rows)
        return output.getvalue().encode()

    def test_committed_bundle_and_parser_roundtrip(self):
        bes.check()
        self.assertEqual(bes.build_data(self.payload(), self.spec), self.data)

    def test_domain_units_and_edition_are_locked(self):
        for column, bad in [("UNIT_MEAS", "EURO"), ("DOMAIN", "BES_12"), ("EDITION", "2024"),
                            ("DATAFLOW", "IT1:DF_BES_TERRIT_12(1.0)")]:
            with self.subTest(column=column), self.assertRaises(bes.SnapshotError):
                bes.build_data(self.payload(lambda rows: rows[0].update({column: bad})), self.spec)

    def test_null_unknown_absent_row_and_observed_zero_stay_distinct(self):
        flagged = [row for row in self.data["observations"] if row["status"]]
        self.assertEqual(len(flagged), 412)
        self.assertEqual({row["status"] for row in flagged}, {"g"})
        self.assertEqual(bes.value_hundredths("0"), 0)
        self.assertEqual(bes.value_hundredths("1.65"), 165)
        synthetic = self.payload(lambda rows: rows[0].update(OBS_VALUE="0.00"))
        parsed = bes.build_data(synthetic, self.spec)
        self.assertEqual(parsed["observations"][0]["valueHundredths"], 0)
        for raw, flag in [("0", "g"), ("", ""), ("1.65", "n")]:
            with self.subTest(raw=raw, flag=flag), self.assertRaises(bes.SnapshotError):
                bes.build_data(self.payload(lambda rows: rows[0].update(OBS_VALUE=raw, OBS_STATUS=flag)), self.spec)

    def test_unpublished_sex_series_fail_closed(self):
        with self.assertRaises(bes.SnapshotError):
            bes.build_data(self.payload(lambda rows: rows[0].update(SEX="F")), self.spec)

    def test_coverage_geography_duplicate_and_missing_cells_fail_closed(self):
        for mutate in [lambda rows: rows[0].update(REF_AREA="015146"),
                       lambda rows: rows.append(rows[0]), lambda rows: rows.pop()]:
            with self.assertRaises(bes.SnapshotError):
                bes.build_data(self.payload(mutate), self.spec)

    def test_no_economic_or_sex_reconciliation_is_applied(self):
        data = copy.deepcopy(self.data)
        total = next(row for row in data["observations"] if row["valueHundredths"] is not None)
        total["valueHundredths"] = 9999
        bes.validate_data(data, self.spec)
        self.assertFalse(data["reconciliation"]["totalBetweenSexes"])
        self.assertFalse(data["reconciliation"]["territorialSum"])

    def test_metadata_and_data_tampering_fail_closed(self):
        with tempfile.TemporaryDirectory() as directory:
            data_path, meta_path = Path(directory) / "data.json", Path(directory) / "meta.json"
            data_path.write_bytes(bes.DATA.read_bytes())
            meta = json.loads(bes.META.read_bytes())
            meta["source"]["licenseId"] = "CC-BY-4.0"
            meta_path.write_text(json.dumps(meta))
            with self.assertRaises(bes.SnapshotError):
                bes.check(bes.SPEC, data_path, meta_path)


if __name__ == "__main__":
    unittest.main()
