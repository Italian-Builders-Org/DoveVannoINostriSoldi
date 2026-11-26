"""Official list of Italian Comuni within 20 km of the Swiss border (issue #869)."""

from __future__ import annotations

import copy
import json
import tempfile
import unittest
from pathlib import Path

import svizzera_frontalieri_comuni_20km as etl

ROOT = Path(__file__).resolve().parents[2]


class SwissBorderZoneTests(unittest.TestCase):
    @classmethod
    def setUpClass(cls) -> None:
        cls.spec = etl.load_spec()
        cls.data = etl.build(cls.spec)
        cls.by_code = {row[0]: row for row in cls.data["rows"]}

    def test_committed_output_matches_the_locked_sources(self) -> None:
        etl.check()

    def test_every_listed_row_becomes_one_current_comune(self) -> None:
        # 518 rows in the agreement; Ronago and Uggiate-Trevano are now one Comune.
        self.assertEqual(self.data["listedRows"], 518)
        self.assertEqual(len(self.data["rows"]), 517)
        self.assertEqual(len(self.by_code), 517)
        self.assertEqual(self.by_code["013256"][1], "Uggiate con Ronago")
        self.assertEqual(sorted(self.by_code["013256"][3].split(" | ")), ["Ronago", "Uggiate-Trevano"])
        self.assertEqual(self.data["previousCodes"], {"013199": "013256", "013228": "013256"})

    def test_known_border_comuni_and_non_listed_ones(self) -> None:
        for code, name in (("012086", "Lavena Ponte Tresa"), ("013075", "Como"), ("014037", "Livigno"), ("007003", "Aosta")):
            self.assertEqual(self.by_code[code][1], name)
        # Milano and Bergamo city are not in the list: the zone is not "Lombardy".
        self.assertNotIn("015146", self.by_code)
        self.assertNotIn("016024", self.by_code)

    def test_bilingual_names_resolve_to_the_istat_comune(self) -> None:
        self.assertEqual(self.by_code["021046"][1], "Malles Venosta/Mals")

    def test_changed_workbook_is_refused(self) -> None:
        with tempfile.TemporaryDirectory() as folder:
            tampered = Path(folder) / "list.xlsx"
            tampered.write_bytes((ROOT / self.spec["source"]["path"]).read_bytes() + b"\0")
            with self.assertRaises(etl.BorderZoneError):
                etl.build(self.spec, workbook=tampered)

    def test_transcription_of_the_authoritative_pdf_must_agree(self) -> None:
        rows = etl.read_transcription(self.spec)
        rows[10] = (rows[10][0], rows[10][1], "Ponte in Valtellina")
        with self.assertRaises(etl.BorderZoneError):
            etl.reconcile_transcription(etl.read_workbook(self.spec), rows, self.spec)

    def test_gazzetta_ufficiale_names_must_all_be_listed(self) -> None:
        spec = copy.deepcopy(self.spec)
        spec["crossChecks"][0]["names"].append("Bergamo")
        with self.assertRaises(etl.BorderZoneError):
            etl.build(spec)

    def test_complete_province_lists_must_match_exactly(self) -> None:
        spec = copy.deepcopy(self.spec)
        spec["crossChecks"][1]["names"].remove("Livigno")
        with self.assertRaises(etl.BorderZoneError):
            etl.build(spec)

    def test_undeclared_successor_is_refused(self) -> None:
        spec = copy.deepcopy(self.spec)
        del spec["successors"]["013199"]
        with self.assertRaises(etl.BorderZoneError):
            etl.build(spec)

    def test_output_is_compact_and_declares_its_provenance(self) -> None:
        payload = json.loads((ROOT / "src/data/generated/svizzera-frontalieri-comuni-20km.json").read_text(encoding="utf-8"))
        self.assertEqual(payload["columns"], ["istatCode", "name", "provinceCode", "listedAs"])
        self.assertTrue(payload["source"]["url"].startswith("https://www.estv.admin.ch/"))
        self.assertEqual(payload["source"]["effectiveFrom"], "2024-01-01")
        self.assertRegex(payload["source"]["authoritativeSha256"], r"^[0-9a-f]{64}$")


if __name__ == "__main__":
    unittest.main()
