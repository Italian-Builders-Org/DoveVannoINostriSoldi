"""Offline checks for the INL vigilanza 2025 snapshot."""

from __future__ import annotations

import json
import subprocess
import sys
import tempfile
import unittest
from pathlib import Path

import inl_vigilanza_snapshot as inl


class InlVigilanzaTests(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        cls.spec = inl.load_spec()
        cls.data = json.loads(inl.DEFAULT_DATA.read_bytes())

    def test_committed_bundle_reprojects(self):
        inl.check()

    def test_write_rejects_unlocked_pdf(self):
        with tempfile.TemporaryDirectory() as directory:
            root = Path(directory)
            fixture = root / "report.pdf"
            fixture.write_bytes(inl.DEFAULT_FIXTURE.read_bytes() + b"\n")
            spec_path = root / "source.json"
            data_path = root / "data.json"
            meta_path = root / "meta.json"
            spec_path.write_bytes(inl.DEFAULT_SPEC.read_bytes())
            data_path.write_bytes(b"previous")
            meta_path.write_bytes(b"previous")
            before = {path: path.read_bytes() for path in (spec_path, data_path, meta_path)}
            result = subprocess.run(
                [
                    sys.executable,
                    str(Path(inl.__file__)),
                    "--write",
                    "--spec",
                    str(spec_path),
                    "--data",
                    str(data_path),
                    "--meta",
                    str(meta_path),
                    "--fixture",
                    str(fixture),
                ],
                cwd=inl.ROOT,
                capture_output=True,
                text=True,
                check=False,
            )
            self.assertNotEqual(result.returncode, 0)
            self.assertIn("hash o byte divergenza", result.stderr)
            for path, payload in before.items():
                self.assertEqual(path.read_bytes(), payload)

    def test_natures_stay_distinct(self):
        self.assertEqual(self.data["coverage"]["observedRows"], 1576)
        self.assertEqual(self.data["coverage"]["tables"]["recovery"], 4)
        joined = " ".join(self.data["caveats"])
        self.assertRegex(joined, r"mirat")
        self.assertRegex(joined, r"tax gap")


if __name__ == "__main__":
    unittest.main()
