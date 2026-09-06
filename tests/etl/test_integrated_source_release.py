from __future__ import annotations

import copy
import hashlib
import json
import sys
import tempfile
import unittest
from dataclasses import replace
from pathlib import Path
from unittest.mock import patch


ROOT = Path(__file__).resolve().parents[2]
ETL_DIR = ROOT / "scripts/etl"
if str(ETL_DIR) not in sys.path:
    sys.path.insert(0, str(ETL_DIR))

import curated_source_catalog as source_builder
import integrated_curated_datasets as dataset_builder
import integrated_source_release as release
from source_catalog import load_policy


def sha256(payload: bytes) -> str:
    return hashlib.sha256(payload).hexdigest()


def canonical(value: object) -> bytes:
    return json.dumps(
        value,
        ensure_ascii=False,
        sort_keys=True,
        separators=(",", ":"),
        allow_nan=False,
    ).encode("utf-8") + b"\n"


class AggregateReleaseProofTests(unittest.TestCase):
    def setUp(self) -> None:
        self.temporary = tempfile.TemporaryDirectory()
        self.root = Path(self.temporary.name)
        self.ledger = self.root / "data/source-ledger"
        self.ledger.mkdir(parents=True)
        (self.ledger / "elements").mkdir()
        (self.ledger / "datasets").mkdir()
        for name in (
            "receipt.json",
            "sources.jsonl",
            "source-catalog-proof.json",
            "dataset-proof.json",
        ):
            (self.ledger / name).write_bytes(b"{}\n")
        self.dataset_rows = self.root / "generated/rows"
        self.dataset_rows.mkdir(parents=True)
        self.dataset_catalog = self.root / "generated/catalog.json"
        self.dataset_catalog.write_bytes(b"{}\n")
        self.archive_policy = self.root / "archive-policy.json"
        self.source_policy = self.root / "source-policy.json"
        self.dataset_spec = self.root / "dataset-spec.json"
        for path in (self.archive_policy, self.source_policy, self.dataset_spec):
            path.write_bytes(b"{}\n")
        self.paths = release.ReleasePaths(
            ledger_dir=self.ledger,
            archive_policy=self.archive_policy,
            source_policy=self.source_policy,
            dataset_spec=self.dataset_spec,
            dataset_catalog=self.dataset_catalog,
            dataset_rows_dir=self.dataset_rows,
            output=self.ledger / "release-proof.json",
        )
        self.archive_summary = {
            "receiptBytes": 10,
            "receiptSha256": "1" * 64,
            "archiveBytes": 100,
            "archiveSha256": "2" * 64,
            "elementSetSha256": "3" * 64,
            "shards": 6,
            "shardBytes": 80,
            "entries": 51_303,
            "regular": 46_438,
            "hardlink": 4_860,
            "symlink": 5,
            "storedBytes": 90,
            "logicalBytes": 110,
        }
        self.source_summary = {
            "proofBytes": 20,
            "proofSha256": "4" * 64,
            "catalogBytes": 30,
            "catalogSha256": "5" * 64,
            "identities": 34_071,
            "published": 32_578,
            "quarantined": 1_493,
            "totalOccurrences": 262_618,
        }
        self.dataset_summary = {
            "proofBytes": 40,
            "proofSha256": "6" * 64,
            "catalogBytes": 50,
            "catalogSha256": "7" * 64,
            "receipts": 83,
            "rowArtifacts": 379,
            "artifactCount": 459,
            "receiptSetSha256": "8" * 64,
            "artifactSetSha256": "9" * 64,
            "sourceRows": 13_797_799,
            "publicRows": 815_453,
            "catalogOnlyRows": 12_979_505,
            "derivedOnlyRows": 2_841,
            "sourceBytes": 2_537_014_778,
        }

    def tearDown(self) -> None:
        self.temporary.cleanup()

    def validators(self):
        return (
            patch.object(release, "_validate_archive_receipt", return_value=self.archive_summary),
            patch.object(release, "_validate_source_catalog", return_value=self.source_summary),
            patch.object(release, "_validate_datasets", return_value=self.dataset_summary),
        )

    def test_build_is_atomic_canonical_deterministic_and_checkable(self) -> None:
        archive_gate, source_gate, dataset_gate = self.validators()
        with archive_gate, source_gate, dataset_gate:
            first = release.build_release(self.paths)
            first_payload = self.paths.output.read_bytes()
            second = release.build_release(self.paths)
            release.check_release(self.paths)

        self.assertEqual(first, second)
        self.assertEqual(first_payload, self.paths.output.read_bytes())
        self.assertEqual(first_payload, canonical(first))
        self.assertTrue(first["complete"])
        self.assertEqual(first["contract"]["archiveEntries"], 51_303)
        self.assertEqual(
            first["releaseSetSha256"],
            sha256(
                release.canonical_json(
                    {
                        "contract": first["contract"],
                        "archiveReceipt": first["archiveReceipt"],
                        "sourceCatalog": first["sourceCatalog"],
                        "datasets": first["datasets"],
                    }
                )
            ),
        )

    def test_check_rejects_stale_incomplete_extra_and_missing_state(self) -> None:
        archive_gate, source_gate, dataset_gate = self.validators()
        with archive_gate, source_gate, dataset_gate:
            release.build_release(self.paths)

        changed_source = {**self.source_summary, "totalOccurrences": 29_010}
        with (
            patch.object(release, "_validate_archive_receipt", return_value=self.archive_summary),
            patch.object(release, "_validate_source_catalog", return_value=changed_source),
            patch.object(release, "_validate_datasets", return_value=self.dataset_summary),
            self.assertRaisesRegex(release.ReleaseError, "stale|divergent"),
        ):
            release.check_release(self.paths)

        committed = json.loads(self.paths.output.read_text(encoding="utf-8"))
        committed["complete"] = False
        self.paths.output.write_bytes(canonical(committed))
        archive_gate, source_gate, dataset_gate = self.validators()
        with (
            archive_gate,
            source_gate,
            dataset_gate,
            self.assertRaisesRegex(release.ReleaseError, "not complete|stale|divergent"),
        ):
            release.check_release(self.paths)

        self.paths.output.unlink()
        (self.ledger / "unexpected.json").write_bytes(b"{}\n")
        archive_gate, source_gate, dataset_gate = self.validators()
        with (
            archive_gate,
            source_gate,
            dataset_gate,
            self.assertRaisesRegex(release.ReleaseError, "unaccounted"),
        ):
            release.build_release(self.paths)

        (self.ledger / "unexpected.json").unlink()
        archive_gate, source_gate, dataset_gate = self.validators()
        with (
            archive_gate,
            source_gate,
            dataset_gate,
            self.assertRaisesRegex(release.ReleaseError, "missing|unreadable"),
        ):
            release.check_release(self.paths)

    def test_failed_subgate_does_not_replace_an_existing_release(self) -> None:
        original = b'{"previous":"proof"}\n'
        self.paths.output.write_bytes(original)
        with (
            patch.object(release, "_validate_archive_receipt", return_value=self.archive_summary),
            patch.object(release, "_validate_source_catalog", return_value=self.source_summary),
            patch.object(
                release,
                "_validate_datasets",
                side_effect=release.ReleaseError("synthetic gate failure"),
            ),
            self.assertRaisesRegex(release.ReleaseError, "synthetic gate failure"),
        ):
            release.build_release(self.paths)
        self.assertEqual(self.paths.output.read_bytes(), original)

    def test_output_cannot_alias_an_input_or_enter_an_artifact_set(self) -> None:
        aliases = (
            self.paths.archive_receipt,
            self.paths.source_catalog,
            self.paths.source_proof,
            self.paths.dataset_proof,
            self.paths.dataset_catalog,
            self.ledger / "elements/proof.json",
            self.ledger / "datasets/proof.json",
            self.dataset_rows / "proof.json",
        )
        for output in aliases:
            with self.subTest(output=output):
                with self.assertRaisesRegex(release.ReleaseError, "cannot|artifact"):
                    release.build_expected_release(replace(self.paths, output=output))


