import copy
import json
import os
import subprocess
import sys
import unittest
from pathlib import Path


ROOT = Path(__file__).resolve().parents[2]
sys.path.insert(0, str(ROOT / "scripts" / "etl"))
import consip_ordini_snapshot as etl  # noqa: E402


SPEC_PATH = ROOT / "scripts/etl/specs/consip-ordini-2024-2026.source.json"
DATA_PATH = ROOT / "src/data/generated/consip-ordini-2024-2026.data.json"
META_PATH = ROOT / "src/data/generated/consip-ordini-2024-2026.meta.json"
INPUT_DIR = Path(os.environ.get("DVNS_CONSIP_INPUT_DIR", "/private/tmp/dvns-consip-ordini"))
RAW_INPUTS_AVAILABLE = all(
    (INPUT_DIR / f"{prefix}-{year}.csv").is_file()
    for prefix in ("ordini-convenzione", "ordini-mepa")
    for year in (2024, 2025, 2026)
)


class ConsipOrdiniSnapshotTest(unittest.TestCase):
    @classmethod
    def setUpClass(cls) -> None:
        cls.spec = etl.load_source_spec(SPEC_PATH)
        cls.data = json.loads(DATA_PATH.read_text(encoding="utf-8"))
        cls.metadata = json.loads(META_PATH.read_text(encoding="utf-8"))

    def test_source_lock_and_committed_pair_validate_offline(self) -> None:
        etl.validate_snapshot(self.data)
        self.assertEqual(etl.canonical_lock_sha256(self.spec), self.spec["integrity"]["lockSha256"])
        self.assertEqual(self.metadata["integrity"]["sourceLockSha256"], self.spec["integrity"]["lockSha256"])
        result = subprocess.run(
            [sys.executable, "scripts/etl/consip_ordini_snapshot.py", "--check"],
            cwd=ROOT,
            capture_output=True,
            text=True,
            check=False,
        )
        self.assertEqual(result.returncode, 0, result.stderr)

    def test_exact_coverage(self) -> None:
        self.assertEqual(len(self.data["totals"]), 6)
        self.assertEqual({t["year"] for t in self.data["totals"]}, {2024, 2025, 2026})
        self.assertEqual({t["channel"] for t in self.data["totals"]}, {"convenzioni", "mepa"})
        expected_rows = self.spec["expected"]["rows"]
        for total in self.data["totals"]:
            self.assertEqual(total["rows"], expected_rows[f"{total['channel']}-{total['year']}"])

    def test_suppression_reconciles_in_every_observation(self) -> None:
        for section in ("byRegion", "byAdministrationType"):
            for row in self.data[section]:
                self.assertEqual(row["rowsWithAmount"] + row["rowsAmountSuppressed"], row["rows"], row)
                self.assertEqual(row["rowsWithOrders"] + row["rowsOrdersSuppressed"], row["rows"], row)
                self.assertLessEqual(row["rowsWithNegativeAmount"], row["rowsWithAmount"], row)

    def test_mepa_amount_and_orders_are_mutually_exclusive(self) -> None:
        # Proprietà osservata sulla fonte: nei file MEPA ogni riga porta l'importo
        # oppure il conteggio, mai entrambi e mai nessuno dei due. Se un refresh
        # la rompe, la semantica dei limiti inferiori va rivista, non ereditata.
        for row in self.data["byRegion"]:
            if row["channel"] != "mepa":
                continue
            self.assertEqual(row["rowsWithAmount"] + row["rowsWithOrders"], row["rows"], row)

    def test_negative_amounts_are_declared_not_hidden(self) -> None:
        negatives = sum(row["rowsWithNegativeAmount"] for row in self.data["byRegion"])
        self.assertEqual(negatives, 35)
        self.assertTrue(any("negativi" in caveat for caveat in self.data["caveats"]))

    def test_totals_reconcile_with_regional_aggregates(self) -> None:
        for total in self.data["totals"]:
            regional = [
                row for row in self.data["byRegion"]
                if row["year"] == total["year"] and row["channel"] == total["channel"]
            ]
            self.assertEqual(sum(row["rows"] for row in regional), total["rows"])
            self.assertEqual(sum(row["amountKnownCents"] for row in regional), total["amountKnownCents"])

    def test_tampered_reconciliation_fails_closed(self) -> None:
        tampered = copy.deepcopy(self.data)
        tampered["byRegion"][0]["amountKnownCents"] += 1
        with self.assertRaises(etl.SnapshotError):
            etl.validate_snapshot(tampered)

    def test_amount_parser_rejects_drift(self) -> None:
        self.assertEqual(etl._parse_amount_cents("11617,5", "test"), 1161750)
        self.assertEqual(etl._parse_amount_cents("-87004,8", "test"), -8700480)
        for bad in ("1.234,5", "1,234.5", "12,345", "abc", "1 234"):
            with self.assertRaises(etl.SnapshotError, msg=bad):
                etl._parse_amount_cents(bad, "test")

    @unittest.skipUnless(RAW_INPUTS_AVAILABLE, "raw Consip CSV files are not committed fixtures")
    def test_local_raw_inputs_rebuild_the_committed_data(self) -> None:
        inputs = {}
        for channel, prefix in (("convenzioni", "ordini-convenzione"), ("mepa", "ordini-mepa")):
            for year in (2024, 2025, 2026):
                inputs[f"{channel}-{year}"] = (INPUT_DIR / f"{prefix}-{year}.csv").read_bytes()
        rebuilt = etl.build_data(inputs, self.spec)
        self.assertEqual(rebuilt, self.data)


if __name__ == "__main__":
    unittest.main()
