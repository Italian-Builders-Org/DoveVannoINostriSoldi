from __future__ import annotations

import hashlib
import importlib.util
import json
import os
import subprocess
import sys
import tempfile
import unittest
from collections import Counter
from pathlib import Path


ROOT = Path(__file__).resolve().parents[2]
SCRIPT = ROOT / "scripts/etl/curated_source_identity_ledger.py"
ETL_DIR = SCRIPT.parent
if str(ETL_DIR) not in sys.path:
    sys.path.insert(0, str(ETL_DIR))
SPEC = importlib.util.spec_from_file_location("curated_source_identity_ledger", SCRIPT)
assert SPEC is not None and SPEC.loader is not None
MODULE = importlib.util.module_from_spec(SPEC)
sys.modules[SPEC.name] = MODULE
SPEC.loader.exec_module(MODULE)


def sha256(payload: bytes) -> str:
    return hashlib.sha256(payload).hexdigest()


def single_dataset(
    dataset_id: str,
    relative_path: str,
    payload: bytes,
    *,
    headers: list[str] | None = None,
    source_fields: list[str] | None = None,
) -> dict[str, object]:
    actual_headers = headers or ["source"]
    return {
        "id": dataset_id,
        "title": f"Dataset {dataset_id}",
        "domain": "tests",
        "relativePath": relative_path,
        "dataKind": "delimited",
        "delimiter": "pipe",
        "authority": "synthetic",
        "licenseStatus": "not-declared",
        "publication": "rows",
        "evidenceLabel": "documented-fact",
        "sourceFields": source_fields or ["source"],
        "privateFields": [],
        "caveats": ["Synthetic fixture only."],
        "expected": {
            "bytes": len(payload),
            "sha256": sha256(payload),
            "rows": len(payload.decode("utf-8").splitlines()) - 1,
            "columns": len(actual_headers),
            "headers": actual_headers,
        },
    }


def source_set_dataset(
    dataset_id: str,
    parts: list[tuple[str, bytes]],
) -> dict[str, object]:
    sources = [
        {
            "relativePath": relative_path,
            "expected": {
                "bytes": len(payload),
                "sha256": sha256(payload),
                "rows": len(payload.decode("utf-8").splitlines()) - 1,
            },
        }
        for relative_path, payload in parts
    ]
    item: dict[str, object] = {
        "id": dataset_id,
        "title": f"Dataset {dataset_id}",
        "domain": "tests",
        "sources": sources,
        "dataKind": "delimited",
        "delimiter": "pipe",
        "authority": "synthetic",
        "licenseStatus": "not-declared",
        "publication": "source-index",
        "evidenceLabel": "documented-fact",
        "sourceFields": ["citation"],
        "privateFields": [],
        "caveats": ["Synthetic fixture only."],
        "expected": {
            "bytes": sum(len(payload) for _, payload in parts),
            "sha256": "0" * 64,
            "rows": sum(len(payload.decode("utf-8").splitlines()) - 1 for _, payload in parts),
            "columns": 2,
            "headers": ["citation", "label"],
        },
    }
    item["expected"]["sha256"] = MODULE.dataset_etl.source_set_sha256(item)
    return item


def json_items_dataset(dataset_id: str, relative_path: str, payload: bytes) -> dict[str, object]:
    return {
        "id": dataset_id,
        "title": f"Dataset {dataset_id}",
        "domain": "tests",
        "relativePath": relative_path,
        "dataKind": "json-object-items",
        "itemsField": "items",
        "countField": "n",
        "authority": "synthetic",
        "licenseStatus": "not-declared",
        "publication": "rows",
        "evidenceLabel": "documented-fact",
        "sourceFields": ["source"],
        "privateFields": [],
        "caveats": ["Synthetic fixture only."],
        "expected": {
            "bytes": len(payload),
            "sha256": sha256(payload),
            "rows": 2,
            "columns": 2,
            "headers": ["source", "value"],
            "objectKeys": ["items", "n"],
        },
    }


def spec_payload(datasets: list[dict[str, object]]) -> bytes:
    return (
        json.dumps(
            {
                "schemaVersion": 1,
                "generatedAt": "2026-08-24T00:00:00Z",
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
                        "checkedAt": "2026-08-24",
                        "updateFrequency": None,
                        "canonicalUrls": [],
                    },
                    "overrides": {},
                },
                "datasets": datasets,
            },
            ensure_ascii=False,
            indent=2,
        )
        + "\n"
    ).encode("utf-8")


