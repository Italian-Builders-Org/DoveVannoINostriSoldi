import copy
import json
import subprocess
import sys
import tempfile
import unittest
from pathlib import Path


ROOT = Path(__file__).resolve().parents[2]
sys.path.insert(0, str(ROOT / "scripts" / "etl"))
import istat_pensions_snapshot as etl  # noqa: E402


SPEC_PATH = ROOT / "scripts/etl/specs/istat-pensions-2012-2022.source.json"
DATA_PATH = ROOT / "src/data/generated/istat-pensions-2012-2022.data.json"
META_PATH = ROOT / "src/data/generated/istat-pensions-2012-2022.meta.json"
PENSIONS_INPUT = Path("/private/tmp/dvns-istat-pensions.csv")
PENSIONERS_INPUT = Path("/private/tmp/dvns-istat-pensioners.csv")
RAW_INPUTS_AVAILABLE = PENSIONS_INPUT.is_file() and PENSIONERS_INPUT.is_file()


class IstatPensionsSnapshotTest(unittest.TestCase):
    @classmethod
    def setUpClass(cls) -> None:
        cls.spec = etl.load_source_spec(SPEC_PATH)
        cls.data = json.loads(DATA_PATH.read_text(encoding="utf-8"))
        cls.metadata = json.loads(META_PATH.read_text(encoding="utf-8"))

    def test_metadata_counts_and_reconciliations_follow_territorial_rows(self) -> None:
        metadata = etl.build_metadata(self.data, self.spec, etl.canonical_bytes(self.data))
        self.assertEqual(metadata["transformation"]["pensionBenefitsRows"], 12224)
        self.assertEqual(metadata["transformation"]["pensionerRows"], 1537)
        incomplete = copy.deepcopy(self.data)
        incomplete["pensionBenefits"]["amountReconciliations"].pop()
        with self.assertRaisesRegex(etl.SnapshotError, "riconciliazioni incomplete"):
            etl.validate_snapshot(incomplete)
        forged = copy.deepcopy(self.data)
        row = forged["pensionBenefits"]["amountReconciliations"][0]
        row["totalCount"] += 1
        row["categoryCount"] += 1
        with self.assertRaisesRegex(etl.SnapshotError, "non coerente con le righe"):
            etl.validate_snapshot(forged)

    def test_source_lock_and_committed_pair_validate_offline(self) -> None:
        etl.validate_snapshot(self.data)
        self.assertEqual(etl.canonical_lock_sha256(self.spec), self.spec["integrity"]["lockSha256"])
        self.assertEqual(self.metadata["integrity"]["sourceLockSha256"], self.spec["integrity"]["lockSha256"])
        result = subprocess.run(
            [sys.executable, "scripts/etl/istat_pensions_snapshot.py", "--check"],
            cwd=ROOT,
            capture_output=True,
            text=True,
            check=False,
        )
        self.assertEqual(result.returncode, 0, result.stderr)

    def test_exact_coverage_and_domain_separation(self) -> None:
        benefits = self.data["pensionBenefits"]["observations"]
        pensioners = self.data["pensioners"]["observations"]
        # Lo snapshot copre 142 territori; il nazionale resta 88 e 11 righe.
        self.assertEqual(len(benefits), 12224)
        self.assertEqual(len(pensioners), 1537)
        self.assertEqual(len([r for r in benefits if r["territory"] == "IT"]), 88)
        self.assertEqual(len([r for r in pensioners if r["territory"] == "IT"]), 11)
        self.assertEqual({row["pensionType"] for row in benefits}, set(etl.PENSION_CATEGORIES))
        self.assertEqual({row["year"] for row in pensioners if row["territory"] == "IT"}, set(etl.PENSION_YEARS))
        self.assertTrue(all("pensionCount" in row and "pensionerCount" not in row for row in benefits))
        self.assertTrue(all("pensionerCount" in row and "pensionCount" not in row for row in pensioners))
        self.assertEqual(next(row for row in benefits if row["territory"] == "IT" and row["year"] == 2022 and row["pensionType"] == "ALL")["pensionCount"], 22365288)
        self.assertEqual(next(row for row in pensioners if row["territory"] == "IT" and row["year"] == 2022)["pensionerCount"], 15759676)

    @unittest.skipUnless(RAW_INPUTS_AVAILABLE, "raw ISTAT acquisition files are not committed fixtures")
    def test_local_raw_inputs_rebuild_the_committed_data(self) -> None:
        rebuilt = etl.build_data(PENSIONS_INPUT.read_bytes(), PENSIONERS_INPUT.read_bytes(), self.spec)
        self.assertEqual(rebuilt, self.data)

    @unittest.skipUnless(RAW_INPUTS_AVAILABLE, "raw ISTAT acquisition files are not committed fixtures")
    def test_raw_hash_and_byte_drift_fail_closed(self) -> None:
        payload = bytearray(PENSIONS_INPUT.read_bytes())
        payload[-1] = ord("\n") if payload[-1] != ord("\n") else ord(" ")
        with self.assertRaises(etl.SnapshotError):
            etl.build_data(bytes(payload), PENSIONERS_INPUT.read_bytes(), self.spec)

    def test_offline_check_rejects_metadata_source_drift(self) -> None:
        with tempfile.TemporaryDirectory() as directory:
            temp_dir = Path(directory)
            temp_data = temp_dir / DATA_PATH.name
            temp_meta = temp_dir / META_PATH.name
            temp_data.write_bytes(DATA_PATH.read_bytes())
            broken_meta = copy.deepcopy(self.metadata)
            broken_meta["source"]["assets"]["pensioners"]["bytes"] += 1
            temp_meta.write_text(json.dumps(broken_meta), encoding="utf-8")
            result = subprocess.run(
                [sys.executable, "scripts/etl/istat_pensions_snapshot.py", "--check", "--data-output", str(temp_data), "--meta-output", str(temp_meta)],
                cwd=ROOT,
                capture_output=True,
                text=True,
                check=False,
            )
            self.assertNotEqual(result.returncode, 0)
            self.assertIn("metadata non legata", result.stderr)

    def test_generation_timestamp_must_match_the_source_lock(self) -> None:
        etl.validate_generation_observed_at(self.spec, "2026-09-12T11:00:00+02:00")
        with self.assertRaises(etl.SnapshotError):
            etl.validate_generation_observed_at(self.spec, "2026-08-31T00:00:00+02:00")

    def test_schema_category_duplicate_year_and_reconciliation_drift_fail_closed(self) -> None:
        broken = copy.deepcopy(self.data)

        broken["pensionBenefits"]["observations"][1]["pensionType"] = "UNKNOWN"
        with self.assertRaises(etl.SnapshotError):
            etl.validate_snapshot(broken)

        broken = copy.deepcopy(self.data)
        broken["pensionBenefits"]["observations"][8]["year"] = 2012
        with self.assertRaises(etl.SnapshotError):
            etl.validate_snapshot(broken)

        broken = copy.deepcopy(self.data)
        broken["pensionBenefits"]["observations"][1] = copy.deepcopy(broken["pensionBenefits"]["observations"][0])
        with self.assertRaises(etl.SnapshotError):
            etl.validate_snapshot(broken)

        broken = copy.deepcopy(self.data)
        broken["pensionBenefits"]["observations"][1]["grossAnnualThousandEuros"] += 100
        with self.assertRaises(etl.SnapshotError):
            etl.validate_snapshot(broken)


if __name__ == "__main__":
    unittest.main()
