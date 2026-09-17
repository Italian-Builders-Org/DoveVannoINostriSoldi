import csv
import importlib.util
import sys
import tempfile
import unittest
from pathlib import Path


MODULE_PATH = Path(__file__).parents[2] / "scripts" / "etl" / "cpt_regional_fiscal_snapshot.py"
SPEC = importlib.util.spec_from_file_location("cpt_snapshot", MODULE_PATH)
MODULE = importlib.util.module_from_spec(SPEC)
assert SPEC and SPEC.loader
sys.modules[SPEC.name] = MODULE
SPEC.loader.exec_module(MODULE)


class CptRegionalFiscalTests(unittest.TestCase):
    def test_amount_parser_converts_millions_to_integer_cents(self):
        self.assertEqual(MODULE.amount_cents("12,34567"), 1_234_567_000)
        with self.assertRaises(MODULE.SnapshotError):
            MODULE.amount_cents("-1")
        for malformed in ("", "12.34567", "1.234,5", " 12,3"):
            with self.subTest(malformed=malformed), self.assertRaises(MODULE.SnapshotError):
                MODULE.amount_cents(malformed)

    def test_population_mapping_matches_the_pinned_istat_extraction(self):
        self.assertEqual(len(MODULE.REGIONS), 21)
        self.assertEqual(sum(region.population_2023 for region in MODULE.REGIONS.values()), 58_971_230)
        self.assertEqual(MODULE.REGIONS["18"].population_2023, 1_838_568)
        self.assertEqual(
            MODULE.population_mapping_sha256(),
            "bb7260ff76743a42a3881bd57969e9dba6e70dda1e9e1740852c16d656874d61",
        )

    def test_reader_fails_on_duplicate_total_rows(self):
        with tempfile.TemporaryDirectory() as directory:
            path = Path(directory) / "flow.csv"
            with path.open("w", encoding="ascii", newline="") as handle:
                writer = csv.writer(handle, delimiter=";")
                writer.writerow(["Regione per Dettaglio", "Categoria Entrate", "Anno", "E - Consolidato PA"])
                writer.writerow(["01 - Piemonte", MODULE.REVENUE_TOTAL, "2023", "1,0"])
                writer.writerow(["01 - Piemonte", MODULE.REVENUE_TOTAL, "2023", "1,0"])
            with self.assertRaisesRegex(MODULE.SnapshotError, "duplicata"):
                MODULE.read_flow(path, "Categoria Entrate", MODULE.REVENUE_TOTAL, "E - Consolidato PA")

    def test_build_fails_closed_when_hashes_do_not_match(self):
        with tempfile.TemporaryDirectory() as directory:
            first = Path(directory) / "a.csv"
            second = Path(directory) / "b.csv"
            first.write_text("x", encoding="ascii")
            second.write_text("y", encoding="ascii")
            with self.assertRaisesRegex(MODULE.SnapshotError, "Hash entrate inatteso"):
                MODULE.build_snapshot(first, second, first, "2026-08-21T00:00:00Z")


if __name__ == "__main__":
    unittest.main()
