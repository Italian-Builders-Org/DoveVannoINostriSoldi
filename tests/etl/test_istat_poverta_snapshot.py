import copy
import json
import subprocess
import sys
import unittest
from pathlib import Path


ROOT = Path(__file__).resolve().parents[2]
sys.path.insert(0, str(ROOT / "scripts" / "etl"))
import istat_poverta_snapshot as etl  # noqa: E402


SPEC_PATH = ROOT / "scripts/etl/specs/istat-poverta-assoluta-2014-2024.source.json"
DATA_PATH = ROOT / "src/data/generated/istat-poverta-assoluta-2014-2024.data.json"
META_PATH = ROOT / "src/data/generated/istat-poverta-assoluta-2014-2024.meta.json"

COLUMNS = [
    "DATAFLOW", "FREQ", "REF_AREA", "DATA_TYPE", "POVERTY_LINES",
    "NUMBER_HOUSEHOLD_COMP", "HOUSEHOLD_TYPOLOGY", "AGE_REFERENCE_PERSON",
    "EDU_LEV_REFPERS", "LABPROF_STATUS_B_REF", "SEX", "AGE", "TIME_PERIOD",
    "OBS_VALUE", "OBS_STATUS",
]


def csv_payload(rows: list[dict[str, str]]) -> bytes:
    """Build a minimal SDMX-CSV response with the nine pinned dimensions correct."""
    base = {
        "DATAFLOW": "IT1:34_727_DF_DCCV_POVERTA_1(1.0)", "FREQ": "A",
        "REF_AREA": "IT", "DATA_TYPE": "INCID_POVASS_FAM", "POVERTY_LINES": "ALL",
        "NUMBER_HOUSEHOLD_COMP": "TOT", "HOUSEHOLD_TYPOLOGY": "HH",
        "AGE_REFERENCE_PERSON": "TOTAL", "EDU_LEV_REFPERS": "99",
        "LABPROF_STATUS_B_REF": "ALL", "SEX": "9", "AGE": "TOTAL",
        "TIME_PERIOD": "2024", "OBS_VALUE": "9.8", "OBS_STATUS": "",
    }
    lines = [",".join(COLUMNS)]
    for row in rows:
        merged = {**base, **row}
        lines.append(",".join(merged[column] for column in COLUMNS))
    return ("\n".join(lines) + "\n").encode("utf-8")


