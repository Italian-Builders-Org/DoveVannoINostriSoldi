import copy
import importlib.util
import re
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

    def test_committed_contexts_match_the_reviewed_catalog(self):
        registry = MODULE._load(MODULE.CHRONOLOGY_PATH)
        self.assertEqual(MODULE.contexts_from_catalog(self.snapshot["contexts"], registry), self.snapshot["contexts"])

    def test_ecb_rate_history_is_ordered_and_ends_at_the_latest_level(self):
        meloni = self.snapshot["contexts"][-1]
        ecb = next(slide for slide in meloni["slides"] if slide["category"] == "eurozone_ecb")
        history = next(item for item in ecb["items"] if item["id"] == "meloni-i:ecb-rate-cycle")["history"]
        dates = [row["date"] for row in history["rows"]]
        self.assertEqual(dates, sorted(set(dates)))
        self.assertEqual(len(dates), 20)
        self.assertEqual((history["rows"][0]["value"], history["rows"][-1]["value"]), ("0,00%", "2,50%"))

    def test_item_history_is_part_of_the_evidence_hash(self):
        changed = copy.deepcopy(self.snapshot)
        ecb = next(slide for slide in changed["contexts"][-1]["slides"] if slide["category"] == "eurozone_ecb")
        item = next(item for item in ecb["items"] if item["id"] == "meloni-i:ecb-rate-cycle")
        item["history"]["rows"][-1]["value"] = "9,99%"
        with self.assertRaises(MODULE.SupplementalSnapshotError):
            MODULE.validate(changed)

    def test_bill_not_yet_law_is_never_presented_as_enacted(self):
        measures = next(slide for slide in self.snapshot["contexts"][-1]["slides"] if slide["category"] == "laws_measures")
        bill = next(item for item in measures["items"] if item["id"] == "meloni-i:measure-2027-budget-bill")
        self.assertIn("non è ancora legge", bill["summary"])

    def test_context_sources_accept_only_exact_official_hosts(self):
        # Suffix matching accepted look-alike domains (CodeQL incomplete URL sanitization).
        for url in (
            "https://evilsupremecourt.gov/opinions",
            "https://fakeistat.it/report",
            "https://evil-europa.eu/eurostat/data",
            "https://ec.europa.eu.evil.example/eurostat/data",
        ):
            with self.subTest(url=url), self.assertRaises(MODULE.SupplementalSnapshotError):
                MODULE._owner(url)
        self.assertEqual(MODULE._owner("https://ec.europa.eu/eurostat/web/main"), "Eurostat")
        self.assertEqual(MODULE._owner("https://ec.europa.eu/commission/presscorner/home"), "Commissione europea")

    def test_context_source_hosts_match_the_runtime_contract(self):
        contract = (ROOT / "src/lib/data/government-scorecard-page-contract.ts").read_text(encoding="utf-8")
        hosts = re.search(r"CONTEXT_SOURCE_HOSTS = new Set\(\[(.*?)\]\)", contract, re.S)
        self.assertIsNotNone(hosts)
        self.assertEqual(set(re.findall(r'"([^"]+)"', hosts.group(1))), set(MODULE.CONTEXT_SOURCE_OWNERS))

    def test_score_contract_rejects_a_stale_core_artifact_hash(self):
        stale = copy.deepcopy(self.snapshot)
        stale["score_contract"]["core_artifact_sha256"] = "0" * 64
        with self.assertRaises(MODULE.SupplementalSnapshotError):
            MODULE.validate(stale)


if __name__ == "__main__":
    unittest.main()
