"""Offline checks for the six pinned OpenCivitas FC50 per-function 2018 snapshots."""
from __future__ import annotations

import json
import unittest

from opencivitas_common import StructuralError
from opencivitas_function_release import (
    non_positive_standard,
    semantic_digest,
    validate_snapshot,
    verify_national_totals,
)
from opencivitas_2018_amministrazione_snapshot import RELEASE as AMMINISTRAZIONE
from opencivitas_2018_istruzione_snapshot import RELEASE as ISTRUZIONE
from opencivitas_2018_polizia_snapshot import RELEASE as POLIZIA
from opencivitas_2018_rifiuti_snapshot import RELEASE as RIFIUTI
from opencivitas_2018_sociale_asili_snapshot import RELEASE as SOCIALE_ASILI
from opencivitas_2018_viabilita_snapshot import RELEASE as VIABILITA
from opencivitas_2019_istruzione_snapshot import RELEASE as ISTRUZIONE_2019

# family, function, published Comuni, ISTAT codes excluded by contract
EXPECTED = {
    ISTRUZIONE: ("FC50ISTRUZ", "ISTRUZIONE", 6584, {"008045", "101014", "063019", "065081", "004039", "010022", "094013", "014006"}),
    POLIZIA: ("FC50POLIZIA", "POLIZIA", 6594, set()),
    VIABILITA: ("FC50TERRVIAB", "TERR_VIAB", 6594, set()),
    RIFIUTI: ("FC50RIFIUTI", "RIFIUTI", 6606, set()),
    SOCIALE_ASILI: ("FC50SOCNID", "SOCIALE E NIDO", 6590, {"004222", "101014", "065036", "065081"}),
    AMMINISTRAZIONE: ("FC50AMMIN", "AMMINISTRAZIONE", 6586, set()),
}


def load(release) -> dict:
    return json.loads(release.output.read_text(encoding="utf-8"))


def rows(snapshot: dict) -> list[dict]:
    return [dict(zip(snapshot["municipalityColumns"], row)) for row in snapshot["municipalityRows"]]


class OpenCivitas2018FunctionsSnapshotTest(unittest.TestCase):
    def test_committed_snapshots_match_semantic_pins_and_coverage(self) -> None:
        for release, (family, function, municipalities, excluded) in EXPECTED.items():
            with self.subTest(family=family):
                snapshot = load(release)
                validate_snapshot(release, snapshot)
                self.assertEqual(semantic_digest(snapshot), release.semantic_sha256)
                self.assertEqual(snapshot["referenceYear"], 2018)
                self.assertEqual(snapshot["publishedAt"], "2022-02-14")
                self.assertEqual(snapshot["source"]["family"], family)
                self.assertEqual(snapshot["coverage"]["function"], function)
                self.assertEqual(snapshot["coverage"]["municipalities"], municipalities)
                self.assertFalse({row["istatCode"] for row in rows(snapshot)} & excluded)
                self.assertIn("FC50TOT 2018", snapshot["methodology"]["functionSeparationWarning"])
                self.assertTrue(all(row["standardSpendingCents"] > 0 for row in rows(snapshot)))

    def test_a_2018_release_is_not_accepted_as_its_2019_counterpart(self) -> None:
        with self.assertRaises(StructuralError):
            validate_snapshot(ISTRUZIONE_2019, load(ISTRUZIONE))

    def test_pre_release_acquisition_is_rejected(self) -> None:
        snapshot = load(POLIZIA)
        snapshot["generatedAt"] = snapshot["source"]["observedAt"] = "2022-01-01T00:00:00Z"
        with self.assertRaises(StructuralError):
            validate_snapshot(POLIZIA, snapshot)

    def test_national_totals_stay_pinned_including_the_non_reproportioned_function(self) -> None:
        for release in EXPECTED:
            with self.subTest(family=release.family):
                spec = release.spec
                excluded = spec["nationalTotals"]["standardSpendingCentsExcluded"]
                published = rows(load(release))
                verify_national_totals(release, spec, published, excluded)
                drifted = [dict(row) for row in published]
                drifted[0]["historicalSpendingCents"] += 10 ** 6
                with self.assertRaises(StructuralError):
                    verify_national_totals(release, spec, drifted, excluded)
        socnid = SOCIALE_ASILI.spec["nationalTotals"]
        self.assertFalse(socnid["reproportioned"])
        self.assertGreater(socnid["standardSpendingCentsPublished"], socnid["historicalSpendingCents"])
        self.assertTrue(all(release.spec["nationalTotals"]["reproportioned"] for release in EXPECTED if release is not SOCIALE_ASILI))

    def test_missing_service_is_excluded_not_published_as_zero_need(self) -> None:
        cell = lambda value: {"value": value, "anomaly": "", "privacy": ""}
        self.assertTrue(non_positive_standard({"FST_RIPROPORZIONATO_BI": cell("0")}, ","))
        self.assertFalse(non_positive_standard({"FST_RIPROPORZIONATO_BI": cell("12,5")}, ","))
        self.assertEqual(ISTRUZIONE.spec["excludedNonPositiveStandard"], ["CN039SIF11GT", "GE022SIF11WI", "IS013SIF11DF", "SO006SIF11GI"])
        self.assertIn("cod_no_servizio", load(ISTRUZIONE)["methodology"]["coverageWarning"])
        for release in EXPECTED:
            if release is not ISTRUZIONE:
                self.assertEqual(release.spec["excludedNonPositiveStandard"], [])

    def test_all_2018_releases_are_utf8_and_rifiuti_has_no_privacy_column(self) -> None:
        for release in EXPECTED:
            self.assertEqual(release.spec["csvEncoding"], "utf-8-sig")
        self.assertNotIn("Privacy", RIFIUTI.spec["csvHeaders"])


if __name__ == "__main__":
    unittest.main()
