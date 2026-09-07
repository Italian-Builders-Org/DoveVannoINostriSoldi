import copy
import json
import subprocess
import sys
import unittest
from pathlib import Path


ROOT = Path(__file__).resolve().parents[2]
sys.path.insert(0, str(ROOT / "scripts" / "etl"))
import istat_bes_snapshot as etl  # noqa: E402


SPEC_PATH = ROOT / "scripts/etl/specs/istat-bes-economico-2004-2024.source.json"
DATA_PATH = ROOT / "src/data/generated/istat-bes-economico-2004-2024.data.json"
META_PATH = ROOT / "src/data/generated/istat-bes-economico-2004-2024.meta.json"

COLUMNS = [
    "DATAFLOW", "FREQ", "REF_AREA", "DOMAIN", "DATA_TYPE", "SEX", "EDITION",
    "TIME_PERIOD", "OBS_VALUE", "OBS_STATUS", "NOTE_DS", "NOTE_REF_AREA",
    "NOTE_ISTAT_TERR_OFFICIAL_CODE", "NOTE_DATA_TYPE", "NOTE_DATA_TYPE_DESCR",
    "NOTE_DATA_TYPE_SOURCE", "NOTE_TIME_PERIOD", "BASE_PER", "UNIT_MEAS", "UNIT_MULT",
]


def csv_payload(rows: list[dict[str, str]]) -> bytes:
    """Minimal SDMX-CSV response with the pinned dimensions already correct."""
    base = {c: "" for c in COLUMNS}
    base.update({
        "DATAFLOW": "IT1:DF_BES_TERRIT_4(1.0)", "FREQ": "A", "REF_AREA": "IT",
        "DOMAIN": "BES_04", "DATA_TYPE": "04BEC001P", "SEX": "T", "EDITION": "2025",
        "TIME_PERIOD": "2021", "OBS_VALUE": "20032.2", "OBS_STATUS": "", "UNIT_MEAS": "EURO",
    })
    lines = [",".join(COLUMNS)]
    for row in rows:
        merged = {**base, **row}
        lines.append(",".join(merged[column] for column in COLUMNS))
    return ("\n".join(lines) + "\n").encode("utf-8")


