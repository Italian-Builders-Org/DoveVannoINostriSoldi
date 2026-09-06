"""The acquired Ministry CSV must reproduce the public corpus without rewriting its bytes."""
import copy
import gzip
import json
import tempfile
import unittest
from pathlib import Path

import integrated_curated_datasets as corpus

ROOT = Path(__file__).resolve().parents[2]
DATASET = "salute-posti-letto-2023"


class HospitalBedsSourceTests(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        cls.spec, datasets = corpus.load_spec(corpus.DEFAULT_SPEC)
        cls.item = next(item for item in datasets if item["id"] == DATASET)

    def test_official_latin1_csv_reproduces_every_public_row_and_receipt(self):
        parsed = corpus.parse_dataset(ROOT / "tests/fixtures", self.item)
        entry, payload, receipt, _ = corpus.build_dataset(
            self.item, parsed, corpus.resolved_source_metadata(self.spec, DATASET)
        )
        rows = b"".join(gzip.decompress(path.read_bytes()) for path in sorted(
            (ROOT / "src/data/generated/integrated/rows").glob(f"{DATASET}.part-*.jsonl.gz")
        ))
        self.assertEqual(payload, rows)
        self.assertEqual(parsed.logical_rows, 1019)
        self.assertEqual(parsed.headers[6], "N° Reparti")
        self.assertEqual(receipt, json.loads((ROOT / f"data/source-ledger/datasets/{DATASET}.receipt.json").read_bytes()))
        self.assertEqual(entry["licenseStatus"], "verified-open-iodl-2.0")

    def test_changed_source_byte_is_rejected_before_projection(self):
        with tempfile.TemporaryDirectory() as directory:
            source = ROOT / "tests/fixtures" / self.item["relativePath"]
            target = Path(directory) / source.name
            target.write_bytes(source.read_bytes().replace(b"2023;010;", b"2024;010;", 1))
            with self.assertRaisesRegex(corpus.DatasetBuildError, "byte sorgente divergenti"):
                corpus.parse_dataset(Path(directory), self.item)

    def test_encoding_is_explicit_and_never_guessed_from_a_failed_utf8_decode(self):
        item = copy.deepcopy(self.item)
        item.pop("encoding")
        with self.assertRaisesRegex(corpus.DatasetBuildError, "encoding inatteso"):
            corpus.parse_dataset(ROOT / "tests/fixtures", item)
        spec = copy.deepcopy(self.spec)
        next(item for item in spec["datasets"] if item["id"] == DATASET)["encoding"] = "utf-16"
        with self.assertRaisesRegex(corpus.DatasetBuildError, "encoding non supportato"):
            corpus.validate_spec(spec)


if __name__ == "__main__":
    unittest.main()
