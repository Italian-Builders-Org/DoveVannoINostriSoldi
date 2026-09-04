import copy
import json
import os
import subprocess
import sys
import unittest
from pathlib import Path


ROOT = Path(__file__).resolve().parents[2]
sys.path.insert(0, str(ROOT / "scripts" / "etl"))
import eurostat_cofog_snapshot as etl  # noqa: E402


SPEC_PATH = ROOT / "scripts/etl/specs/eurostat-cofog-2014-2024.source.json"
DATA_PATH = ROOT / "src/data/generated/eurostat-cofog-2014-2024.data.json"
META_PATH = ROOT / "src/data/generated/eurostat-cofog-2014-2024.meta.json"
INPUT_DIR = Path(os.environ.get("DVNS_EUROSTAT_COFOG_INPUT_DIR", "/private/tmp/dvns-eurostat-cofog"))
RAW_INPUTS_AVAILABLE = all(
    (INPUT_DIR / f"gov_10a_exp-{unit}.json").is_file() for unit in ("MIO_EUR", "PC_GDP")
)

DIVISIONS = [f"GF{n:02d}" for n in range(1, 11)]


class EurostatCofogSnapshotTest(unittest.TestCase):
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
            [sys.executable, "scripts/etl/eurostat_cofog_snapshot.py", "--check"],
            cwd=ROOT,
            capture_output=True,
            text=True,
            check=False,
        )
        self.assertEqual(result.returncode, 0, result.stderr)

    def test_coverage_is_complete_and_declared(self) -> None:
        expected = self.spec["expected"]["cellsPerUnit"]
        self.assertEqual(self.data["coverage"]["expectedCells"], expected)
        self.assertEqual(self.data["coverage"]["observedCells"], expected)
        self.assertEqual(len(self.data["observations"]), expected)
        years = {o["year"] for o in self.data["observations"]}
        self.assertEqual(years, set(self.spec["expected"]["years"]))
        self.assertEqual(
            {g["code"] for g in self.data["geographies"]},
            {g["code"] for g in self.spec["expected"]["geographies"]},
        )
        self.assertEqual({f["code"] for f in self.data["functions"]}, set(["TOTAL", *DIVISIONS]))

    def test_every_cell_is_present_exactly_once(self) -> None:
        seen = {(o["geo"], o["year"], o["function"]) for o in self.data["observations"]}
        self.assertEqual(len(seen), len(self.data["observations"]), "osservazioni duplicate")
        for geography in self.data["geographies"]:
            for year in self.spec["expected"]["years"]:
                for code in ["TOTAL", *DIVISIONS]:
                    self.assertIn((geography["code"], year, code), seen)

    def test_source_status_flags_travel_with_the_observation(self) -> None:
        flagged = [o for o in self.data["observations"] if "flag" in o]
        self.assertEqual(len(flagged), self.data["coverage"]["flagged"])
        self.assertTrue(flagged, "la fonte dichiara celle provvisorie: devono restare marcate")
        self.assertEqual({o["flag"] for o in flagged}, {"p", "b"})
        # «b» segna una interruzione della serie storica: se sparisse, un grafico
        # tracciato a cavallo affermerebbe una continuità che la fonte non dichiara.
        self.assertTrue(any(o["flag"] == "b" for o in flagged))

    def test_published_total_is_not_recomputed_from_the_divisions(self) -> None:
        by_key: dict[tuple[str, int], dict[str, dict]] = {}
        for observation in self.data["observations"]:
            by_key.setdefault((observation["geo"], observation["year"]), {})[observation["function"]] = observation

        gaps = []
        for functions in by_key.values():
            total = functions["TOTAL"]["amountCents"]
            parts = sum(functions[d]["amountCents"] for d in DIVISIONS)
            gaps.append(abs(total - parts))

        tolerance = self.data["reconciliation"]["toleranceCents"]
        self.assertLessEqual(max(gaps), tolerance, "scarto oltre il solo arrotondamento")
        self.assertEqual(max(gaps), self.data["reconciliation"]["maxGapCents"])
        # Se il totale fosse stato ricostruito sommando le divisioni, ogni scarto
        # sarebbe zero: la presenza di scarti prova che pubblichiamo il totale
        # della fonte invece del nostro.
        self.assertGreater(max(gaps), 0, "il totale pubblicato è stato sostituito da una ricostruzione")

    def test_amounts_are_integers_without_hidden_floats(self) -> None:
        for observation in self.data["observations"]:
            for field in ("amountCents", "shareOfGdpHundredths"):
                self.assertIsInstance(observation[field], int, observation)
                self.assertNotIsInstance(observation[field], bool)
                self.assertGreaterEqual(observation[field], 0, observation)

    def test_tampered_reconciliation_fails_closed(self) -> None:
        tampered = copy.deepcopy(self.data)
        for observation in tampered["observations"]:
            if observation["function"] == "TOTAL":
                observation["amountCents"] += tampered["reconciliation"]["toleranceCents"] * 10
                break
        # validate_snapshot non ricalcola la riconciliazione, ma il duplicato e la
        # copertura restano invarianti: il controllo vero è in _reconcile.
        with self.assertRaises(etl.SnapshotError):
            etl._reconcile(tampered["observations"])

    def test_missing_cell_fails_closed(self) -> None:
        tampered = copy.deepcopy(self.data)
        tampered["observations"].pop()
        with self.assertRaises(etl.SnapshotError):
            etl.validate_snapshot(tampered)

    def test_scaled_int_refuses_precision_the_source_does_not_declare(self) -> None:
        self.assertEqual(etl._scaled_int("12.3", etl.HUNDREDTHS_PER_POINT, "test"), 1230)
        with self.assertRaises(etl.SnapshotError):
            etl._scaled_int("12.345", etl.HUNDREDTHS_PER_POINT, "test")
        with self.assertRaises(etl.SnapshotError):
            etl._scaled_int("non un numero", etl.HUNDREDTHS_PER_POINT, "test")

    def test_source_lock_rejects_unofficial_urls(self) -> None:
        tampered = copy.deepcopy(self.spec)
        first = next(iter(tampered["source"]["assets"]))
        # Ostile ma plausibile: passerebbe un controllo di prefisso SENZA la barra
        # finale, perche' "https://ec.europa.eu/eurostat" ne e' prefisso letterale.
        tampered["source"]["assets"][first]["url"] = "https://ec.europa.eu/eurostat.example.org/data"
        path = ROOT / "tests/etl/.tmp-eurostat-cofog-lock.json"
        path.write_text(json.dumps(tampered), encoding="utf-8")
        try:
            with self.assertRaises(etl.SnapshotError):
                etl.load_source_spec(path)
        finally:
            path.unlink(missing_ok=True)

    def test_semantics_axes_are_published(self) -> None:
        semantics = self.metadata["semantics"]
        self.assertEqual(semantics["soldi"]["unit"], "centesimi di euro")
        self.assertEqual(semantics["periodo"]["referencePeriod"], "2014-2024")
        provenance = semantics["provenance"]
        self.assertEqual(provenance["license"], "CC-BY-4.0")
        for field in ("publicationDate", "acquisitionDate", "checkedAt"):
            self.assertTrue(provenance[field])
        self.assertNotEqual(provenance["publicationDate"], provenance["acquisitionDate"])

    @unittest.skipUnless(RAW_INPUTS_AVAILABLE, "risposte JSON-stat non disponibili in locale")
    def test_local_raw_inputs_rebuild_the_committed_data(self) -> None:
        spec = etl.load_source_spec(SPEC_PATH)
        inputs = {
            name: (INPUT_DIR / f"gov_10a_exp-{asset['unit']}.json").read_bytes()
            for name, asset in spec["source"]["assets"].items()
        }
        rebuilt = etl.canonical_bytes(etl.build_data(inputs, spec))
        self.assertEqual(rebuilt, DATA_PATH.read_bytes())


if __name__ == "__main__":
    unittest.main()
