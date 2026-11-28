"""Wealth tax study: distribution, Pareto tail and scenarios.

The behaviour comes before the code: every number shown on the page must be
read from a pinned official source or follow from declared hypotheses, and a
source that changes or stops matching must stop the build.
"""

from __future__ import annotations

import json
import math
import unittest
from pathlib import Path

import patrimoniale as pt

ROOT = Path(__file__).resolve().parents[2]
SPEC = ROOT / "scripts/etl/specs/patrimoniale.source.json"


def row(instr: str, group: str, unit: str, value: float, period: str = "2026-Q2", entry: str = "N", mult: str = "6") -> dict[str, str]:
    return {
        "KEY": f"DWA.Q.IT.S14.{entry}.LE.{instr}.{group}.{unit}.S.N",
        "REF_AREA": "IT",
        "ACCOUNT_ENTRY": entry,
        "INSTR_ASSET": instr,
        "DWA_GRP": group,
        "UNIT_MEASURE": unit,
        "TIME_PERIOD": period,
        "OBS_VALUE": str(value),
        "UNIT_MULT": mult,
    }


def toy_rows() -> list[dict[str, str]]:
    """Six bands that do not add up to the published total."""
    rows = [row("NWA", "_Z", "EUR", 11590488.88), row("NWA", "_Z", "EUR_R_NH", 462.57, mult="3")]
    rows += [row("NWA", "_Z", "EUR_MD", 181797.59, mult="0"), row("NWA", "_Z", "EUR_MN", 462571.28, mult="0")]
    for index, group in enumerate(["Q1", "Q2", "Q3", "Q4", "D9", "D10"], start=1):
        rows.append(row("NWA", group, "EUR", 100000.0 * index))
        rows.append(row("NWA", group, "EUR_R_NH", 40.0 * index, mult="3"))
        if group != "Q1":
            rows.append(row("NWA", group, "EUR_T", 30.0 * index, mult="3"))
    rows.append(row("NWA", "D10", "EUR_R_NH", 2802.65, period="2026-Q1", mult="3"))
    for group, value in (("T10", 60.63), ("T5", 50.29), ("B50", 7.22)):
        rows.append(row("NWA", group, "PT", value, entry="_Z", mult="0"))
    rows.append(row("NWA", "_Z", "GI", 72.24, entry="_Z", mult="0"))
    return rows


class DwaTests(unittest.TestCase):
    def test_value_reads_one_series_in_its_declared_unit(self) -> None:
        rows = toy_rows()
        self.assertEqual(pt.dwa_value(rows, "2026-Q2", "NWA", "_Z", "EUR", "N"), 11590488.88)
        self.assertEqual(pt.dwa_value(rows, "2026-Q2", "NWA", "D10", "EUR_R_NH", "N"), 240.0)

    def test_value_refuses_missing_or_duplicated_series(self) -> None:
        rows = toy_rows()
        with self.assertRaises(pt.PatrimonialeError):
            pt.dwa_value(rows, "2026-Q2", "NWA", "D11", "EUR", "N")
        with self.assertRaises(pt.PatrimonialeError):
            pt.dwa_value(rows + [rows[0]], "2026-Q2", "NWA", "_Z", "EUR", "N")

    def test_value_refuses_an_unexpected_unit_multiplier(self) -> None:
        rows = toy_rows()
        rows[0] = {**rows[0], "UNIT_MULT": "3"}
        with self.assertRaisesRegex(pt.PatrimonialeError, "UNIT_MULT"):
            pt.dwa_value(rows, "2026-Q2", "NWA", "_Z", "EUR", "N")

    def test_households_follow_from_total_and_mean(self) -> None:
        # 11.590.488,88 milioni / 462,57 migliaia per famiglia = 25,06 milioni di famiglie.
        self.assertAlmostEqual(pt.households(11590488.88, 462.57), 25.057, places=3)

    def test_distribution_deciles_must_add_up_to_the_total(self) -> None:
        rows = toy_rows()
        with self.assertRaisesRegex(pt.PatrimonialeError, "fasce"):
            pt.distribution(rows, "2026-Q2")


