from __future__ import annotations

import copy
import gzip
import hashlib
import importlib.util
import io
import json
import sys
import tempfile
import unittest
import zipfile
from pathlib import Path
from unittest import mock
from urllib.parse import quote


REPOSITORY_ROOT = Path(__file__).resolve().parents[2]
SCRIPT_PATH = REPOSITORY_ROOT / "scripts/etl/integrated_curated_datasets.py"

MODULE_SPEC = importlib.util.spec_from_file_location(
    "integrated_curated_datasets",
    SCRIPT_PATH,
)
ETL = importlib.util.module_from_spec(MODULE_SPEC)
sys.modules[MODULE_SPEC.name] = ETL
MODULE_SPEC.loader.exec_module(ETL)


def sha256(payload: bytes) -> str:
    return hashlib.sha256(payload).hexdigest()


def source_spec(
    payload: bytes,
    *,
    rows: int = 2,
    source_fields: list[str] | None = None,
    private_fields: list[str] | None = None,
) -> dict[str, object]:
    headers = ["name", "private_id", "amount", "source", "note"]
    return {
        "schemaVersion": 1,
        "generatedAt": "2026-08-23T00:00:00Z",
        "corpusContract": {
            "elements": 51_303,
            "regularFiles": 46_438,
            "hardlinks": 4_860,
            "symlinks": 5,
        },
        "sourceMetadata": {
            "default": {
                "holder": "Synthetic public authority",
                "referencePeriod": None,
                "publicationDate": None,
                "acquisitionDate": None,
                "checkedAt": "2026-08-23",
                "updateFrequency": None,
                "canonicalUrls": [],
            },
            "overrides": {},
        },
        "datasets": [
            {
                "id": "synthetic-ledger",
                "title": "Synthetic ledger",
                "domain": "tests",
                "relativePath": "dashboard/synthetic.psv",
                "dataKind": "delimited",
                "delimiter": "pipe",
                "authority": "official-primary",
                "licenseStatus": "verified-open-cc-by-4.0",
                "publication": "rows",
                "evidenceLabel": "documented-fact",
                "sourceFields": ["source"] if source_fields is None else source_fields,
                "privateFields": ["private_id"] if private_fields is None else private_fields,
                "caveats": ["Synthetic fixture only."],
                "expected": {
                    "bytes": len(payload),
                    "sha256": sha256(payload),
                    "rows": rows,
                    "columns": len(headers),
                    "headers": headers,
                },
            }
        ],
    }


