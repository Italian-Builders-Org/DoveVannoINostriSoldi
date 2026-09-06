"""Reproduce the municipal cells, then exercise failures independently of hashes."""

import copy
import json
import tempfile
import unittest
from pathlib import Path
from xml.etree import ElementTree as ET

import istat_misura_comune as etl


class MunicipalStructureTests(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        cls.spec = json.loads(etl.SPEC.read_text())
        cls.members = etl.read_members(etl.ROOT / cls.spec["fixture"]["path"], cls.spec)
        cls.payloads = etl.projections(cls.spec, cls.members)

    def fixture(self):
        sheet = copy.deepcopy(self.spec["sheets"][0])
        sheet.update(rows=2, missing={"..": 0, "N.C.": 0})
        rows = [
            ["Nord-ovest", "01", "Piemonte", "Torino", "0", "Agliè", "001001", *(["213.01775147928994"] * 11)],
            ["Nord-ovest", "01", "Piemonte", "Torino", "0", "Airasca", "001002", *(["0"] * 11)],
        ]
        return sheet, rows

    def xml(self, sheet, rows):
        root = ET.Element(etl.NS + "worksheet")
        data = ET.SubElement(root, etl.NS + "sheetData")
        values = {1: [sheet["title"]], 2: ["INDICE"], 4: self.spec["headers"]}
        values.update({i: row for i, row in enumerate(rows, 5)})
        values.update({i: [note] for i, note in enumerate(sheet["footer"], len(rows) + 5)})
        for number, row in values.items():
            node = ET.SubElement(data, etl.NS + "row", r=str(number))
            for index, value in enumerate(row):
                cell = ET.SubElement(node, etl.NS + "c", r=f"{chr(65 + index)}{number}", t="inlineStr")
                ET.SubElement(ET.SubElement(cell, etl.NS + "is"), etl.NS + "t").text = value
        return root

    def parse(self, root, sheet):
        return etl.parse_sheet(ET.tostring(root), [], sheet, self.spec["headers"])

    def test_all_source_cells_reproduce_every_public_row_and_receipt(self):
        etl.check_committed(self.spec, self.payloads)
        self.assertEqual(len(self.payloads), 3)
        self.assertEqual(sum(sheet["rows"] for sheet in self.spec["sheets"]), 23688)

    def test_exact_decimal_strings_and_zero_survive_without_float_rounding(self):
        sheet, rows = self.fixture()
        self.assertEqual(self.parse(self.xml(sheet, rows), sheet), rows)

    def test_missing_and_not_computable_are_preserved_separately_from_zero(self):
        sheet, rows = self.fixture()
        rows[0][7:9] = ["..", "N.C."]
        sheet["missing"] = {"..": 1, "N.C.": 1}
        self.assertEqual(self.parse(self.xml(sheet, rows), sheet), rows)
        for invalid in ["", "NaN", "Infinity", "1,5", "-1", "n.d."]:
            with self.subTest(value=invalid), self.assertRaises(etl.SourceError):
                broken = copy.deepcopy(rows)
                broken[0][9] = invalid
                self.parse(self.xml(sheet, broken), sheet)

    def test_invalid_geography_duplicates_and_missing_municipalities_fail(self):
        sheet, rows = self.fixture()
        for column, value in [(6, "001002"), (6, "ITC1"), (6, "1001"), (1, "21"), (4, "yes")]:
            with self.subTest(column=column, value=value), self.assertRaises(etl.SourceError):
                broken = copy.deepcopy(rows)
                broken[0][column] = value
                self.parse(self.xml(sheet, broken), sheet)
        with self.assertRaises(etl.SourceError):
            self.parse(self.xml(sheet, rows[:1]), sheet)

    def test_header_year_method_and_extra_cells_fail_closed(self):
        sheet, rows = self.fixture()
        for reference in ["H4", "A1", "A7"]:
            with self.subTest(reference=reference), self.assertRaises(etl.SourceError):
                root = self.xml(sheet, rows)
                cell = root.find(f".//{etl.NS}c[@r='{reference}']/{etl.NS}is/{etl.NS}t")
                cell.text = "different"
                self.parse(root, sheet)
        root = self.xml(sheet, rows)
        node = root.find(f".//{etl.NS}row[@r='5']")
        ET.SubElement(ET.SubElement(node, etl.NS + "c", r="S5"), etl.NS + "v").text = "12"
        with self.assertRaisesRegex(etl.SourceError, "fuori tabella"):
            self.parse(root, sheet)

    def test_formulas_duplicate_cells_and_wrong_row_references_are_rejected(self):
        sheet, rows = self.fixture()
        for mutation in ["formula", "duplicate", "reference"]:
            with self.subTest(mutation=mutation), self.assertRaises(etl.SourceError):
                root = self.xml(sheet, rows)
                row = root.find(f".//{etl.NS}row[@r='5']")
                cell = row.find(f"{etl.NS}c[@r='H5']")
                if mutation == "formula":
                    ET.SubElement(cell, etl.NS + "f").text = "1+1"
                elif mutation == "duplicate":
                    row.append(copy.deepcopy(cell))
                else:
                    cell.set("r", "H6")
                self.parse(root, sheet)

    def test_ratio_reconciliation_rejects_changed_values_without_inventing_totals(self):
        _, rows = self.fixture()
        series = [[rows[0][:7] + [value] * 11] for value in ["200", "40", "60"]]
        etl.reconcile(series)
        for index, value in [(0, "300"), (1, "90"), (2, "59"), (0, "N.C."), (1, "..")]:
            with self.subTest(index=index, value=value), self.assertRaises(etl.SourceError):
                broken = copy.deepcopy(series)
                broken[index][0][7] = value
                etl.reconcile(broken)
        for current in series:
            current[0][7] = ".."
        etl.reconcile(series)

    def test_changed_source_bytes_and_member_commitments_are_rejected(self):
        with tempfile.TemporaryDirectory() as directory:
            target = Path(directory) / "changed.zip"
            payload = (etl.ROOT / self.spec["fixture"]["path"]).read_bytes()
            target.write_bytes(payload[:-1])
            with self.assertRaisesRegex(etl.SourceError, "byte sorgente"):
                etl.read_members(target, self.spec)
            changed = copy.deepcopy(self.spec)
            changed["fixture"]["members"][0]["sha256"] = "0" * 64
            with self.assertRaisesRegex(etl.SourceError, "membro XLSX"):
                etl.read_members(etl.ROOT / self.spec["fixture"]["path"], changed)

    def test_extracted_fixture_has_only_declared_source_cells_and_no_workbook_metadata(self):
        self.assertEqual(set(self.members), {"xl/sharedStrings.xml", "xl/worksheets/sheet1.xml", *[s["member"] for s in self.spec["sheets"]]})
        for payload in self.members.values():
            self.assertNotIn(b"C:\\Users", payload)
            self.assertNotIn(b"/Users/", payload)


if __name__ == "__main__":
    unittest.main()
