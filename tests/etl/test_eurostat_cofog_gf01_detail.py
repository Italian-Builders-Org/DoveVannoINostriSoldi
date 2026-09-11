import copy
import json
import sys
import unittest
from pathlib import Path

ROOT = Path(__file__).resolve().parents[2]
sys.path.insert(0, str(ROOT / "scripts" / "etl"))
import eurostat_cofog_snapshot as etl  # noqa: E402

DATA_PATH = ROOT / "src/data/generated/eurostat-cofog-2014-2024.data.json"
DETAIL_BY_PARENT = {
    "GF01": {f"GF010{index}" for index in range(1, 9)},
    "GF02": {f"GF020{index}" for index in range(1, 6)},
    "GF03": {f"GF030{index}" for index in range(1, 7)},
    "GF08": {f"GF080{index}" for index in range(1, 7)},
}


class EurostatCofogDetailTest(unittest.TestCase):
    @classmethod
    def setUpClass(cls) -> None:
        cls.data = json.loads(DATA_PATH.read_text(encoding="utf-8"))

    def test_all_italian_details_are_complete_for_2014_2024(self) -> None:
        self.assertEqual(set(self.data["details"]), set(DETAIL_BY_PARENT))
        for parent, codes in DETAIL_BY_PARENT.items():
            with self.subTest(parent=parent):
                detail = self.data["details"][parent]
                self.assertEqual(detail["geo"], "IT")
                self.assertEqual(detail["parentFunction"], parent)
                self.assertEqual({row["code"] for row in detail["functions"]}, codes)
                expected_cells = len(codes) * 11
                self.assertEqual(detail["coverage"]["expectedCells"], expected_cells)
                self.assertEqual(detail["coverage"]["observedCells"], expected_cells)
                by_year = {}
                for row in detail["observations"]:
                    by_year.setdefault(row["year"], []).append(row)
                self.assertEqual(set(by_year), set(range(2014, 2025)))
                self.assertTrue(all({row["function"] for row in rows} == codes for rows in by_year.values()))

    def test_details_reconcile_to_the_published_parents(self) -> None:
        for parent in DETAIL_BY_PARENT:
            with self.subTest(parent=parent):
                detail = self.data["details"][parent]
                parents = {
                    row["year"]: row
                    for row in self.data["observations"]
                    if row["geo"] == "IT" and row["function"] == parent
                }
                checked = etl._reconcile_detail(self.data["observations"], detail)
                self.assertEqual(checked, detail["reconciliation"])
                for year, parent_row in parents.items():
                    parts = [row for row in detail["observations"] if row["year"] == year]
                    self.assertLessEqual(
                        abs(parent_row["amountCents"] - sum(row["amountCents"] for row in parts)),
                        detail["reconciliation"]["toleranceCents"],
                    )

    def test_tampered_detail_fails_closed(self) -> None:
        for parent in DETAIL_BY_PARENT:
            with self.subTest(parent=parent):
                tampered = copy.deepcopy(self.data["details"][parent])
                tampered["observations"][0]["amountCents"] += etl.DETAIL_TOLERANCE_CENTS * 10
                with self.assertRaises(etl.SnapshotError):
                    etl._reconcile_detail(self.data["observations"], tampered)


if __name__ == "__main__":
    unittest.main()
