import importlib.util
import json
import unittest
from pathlib import Path


ROOT = Path(__file__).resolve().parents[2]
SCRIPT = ROOT / "scripts/etl/build_stroppa_vive_campaign.py"
SPEC_PATH = ROOT / "scripts/etl/specs/stroppa-vive-editorial-campaign.json"
DATA_PATH = ROOT / "src/data/generated/stroppa-vive-campaign.data.json"
META_PATH = ROOT / "src/data/generated/stroppa-vive-campaign.meta.json"
SPEC = importlib.util.spec_from_file_location("stroppa_vive_campaign", SCRIPT)
MODULE = importlib.util.module_from_spec(SPEC)
assert SPEC and SPEC.loader
SPEC.loader.exec_module(MODULE)


class StroppaViveCampaignTest(unittest.TestCase):
    def test_committed_snapshot_is_deterministic_and_normalizes_amount_basis(self):
        spec = json.loads(SPEC_PATH.read_text())
        snapshot, meta = MODULE.build(spec)
        data_bytes = MODULE.canonical_bytes(snapshot)
        meta["sourceSpecSha256"] = MODULE.digest_bytes(SPEC_PATH.read_bytes())
        meta["snapshotSha256"] = MODULE.digest_bytes(data_bytes)

        self.assertEqual(data_bytes, DATA_PATH.read_bytes())
        self.assertEqual(MODULE.canonical_bytes(meta), META_PATH.read_bytes())
        self.assertEqual(meta["packageAmountBasisObserved"], {"gross": 2, "net": 3})
        self.assertEqual(snapshot["benchmarkCohorts"][0]["summary"]["medianCents"], 249_575)
        self.assertEqual(snapshot["benchmarkCohorts"][0]["denominator"]["includedRecords"], 4)
        self.assertEqual(len(snapshot["shareCards"]), 4)

    def test_fails_closed_on_amount_or_scope_drift(self):
        spec = json.loads(SPEC_PATH.read_text())
        spec["records"][0]["grossCents"] += 1
        with self.assertRaisesRegex(ValueError, "non riconciliati"):
            MODULE.build(spec)

        spec = json.loads(SPEC_PATH.read_text())
        spec["records"][4]["includedInBenchmark"] = True
        with self.assertRaisesRegex(ValueError, "inclusione benchmark incoerente"):
            MODULE.build(spec)


if __name__ == "__main__":
    unittest.main()
