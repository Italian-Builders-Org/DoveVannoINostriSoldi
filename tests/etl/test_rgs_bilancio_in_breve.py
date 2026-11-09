"""Cent-level and coverage checks for RGS Bilancio in Breve snapshot."""

from __future__ import annotations

import json
import unittest
from pathlib import Path

import openpyxl

ROOT = Path(__file__).resolve().parents[2]
SNAPSHOT = ROOT / "src" / "data" / "generated" / "rgs-bilancio-in-breve.json"
CACHE = ROOT / ".cache" / "manovra-rgs"


class RgsBilancioInBreveTests(unittest.TestCase):
    @classmethod
    def setUpClass(cls) -> None:
        if not SNAPSHOT.is_file():
            raise unittest.SkipTest(
                "Payload locale assente: generare con rgs_bilancio_in_breve_snapshot.py "
                "prima della riconciliazione XLSX (runtime = dvns_snapshots)."
            )
        cls.snapshot = json.loads(SNAPSHOT.read_text(encoding="utf-8"))

    def test_coverage_documents_pdf_only_pre_2023(self) -> None:
        coverage = self.snapshot["coverage"]
        self.assertEqual(coverage["comparableXlsxFirstYears"], [2023, 2024, 2025, 2026])
        self.assertEqual(coverage["pdfOnlyLandingYears"], [2018, 2019, 2020, 2021, 2022])
        self.assertIn("rgs.mef.gov.it", coverage["archiveCatalogUrl"])

    def test_every_edition_headline_matches_xlsx_to_the_cent(self) -> None:
        expected = {
            "lb-2023-2025": (672_250_788_315, 872_903_962_855, -200_653_174_540, -511_473_175_779),
            "lb-2024-2026": (687_566_976_520, 886_418_531_849, -198_851_555_329, -527_519_115_761),
            "lb-2025-2027": (728_832_687_509, 915_769_270_589, -186_936_583_080, -470_712_034_296),
            "lb-2026-2028": (768_778_531_304, 923_116_684_581, -154_338_153_277, -484_382_932_385),
        }
        for edition in self.snapshot["editions"]:
            path = CACHE / edition["xlsx"]["fileName"]
            self.assertTrue(path.is_file(), f"missing cache file {path}")
            workbook = openpyxl.load_workbook(path, data_only=True, read_only=True)
            try:
                sheet = next(ws for name, ws in ((n, workbook[n]) for n in workbook.sheetnames) if "2.1" in name)
                rows = list(sheet.iter_rows(values_only=True))
            finally:
                workbook.close()

            sample = next(
                row
                for row in rows
                if row and any(str(cell).strip() == "Entrate finali" for cell in row[:3] if cell)
            )
            label_idx = next(i for i, value in enumerate(sample[:3]) if value)
            absolute = [
                i
                for i, value in enumerate(sample)
                if i > label_idx and isinstance(value, (int, float))
            ]
            # prev CP/CS, assestato CP/CS, then first-year CP
            cp_col = absolute[4]

            def metric(label: str) -> int:
                for row in rows:
                    if row and any(str(cell).strip() == label for cell in row[:3] if cell):
                        return int(round(row[cp_col]))
                self.fail(f"missing row {label} in {edition['id']}")

            got = (
                metric("Entrate finali"),
                metric("Spese finali"),
                metric("Saldo netto da finanziare"),
                metric("Ricorso al mercato"),
            )
            headline = edition["headline"]
            pinned = (
                headline["entrateFinaliCompetenzaEur"],
                headline["speseFinaliCompetenzaEur"],
                headline["saldoNettoDaFinanziareCompetenzaEur"],
                headline["ricorsoAlMercatoCompetenzaEur"],
            )
            self.assertEqual(got, pinned, edition["id"])
            self.assertEqual(pinned, expected[edition["id"]], edition["id"])

    def test_annexes_expose_irpef_and_mission_history(self) -> None:
        latest = next(
            edition
            for edition in self.snapshot["editions"]
            if edition["id"] == self.snapshot["latestEditionId"]
        )
        irpef = next(
            row
            for row in latest["revenueDetail"]
            if row["label"] == "Imposta sul reddito delle persone fisiche"
        )
        self.assertEqual(irpef["byYear"]["2026"]["competenzaEur"], 248_100_506_045)
        self.assertTrue(latest["missionHistory"]["available"])
        self.assertGreaterEqual(len(latest["missionHistory"]["missions"]), 30)
        self.assertIn(2014, latest["missionHistory"]["years"])
        self.assertIn(2026, latest["missionHistory"]["years"])


if __name__ == "__main__":
    unittest.main()
