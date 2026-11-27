"""Exit tax study: official figures, scenario arithmetic and fail-closed source checks."""

from __future__ import annotations

import json
import sys
import unittest
from pathlib import Path

ROOT = Path(__file__).resolve().parents[2]
sys.path.insert(0, str(ROOT / "scripts" / "etl"))

import exit_tax as etl  # noqa: E402

SPEC = json.loads((ROOT / "scripts/etl/specs/exit-tax.source.json").read_text(encoding="utf-8"))


class GovernmentEstimateTests(unittest.TestCase):
    def test_the_technical_report_arithmetic_is_reproduced(self) -> None:
        # Relazione tecnica A.C. 3174, art. 17: 6.581 mln × 73,1% × 0,28% = 13,47 mln.
        estimate = etl.government_estimate(6581, 73.1, 0.28)
        self.assertAlmostEqual(estimate["potential"], 13.47, places=2)
        # Half is expected as the 50% advance, half of that is later refunded.
        self.assertAlmostEqual(estimate["annual"], 6.74, places=2)
        self.assertAlmostEqual(estimate["firstYear"], 3.37, places=2)
        self.assertAlmostEqual(estimate["refunds"], 3.37, places=2)

    def test_figures_are_read_from_the_official_text_and_must_match(self) -> None:
        text = ("valore soglia di 800.000 euro, che rappresentano il 73,1 per cento della ricchezza totale. "
                "si attesti intorno allo 0,28 per cento della popolazione residente di età superiore a 15 anni. "
                "sulle plusvalenze (6.581 milioni di euro), si stima che il gettito potenziale dell'exit tax sia pari a 13,47 milioni")
        self.assertEqual(etl.read_estimate_inputs(text), {"substituteTax": 6581.0, "shareAboveThreshold": 73.1, "emigrationRate": 0.28, "potential": 13.47})
        # A changed figure in the source is a different document: stop, do not publish.
        with self.assertRaises(etl.ExitTaxError):
            etl.read_estimate_inputs(text.replace("13,47", "15,10"), expected_potential=13.47)

    def test_a_missing_phrase_blocks_publication(self) -> None:
        etl.require_phrases("Il differimento opera per i cinque periodi d'imposta", ["cinque periodi"], "art. 17")
        with self.assertRaises(etl.ExitTaxError):
            etl.require_phrases("testo diverso", ["cinque periodi"], "art. 17")


class ScenarioTests(unittest.TestCase):
    def test_tax_on_the_stock_that_leaves(self) -> None:
        # 2.600 mld above the threshold, 0,10% leaves, 35% of it is unrealised gain, 26% rate.
        tax = etl.scenario_tax(stock_bn=2600, emigration_pct=0.10, gain_share_pct=35, rate_pct=26)
        self.assertAlmostEqual(tax["leavingStockBn"], 2.6)
        self.assertAlmostEqual(tax["gainsBn"], 0.91)
        self.assertAlmostEqual(tax["taxMn"], 236.6, places=1)
        # With the deferral everyone can choose, only the 50% advance is collected at departure.
        self.assertAlmostEqual(tax["advanceMn"], 118.3, places=1)

    def test_grid_is_monotonic_and_labelled_as_hypotheses(self) -> None:
        grid = etl.scenario_grid(2600, [0.02, 0.10], [20, 50], 26)
        self.assertEqual(len(grid), 4)
        self.assertLess(grid[0]["taxMn"], grid[-1]["taxMn"])
        self.assertTrue(all(cell["kind"] == "scenario" for cell in grid))


class SourceParsingTests(unittest.TestCase):
    def test_istat_emigrants_by_education(self) -> None:
        rows = [
            ["Tavola 9 - ...", None, None, None, None, None, None, None, None],
            ["REGIONI", 2024, None, None, None, 2025, None, None, None],
            [None, "basso", "medio", "alto", "totale", "basso", "medio", "alto", "totale"],
            ["ISCRITTI", None, None, None, None, None, None, None, None],
            ["ITALIA", 10, 10, 10, 30, 11, 11, 11, 33],
            ["CANCELLATI", None, None, None, None, None, None, None, None],
            ["Piemonte", 1, 2, 3, 6, 1, 1, 1, 3],
            ["ITALIA", 50000, 40000, 51000, 141000, 40000, 30000, 39004, 109004],
        ]
        series = etl.istat_emigrants(rows)
        self.assertEqual(series, [
            {"year": 2024, "low": 50000, "medium": 40000, "high": 51000, "total": 141000},
            {"year": 2025, "low": 40000, "medium": 30000, "high": 39004, "total": 109004},
        ])

    def test_istat_rows_that_do_not_add_up_are_rejected(self) -> None:
        rows = [
            ["REGIONI", 2025, None, None, None],
            [None, "basso", "medio", "alto", "totale"],
            ["CANCELLATI", None, None, None, None],
            ["ITALIA", 1, 1, 1, 9],
        ]
        with self.assertRaises(etl.ExitTaxError):
            etl.istat_emigrants(rows)

    def test_wealth_by_group_from_the_ecb_csv(self) -> None:
        csv_rows = [
            {"INSTR_ASSET": "F3", "DWA_GRP": "D10", "UNIT_MEASURE": "EUR", "TIME_PERIOD": "2026-Q2", "OBS_VALUE": "100", "UNIT_MULT": "6"},
            {"INSTR_ASSET": "F5", "DWA_GRP": "D10", "UNIT_MEASURE": "EUR", "TIME_PERIOD": "2026-Q2", "OBS_VALUE": "900", "UNIT_MULT": "6"},
            {"INSTR_ASSET": "F5", "DWA_GRP": "D10", "UNIT_MEASURE": "EUR", "TIME_PERIOD": "2026-Q1", "OBS_VALUE": "1", "UNIT_MULT": "6"},
            {"INSTR_ASSET": "F5", "DWA_GRP": "D10", "UNIT_MEASURE": "EUR_R_NH", "TIME_PERIOD": "2026-Q2", "OBS_VALUE": "1000", "UNIT_MULT": "3"},
        ]
        quarter, groups = etl.wealth_by_group(csv_rows, ["F3", "F5"], ["D10"])
        self.assertEqual(quarter, "2026-Q2")
        self.assertEqual(groups["D10"]["totalBn"], {"F3": 0.1, "F5": 0.9})
        self.assertEqual(groups["D10"]["perHouseholdThousand"], {"F5": 1000.0})
        with self.assertRaises(etl.ExitTaxError):
            etl.wealth_by_group([dict(csv_rows[0], UNIT_MULT="3")], ["F3"], ["D10"])


class SourceLockTests(unittest.TestCase):
    def test_every_source_is_pinned_with_url_and_hash(self) -> None:
        for key, entry in SPEC["artefacts"].items():
            with self.subTest(artefact=key):
                self.assertRegex(entry["sha256"], r"^[0-9a-f]{64}$")
                self.assertTrue(entry["url"].startswith("https://"), entry["url"])
                if (ROOT / entry["path"]).exists():
                    etl.read_locked(SPEC, key)

    def test_international_rows_cite_a_pinned_document(self) -> None:
        for row in SPEC["international"]:
            with self.subTest(country=row["country"]):
                self.assertTrue(row["sources"])
                for source in row["sources"]:
                    self.assertIn(source["artefact"], SPEC["artefacts"])
                    self.assertTrue(source["phrase"])


if __name__ == "__main__":
    unittest.main()
