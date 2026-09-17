import copy
import json
import os
import subprocess
import sys
import unittest
from pathlib import Path


ROOT = Path(__file__).resolve().parents[2]
sys.path.insert(0, str(ROOT / "scripts" / "etl"))
import eurostat_gov_main_snapshot as etl  # noqa: E402


SPEC_PATH = ROOT / "scripts/etl/specs/eurostat-gov-main-1995-2025.source.json"
DATA_PATH = ROOT / "src/data/generated/eurostat-gov-main-1995-2025.data.json"
META_PATH = ROOT / "src/data/generated/eurostat-gov-main-1995-2025.meta.json"
PUBLIC_DEBT_PATH = ROOT / "src/data/generated/public-debt.json"
INPUT_DIR = Path(os.environ.get("DVNS_EUROSTAT_GOV_MAIN_INPUT_DIR", "/private/tmp/dvns-eurostat-gov-main"))
RAW_INPUTS_AVAILABLE = all(
    (INPUT_DIR / f"gov_10a_main-{unit}.json").is_file() for unit in ("MIO_EUR", "PC_GDP")
)


class EurostatGovMainSnapshotTest(unittest.TestCase):
    @classmethod
    def setUpClass(cls) -> None:
        cls.spec = etl.load_source_spec(SPEC_PATH)
        cls.data = json.loads(DATA_PATH.read_text(encoding="utf-8"))
        cls.metadata = json.loads(META_PATH.read_text(encoding="utf-8"))

    def by_cell(self, data=None):
        return {(o["year"], o["naItem"]): o for o in (data or self.data)["observations"]}

    def test_source_lock_and_committed_pair_validate_offline(self) -> None:
        etl.validate_snapshot(self.data)
        self.assertEqual(etl.canonical_lock_sha256(self.spec), self.spec["integrity"]["lockSha256"])
        self.assertEqual(self.metadata["integrity"]["sourceLockSha256"], self.spec["integrity"]["lockSha256"])
        result = subprocess.run(
            [sys.executable, "scripts/etl/eurostat_gov_main_snapshot.py", "--check"],
            cwd=ROOT,
            capture_output=True,
            text=True,
            check=False,
        )
        self.assertEqual(result.returncode, 0, result.stderr)

    def test_coverage_is_complete_and_declared(self) -> None:
        expected = self.spec["expected"]["cellsPerUnit"]
        self.assertEqual(expected, 24 * 31)
        self.assertEqual(self.data["coverage"]["expectedCells"], expected)
        self.assertEqual(self.data["coverage"]["observedCells"], expected)
        self.assertEqual({o["year"] for o in self.data["observations"]}, set(range(1995, 2026)))
        self.assertEqual([item["code"] for item in self.data["items"]], list(etl.PUBLISHED_ITEMS))

    def test_every_cell_is_present_exactly_once(self) -> None:
        cells = self.by_cell()
        self.assertEqual(len(cells), len(self.data["observations"]), "osservazioni duplicate")
        for year in range(1995, 2026):
            for code in etl.PUBLISHED_ITEMS:
                self.assertIn((year, code), cells)

    def test_published_totals_are_not_recomputed_from_the_components(self) -> None:
        cells = self.by_cell()
        gaps = {"revenue": [], "expenditure": [], "balance": []}
        for year in range(1995, 2026):
            row = {code: cells[(year, code)]["amountCents"] for code in etl.PUBLISHED_ITEMS}
            gaps["revenue"].append(abs(row["TR"] - sum(row[c] for c in etl.REVENUE_COMPONENTS)))
            gaps["expenditure"].append(abs(row["TE"] - sum(row[c] for c in etl.EXPENDITURE_COMPONENTS)))
            gaps["balance"].append(abs(row["TR"] - row["TE"] - row["B9"]))
        tolerance = self.data["reconciliation"]["toleranceCents"]
        for identity, values in gaps.items():
            self.assertLessEqual(max(values), tolerance, f"{identity}: scarto oltre il solo arrotondamento")
            self.assertEqual(max(values), self.data["reconciliation"][identity]["maxGapCents"])
        # Se i totali fossero stati ricostruiti dalle componenti ogni scarto sarebbe zero.
        self.assertGreater(max(gaps["revenue"] + gaps["expenditure"]), 0)

    def test_amounts_are_integers_and_signed_only_where_sec_allows(self) -> None:
        for observation in self.data["observations"]:
            for field in ("amountCents", "shareOfGdpHundredths"):
                self.assertIsInstance(observation[field], int, observation)
                self.assertNotIsInstance(observation[field], bool)
                if observation["naItem"] not in etl.SIGNED_ITEMS:
                    self.assertGreaterEqual(observation[field], 0, observation)
        self.assertTrue(any(o["amountCents"] < 0 for o in self.data["observations"] if o["naItem"] == "B9"))

    def test_negative_value_on_unsigned_item_fails_closed(self) -> None:
        tampered = copy.deepcopy(self.data)
        next(o for o in tampered["observations"] if o["naItem"] == "D1PAY")["amountCents"] = -1
        with self.assertRaises(etl.SnapshotError):
            etl.validate_snapshot(tampered)

    def test_tampered_identity_fails_closed(self) -> None:
        tampered = copy.deepcopy(self.data)
        next(o for o in tampered["observations"] if o["naItem"] == "TR")["amountCents"] += etl.TOLERANCE_CENTS * 10
        with self.assertRaises(etl.SnapshotError):
            etl._reconcile(tampered["observations"])

    def test_memo_item_cannot_exceed_its_parent(self) -> None:
        tampered = copy.deepcopy(self.data)
        cells = self.by_cell(tampered)
        cells[(2025, "D41PAY")]["amountCents"] = cells[(2025, "D4PAY")]["amountCents"] + 1
        with self.assertRaises(etl.SnapshotError):
            etl._reconcile(tampered["observations"])

    def test_missing_cell_fails_closed(self) -> None:
        tampered = copy.deepcopy(self.data)
        tampered["observations"].pop()
        with self.assertRaises(etl.SnapshotError):
            etl.validate_snapshot(tampered)

    def test_public_debt_invariant_holds_and_detects_divergence(self) -> None:
        shared = etl.check_public_debt_invariant(self.data, PUBLIC_DEBT_PATH)
        self.assertTrue(shared)
        tampered = copy.deepcopy(self.data)
        self.by_cell(tampered)[(shared[-1], "D41PAY")]["amountCents"] += 1
        with self.assertRaises(etl.SnapshotError):
            etl.check_public_debt_invariant(tampered, PUBLIC_DEBT_PATH)

    def test_scaled_int_refuses_precision_the_source_does_not_declare(self) -> None:
        self.assertEqual(etl._scaled_int("-69381.0", etl.CENTS_PER_MILLION_EUR, "test"), -6_938_100_000_000)
        with self.assertRaises(etl.SnapshotError):
            etl._scaled_int("12.345", etl.HUNDREDTHS_PER_POINT, "test")
        with self.assertRaises(etl.SnapshotError):
            etl._scaled_int("non un numero", etl.HUNDREDTHS_PER_POINT, "test")

    def test_source_lock_rejects_unofficial_urls(self) -> None:
        tampered = copy.deepcopy(self.spec)
        first = next(iter(tampered["source"]["assets"]))
        tampered["source"]["assets"][first]["url"] = "https://ec.europa.eu/eurostat.example.org/data"
        path = ROOT / "tests/etl/.tmp-eurostat-gov-main-lock.json"
        path.write_text(json.dumps(tampered), encoding="utf-8")
        try:
            with self.assertRaises(etl.SnapshotError):
                etl.load_source_spec(path)
        finally:
            path.unlink(missing_ok=True)

    def test_semantics_axes_are_published(self) -> None:
        semantics = self.metadata["semantics"]
        self.assertEqual(semantics["soldi"]["unit"], "centesimi di euro")
        self.assertIn("competenza economica", semantics["soldi"]["nature"])
        self.assertEqual(semantics["periodo"]["referencePeriod"], "1995-2025")
        provenance = semantics["provenance"]
        self.assertEqual(provenance["license"], "CC-BY-4.0")
        for field in ("publicationDate", "acquisitionDate", "checkedAt"):
            self.assertTrue(provenance[field])
        self.assertNotEqual(provenance["publicationDate"], provenance["acquisitionDate"])

    @unittest.skipUnless(RAW_INPUTS_AVAILABLE, "risposte JSON-stat non disponibili in locale")
    def test_local_raw_inputs_rebuild_the_committed_data(self) -> None:
        spec = etl.load_source_spec(SPEC_PATH)
        inputs = {
            name: (INPUT_DIR / f"gov_10a_main-{asset['unit']}.json").read_bytes()
            for name, asset in spec["source"]["assets"].items()
        }
        rebuilt = etl.canonical_bytes(etl.build_data(inputs, spec))
        self.assertEqual(rebuilt, DATA_PATH.read_bytes())


if __name__ == "__main__":
    unittest.main()
