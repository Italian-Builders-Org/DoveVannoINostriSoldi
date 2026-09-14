"""Independent checks of the frozen evidence and the figures used in the article."""
import csv
import gzip
import hashlib
import io
import json
import re
import unittest
import zipfile
from decimal import Decimal, ROUND_HALF_UP
from pathlib import Path


ROOT = Path(__file__).resolve().parents[2]
PROOF = ROOT / "docs/research/state-budget-2025"
CONTENT = ROOT / "src/content/reports/state-budget-2025.json"


class StateBudgetReportTests(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        cls.report = json.loads(CONTENT.read_text())
        cls.archive = zipfile.ZipFile(PROOF / "evidence.zip")
        cls.addClassCleanup(cls.archive.close)

    def rows(self, path, compressed=False):
        raw = self.archive.read(path)
        if compressed:
            raw = gzip.decompress(raw)
        return list(csv.DictReader(io.StringIO(raw.decode("cp1252")), delimiter=";"))

    def test_evidence_bytes_and_source_identity(self):
        manifest = json.loads((PROOF / "evidence-manifest.json").read_text())
        self.assertEqual(set(self.archive.namelist()), {row["path"] for row in manifest["files"]})
        for item in manifest["files"]:
            with self.subTest(path=item["path"]):
                data = self.archive.read(item["path"])
                self.assertEqual(len(data), item["bytes"])
                self.assertEqual(hashlib.sha256(data).hexdigest(), item["sha256"])
        # Verify original decompressed RGS bytes, not only our archive's checksum.
        for item in json.loads(self.archive.read("outputs/audit/accounting/sources.json")):
            raw = gzip.decompress(self.archive.read(f"outputs/audit/accounting/{item['path']}"))
            self.assertEqual(hashlib.sha256(raw).hexdigest(), item["sha256"])

    def test_revenue_error_is_a_forecast_difference_not_a_payment(self):
        rows = self.rows("outputs/audit/accounting/sources/2025_RND_ENT_ELB_CAPAR_001.csv.gz", True)
        discrepancies = []
        for record, row in enumerate(rows, 1):
            difference = (Decimal(row["Previsioni Iniziali CP"])
                          + Decimal(row["Variazioni CP"])
                          - Decimal(row["Previsioni Definitive CP"]))
            if difference:
                discrepancies.append((record, row["Numero Capitolo di Entrata"], row["Numero Articolo"], difference))
        self.assertEqual(discrepancies, [(1404, "3458", "1", Decimal("1894.00"))])
        case = next(row for row in self.report["cases"] if row["id"] == "entrate")
        self.assertIn("1.894", case["calculation"])
        self.assertIn("previsione", case["summary"])

    def test_percentage_descriptions_against_original_target_and_result(self):
        rows = self.rows("outputs/audit/outcome/sources/2025-al-rendiconto-indicatori.csv")
        case = next(row for row in self.report["cases"] if row["id"] == "percentuali")
        for record, expected in [(824, "61.54"), (825, "61.03"), (828, "46.43")]:
            row = rows[record - 1]
            target = Decimal(row["Valore anno 1 a LB"].replace(",", "."))
            actual = Decimal(row["Valore a Rendiconto"].replace(",", "."))
            reduction = ((target - actual) / target * 100).quantize(Decimal(".01"), rounding=ROUND_HALF_UP)
            self.assertEqual(reduction, Decimal(expected))
            self.assertIn(str(reduction).replace(".", ",") + "%", " ".join(case["paragraphs"]))
            self.assertIn("riduzione", row["Nota scostamento"])

    def test_case_sources_and_pdf_match_the_reviewed_manuscript(self):
        ids = [row["id"] for row in self.report["cases"]]
        self.assertEqual(len(ids), len(set(ids)))
        source_ids = {source["id"] for source in self.report["sources"]}
        for case in self.report["cases"]:
            self.assertTrue(case["record"] and case["calculation"] and case["nextStep"])
            self.assertTrue(case["sourceIds"])
            self.assertLessEqual(set(case["sourceIds"]), source_ids)
        for source in self.report["sources"]:
            self.assertTrue(source["url"].startswith("https://"))
        self.assertNotIn("\u2014", CONTENT.read_text())
        receipt = json.loads((PROOF / "pdf-receipt.json").read_text())
        self.assertEqual(hashlib.sha256(CONTENT.read_bytes()).hexdigest(), receipt["manuscriptSha256"])
        pdf = (ROOT / "public/report/bilancio-stato-2025.pdf").read_bytes()
        self.assertTrue(pdf.startswith(b"%PDF-"))
        self.assertEqual(hashlib.sha256(pdf).hexdigest(), receipt["pdfSha256"])
        self.assertEqual(len(pdf), receipt["pdfBytes"])

    def test_lift_fund_annual_allocation_is_not_total_fund_spending(self):
        row = self.rows("outputs/audit/outcome/sources/2025-al-rendiconto-indicatori.csv")[367]
        amounts = [Decimal(value.replace(".", "").replace(",", "."))
                   for value in re.findall(r"euro ([\d.]+,\d{2})", row["Nota scostamento"])]
        allocation, committed = amounts
        rate = (committed / allocation * 100).quantize(Decimal(".01"), rounding=ROUND_HALF_UP)
        self.assertEqual(str(rate).replace(".", ",") + "%", row["Valore a Rendiconto"])
        case = next(item for item in self.report["cases"] if item["id"] == "impianti")
        self.assertIn("77.561.111,82", case["calculation"])
        self.assertEqual(allocation - committed, Decimal("77561111.82"))
        self.assertIn("sola competenza 2025", " ".join(case["paragraphs"]))

    def test_advertising_contracts_reconcile_across_distinct_cigs_and_years(self):
        data = json.loads(self.archive.read("outputs/audit/procurement/second-calculations.json"))
        contracts = data["sportNetwork"]
        self.assertEqual(len({item["cig"] for item in contracts}), 6)
        self.assertEqual({item["officialAwardDate"] for item in contracts}, {"2025-10-30"})
        self.assertEqual(sum(item["netCents"] for item in contracts), 31_000_000)
        # The other campaign contracts cross financial years; never assign them all to 2025.
        totals = {}
        for item in data["five139k"]:
            year = item["officialAwardDate"][:4]
            totals[year] = totals.get(year, 0) + item["netCents"]
        self.assertEqual(totals, {"2025": 41_700_000, "2026": 27_800_000})


if __name__ == "__main__":
    unittest.main()
