import copy
import json
import os
import subprocess
import sys
import unittest
from pathlib import Path


ROOT = Path(__file__).resolve().parents[2]
sys.path.insert(0, str(ROOT / "scripts" / "etl"))
import istat_cofog_snapshot as etl  # noqa: E402


SPEC_PATH = ROOT / "scripts/etl/specs/istat-cofog-1995-2023.source.json"
DATA_PATH = ROOT / "src/data/generated/istat-cofog-1995-2023.data.json"
META_PATH = ROOT / "src/data/generated/istat-cofog-1995-2023.meta.json"
INPUT_DIR = Path(os.environ.get("DVNS_ISTAT_COFOG_INPUT_DIR", "/private/tmp/dvns-istat-cofog"))
RAW_INPUT = INPUT_DIR / "tna1_4-V-2025M12.csv"

DIVISIONS = [f"G{n:03d}" for n in (10, 20, 30, 40, 50, 60, 70, 80, 90, 100)]


class IstatCofogSnapshotTest(unittest.TestCase):
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
            [sys.executable, "scripts/etl/istat_cofog_snapshot.py", "--check"],
            cwd=ROOT, capture_output=True, text=True, check=False,
        )
        self.assertEqual(result.returncode, 0, result.stderr)

    def test_coverage_is_complete(self) -> None:
        expected = self.spec["expected"]["cells"]
        self.assertEqual(self.data["coverage"]["expectedCells"], expected)
        self.assertEqual(self.data["coverage"]["observedCells"], expected)
        self.assertEqual(len(self.data["observations"]), expected)
        seen = {(o["area"], o["year"], o["function"]) for o in self.data["observations"]}
        self.assertEqual(len(seen), expected, "osservazioni duplicate")

    def test_measure_valuation_and_edition_stay_pinned(self) -> None:
        measure = self.data["measure"]
        self.assertEqual(measure["code"], "P3_D_W0_S13")
        self.assertEqual(measure["valuation"], "V")
        self.assertEqual(measure["edition"], self.spec["measure"]["edition"])
        # L'edizione dichiarata nella provenance deve essere quella del dato:
        # è il modo in cui una revisione non si traveste da serie.
        self.assertEqual(self.metadata["semantics"]["provenance"]["publicationEdition"], measure["edition"])

    def test_composite_areas_stay_marked_so_nobody_sums_them(self) -> None:
        kinds = {a["code"]: a["kind"] for a in self.data["areas"]}
        for code in ("ITCD", "ITCDE", "ITFG", "ITDA"):
            self.assertEqual(kinds[code], "composite", code)
        self.assertEqual(kinds["IT"], "country")
        self.assertEqual(kinds["ITZ"], "extra-regio")
        self.assertEqual(sum(1 for k in kinds.values() if k == "region"), 21)

    def test_every_declared_partition_holds_within_the_tolerance(self) -> None:
        cells = {(o["area"], o["year"], o["function"]): o["amountCents"] for o in self.data["observations"]}
        tolerance = self.data["reconciliation"]["toleranceCents"]
        checks = self.data["reconciliation"]["checks"]
        self.assertGreaterEqual(len(checks), 11)
        nonzero = 0
        for check in checks:
            for year in self.spec["expected"]["years"]:
                if check["kind"] == "funzioni":
                    for area in (a["code"] for a in self.data["areas"]):
                        total = cells[(area, year, check["whole"])]
                        summed = sum(cells[(area, year, p)] for p in check["parts"])
                        self.assertLessEqual(abs(total - summed), tolerance, f"{area}/{year}")
                        if total != summed: nonzero += 1
                else:
                    for function in (f["code"] for f in self.data["functions"]):
                        total = cells[(check["whole"], year, function)]
                        summed = sum(cells[(p, year, function)] for p in check["parts"])
                        self.assertLessEqual(abs(total - summed), tolerance, f"{year}/{function}")
                        if total != summed: nonzero += 1
        # Se avessimo ricostruito i totali sommando le parti ogni scarto sarebbe
        # zero: la loro presenza prova che pubblichiamo le cifre della fonte.
        self.assertGreater(nonzero, 0, "i totali della fonte sono stati sostituiti da somme nostre")

    def test_amounts_are_integers(self) -> None:
        for o in self.data["observations"]:
            self.assertIsInstance(o["amountCents"], int, o)
            self.assertNotIsInstance(o["amountCents"], bool)
            self.assertGreaterEqual(o["amountCents"], 0, o)

    def test_caveats_say_it_is_not_total_public_spending(self) -> None:
        joined = " ".join(self.data["caveats"])
        self.assertRegex(joined, r"NON la spesa pubblica totale|non è la spesa pubblica totale")
        self.assertIn("gov_10a_exp", joined)
        self.assertRegex(joined, r"doppio conteggio")
        self.assertRegex(joined, r"revisione")

    def test_license_is_not_inferred(self) -> None:
        self.assertEqual(self.metadata["source"]["licenseId"], "not-declared")
        self.assertEqual(self.metadata["semantics"]["provenance"]["license"], "not-declared")
        tampered = copy.deepcopy(self.spec)
        tampered["source"]["licenseId"] = "CC-BY-4.0"
        path = ROOT / "tests/etl/.tmp-istat-cofog-lock.json"
        path.write_text(json.dumps(tampered), encoding="utf-8")
        try:
            with self.assertRaises(etl.SnapshotError):
                etl.load_source_spec(path)
        finally:
            path.unlink(missing_ok=True)

    def test_source_lock_rejects_a_lookalike_host(self) -> None:
        tampered = copy.deepcopy(self.spec)
        first = next(iter(tampered["source"]["assets"]))
        # Passerebbe un controllo di prefisso senza la barra finale.
        tampered["source"]["assets"][first]["url"] = "https://esploradati.istat.it.example.org/data"
        path = ROOT / "tests/etl/.tmp-istat-cofog-host.json"
        path.write_text(json.dumps(tampered), encoding="utf-8")
        try:
            with self.assertRaises(etl.SnapshotError):
                etl.load_source_spec(path)
        finally:
            path.unlink(missing_ok=True)

    def test_missing_cell_fails_closed(self) -> None:
        tampered = copy.deepcopy(self.data)
        tampered["observations"].pop()
        with self.assertRaises(etl.SnapshotError):
            etl.validate_snapshot(tampered)

    def test_cents_conversion_refuses_undeclared_precision(self) -> None:
        self.assertEqual(etl._cents("1.5", "test"), 150_000_000)
        with self.assertRaises(etl.SnapshotError):
            etl._cents("1.555", "test")
        with self.assertRaises(etl.SnapshotError):
            etl._cents("non un numero", "test")

    @unittest.skipUnless(RAW_INPUT.is_file(), "risposta SDMX non disponibile in locale")
    def test_local_raw_input_rebuilds_the_committed_data(self) -> None:
        spec = etl.load_source_spec(SPEC_PATH)
        rebuilt = etl.canonical_bytes(etl.build_data(RAW_INPUT.read_bytes(), spec))
        self.assertEqual(rebuilt, DATA_PATH.read_bytes())


if __name__ == "__main__":
    unittest.main()
