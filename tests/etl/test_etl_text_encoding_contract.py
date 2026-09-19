"""Fail-closed: ETL text I/O must declare UTF-8 so non-UTF-8 hosts stay reproducible (#535)."""

from __future__ import annotations

import unittest
from pathlib import Path

ROOT = Path(__file__).resolve().parents[2]
ETL_ROOT = ROOT / "scripts/etl"
TEST_ROOT = ROOT / "tests/etl"
THIS_FILE = Path(__file__).resolve()


class EtlTextEncodingContractTests(unittest.TestCase):
    def test_etl_and_etl_tests_declare_utf8_on_path_text_io(self):
        offenders: list[str] = []
        for path in sorted(ETL_ROOT.rglob("*.py")) + sorted(TEST_ROOT.rglob("*.py")):
            if path.resolve() == THIS_FILE:
                continue
            text = path.read_text(encoding="utf-8")
            i = 0
            while True:
                next_read = text.find(".read_text(", i)
                next_write = text.find(".write_text(", i)
                candidates = [c for c in (next_read, next_write) if c >= 0]
                if not candidates:
                    break
                idx = min(candidates)
                method = ".read_text(" if idx == next_read else ".write_text("
                start = idx + len(method)
                depth = 1
                j = start
                in_str = None
                escape = False
                while j < len(text) and depth:
                    ch = text[j]
                    if in_str:
                        if escape:
                            escape = False
                        elif ch == "\\":
                            escape = True
                        elif ch == in_str:
                            in_str = None
                    else:
                        if ch in ("'", '"'):
                            in_str = ch
                        elif ch == "(":
                            depth += 1
                        elif ch == ")":
                            depth -= 1
                    j += 1
                inner = text[start : j - 1]
                if "encoding=" not in inner:
                    line = text.count("\n", 0, idx) + 1
                    offenders.append(f"{path.relative_to(ROOT)}:{line}")
                i = j
        self.assertEqual(offenders, [], "Path text I/O must declare encoding=utf-8:\n" + "\n".join(offenders))

    def test_opencivitas_fixture_keeps_accented_italian_copy(self):
        fixture = ROOT / "tests/fixtures/opencivitas-2018-source-sample.json"
        text = fixture.read_text(encoding="utf-8")
        self.assertTrue(
            any(ch in text for ch in ("à", "è", "é", "ì", "ò", "ù")),
            "OpenCivitas fixtures must retain accented Italian text that breaks under cp1252 mis-reads",
        )


if __name__ == "__main__":
    unittest.main()
