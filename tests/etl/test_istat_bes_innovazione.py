"""BES_11-specific SDMX parsing, coverage and provenance checks, entirely offline."""
import copy
import csv
import io
import json
import tempfile
import unittest
from pathlib import Path

import istat_bes_innovazione as bes


def format_tenths(value: int) -> str:
    sign = "-" if value < 0 else ""
    absolute = abs(value)
    text = f"{absolute // 10}.{absolute % 10}".rstrip("0").rstrip(".")
    return f"{sign}{text or '0'}"


class BesInnovazioneTests(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        cls.spec = bes.load_spec()
        cls.data = json.loads(bes.DATA.read_bytes())
        cls.rows = []
        units = {item["code"]: item["unit"] for item in cls.spec["indicators"]}
        for observation in cls.data["observations"]:
            code, value = observation["indicator"], observation["valueTenths"]
            row = {key: values[0] for key, values in cls.spec["attributes"].items()}
            row.update(cls.spec["fixedDimensions"])
            row.update(
                DATA_TYPE=code,
                REF_AREA=observation["territory"],
                SEX=observation["sex"],
                TIME_PERIOD=str(observation["year"]),
                UNIT_MEAS=units[code],
                NOTE_DATA_TYPE_DESCR=code,
                NOTE_DATA_TYPE_SOURCE=code + "_SOU",
                OBS_STATUS=observation["status"] or "",
                OBS_VALUE="" if value is None else format_tenths(value),
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
        bes.check()
        self.assertEqual(bes.build_data(self.payload(), self.spec), self.data)

    def test_domain_units_and_edition_are_locked(self):
        for column, bad in [("UNIT_MEAS", "EURO"), ("DOMAIN", "BES_12"), ("EDITION", "2024"),
                            ("DATAFLOW", "IT1:DF_BES_TERRIT_12(1.0)")]:
            with self.subTest(column=column), self.assertRaises(bes.SnapshotError):
                bes.build_data(self.payload(lambda rows: rows[0].update({column: bad})), self.spec)

    def test_signed_mobility_and_nonnegative_peers(self):
        self.assertEqual(sum(1 for row in self.data["observations"] if row["valueTenths"] is not None and row["valueTenths"] < 0), 495)
        self.assertTrue(all(
            row["indicator"] == "11RIC025"
            for row in self.data["observations"]
            if row["valueTenths"] is not None and row["valueTenths"] < 0
        ))
        self.assertEqual(bes.value_tenths("-4.9", allow_negative=True), -49)
        with self.assertRaises(bes.SnapshotError):
            bes.value_tenths("-1", allow_negative=False)
        with self.assertRaises(bes.SnapshotError):
            bes.build_data(
                self.payload(lambda rows: next(row for row in rows if row["DATA_TYPE"] == "11RIC002").update(OBS_VALUE="-1")),
                self.spec,
            )

    def test_absent_rows_stay_absent_without_invented_flags(self):
        self.assertEqual(self.spec["nullCells"], [])
        self.assertEqual([row for row in self.data["observations"] if row["status"]], [])
        self.assertEqual(bes.value_tenths("0", allow_negative=False), 0)
        for raw, flag in [("0", "n"), ("", ""), ("1.5", "g")]:
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
        total = next(row for row in data["observations"] if row["valueTenths"] is not None)
        total["valueTenths"] = 9999
        bes.validate_data(data, self.spec)
        self.assertFalse(data["reconciliation"]["totalBetweenSexes"])
        self.assertFalse(data["reconciliation"]["territorialSum"])

    def test_metadata_and_data_tampering_fail_closed(self):
        with tempfile.TemporaryDirectory() as directory:
            data_path, meta_path = Path(directory) / "data.json", Path(directory) / "meta.json"
            data_path.write_bytes(bes.DATA.read_bytes())
            meta = json.loads(bes.META.read_bytes())
            meta["source"]["licenseId"] = "CC-BY-4.0"
            meta_path.write_text(json.dumps(meta), encoding="utf-8")
            with self.assertRaises(bes.SnapshotError):
                bes.check(bes.SPEC, data_path, meta_path)


if __name__ == "__main__":
    unittest.main()
