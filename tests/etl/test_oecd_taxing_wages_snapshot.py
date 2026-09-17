import json
import subprocess
import sys
import tempfile
import unittest
from pathlib import Path

ROOT = Path(__file__).resolve().parents[2]
sys.path.insert(0, str(ROOT / "scripts" / "etl"))
import oecd_taxing_wages_snapshot as etl  # noqa: E402

SPEC_PATH = ROOT / "scripts/etl/specs/oecd-taxing-wages-2000-2025.source.json"
DATA_PATH = ROOT / "src/data/generated/oecd-taxing-wages-2000-2025.data.json"
META_PATH = ROOT / "src/data/generated/oecd-taxing-wages-2000-2025.meta.json"


class OecdTaxingWagesSnapshotTest(unittest.TestCase):
    @classmethod
    def setUpClass(cls) -> None:
        cls.spec = etl.load_spec(SPEC_PATH)
        cls.data = json.loads(DATA_PATH.read_text(encoding="utf-8"))
        cls.metadata = json.loads(META_PATH.read_text(encoding="utf-8"))

    def test_committed_source_lock_and_pair_validate_offline(self) -> None:
        etl.validate_data(self.data, self.spec)
        self.assertEqual(etl.canonical_lock_sha256(self.spec), self.spec["integrity"]["lockSha256"])
        self.assertEqual(self.metadata["integrity"]["sourceLockSha256"], self.spec["integrity"]["lockSha256"])
        result = subprocess.run(
            [sys.executable, "scripts/etl/oecd_taxing_wages_snapshot.py", "--check"],
            cwd=ROOT,
            capture_output=True,
            text=True,
            check=False,
        )
        self.assertEqual(result.returncode, 0, result.stderr)

    def test_italy_2025_profile_and_peer_coverage_are_exact(self) -> None:
        self.assertEqual(self.data["coverage"]["observedCells"], 237)
        latest = self.data["italyObservations"][-1]
        self.assertEqual(latest["year"], 2025)
        self.assertEqual(latest["taxWedgeMillionths"], 45_757_390)
        self.assertEqual(latest["incomeTaxMillionths"], 19_137_574)
        self.assertEqual(self.data["peerObservations"][0]["geo"], "ITA")
        self.assertEqual(len(self.data["peerObservations"]), 55)

    def test_components_reconcile_to_tax_wedge_within_tolerance(self) -> None:
        for year, gap in self.data["reconciliation"]["gapByYearMillionths"].items():
            self.assertLessEqual(abs(gap), 1, year)
        row_2024 = next(row for row in self.data["italyObservations"] if row["year"] == 2024)
        self.assertEqual(row_2024["taxWedgeMillionths"], 46_962_943)
        self.assertEqual(self.data["reconciliation"]["gapByYearMillionths"]["2024"], 0)

    def test_semantics_say_rates_are_not_public_money(self) -> None:
        money = self.metadata["semantics"]["soldi"]
        self.assertFalse(money["applicable"])
        self.assertEqual(money["unit"], "non applicabile")
        self.assertIn("profilo tipo", money["nature"])
        self.assertEqual(self.metadata["semantics"]["provenance"]["license"], "CC-BY-4.0")
        self.assertEqual(self.metadata["source"]["dataflowId"], "DSD_TAX_WAGES_COMP@DF_TW_COMP")

    def test_write_rejects_tampered_hash(self) -> None:
        with tempfile.TemporaryDirectory() as tmp:
            input_dir = Path(tmp)
            for asset in self.spec["source"]["assets"].values():
                # Empty files force a hash mismatch against the lock.
                (input_dir / asset["filename"]).write_bytes(b"")
            result = subprocess.run(
                [
                    sys.executable,
                    "scripts/etl/oecd_taxing_wages_snapshot.py",
                    "--input-dir",
                    str(input_dir),
                    "--write",
                    "--data",
                    str(input_dir / "out.data.json"),
                    "--meta",
                    str(input_dir / "out.meta.json"),
                ],
                cwd=ROOT,
                capture_output=True,
                text=True,
                check=False,
            )
            self.assertNotEqual(result.returncode, 0)
            self.assertTrue(
                "sha256 divergente" in result.stderr or "byte length" in result.stderr,
                result.stderr,
            )


if __name__ == "__main__":
    unittest.main()
