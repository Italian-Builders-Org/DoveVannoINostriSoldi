import copy
import json
import os
import subprocess
import sys
import unittest
from pathlib import Path


ROOT = Path(__file__).resolve().parents[2]
sys.path.insert(0, str(ROOT / "scripts" / "etl"))
import inps_naspi_snapshot as etl  # noqa: E402


SPEC_PATH = ROOT / "scripts/etl/specs/inps-naspi-2018-2022.source.json"
DATA_PATH = ROOT / "src/data/generated/inps-naspi-2018-2022.data.json"
META_PATH = ROOT / "src/data/generated/inps-naspi-2018-2022.meta.json"
INPUT_DIR = Path(os.environ.get("DVNS_INPS_NASPI_INPUT_DIR", "/private/tmp/dvns-inps-naspi"))


class InpsNaspiSnapshotTest(unittest.TestCase):
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
            [sys.executable, "scripts/etl/inps_naspi_snapshot.py", "--check"],
            cwd=ROOT, capture_output=True, text=True, check=False,
        )
        self.assertEqual(result.returncode, 0, result.stderr)

    def test_coverage_is_complete(self) -> None:
        cov = self.data["coverage"]
        self.assertEqual(cov["observedObservations"], cov["expectedObservations"])
        self.assertEqual(len(self.data["observations"]), cov["expectedObservations"])
        self.assertEqual(len(self.data["tables"]), 9)

    def test_suppressed_cells_never_become_zero(self) -> None:
        suppressed = [o for o in self.data["observations"] if o.get("suppressed")]
        self.assertEqual(len(suppressed), self.data["coverage"]["suppressed"])
        self.assertGreater(len(suppressed), 0, "la fonte dichiara celle soppresse: devono restare marcate")
        for row in suppressed:
            self.assertIsNone(row["count"], row)
        # E nessuna cella valorizzata è marcata soppressa.
        for row in self.data["observations"]:
            if not row.get("suppressed"):
                self.assertIsInstance(row["count"], int, row)

    def test_the_two_measures_stay_separate(self) -> None:
        tables = {t["id"]: t["measure"] for t in self.data["tables"]}
        self.assertEqual(set(tables.values()), {"beneficiari", "trattamenti"})
        for row in self.data["observations"]:
            self.assertEqual(row["measure"], tables[row["table"]], row)
        # Persone e prestazioni sono famiglie distinte: entrambe presenti, mai fuse.
        self.assertGreater(sum(1 for m in tables.values() if m == "beneficiari"), 0)
        self.assertGreater(sum(1 for m in tables.values() if m == "trattamenti"), 0)

    def test_reconciliations_are_exact_not_tolerant(self) -> None:
        rec = self.data["reconciliation"]
        self.assertTrue(rec["exact"])
        self.assertGreaterEqual(len(rec["checks"]), 3)
        for check in rec["checks"]:
            self.assertEqual(check["mismatches"], 0, check)
            self.assertGreater(check["comparisons"], 0, check)
        # Ricalcolo indipendente, senza fidarmi dei numeri scritti nell'artefatto.
        etl._reconcile(self.data["observations"], self.spec)

    def test_a_broken_reconciliation_fails_closed(self) -> None:
        tampered = copy.deepcopy(self.data)
        for row in tampered["observations"]:
            if row["table"] == "beneficiari_02" and row["count"] is not None:
                row["count"] += 1000
                break
        with self.assertRaises(etl.SnapshotError):
            etl._reconcile(tampered["observations"], self.spec)

    def test_a_suppressed_cell_turned_into_a_number_fails_closed(self) -> None:
        tampered = copy.deepcopy(self.data)
        for row in tampered["observations"]:
            if row.get("suppressed"):
                row["count"] = 0
                break
        with self.assertRaises(etl.SnapshotError):
            etl.validate_snapshot(tampered)

    def test_license_must_stay_the_verified_one(self) -> None:
        self.assertEqual(self.metadata["source"]["licenseId"], "IODL-2.0")
        tampered = copy.deepcopy(self.spec)
        tampered["source"]["licenseId"] = "CC-BY-4.0"
        path = ROOT / "tests/etl/.tmp-inps-naspi-lock.json"
        path.write_text(json.dumps(tampered), encoding="utf-8")
        try:
            with self.assertRaises(etl.SnapshotError):
                etl.load_source_spec(path)
        finally:
            path.unlink(missing_ok=True)

    def test_source_lock_rejects_a_lookalike_host(self) -> None:
        tampered = copy.deepcopy(self.spec)
        first = next(iter(tampered["expected"]["tables"]))
        # Passerebbe un controllo di prefisso senza la barra finale.
        tampered["expected"]["tables"][first]["url"] = "https://opendata.inps.it.example.org/x.xml"
        path = ROOT / "tests/etl/.tmp-inps-naspi-host.json"
        path.write_text(json.dumps(tampered), encoding="utf-8")
        try:
            with self.assertRaises(etl.SnapshotError):
                etl.load_source_spec(path)
        finally:
            path.unlink(missing_ok=True)

    def test_rejected_distributions_are_documented(self) -> None:
        choice = self.metadata["source"]["distributionChoice"]
        self.assertIn("SDMX-ML", choice["used"])
        self.assertRegex(choice["rejectedCsv"], r"newline|byte di controllo")
        self.assertRegex(choice["rejectedJson"], r"underscore|non valido")

    def test_caveats_keep_the_two_measures_and_the_suppression_apart(self) -> None:
        joined = " ".join(self.data["caveats"])
        self.assertRegex(joined, r"misure diverse")
        self.assertRegex(joined, r"NON euro|non sono euro")
        self.assertRegex(joined, r"soppressa")
        self.assertRegex(joined, r"flusso")

    @unittest.skipUnless(INPUT_DIR.is_dir(), "risposte SDMX-ML non disponibili in locale")
    def test_local_raw_inputs_rebuild_the_committed_data(self) -> None:
        spec = etl.load_source_spec(SPEC_PATH)
        inputs = {}
        for name, table in spec["expected"]["tables"].items():
            path = INPUT_DIR / f"{table['package']}.xml"
            if not path.is_file():
                self.skipTest("input incompleti")
            inputs[name] = path.read_bytes()
        rebuilt = etl.canonical_bytes(etl.build_data(inputs, spec))
        self.assertEqual(rebuilt, DATA_PATH.read_bytes())


if __name__ == "__main__":
    unittest.main()