class IstatBesSnapshotTest(unittest.TestCase):
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
            [sys.executable, "scripts/etl/istat_bes_snapshot.py", "--check"],
            cwd=ROOT, capture_output=True, text=True, check=False,
        )
        self.assertEqual(result.returncode, 0, result.stderr)

    def test_coverage_is_complete_and_free_of_duplicates(self) -> None:
        expected = self.spec["expected"]["cells"]
        self.assertEqual(self.data["coverage"]["observedCells"], expected)
        self.assertEqual(len(self.data["observations"]), expected)
        seen = {(o["indicator"], o["territory"], o["sex"], o["year"]) for o in self.data["observations"]}
        self.assertEqual(len(seen), expected, "osservazioni duplicate")

    def test_coverage_is_declared_per_indicator_not_as_one_period(self) -> None:
        """A single 2004-2024 would be false for four measures out of five."""
        spans = {i["code"]: (i["from"], i["to"]) for i in self.data["indicators"]}
        self.assertGreater(len(set(spans.values())), 1, "gli indicatori non hanno tutti lo stesso periodo")
        overall = (self.data["period"]["from"], self.data["period"]["to"])
        differing = [c for c, s in spans.items() if s != overall]
        self.assertGreaterEqual(len(differing), 4)
        # Ogni osservazione rispetta il periodo del SUO indicatore.
        for observation in self.data["observations"]:
            low, high = spans[observation["indicator"]]
            self.assertTrue(low <= observation["year"] <= high, observation)

    def test_each_indicator_declares_its_own_sexes(self) -> None:
        by_code = {i["code"]: set(i["sexes"]) for i in self.data["indicators"]}
        self.assertNotEqual(len(set(map(frozenset, by_code.values()))), 1,
                            "almeno un indicatore ha una disponibilità per sesso diversa")
        for observation in self.data["observations"]:
            self.assertIn(observation["sex"], by_code[observation["indicator"]], observation)

    def test_territory_levels_come_from_the_source_hierarchy(self) -> None:
        kinds = {t["code"]: t["kind"] for t in self.data["territories"]}
        # La lunghezza del codice sarebbe una guida sbagliata: ITCD e ITFG hanno
        # quattro caratteri come le regioni ma non sono regioni.
        self.assertEqual(kinds["ITCD"], "composite")
        self.assertEqual(kinds["ITFG"], "composite")
        self.assertEqual(len("ITCD"), len("ITC1"))
        self.assertEqual(kinds["ITC1"], "regione")
        self.assertEqual(kinds["IT"], "country")
        self.assertEqual(kinds["ITC"], "ripartizione")
        counts = {}
        for kind in kinds.values():
            counts[kind] = counts.get(kind, 0) + 1
        self.assertEqual(counts, {"country": 1, "ripartizione": 5, "composite": 2,
                                  "regione": 20, "provincia": 111})

    def test_composites_declare_their_parts(self) -> None:
        by_code = {t["code"]: t for t in self.data["territories"]}
        self.assertEqual(by_code["ITCD"]["parts"], ["ITC", "ITD"])
        self.assertEqual(by_code["ITFG"]["parts"], ["ITF", "ITG"])

    def test_the_broken_parent_chain_is_declared_not_patched(self) -> None:
        """Bolzano and Trento point at parents absent from this slice."""
        orphans = {t["code"]: t for t in self.data["territories"] if t.get("parentOutsideDataset")}
        self.assertEqual(set(orphans), {"ITD10", "ITD20"})
        for code, entry in orphans.items():
            self.assertIsNone(entry["parent"], code)
            self.assertNotIn(entry["parentOutsideDataset"],
                             {t["code"] for t in self.data["territories"]})

    def test_a_territory_outside_the_anagrafica_fails_closed(self) -> None:
        payload = csv_payload([{"REF_AREA": "ITZZZ"}])
        with self.assertRaises(etl.SnapshotError) as caught:
            etl._read_rows(payload, self.spec)
        self.assertIn("anagrafica vincolata", str(caught.exception))

    def test_a_year_outside_the_indicator_period_fails_closed(self) -> None:
        # 04BEC001P copre 2021-2023: il 2004 esiste nel dataset ma per un altro
        # indicatore, ed è esattamente l'errore che la copertura per indicatore evita.
        payload = csv_payload([{"DATA_TYPE": "04BEC001P", "TIME_PERIOD": "2004"}])
        with self.assertRaises(etl.SnapshotError) as caught:
            etl._read_rows(payload, self.spec)
        self.assertIn("copertura è per indicatore", str(caught.exception))

    def test_a_sex_not_declared_for_that_indicator_fails_closed(self) -> None:
        payload = csv_payload([{"DATA_TYPE": "04BEC001P", "SEX": "F"}])
        with self.assertRaises(etl.SnapshotError) as caught:
            etl._read_rows(payload, self.spec)
        self.assertIn("non dichiarato per questo indicatore", str(caught.exception))

    def test_a_unit_diverging_from_the_lock_fails_closed(self) -> None:
        payload = csv_payload([{"UNIT_MEAS": "VAL_PERC"}])
        with self.assertRaises(etl.SnapshotError) as caught:
            etl._read_rows(payload, self.spec)
        self.assertIn("UNIT_MEAS", str(caught.exception))

    def test_the_total_sits_between_the_sexes(self) -> None:
        cells = {(o["indicator"], o["territory"], o["sex"], o["year"]): o["valueTenths"]
                 for o in self.data["observations"]}
        compared = 0
        for (indicator, territory, sex, year), value in cells.items():
            if sex != "T" or value is None:
                continue
            female = cells.get((indicator, territory, "F", year))
            male = cells.get((indicator, territory, "M", year))
            if female is None or male is None:
                continue
            compared += 1
            self.assertTrue(min(female, male) <= value <= max(female, male),
                            f"{indicator}/{territory}/{year}")
        self.assertEqual(compared, self.data["reconciliation"]["comparisons"])
        self.assertGreater(compared, 5000)
        self.assertEqual(self.data["reconciliation"]["violations"], 0)

    def test_territorial_sum_is_not_a_valid_reconciliation(self) -> None:
        """Nothing here is a count, so partitions cannot be checked by sum."""
        self.assertIs(self.data["reconciliation"]["territorialSum"], False)
        for indicator in self.data["indicators"]:
            self.assertFalse(indicator["summableAcrossTerritories"], indicator["code"])
            self.assertIn(indicator["unit"], {"EURO", "VAL_PERC"})
        broken = copy.deepcopy(self.data)
        broken["indicators"][0]["summableAcrossTerritories"] = True
        with self.assertRaises(etl.SnapshotError):
            etl.validate_snapshot(broken)

    def test_a_lock_declaring_a_summable_measure_is_refused(self) -> None:
        broken = copy.deepcopy(self.spec)
        broken["expected"]["indicators"][0]["summableAcrossTerritories"] = True
        path = ROOT / "tests/etl/.tmp-bes-lock.json"
        path.write_text(json.dumps(broken, ensure_ascii=False), encoding="utf-8")
        try:
            with self.assertRaises(etl.SnapshotError) as caught:
                etl.load_source_spec(path)
            self.assertIn("sommabile", str(caught.exception))
        finally:
            path.unlink(missing_ok=True)

    def test_flag_metadata_names_the_right_codelist(self) -> None:
        self.assertEqual(self.data["flags"]["codelist"], "CL_FLAG")
        self.assertEqual(self.data["flags"]["attribute"], "OBS_STATUS")
        self.assertEqual(self.data["flags"]["flaggedCells"], self.spec["expected"]["flagged"])
        nulls = sum(1 for o in self.data["observations"] if o["valueTenths"] is None)
        self.assertEqual(nulls, self.data["flags"]["flaggedCells"])

    def test_a_flagged_cell_becomes_null_and_never_zero(self) -> None:
        payload = csv_payload([{"OBS_VALUE": "", "OBS_STATUS": "g"}])
        spec = copy.deepcopy(self.spec)
        spec["expected"]["cells"] = 1
        spec["expected"]["flagged"] = 1
        for indicator in spec["expected"]["indicators"]:
            indicator["observations"] = 1 if indicator["code"] == "04BEC001P" else 0
        cells = etl._read_rows(payload, spec)
        self.assertEqual(list(cells.values()), [None])
        self.assertNotIn(0, cells.values())

    def test_an_unknown_flag_fails_closed(self) -> None:
        payload = csv_payload([{"OBS_VALUE": "", "OBS_STATUS": "zz"}])
        with self.assertRaises(etl.SnapshotError) as caught:
            etl._read_rows(payload, self.spec)
        self.assertIn("sconosciuto", str(caught.exception))

    def test_an_opened_fixed_dimension_fails_closed(self) -> None:
        payload = csv_payload([{"EDITION": "2024"}])
        with self.assertRaises(etl.SnapshotError) as caught:
            etl._read_rows(payload, self.spec)
        self.assertIn("EDITION", str(caught.exception))

    def test_more_than_one_decimal_fails_instead_of_rounding(self) -> None:
        payload = csv_payload([{"OBS_VALUE": "20032.25"}])
        with self.assertRaises(etl.SnapshotError) as caught:
            etl._read_rows(payload, self.spec)
        self.assertIn("più di un decimale", str(caught.exception))

    def test_a_lock_declaring_a_licence_is_refused(self) -> None:
        broken = copy.deepcopy(self.spec)
        broken["source"]["licenseId"] = "CC-BY-4.0"
        path = ROOT / "tests/etl/.tmp-bes-licence.json"
        path.write_text(json.dumps(broken, ensure_ascii=False), encoding="utf-8")
        try:
            with self.assertRaises(etl.SnapshotError) as caught:
                etl.load_source_spec(path)
            self.assertIn("licenza", str(caught.exception))
        finally:
            path.unlink(missing_ok=True)

    def test_the_money_axis_is_present_but_delimited(self) -> None:
        soldi = self.metadata["semantics"]["soldi"]
        self.assertIn("euro", soldi["unit"].lower())
        self.assertIn("non è spesa pubblica", soldi["nature"].lower())
        self.assertIn("famiglie", soldi["nature"].lower())

    def test_caveats_state_the_limits_that_make_the_data_readable(self) -> None:
        joined = " ".join(self.data["caveats"])
        self.assertIn("Non è spesa pubblica", joined)
        self.assertIn("NON sono sommabili fra territori", joined)
        self.assertIn("doppio conteggio", joined)
        self.assertIn("soppresse nel 2016", joined)
        self.assertIn("indice composito", joined)


if __name__ == "__main__":
    unittest.main()