class IntegratedCuratedDatasetsTests(unittest.TestCase):
    def setUp(self) -> None:
        self.temporary = tempfile.TemporaryDirectory()
        self.temporary_root = Path(self.temporary.name)
        self.repository = self.temporary_root / "repository"
        self.source_root = self.temporary_root / "source"
        self.spec_path = self.repository / "source-spec.json"
        self.catalog_path = self.repository / "generated/catalog.json"
        self.rows_dir = self.repository / "generated/rows"
        self.receipts_dir = self.repository / "ledger/datasets"
        self.proof_path = self.repository / "ledger/proof.json"
        self.private_map = self.temporary_root / "private-map.json"
        self.repository.mkdir()
        (self.source_root / "dashboard").mkdir(parents=True)
        self.original_root = ETL.ROOT
        ETL.ROOT = self.repository

    def tearDown(self) -> None:
        ETL.ROOT = self.original_root
        self.temporary.cleanup()

    def write_fixture(
        self,
        payload: bytes,
        *,
        rows: int = 2,
        source_fields: list[str] | None = None,
        private_fields: list[str] | None = None,
    ) -> dict[str, object]:
        spec = source_spec(
            payload,
            rows=rows,
            source_fields=source_fields,
            private_fields=private_fields,
        )
        self.spec_path.write_text(
            json.dumps(spec, ensure_ascii=False, indent=2) + "\n",
            encoding="utf-8",
        )
        (self.source_root / "dashboard/synthetic.psv").write_bytes(payload)
        return spec

    def write_source_set_fixture(
        self,
        parts: list[tuple[str, bytes, int]],
    ) -> dict[str, object]:
        spec = source_spec(parts[0][1], rows=sum(rows for _, _, rows in parts))
        item = spec["datasets"][0]
        del item["relativePath"]
        item["sources"] = []
        for relative_path, payload, rows in parts:
            path = self.source_root / relative_path
            path.parent.mkdir(parents=True, exist_ok=True)
            path.write_bytes(payload)
            item["sources"].append({
                "relativePath": relative_path,
                "expected": {
                    "bytes": len(payload),
                    "sha256": sha256(payload),
                    "rows": rows,
                },
            })
        item["expected"]["bytes"] = sum(len(payload) for _, payload, _ in parts)
        item["expected"]["rows"] = sum(rows for _, _, rows in parts)
        item["expected"]["sha256"] = ETL.source_set_sha256(item)
        self.spec_path.write_text(
            json.dumps(spec, ensure_ascii=False, indent=2) + "\n",
            encoding="utf-8",
        )
        return spec

    def write_json_items_fixture(
        self,
        payload: bytes,
        *,
        rows: int,
    ) -> dict[str, object]:
        headers = ["name", "private_id", "amount", "source", "note"]
        spec = source_spec(payload, rows=rows)
        item = spec["datasets"][0]
        item["relativePath"] = "dashboard/synthetic.json"
        item["dataKind"] = "json-object-items"
        item.pop("delimiter")
        item["itemsField"] = "items"
        item["countField"] = "n"
        item["expected"] = {
            "bytes": len(payload),
            "sha256": sha256(payload),
            "rows": rows,
            "columns": len(headers),
            "headers": headers,
            "objectKeys": ["items", "n", "note"],
        }
        self.spec_path.write_text(
            json.dumps(spec, ensure_ascii=False, indent=2) + "\n",
            encoding="utf-8",
        )
        (self.source_root / "dashboard/synthetic.json").write_bytes(payload)
        return spec

    def write_catalog_file_fixture(
        self,
        payload: bytes,
        *,
        rows: int,
    ) -> dict[str, object]:
        spec = source_spec(payload, rows=rows, source_fields=[], private_fields=[])
        item = spec["datasets"][0]
        item["relativePath"] = "dashboard/synthetic.archive"
        item["dataKind"] = "catalog-file"
        item.pop("delimiter")
        item["publication"] = "catalog-only"
        item["expected"] = {
            "bytes": len(payload),
            "sha256": sha256(payload),
            "rows": rows,
            "columns": 1,
            "headers": ["record"],
        }
        item["inspection"] = {
            "schemaVersion": 1,
            "kind": "delimited-set",
            "rows": rows,
            "validRows": rows,
            "malformedRows": 0,
            "files": [{
                "id": "source-0001",
                "encoding": "utf-8-sig",
                "delimiter": "comma",
                "columns": 1,
                "headerSha256": sha256(ETL.canonical_json(["record"])),
                "rows": rows,
                "validRows": rows,
                "malformedRows": 0,
            }],
        }
        self.spec_path.write_text(
            json.dumps(spec, ensure_ascii=False, indent=2) + "\n",
            encoding="utf-8",
        )
        (self.source_root / "dashboard/synthetic.archive").write_bytes(payload)
        return spec

    def build(self) -> dict[str, bytes]:
        artifacts = ETL.build_artifacts(
            spec_path=self.spec_path,
            source_root=self.source_root,
            catalog_path=self.catalog_path,
            rows_dir=self.rows_dir,
            receipts_dir=self.receipts_dir,
            proof_path=self.proof_path,
            private_map_out=self.private_map,
        )
        ETL.commit_artifacts(artifacts)
        return artifacts

    def check(self) -> None:
        ETL.check_committed(
            spec_path=self.spec_path,
            catalog_path=self.catalog_path,
            rows_dir=self.rows_dir,
            receipts_dir=self.receipts_dir,
            proof_path=self.proof_path,
        )

    def row_chunk_paths(self) -> list[Path]:
        return sorted(self.rows_dir.glob("synthetic-ledger.part-*.jsonl.gz"))

    def first_row_chunk_path(self) -> Path:
        paths = self.row_chunk_paths()
        self.assertGreater(len(paths), 0)
        return paths[0]

    def read_rows_payload(self) -> bytes:
        return b"".join(gzip.decompress(path.read_bytes()) for path in self.row_chunk_paths())

    def assert_public_urls_rejected(self, values: list[str]) -> None:
        self.assertEqual(ETL.extract_public_urls(values), [])
        for value in values:
            with self.subTest(value=value):
                self.assertFalse(ETL.is_safe_public_url(value))
                sanitized, reasons = ETL.sanitize_public_cell("source", value, set())
                self.assertNotEqual(sanitized, value)
                self.assertIn("unsafe-url", reasons)

    def test_build_is_deterministic_and_preserves_missing_zero_and_row_accounting(self) -> None:
        payload = (
            "name|private_id|amount|source|note\n"
            "Alpha|ID-001||https://example.gov.it/atto/1|/workspace/private/source.tsv\n"
            "Beta||0|https://example.gov.it/atto/2?token=synthetic-secret|public note\n"
        ).encode("utf-8")
        self.write_fixture(payload)

        first = self.build()
        first_bytes = {path: value for path, value in first.items()}
        second = ETL.build_artifacts(
            spec_path=self.spec_path,
            source_root=self.source_root,
            catalog_path=self.catalog_path,
            rows_dir=self.rows_dir,
            receipts_dir=self.receipts_dir,
            proof_path=self.proof_path,
            private_map_out=self.private_map,
        )
        self.assertEqual(second, first_bytes)
        self.check()

        rows = [
            json.loads(line)
            for line in self.read_rows_payload().decode("utf-8").splitlines()
        ]
        self.assertEqual(len(rows), 2)
        self.assertEqual(rows[0]["cells"]["amount"], "")
        self.assertEqual(rows[1]["cells"]["amount"], "0")
        self.assertIsNone(rows[0]["cells"]["private_id"])
        self.assertEqual(rows[1]["cells"]["private_id"], "")
        self.assertNotIn("workspace", rows[0]["cells"]["note"].lower())
        self.assertEqual(rows[0]["sourceUrls"], ["https://example.gov.it/atto/1"])
        self.assertEqual(rows[1]["sourceUrls"], [])

        receipt = json.loads(
            (self.receipts_dir / "synthetic-ledger.receipt.json").read_text(encoding="utf-8")
        )
        self.assertEqual(receipt["source"]["rows"], 2)
        self.assertEqual(receipt["publication"]["publicRows"], 2)
        self.assertEqual(receipt["publication"]["catalogOnlyRows"], 0)
        self.assertEqual(receipt["publication"]["derivedOnlyRows"], 0)
        self.assertTrue(receipt["rowEquationClosed"])

    def test_public_rows_are_chunked_losslessly_at_one_thousand_rows(self) -> None:
        body = "".join(
            f"Name {index}||{index}|https://example.gov.it/atto/{index}|note\n"
            for index in range(1, 1_002)
        )
        payload = (
            "name|private_id|amount|source|note\n" + body
        ).encode("utf-8")
        self.write_fixture(payload, rows=1_001)

        self.build()
        self.check()

        chunks = self.row_chunk_paths()
        self.assertEqual(
            [path.name for path in chunks],
            [
                "synthetic-ledger.part-00000.jsonl.gz",
                "synthetic-ledger.part-00001.jsonl.gz",
            ],
        )
        decoded = [gzip.decompress(path.read_bytes()) for path in chunks]
        self.assertEqual([len(chunk.splitlines()) for chunk in decoded], [1_000, 1])
        self.assertTrue(all(len(chunk) <= ETL.PUBLIC_ROW_CHUNK_MAX_RAW_BYTES for chunk in decoded))
        receipt = json.loads(
            (self.receipts_dir / "synthetic-ledger.receipt.json").read_text(encoding="utf-8")
        )
        self.assertEqual(receipt["rowsSha256"], sha256(b"".join(decoded)))

    def test_public_row_chunk_fails_closed_above_two_mebibytes(self) -> None:
        note = "x" * 2_100
        payload = (
            "name|private_id|amount|source|note\n"
            + "".join(
                f"Alpha {index}||1|https://example.gov.it/atto/{index}|{note}\n"
                for index in range(1, 1_001)
            )
        ).encode("utf-8")
        self.write_fixture(payload, rows=1_000)

        with self.assertRaisesRegex(ETL.DatasetBuildError, "chunk righe oltre"):
            self.build()

    def test_check_streams_a_gzip_bomb_only_to_the_public_chunk_limit(self) -> None:
        payload = (
            "name|private_id|amount|source|note\n"
            "Alpha||1|https://example.gov.it/atto/1|note\n"
        ).encode("utf-8")
        self.write_fixture(payload, rows=1)
        self.build()
        bomb = ETL.canonical_gzip(b"x" * (ETL.PUBLIC_ROW_CHUNK_MAX_RAW_BYTES + 1))
        self.first_row_chunk_path().write_bytes(bomb)

        with self.assertRaisesRegex(ETL.DatasetBuildError, "chunk righe troppo grande"):
            self.check()

    def test_check_rejects_a_symlinked_public_row_chunk(self) -> None:
        payload = (
            "name|private_id|amount|source|note\n"
            "Alpha||1|https://example.gov.it/atto/1|note\n"
        ).encode("utf-8")
        self.write_fixture(payload, rows=1)
        self.build()
        chunk_path = self.first_row_chunk_path()
        detached_chunk = self.temporary_root / "detached.jsonl.gz"
        chunk_path.replace(detached_chunk)
        chunk_path.symlink_to(detached_chunk)

        with self.assertRaisesRegex(ETL.DatasetBuildError, "artefatto non regolare"):
            self.check()

    def test_check_caps_the_compressed_public_row_chunk(self) -> None:
        payload = (
            "name|private_id|amount|source|note\n"
            "Alpha||1|https://example.gov.it/atto/1|note\n"
        ).encode("utf-8")
        self.write_fixture(payload, rows=1)
        self.build()
        self.first_row_chunk_path().write_bytes(
            b"x" * (ETL.PUBLIC_ROW_CHUNK_MAX_COMPRESSED_BYTES + 1)
        )

        with self.assertRaisesRegex(ETL.DatasetBuildError, "compresso troppo grande"):
            self.check()

    def test_build_prunes_only_stale_row_artifacts_in_the_generated_rows_directory(self) -> None:
        payload = (
            "name|private_id|amount|source|note\n"
            "Alpha||1|https://example.gov.it/atto/1|note\n"
        ).encode("utf-8")
        self.write_fixture(payload, rows=1)
        stale = self.rows_dir / "synthetic-ledger.jsonl.gz"
        stale.parent.mkdir(parents=True, exist_ok=True)
        stale.write_bytes(gzip.compress(b"{}\n", compresslevel=9, mtime=0))

        self.build()

        self.assertFalse(stale.exists())
        self.assertEqual(
            [path.name for path in self.row_chunk_paths()],
            ["synthetic-ledger.part-00000.jsonl.gz"],
        )

    def test_source_set_is_reproducible_and_maps_each_row_to_its_private_file(self) -> None:
        header = "name|private_id|amount|source|note\n"
        first = (
            header
            + "Alpha|ID-001|1|https://example.gov.it/atto/1|prima\n"
        ).encode("utf-8")
        second = (
            header
            + "Beta|ID-002|2|https://example.gov.it/atto/2|seconda\n"
        ).encode("utf-8")
        self.write_source_set_fixture([
            ("dashboard/part-a.psv", first, 1),
            ("dashboard/part-b.psv", second, 1),
        ])

        self.build()
        self.check()

        receipt_path = self.receipts_dir / "synthetic-ledger.receipt.json"
        receipt_payload = receipt_path.read_text(encoding="utf-8")
        receipt = json.loads(receipt_payload)
        self.assertEqual(receipt["source"]["rows"], 2)
        self.assertEqual(receipt["source"]["bytes"], len(first) + len(second))
        self.assertEqual(
            receipt["source"]["sha256"],
            receipt["source"]["sourceSet"]["sha256"],
        )
        self.assertEqual(
            [part["id"] for part in receipt["source"]["sourceSet"]["files"]],
            ["source-0001", "source-0002"],
        )
        self.assertNotIn("part-a.psv", receipt_payload)
        self.assertNotIn("part-b.psv", receipt_payload)

        private_map = json.loads(self.private_map.read_text(encoding="utf-8"))
        dataset = private_map["datasets"][0]
        self.assertEqual(private_map["schemaVersion"], 2)
        self.assertEqual(
            [source["sourceRelativePath"] for source in dataset["sources"]],
            ["dashboard/part-a.psv", "dashboard/part-b.psv"],
        )
        self.assertEqual(
            dataset["rowRanges"],
            [
                {
                    "sourceId": "source-0001",
                    "sourceRowStart": 1,
                    "sourceRowEnd": 1,
                    "sourceFileRowStart": 1,
                    "sourceFileRowEnd": 1,
                },
                {
                    "sourceId": "source-0002",
                    "sourceRowStart": 2,
                    "sourceRowEnd": 2,
                    "sourceFileRowStart": 1,
                    "sourceFileRowEnd": 1,
                },
            ],
        )
        self.assertEqual(
            [
                (row["sourceId"], row["sourceFileRow"])
                for row in dataset["rows"]
            ],
            [("source-0001", 1), ("source-0002", 1)],
        )

    def test_edge_split_preserves_literal_note_delimiter_for_l38_cases(self) -> None:
        headers = [
            "ente", "codice_ipa", "cf", "sezione", "URL",
            "tipo_documenti", "formato", "popolata", "note", "fonte",
        ]
        header = "|".join(headers) + "\n"
        gran_paradiso = (
            header
            + "Gran Paradiso|gp|CF-GP|bandi|https://example.gov.it/gp|atti|html|si|"
            + "nota | delimitatore preservato|https://example.gov.it/fonte-gp\n"
        ).encode("utf-8")
        pantelleria = (
            header
            + "Pantelleria|pt|CF-PT|bandi|https://example.gov.it/pt|atti|pdf|no|"
            + "altra nota | verbatim|https://example.gov.it/fonte-pt\n"
        ).encode("utf-8")
        spec = source_spec(gran_paradiso, rows=2)
        item = spec["datasets"][0]
        del item["relativePath"]
        item["dataKind"] = "delimited-edge-split"
        item["edgeSplit"] = {"left": 8, "right": 1}
        item["sourceFields"] = ["URL", "fonte"]
        item["privateFields"] = ["cf"]
        item["sources"] = []
        for relative_path, payload in [
            ("at-catalog/l38-gran-paradiso.tsv", gran_paradiso),
            ("at-catalog/l38-pantelleria.tsv", pantelleria),
        ]:
            path = self.source_root / relative_path
            path.parent.mkdir(parents=True, exist_ok=True)
            path.write_bytes(payload)
            item["sources"].append({
                "relativePath": relative_path,
                "expected": {
                    "bytes": len(payload),
                    "sha256": sha256(payload),
                    "rows": 1,
                },
            })
        item["expected"] = {
            "bytes": len(gran_paradiso) + len(pantelleria),
            "sha256": "0" * 64,
            "rows": 2,
            "columns": len(headers),
            "headers": headers,
        }
        item["expected"]["sha256"] = ETL.source_set_sha256(item)
        self.spec_path.write_text(
            json.dumps(spec, ensure_ascii=False, indent=2) + "\n",
            encoding="utf-8",
        )

        self.build()
        self.check()
        rows = [
            json.loads(line)
            for line in self.read_rows_payload().decode("utf-8").splitlines()
        ]
        self.assertEqual(rows[0]["cells"]["note"], "nota | delimitatore preservato")
        self.assertEqual(rows[1]["cells"]["note"], "altra nota | verbatim")
        self.assertEqual(
            rows[0]["sourceUrls"],
            ["https://example.gov.it/fonte-gp", "https://example.gov.it/gp"],
        )

    def test_edge_split_rejects_unclosed_edges(self) -> None:
        payload = b"a|b|middle|c\n1|2|missing-right-edge\n"
        spec = source_spec(payload, rows=1, source_fields=[], private_fields=[])
        item = spec["datasets"][0]
        item["dataKind"] = "delimited-edge-split"
        item["edgeSplit"] = {"left": 2, "right": 1}
        item["expected"]["headers"] = ["a", "b", "middle", "c"]
        item["expected"]["columns"] = 4
        self.spec_path.write_text(
            json.dumps(spec, ensure_ascii=False, indent=2) + "\n",
            encoding="utf-8",
        )
        (self.source_root / "dashboard/synthetic.psv").write_bytes(payload)

        with self.assertRaisesRegex(ETL.DatasetBuildError, "righe malformed"):
            self.build()

    def test_source_set_rejects_reordering_duplicates_mixed_headers_and_row_drift(self) -> None:
        header = "name|private_id|amount|source|note\n"
        first = (header + "Alpha||1||prima\n").encode("utf-8")
        second = (header + "Beta||2||seconda\n").encode("utf-8")
        spec = self.write_source_set_fixture([
            ("dashboard/part-a.psv", first, 1),
            ("dashboard/part-b.psv", second, 1),
        ])

        reordered = copy.deepcopy(spec)
        reordered["datasets"][0]["sources"].reverse()
        with self.assertRaisesRegex(ETL.DatasetBuildError, "ordinate|hash source set"):
            ETL.validate_spec(reordered)

        duplicate = copy.deepcopy(spec)
        duplicate["datasets"][0]["sources"][1]["relativePath"] = (
            duplicate["datasets"][0]["sources"][0]["relativePath"]
        )
        with self.assertRaisesRegex(ETL.DatasetBuildError, "duplicato"):
            ETL.validate_spec(duplicate)

        wrong_set_hash = copy.deepcopy(spec)
        wrong_set_hash["datasets"][0]["expected"]["sha256"] = "0" * 64
        with self.assertRaisesRegex(ETL.DatasetBuildError, "hash source set"):
            ETL.validate_spec(wrong_set_hash)

        mixed = (
            "different|private_id|amount|source|note\n"
            "Beta||2||seconda\n"
        ).encode("utf-8")
        mixed_spec = self.write_source_set_fixture([
            ("dashboard/part-a.psv", first, 1),
            ("dashboard/part-b.psv", mixed, 1),
        ])
        with self.assertRaisesRegex(ETL.DatasetBuildError, "schema sorgente"):
            ETL.parse_dataset(self.source_root, ETL.validate_spec(mixed_spec)[0])

        row_drift_spec = self.write_source_set_fixture([
            ("dashboard/part-a.psv", first, 1),
            ("dashboard/part-b.psv", second, 2),
        ])
        with self.assertRaisesRegex(ETL.DatasetBuildError, "conteggio righe"):
            ETL.parse_dataset(self.source_root, ETL.validate_spec(row_drift_spec)[0])

    def test_json_object_items_is_projected_as_exact_rows(self) -> None:
        value = {
            "items": [
                {
                    "name": "Alpha",
                    "private_id": "ID-001",
                    "amount": 0,
                    "source": "https://example.gov.it/atto/1",
                    "note": None,
                },
                {
                    "name": "Beta",
                    "private_id": "",
                    "amount": 2.5,
                    "source": "",
                    "note": {"originale": "2,50", "eur": 2.5, "parse_ok": True},
                },
            ],
            "n": 2,
            "note": "fixture",
        }
        payload = json.dumps(
            value,
            ensure_ascii=False,
            separators=(",", ":"),
        ).encode("utf-8")
        self.write_json_items_fixture(payload, rows=2)

        self.build()
        self.check()

        rows = [
            json.loads(line)
            for line in self.read_rows_payload().decode("utf-8").splitlines()
        ]
        self.assertEqual(len(rows), 2)
        self.assertEqual(rows[0]["cells"]["amount"], "0")
        self.assertEqual(rows[0]["cells"]["note"], "")
        self.assertIsNone(rows[0]["cells"]["private_id"])
        self.assertEqual(rows[0]["sourceUrls"], ["https://example.gov.it/atto/1"])
        self.assertEqual(
            rows[1]["cells"]["note"],
            '{"eur":2.5,"originale":"2,50","parse_ok":true}',
        )

    def test_json_object_items_rejects_hostile_or_ambiguous_shapes(self) -> None:
        base_item = {
            "name": "Alpha",
            "private_id": "",
            "amount": 1,
            "source": "",
            "note": "ok",
        }
        hostile_payloads = (
            json.dumps(
                {"items": [base_item], "n": 1, "note": "x", "extra": True},
                separators=(",", ":"),
            ).encode("utf-8"),
            json.dumps(
                {"items": [base_item], "n": 2, "note": "x"},
                separators=(",", ":"),
            ).encode("utf-8"),
            json.dumps(
                {"items": ["not-an-object"], "n": 1, "note": "x"},
                separators=(",", ":"),
            ).encode("utf-8"),
            json.dumps(
                {"items": [{key: value for key, value in base_item.items() if key != "note"}], "n": 1, "note": "x"},
                separators=(",", ":"),
            ).encode("utf-8"),
            b'{"items":[],"items":[],"n":0,"note":"x"}',
            b'{"items":[{"name":"A","private_id":"","amount":1,"source":"","note":NaN}],"n":1,"note":"x"}',
        )

        for payload in hostile_payloads:
            with self.subTest(payload=payload):
                rows = 0 if b'"items":[]' in payload else 1
                spec = self.write_json_items_fixture(payload, rows=rows)
                item = ETL.validate_spec(spec)[0]
                with self.assertRaisesRegex(
                    ETL.DatasetBuildError,
                    "JSON|schema|conteggio",
                ):
                    ETL.parse_dataset(self.source_root, item)

    def test_catalog_file_hashes_in_bounded_chunks_without_materializing_rows(self) -> None:
        logical_rows = 4_096
        payload = b"record\n" + (b"x" * 767 + b"\n") * logical_rows
        spec = self.write_catalog_file_fixture(payload, rows=logical_rows)
        item = ETL.validate_spec(spec)[0]
        real_fdopen = ETL.os.fdopen
        read_sizes: list[int] = []

        class TrackingReader:
            def __init__(self, handle: object) -> None:
                self.handle = handle

            def __enter__(self) -> object:
                self.handle.__enter__()
                return self

            def __exit__(self, *args: object) -> object:
                return self.handle.__exit__(*args)

            def read(self, size: int = -1) -> bytes:
                read_sizes.append(size)
                return self.handle.read(size)

            def __getattr__(self, name: str) -> object:
                return getattr(self.handle, name)

        def tracking_fdopen(descriptor: int, mode: str) -> object:
            handle = real_fdopen(descriptor, mode)
            return TrackingReader(handle) if mode == "rb" else handle

        with mock.patch.object(
            ETL,
            "read_pinned_source",
            side_effect=AssertionError("catalog-file letto in memoria"),
        ), mock.patch.object(ETL.os, "fdopen", side_effect=tracking_fdopen):
            parsed = ETL.parse_dataset(self.source_root, item)

        self.assertEqual(parsed.rows, [])
        self.assertEqual(parsed.logical_rows, logical_rows)
        self.assertEqual(parsed.inspection["validRows"], logical_rows)
        self.assertGreater(len(read_sizes), 3)
        self.assertTrue(all(0 < size <= 1024 * 1024 for size in read_sizes))

        self.build()
        self.check()
        self.assertEqual(self.row_chunk_paths(), [])
        private_map = json.loads(self.private_map.read_text(encoding="utf-8"))
        private_dataset = private_map["datasets"][0]
        self.assertEqual(private_dataset["rows"], [])
        self.assertEqual(private_dataset["rowRanges"], [{
            "sourceId": "source-0001",
            "sourceRowStart": 1,
            "sourceRowEnd": logical_rows,
            "sourceFileRowStart": 1,
            "sourceFileRowEnd": logical_rows,
        }])
        receipt = json.loads(
            (self.receipts_dir / "synthetic-ledger.receipt.json").read_text(encoding="utf-8")
        )
        self.assertEqual(receipt["source"]["rows"], logical_rows)
        self.assertEqual(receipt["publication"]["catalogOnlyRows"], logical_rows)
        self.assertEqual(receipt["source"]["inspection"]["validRows"], logical_rows)
        self.assertNotIn("name", json.dumps(receipt["source"]["inspection"]))

    def test_catalog_file_recounts_rows_instead_of_copying_expected_rows(self) -> None:
        payload = b"record\nalpha\nbeta\n"
        spec = self.write_catalog_file_fixture(payload, rows=3)
        item = ETL.validate_spec(spec)[0]

        with self.assertRaisesRegex(ETL.DatasetBuildError, "conteggio righe delimitate"):
            ETL.parse_dataset(self.source_root, item)

    def test_catalog_file_counts_quoted_newlines_as_one_csv_record(self) -> None:
        payload = b'a,b\n"one\nline",x\ntwo,y\n'
        spec = self.write_catalog_file_fixture(payload, rows=2)
        item = spec["datasets"][0]
        file_inspection = item["inspection"]["files"][0]
        file_inspection["columns"] = 2
        file_inspection["headerSha256"] = sha256(ETL.canonical_json(["a", "b"]))
        validated = ETL.validate_spec(spec)[0]

        parsed = ETL.parse_dataset(self.source_root, validated)

        self.assertEqual(parsed.logical_rows, 2)
        self.assertEqual(parsed.inspection["validRows"], 2)

    def test_catalog_file_preserves_an_exact_malformed_terminal_fragment(self) -> None:
        fragment = b'"unterminated'
        payload = b"a,b\n1,2\n" + fragment
        spec = self.write_catalog_file_fixture(payload, rows=2)
        item = spec["datasets"][0]
        file_inspection = item["inspection"]["files"][0]
        file_inspection.update({
            "columns": 2,
            "headerSha256": sha256(ETL.canonical_json(["a", "b"])),
            "validRows": 1,
            "malformedRows": 1,
            "terminalFragment": {"bytes": len(fragment), "sha256": sha256(fragment)},
        })
        item["inspection"]["validRows"] = 1
        item["inspection"]["malformedRows"] = 1
        validated = ETL.validate_spec(spec)[0]

        parsed = ETL.parse_dataset(self.source_root, validated)

        self.assertEqual(parsed.logical_rows, 2)
        self.assertEqual(parsed.inspection["validRows"], 1)
        self.assertEqual(parsed.inspection["malformedRows"], 1)

        hostile = copy.deepcopy(validated)
        hostile["inspection"]["files"][0]["terminalFragment"]["sha256"] = "0" * 64
        with self.assertRaisesRegex(ETL.DatasetBuildError, "frammento terminale"):
            ETL.parse_dataset(self.source_root, hostile)

    def zip_catalog_spec(
        self,
        members: dict[str, bytes],
        *,
        rows: int,
        columns: int,
        header: list[str],
        physical_lines: int,
    ) -> dict[str, object]:
        output = io.BytesIO()
        with zipfile.ZipFile(output, "w", compression=zipfile.ZIP_DEFLATED) as archive:
            for name, payload in members.items():
                archive.writestr(name, payload)
        payload = output.getvalue()
        spec = self.write_catalog_file_fixture(payload, rows=rows)
        item = spec["datasets"][0]
        path = self.source_root / item["relativePath"]
        with zipfile.ZipFile(path) as archive:
            infos = sorted(archive.infolist(), key=lambda info: info.filename)
        member_inspections = []
        for index, info in enumerate(infos, 1):
            member_inspections.append({
                "id": f"member-{index:04d}",
                "name": info.filename,
                "bytes": info.file_size,
                "compressedBytes": info.compress_size,
                "crc32": f"{info.CRC:08x}",
                "flagBits": info.flag_bits,
                "compression": info.compress_type,
                "rows": rows,
                "physicalDataLines": physical_lines,
                "columns": columns,
                "headerSha256": sha256(ETL.canonical_json(header)),
            })
        total_bytes = sum(info.file_size for info in infos)
        item["inspection"] = {
            "schemaVersion": 1,
            "kind": "zip-delimited-set",
            "rows": rows,
            "validRows": rows,
            "malformedRows": 0,
            "encoding": "utf-8-sig",
            "delimiter": "semicolon",
            "maxTotalUncompressedBytes": total_bytes,
            "files": [{
                "id": "source-0001",
                "rows": rows,
                "validRows": rows,
                "malformedRows": 0,
                "members": member_inspections,
            }],
        }
        return spec

    def test_zip_catalog_streams_strict_records_and_rejects_fake_dimensions(self) -> None:
        spec = self.zip_catalog_spec(
            {"records.csv": b'a;b\n"one\nline";x\ntwo;y\n'},
            rows=2,
            columns=2,
            header=["a", "b"],
            physical_lines=3,
        )
        parsed = ETL.parse_dataset(self.source_root, ETL.validate_spec(spec)[0])
        self.assertEqual(parsed.logical_rows, 2)

        wrong_width = self.zip_catalog_spec(
            {"records.csv": b"a;b\none;x;extra\n"},
            rows=1,
            columns=2,
            header=["a", "b"],
            physical_lines=1,
        )
        with self.assertRaisesRegex(ETL.DatasetBuildError, "larghezza"):
            ETL.parse_dataset(self.source_root, ETL.validate_spec(wrong_width)[0])

    def test_zip_catalog_rejects_traversal_and_the_committed_inflation_limit(self) -> None:
        output = io.BytesIO()
        with zipfile.ZipFile(output, "w", compression=zipfile.ZIP_DEFLATED) as archive:
            archive.writestr("../records.csv", b"a\nx\n")
        output.seek(0)
        with zipfile.ZipFile(output) as archive:
            info = archive.infolist()[0]
            expected = [{
                "id": "member-0001", "name": info.filename, "bytes": info.file_size,
                "compressedBytes": info.compress_size, "crc32": f"{info.CRC:08x}",
                "flagBits": info.flag_bits, "compression": info.compress_type,
            }]
            with self.assertRaisesRegex(ETL.DatasetBuildError, "non sicuro"):
                ETL.inspect_zip_members(
                    archive,
                    expected,
                    max_total_uncompressed_bytes=info.file_size,
                    dataset_id="hostile",
                )

        output = io.BytesIO()
        with zipfile.ZipFile(output, "w", compression=zipfile.ZIP_DEFLATED) as archive:
            archive.writestr("records.csv", b"a\n" + b"x" * 4096)
        output.seek(0)
        with zipfile.ZipFile(output) as archive:
            info = archive.infolist()[0]
            expected = [{
                "id": "member-0001", "name": info.filename, "bytes": info.file_size,
                "compressedBytes": info.compress_size, "crc32": f"{info.CRC:08x}",
                "flagBits": info.flag_bits, "compression": info.compress_type,
            }]
            with self.assertRaisesRegex(ETL.DatasetBuildError, "limite decompressione"):
                ETL.inspect_zip_members(
                    archive,
                    expected,
                    max_total_uncompressed_bytes=64,
                    dataset_id="hostile",
                )

    def test_zip_xls_inspection_recounts_the_sheet_with_a_pinned_parser(self) -> None:
        inner = b"synthetic-biff-payload"
        output = io.BytesIO()
        with zipfile.ZipFile(output, "w", compression=zipfile.ZIP_DEFLATED) as archive:
            archive.writestr("book.xls", inner)
        payload = output.getvalue()
        spec = self.write_catalog_file_fixture(payload, rows=2)
        item = spec["datasets"][0]
        with zipfile.ZipFile(self.source_root / item["relativePath"]) as archive:
            info = archive.infolist()[0]
        item["inspection"] = {
            "schemaVersion": 1,
            "kind": "zip-xls",
            "rows": 2,
            "validRows": 2,
            "malformedRows": 0,
            "maxTotalUncompressedBytes": len(inner),
            "files": [{
                "id": "source-0001",
                "rows": 2,
                "validRows": 2,
                "malformedRows": 0,
                "member": {
                    "id": "member-0001",
                    "name": info.filename,
                    "bytes": info.file_size,
                    "compressedBytes": info.compress_size,
                    "crc32": f"{info.CRC:08x}",
                    "flagBits": info.flag_bits,
                    "compression": info.compress_type,
                    "sha256": sha256(inner),
                },
                "sheet": {
                    "index": 0,
                    "name": "Data",
                    "count": 1,
                    "headerRows": 1,
                    "physicalRows": 3,
                    "rows": 2,
                    "columns": 2,
                    "headerSha256": sha256(ETL.canonical_json(["first", "second"])),
                },
            }],
        }

        class Cell:
            def __init__(self, value: object) -> None:
                self.value = value
                self.ctype = 1

        class Sheet:
            name = "Data"
            nrows = 3
            ncols = 2

            def cell(self, row: int, column: int) -> Cell:
                return Cell(["first", "second"][column])

        class Workbook:
            nsheets = 1

            def sheet_by_index(self, index: int) -> Sheet:
                self.asserted_index = index
                return Sheet()

            def release_resources(self) -> None:
                return None

        class FakeXlrd:
            XL_CELL_EMPTY = 0
            XL_CELL_TEXT = 1
            XL_CELL_NUMBER = 2
            XL_CELL_DATE = 3
            XL_CELL_BOOLEAN = 4
            XL_CELL_ERROR = 5
            XL_CELL_BLANK = 6

            @staticmethod
            def open_workbook(*, file_contents: bytes, on_demand: bool) -> Workbook:
                if file_contents != inner or on_demand is not True:
                    raise AssertionError("XLS payload or mode changed")
                return Workbook()

        validated = ETL.validate_spec(spec)[0]
        with mock.patch.object(ETL, "import_pinned_xlrd", return_value=FakeXlrd):
            parsed = ETL.parse_dataset(self.source_root, validated)
        self.assertEqual(parsed.logical_rows, 2)

    def xlsx_catalog_spec(self, *, dimension: str = "A1:B3", dtd: bool = False) -> dict[str, object]:
        workbook_prefix = '<!DOCTYPE workbook [<!ENTITY xxe SYSTEM "file:///tmp/secret">]>' if dtd else ""
        members = {
            "xl/_rels/workbook.xml.rels": (
                '<?xml version="1.0"?><Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">'
                '<Relationship Id="rId1" Target="worksheets/sheet1.xml"/></Relationships>'
            ).encode(),
            "xl/sharedStrings.xml": (
                '<?xml version="1.0"?><sst xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main">'
                '<si><t>first</t></si><si><t>second</t></si></sst>'
            ).encode(),
            "xl/workbook.xml": (
                workbook_prefix
                + '<?xml version="1.0"?><workbook xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main" '
                'xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships">'
                '<sheets><sheet name="Data" sheetId="1" r:id="rId1"/></sheets></workbook>'
            ).encode(),
            "xl/worksheets/sheet1.xml": (
                '<?xml version="1.0"?><worksheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main">'
                f'<dimension ref="{dimension}"/><sheetData>'
                '<row r="1"><c r="A1" t="s"><v>0</v></c><c r="B1" t="s"><v>1</v></c></row>'
                '<row r="2"><c r="A2"><v>1</v></c></row>'
                '<row r="3"><c r="A3"><v>2</v></c></row>'
                '</sheetData></worksheet>'
            ).encode(),
        }
        output = io.BytesIO()
        with zipfile.ZipFile(output, "w", compression=zipfile.ZIP_DEFLATED) as archive:
            for name, payload in members.items():
                archive.writestr(name, payload)
        payload = output.getvalue()
        spec = self.write_catalog_file_fixture(payload, rows=2)
        item = spec["datasets"][0]
        with zipfile.ZipFile(self.source_root / item["relativePath"]) as archive:
            infos = sorted(archive.infolist(), key=lambda info: info.filename)
        item["inspection"] = {
            "schemaVersion": 1,
            "kind": "xlsx",
            "rows": 2,
            "validRows": 2,
            "malformedRows": 0,
            "maxTotalUncompressedBytes": sum(info.file_size for info in infos),
            "files": [{
                "id": "source-0001",
                "rows": 2,
                "validRows": 2,
                "malformedRows": 0,
                "archiveMembers": [
                    {
                        "id": f"member-{index:04d}",
                        "name": info.filename,
                        "bytes": info.file_size,
                        "compressedBytes": info.compress_size,
                        "crc32": f"{info.CRC:08x}",
                        "flagBits": info.flag_bits,
                        "compression": info.compress_type,
                    }
                    for index, info in enumerate(infos, 1)
                ],
                "sheet": {
                    "index": 0,
                    "name": "Data",
                    "count": 1,
                    "headerRows": 1,
                    "physicalRows": 3,
                    "rows": 2,
                    "columns": 2 if dimension == "A1:B3" else 3,
                    "dimension": dimension,
                    "headerSha256": sha256(
                        ETL.canonical_json(
                            ["first", "second"] if dimension == "A1:B3" else ["first", "second", None]
                        )
                    ),
                },
            }],
        }
        return spec

    def test_xlsx_inspection_is_path_free_and_rejects_xml_or_dimension_spoofing(self) -> None:
        spec = self.xlsx_catalog_spec()
        parsed = ETL.parse_dataset(self.source_root, ETL.validate_spec(spec)[0])
        self.assertEqual(parsed.logical_rows, 2)
        self.assertNotIn("xl/", json.dumps(parsed.inspection))

        spoofed = self.xlsx_catalog_spec(dimension="A1:C3")
        with self.assertRaisesRegex(ETL.DatasetBuildError, "dimensione XLSX"):
            ETL.parse_dataset(self.source_root, ETL.validate_spec(spoofed)[0])

        hostile_xml = self.xlsx_catalog_spec(dtd=True)
        with self.assertRaisesRegex(ETL.DatasetBuildError, "XML non sicuro"):
            ETL.parse_dataset(self.source_root, ETL.validate_spec(hostile_xml)[0])

    def test_check_rejects_tampering_with_public_catalog_inspection(self) -> None:
        payload = b"record\nalpha\n"
        self.write_catalog_file_fixture(payload, rows=1)
        self.build()
        receipt_path = self.receipts_dir / "synthetic-ledger.receipt.json"
        receipt = json.loads(receipt_path.read_text(encoding="utf-8"))
        receipt["source"]["inspection"]["validRows"] = 0
        receipt_path.write_bytes(ETL.canonical_json(receipt))

        with self.assertRaisesRegex(ETL.DatasetBuildError, "sorgente|hash artefatto"):
            self.check()

    def test_spec_rejects_a_source_field_that_is_also_private(self) -> None:
        payload = (
            "name|private_id|amount|source|note\n"
            "Alpha|https://example.gov.it/private?id=1|1||note\n"
        ).encode("utf-8")
        spec = self.write_fixture(
            payload,
            rows=1,
            source_fields=["private_id"],
            private_fields=["private_id"],
        )

        with self.assertRaisesRegex(ETL.DatasetBuildError, "privat|sourceFields|privateFields"):
            ETL.validate_spec(copy.deepcopy(spec))

    def test_url_extraction_rejects_userinfo_and_even_blank_sensitive_keys(self) -> None:
        values = [
            "https://user:password@example.gov.it/source",
            "https://example.gov.it/source?token=",
            "https://example.gov.it/source?API_KEY=synthetic-secret",
            "https://example.gov.it/source?api-key=synthetic-secret",
            "https://example.gov.it/source?accessToken=synthetic-secret",
            "https://example.gov.it/source?clientSecret=synthetic-secret",
            "https://example.gov.it/source?refreshToken=synthetic-secret",
            "https://example.gov.it/source?sessionId=synthetic-secret",
            "https://example.gov.it/source?session_id=synthetic-secret",
            "https://example.gov.it/source?x-amz-signature=synthetic-secret",
            "https://example.gov.it/source#access_token=synthetic-secret",
        ]
        self.assert_public_urls_rejected(values)

    def test_url_extraction_rejects_encoded_nested_sensitive_query_keys(self) -> None:
        values = [
            "https://example.gov.it/redirect?return=https%3A%2F%2Fexample.gov.it%2Fview%3Fp_p_auth%3Dsynthetic",
            "https://example.gov.it/redirect?return=https%253A%252F%252Fexample.gov.it%252Fview%253Fsession_id%253Dsynthetic",
        ]

        self.assert_public_urls_rejected(values)

    def test_url_validator_rejects_deep_tokens_local_hosts_and_query_paths(self) -> None:
        nested = "token=synthetic"
        for _ in range(5):
            nested = quote(nested, safe="")
        unsafe = [
            f"https://example.gov.it/redirect?return={nested}",
            "http://localhost/source",
            "http://service.local/source",
            "http://intranet/source",
            "http://192.168.1.2/source",
            "http://127.1/source",
            "http://2130706433/source",
            "https://example.gov.it/view?file=%252FUsers%252Fname%252Fsource.tsv",
            "https://example.gov.it/view?next=%252Fworkspace%252Fprivate%252Fsource.tsv",
            "https://example.gov.it/view?file=file://localhost/Users/name/source.tsv",
            "https://example.gov.it/view?file=file%3A%2F%2Flocalhost%2FUsers%2Fname%2Fsource.tsv",
            "https://example.gov.it/view?file=%5C%5Cserver%5Cprivate%5Csource.tsv",
        ]

        self.assertTrue(ETL.is_safe_public_url("https://example.gov.it/atti/1?year=2025#section"))
        self.assert_public_urls_rejected(unsafe)

    def test_url_validator_decodes_narrow_workstation_path_prefixes(self) -> None:
        unsafe = [
            "https://example.gov.it/Users/name/source.tsv",
            "https://example.gov.it/workspace/private/source.tsv",
            "https://example.gov.it/private/tmp/source.tsv",
            "https://example.gov.it/tmp/source.tsv",
            "https://example.gov.it/%68ome/name/source.tsv",
            "https://example.gov.it/%252FUsers/name/source.tsv",
            "https://example.gov.it/%5C%5Cserver%5Cprivate%5Csource.tsv",
            "https://example.gov.it/file%3A%2F%2Flocalhost%2FUsers%2Fname%2Fsource.tsv",
            "https://example.gov.it/C%3A%5CUsers%5Cname%5Csource.tsv",
        ]
        official = "https://example.gov.it/Home/AmministrazioneTrasparente"
        official_lowercase = "https://www.indire.it/home/amministrazione-trasparente/"

        self.assert_public_urls_rejected(unsafe)
        self.assertTrue(ETL.is_safe_public_url(official))
        self.assertEqual(ETL.extract_public_urls([official]), [official])
        self.assertTrue(ETL.is_safe_public_url(official_lowercase))
        self.assertEqual(
            ETL.extract_public_urls([official_lowercase]),
            [official_lowercase],
        )

    def test_url_validator_rejects_credential_like_path_values_conservatively(self) -> None:
        ipzs_document = (
            "https://www.trasparenza.ipzs.it/dettagli/attodigara/8765/"
            "fornitura-token-medaglia-as-roma.html"
        )
        sviluppo_lavoro_document = (
            "https://societatrasparente.sviluppolavoroitalia.it/page/10/details/"
            "45548/affidamento-diretto-ai-sensi-dellart-50-comma-1-lett-b-del-"
            "dlgs-362023-e-smi-tramite-piattaforma-mepa-numero-procedura-1205681-"
            "id-ordine-8660179-per-il-rinnovo-annuale-della-manutenzione-di-n-950-"
            "licenze-password-manager-per-managed-person-24x7.html"
        )
        synthetic_slack_token = (
            "xo" + "xb-" + "123456789012-123456789012-AbCdEfGhIjKlMnOp"
        )
        unsafe = [
            "https://example.gov.it/download/token/synthetic-secret-value-1234/file.csv",
            "https://example.gov.it/download/%74oken/synthetic-secret-value-1234/file.csv",
            "https://example.gov.it/redirect?next=%252Faccess-token%252F"
            "synthetic-secret-value-1234",
            "https://example.gov.it/download/refresh-token/SyntheticSecretValue1234",
            "https://example.gov.it/download/token/abcdefghijklmnopqrstuvwx",
            "https://example.gov.it/redirect?next=%252Frefresh-token%252F"
            "SyntheticSecretValue1234",
            "https://example.gov.it/download/token%255Cabcdefghijklmnopqrstuvwx",
            "https://example.gov.it/download/password/P%40ssw0rd%21LongValue",
            "https://example.gov.it/download/token/AbCdEfGh%2FIjKlMnOp",
            "https://example.gov.it/download/token/AbCdEf1234",
            "https://example.gov.it/download/token/1234512345123451",
            "https://example.gov.it/download/token-value/AbCdEfGhIjKlMnOp",
            "https://example.gov.it/download/tokenValue/AbCdEfGhIjKlMnOp",
            "https://example.gov.it/download/password=P%40ssw0rd%21LongValue",
            "https://example.gov.it/download/password/callback",
            "https://example.gov.it/source?token=refresh",
            "https://example.gov.it/download/"
            "github_pat_11ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789",
            "https://example.gov.it/download/glpat-AbCdEfGhIjKlMnOpQrSt",
            f"https://example.gov.it/download/{synthetic_slack_token}",
            "https://example.gov.it/?github_pat_11ABCDEFGHIJKLMNOPQRSTUVWXYZ"
            "abcdefghijklmnopqrstuvwxyz0123456789",
            "https://example.gov.it/#ghp_ABCDEFGHIJKLMNOPQRSTUVWXYZ1234567890",
            "https://example.gov.it/download/prefix-github_pat_11ABCDEFGHIJKLMNO"
            "PQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789",
            "https://example.gov.it/download/prefix_glpat-AbCdEfGhIjKlMnOpQrSt",
            f"https://example.gov.it/download/prefix-{synthetic_slack_token}",
            "https://example.gov.it/download/token-AbCdEf1234567890_XyZ",
            "https://example.gov.it/download/client-secret_AbCdEf1234567890_XyZ",
            "https://example.gov.it/download/password.12345678901234567890",
            "https://example.gov.it/download/token-x",
            "https://example.gov.it/download/password-short",
            "https://example.gov.it/download/client-secret-Ab9",
            "https://example.gov.it/download/token-!!!",
            "https://example.gov.it/download/token-1111111111111111",
            "https://example.gov.it/download/vendor-password-Ab9",
            "https://example.gov.it/download/admin-secret-short",
            "https://example.gov.it/download/foo-credential-x",
            "https://example.gov.it/download/token~Secret",
            "https://example.gov.it/download/api-key+Ab9",
            "https://example.gov.it/download/password@short",
            "https://example.gov.it/download/token-1234",
            "https://example.gov.it/oauth/token/callback/AbCdEf1234567890_XyZ",
            "https://example.gov.it/oauth/token/callback?state=AbCdEf1234567890_XyZ",
            "https://example.gov.it/oauth/token/callback#AbCdEf1234567890_XyZ",
            "https://AKIA1234567890ABCDEF.example.gov.it/documento",
            "https://token-AbCdEf1234567890XyZ.example.gov.it/documento",
            "https://example.gov.it/token-policy",
            "https://example.gov.it/password-documentation",
            "https://example.gov.it/docs-v2/token-policy",
            ipzs_document.replace("www.trasparenza.ipzs.it", "evil.example.org"),
            ipzs_document + "?state=AbCdEf1234567890XyZ",
            ipzs_document + "#state-AbCdEf1234567890XyZ",
            ipzs_document + "?",
            ipzs_document.replace("https://", "http://"),
            ipzs_document.replace(
                "www.trasparenza.ipzs.it",
                "www.trasparenza.ipzs.it:443",
            ),
            ipzs_document.replace(
                "www.trasparenza.ipzs.it",
                "www.trasparenza.ipzs.it:8443",
            ),
            ipzs_document.replace("token", "%74oken"),
            sviluppo_lavoro_document.replace(
                "societatrasparente.sviluppolavoroitalia.it",
                "evil.example.org",
            ),
            sviluppo_lavoro_document + "#",
        ]
        allowed = [
            "https://www.corteconti.it/Home/AmministrazioneTrasparente",
            "https://example.gov.it/atti/DECRETO-2025-12345678901234567890.pdf",
            "https://example.gov.it/atti/abcdefghijklmnopqrstuvwx",
            "https://example.gov.it/oauth/token/istruzioni",
            "https://example.gov.it/oauth/token/callback",
            "https://example.gov.it/oauth/token/status",
            "https://example.gov.it/servizi/tokenizzazione/abcdefghijklmnopqrstuvwx",
            "https://example.gov.it/atti/github_pat_documentation",
            "https://example.gov.it/docs/"
            "github_pat_documentation_for_administrators",
            "https://example.gov.it/guide/token-bucket-documentation-for-users-2026",
            "https://example.gov.it/docs/password-policy-documentation-for-users-2026",
            "https://example.gov.it/guide/not-a-token-documentation",
            "https://token.example.gov.it/documento-pubblico-2026",
            "https://example.gov.it/docs/token-policy",
            "https://example.gov.it/documentation/password-documentation",
            ipzs_document,
            sviluppo_lavoro_document,
        ]

        self.assert_public_urls_rejected(unsafe)
        for value in allowed:
            with self.subTest(value=value):
                self.assertTrue(ETL.is_safe_public_url(value))
                self.assertEqual(ETL.extract_public_urls([value]), [value])

    def test_url_validator_rejects_credential_like_hostname_spans(self) -> None:
        opaque = "AbCdEf1234567890XyZ"
        credential_spans = (
            "token", "password", "secret", "credential", "signature", "jwt",
            "sessionid", "api-key", "access-token", "client-secret",
            "refresh-token", "session-token", "auth-token", "id-token",
            "vendor-token", "admin-secret", "api-secret", "token-param",
            "client-secret-param", "custom-sessionid", "private.key",
            "access.key", "aws.access.key", "client.key", "session.key",
            "akia", "asia", "aiza", "sk",
            "ghp", "gho", "ghu", "ghs", "ghr", "glpat", "xoxb", "xoxa",
            "xoxp", "xoxr", "xoxs", "bearer", "basic", "api.key",
            "access.token", "client.secret", "refresh.token", "session.token",
            "github.pat", "x.amz.credential", "x.amz.signature",
            "x.goog.credential", "x.goog.signature",
        )
        unsafe = [
            url
            for span in credential_spans
            for url in (
                f"https://{span}.{opaque}.example.gov.it/documento",
                f"https://{opaque}.{span}.example.gov.it/documento",
            )
        ]
        compound_keys = (
            "token", "api-key", "access-token", "client-secret",
            "vendor-token", "admin-secret", "token-param", "private-key",
            "x-amz-signature", "x-goog-credential", "ghp", "glpat", "bearer",
            "akia", "asia", "aiza", "sk",
        )
        unsafe.extend(
            url
            for key in compound_keys
            for url in (
                f"https://{key}-{opaque}.example.gov.it/documento",
                f"https://{opaque}-{key}.example.gov.it/documento",
                f"https://prefix-{key}-{opaque}.example.gov.it/documento",
                f"https://{opaque}-{key}-suffix.example.gov.it/documento",
            )
        )
        unsafe.append(
            "https://eyJAbCdEfGhIjKlMnOp.QrStUvWxYz12."
            "AbCdEfGhIj34.example.gov.it/documento"
        )
        chunks = "AbCd12.EfGh34.IjKl56.MnOp78.QrSt90.UvWx12"
        unsafe.extend((
            f"https://token.{chunks}.example.gov.it/documento",
            f"https://{chunks}.token.example.gov.it/documento",
            f"https://ghp.{chunks}.example.gov.it/documento",
            f"https://{chunks}.ghp.example.gov.it/documento",
            f"https://api.key.{chunks}.example.gov.it/documento",
            f"https://{chunks}.api.key.example.gov.it/documento",
            "https://ghp.abcdefghijklmnopqrstuvwx.example.gov.it/documento",
            "https://abcdefghijklmnopqrstuvwx.client.secret.example.gov.it/documento",
            "https://ASIA1234567890ABCDEF.example.gov.it/documento",
            "https://sk-AbCdEf1234567890XyZ.example.gov.it/documento",
            "https://ghp.documentation.AbCdEf1234567890XyZ.example.gov.it/documento",
            "https://ghp.AbCd12.documentation.EfGh34.IjKl56.example.gov.it/documento",
            "https://AbCdEf12.ghp.GhIjKl9012.example.gov.it/documento",
            "https://AbCdEf12-ghp-GhIjKl9012.example.gov.it/documento",
            "https://AbCd12.api.key.EfGh345678.example.gov.it/documento",
            "https://AbCd12-api-key-EfGh345678.example.gov.it/documento",
            "https://a.i.z.a.AbCdEf1234567890XyZ.example.gov.it/documento",
            "https://a.k.i.a.AbCdEf1234567890XyZ.example.gov.it/documento",
            "https://x.o.x.b.AbCdEf1234567890XyZ.example.gov.it/documento",
            "https://g.l.p.a.t.AbCdEf1234567890XyZ.example.gov.it/documento",
            "https://t.o.k.e.n.AbCdEf1234567890XyZ.example.gov.it/documento",
            "https://t.o.docs.k.e.n.AbCdEf1234567890XyZ.example.gov.it/documento",
            "https://t-o-docs-k-e-n-AbCdEf1234567890XyZ.example.gov.it/documento",
            "https://a.i.documentation.z.a.AbCdEf1234567890XyZ.example.gov.it/documento",
            "https://a-i-documentation-z-a-AbCdEf1234567890XyZ.example.gov.it/documento",
            "https://x.o.guida.x.b.AbCdEf1234567890XyZ.example.gov.it/documento",
            "https://g-l-help-pat-AbCdEf1234567890XyZ.example.gov.it/documento",
            "https://api.docs.key.AbCdEf1234567890XyZ.example.gov.it/documento",
            "https://api.documentation.key.AbCdEf1234567890XyZ.example.gov.it/documento",
            "https://google.api.docs.key.AbCdEf1234567890XyZ.example.gov.it/documento",
            "https://api-docs-key-AbCdEf1234567890XyZ.example.gov.it/documento",
            "https://google-api-docs-key-AbCdEf1234567890XyZ.example.gov.it/documento",
            "https://api.public-information.key.AbCdEf1234567890XyZ.example.gov.it/documento",
            "https://api.management.key.AbCdEf1234567890XyZ.example.gov.it/documento",
            "https://api.oauth.key.AbCdEf1234567890XyZ.example.gov.it/documento",
            "https://api-public-key-AbCdEf1234567890XyZ.example.gov.it/documento",
            "https://google-api-service-key-AbCdEf1234567890XyZ.example.gov.it/documento",
        ))
        self.assert_public_urls_rejected(unsafe)

        allowed = (
            "https://token.example.gov.it/documento-pubblico-2026",
            "https://api.key.example.gov.it/documento-pubblico-2026",
            "https://access.token.example.gov.it/documento-pubblico-2026",
            "https://AbCdEf12.client.secret.example.gov.it/documento",
            "https://AbCdEf1234567890XyZ.example.gov.it/documento",
            "https://ghp.documentation.example.gov.it/documento",
            "https://token.docs.example.gov.it/documento",
            "https://token.documentazione.example.gov.it/documento",
            "https://token.guida.example.gov.it/documento",
            "https://oauth.token.endpoint.example.gov.it/documento",
            "https://oauth.token.callback.example.gov.it/documento",
            "https://oauth.token.status.example.gov.it/documento",
            "https://password.reset.example.gov.it/documento",
            "https://api.key.management.example.gov.it/documento",
            "https://token.guida-utente.example.gov.it/documento",
            "https://token.public-information.example.gov.it/documento",
            "https://token.docs.verylonginstitutionaldomain.gov.it/documento",
            "https://token.documentation.amministrazione-trasparente.gov.it/documento",
            "https://api.key.guida.servizi-digitali-nazionali.gov.it/documento",
            "https://password.help.password-reset-service.gov.it/documento",
            "https://oauth.token.callback.authentication-service.gov.it/documento",
            "https://sk-documentation-for-users.example.gov.it/documento",
            "https://docs.sk-documentation-for-users.example.gov.it/documento",
            "https://sk-verylonginstitutionaldomain.example.gov.it/documento",
            "https://asiainternationalservice.example.gov.it/documento",
            "https://asia.international-foundation.example.gov.it/documento",
        )
        for value in allowed:
            with self.subTest(value=value):
                self.assertTrue(ETL.is_safe_public_url(value))
                self.assertEqual(ETL.extract_public_urls([value]), [value])

    def test_url_validator_rejects_case_sensitive_provider_tokens_in_components(
        self,
    ) -> None:
        tokens = (
            "AKIA1234567890ABCDEF",
            "ASIA1234567890ABCDEF",
            "AIzaAbCdEfGhIjKlMnOpQrStUvWxYz123456",
            "sk-AbCdEf1234567890XyZ",
            "sk-proj-AbCdEf1234567890XyZ",
            "sk-live-AbCdEf1234567890XyZ",
        )
        unsafe = (
            value
            for token in tokens
            for value in (
                f"https://example.gov.it/download/{token}",
                f"https://example.gov.it/source?value={token}",
                f"https://example.gov.it/source#{token}",
                f"https://example.gov.it/redirect?return=%252Fdownload%252F{token}",
            )
        )
        self.assert_public_urls_rejected(unsafe)

        for value in (
            "https://example.gov.it/download/asiainternationalservice",
            "https://example.gov.it/download/aizainternationalservice",
            "https://example.gov.it/sk-documentation-for-users",
            "https://example.gov.it/docs/sk-documentation-for-users",
        ):
            with self.subTest(value=value):
                self.assertTrue(ETL.is_safe_public_url(value))
                self.assertEqual(ETL.extract_public_urls([value]), [value])

    def test_url_validator_rejects_credentials_in_nested_url_authorities(
        self,
    ) -> None:
        inner_urls = (
            "https://token.AbCdEf1234567890XyZ.example.org/public",
            "https://a.i.z.a.AbCdEf1234567890XyZ.example.org/public",
            "https://reader:SuperSecret123@example.org/public",
            "https://127.0.0.1/private",
            "//a.i.z.a.AbCdEf1234567890XyZ.example.org/public",
            "//reader:SuperSecret123@example.org/public",
            "//127.0.0.1/private",
            "//[::1]/private",
            r"https:\\a.i.z.a.AbCdEf1234567890XyZ.example.org\public",
            r"https:/\reader:SuperSecret123@example.org\public",
            "https:\t//reader:SuperSecret123@example.org/public",
            "ftp://reader:SuperSecret123@example.org/file",
            "ssh://reader:SuperSecret123@example.org/file",
            "ws://reader:SuperSecret123@example.org/socket",
            "https://0177.0.0.1/private",
            "https://127.1/private",
            "https://0x7f.0x0.0x0.0x1/private",
            "https://224.0.0.251/private",
            "https://[ff02::1]/private",
            "https://service.local/private",
            "https://service.home.arpa/private",
            "https://safe.example.org/x,https://a.i.z.a."
            "AbCdEf1234567890XyZ.example.org/x",
        )
        unsafe = []
        for inner_url in inner_urls:
            nested = inner_url
            for _ in range(8):
                nested = quote(nested, safe="")
                unsafe.extend((
                    f"https://example.gov.it/redirect?return={nested}",
                    f"https://example.gov.it/redirect#return={nested}",
                ))
        self.assert_public_urls_rejected(unsafe)

        encoded_path_authorities = (
            "/redirect/%2F%2Freader%3ASuperSecret123%40example.org%2Fx",
            "/%2F%2Fa.i.z.a.AbCdEf1234567890XyZ.example.org%2Fx",
            "/%2F%2F127.0.0.1%2Fx",
            "/redirect/https%3A%5C%5Creader%3ASuperSecret123%40example.org%5Cx",
            "/redirect/https%3A%5C%5Ca.i.z.a."
            "AbCdEf1234567890XyZ.example.org%5Cx",
            "/redirect/https%3A%09%2F%2Freader%3ASuperSecret123%40example.org%2Fx",
        )
        self.assert_public_urls_rejected(
            f"https://example.gov.it{path}" for path in encoded_path_authorities
        )

        for inner_url in (
            "https://public.example.org/public",
            "https://[2606:4700:4700::1111]/public",
            "https://token.docs.example.gov.it/public",
            "https://api.key.management.example.gov.it/public",
        ):
            safe_inner = quote(inner_url, safe="")
            safe_value = f"https://example.gov.it/redirect?return={safe_inner}"
            self.assertTrue(ETL.is_safe_public_url(safe_value))
            self.assertEqual(ETL.extract_public_urls([safe_value]), [safe_value])
            safe_fragment = f"https://example.gov.it/redirect#return={safe_inner}"
            self.assertTrue(ETL.is_safe_public_url(safe_fragment))
            self.assertEqual(ETL.extract_public_urls([safe_fragment]), [safe_fragment])

    def test_url_validator_rejects_compact_strong_credential_keys(self) -> None:
        opaque = "AbCdEf1234567890XyZ"
        keys = (
            "privateKey", "accessKey", "secretKey", "signingKey",
            "clientKey", "sessionKey", "awsAccessKeyId",
            "awsSecretAccessKey", "googleApiKey",
            "sshPrivateKey", "tlsPrivateKey", "pgpPrivateKey", "s3AccessKey",
            "stripeSecretKey", "awsSecretKey", "jwtSigningKey",
            "databaseEncryptionKey",
        )
        unsafe = (
            value
            for key in keys
            for value in (
                f"https://example.gov.it/source?{key}={opaque}",
                f"https://example.gov.it/download/{key}/{opaque}",
                f"https://{key}.{opaque}.example.gov.it/public",
            )
        )
        self.assert_public_urls_rejected(unsafe)

        for key in ("publicKey", "primaryKey", "foreignKey"):
            allowed = f"https://example.gov.it/source?{key}={opaque}"
            self.assertTrue(ETL.is_safe_public_url(allowed))
            self.assertEqual(ETL.extract_public_urls([allowed]), [allowed])

        double_slash_path = (
            "https://example.gov.it//wp-content/public-document.pdf"
        )
        self.assertTrue(ETL.is_safe_public_url(double_slash_path))
        self.assertEqual(
            ETL.extract_public_urls([double_slash_path]),
            [double_slash_path],
        )
        encoded_tab_path = "https://example.gov.it/public/item-%09title"
        self.assertTrue(ETL.is_safe_public_url(encoded_tab_path))
        self.assertEqual(
            ETL.extract_public_urls([encoded_tab_path]),
            [encoded_tab_path],
        )

        reviewed_public_paths = (
            "https://web.archive.org/web/20260127005333/"
            "https://appalti.gse.it/PortaleAppalti/it/homepage.wp",
            "https://web.archive.org/web/20260512063047/"
            "https://www.invimit.it/societa-trasparente/",
            "https://www.mase.gov.it/portale/b56411544b-%09fornitura-di-un-"
            "ingranditore-visivo",
            "https://www.mase.gov.it/portale/b56450c9e4-%09servizio-di-"
            "interpretariato-l.i.s",
            "https://www.mase.gov.it/portale/b5745066f6-%09n.-4-abbonamenti-"
            "digitali-alla-rivista-staffetta-quotidiana",
            "https://www.mase.gov.it/portale/web/guest/b7de39d302%09servizi-di-"
            "progettazione-grafica-e-comunicazione",
            "https://www.ministeroturismo.gov.it//wp-content/uploads/2026/01/"
            "Decreto_Approvazione-e-Impegno_Evento-18-dicembre_DG_signed_"
            "Marcato.pdf",
        )
        for value in reviewed_public_paths:
            with self.subTest(reviewed_public_path=value):
                self.assertTrue(ETL.is_safe_public_url(value))
                self.assertEqual(ETL.extract_public_urls([value]), [value])

    def test_exact_documentation_urls_require_the_raw_official_authority(self) -> None:
        host = "www.trasparenza.ipzs.it"
        document = (
            f"https://{host}/dettagli/attodigara/8765/"
            "fornitura-token-medaglia-as-roma.html"
        )
        unsafe = (
            document.replace(host, host + ":"),
            document.replace(host, host + ":443"),
            document.replace(host, host + ":8443"),
            document.replace(host, host + "."),
            document.replace(host, "www．trasparenza.ipzs.it"),
            document.replace(host, "ｗｗｗ.trasparenza.ipzs.it"),
            document.replace(host, "www.trasparenzà.ipzs.it"),
            document.replace(host, "reader@" + host),
            document.replace("https://", "http://"),
        )
        self.assert_public_urls_rejected(unsafe)

        uppercase_authority = document.replace(host, host.upper())
        for value in (document, uppercase_authority):
            with self.subTest(value=value):
                self.assertTrue(ETL.is_safe_public_url(value))
                self.assertEqual(ETL.extract_public_urls([value]), [value])

    def test_url_validator_rejects_non_unicast_and_special_use_ip_literals(self) -> None:
        unsafe = [
            "http://224.0.0.1/source",
            "http://239.255.255.250/source",
            "http://255.255.255.255/source",
            "http://0.0.0.0/source",
            "http://[ff02::1]/source",
            "http://[fec0::1]/source",
            "http://[::]/source",
        ]

        self.assert_public_urls_rejected(unsafe)
        self.assertTrue(ETL.is_safe_public_url("https://8.8.8.8/source"))

    def test_encoded_nested_sensitive_url_is_redacted_from_the_public_cell(self) -> None:
        payload = (
            "name|private_id|amount|source|note\n"
            "Alpha||1|"
            "https://example.gov.it/redirect?return="
            "https%3A%2F%2Fexample.gov.it%2Fview%3Fp_p_auth%3Dsynthetic|note\n"
        ).encode("utf-8")
        self.write_fixture(payload, rows=1)
        self.build()
        row = json.loads(self.read_rows_payload())

        self.assertNotIn("p_p_auth", row["cells"]["source"])
        self.assertNotIn("synthetic", row["cells"]["source"])
        self.assertEqual(row["sourceUrls"], [])
        self.assertIn(
            {"field": "source", "reason": "unsafe-url"},
            row["redactions"],
        )

    def test_internal_path_scrubbing_handles_paths_inside_quoted_prose(self) -> None:
        sanitized, reasons = ETL.sanitize_public_cell(
            "note",
            'inspect "/workspace/private/source.tsv" before publication',
            set(),
        )
        self.assertNotIn("/workspace/", sanitized)
        self.assertIn("internal-path", reasons)

    def test_internal_path_scrubbing_handles_raw_and_recursively_encoded_tokens(self) -> None:
        cases = (
            r"apri C:\Users\alice\source.tsv prima della pubblicazione",
            r"apri \\server\private\source.tsv prima della pubblicazione",
            "apri file://localhost/Users/alice/source.tsv prima della pubblicazione",
            "apri /Users/alice/source.tsv prima della pubblicazione",
            "apri /workspace/private/source.tsv prima della pubblicazione",
            "apri /private/tmp/source.tsv prima della pubblicazione",
            "apri /tmp/source.tsv prima della pubblicazione",
            "apri %2FUsers%2Falice%2Fsource.tsv prima della pubblicazione",
            "apri %252Fworkspace%252Fprivate%252Fsource.tsv prima della pubblicazione",
            "apri file%253A%252F%252Flocalhost%252FUsers%252Falice%252Fsource.tsv",
            "apri %255C%255Cserver%255Cprivate%255Csource.tsv",
            "apri %252F%252Fserver%252Fprivate%252Fsource.tsv",
        )

        for value in cases:
            with self.subTest(value=value):
                sanitized, reasons = ETL.sanitize_public_cell("note", value, set())
                self.assertNotEqual(sanitized, value)
                self.assertIn("internal-path", reasons)
                self.assertIn("[riferimento interno rimosso]", sanitized)

    def test_internal_path_scrubbing_preserves_benign_prose_and_public_routes(self) -> None:
        cases = (
            "Il percorso amministrativo resta pubblico.",
            "/Home/AmministrazioneTrasparente",
            "/home/amministrazione-trasparente/",
            "https://www.corteconti.it/Home/AmministrazioneTrasparente",
            "https://www.indire.it/home/amministrazione-trasparente/",
            "https://example.gov.it/atti/report.csv?year=2025",
            "https://example.gov.it/atti/verbale%20firmato.pdf",
            "https%3A%2F%2Fexample.gov.it%2Fatti%2Fverbale%2520firmato.pdf",
        )

        for value in cases:
            with self.subTest(value=value):
                sanitized, reasons = ETL.sanitize_public_cell("note", value, set())
                self.assertEqual(sanitized, value)
                self.assertNotIn("internal-path", reasons)

    def test_internal_path_scrubbing_handles_relative_package_references(self) -> None:
        sanitized, reasons = ETL.sanitize_public_cell(
            "fonte",
            "vedi dashboard/casi/atto.tsv e quirinale-README.md",
            set(),
        )
        self.assertNotIn("dashboard/", sanitized)
        self.assertNotIn("README.md", sanitized)
        self.assertIn("internal-path", reasons)

    def test_internal_path_scrubbing_does_not_change_public_urls(self) -> None:
        value = "https://example.gov.it/dashboard/atto.csv"
        sanitized, reasons = ETL.sanitize_public_cell("fonte", value, set())
        self.assertEqual(sanitized, value)
        self.assertNotIn("internal-path", reasons)

    def test_public_row_does_not_expose_a_dictionary_checkable_private_digest(self) -> None:
        payload = (
            "name|private_id|amount|source|note\n"
            "Alpha|ID-SECRET-001|1|https://example.gov.it/atto/1|note\n"
        ).encode("utf-8")
        self.write_fixture(payload, rows=1)
        self.build()
        row = json.loads(self.read_rows_payload())
        raw_cells = {
            "name": "Alpha",
            "private_id": "ID-SECRET-001",
            "amount": "1",
            "source": "https://example.gov.it/atto/1",
            "note": "note",
        }
        dictionary_checkable_digest = sha256(ETL.canonical_json(raw_cells))

        self.assertNotEqual(row["sourceRowSha256"], dictionary_checkable_digest)

    def test_private_values_are_scrubbed_when_repeated_in_other_public_cells(self) -> None:
        payload = (
            "name|private_id|amount|source|note\n"
            "Alpha|ID-SECRET-001|1|https://example.gov.it/atto/1|"
            "reference ID-SECRET-001 copied from the source\n"
            "Beta|ID-05|2|https://example.gov.it/atto/2|"
            "reference ID-05 copied from the source\n"
        ).encode("utf-8")
        self.write_fixture(payload, rows=2)
        self.build()
        row_payload = self.read_rows_payload().decode("utf-8")

        self.assertNotIn("ID-SECRET-001", row_payload)
        self.assertNotIn("ID-05", row_payload)

    def test_missing_markers_in_private_fields_do_not_redact_other_missing_values(self) -> None:
        payload = (
            "name|private_id|amount|source|note\n"
            "n.d.|n.d.|n.d.|https://example.gov.it/atto/1|n.d.\n"
        ).encode("utf-8")
        self.write_fixture(payload, rows=1)
        self.build()
        row = json.loads(self.read_rows_payload())

        self.assertEqual(row["cells"]["name"], "n.d.")
        self.assertEqual(row["cells"]["amount"], "n.d.")
        self.assertEqual(row["cells"]["note"], "n.d.")

    def test_credentials_in_free_text_are_blocked_or_scrubbed_before_publication(self) -> None:
        payload = (
            "name|private_id|amount|source|note\n"
            "Alpha||1|https://example.gov.it/atto/1|"
            "Authorization: Bearer SYNTHETIC-CREDENTIAL-123\n"
            "Beta||2|https://example.gov.it/atto/2|"
            "Cookie: session=SYNTHETIC-COOKIE-123; csrf=SYNTHETIC-CSRF-456\n"
            "Gamma||3|https://example.gov.it/atto/3|"
            "session_id=SYNTHETIC-SESSION-123\n"
        ).encode("utf-8")
        self.write_fixture(payload, rows=3)
        try:
            self.build()
        except ETL.DatasetBuildError:
            return

        row_payload = self.read_rows_payload().decode("utf-8")
        self.assertNotIn("SYNTHETIC-CREDENTIAL-123", row_payload)
        self.assertNotIn("SYNTHETIC-COOKIE-123", row_payload)
        self.assertNotIn("SYNTHETIC-CSRF-456", row_payload)
        self.assertNotIn("SYNTHETIC-SESSION-123", row_payload)

    def test_compact_and_camel_case_credentials_are_scrubbed_from_free_text(self) -> None:
        cases = (
            "clientSecret=SYNTHETIC-CLIENT-SECRET",
            "refreshToken: SYNTHETIC-REFRESH-TOKEN",
            "accessToken=SYNTHETIC-ACCESS-TOKEN",
            "xAmzCredential=SYNTHETIC-AMZ-CREDENTIAL",
            "xGoogSignature=SYNTHETIC-GOOG-SIGNATURE",
            'clientSecret="SYNTHETIC QUOTED SECRET"',
            "clientSecret%3DSYNTHETIC-ENCODED-SECRET",
        )

        for value in cases:
            with self.subTest(value=value):
                sanitized, reasons = ETL.sanitize_public_cell("note", value, set())
                self.assertNotIn("SYNTHETIC", sanitized)
                self.assertIn("credential", reasons)

        benign = (
            "Il segreto istruttorio non e una credenziale.",
            "Il refresh tokenizzato descrive una procedura.",
            "clientSecret senza assegnazione",
            "accessTokenCount=3",
        )
        for value in benign:
            with self.subTest(value=value):
                sanitized, reasons = ETL.sanitize_public_cell("note", value, set())
                self.assertEqual(sanitized, value)
                self.assertNotIn("credential", reasons)

    def test_quoted_multiline_cell_preserves_the_source_newline(self) -> None:
        payload = (
            'name|private_id|amount|source|note\n'
            'Alpha||1|https://example.gov.it/atto/1|"line one\nline two"\n'
        ).encode("utf-8")
        spec = self.write_fixture(payload, rows=1)
        item = ETL.validate_spec(spec)[0]

        parsed = ETL.parse_dataset(self.source_root, item)

        self.assertEqual(parsed.rows[0][-1], "line one\nline two")

    def test_pinned_source_rejects_oversize_before_open(self) -> None:
        payload = (
            "name|private_id|amount|source|note\n"
            "Alpha||1|https://example.gov.it/atto/1|note\n"
        ).encode("utf-8")
        spec = self.write_fixture(payload, rows=1)
        item = ETL.validate_spec(spec)[0]
        (self.source_root / "dashboard/synthetic.psv").write_bytes(payload + b"x")

        with mock.patch.object(ETL.os, "open", side_effect=AssertionError("opened")):
            with self.assertRaisesRegex(ETL.DatasetBuildError, "dimensione"):
                ETL.parse_dataset(self.source_root, item)

    def test_offline_check_rejects_a_rows_payload_with_the_wrong_cardinality(self) -> None:
        payload = (
            "name|private_id|amount|source|note\n"
            "Alpha||1|https://example.gov.it/atto/1|note\n"
        ).encode("utf-8")
        self.write_fixture(payload, rows=1)
        self.build()

        rows_path = self.first_row_chunk_path()
        rows_path.write_bytes(gzip.compress(b"", compresslevel=9, mtime=0))
        receipt_path = self.receipts_dir / "synthetic-ledger.receipt.json"
        receipt = json.loads(receipt_path.read_text(encoding="utf-8"))
        receipt["rowsSha256"] = sha256(b"")
        receipt_path.write_bytes(ETL.canonical_json(receipt))

        catalog = json.loads(self.catalog_path.read_text(encoding="utf-8"))
        catalog["datasets"][0]["receiptSha256"] = sha256(receipt_path.read_bytes())
        self.catalog_path.write_bytes(ETL.canonical_json(catalog))

        proof = json.loads(self.proof_path.read_text(encoding="utf-8"))
        proof["catalogSha256"] = sha256(self.catalog_path.read_bytes())
        for path in (rows_path, receipt_path, self.catalog_path):
            relative = path.relative_to(self.repository).as_posix()
            proof["artifactSha256"][relative] = sha256(path.read_bytes())
        self.proof_path.write_bytes(ETL.canonical_json(proof))

        with self.assertRaisesRegex(ETL.DatasetBuildError, "righe|conteggio|cardinal"):
            self.check()

    def test_offline_check_rejects_semantically_tampered_catalog(self) -> None:
        payload = (
            "name|private_id|amount|source|note\n"
            "Alpha||1|https://example.gov.it/atto/1|note\n"
        ).encode("utf-8")
        self.write_fixture(payload, rows=1)
        self.build()

        catalog = json.loads(self.catalog_path.read_text(encoding="utf-8"))
        catalog["datasets"][0]["title"] = "Substituted title"
        self.catalog_path.write_bytes(ETL.canonical_json(catalog))
        proof = json.loads(self.proof_path.read_text(encoding="utf-8"))
        proof["catalogSha256"] = sha256(self.catalog_path.read_bytes())
        proof["artifactSha256"][self.catalog_path.relative_to(self.repository).as_posix()] = sha256(
            self.catalog_path.read_bytes()
        )
        self.proof_path.write_bytes(ETL.canonical_json(proof))

        with self.assertRaisesRegex(ETL.DatasetBuildError, "catalog|metadat|title|specifica"):
            self.check()

    def test_offline_check_rejects_unexpected_stale_artifacts(self) -> None:
        payload = (
            "name|private_id|amount|source|note\n"
            "Alpha||1|https://example.gov.it/atto/1|note\n"
        ).encode("utf-8")
        self.write_fixture(payload, rows=1)
        self.build()
        (self.rows_dir / "removed-dataset.jsonl.gz").write_bytes(
            gzip.compress(b"{}\n", compresslevel=9, mtime=0)
        )
        (self.receipts_dir / "removed-dataset.receipt.json").write_text(
            "{}\n",
            encoding="utf-8",
        )

        with self.assertRaisesRegex(ETL.DatasetBuildError, "extra|inatteso|stale"):
            self.check()

    def test_proof_keys_use_posix_separators_not_host_backslashes(self) -> None:
        from pathlib import PureWindowsPath

        windows_key = str(PureWindowsPath("src") / "data" / "generated" / "catalog.json")
        posix_key = (PureWindowsPath("src") / "data" / "generated" / "catalog.json").as_posix()
        self.assertEqual(windows_key, r"src\data\generated\catalog.json")
        self.assertEqual(posix_key, "src/data/generated/catalog.json")
        self.assertNotEqual(windows_key, posix_key)

        payload = (
            "name|private_id|amount|source|note\n"
            "Alpha||1|https://example.gov.it/atto/1|note\n"
        ).encode("utf-8")
        self.write_fixture(payload, rows=1)
        self.build()
        proof = json.loads(self.proof_path.read_text(encoding="utf-8"))
        self.assertGreater(len(proof["artifactSha256"]), 0)
        for key in proof["artifactSha256"]:
            self.assertNotIn("\\", key, f"chiave proof non canonica: {key!r}")
            self.assertEqual(key, key.replace("\\", "/"))
            self.assertEqual(key, Path(key).as_posix())


if __name__ == "__main__":
    unittest.main()
