from __future__ import annotations

import csv
import copy
import io
import json
import tempfile
import unittest
from decimal import Decimal
from pathlib import Path

import eurostat_inequality_corpus as etl


class EurostatInequalityCorpusTests(unittest.TestCase):
    @classmethod
    def setUpClass(cls) -> None:
        cls.spec = etl.load_spec()
        cls.fixture_dir = etl.ROOT / "tests/fixtures/eurostat-inequality"

    def test_projection_has_two_indicators_and_preserves_decimal_cells(self) -> None:
        payload = etl.projection_bytes(self.spec, etl.ROOT)
        etl.validate_projection(payload, self.spec)
        rows = list(csv.DictReader(io.StringIO(payload.decode("utf-8")), delimiter="|"))

        self.assertEqual(len(rows), 24)
        self.assertEqual([row["Indicatore"] for row in rows[:12]], ["gini"] * 12)
        self.assertEqual([row["Indicatore"] for row in rows[12:]], ["s80s20"] * 12)
        self.assertEqual(rows[0]["Anno rilevazione"], "2014")
        self.assertEqual(rows[0]["Anno redditi"], "2013")
        self.assertEqual(rows[0]["Unità"], "scala da 0 a 100")
        self.assertEqual(rows[12]["Unità"], "rapporto")
        self.assertRegex(rows[0]["Valore"], r"^\d+\.\d+$")
        self.assertEqual(rows[0]["Stato"], "")

    def test_zero_is_observed_and_missing_cell_is_rejected(self) -> None:
        raw = json.loads(
            (self.fixture_dir / "ilc_di12.json").read_text(encoding="utf-8"),
            parse_float=Decimal,
        )
        raw["value"]["0"] = 0
        value, flag = etl._cell(
            raw,
            {"freq": "A", "age": "TOTAL", "statinfo": "GINI_HND", "geo": "IT", "time": "2014"},
            indicator="gini",
        )
        self.assertEqual(value, Decimal("0"))
        self.assertIsNone(flag)
        del raw["value"]["0"]
        with self.assertRaises(etl.SourceError):
            etl._cell(
                raw,
                {"freq": "A", "age": "TOTAL", "statinfo": "GINI_HND", "geo": "IT", "time": "2014"},
                indicator="gini",
            )

    def test_dimension_index_must_be_contiguous(self) -> None:
        raw = etl.parse_json(
            (self.fixture_dir / "ilc_di12.json").read_bytes(),
            "gini",
        )
        raw["dimension"]["time"]["category"]["index"]["2015"] = 0
        with self.assertRaises(etl.SourceError):
            etl._validate_document(
                raw,
                indicator="gini",
                asset=self.spec["source"]["assets"]["gini"],
            )

    def test_datastructure_drift_is_rejected_by_the_source_lock(self) -> None:
        raw = etl.parse_json(
            (self.fixture_dir / "ilc_di12.json").read_bytes(),
            "gini",
        )
        raw["extension"]["datastructure"]["version"] = "0.0"
        with self.assertRaises(etl.SourceError):
            etl._validate_document(
                raw,
                indicator="gini",
                asset=self.spec["source"]["assets"]["gini"],
            )

    def test_status_must_name_existing_cells_and_known_flags(self) -> None:
        raw = etl.parse_json(
            (self.fixture_dir / "ilc_di11.json").read_bytes(),
            "s80s20",
        )
        raw["status"] = {"12": "b"}
        with self.assertRaises(etl.SourceError):
            etl._validate_document(
                raw,
                indicator="s80s20",
                asset=self.spec["source"]["assets"]["s80s20"],
            )

        raw["status"] = {"0": "x"}
        with self.assertRaises(etl.SourceError):
            etl._validate_document(
                raw,
                indicator="s80s20",
                asset=self.spec["source"]["assets"]["s80s20"],
            )

    def test_committed_rows_are_rebuilt_from_raw_fixtures_and_projection_hash_is_pinned(self) -> None:
        etl.check_committed()
        payload = etl.projection_bytes(self.spec, etl.ROOT)
        tampered = copy.deepcopy(self.spec)
        tampered["projection"]["sha256"] = "0" * 64
        with self.assertRaises(etl.SourceError):
            etl.validate_projection(payload, tampered)

    def test_acquisition_dates_are_locked_to_the_snapshot(self) -> None:
        tampered = copy.deepcopy(self.spec)
        tampered["source"]["acquisition"]["checkedAt"] = "2026-09-13"
        tampered["integrity"]["lockSha256"] = etl.lock_sha256(tampered)
        with tempfile.TemporaryDirectory() as directory:
            path = Path(directory) / "source.json"
            path.write_bytes(etl.canonical_json(tampered))
            with self.assertRaises(etl.SourceError):
                etl.load_spec(path)

    def test_corpus_metadata_must_match_the_source_lock(self) -> None:
        corpus_spec, datasets = etl.corpus.load_spec(etl.CORPUS_SPEC)
        item = next(item for item in datasets if item["id"] == etl.DATASET_ID)
        tampered = copy.deepcopy(corpus_spec)
        tampered["sourceMetadata"]["overrides"][etl.DATASET_ID]["holder"] = "Fonte diversa"
        with self.assertRaises(etl.SourceError):
            etl._validate_corpus_contract(self.spec, tampered, item)


if __name__ == "__main__":
    unittest.main()