class SourceCatalogGateTests(unittest.TestCase):
    def setUp(self) -> None:
        self.temporary = tempfile.TemporaryDirectory()
        self.root = Path(self.temporary.name)
        self.ledger = self.root / "ledger"
        self.ledger.mkdir()
        policy, policy_payload = load_policy(release.DEFAULT_SOURCE_POLICY)
        private_payload = (
            "dataset\tfield\tkind\tvalue\toccurrences\n"
            "fixture\tsource\turl\thttps://example.gov.it/data.csv\t3\n"
        ).encode("utf-8")
        parsed = source_builder.parse_ledger(private_payload, policy)
        built = source_builder.build_catalog(parsed, bytes(range(32)), policy, policy_payload)
        (self.ledger / "sources.jsonl").write_bytes(built.public_bytes)
        (self.ledger / "source-catalog-proof.json").write_bytes(built.proof_bytes)
        self.paths = release.ReleasePaths(
            ledger_dir=self.ledger,
            source_policy=release.DEFAULT_SOURCE_POLICY,
        )

    def tearDown(self) -> None:
        self.temporary.cleanup()

    def test_public_catalog_and_proof_are_recomputed(self) -> None:
        result = release._validate_source_catalog(self.paths)
        self.assertEqual(result["identities"], 1)
        self.assertEqual(result["published"], 1)
        self.assertEqual(result["quarantined"], 0)
        self.assertEqual(result["totalOccurrences"], 3)

    def test_catalog_or_proof_mutation_fails_closed(self) -> None:
        catalog_path = self.ledger / "sources.jsonl"
        entry = json.loads(catalog_path.read_text(encoding="utf-8"))
        entry["occurrences"] = 4
        catalog_path.write_bytes(canonical(entry))
        with self.assertRaisesRegex(release.ReleaseError, "coverage|bind"):
            release._validate_source_catalog(self.paths)

        self.setUp_proof_only_mutation()
        with self.assertRaisesRegex(release.ReleaseError, "closed schema"):
            release._validate_source_catalog(self.paths)

    def setUp_proof_only_mutation(self) -> None:
        # Restore a coherent catalog, then introduce a canonical unknown proof field.
        policy, policy_payload = load_policy(release.DEFAULT_SOURCE_POLICY)
        private_payload = (
            "dataset\tfield\tkind\tvalue\toccurrences\n"
            "fixture\tsource\turl\thttps://example.gov.it/data.csv\t3\n"
        ).encode("utf-8")
        parsed = source_builder.parse_ledger(private_payload, policy)
        built = source_builder.build_catalog(parsed, bytes(range(32)), policy, policy_payload)
        (self.ledger / "sources.jsonl").write_bytes(built.public_bytes)
        proof = copy.deepcopy(built.proof)
        proof["unexpected"] = True
        (self.ledger / "source-catalog-proof.json").write_bytes(canonical(proof))