class ParetoTests(unittest.TestCase):
    def test_alpha_from_threshold_and_mean_of_the_top_decile(self) -> None:
        # Pareto: media sopra la soglia = soglia * a / (a - 1).
        alpha = pt.pareto_alpha(785.07, 2802.65)
        self.assertAlmostEqual(alpha, 1.3891, places=4)
        self.assertAlmostEqual(785.07 * alpha / (alpha - 1), 2802.65, places=6)

    def test_alpha_refuses_a_mean_not_above_the_threshold(self) -> None:
        with self.assertRaises(pt.PatrimonialeError):
            pt.pareto_alpha(800.0, 700.0)

    def test_tail_above_a_threshold(self) -> None:
        tail = pt.pareto_tail(threshold_k=785.07, alpha=1.3891, households_m=2.5057)
        at_start = tail(785.07)
        self.assertAlmostEqual(at_start["households"], 2505700, delta=1)
        # La base sopra la soglia di partenza è la ricchezza meno la soglia per ogni famiglia.
        self.assertAlmostEqual(at_start["wealthBn"] - at_start["baseBn"], 2505700 * 785.07 / 1e6, delta=0.5)
        one_million = tail(1000.0)
        self.assertLess(one_million["households"], at_start["households"])
        self.assertAlmostEqual(one_million["households"], 2505700 * (785.07 / 1000) ** 1.3891, delta=1)
        with self.assertRaises(pt.PatrimonialeError):
            tail(500.0)

    def test_top5_check_compares_the_model_with_the_published_share(self) -> None:
        check = pt.top5_check(alpha=1.3891, threshold_k=785.07, households_m=25.057, total_bn=11590.49, published_pct=50.29)
        self.assertAlmostEqual(check["modelPct"], 49.9, delta=0.3)
        self.assertLess(abs(check["gapPts"]), 1.0)


class ScenarioTests(unittest.TestCase):
    def test_every_cell_is_a_hypothesis_and_follows_from_its_parameters(self) -> None:
        tail = pt.pareto_tail(threshold_k=785.07, alpha=1.3891, households_m=2.5057)
        grid = pt.scenario_grid(tail, thresholds_k=[1000, 5000], rates_pct=[0.5, 2])
        self.assertEqual(len(grid), 4)
        for cell in grid:
            self.assertEqual(cell["kind"], "scenario")
            base = tail(cell["thresholdK"])["baseBn"]
            self.assertAlmostEqual(cell["revenueBn"], round(base * cell["ratePct"] / 100, 2), places=2)
        low = next(c for c in grid if c["thresholdK"] == 5000 and c["ratePct"] == 0.5)
        high = next(c for c in grid if c["thresholdK"] == 1000 and c["ratePct"] == 2)
        self.assertLess(low["revenueBn"], high["revenueBn"])

    def test_erosion_reduces_the_base_and_is_declared(self) -> None:
        tail = pt.pareto_tail(threshold_k=785.07, alpha=1.3891, households_m=2.5057)
        grid = pt.scenario_grid(tail, thresholds_k=[1000], rates_pct=[1], erosion_pct=[0, 30])
        full, eroded = sorted(grid, key=lambda c: c["erosionPct"])
        self.assertAlmostEqual(eroded["revenueBn"], round(full["baseBn"] * 0.7 * 0.01, 2), places=2)

    def test_progressive_schedule_taxes_each_slice_at_its_rate(self) -> None:
        tail = pt.pareto_tail(threshold_k=785.07, alpha=1.3891, households_m=2.5057)
        schedule = [{"fromK": 1000, "ratePct": 1.0}, {"fromK": 5000, "ratePct": 2.0}]
        result = pt.progressive_revenue(tail, schedule)
        expected = (tail(1000)["baseBn"] - tail(5000)["baseBn"]) * 0.01 + tail(5000)["baseBn"] * 0.02
        self.assertAlmostEqual(result["revenueBn"], round(expected, 2), places=2)