class CuratedSourceIdentityLedgerTests(unittest.TestCase):
    def setUp(self) -> None:
        self.temporary = tempfile.TemporaryDirectory()
        self.root = Path(self.temporary.name)
        self.source_root = self.root / "private-source"
        self.source_root.mkdir()

    def tearDown(self) -> None:
        self.temporary.cleanup()

    def write_source(self, relative_path: str, payload: bytes) -> None:
        path = self.source_root / relative_path
        path.parent.mkdir(parents=True, exist_ok=True)
        path.write_bytes(payload)

    def write_spec(self, name: str, datasets: list[dict[str, object]]) -> Path:
        path = self.root / name
        path.write_bytes(spec_payload(datasets))
        return path

    def test_single_source_set_and_json_items_use_pinned_live_schema(self) -> None:
        single_payload = (
            "source|label\n"
            "https://one.example/source; prose https://two.example/path)|first\n"
            "manual register|second\n"
        ).encode("utf-8")
        set_a = "citation|label\nhttps://set.example/a|A\n".encode("utf-8")
        set_b = "citation|label\nset register|B\n".encode("utf-8")
        json_payload = json.dumps(
            {
                "n": 2,
                "items": [
                    {"source": "https://json.example/item", "value": "one"},
                    {"source": 42, "value": "two"},
                ],
            },
            ensure_ascii=False,
            separators=(",", ":"),
        ).encode("utf-8")
        self.write_source("fixtures/single.psv", single_payload)
        self.write_source("fixtures/set-a.psv", set_a)
        self.write_source("fixtures/set-b.psv", set_b)
        self.write_source("fixtures/items.json", json_payload)
        datasets = [
            single_dataset(
                "single",
                "fixtures/single.psv",
                single_payload,
                headers=["source", "label"],
            ),
            source_set_dataset(
                "source-set",
                [("fixtures/set-a.psv", set_a), ("fixtures/set-b.psv", set_b)],
            ),
            json_items_dataset("json-items", "fixtures/items.json", json_payload),
        ]
        spec = self.write_spec("expanded.json", datasets)

        built = MODULE.build_ledger(source_root=self.source_root, spec_path=spec)
        parsed = MODULE.parse_private_ledger(built.payload)
        self.assertEqual(
            parsed,
            Counter(
                {
                    ("single.psv", "source", "url", "https://one.example/source"): 1,
                    ("single.psv", "source", "url", "https://two.example/path"): 1,
                    ("single.psv", "source", "identity", "manual register"): 1,
                    ("set-a.psv", "citation", "url", "https://set.example/a"): 1,
                    ("set-b.psv", "citation", "identity", "set register"): 1,
                    ("items.json", "source", "url", "https://json.example/item"): 1,
                    ("items.json", "source", "identity", "42"): 1,
                }
            ),
        )
        self.assertEqual(built.datasets, 3)
        self.assertEqual(built.delta_datasets, 3)

    def test_every_url_occurrence_is_counted_and_non_url_is_one_identity(self) -> None:
        value = "https://example.gov.it/a https://example.gov.it/a"
        self.assertEqual(
            MODULE.extract_cell_identities(value),
            [("url", "https://example.gov.it/a"), ("url", "https://example.gov.it/a")],
        )
        self.assertEqual(
            MODULE.extract_cell_identities("  source registry  "),
            [("identity", "source registry")],
        )
        self.assertEqual(MODULE.extract_cell_identities("  "), [])

    def test_pinned_source_drift_fails_closed_without_exposing_the_private_root(self) -> None:
        payload = b"source\nhttps://example.gov.it/a\n"
        relative_path = "fixtures/source.psv"
        self.write_source(relative_path, payload)
        spec = self.write_spec(
            "spec.json",
            [single_dataset("source", relative_path, payload)],
        )
        self.write_source(relative_path, payload.replace(b"/a", b"/b"))
        with self.assertRaises(MODULE.IdentityLedgerError) as raised:
            MODULE.build_ledger(source_root=self.source_root, spec_path=spec)
        self.assertNotIn(str(self.source_root), str(raised.exception))

    def test_frozen_43_dataset_fixture_rebuilds_12702_identities_exactly(self) -> None:
        datasets: list[dict[str, object]] = []
        for index in range(43):
            payload = f"source\nidentity-{index:02d}\n".encode("utf-8")
            relative_path = f"fixtures/dataset-{index:02d}.psv"
            self.write_source(relative_path, payload)
            datasets.append(
                single_dataset(f"dataset-{index:02d}", relative_path, payload)
            )
        base_spec = self.write_spec("base-43.json", datasets)
        base_identities: Counter[tuple[str, str, str, str]] = Counter(
            {
                (
                    f"legacy-{index:05d}",
                    "document",
                    "url",
                    f"https://example.gov.it/source/{index:05d}",
                ): 1
                for index in range(12_702)
            }
        )
        first = min(base_identities)
        base_identities[first] += 16_307
        base_payload = MODULE.render_ledger(base_identities)
        base_ledger = self.root / "base-ledger.tsv"
        base_ledger.write_bytes(base_payload)

        built = MODULE.build_ledger(
            source_root=self.source_root,
            spec_path=base_spec,
            base_ledger_path=base_ledger,
            base_spec_path=base_spec,
            expected_base_spec_sha256=sha256(base_spec.read_bytes()),
            expected_base_sha256=sha256(base_payload),
            expected_base_identities=12_702,
            expected_base_occurrences=29_009,
        )
        self.assertEqual(built.payload, base_payload)
        self.assertEqual(built.identities, 12_702)
        self.assertEqual(built.occurrences, 29_009)
        self.assertEqual(built.delta_datasets, 0)
        self.assertEqual(built.delta_identities, 0)

    def test_base_spec_source_contract_drift_is_rejected(self) -> None:
        payload = b"source\nregister\n"
        relative_path = "fixtures/base.psv"
        self.write_source(relative_path, payload)
        base_item = single_dataset("base", relative_path, payload)
        base_spec = self.write_spec("base.json", [base_item])
        changed = json.loads(json.dumps(base_item))
        changed["sourceFields"] = []
        expanded_spec = self.write_spec("expanded.json", [changed])
        base_payload = MODULE.render_ledger(
            Counter({("legacy", "document", "identity", "base"): 1})
        )
        base_ledger = self.root / "base.tsv"
        base_ledger.write_bytes(base_payload)
        with self.assertRaisesRegex(MODULE.IdentityLedgerError, "contratto sorgente base"):
            MODULE.build_ledger(
                source_root=self.source_root,
                spec_path=expanded_spec,
                base_ledger_path=base_ledger,
                base_spec_path=base_spec,
                expected_base_spec_sha256=sha256(base_spec.read_bytes()),
                expected_base_sha256=sha256(base_payload),
                expected_base_identities=1,
                expected_base_occurrences=1,
            )

    def test_cli_build_check_and_private_output_boundary(self) -> None:
        payload = b"source\nhttps://example.gov.it/data\n"
        relative_path = "fixtures/source.psv"
        self.write_source(relative_path, payload)
        spec = self.write_spec(
            "spec.json",
            [single_dataset("source", relative_path, payload)],
        )
        output = self.root / "private-ledger.tsv"
        command = [
            sys.executable,
            str(SCRIPT),
            "--source-root",
            str(self.source_root),
            "--spec",
            str(spec),
            "--output",
            str(output),
        ]
        built = subprocess.run(
            [*command, "--build"],
            cwd=ROOT,
            capture_output=True,
            text=True,
            check=False,
        )
        self.assertEqual(built.returncode, 0, built.stderr)
        summary = json.loads(built.stdout)
        self.assertEqual(summary["identities"], 1)
        self.assertNotIn(str(self.source_root), built.stdout + built.stderr)
        self.assertEqual(os.stat(output).st_mode & 0o777, 0o600)
        checked = subprocess.run(
            [
                *command,
                "--expect-sha256",
                summary["sha256"],
                "--expect-identities",
                "1",
                "--expect-occurrences",
                "1",
                "--check",
            ],
            cwd=ROOT,
            capture_output=True,
            text=True,
            check=False,
        )
        self.assertEqual(checked.returncode, 0, checked.stderr)
        self.assertEqual(json.loads(checked.stdout), summary)
        with self.assertRaisesRegex(MODULE.IdentityLedgerError, "fuori dal repository"):
            MODULE.require_private_output(ROOT / "private-ledger.tsv")


if __name__ == "__main__":
    unittest.main()
