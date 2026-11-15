"""Local artifact loading failures, defined before gzip renderer support."""

import gzip
import json
import tempfile
import unittest
from pathlib import Path
from render import read_analysis


class RenderInputTests(unittest.TestCase):
    def test_plain_and_gzip_load_the_same_artifact(self):
        data = {
            "schemaVersion": 3,
            "metric": "scheduled-segment-travel-time",
            "cities": [],
        }
        with tempfile.TemporaryDirectory() as tmp:
            root = Path(tmp)
            raw = json.dumps(data).encode()
            (root / "analysis.json").write_bytes(raw)
            (root / "analysis.json.gz").write_bytes(gzip.compress(raw, mtime=0))
            self.assertEqual(read_analysis(root / "analysis.json"), data)
            self.assertEqual(read_analysis(root / "analysis.json.gz"), data)

    def test_expanded_budget_applies_to_both_formats(self):
        with tempfile.TemporaryDirectory() as tmp:
            for name, raw in [
                ("large.json", b" " * 65),
                ("large.json.gz", gzip.compress(b" " * 65)),
            ]:
                path = Path(tmp) / name
                path.write_bytes(raw)
                with self.subTest(name=name), self.assertRaisesRegex(
                    ValueError, "budget"
                ):
                    read_analysis(path, max_bytes=64)

    def test_corrupt_gzip_is_not_an_empty_success(self):
        with tempfile.TemporaryDirectory() as tmp:
            path = Path(tmp) / "bad.json.gz"
            path.write_bytes(b"not gzip")
            with self.assertRaises(gzip.BadGzipFile):
                read_analysis(path)
