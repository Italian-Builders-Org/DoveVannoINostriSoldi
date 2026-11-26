"""DVNS Index rules: each test pins a choice that changes rankings if it drifts."""

from __future__ import annotations

import json
import sys
import unittest
from pathlib import Path

ROOT = Path(__file__).resolve().parents[2]
sys.path.insert(0, str(ROOT / "scripts" / "etl"))

import dvns_index as etl  # noqa: E402

SPEC = json.loads(etl.DEFAULT_SPEC.read_text(encoding="utf-8"))
RULES = SPEC["rules"]


class RuleTests(unittest.TestCase):
    def test_spending_more_for_more_services_is_not_penalised(self) -> None:
        # Bologna 2022: +31,9% over the need, +65,1% services: nothing unjustified.
        self.assertEqual(etl.unjustified_spending(31.9, 65.1), 0.0)
        # Over the need with services below average: the whole excess counts.
        self.assertAlmostEqual(etl.unjustified_spending(15.6, -4.3), 15.6)
        # Over the need, services above average but less than the excess: only the gap counts.
        self.assertAlmostEqual(etl.unjustified_spending(101.7, 50.7), 51.0)
        # Spending below the need is never a penalty.
        self.assertEqual(etl.unjustified_spending(-20.0, -40.0), 0.0)

    def test_underspending_counts_only_when_suppliers_are_paid_on_time(self) -> None:
        # Spends 25% under the need with average services and pays on time: efficiency.
        self.assertEqual(etl.resa_value(-25.0, 0.0, True), 25.0)
        # Same numbers, pays 40 days late: likely short of cash, only the services count.
        self.assertEqual(etl.resa_value(-25.0, 0.0, False), 0.0)
        # No payment data: no evidence of distress, the spending counts.
        self.assertEqual(etl.resa_value(-25.0, 0.0, None), 25.0)
        # Overspending always counts, late payer or not.
        self.assertEqual(etl.resa_value(30.0, 10.0, False), -20.0)

    def test_services_that_jump_between_years_are_suspect(self) -> None:
        # Craco: +373% services in 2021, +50% in 2022.
        self.assertTrue(etl.volatile_services(373.2, 49.8, 100))
        self.assertFalse(etl.volatile_services(60.0, 65.1, 100))
        self.assertFalse(etl.volatile_services(None, 49.8, 100))

    def test_payments_far_before_the_due_date_are_recording_errors(self) -> None:
        # Terms are 30 or 60 days from the invoice: paying 771 days early means paying before the invoice.
        self.assertIsNone(etl.plausible_delay(-770.8, 60))
        self.assertIsNone(etl.plausible_delay(-60.1, 60))
        self.assertEqual(etl.plausible_delay(-60.0, 60), -60.0)
        self.assertEqual(etl.plausible_delay(53.0, 60), 53.0)

    def test_italian_numbers(self) -> None:
        self.assertEqual(etl.italian_number("1.234,5"), 1234.5)
        self.assertEqual(etl.italian_number("68,2"), 68.2)
        self.assertIsNone(etl.italian_number(""))

    def test_peer_groups_widen_until_enough_comparable_comuni(self) -> None:
        # Rivello: 11 Comuni in the narrowest group, but only 7 with OpenCivitas data.
        groups = {
            ("a",): ["rivello"] + [f"rso{i}" for i in range(6)] + [f"special{i}" for i in range(4)],
            ("b",): ["rivello"] + [f"rso{i}" for i in range(40)],
        }
        eligible = {"rivello"} | {f"rso{i}" for i in range(40)}
        key, members = etl.pick_peers("rivello", [("a",), ("b",)], [30, 30], groups, eligible)
        self.assertEqual(key, ("b",))
        self.assertEqual(len(members), 40)
        self.assertNotIn("rivello", members)
        # Comuni without OpenCivitas data never count toward the minimum, and are not peers.
        key, members = etl.pick_peers("rivello", [("a",)], [5], groups, eligible)
        self.assertEqual(key, ("a",))
        self.assertEqual(sorted(members), sorted(f"rso{i}" for i in range(6)))
        # No group large enough: no peers, so no score.
        self.assertEqual(etl.pick_peers("rivello", [("a",)], [30], groups, eligible), (None, []))

    def test_each_indicator_widens_until_enough_peers_have_it(self) -> None:
        narrow = [f"n{i}" for i in range(35)]
        wide = narrow + [f"w{i}" for i in range(60)]
        has = {i: True for i in wide}
        # Only 10 Comuni of the narrow group report the indicator: the wider group is used for it.
        has.update({i: False for i in narrow[10:]})
        chosen = etl.indicator_peers([narrow, wide], lambda i: has[i], 30)
        self.assertIs(chosen, wide)
        self.assertIs(etl.indicator_peers([narrow, wide], lambda i: True, 30), narrow)
        self.assertIsNone(etl.indicator_peers([narrow], lambda i: has[i], 30))

    def test_peer_candidates_list_every_group_large_enough(self) -> None:
        groups = {("a",): ["x"] + [f"r{i}" for i in range(31)], ("b",): ["x"] + [f"r{i}" for i in range(80)], ("c",): ["x", "r1"]}
        eligible = {"x"} | {f"r{i}" for i in range(80)}
        found = etl.peer_candidates("x", [("a",), ("c",), ("b",)], [30, 30, 30], groups, eligible)
        self.assertEqual([key for key, _ in found], [("a",), ("b",)])

    def test_dissesto_rows_are_read_from_the_decree_table(self) -> None:
        text = """          ENTE             PROV.           ABITANTI    DELIBERA     MASSA PASSIVA
ACQUAPPESA(713)             CS      2020       1.838   25/02/2021     3.700.000,00       3.700.000,00        126.313,30
CANICATTI'(739)             AG      2021      34.697   20/04/2022     18.300.000,00     18.300.000,00      2.384.489,99
CARAFFA DI CATANZARO        CZ      2020       1.800   08/01/2020     1.899.543,50       1.899.543,50        123.701,82
   RILEVATO CHE il Comune di Piazza Armerina (EN), pur avendo trasmesso"""
        self.assertEqual(etl.parse_dissesto(text), [("ACQUAPPESA", "CS", 2020), ("CANICATTI'", "AG", 2021), ("CARAFFA DI CATANZARO", "CZ", 2020)])

    def test_dissesto_names_match_only_when_unambiguous(self) -> None:
        names = {"072011": "Canicattì", "080020": "Caraffa di Catanzaro", "001001": "Castro", "002002": "Castro"}
        matched, missing = etl.match_names([("CANICATTI'", "AG", 2021), ("CARAFFA DI CATANZARO", "CZ", 2020), ("CASTRO", "BG", 2019)], names)
        self.assertEqual(matched, ["072011", "080020"])
        self.assertEqual(missing, ["CASTRO"])

    def test_few_observations_move_toward_the_median(self) -> None:
        # 5 procedures all without tender: pulled well below 100%.
        self.assertAlmostEqual(etl.shrink(1.0, 5, 0.77, 8), 0.77 + 0.23 * 5 / 13)
        # Many procedures keep almost the observed value.
        self.assertGreater(etl.shrink(1.0, 400, 0.77, 8), 0.99)

    def test_procedure_classes(self) -> None:
        self.assertEqual(etl.procedure_class("AFFIDAMENTO DIRETTO", RULES), "reduced")
        self.assertEqual(etl.procedure_class("PROCEDURA NEGOZIATA SENZA PREVIA PUBBLICAZIONE", RULES), "reduced")
        self.assertEqual(etl.procedure_class("PROCEDURA APERTA", RULES), "competitive")
        # Consip adhesions and in-house awards are neutral; unknown ND codes are left out.
        self.assertIsNone(etl.procedure_class("AFFIDAMENTO DIRETTO IN ADESIONE AD ACCORDO QUADRO/CONVENZIONE", RULES))
        self.assertIsNone(etl.procedure_class("AFFIDAMENTO DIRETTO A SOCIETA' IN HOUSE", RULES))
        self.assertIsNone(etl.procedure_class("ND P2_19", RULES))

    def test_delegated_procedures_stay_with_the_delegating_comune(self) -> None:
        row = {"FLAG_DELEGA": "1", "CF_SA_DELEGANTE": "00100", "cf_amministrazione_appaltante": "99999"}
        self.assertEqual(etl.procedure_owner(row), "00100")
        row["FLAG_DELEGA"] = "0"
        self.assertEqual(etl.procedure_owner(row), "99999")

    def test_percentile_counts_ties_half_and_refuses_empty_peers(self) -> None:
        self.assertEqual(etl.percentile(5, [1, 5, 9, 10]), 37.5)
        with self.assertRaises(etl.IndexError_):
            etl.percentile(1, [])

    def test_peer_position_counts_every_comune_it_is_compared_with(self) -> None:
        # Gubbio was "1st of 1" when only peers sharing its own group key were counted.
        self.assertEqual(etl.peer_position(67.3, [80.0, 50.0, 67.3, 90.0]), (3, 5))
        self.assertEqual(etl.peer_position(10.0, []), (1, 1))

    def test_rank_interval_excludes_the_extreme_draws(self) -> None:
        self.assertEqual(etl.rank_interval(list(range(1, 101))), (5, 95))
        self.assertEqual(etl.rank_interval([]), (None, None))

    def test_bands_are_quintiles(self) -> None:
        self.assertEqual([etl.band_of(p, 10) for p in range(1, 11)], list("AABBCCDDEE"))

    def test_score_needs_the_core_pillar(self) -> None:
        self.assertIsNone(etl.weighted_score({"investire": 90.0, "appalti": 80.0}, RULES["weights"]))
        w = RULES["weights"]
        full = {"resa": 80.0, "sovraspesa": 60.0, "investire": 40.0, "appalti": 20.0, "puntualita": 70.0, "risultati": 90.0}
        self.assertAlmostEqual(etl.weighted_score(full, w), sum(full[p] * w[p] for p in full))
        # A missing pillar does not count as zero: the other weights are rescaled.
        partial = {key: value for key, value in full.items() if key != "risultati"}
        self.assertAlmostEqual(etl.weighted_score(partial, w), sum(partial[p] * w[p] for p in partial) / (1 - w["risultati"]))

    def test_weights_add_up_and_population_bands(self) -> None:
        self.assertAlmostEqual(sum(RULES["weights"].values()), 1.0)
        self.assertEqual([etl.population_band(p) for p in (999, 1000, 19_999, 99_999, 100_000)], [0, 1, 2, 4, 5])


class SourceLockTests(unittest.TestCase):
    def test_every_artefact_matches_its_lock(self) -> None:
        for key in SPEC["artefacts"]:
            with self.subTest(artefact=key):
                etl.read_locked(SPEC, key)

    def test_a_drifted_artefact_blocks_publication(self) -> None:
        spec = json.loads(json.dumps(SPEC))
        spec["artefacts"]["geography"]["sha256"] = "0" * 64
        with self.assertRaises(etl.IndexError_):
            etl.load_geography(spec)


if __name__ == "__main__":
    unittest.main()
