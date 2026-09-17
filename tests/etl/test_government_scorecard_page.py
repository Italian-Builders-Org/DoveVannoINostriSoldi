import copy
import importlib.util
import unittest
from pathlib import Path


ROOT = Path(__file__).resolve().parents[2]
MODULE_PATH = ROOT / "scripts/etl/government_scorecard_page.py"
SPEC = importlib.util.spec_from_file_location("government_scorecard_page", MODULE_PATH)
MODULE = importlib.util.module_from_spec(SPEC)
assert SPEC.loader is not None
SPEC.loader.exec_module(MODULE)


class GovernmentScorecardPageTests(unittest.TestCase):
    def setUp(self):
        self.snapshot = MODULE._load(MODULE.OUTPUT)

    def test_committed_snapshot_satisfies_offline_contract(self):
        MODULE.validate(self.snapshot)

    def test_upstream_flags_remain_visible_as_publication_status(self):
        self.assertEqual(MODULE._publication_status(None), "observed")
        self.assertEqual(MODULE._publication_status("d"), "observed")
        self.assertEqual(MODULE._publication_status("p"), "provisional")
        self.assertEqual(MODULE._publication_status("e"), "estimated")
        self.assertEqual(MODULE._publication_status("ep"), "estimated")

    def test_validation_rejects_interpolation_and_context_evidence_without_status(self):
        interpolated = copy.deepcopy(self.snapshot)
        interpolated["series"][0]["geographies"][0]["points"][0]["status"] = "interpolated"
        with self.assertRaises(MODULE.SupplementalSnapshotError):
            MODULE.validate(interpolated)

        unsupported = copy.deepcopy(self.snapshot)
        empty = next(
            slide
            for context in unsupported["contexts"]
            for slide in context["slides"]
            if slide["status"] == "empty"
        )
        empty["source_url"] = "https://example.com/unsupported"
        with self.assertRaises(MODULE.SupplementalSnapshotError):
            MODULE.validate(unsupported)

        changed_evidence = copy.deepcopy(self.snapshot)
        ready = next(
            slide
            for context in changed_evidence["contexts"]
            for slide in context["slides"]
            if slide["status"] == "ready"
        )
        ready["items"][0]["summary"] += " altered"
        with self.assertRaises(MODULE.SupplementalSnapshotError):
            MODULE.validate(changed_evidence)

    def test_debt_per_capita_inputs_share_year_and_reconcile(self):
        debt = next(item for item in self.snapshot["series"] if item["indicator_id"] == "debt_per_capita")
        for geography in debt["geographies"]:
            for point in geography["points"]:
                derivation = point["derivation"]
                self.assertEqual(point["year"], derivation["debt_year"])
                self.assertEqual(point["year"], derivation["population_year"])
                expected = round(derivation["debt_stock_mio_eur"] * 1000 / derivation["population_thousand"], 2)
                self.assertEqual(point["value"], expected)

    def test_score_contract_rejects_a_stale_core_artifact_hash(self):
        stale = copy.deepcopy(self.snapshot)
        stale["score_contract"]["core_artifact_sha256"] = "0" * 64
        with self.assertRaises(MODULE.SupplementalSnapshotError):
            MODULE.validate(stale)


if __name__ == "__main__":
    unittest.main()
