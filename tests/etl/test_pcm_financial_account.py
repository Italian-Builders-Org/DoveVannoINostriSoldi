import importlib.util
import io
import unittest
import zipfile
from pathlib import Path


SCRIPT = Path(__file__).resolve().parents[2] / "scripts/etl/pcm_financial_account.py"
SPEC = importlib.util.spec_from_file_location("pcm_financial_account", SCRIPT)
MODULE = importlib.util.module_from_spec(SPEC)
assert SPEC.loader
SPEC.loader.exec_module(MODULE)


def workbook(headers):
    shared = "".join(f"<si><t>{value}</t></si>" for value in headers)
    header_cells = "".join(
        f'<c r="{chr(65 + index)}1" t="s"><v>{index}</v></c>'
        for index in range(26)
    )
    header_cells += "".join(
        f'<c r="A{chr(65 + index)}1" t="s"><v>{26 + index}</v></c>'
        for index in range(6)
    )
    row_cells = '<c r="A2"><v>2024</v></c><c r="AA2"><f>Y2+Z2</f><v>3</v></c>'
    sheet = (
        '<?xml version="1.0" encoding="UTF-8"?>'
        '<worksheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main">'
        f'<sheetData><row r="1">{header_cells}</row><row r="2">{row_cells}</row></sheetData>'
        '</worksheet>'
    )
    strings = (
        '<?xml version="1.0" encoding="UTF-8"?>'
        '<sst xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main">'
        f'{shared}</sst>'
    )
    output = io.BytesIO()
    with zipfile.ZipFile(output, "w") as archive:
        archive.writestr("xl/sharedStrings.xml", strings)
        archive.writestr("xl/worksheets/sheet1.xml", sheet)
    return output.getvalue()


class PcmFinancialAccountTests(unittest.TestCase):
    def test_parser_reads_the_locked_header_and_cached_formula(self):
        rows = MODULE.parse_xlsx(workbook(MODULE.EXPECTED_HEADERS))
        self.assertEqual(rows[0][0], MODULE.Decimal("2024"))
        self.assertEqual(rows[0][26], MODULE.Decimal("3"))

    def test_parser_fails_closed_when_a_header_changes(self):
        headers = list(MODULE.EXPECTED_HEADERS)
        headers[0] = "Anno"
        with self.assertRaisesRegex(ValueError, "intestazioni cambiate"):
            MODULE.parse_xlsx(workbook(headers))

    def test_committed_snapshot_is_reconciled_and_byte_bound(self):
        MODULE.validate_committed()


if __name__ == "__main__":
    unittest.main()
