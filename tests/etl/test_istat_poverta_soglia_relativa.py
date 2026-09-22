"""Relative poverty monetary threshold SDMX parsing and 2021 exclusion, offline."""
import copy
import csv
import io
import json
import unittest

import istat_poverta_soglia_relativa as soglia


def format_hundredths(value: int) -> str:
    text = f"{value // 100}.{value % 100:02d}".rstrip("0").rstrip(".")
    return text or "0"


class PovertaSogliaRelativaTests(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        cls.spec = soglia.load_spec()
        cls.data = json.loads(soglia.DATA.read_bytes())
        # Reconstruct published rows; rebuild also needs the excluded 2021 source rows.
        cls.published = []
        for observation in cls.data["observations"]:
            row = {key: values[0] for key, values in cls.spec["attributes"].items()}
            row.update(cls.spec["fixedDimensions"])
            row.update(
                NUMBER_HOUSEHOLD_COMP=observation["householdComposition"],
                TIME_PERIOD=str(observation["year"]),
                OBS_STATUS="",
                OBS_VALUE=format_hundredths(observation["valueHundredths"]),
            )
            cls.published.append(row)
        # Minimal 2021 stubs: magnitudes must stay anomalous vs 2020/2022 for N1.
        n1_2020 = next(
            row["valueHundredths"]
            for row in cls.data["observations"]
            if row["householdComposition"] == "N1" and row["year"] == 2020
        )
        cls.excluded = []
        for composition in cls.spec["householdCompositions"]:
            row = {key: values[0] for key, values in cls.spec["attributes"].items()}
            row.update(cls.spec["fixedDimensions"])
            value = n1_2020 * 3 if composition["code"] == "N1" else n1_2020 * 2
            row.update(
                NUMBER_HOUSEHOLD_COMP=composition["code"],
                TIME_PERIOD="2021",
                OBS_STATUS="",
                OBS_VALUE=format_hundredths(value),
            )
            cls.excluded.append(row)

    def payload(self, mutate=None, include_excluded=True):
        rows = [dict(row) for row in self.published]
        if include_excluded:
            rows.extend(dict(row) for row in self.excluded)
        if mutate:
            mutate(rows)
        output = io.StringIO()
        writer = csv.DictWriter(output, fieldnames=self.spec["headers"])
        writer.writeheader()
        writer.writerows(rows)
        return output.getvalue().encode()

    def test_committed_bundle_excludes_2021(self):
        soglia.check()
        self.assertEqual(len(self.data["observations"]), 70)
        self.assertTrue(all(row["year"] != 2021 for row in self.data["observations"]))
        self.assertEqual(self.spec["excludedYear"], 2021)
        self.assertEqual(self.spec["sourceObservations"], 77)

    def test_parser_roundtrip_with_excluded_year(self):
        built = soglia.build_data(self.payload(), self.spec)
        self.assertEqual(built, self.data)

    def test_missing_2021_fails_closed(self):
        with self.assertRaises(soglia.SnapshotError):
            soglia.build_data(self.payload(include_excluded=False), self.spec)

    def test_normalized_2021_fails_closed(self):
        def mutate(rows):
            for row in rows:
                if row["TIME_PERIOD"] == "2021" and row["NUMBER_HOUSEHOLD_COMP"] == "N1":
                    row["OBS_VALUE"] = "700.00"

        with self.assertRaises(soglia.SnapshotError):
            soglia.build_data(self.payload(mutate), self.spec)

    def test_empty_value_rejected(self):
        with self.assertRaises(soglia.SnapshotError):
            soglia.build_data(
                self.payload(lambda rows: rows[0].update(OBS_VALUE="", OBS_STATUS="")),
                self.spec,
            )

    def test_scale_and_soldi(self):
        self.assertEqual(self.data["scale"]["factor"], 100)
        self.assertEqual(soglia.value_hundredths("730.84"), 73084)
        self.assertTrue(self.spec["semantics"]["soldi"]["present"])
        with self.assertRaises(soglia.SnapshotError):
            soglia.value_hundredths("1.234")

    def test_tampering_public_year_rejected(self):
        bad = copy.deepcopy(self.data)
        bad["observations"][0]["year"] = 2021
        with self.assertRaises(soglia.SnapshotError):
            soglia.validate_data(bad, self.spec)


if __name__ == "__main__":
    unittest.main()
