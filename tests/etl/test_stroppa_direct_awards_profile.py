import importlib.util
import json
import tempfile
import unittest
from pathlib import Path


ROOT = Path(__file__).resolve().parents[2]
SCRIPT = ROOT / "scripts/research/profile_stroppa_direct_awards.py"
FIXTURES = ROOT / "tests/fixtures/stroppa"
SPEC = importlib.util.spec_from_file_location("stroppa_profile", SCRIPT)
MODULE = importlib.util.module_from_spec(SPEC)
assert SPEC and SPEC.loader
SPEC.loader.exec_module(MODULE)


class StroppaDirectAwardsProfileTest(unittest.TestCase):
    def test_profiles_missingness_date_precision_and_derived_signals(self):
        result = MODULE.profile(
            FIXTURES / "affidamenti-diretti.tsv",
            FIXTURES / "affidamenti-diretti.json",
            None,
            None,
        )
        self.assertEqual(result["records"], 4)
        self.assertEqual(result["coverage"]["amountPresent"], 3)
        self.assertEqual(result["coverage"]["amountMissing"], 1)
        self.assertEqual(result["coverage"]["amountKnownSubsetCents"], 60_000)
        self.assertEqual(result["coverage"]["datePrecision"]["possible_year_default"], 1)
        self.assertEqual(result["coverage"]["datePrecision"]["month_only"], 1)
        self.assertEqual(result["coverage"]["repeatedUrlGroups"], 1)
        self.assertEqual(result["derivedSignals"]["directAwardPhrase"], 1)
        self.assertEqual(result["derivedSignals"]["article50Phrase"], 1)
        self.assertEqual(result["derivedSignals"]["directNegotiationPhrase"], 1)
        self.assertEqual(result["derivedSignals"]["eventOrCampaignCandidate"], 1)
        self.assertEqual(result["derivedSignals"]["ruleVersion"], "stroppa-direct-award-text-v1")
        self.assertFalse(result["sidePopulations"]["includedInMaster"])
        self.assertIn("license_not_verified", result["boundaries"])

    def test_fails_closed_on_row_level_divergence(self):
        payload = json.loads((FIXTURES / "affidamenti-diretti.json").read_text())
        payload["items"][0]["cig"] = "B999999999"
        with tempfile.TemporaryDirectory() as directory:
            changed = Path(directory) / "changed.json"
            changed.write_text(json.dumps(payload), encoding="utf-8")
            with self.assertRaisesRegex(ValueError, "divergono"):
                MODULE.profile(FIXTURES / "affidamenti-diretti.tsv", changed, None, None)


if __name__ == "__main__":
    unittest.main()
