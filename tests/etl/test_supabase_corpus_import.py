"""Canonical database readback must reconstruct exact receipt bytes."""

import gzip
import hashlib
import json
from pathlib import Path
import unittest

from supabase_corpus_import import canonical_row, chunk_batches

ROOT = Path(__file__).resolve().parents[2]


class ImportBoundaryTests(unittest.TestCase):
    def test_database_jsonb_key_order_does_not_change_receipt_digest(self):
        path = next(
            (ROOT / "src/data/generated/integrated/rows").glob(
                "ade-cinque-per-mille-territori-2024.part-*.gz"
            )
        )
        payload = gzip.decompress(path.read_bytes())
        rows = [json.loads(line) for line in payload.splitlines()]
        reordered = [dict(reversed(list(row.items()))) for row in rows]
        rebuilt = b"".join(canonical_row(row) for row in reordered)
        self.assertEqual(
            hashlib.sha256(rebuilt).hexdigest(), hashlib.sha256(payload).hexdigest()
        )

    def test_strings_missing_zero_and_unicode_remain_distinct(self):
        row = {
            "cells": {
                "empty": "",
                "zero": "0",
                "money": "2.946,86",
                "text": 'città\n"A"',
            }
        }
        self.assertEqual(json.loads(canonical_row(row)), row)
        self.assertNotIn("absent", json.loads(canonical_row(row))["cells"])

    def test_batches_keep_every_chunk_once_and_bound_memory(self):
        self.assertEqual(
            list(chunk_batches(iter(range(53)), 25)),
            [list(range(25)), list(range(25, 50)), list(range(50, 53))],
        )
        with self.assertRaises(ValueError):
            list(chunk_batches(iter([]), 0))


if __name__ == "__main__":
    unittest.main()