class SourceLockTests(unittest.TestCase):
    def test_every_artefact_has_url_hash_and_path(self) -> None:
        spec = json.loads(SPEC.read_text(encoding="utf-8"))
        for key, entry in spec["artefacts"].items():
            self.assertRegex(entry["sha256"], r"^[0-9a-f]{64}$", key)
            self.assertTrue(entry["url"].startswith("https://"), key)
            self.assertTrue(entry["path"].startswith(".cache/patrimoniale/") or entry["path"].startswith("src/data/generated/"), key)
            path = ROOT / entry["path"]
            # CI has no cache: the lock is still checked whenever the file is here.
            if path.exists():
                self.assertEqual(pt.sha256(path.read_bytes()), entry["sha256"], key)

    def test_scenarios_and_sources_are_declared(self) -> None:
        spec = json.loads(SPEC.read_text(encoding="utf-8"))
        self.assertTrue(spec["scenarios"]["note"].startswith("Ipotesi"))
        self.assertTrue(all(source["url"].startswith("https://") for source in spec["sources"]))
        self.assertTrue(all(math.isfinite(value) for value in spec["scenarios"]["ratesPct"]))


class SourceReaderTests(unittest.TestCase):
    def test_every_fact_quotes_its_value(self) -> None:
        spec = json.loads(SPEC.read_text(encoding="utf-8"))
        for fact in spec["facts"]:
            self.assertIn(pt.compact(fact["valueText"]), pt.compact(fact["phrase"]), fact["id"])
            self.assertIn(fact["artefact"], spec["artefacts"], fact["id"])

    def test_regions_must_add_up_to_the_national_total(self) -> None:
        table = [{"body": [
            {"stile": "", "celle": ["Lazio", "600", "0.9"]},
            {"stile": "", "celle": ["Puglia", "200", "0.9"]},
            {"stile": "subtotale", "celle": ["Sud Totale ", "800", "0.9"]},
            {"stile": "", "celle": ["Italia", "800", "0.9"]},
        ]}]
        self.assertEqual([r["region"] for r in pt.region_values(table)], ["Lazio", "Puglia"])
        table[0]["body"][-1]["celle"][1] = "900"
        with self.assertRaisesRegex(pt.PatrimonialeError, "regioni"):
            pt.region_values(table)

    def test_oecd_ranking_takes_the_latest_year_and_names_every_country(self) -> None:
        def r(area: str, year: str, value: str) -> dict[str, str]:
            return {"REF_AREA": area, "SECTOR": "S13", "STANDARD_REVENUE": "T_4200", "UNIT_MEASURE": "PT_B1GQ", "TIME_PERIOD": year, "OBS_VALUE": value}
        rows = [r("CHE", "2023", "1.3"), r("CHE", "2024", "1.34"), r("GRC", "2023", "0.58"), r("ITA", "2024", "0.01"), r("USA", "2024", "0")]
        ranking = pt.oecd_ranking(rows, {"CHE": "Svizzera", "GRC": "Grecia", "ITA": "Italia"}, 2024)
        self.assertEqual([(x["code"], x["year"]) for x in ranking], [("CHE", 2024), ("GRC", 2023), ("ITA", 2024)])
        with self.assertRaisesRegex(pt.PatrimonialeError, "nome"):
            pt.oecd_ranking(rows, {"CHE": "Svizzera"}, 2024)

    def test_avs_schedule_is_read_from_the_quoted_brackets(self) -> None:
        facts = {"avsSoglia": 5400000, "avsAliquota1": 1.7, "avsAliquota2": 2.1, "avsAliquota3": 3.5}
        schedule = pt.avs_schedule(facts, upper_first=2100000, upper_second=4600000)
        self.assertEqual(schedule, [{"fromK": 5400.0, "ratePct": 1.7}, {"fromK": 7500.0, "ratePct": 2.1}, {"fromK": 10000.0, "ratePct": 3.5}])


if __name__ == "__main__":
    unittest.main()
