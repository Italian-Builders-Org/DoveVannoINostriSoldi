import copy
import json
import sys
import unittest
from pathlib import Path

ROOT = Path(__file__).resolve().parents[2]
sys.path.insert(0, str(ROOT / "scripts" / "etl"))
import eurostat_cofog_snapshot as etl  # noqa: E402

DATA_PATH = ROOT / "src/data/generated/eurostat-cofog-2014-2024.data.json"
DETAIL_CODES = {f"GF010{index}" for index in range(1, 9)}


class EurostatCofogGf01DetailTest(unittest.TestCase):
    @classmethod
    def setUpClass(cls) -> None:
        cls.data = json.loads(DATA_PATH.read_text(encoding="utf-8"))

    def test_detail_is_complete_for_italy_2014_2024(self) -> None:
        detail = self.data["details"]["GF01"]
        self.assertEqual(detail["geo"], "IT")
        self.assertEqual(detail["parentFunction"], "GF01")
        self.assertEqual({row["code"] for row in detail["functions"]}, DETAIL_CODES)
        self.assertEqual(detail["coverage"]["expectedCells"], 88)
        self.assertEqual(detail["coverage"]["observedCells"], 88)
        by_year = {}
        for row in detail["observations"]:
            by_year.setdefault(row["year"], []).append(row)
        self.assertEqual(set(by_year), set(range(2014, 2025)))
        self.assertTrue(all({row["function"] for row in rows} == DETAIL_CODES for rows in by_year.values()))

    def test_detail_reconciles_to_the_published_parent(self) -> None:
        detail = self.data["details"]["GF01"]
        parents = {
            row["year"]: row
            for row in self.data["observations"]
            if row["geo"] == "IT" and row["function"] == "GF01"
        }
        checked = etl._reconcile_detail(self.data["observations"], detail)
        self.assertEqual(checked, detail["reconciliation"])
        for year, parent in parents.items():
            parts = [row for row in detail["observations"] if row["year"] == year]
            self.assertLessEqual(
                abs(parent["amountCents"] - sum(row["amountCents"] for row in parts)),
                detail["reconciliation"]["toleranceCents"],
            )

    def test_tampered_detail_fails_closed(self) -> None:
        tampered = copy.deepcopy(self.data["details"]["GF01"])
        tampered["observations"][0]["amountCents"] += etl.DETAIL_TOLERANCE_CENTS * 10
        with self.assertRaises(etl.SnapshotError):
            etl._reconcile_detail(self.data["observations"], tampered)


if __name__ == "__main__":
    unittest.main()
