from __future__ import annotations

from fractions import Fraction
import tempfile
import gzip
import hashlib
import json
from pathlib import Path
from unittest.mock import patch
import unittest

import anac_procurement_peers as peers


class ProcurementPeersTests(unittest.TestCase):
    def test_failed_publish_restores_previous_artifact(self):
        for existing in (False, True):
            with self.subTest(existing=existing), tempfile.TemporaryDirectory() as temporary:
                output = Path(temporary) / "output"
                if existing:
                    output.mkdir()
                    (output / "previous").write_text("preserved")
                snapshot = {"municipalProfiles": 0, "ambiguousProfilesExcluded": 0}
                with patch.object(peers, "OUTPUT", output), patch.object(peers, "derive", return_value=snapshot), patch.object(peers, "verify_output", side_effect=[None, ValueError("failed post-publish check")]):
                    with self.assertRaises(ValueError):
                        peers.build()
                self.assertEqual(output.exists(), existing)
                if existing:
                    self.assertEqual((output / "previous").read_text(), "preserved")

    def test_real_profile_keeps_missing_population_distinct_and_rejects_wrong_cpv_cohort(self):
        code = "c_l780"
        shard = hashlib.sha256(code.encode()).hexdigest()[:2]
        def record(path):
            with gzip.open(path, "rt", encoding="utf-8") as stream:
                return next(r for line in stream if (r := json.loads(line))["codiceIpa"] == code)
        profile = record(peers.ROOT / f"src/data/generated/anac-entity-procurement-page/entities/{shard}.jsonl.gz")
        classification = record(peers.ROOT / f"src/data/generated/anac-procurement-cpv/{shard}.jsonl.gz")
        geography = json.loads((peers.ROOT / peers.INPUTS["geography"]).read_text())
        municipality = next(r for y in geography["years"] if y["year"] == 2025 for r in y["rows"] if r[1] == profile["codiceFiscaleEnte"])
        derived = peers.derive_row(profile, classification, municipality)
        self.assertEqual(derived["population"], 19511)
        self.assertEqual(derived["count"]["hhi10000"], {"numerator": "30000", "denominator": "169"})
        for population, year in ((None, None), (19511, 2023)):
            changed = list(municipality)
            changed[5:7] = [population, year]
            self.assertIsNone(peers.derive_row(profile, classification, changed)["population"])
        changed = list(municipality)
        changed[5] = 0
        with self.assertRaises(peers.cpv.ContractError):
            peers.derive_row(profile, classification, changed)
        with self.assertRaises(peers.cpv.ContractError):
            peers.derive_row(profile, {**classification, "procedures": []}, municipality)

    def test_exact_metrics_preserve_subcent_and_large_amounts(self):
        amounts = [Fraction("9999999999999999.000001"), Fraction("0.000001")]
        metrics = peers.metrics(amounts, 30)
        total = sum(amounts)
        self.assertEqual(metrics["top1Share"], peers.ratio(amounts[0] / total))
        self.assertEqual(metrics["top10Share"], {"numerator": "1", "denominator": "1"})
        self.assertEqual(metrics["hhi10000"], peers.ratio(sum(n * n for n in amounts) * 10000 / (total * total)))

    def test_missing_and_insufficient_denominators_are_not_zero(self):
        self.assertIsNone(peers.metrics([Fraction(1)], 29))
        self.assertIsNone(peers.metrics([], 30))
        self.assertIsNone(peers.metrics([Fraction(0)], 30))
        self.assertIsNotNone(peers.metrics([Fraction(1)], 30))

    def test_top_ten_uses_exact_weights_and_is_independent_of_order(self):
        amounts = [Fraction(i) for i in range(1, 13)]
        metric = peers.metrics(amounts, 30)
        self.assertEqual(metric, peers.metrics(list(reversed(amounts)), 30))
        self.assertEqual(metric["top10Share"], peers.ratio(Fraction(75, 78)))


if __name__ == "__main__":
    unittest.main()
