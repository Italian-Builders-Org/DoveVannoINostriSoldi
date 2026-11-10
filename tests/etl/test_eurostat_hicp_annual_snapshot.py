import copy
import json
import subprocess
import sys
import tempfile
import unittest
from pathlib import Path

ROOT = Path(__file__).resolve().parents[2]
sys.path.insert(0, str(ROOT / "scripts" / "etl"))
import eurostat_hicp_annual_snapshot as etl  # noqa: E402

FIXTURE = ROOT / "tests/fixtures/eurostat-hicp-annuale/prc_hicp_ainr-it.json"


class EurostatHicpAnnualSnapshotTest(unittest.TestCase):
    @classmethod
    def setUpClass(cls) -> None:
        cls.spec = etl.load_spec(etl.DEFAULT_SPEC)
        cls.payload = FIXTURE.read_bytes()
        cls.snapshot = etl.build_snapshot(cls.payload, cls.spec)

    def test_fixture_rebuilds_the_committed_artifact_and_check_passes(self) -> None:
        self.assertEqual(etl.encode(self.snapshot), etl.DEFAULT_DATA.read_bytes())
        result = subprocess.run(
            [sys.executable, "scripts/etl/eurostat_hicp_annual_snapshot.py", "--check"],
            cwd=ROOT, capture_output=True, text=True, check=False,
        )
        self.assertEqual(result.returncode, 0, result.stderr)

    def test_series_covers_1996_2025_on_base_2025(self) -> None:
        rows = {row["year"]: row for row in self.snapshot["observations"]}
        self.assertEqual(list(rows), list(range(1996, 2026)))
        self.assertEqual(rows[1996], {"year": 1996, "indexTenths": 551})
        self.assertEqual((rows[2008]["indexTenths"], rows[2023]["indexTenths"], rows[2025]["indexTenths"]), (727, 973, 1000))
        self.assertEqual(rows[2022]["annualAverageRateTenths"], 87)
        self.assertEqual(self.snapshot["referencePeriod"], "1996-2025")
        self.assertFalse(self.snapshot["semantics"]["soldi"]["applicable"])

    def test_changed_bytes_fail_the_input_lock(self) -> None:
        with self.assertRaisesRegex(etl.SnapshotError, "byte/hash"):
            etl.build_snapshot(self.payload.replace(b"72.7", b"72.8"), self.spec)

    def test_missing_year_fails_closed(self) -> None:
        broken = copy.deepcopy(self.snapshot)
        del broken["observations"][12]
        with self.assertRaisesRegex(etl.SnapshotError, "anni"):
            etl.validate_snapshot(broken, self.spec)

    def test_rate_inconsistent_with_indices_fails(self) -> None:
        broken = copy.deepcopy(self.snapshot)
        broken["observations"][26]["annualAverageRateTenths"] = 59  # 2022 shifted by one year
        with self.assertRaisesRegex(etl.SnapshotError, "tasso incoerente"):
            etl.validate_snapshot(broken, self.spec)

    def test_rescaled_series_fails_on_base_year(self) -> None:
        broken = copy.deepcopy(self.snapshot)
        for row in broken["observations"]:
            row["indexTenths"] = row["indexTenths"] * 1243 // 1000  # same series on another base
        with self.assertRaisesRegex(etl.SnapshotError, "anno base"):
            etl.validate_snapshot(broken, self.spec)

    def test_artifact_must_carry_the_locked_provenance(self) -> None:
        broken = copy.deepcopy(self.snapshot)
        broken["semantics"]["provenance"]["sha256"] = "0" * 64
        with self.assertRaisesRegex(etl.SnapshotError, "provenienza"):
            etl.validate_snapshot(broken, self.spec)

    def test_spec_rejects_an_imitation_host(self) -> None:
        spec = copy.deepcopy(self.spec)
        spec["source"]["assets"]["annual"]["url"] = "https://ec.europa.eu/eurostat.example.org/api/x"
        with tempfile.TemporaryDirectory() as directory:
            path = Path(directory) / "spec.json"
            path.write_text(json.dumps(spec), encoding="utf-8")
            with self.assertRaisesRegex(etl.SnapshotError, "URL asset"):
                etl.load_spec(path)


if __name__ == "__main__":
    unittest.main()
