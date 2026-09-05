import copy
import json
import subprocess
import sys
import unittest
from pathlib import Path


ROOT = Path(__file__).resolve().parents[2]
sys.path.insert(0, str(ROOT / "scripts" / "etl"))
import mef_irpef_dettaglio_snapshot as etl  # noqa: E402


SPEC_PATH = ROOT / "scripts/etl/specs/mef-irpef-dettaglio-2017-2025.source.json"
DATA_PATH = ROOT / "src/data/generated/mef-irpef-dettaglio-2017-2025.data.json"
META_PATH = ROOT / "src/data/generated/mef-irpef-dettaglio-2017-2025.meta.json"


class MefIrpefDettaglioSnapshotTest(unittest.TestCase):
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
            [sys.executable, "scripts/etl/mef_irpef_dettaglio_snapshot.py", "--check"],
            cwd=ROOT, capture_output=True, text=True, check=False,
        )
        self.assertEqual(result.returncode, 0, result.stderr)

    def test_the_bonus_family_measures_two_instruments(self) -> None:
        per_anno = {}
        for t in self.data["tables"]:
            if t["family"] == "bonus_irpef" and t["breakdown"] == "regione":
                per_anno[t["year"]] = set(t["instruments"])
        self.assertEqual(per_anno[2017], {"bonus"})
        self.assertEqual(per_anno[2020], {"bonus"})
        # Il 2021 e' l'anno in cui convivono: se sparisse, la discontinuita'
        # smetterebbe di essere visibile e le due serie sembrerebbero una sola.
        self.assertEqual(per_anno[2021], {"bonus", "trattamento"})
        self.assertEqual(per_anno[2022], {"trattamento"})
        self.assertEqual(per_anno[2025], {"trattamento"})

    def test_schema_is_pinned_per_file_not_per_family(self) -> None:
        schemi = {t["id"]: t["schemaId"] for t in self.data["tables"]}
        self.assertEqual(len(set(schemi.values())), 18)
        # La stessa famiglia usa schemi diversi in anni diversi.
        reg = {t["year"]: t["schemaId"] for t in self.data["tables"]
               if t["family"] == "tipo_reddito" and t["breakdown"] == "regione"}
        self.assertNotEqual(reg[2019], reg[2020], "il 2019 e il 2020 non hanno lo stesso schema")
        self.assertEqual(reg[2020], reg[2022])
        self.assertNotEqual(reg[2022], reg[2023])

    def test_a_measure_can_exist_in_one_breakdown_and_not_another(self) -> None:
        target = "Perdita di spettanza dell'imprenditore in contabilita' semplificata - Frequenza"
        def ha(family, breakdown, anno):
            t = next((x for x in self.data["tables"]
                      if x["family"] == family and x["breakdown"] == breakdown and x["year"] == anno), None)
            if t is None: return None
            return any(m["name"] == target for m in self.data["schemas"][t["schemaId"]]["measures"])
        # Nel 2020-2022 la misura esiste per regione ma non per eta' ne' per sesso:
        # l'asimmetria resta nel dato, dichiarata.
        for anno in (2020, 2021, 2022):
            self.assertTrue(ha("tipo_reddito", "regione", anno), anno)
            self.assertFalse(ha("tipo_reddito", "classeEta", anno), anno)
            self.assertFalse(ha("tipo_reddito", "sesso", anno), anno)

    def test_empty_is_not_zero(self) -> None:
        cov = self.data["coverage"]
        self.assertGreater(cov["emptyCells"], 0)
        vuote = sum(1 for r in self.data["rows"] for v in r["v"] if v is None)
        self.assertEqual(vuote, cov["emptyCells"])
        zeri = sum(1 for r in self.data["rows"] for v in r["v"] if v == 0)
        # Le due cose convivono: se la fonte usasse lo zero per dire "assente"
        # non troveremmo entrambe in quantita'.
        self.assertGreater(zeri, 0)
        self.assertGreater(vuote, 0)

    def test_absent_and_empty_releases_stay_declared(self) -> None:
        cov = self.data["coverage"]
        self.assertEqual(set(cov["missingFiles"]),
                         {"cla_anno_calcolo_irpef_2018.csv", "cla_anno_bonus_irpef_2018.csv"})
        self.assertEqual(set(cov["emptyReleases"]), {"REG_bonus_irpef_2024.csv"})
        vuote = {t["id"] + ".csv" for t in self.data["tables"] if t["rows"] == 0}
        self.assertEqual(vuote, set(cov["emptyReleases"]))

    def test_an_undeclared_empty_release_fails_closed(self) -> None:
        tampered = copy.deepcopy(self.spec)
        tampered["source"]["emptyReleases"] = {}
        path = ROOT / "tests/etl/.tmp-mef-irpef-empty.json"
        path.write_text(json.dumps(tampered), encoding="utf-8")
        try:
            with self.assertRaises(etl.SnapshotError):
                etl.load_source_spec(path)
        finally:
            path.unlink(missing_ok=True)

    def test_a_decimal_comma_is_treated_as_drift(self) -> None:
        self.assertEqual(etl._parse_cell("1.234", "test"), 1234)
        self.assertEqual(etl._parse_cell("-12", "test"), -12)
        self.assertIsNone(etl._parse_cell("   ", "test"))
        with self.assertRaises(etl.SnapshotError):
            etl._parse_cell("1,5", "test")
        with self.assertRaises(etl.SnapshotError):
            etl._parse_cell("non un numero", "test")

    def test_natures_are_labelled(self) -> None:
        nature = {m["nature"] for s in self.data["schemas"].values() for m in s["measures"]}
        self.assertEqual(nature, {"frequenza", "ammontare", "conteggio"})

    def test_license_stays_the_verified_one(self) -> None:
        self.assertEqual(self.metadata["source"]["licenseId"], "CC-BY-3.0-IT")
        self.assertIn("ccby.png", self.metadata["source"]["licenseNote"])
        tampered = copy.deepcopy(self.spec)
        tampered["source"]["licenseId"] = "CC-BY-4.0"
        path = ROOT / "tests/etl/.tmp-mef-irpef-lic.json"
        path.write_text(json.dumps(tampered), encoding="utf-8")
        try:
            with self.assertRaises(etl.SnapshotError):
                etl.load_source_spec(path)
        finally:
            path.unlink(missing_ok=True)

    def test_source_lock_rejects_a_lookalike_host(self) -> None:
        tampered = copy.deepcopy(self.spec)
        first = next(iter(tampered["expected"]["tables"]))
        tampered["expected"]["tables"][first]["url"] = "https://www1.finanze.gov.it.example.org/x.csv"
        path = ROOT / "tests/etl/.tmp-mef-irpef-host.json"
        path.write_text(json.dumps(tampered), encoding="utf-8")
        try:
            with self.assertRaises(etl.SnapshotError):
                etl.load_source_spec(path)
        finally:
            path.unlink(missing_ok=True)

    def test_caveats_say_what_the_data_is_not(self) -> None:
        joined = " ".join(self.data["caveats"])
        self.assertRegex(joined, r"non e' gettito riscosso|non è gettito riscosso")
        self.assertRegex(joined, r"due strumenti diversi")
        self.assertRegex(joined, r"non e' uno zero|non è uno zero")
        self.assertRegex(joined, r"non si sommano")


    def test_duplicate_rows_and_invalid_table_indices_fail(self):
        duplicate = copy.deepcopy(self.data)
        duplicate["rows"][1] = copy.deepcopy(duplicate["rows"][0])
        with self.assertRaisesRegex(etl.SnapshotError, "duplicata"):
            etl.validate_snapshot(duplicate)
        invalid = copy.deepcopy(self.data)
        invalid["rows"][0]["t"] = -1
        with self.assertRaisesRegex(etl.SnapshotError, "indice tabella"):
            etl.validate_snapshot(invalid)

    def test_declared_and_economic_years_are_distinct(self):
        self.assertEqual(self.data["periodBasis"], "declaration-year")
        self.assertEqual(self.data["taxPeriod"], {"from": 2016, "to": 2024})
        for table in self.data["tables"]:
            self.assertEqual(table["taxYear"], table["year"] - 1)
            self.assertEqual(table["publicationDate"], self.spec["expected"]["tables"][table["id"]]["publicationDate"])

if __name__ == "__main__":
    unittest.main()
