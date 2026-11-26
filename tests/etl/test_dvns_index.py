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
        self.assertAlmostEqual(etl.weighted_score({"resa": 80.0, "sovraspesa": 60.0, "investire": 40.0, "appalti": 20.0}, RULES["weights"]),
                               80 * 0.5 + 60 * 0.15 + 40 * 0.2 + 20 * 0.15)

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
