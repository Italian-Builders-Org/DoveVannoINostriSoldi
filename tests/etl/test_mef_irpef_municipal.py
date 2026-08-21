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
        return row

    def residual_row(self):
        row = [""] * 52
        row[:8] = ["2024", "0", "0", "0", "0", "Mancante/errata", "0", "3"]
        for index in range(8, 52, 2):
            row[index] = "1"
            row[index + 1] = "1"
        return row

    def fixture_csv(self, *rows):
        body = [self.header, *(";".join(row).encode("ascii") for row in rows)]
        return b"\r\n".join(body) + b"\r\n"

    def test_source_lock_is_self_verified_and_locks_all_headers(self):
        self.assertEqual(
            MODULE.canonical_lock_sha256(self.lock),
            "0652bf0f7b548e9956fcdd791ec52846c733738a22562e713a15d2407952c342",
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
        self.assertEqual(expected_bytes, 1026780)
        self.assertEqual(
            expected_sha256,
            "772613d3c32ff0bb33899bcaa206fe9c6db5e36d559a058d9541d8843c3c7ebd",
        )

    def test_parser_accepts_negative_only_in_the_nonselected_nonpositive_band(self):
        row = self.assigned_row()
        lower_band_amount = self.headers.index(
            "Reddito complessivo minore o uguale a zero euro - Ammontare in euro"
        )
        row[lower_band_amount] = "-10"
        records = MODULE.parse_csv_member(self.fixture_csv(row), self.fixture_lock())
        self.assertEqual(len(records), 1)
        self.assertEqual(records[0].measures[0], (1, 100))

    def test_parser_rejects_negative_values_for_every_selected_measure(self):
        for measure_key in self.lock["measureOrder"]:
            with self.subTest(measure=measure_key):
                row = self.assigned_row()
                amount_header = self.lock["measures"][measure_key]["amountHeader"]
                row[self.headers.index(amount_header)] = "-1"
                with self.assertRaisesRegex(MODULE.SnapshotError, "non valido"):
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
        self.assertIsNone(data["municipalities"][0][-2])
        self.assertIsNone(data["municipalities"][0][-1])
        self.assertEqual(data["national"]["assigned"]["measures"][-1], [0, 0, 1])

    def test_selected_measure_rejects_half_suppressed_pairs(self):
        frequency_index = self.headers.index("Addizionale comunale dovuta - Frequenza")
        amount_index = self.headers.index("Addizionale comunale dovuta - Ammontare in euro")
        for missing_index in (frequency_index, amount_index):
            with self.subTest(missing_header=self.headers[missing_index]):
                row = self.assigned_row()
                row[missing_index] = ""
                with self.assertRaisesRegex(MODULE.SnapshotError, "parzialmente oscurata"):
                    MODULE.parse_csv_member(self.fixture_csv(row), self.fixture_lock())

    def test_artifact_rejects_half_suppressed_measure_pairs(self):
        data = json.loads(MODULE.DEFAULT_DATA_OUTPUT.read_text(encoding="utf-8"))
        row = data["municipalities"][0]
        row[7] = None
        with self.assertRaisesRegex(MODULE.SnapshotError, "entrambi presenti o entrambi oscurati"):
            MODULE.validate_data(data, self.lock)

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
        self.assertEqual(meta["period"]["observedAt"], "2026-08-21T00:00:00Z")
        self.assertEqual(meta["coverage"]["municipalities"], 7896)
        self.assertEqual(meta["coverage"]["provinces"], 107)
        self.assertEqual(meta["coverage"]["regions"], 20)
        self.assertEqual(meta["coverage"]["taxpayers"]["unassigned"], 5305)
        self.assertTrue(
            all(
                amount is None or amount >= 0
                for municipality in data["municipalities"]
                for amount in municipality[8::2]
            )
        )

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
