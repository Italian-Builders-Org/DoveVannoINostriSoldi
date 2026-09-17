"""Absolute poverty monetary threshold SDMX parsing and provenance checks, offline."""
import copy
import csv
import io
import json
import tempfile
import unittest
from pathlib import Path

import istat_poverta_soglia_assoluta as soglia


def format_hundredths(value: int) -> str:
    text = f"{value // 100}.{value % 100:02d}".rstrip("0").rstrip(".")
    return text or "0"


class PovertaSogliaAssolutaTests(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        cls.spec = soglia.load_spec()
        cls.data = json.loads(soglia.DATA.read_bytes())
        cls.rows = []
        for observation in cls.data["observations"]:
            row = {key: values[0] for key, values in cls.spec["attributes"].items()}
            row.update(cls.spec["fixedDimensions"])
            value = observation["valueHundredths"]
            row.update(
                REF_AREA=observation["territory"],
                HOUSEHOLD_TYPOLOGY=observation["householdTypology"],
                MUNICIPALITY_SIZE=observation["municipalitySize"],
                TIME_PERIOD=str(observation["year"]),
                OBS_STATUS="",
                OBS_VALUE="" if value is None else format_hundredths(value),
            )
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
        soglia.check()
        self.assertEqual(soglia.build_data(self.payload(), self.spec), self.data)

    def test_fixed_dimensions_and_empty_unit_are_locked(self):
        for column, bad in [
            ("UNIT_MEAS", "EURO"),
            ("DATA_TYPE", "SOGLIA_POVREL"),
            ("MEASURE", "9"),
            ("DATAFLOW", "IT1:34_212(1.0)"),
        ]:
            with self.subTest(column=column), self.assertRaises(soglia.SnapshotError):
                soglia.build_data(self.payload(lambda rows: rows[0].update({column: bad})), self.spec)

    def test_empty_obs_value_stays_null_not_zero(self):
        self.assertEqual(len(self.spec["nullCells"]), 6050)
        self.assertEqual(
            sum(1 for row in self.data["observations"] if row["valueHundredths"] is None),
            6050,
        )
        self.assertTrue(all(row["status"] is None for row in self.data["observations"]))
        self.assertEqual(soglia.value_hundredths("735.82"), 73582)
        self.assertEqual(soglia.value_hundredths("0"), 0)
        with self.assertRaises(soglia.SnapshotError):
            soglia.value_hundredths("-1")
        with self.assertRaises(soglia.SnapshotError):
            soglia.value_hundredths("1.234")
        with self.assertRaises(soglia.SnapshotError):
            soglia.build_data(
                self.payload(lambda rows: rows[0].update(OBS_VALUE="0", OBS_STATUS="n")),
                self.spec,
            )

    def test_soldi_present_and_coverage_locked(self):
        self.assertIs(self.spec["semantics"]["soldi"]["present"], True)
        self.assertEqual(self.data["scale"]["factor"], 100)
        self.assertEqual(len(self.data["territories"]), 23)
        self.assertEqual(len(self.data["householdTypologies"]), 83)
        self.assertEqual(len(self.data["municipalitySizes"]), 6)
        composites = {item["code"]: item for item in self.data["territories"] if item["kind"] == "composite"}
        self.assertEqual(set(composites), {"ITCD", "ITFG"})
        self.assertEqual(composites["ITCD"]["parts"], ["ITC", "ITD"])

    def test_geography_duplicate_and_missing_cells_fail_closed(self):
        for mutate in [
            lambda rows: rows[0].update(REF_AREA="IT"),
            lambda rows: rows.append(rows[0]),
            lambda rows: rows.pop(),
        ]:
            with self.assertRaises(soglia.SnapshotError):
                soglia.build_data(self.payload(mutate), self.spec)

    def test_no_sum_reconciliation_is_applied(self):
        data = copy.deepcopy(self.data)
        total = next(row for row in data["observations"] if row["valueHundredths"] is not None)
        total["valueHundredths"] = 999_999
        soglia.validate_data(data, self.spec)
        self.assertFalse(data["reconciliation"]["territorialSum"])
        self.assertFalse(data["reconciliation"]["householdSum"])

    def test_metadata_and_data_tampering_fail_closed(self):
        with tempfile.TemporaryDirectory() as directory:
            data_path, meta_path = Path(directory) / "data.json", Path(directory) / "meta.json"
            data_path.write_bytes(soglia.DATA.read_bytes())
            meta = json.loads(soglia.META.read_bytes())
            meta["source"]["licenseId"] = "CC-BY-4.0"
            meta_path.write_text(json.dumps(meta))
            with self.assertRaises(soglia.SnapshotError):
                soglia.check(soglia.SPEC, data_path, meta_path)


if __name__ == "__main__":
    unittest.main()
