"""Integrity risks at the snapshot-to-database boundary; no network/database."""

import gzip
import json
from pathlib import Path
import shutil
import tempfile
import unittest

from supabase_corpus_export import load_catalog, dataset_rows, catalog_sql, dataset_sql

ROOT = Path(__file__).resolve().parents[2]
PILOT = "ade-cinque-per-mille-territori-2024"


class SupabaseExportTests(unittest.TestCase):
    def setUp(self):
        self.temp = tempfile.TemporaryDirectory()
        self.addCleanup(self.temp.cleanup)
        self.root = Path(self.temp.name)
        for name in [
            "src/data/generated/integrated/catalog.json",
            "data/source-ledger/release-proof.json",
            "data/source-ledger/dataset-proof.json",
            f"data/source-ledger/datasets/{PILOT}.receipt.json",
        ]:
            target = self.root / name
            target.parent.mkdir(parents=True, exist_ok=True)
            shutil.copyfile(ROOT / name, target)
        for receipt in (ROOT / "data/source-ledger/datasets").glob("*.receipt.json"):
            shutil.copyfile(
                receipt, self.root / "data/source-ledger/datasets" / receipt.name
            )
        self.chunk = (
            self.root
            / f"src/data/generated/integrated/rows/{PILOT}.part-00000.jsonl.gz"
        )
        self.chunk.parent.mkdir(parents=True)
        shutil.copyfile(ROOT / self.chunk.relative_to(self.root), self.chunk)

    def test_catalog_retains_all_publication_states_without_importing_rows(self):
        catalog = load_catalog(self.root)
        self.assertEqual(len(catalog["datasets"]), 135)
        self.assertIn("catalog-only", {d["publication"] for d in catalog["datasets"]})
        sql = catalog_sql(self.root, "a" * 40)
        self.assertNotIn("INSERT INTO dvns_corpus.rows", sql)

    def test_pilot_preserves_exact_strings_and_original_evidence(self):
        expected = [
            json.loads(line)
            for line in gzip.decompress(self.chunk.read_bytes()).splitlines()
        ]
        self.assertEqual(dataset_rows(self.root, PILOT), expected)
        self.assertEqual(len(expected), 22)
        self.assertIn("sourceRowSha256", expected[0])
        self.assertIn("sourceUrls", expected[0])

    def test_changed_chunk_is_rejected_before_any_sql_is_returned(self):
        self.chunk.write_bytes(gzip.compress(b'{"cells":{"value":"0"}}\n'))
        with self.assertRaisesRegex(ValueError, "hash"):
            dataset_sql(self.root, PILOT)

    def test_changed_receipt_is_rejected(self):
        path = self.root / f"data/source-ledger/datasets/{PILOT}.receipt.json"
        path.write_text("{}")
        with self.assertRaisesRegex(ValueError, "hash"):
            dataset_rows(self.root, PILOT)

    def test_catalog_corruption_and_missing_chunk_fail_closed(self):
        self.chunk.unlink()
        with self.assertRaises((ValueError, FileNotFoundError)):
            dataset_rows(self.root, PILOT)
        path = self.root / "src/data/generated/integrated/catalog.json"
        path.write_text("{}")
        with self.assertRaisesRegex(ValueError, "hash"):
            load_catalog(self.root)

    def test_catalog_only_detail_cannot_be_exported_as_public_rows(self):
        with self.assertRaisesRegex(ValueError, "publication"):
            dataset_rows(self.root, "opencup-progetti-bulk")


if __name__ == "__main__":
    unittest.main()