class IstatPovertaSnapshotTest(unittest.TestCase):
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
            [sys.executable, "scripts/etl/istat_poverta_snapshot.py", "--check"],
            cwd=ROOT, capture_output=True, text=True, check=False,
        )
        self.assertEqual(result.returncode, 0, result.stderr)

    def test_coverage_is_complete_and_free_of_duplicates(self) -> None:
        expected = self.spec["expected"]["cells"]
        self.assertEqual(self.data["coverage"]["expectedCells"], expected)
        self.assertEqual(self.data["coverage"]["observedCells"], expected)
        self.assertEqual(len(self.data["observations"]), expected)
        seen = {(o["measure"], o["territory"], o["year"]) for o in self.data["observations"]}
        self.assertEqual(len(seen), expected, "osservazioni duplicate")
        # 7 misure x 8 territori x 11 anni
        self.assertEqual(expected, 7 * 8 * 11)

    def test_only_absolute_measures_are_published(self) -> None:
        codes = {m["code"] for m in self.data["measures"]}
        self.assertEqual(len(codes), 7)
        for code in codes:
            self.assertIn("POVASS", code)
            self.assertNotIn("POVREL", code)

    def test_a_relative_measure_is_refused_because_it_is_another_dataset(self) -> None:
        broken = copy.deepcopy(self.data)
        broken["measures"][0] = {**broken["measures"][0], "code": "INCID_POVREL_FAM"}
        with self.assertRaises(etl.SnapshotError):
            etl.validate_snapshot(broken)

    def test_composite_territories_stay_marked_with_their_parts(self) -> None:
        by_code = {t["code"]: t for t in self.data["territories"]}
        self.assertEqual(by_code["ITCD"]["kind"], "composite")
        self.assertEqual(by_code["ITCD"]["parts"], ["ITC", "ITD"])
        self.assertEqual(by_code["ITFG"]["kind"], "composite")
        self.assertEqual(by_code["ITFG"]["parts"], ["ITF", "ITG"])
        self.assertEqual(by_code["IT"]["kind"], "country")
        self.assertEqual(sum(1 for t in by_code.values() if t["kind"] == "macro"), 5)

    def test_a_composite_without_its_parts_is_refused(self) -> None:
        broken = copy.deepcopy(self.data)
        for territory in broken["territories"]:
            if territory["code"] == "ITCD":
                territory.pop("parts")
        with self.assertRaises(etl.SnapshotError):
            etl.validate_snapshot(broken)

    def test_count_partitions_hold_within_the_declared_tolerance(self) -> None:
        cells = {(o["measure"], o["territory"], o["year"]): o["valueTenths"] for o in self.data["observations"]}
        tolerance = self.data["reconciliation"]["toleranceTenths"]
        counts = [m["code"] for m in self.data["measures"] if m["kind"] == "count"]
        self.assertEqual(len(counts), 2)
        comparisons = 0
        for measure in counts:
            for whole, parts in (("IT", ["ITC", "ITD", "ITE", "ITF", "ITG"]),
                                 ("ITCD", ["ITC", "ITD"]), ("ITFG", ["ITF", "ITG"])):
                for year in self.spec["expected"]["years"]:
                    total = cells[(measure, whole, year)]
                    summed = sum(cells[(measure, part, year)] for part in parts)
                    self.assertLessEqual(abs(total - summed), tolerance, f"{measure}/{whole}/{year}")
                    comparisons += 1
        self.assertEqual(comparisons, 66)

    def test_percentage_compositions_close_to_one_hundred(self) -> None:
        cells = {(o["measure"], o["territory"], o["year"]): o["valueTenths"] for o in self.data["observations"]}
        base = ["ITC", "ITD", "ITE", "ITF", "ITG"]
        for measure in (m["code"] for m in self.data["measures"] if m["kind"] == "composition"):
            for year in self.spec["expected"]["years"]:
                summed = sum(cells[(measure, part, year)] for part in base)
                self.assertLessEqual(abs(summed - 1000), 2, f"{measure}/{year}")

    def test_rates_are_not_summable_across_territories(self) -> None:
        """The negative assertion: if a rate ever closed by sum it would have changed nature."""
        cells = {(o["measure"], o["territory"], o["year"]): o["valueTenths"] for o in self.data["observations"]}
        base = ["ITC", "ITD", "ITE", "ITF", "ITG"]
        tolerance = self.data["reconciliation"]["toleranceTenths"]
        rates = [m["code"] for m in self.data["measures"] if m["kind"] == "rate"]
        self.assertEqual(len(rates), 3)
        self.assertEqual({entry["measure"] for entry in self.data["reconciliation"]["notSummable"]}, set(rates))
        for measure in rates:
            for year in self.spec["expected"]["years"]:
                national = cells[(measure, "IT", year)]
                summed = sum(cells[(measure, part, year)] for part in base)
                self.assertGreater(abs(national - summed), tolerance, f"{measure}/{year}")

    def test_only_counts_may_declare_themselves_summable(self) -> None:
        for measure in self.data["measures"]:
            if measure["kind"] != "count":
                self.assertFalse(measure["summableAcrossTerritories"], measure["code"])
        broken = copy.deepcopy(self.data)
        broken["measures"][0] = {**broken["measures"][0], "kind": "rate", "summableAcrossTerritories": True}
        with self.assertRaises(etl.SnapshotError):
            etl.validate_snapshot(broken)

    def test_the_money_axis_is_declared_absent_not_invented(self) -> None:
        soldi = self.metadata["semantics"]["soldi"]
        self.assertEqual(soldi["unit"], "nessuna — il dataset non contiene importi")
        self.assertIn("non sono euro", soldi["nature"])
        self.assertNotIn("centesimi", json.dumps(soldi, ensure_ascii=False))

    def test_flag_metadata_names_the_right_codelist(self) -> None:
        # È il punto in cui è facile sbagliare: qui OBS_STATUS non usa CL_OBS_STATUS.
        self.assertEqual(self.data["flags"]["codelist"], "CL_FLAG")
        self.assertEqual(self.data["flags"]["attribute"], "OBS_STATUS")
        self.assertEqual(self.data["flags"]["flaggedCells"], 0)
        self.assertEqual(self.spec["expected"]["flagged"], 0)

    def test_a_flagged_cell_becomes_null_and_never_zero(self) -> None:
        payload = csv_payload([{"OBS_VALUE": "", "OBS_STATUS": "0"}])
        # Il lock reale attende 616 celle e nessun flag: si isola la lettura per
        # osservare cosa diventa la cella, invece della copertura.
        spec = copy.deepcopy(self.spec)
        spec["expected"]["cells"] = 1
        spec["expected"]["flagged"] = 1
        cells = etl._read_rows(payload, spec)
        self.assertEqual(list(cells.values()), [None])
        self.assertNotIn(0, cells.values())

    def test_an_unexpected_number_of_flags_fails_closed(self) -> None:
        # Una soppressione che compare dove il lock non ne dichiarava va
        # dichiarata, non assorbita in silenzio.
        payload = csv_payload([{"OBS_VALUE": "", "OBS_STATUS": "0"}])
        spec = copy.deepcopy(self.spec)
        spec["expected"]["cells"] = 1
        with self.assertRaises(etl.SnapshotError) as caught:
            etl._read_rows(payload, spec)
        self.assertIn("flaggate", str(caught.exception))

    def test_an_unknown_flag_fails_closed(self) -> None:
        payload = csv_payload([{"OBS_VALUE": "", "OBS_STATUS": "zz"}])
        with self.assertRaises(etl.SnapshotError) as caught:
            etl._read_rows(payload, self.spec)
        self.assertIn("sconosciuto", str(caught.exception))

    def test_a_flag_carrying_a_value_fails_closed(self) -> None:
        payload = csv_payload([{"OBS_VALUE": "9.8", "OBS_STATUS": "0"}])
        with self.assertRaises(etl.SnapshotError) as caught:
            etl._read_rows(payload, self.spec)
        self.assertIn("valore presente", str(caught.exception))

    def test_an_empty_value_without_a_flag_fails_closed(self) -> None:
        payload = csv_payload([{"OBS_VALUE": "", "OBS_STATUS": ""}])
        with self.assertRaises(etl.SnapshotError) as caught:
            etl._read_rows(payload, self.spec)
        self.assertIn("senza flag", str(caught.exception))

    def test_more_than_one_decimal_fails_instead_of_rounding(self) -> None:
        payload = csv_payload([{"OBS_VALUE": "9.85"}])
        with self.assertRaises(etl.SnapshotError) as caught:
            etl._read_rows(payload, self.spec)
        self.assertIn("più di un decimale", str(caught.exception))

    def test_an_opened_fixed_dimension_fails_closed(self) -> None:
        # Se la fonte aprisse una delle nove dimensioni fissate, la chiave non
        # sarebbe più completamente specificata e i byte non più deterministici.
        payload = csv_payload([{"SEX": "1"}])
        with self.assertRaises(etl.SnapshotError) as caught:
            etl._read_rows(payload, self.spec)
        self.assertIn("SEX", str(caught.exception))

    def test_a_cell_outside_the_lock_fails_closed(self) -> None:
        payload = csv_payload([{"REF_AREA": "ITC1"}])
        with self.assertRaises(etl.SnapshotError) as caught:
            etl._read_rows(payload, self.spec)
        self.assertIn("fuori dal lock", str(caught.exception))

    def test_a_lock_declaring_a_licence_is_refused(self) -> None:
        broken = copy.deepcopy(self.spec)
        broken["source"]["licenseId"] = "CC-BY-4.0"
        path = ROOT / "tests/etl/.tmp-poverta-lock.json"
        path.write_text(json.dumps(broken, ensure_ascii=False), encoding="utf-8")
        try:
            with self.assertRaises(etl.SnapshotError) as caught:
                etl.load_source_spec(path)
            self.assertIn("licenza", str(caught.exception))
        finally:
            path.unlink(missing_ok=True)

    def test_caveats_state_it_is_not_public_spending(self) -> None:
        joined = " ".join(self.data["caveats"])
        self.assertIn("Non è spesa pubblica", joined)
        # I tre limiti che rendono il dato leggibile senza sbagliarlo.
        self.assertIn("NON sono sommabili fra territori", joined)
        self.assertIn("doppio conteggio", joined)
        self.assertIn("livello comunale", joined)

    def test_period_is_the_current_post_revision_series(self) -> None:
        self.assertEqual(self.data["period"], {"from": 2014, "to": 2024})
        note = self.metadata["source"]["seriesNote"]
        self.assertIn("34_201", note)
        self.assertIn("34_728", note)


if __name__ == "__main__":
    unittest.main()
