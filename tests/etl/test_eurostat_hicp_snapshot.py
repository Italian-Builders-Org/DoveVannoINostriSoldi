import copy
import json
import os
import subprocess
import sys
import tempfile
import unittest
from pathlib import Path

ROOT = Path(__file__).resolve().parents[2]
sys.path.insert(0, str(ROOT / "scripts" / "etl"))
import eurostat_hicp_snapshot as etl  # noqa: E402

SPEC_PATH = ROOT / "scripts/etl/specs/eurostat-hicp-2022-2026.source.json"
DATA_PATH = ROOT / "src/data/generated/eurostat-hicp-2022-2026.data.json"
META_PATH = ROOT / "src/data/generated/eurostat-hicp-2022-2026.meta.json"
INPUT_DIR = Path(os.environ.get("DVNS_EUROSTAT_HICP_INPUT_DIR", "/private/tmp/dvns-377-input"))
RAW_INPUTS_AVAILABLE = INPUT_DIR.is_dir()
DIVISIONS = [f"CP{index:02d}" for index in range(1, 14)]


class EurostatHicpSnapshotTest(unittest.TestCase):
    @classmethod
    def setUpClass(cls) -> None:
        cls.spec = etl.load_spec(SPEC_PATH)
        cls.data = json.loads(DATA_PATH.read_text(encoding="utf-8"))
        cls.metadata = json.loads(META_PATH.read_text(encoding="utf-8"))

    def test_committed_source_lock_and_pair_validate_offline(self) -> None:
        etl.validate_data(self.data, self.spec)
        self.assertEqual(etl.canonical_lock_sha256(self.spec), self.spec["integrity"]["lockSha256"])
        self.assertEqual(self.metadata["integrity"]["sourceLockSha256"], self.spec["integrity"]["lockSha256"])
        result = subprocess.run(
            [sys.executable, "scripts/etl/eurostat_hicp_snapshot.py", "--check"],
            cwd=ROOT,
            capture_output=True,
            text=True,
            check=False,
        )
        self.assertEqual(result.returncode, 0, result.stderr)

    def test_required_coverage_and_latest_italy_value_are_exact(self) -> None:
        self.assertEqual(self.data["coverage"], {"expectedCells": 210, "flaggedTotalCells": 3, "observedCells": 210})
        self.assertEqual(len(self.data["totalObservations"]), 56)
        latest = self.data["totalObservations"][-1]
        self.assertEqual(latest["period"], "2026-08")
        self.assertEqual(latest["indexHundredths"], 10_270)
        self.assertEqual(latest["annualRateTenths"], 32)
        self.assertEqual(latest["monthlyRateTenths"], 1)
        self.assertEqual(set(latest["flags"].values()), {"e"})

    def test_comparison_and_divisions_preserve_their_own_common_period(self) -> None:
        comparison = {row["geo"]: row["annualRateTenths"] for row in self.data["comparison"]}
        self.assertEqual(comparison, {"EU27_2020": 30, "EA21": 30, "IT": 29})
        self.assertTrue(all(row["period"] == "2026-07" for row in self.data["comparison"]))
        divisions = {row["code"]: row["annualRateTenths"] for row in self.data["divisionObservations"]}
        self.assertEqual(list(divisions), DIVISIONS)
        self.assertEqual(divisions["CP04"], 72)
        self.assertTrue(all(row["period"] == "2026-07" for row in self.data["divisionObservations"]))

    def test_weights_reconcile_only_with_declared_rounding_tolerance(self) -> None:
        for year in (2025, 2026):
            rows = [row for row in self.data["weights"] if row["year"] == year]
            self.assertEqual([row["code"] for row in rows], DIVISIONS)
            observed = sum(row["weightHundredthsPerThousand"] for row in rows)
            self.assertEqual(observed, 100_001)
            self.assertEqual(self.data["reconciliation"]["weightGapByYear"][str(year)], 1)
            self.assertLessEqual(abs(observed - 100_000), self.data["reconciliation"]["weightToleranceHundredthsPerThousand"])

    def test_semantics_say_prices_are_not_public_money(self) -> None:
        money = self.metadata["semantics"]["soldi"]
        self.assertFalse(money["applicable"])
        self.assertEqual(money["unit"], "non applicabile")
        self.assertIn("prezzi", money["nature"])
        self.assertIn("nessun importo", money["note"].lower())
        self.assertEqual(self.metadata["semantics"]["provenance"]["license"], "CC-BY-4.0")
        self.assertEqual(
            self.metadata["referencePeriod"],
            "2022-01/2026-08 (totale Italia); 2026-07 (confronto e divisioni); pesi 2025-2026",
        )

    def test_missing_month_fails_closed(self) -> None:
        broken = copy.deepcopy(self.data)
        broken["totalObservations"].pop()
        with self.assertRaises(etl.SnapshotError):
            etl.validate_data(broken, self.spec)

    def test_rehashed_data_still_must_match_the_source_lock(self) -> None:
        data = copy.deepcopy(self.data)
        data["totalObservations"][-1]["annualRateTenths"] += 1
        payload = etl.canonical_bytes(data)
        metadata = etl.build_metadata(self.spec, data, payload)
        with tempfile.TemporaryDirectory() as directory:
            data_path = Path(directory) / "data.json"
            meta_path = Path(directory) / "meta.json"
            data_path.write_bytes(payload)
            meta_path.write_text(json.dumps(metadata), encoding="utf-8")
            with self.assertRaisesRegex(etl.SnapshotError, "divergenti dal source lock"):
                etl.check(SPEC_PATH, data_path, meta_path)

    def test_metadata_provenance_must_match_the_source_lock(self) -> None:
        for field, value in (("licenseId", "invented-license"), ("landingUrl", "https://example.org")):
            with self.subTest(field=field), tempfile.TemporaryDirectory() as directory:
                metadata = copy.deepcopy(self.metadata)
                metadata["source"][field] = value
                meta_path = Path(directory) / "meta.json"
                meta_path.write_text(json.dumps(metadata), encoding="utf-8")
                with self.assertRaisesRegex(etl.SnapshotError, "provenance o semantica divergenti"):
                    etl.check(SPEC_PATH, DATA_PATH, meta_path)

    def test_broken_weight_reconciliation_fails_closed(self) -> None:
        broken = copy.deepcopy(self.data)
        broken["weights"][-1]["weightHundredthsPerThousand"] += 100
        with self.assertRaises(etl.SnapshotError):
            etl.validate_data(broken, self.spec)

    def test_source_lock_rejects_an_imitation_host(self) -> None:
        broken = copy.deepcopy(self.spec)
        broken["source"]["assets"]["italy-total"]["url"] = "https://ec.europa.eu/eurostat.example.org/data"
        with tempfile.NamedTemporaryFile("w", suffix=".json", encoding="utf-8", delete=False) as handle:
            json.dump(broken, handle)
            temp_path = Path(handle.name)
        try:
            with self.assertRaises(etl.SnapshotError):
                etl.load_spec(temp_path)
        finally:
            temp_path.unlink(missing_ok=True)

    @unittest.skipUnless(RAW_INPUTS_AVAILABLE, "risposte JSON-stat non disponibili in locale")
    def test_local_raw_inputs_rebuild_the_committed_snapshot(self) -> None:
        inputs = {}
        for name, asset in self.spec["source"]["assets"].items():
            path = INPUT_DIR / asset["filename"]
            if not path.is_file():
                self.skipTest(f"input locale mancante: {path.name}")
            inputs[name] = path.read_bytes()
        rebuilt = etl.canonical_bytes(etl.build_data(inputs, self.spec))
        self.assertEqual(rebuilt, DATA_PATH.read_bytes())


if __name__ == "__main__":
    unittest.main()