class DatasetGateTests(unittest.TestCase):
    def setUp(self) -> None:
        self.temporary = tempfile.TemporaryDirectory()
        self.root = Path(self.temporary.name)
        self.repository = self.root / "repository"
        self.source_root = self.root / "private-source"
        self.repository.mkdir()
        self.source_root.mkdir()
        self.ledger = self.repository / "data/source-ledger"
        self.receipts = self.ledger / "datasets"
        self.proof = self.ledger / "dataset-proof.json"
        self.spec = self.repository / "spec.json"
        self.catalog = self.repository / "src/data/generated/integrated/catalog.json"
        self.rows = self.repository / "src/data/generated/integrated/rows"
        datasets: list[dict[str, object]] = []
        for index in range(43):
            dataset_id = f"dataset-{index:02d}"
            publication = (
                "rows"
                if index == 0
                else "source-index"
                if index == 1
                else "derived-only"
                if index == 42
                else "catalog-only"
            )
            relative_path = f"fixtures/{dataset_id}.psv"
            payload = f"value|source\nvalue-{index}|https://example.gov.it/data/{index}\n".encode(
                "utf-8"
            )
            source_path = self.source_root / relative_path
            source_path.parent.mkdir(parents=True, exist_ok=True)
            source_path.write_bytes(payload)
            datasets.append(
                {
                    "id": dataset_id,
                    "title": f"Dataset {index}",
                    "domain": "tests",
                    "relativePath": relative_path,
                    "dataKind": "delimited",
                    "delimiter": "pipe",
                    "authority": "synthetic",
                    "licenseStatus": "not-declared",
                    "publication": publication,
                    "evidenceLabel": "documented-fact",
                    "sourceFields": ["source"] if publication in {"rows", "source-index"} else [],
                    "privateFields": [],
                    "caveats": ["Synthetic fixture only."],
                    "expected": {
                        "bytes": len(payload),
                        "sha256": sha256(payload),
                        "rows": 1,
                        "columns": 2,
                        "headers": ["value", "source"],
                    },
                }
            )
        spec = {
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
        }
        self.spec.write_text(json.dumps(spec, ensure_ascii=False, indent=2) + "\n", encoding="utf-8")
        self.original_dataset_root = dataset_builder.ROOT
        dataset_builder.ROOT = self.repository
        artifacts = dataset_builder.build_artifacts(
            spec_path=self.spec,
            source_root=self.source_root,
            catalog_path=self.catalog,
            rows_dir=self.rows,
            receipts_dir=self.receipts,
            proof_path=self.proof,
            private_map_out=None,
        )
        dataset_builder.commit_artifacts(artifacts)
        self.paths = release.ReleasePaths(
            ledger_dir=self.ledger,
            dataset_spec=self.spec,
            dataset_catalog=self.catalog,
            dataset_rows_dir=self.rows,
        )

    def tearDown(self) -> None:
        dataset_builder.ROOT = self.original_dataset_root
        self.temporary.cleanup()

    def test_exact_43_dataset_receipts_catalog_and_rows_are_recomputed(self) -> None:
        synthetic_contract = {
            "sourceRows": 43,
            "publicRows": 2,
            "catalogOnlyRows": 40,
            "derivedOnlyRows": 1,
        }
        with (
            patch.object(release, "EXPECTED_DATASETS", 43),
            patch.object(release, "EXPECTED_DATASET_ROWS", synthetic_contract),
        ):
            result = release._validate_datasets(self.paths)
        self.assertEqual(result["specBytes"], len(self.spec.read_bytes()))
        self.assertEqual(result["specSha256"], sha256(self.spec.read_bytes()))
        self.assertEqual(result["receipts"], 43)
        self.assertEqual(result["rowArtifacts"], 2)
        self.assertEqual(result["artifactCount"], 46)
        self.assertEqual(result["sourceRows"], 43)
        self.assertEqual(result["publicRows"], 2)
        self.assertEqual(result["catalogOnlyRows"], 40)
        self.assertEqual(result["derivedOnlyRows"], 1)

        with self.assertRaisesRegex(release.ReleaseError, "release contract"):
            release._validate_datasets(self.paths)

    def test_extra_or_missing_dataset_artifact_fails_closed(self) -> None:
        extra = self.receipts / "extra.receipt.json"
        extra.write_bytes(b"{}\n")
        with (
            patch.object(release, "EXPECTED_DATASETS", 43),
            self.assertRaisesRegex(release.ReleaseError, "missing or extra"),
        ):
            release._validate_datasets(self.paths)
        extra.unlink()

        row = self.rows / "dataset-00.part-00000.jsonl.gz"
        row.unlink()
        with (
            patch.object(release, "EXPECTED_DATASETS", 43),
            self.assertRaisesRegex(release.ReleaseError, "missing or extra"),
        ):
            release._validate_datasets(self.paths)


class CommittedReleaseProofTests(unittest.TestCase):
    def test_committed_release_proof_closes_all_three_real_gates(self) -> None:
        proof = release.check_release()
        self.assertTrue(proof["complete"])
        self.assertEqual(proof["contract"]["archiveEntries"], 51_303)
        self.assertEqual(proof["contract"]["datasets"], 83)


if __name__ == "__main__":
    unittest.main()
