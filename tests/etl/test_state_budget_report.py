"""Independent checks of the frozen evidence and the figures used in the article."""
import csv
import gzip
import hashlib
import io
import json
import re
import unittest
import unicodedata
import zipfile
from decimal import Decimal, ROUND_HALF_UP
from pathlib import Path
from pypdf import PdfReader


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

    def test_pdf_contains_all_findings_limits_and_verifiable_source_links(self):
        report = json.loads((ROOT / "src/content/reports/state-budget-reader.json").read_text())
        reader = PdfReader(ROOT / "public/report/bilancio-stato-2025.pdf")
        normalize = lambda value: re.sub(r"\s+", "", unicodedata.normalize("NFKC", value))
        text = normalize("\n".join(page.extract_text() for page in reader.pages))
        self.assertNotIn("\u2014", text)
        expected = [report["title"], report["summary"], report["lead"], *report["method"],
                    *report["municipal"]["paragraphs"]]
        for case in report["cases"]:
            expected.extend(case[key] for key in ("title", "number", "numberLabel", "period", "lead", "conclusion", "improve"))
            expected.extend(case["paragraphs"])
            if case["math"]:
                expected.append(case["math"]["explanation"])
        for source in report["sources"]:
            expected.extend([source["title"], source["locator"]])
        for paragraph in expected:
            with self.subTest(paragraph=paragraph[:80]):
                self.assertIn(normalize(paragraph), text)
        self.assertEqual({case["id"] for case in self.report["cases"]},
                         {case["legacyId"] for case in report["cases"] if case["legacyId"]})
        links = {str(annotation.get_object().get("/A", {}).get("/URI", ""))
                 for page in reader.pages for annotation in page.get("/Annots", [])}
        self.assertLessEqual({source["url"] for source in report["sources"]}, links)
        self.assertIn(report["legacyEvidenceUrl"], links)

    def test_pdf_uses_dvns_palette_and_reviewed_logo(self):
        reader = PdfReader(ROOT / "public/report/bilancio-stato-2025.pdf")
        colours, images = set(), []
        for page in reader.pages:
            for values, operator in page.get_contents().operations:
                if operator in (b"rg", b"RG"):
                    colours.add(tuple(round(float(value), 3) for value in values))
            for reference in page["/Resources"].get("/XObject", {}).values():
                image = reference.get_object()
                self.assertEqual(image["/Subtype"], "/Image")
                images.append((int(image["/Width"]), int(image["/Height"])))
        for rgb in ((24/255, 43/255, 58/255), (23/255, 101/255, 117/255), (180/255, 35/255, 50/255)):
            self.assertIn(tuple(round(value, 3) for value in rgb), colours)
        self.assertTrue(images)
        self.assertEqual(set(images), {(48, 48)})
        logo = (ROOT / "public/brand/icon-48.png").read_bytes()
        receipt = json.loads((PROOF / "pdf-receipt.json").read_text())
        self.assertEqual(receipt["rendering"]["logoSha256"], hashlib.sha256(logo).hexdigest())

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
        for control in self.report["controls"]:
            self.assertTrue(control["sourceIds"])
            self.assertLessEqual(set(control["sourceIds"]), source_ids)
        for source in self.report["sources"]:
            self.assertTrue(source["url"].startswith("https://"))
        self.assertNotIn("\u2014", CONTENT.read_text())
        receipt = json.loads((PROOF / "pdf-receipt.json").read_text())
        legacy = CONTENT.read_bytes()
        legacy_blob = hashlib.sha1(b"blob " + str(len(legacy)).encode() + b"\0" + legacy).hexdigest()
        self.assertEqual(legacy_blob, receipt["legacyManuscriptGitBlob"])
        current = (ROOT / "src/content/reports/state-budget-reader.json").read_bytes()
        self.assertEqual(hashlib.sha256(current).hexdigest(), receipt["readerManuscriptSha256"])
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
        case = next(item for item in self.report["cases"] if item["id"] == "affidamenti")
        text = json.dumps(case, ensure_ascii=False)
        for amount in ("310.000", "417.000", "278.000"):
            self.assertIn(amount, text)

    def test_prison_capacity_and_space_targets_against_rgs(self):
        rows = self.rows("outputs/audit/outcome/sources/2025-al-rendiconto-indicatori.csv")
        def number(value):
            return Decimal(re.sub(r"[^\d,.]", "", value).replace(".", "").replace(",", "."))
        capacity, space = rows[678:680]
        shortfall = number(capacity["Valore anno 1 a LB"]) - number(capacity["Valore a Rendiconto"])
        achieved = number(space["Valore a Rendiconto"]) / number(space["Valore anno 1 a LB"]) * 100
        self.assertEqual(shortfall, 723)
        self.assertEqual(achieved, 30)
        case = next(item for item in self.report["cases"] if item["id"] == "carceri")
        self.assertIn(f"{shortfall:.0f} posti", case["calculation"])
        self.assertIn(f"{achieved:.0f}%", case["calculation"])
        action = self.rows("outputs/audit/outcome/sources/2025-al-rendiconto-azioni.csv")[584]
        for key in ("Totale impegnato CP", "Totale Pagato CS"):
            amount = format(Decimal(action[key]), ",.2f").translate(str.maketrans(",.", ".,"))
            self.assertIn(amount, case["calculation"])

    def test_archives_missing_results_do_not_multiply_action_spending(self):
        indicators = self.rows("outputs/audit/outcome/sources/2025-al-rendiconto-indicatori.csv")
        archive_indicators = [row for row in indicators
                              if row["Codice Missione"] == "021" and row["Codice Programma"] == "009"]
        self.assertEqual(len(archive_indicators), 5)
        self.assertEqual(sum(row["Valore a Rendiconto"] == "NON CONSUNTIVABILE" for row in archive_indicators), 4)
        actions = [row for row in self.rows("outputs/audit/outcome/sources/2025-al-rendiconto-azioni.csv")
                   if row["Codice Missione"] == "021" and row["Codice Programma"] == "009"
                   and row["Codice Azione"] in {"2", "3", "4"}]
        self.assertEqual(len(actions), 3)
        total = sum(Decimal(row["Totale impegnato CP"]) for row in actions)
        self.assertEqual(total, Decimal("55741725.76"))
        case = next(item for item in self.report["cases"] if item["id"] == "archivi")
        self.assertIn(format(total, ",.2f").translate(str.maketrans(",.", ".,")), case["calculation"])

    def test_personnel_discrepancy_against_the_original_pdf_table(self):
        reader = PdfReader(io.BytesIO(self.archive.read("outputs/audit-extracts/personale-mase.pdf")))
        table = reader.pages[1].extract_text().split("Tabella 7", 1)[1]
        values = [int(re.search(pattern, table).group(1)) for pattern in (
            r"Capi Dipartimento\s+(\d+)", r"Dirigenti 1\^ fascia\s+(\d+)",
            r"Dirigenti 2\^ fascia\s+(\d+)", r"Totale\s+Aree\s+(\d+)")]
        published = int(re.search(r"Totale complessivo\s+(\d+)", table).group(1))
        self.assertEqual(sum(values) - published, 13)
        case = next(item for item in self.report["cases"] if item["id"] == "personale")
        self.assertIn(f"{' + '.join(map(str, values))} = {sum(values)}", case["calculation"])
        self.assertIn(f"{sum(values)} - {published} = {sum(values) - published}", case["calculation"])


if __name__ == "__main__":
    unittest.main()
