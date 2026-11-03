import copy
import subprocess
import sys
import unittest
from pathlib import Path

ROOT = Path(__file__).resolve().parents[2]
sys.path.insert(0, str(ROOT / "scripts" / "etl"))
import istat_retribuzioni_contrattuali_snapshot as etl  # noqa: E402

FIXTURE = ROOT / "tests/fixtures/istat-retribuzioni-contrattuali/retribuzioni-contrattuali-base-2021.csv"


class IstatRetribuzioniContrattualiSnapshotTest(unittest.TestCase):
    @classmethod
    def setUpClass(cls) -> None:
        cls.spec = etl.load_spec(etl.DEFAULT_SPEC)
        cls.payload = FIXTURE.read_bytes()
        cls.snapshot = etl.build_snapshot(cls.payload, cls.spec)

    def build_with(self, payload: bytes) -> dict:
        spec = copy.deepcopy(self.spec)
        spec["source"]["asset"].update(bytes=len(payload), sha256=etl.sha256_bytes(payload))
        return etl.build_snapshot(payload, spec)

    def test_fixture_rebuilds_the_committed_artifact_and_check_passes(self) -> None:
        self.assertEqual(etl.encode(self.snapshot), etl.DEFAULT_DATA.read_bytes())
        result = subprocess.run(
            [sys.executable, "scripts/etl/istat_retribuzioni_contrattuali_snapshot.py", "--check"],
            cwd=ROOT, capture_output=True, text=True, check=False,
        )
        self.assertEqual(result.returncode, 0, result.stderr)

    def test_series_covers_2005_2025_on_base_december_2021(self) -> None:
        rows = {row["year"]: row["indexTenths"] for row in self.snapshot["observations"]}
        self.assertEqual(list(rows), list(range(2005, 2026)))
        self.assertEqual((rows[2005], rows[2008], rows[2023], rows[2025]), (771, 841, 1037, 1101))
        self.assertEqual(self.snapshot["referencePeriod"], "2005-2025")
        self.assertFalse(self.snapshot["semantics"]["soldi"]["applicable"])

    def test_changed_bytes_fail_the_input_lock(self) -> None:
        with self.assertRaisesRegex(etl.SnapshotError, "byte/hash"):
            etl.build_snapshot(self.payload.replace(b",2008,84.1,", b",2008,84.2,"), self.spec)

    def test_missing_year_fails(self) -> None:
        lines = self.payload.splitlines(keepends=True)
        with self.assertRaisesRegex(etl.SnapshotError, "anni"):
            self.build_with(b"".join(line for line in lines if b",2012," not in line))

    def test_other_series_or_flag_fails(self) -> None:
        cases = (
            (b",WAGE_E_2021,N,10,Z3620,2013,", b",WAGE_H_2021,N,10,Z3620,2013,"),  # hourly instead of per employee
            (b",WAGE_E_2021,N,10,Z3620,2013,", b",WAGE_E_2021,N,6,Z3620,2013,"),  # blue-collar only
            (b",WAGE_E_2021,N,10,Z3620,2013,", b",WAGE_E_2021,N,10,Z2520,2013,"),  # private sector only
            (b",2013,92.8,", b",2013,92.8,p"),
        )
        for old, new in cases:
            with self.subTest(new=new), self.assertRaises(etl.SnapshotError):
                self.build_with(self.payload.replace(old, new))

    def test_artifact_must_carry_the_locked_provenance(self) -> None:
        broken = copy.deepcopy(self.snapshot)
        broken["semantics"]["provenance"]["sha256"] = "0" * 64
        with self.assertRaisesRegex(etl.SnapshotError, "provenienza"):
            etl.validate_snapshot(broken, self.spec)


if __name__ == "__main__":
    unittest.main()
