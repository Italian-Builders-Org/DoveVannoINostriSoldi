import copy
import hashlib
import importlib.util
import json
import os
import sys
import tempfile
import unittest
from pathlib import Path
from unittest import mock


MODULE_PATH = Path(__file__).parents[2] / "scripts" / "etl" / "mef_irpef_municipal_snapshot.py"
SPEC = importlib.util.spec_from_file_location("mef_irpef_municipal_snapshot", MODULE_PATH)
MODULE = importlib.util.module_from_spec(SPEC)
assert SPEC and SPEC.loader
sys.modules[SPEC.name] = MODULE
SPEC.loader.exec_module(MODULE)


class MefIrpefMunicipalTests(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        cls.lock = MODULE.load_lock()
        cls.headers = cls.lock["csv"]["headers"]
        cls.header = (";".join(cls.headers) + "; ").encode("ascii")

    def fixture_lock(self, *, rows=1, municipalities=1, unassigned=0):
        lock = copy.deepcopy(self.lock)
        lock["expected"].update(
            {
                "sourceRows": rows,
                "municipalities": municipalities,
                "provinces": 1 if municipalities else 0,
                "regions": 1 if municipalities else 0,
                "unassignedRows": unassigned,
            }
        )
        lock["regions"] = [copy.deepcopy(self.lock["regions"][0])] if municipalities else []
        return lock

    def assigned_row(self, *, code="001001", cadastral="A001", taxpayers="2"):
        row = [""] * 52
        row[:8] = ["2024", cadastral, code, "COMUNE TEST", "TO", "Piemonte", "01", taxpayers]
        for index in range(8, 52, 2):
            row[index] = "1"
            row[index + 1] = "1"
        for key in MODULE.INCOME_BAND_MEASURE_KEYS:
            contract = self.lock["measures"][key]
            row[self.headers.index(contract["frequencyHeader"])] = "0"
            row[self.headers.index(contract["amountHeader"])] = "0"
        first_positive_band = self.lock["measures"]["comprehensiveIncome0To10000"]
        row[self.headers.index(first_positive_band["frequencyHeader"])] = "1"
        row[self.headers.index(first_positive_band["amountHeader"])] = "1"
        return row

    def residual_row(self):
        row = [""] * 52
        row[:8] = ["2024", "0", "0", "0", "0", "Mancante/errata", "0", "3"]
        for index in range(8, 52, 2):
            row[index] = "1"
            row[index + 1] = "1"
        for key in MODULE.INCOME_BAND_MEASURE_KEYS:
            contract = self.lock["measures"][key]
            row[self.headers.index(contract["frequencyHeader"])] = "0"
            row[self.headers.index(contract["amountHeader"])] = "0"
        first_positive_band = self.lock["measures"]["comprehensiveIncome0To10000"]
        row[self.headers.index(first_positive_band["frequencyHeader"])] = "1"
        row[self.headers.index(first_positive_band["amountHeader"])] = "1"
        return row

    def fixture_csv(self, *rows):
        body = [self.header, *(";".join(row).encode("ascii") for row in rows)]
        return b"\r\n".join(body) + b"\r\n"

    def test_source_lock_is_self_verified_and_locks_all_headers(self):
        self.assertEqual(
            MODULE.canonical_lock_sha256(self.lock),
            "836c774944f19c9676f6ca2717078b4c33d2763a7feb8092ceaabc568cf65db5",
        )
        self.assertEqual(len(self.headers), 52)
        self.assertEqual(len(set(self.headers)), 52)
        self.assertEqual(hashlib.sha256(self.header).hexdigest(), self.lock["csv"]["rawHeaderSha256"])
        normalized = "\n".join(self.headers).encode("ascii")
        self.assertEqual(
            hashlib.sha256(normalized).hexdigest(),
            self.lock["csv"]["normalizedHeaderSha256"],
        )
        expected_bytes, expected_sha256 = MODULE.expected_data_artifact(self.lock)
        self.assertEqual(expected_bytes, 2578548)
        self.assertEqual(
            expected_sha256,
            "ca54bc78ba33ba4dd61b411b51a237245646c6fd859c2c3ea30b567c463b13c3",
        )
        self.assertEqual(self.lock["measureGroups"], {
            "summary": list(MODULE.SUMMARY_MEASURE_KEYS),
            "incomeSources": list(MODULE.INCOME_SOURCE_MEASURE_KEYS),
            "incomeBands": list(MODULE.INCOME_BAND_MEASURE_KEYS),
        })

    def test_parser_preserves_the_selected_nonpositive_band_as_signed_cents(self):
        row = self.assigned_row()
        positive_band_amount = self.headers.index(
            "Reddito complessivo da 0 a 10000 euro - Ammontare in euro"
        )
        row[positive_band_amount] = "11"
        lower_band_amount = self.headers.index(
            "Reddito complessivo minore o uguale a zero euro - Ammontare in euro"
        )
        row[lower_band_amount] = "-10"
        records = MODULE.parse_csv_member(self.fixture_csv(row), self.fixture_lock())
        self.assertEqual(len(records), 1)
        index = self.lock["measureOrder"].index("nonPositiveComprehensiveIncome")
        self.assertEqual(records[0].measures[index], (0, -1000))

    def test_parser_rejects_negative_values_for_every_unsigned_measure(self):
        for measure_key in self.lock["measureOrder"]:
            if measure_key in MODULE.SIGNED_AMOUNT_MEASURE_KEYS:
                continue
            with self.subTest(measure=measure_key):
                row = self.assigned_row()
                amount_header = self.lock["measures"][measure_key]["amountHeader"]
                row[self.headers.index(amount_header)] = "-1"
                with self.assertRaisesRegex(MODULE.SnapshotError, "non valido"):
                    MODULE.parse_csv_member(self.fixture_csv(row), self.fixture_lock())

    def test_parser_rejects_a_positive_amount_in_the_nonpositive_band(self):
        row = self.assigned_row()
        amount_header = self.lock["measures"]["nonPositiveComprehensiveIncome"][
            "amountHeader"
        ]
        row[self.headers.index(amount_header)] = "1"
        with self.assertRaisesRegex(MODULE.SnapshotError, "deve essere non positivo"):
            MODULE.parse_csv_member(self.fixture_csv(row), self.fixture_lock())

    def test_parser_rejects_negative_taxpayers_and_frequencies(self):
        negative_taxpayers = self.assigned_row(taxpayers="-1")
        with self.assertRaisesRegex(MODULE.SnapshotError, "Numero contribuenti non valido"):
            MODULE.parse_csv_member(self.fixture_csv(negative_taxpayers), self.fixture_lock())

        negative_frequency = self.assigned_row()
        negative_frequency[self.headers.index("Reddito complessivo - Frequenza")] = "-1"
        with self.assertRaisesRegex(MODULE.SnapshotError, "Frequenza non valido"):
            MODULE.parse_csv_member(self.fixture_csv(negative_frequency), self.fixture_lock())

    def test_parser_rejects_malformed_and_unsafe_numeric_cells(self):
        for raw in (" 1", "+1", "1.0", "1,0", "1e3"):
            with self.subTest(raw=raw):
                row = self.assigned_row()
                row[self.headers.index("Imposta netta - Ammontare in euro")] = raw
                with self.assertRaises(MODULE.SnapshotError):
                    MODULE.parse_csv_member(self.fixture_csv(row), self.fixture_lock())

        unsafe = self.assigned_row()
        unsafe[self.headers.index("Imposta netta - Ammontare in euro")] = str(
            MODULE.MAX_SAFE_INTEGER // 100 + 1
        )
        with self.assertRaisesRegex(MODULE.SnapshotError, "centesimi fuori intervallo"):
            MODULE.parse_csv_member(self.fixture_csv(unsafe), self.fixture_lock())

    def test_parser_locks_the_exact_trailing_header_quirk(self):
        lock = self.fixture_lock()
        modified_header = ";".join(self.headers).encode("ascii")
        lock["csv"]["rawHeaderSha256"] = hashlib.sha256(modified_header).hexdigest()
        payload = modified_header + b"\r\n" + ";".join(self.assigned_row()).encode("ascii") + b"\r\n"
        with self.assertRaisesRegex(MODULE.SnapshotError, "Quirk terminale"):
            MODULE.parse_csv_member(payload, lock)

    def test_parser_rejects_duplicate_municipality_keys(self):
        row = self.assigned_row()
        lock = self.fixture_lock(rows=2, municipalities=2)
        with self.assertRaisesRegex(MODULE.SnapshotError, "Comune duplicato"):
            MODULE.parse_csv_member(self.fixture_csv(row, row), lock)

    def test_suppressed_source_cells_remain_nullable_and_are_counted(self):
        row = self.assigned_row()
        frequency_index = self.headers.index("Addizionale comunale dovuta - Frequenza")
        amount_index = self.headers.index("Addizionale comunale dovuta - Ammontare in euro")
        row[frequency_index] = ""
        row[amount_index] = ""
        lock = self.fixture_lock()
        records = MODULE.parse_csv_member(self.fixture_csv(row), lock)
        data = MODULE.build_data(lock, records)
        self.assertIsNone(data["municipalities"][0][15])
        self.assertIsNone(data["municipalities"][0][16])
        self.assertEqual(data["national"]["assigned"]["measures"][4], [0, 0, 1, 1, 1])

    def test_selected_measure_preserves_half_suppressed_pairs_independently(self):
        frequency_index = self.headers.index("Addizionale comunale dovuta - Frequenza")
        amount_index = self.headers.index("Addizionale comunale dovuta - Ammontare in euro")
        frequency_missing = self.assigned_row()
        frequency_missing[frequency_index] = ""
        frequency_records = MODULE.parse_csv_member(
            self.fixture_csv(frequency_missing), self.fixture_lock()
        )
        frequency_data = MODULE.build_data(self.fixture_lock(), frequency_records)
        self.assertEqual(frequency_data["municipalities"][0][15:17], [None, 100])
        self.assertEqual(
            frequency_data["national"]["assigned"]["measures"][4],
            [0, 100, 1, 1, 0],
        )

        amount_missing = self.assigned_row()
        amount_missing[amount_index] = ""
        amount_records = MODULE.parse_csv_member(
            self.fixture_csv(amount_missing), self.fixture_lock()
        )
        amount_data = MODULE.build_data(self.fixture_lock(), amount_records)
        self.assertEqual(amount_data["municipalities"][0][15:17], [1, None])
        self.assertEqual(
            amount_data["national"]["assigned"]["measures"][4],
            [1, 0, 1, 0, 1],
        )

    def test_parser_rejects_broken_income_band_reconciliation(self):
        frequency_row = self.assigned_row()
        frequency_header = self.lock["measures"]["comprehensiveIncome0To10000"][
            "frequencyHeader"
        ]
        frequency_row[self.headers.index(frequency_header)] = "2"
        with self.assertRaisesRegex(MODULE.SnapshotError, "frequenze note delle fasce"):
            MODULE.parse_csv_member(self.fixture_csv(frequency_row), self.fixture_lock())

        amount_row = self.assigned_row()
        amount_header = self.lock["measures"]["comprehensiveIncome0To10000"][
            "amountHeader"
        ]
        amount_row[self.headers.index(amount_header)] = "2"
        with self.assertRaisesRegex(MODULE.SnapshotError, "ammontari completi delle fasce"):
            MODULE.parse_csv_member(self.fixture_csv(amount_row), self.fixture_lock())

    def test_residual_row_is_not_exposed_as_a_municipality(self):
        lock = copy.deepcopy(self.lock)
        lock["expected"].update(
            {"sourceRows": 2, "municipalities": 1, "provinces": 1, "regions": 1, "unassignedRows": 1}
        )
        lock["regions"] = [copy.deepcopy(self.lock["regions"][0])]
        records = MODULE.parse_csv_member(
            self.fixture_csv(self.assigned_row(), self.residual_row()), lock
        )
        data = MODULE.build_data(lock, records)
        self.assertEqual(len(data["municipalities"]), 1)
        self.assertEqual(data["national"]["unassigned"]["label"], "Mancante/errata")
        self.assertEqual(data["national"]["unassigned"]["taxpayers"], 3)
        self.assertEqual(data["national"]["allSource"]["taxpayers"], 5)

    def test_failed_source_validation_preserves_previous_outputs(self):
        with tempfile.TemporaryDirectory() as directory:
            root = Path(directory)
            bad_zip = root / "bad.zip"
            bad_zip.write_bytes(b"not the pinned source")
            data_path = root / "data.json"
            meta_path = root / "meta.json"
            data_path.write_bytes(b"previous-data")
            meta_path.write_bytes(b"previous-meta")
            with self.assertRaises(MODULE.SnapshotError):
                MODULE.generate(
                    self.lock,
                    bad_zip,
                    "2026-08-21T00:00:00Z",
                    data_path,
                    meta_path,
                )
            self.assertEqual(data_path.read_bytes(), b"previous-data")
            self.assertEqual(meta_path.read_bytes(), b"previous-meta")

    def test_atomic_pair_write_rolls_back_if_second_replace_fails(self):
        with tempfile.TemporaryDirectory() as directory:
            root = Path(directory)
            data_path = root / "data.json"
            meta_path = root / "meta.json"
            data_path.write_bytes(b"previous-data")
            meta_path.write_bytes(b"previous-meta")
            real_replace = os.replace
            failed = False

            def flaky_replace(source, destination):
                nonlocal failed
                if Path(destination) == meta_path and not failed:
                    failed = True
                    raise OSError("simulated second replace failure")
                return real_replace(source, destination)

            with mock.patch.object(MODULE.os, "replace", side_effect=flaky_replace):
                with self.assertRaisesRegex(OSError, "simulated"):
                    MODULE.write_artifacts_atomically(
                        data_path,
                        meta_path,
                        b"next-data",
                        b"next-meta",
                    )
            self.assertEqual(data_path.read_bytes(), b"previous-data")
            self.assertEqual(meta_path.read_bytes(), b"previous-meta")

    def test_atomic_pair_write_cleans_data_stage_if_meta_staging_fails(self):
        with tempfile.TemporaryDirectory() as directory:
            root = Path(directory)
            data_path = root / "data.json"
            meta_path = root / "meta.json"
            real_stage_file = MODULE.stage_file
            calls = 0

            def fail_second_stage(path, payload):
                nonlocal calls
                calls += 1
                if calls == 2:
                    raise OSError("simulated staging failure")
                return real_stage_file(path, payload)

            with mock.patch.object(MODULE, "stage_file", side_effect=fail_second_stage):
                with self.assertRaisesRegex(OSError, "simulated staging failure"):
                    MODULE.write_artifacts_atomically(
                        data_path,
                        meta_path,
                        b"next-data",
                        b"next-meta",
                    )
            self.assertEqual(list(root.iterdir()), [])

    def test_committed_artifacts_validate_offline_and_are_hash_bound(self):
        data, meta = MODULE.validate_artifacts(
            self.lock,
            MODULE.DEFAULT_DATA_OUTPUT,
            MODULE.DEFAULT_META_OUTPUT,
        )
        self.assertEqual(tuple(data), MODULE.DATA_KEYS)
        self.assertEqual(tuple(meta), MODULE.META_KEYS)
        self.assertEqual(meta["period"]["observedAt"], "2026-09-04T08:16:29Z")
        self.assertEqual(meta["coverage"]["municipalities"], 7896)
        self.assertEqual(meta["coverage"]["provinces"], 107)
        self.assertEqual(meta["coverage"]["regions"], 20)
        self.assertEqual(meta["coverage"]["taxpayers"]["unassigned"], 5305)
        signed_index = self.lock["measureOrder"].index("nonPositiveComprehensiveIncome")
        self.assertTrue(any(
            row[8 + signed_index * 2] is not None and row[8 + signed_index * 2] < 0
            for row in data["municipalities"]
        ))
        self.assertTrue(all(
            amount is None or index == signed_index or amount >= 0
            for municipality in data["municipalities"]
            for index, amount in enumerate(municipality[8::2])
        ))

    def test_offline_check_rejects_tampered_data_even_when_json_is_canonical(self):
        with tempfile.TemporaryDirectory() as directory:
            root = Path(directory)
            data_path = root / "data.json"
            meta_path = root / "meta.json"
            data = json.loads(MODULE.DEFAULT_DATA_OUTPUT.read_text(encoding="utf-8"))
            data["municipalities"][0][8] += 100
            data_path.write_bytes(MODULE.artifact_bytes(data))
            meta_path.write_bytes(MODULE.DEFAULT_META_OUTPUT.read_bytes())
            with self.assertRaises(MODULE.SnapshotError):
                MODULE.validate_artifacts(self.lock, data_path, meta_path)

    def test_offline_check_rejects_a_self_consistent_but_unreviewed_pair(self):
        with tempfile.TemporaryDirectory() as directory:
            root = Path(directory)
            data_path = root / "data.json"
            meta_path = root / "meta.json"
            data = json.loads(MODULE.DEFAULT_DATA_OUTPUT.read_text(encoding="utf-8"))
            data["municipalities"][0][2] = "AGLIE MODIFICATO"
            data_bytes = MODULE.artifact_bytes(data)
            meta = MODULE.build_meta(self.lock, data, "2026-08-21T00:00:00Z", data_bytes)
            data_path.write_bytes(data_bytes)
            meta_path.write_bytes(MODULE.artifact_bytes(meta))
            with self.assertRaisesRegex(MODULE.SnapshotError, "output revisionato"):
                MODULE.validate_artifacts(self.lock, data_path, meta_path)


if __name__ == "__main__":
    unittest.main()
