from __future__ import annotations

import csv
import hashlib
import io
import json
import sys
import tempfile
from contextlib import ExitStack
from pathlib import Path
from unittest import TestCase, mock

ROOT = Path(__file__).resolve().parents[2]
sys.path.insert(0, str(ROOT / "scripts" / "etl"))

import integrated_curated_datasets as corpus
import siope_nonmunicipal_corpus as append_release


def digest(payload: bytes) -> str:
    return hashlib.sha256(payload).hexdigest()


def dataset(identifier: str, path: str, payload: bytes) -> dict:
    headers = payload.decode("utf-8").splitlines()[0].split("|")
    rows = len(payload.decode("utf-8").splitlines()) - 1
    return {
        "id": identifier,
        "title": identifier,
        "domain": "tests",
        "relativePath": path,
        "dataKind": "delimited",
        "delimiter": "pipe",
        "authority": "official-primary",
        "licenseStatus": "not-declared",
        "publication": "rows",
        "evidenceLabel": "documented-fact",
        "sourceFields": [],
        "privateFields": [],
        "caveats": ["Fixture sintetico."],
        "expected": {"bytes": len(payload), "sha256": digest(payload), "rows": rows, "columns": len(headers), "headers": headers},
    }


class SiopeNonMunicipalCorpusTests(TestCase):
    def setUp(self) -> None:
        self.temporary = tempfile.TemporaryDirectory()
        self.root = Path(self.temporary.name) / "repository"; self.root.mkdir(parents=True)
        self.source = self.root / "source"; self.source.mkdir()
        self.spec = self.root / "spec.json"
        self.catalog = self.root / "generated/catalog.json"
        self.rows = self.root / "generated/rows"
        self.receipts = self.root / "ledger/datasets"
        self.proof = self.root / "ledger/proof.json"
        self.original_corpus_root, self.original_append_root = corpus.ROOT, append_release.ROOT
        corpus.ROOT = self.root; append_release.ROOT = self.root
        self.old = b"entityCode|amountCents\nold|1\n"
        self.new = b"entityCode|amountCents\nnew|2\n"
        (self.source / "old.psv").write_bytes(self.old)
        (self.source / "new.psv").write_bytes(self.new)
        self.write_spec([dataset("old", "old.psv", self.old)])
        artifacts = corpus.build_artifacts(spec_path=self.spec, source_root=self.source, catalog_path=self.catalog, rows_dir=self.rows, receipts_dir=self.receipts, proof_path=self.proof, private_map_out=None)
        corpus.commit_artifacts(artifacts)
        self.write_spec([dataset("old", "old.psv", self.old), dataset("siope-projection", "new.psv", self.new)])

    def tearDown(self) -> None:
        corpus.ROOT = self.original_corpus_root; append_release.ROOT = self.original_append_root
        self.temporary.cleanup()

    def write_spec(self, datasets: list[dict]) -> None:
        self.spec.write_text(json.dumps({
            "schemaVersion": 1, "generatedAt": "2026-09-06T08:00:00Z",
            "corpusContract": {"elements": 51_303, "regularFiles": 46_438, "hardlinks": 4_860, "symlinks": 5},
            "sourceMetadata": {"default": {"holder": "Fixture", "referencePeriod": None, "publicationDate": None, "acquisitionDate": None, "checkedAt": "2026-09-06", "updateFrequency": None, "canonicalUrls": []}, "overrides": {}},
            "datasets": datasets,
        }, ensure_ascii=False), encoding="utf-8")

    def append(self) -> None:
        append_release.append(spec_path=self.spec, source_root=self.source, dataset_ids={"siope-projection"}, catalog_path=self.catalog, rows_dir=self.rows, receipts_dir=self.receipts, proof_path=self.proof)

    def test_append_preserves_old_release_and_checks_full_new_release(self) -> None:
        old_bytes = {path.relative_to(self.root): path.read_bytes() for path in self.root.rglob("*") if path.is_file() and "source" not in path.parts}
        self.append()
        corpus.check_committed(spec_path=self.spec, catalog_path=self.catalog, rows_dir=self.rows, receipts_dir=self.receipts, proof_path=self.proof)
        for relative, payload in old_bytes.items():
            if relative in {Path("generated/catalog.json"), Path("ledger/proof.json")}:
                continue
            self.assertEqual((self.root / relative).read_bytes(), payload)

    def test_second_promotion_accepts_unchanged_and_explicitly_updated_inputs(self) -> None:
        self.append()
        first = self.catalog.read_bytes()
        self.append()
        self.assertEqual(self.catalog.read_bytes(), first)

        changed = b"entityCode|amountCents\nnew|3\n"
        (self.source / "new.psv").write_bytes(changed)
        self.write_spec([dataset("old", "old.psv", self.old), dataset("siope-projection", "new.psv", changed)])
        self.append()
        catalog = json.loads(self.catalog.read_text())
        entry = next(item for item in catalog["datasets"] if item["id"] == "siope-projection")
        self.assertEqual(entry["rows"], 1)
        self.assertNotEqual(self.catalog.read_bytes(), first)

    def test_update_removes_obsolete_chunks_and_missing_candidate_preserves_release(self) -> None:
        large = b"entityCode|amountCents\n" + b"".join(f"row-{index}|{index}\n".encode() for index in range(corpus.PUBLIC_ROW_CHUNK_ROWS + 1))
        (self.source / "new.psv").write_bytes(large)
        self.write_spec([dataset("old", "old.psv", self.old), dataset("siope-projection", "new.psv", large)])
        self.append()
        stale = self.rows / corpus.row_chunk_name("siope-projection", 1)
        self.assertTrue(stale.is_file())

        (self.source / "new.psv").write_bytes(self.new)
        self.write_spec([dataset("old", "old.psv", self.old), dataset("siope-projection", "new.psv", self.new)])
        self.append()
        self.assertFalse(stale.exists())
        before = {path.relative_to(self.root): path.read_bytes() for path in self.root.rglob("*") if path.is_file() and "source" not in path.parts}
        (self.source / "new.psv").unlink()
        with self.assertRaises(corpus.DatasetBuildError):
            self.append()
        after = {path.relative_to(self.root): path.read_bytes() for path in self.root.rglob("*") if path.is_file() and "source" not in path.parts}
        self.assertEqual(after, before)

    def test_failed_write_restores_the_previous_release(self) -> None:
        self.append()
        before = {path.relative_to(self.root): path.read_bytes() for path in self.root.rglob("*") if path.is_file() and "source" not in path.parts}
        original = corpus.write_bytes; calls = 0
        def fail_once(path: Path, payload: bytes) -> None:
            nonlocal calls
            calls += 1
            if calls == 2:
                raise OSError("write failure injected")
            original(path, payload)
        with mock.patch.object(corpus, "write_bytes", side_effect=fail_once):
            with self.assertRaises(OSError):
                self.append()
        after = {path.relative_to(self.root): path.read_bytes() for path in self.root.rglob("*") if path.is_file() and "source" not in path.parts}
        self.assertEqual(after, before)

    def test_failed_correlated_view_seal_rolls_back_corpus_and_view(self) -> None:
        self.append()
        view = self.root / "generated/detail.json"
        view.write_bytes(b"old-view\n")
        catalog_payload = self.catalog.read_bytes()
        with self.assertRaisesRegex(RuntimeError, "seal failure"):
            append_release.commit_atomically(
                {self.catalog: catalog_payload}, removals=set(), protected_paths={view},
                after_write=lambda: (view.write_bytes(b"mixed-view\n"), (_ for _ in ()).throw(RuntimeError("seal failure")))[1],
                spec_path=self.spec, catalog_path=self.catalog, rows_dir=self.rows,
                receipts_dir=self.receipts, proof_path=self.proof,
            )
        self.assertEqual(view.read_bytes(), b"old-view\n")
        self.assertEqual(self.catalog.read_bytes(), catalog_payload)


class ClosedSiopePromotionBuilder:
    """Build a complete, small SIOPE promotion corpus without private fixtures."""

    DATASET_IDS = {
        "siope-inventario-enti",
        "siope-uscite-asl",
        "siope-uscite-province",
        "siope-uscite-regioni",
        "siope-uscite-citta-metropolitane",
    }
    ACQUIRED_AT = "2026-09-06T08:00:00+00:00"

    def __init__(self, root: Path) -> None:
        import siope_nonmunicipal as detail

        self.root = root
        self.source = root / "source"
        self.ledger = root / "data/source-ledger"
        self.generated = root / "src/data/generated"
        self.spec = root / "spec.json"
        self.catalog = self.generated / "integrated/catalog.json"
        self.rows = self.generated / "integrated/rows"
        self.receipts = self.ledger / "datasets"
        self.proof = self.ledger / "dataset-proof.json"
        self.release_proof = self.ledger / "release-proof.json"
        self.candidate_detail = self.source / "siope-nonmunicipal-detail.json"
        self.candidate_manifest = self.source / "siope-nonmunicipal-release.json"
        self.detail = self.generated / "siope-nonmunicipal-detail.json"
        self.view_proof = self.generated / "siope-nonmunicipal-view-proof.json"
        self.old = b"entityCode|amountCents\nold|1\n"
        self.source.mkdir(parents=True)
        self.ledger.mkdir(parents=True)
        (self.ledger / "elements").mkdir()
        self.receipts.mkdir()
        for name in ("receipt.json", "sources.jsonl", "source-catalog-proof.json"):
            (self.ledger / name).write_bytes(b"{}\n")
        (self.source / "old.psv").write_bytes(self.old)
        self.write_spec()

    @staticmethod
    def _write_tsv(path: Path, headers: tuple[str, ...], rows: list[dict[str, str]]) -> None:
        stream = io.StringIO(newline="")
        writer = csv.DictWriter(stream, fieldnames=headers, delimiter="|", lineterminator="\n")
        writer.writeheader()
        writer.writerows(rows)
        path.write_bytes(stream.getvalue().encode("utf-8"))

    def write_spec(self, *, include_candidate: bool = False) -> None:
        datasets = [dataset("old", "old.psv", self.old)]
        if include_candidate:
            for identifier in sorted(self.DATASET_IDS):
                payload = (self.source / f"{identifier}.psv").read_bytes()
                datasets.append(dataset(identifier, f"{identifier}.psv", payload))
        default = {
            "holder": "Fixture SIOPE chiuso",
            "referencePeriod": None,
            "publicationDate": None,
            "acquisitionDate": None,
            "checkedAt": "2026-09-06",
            "updateFrequency": None,
            "canonicalUrls": [],
        }
        overrides = {
            identifier: {**default, "acquisitionDate": "2026-09-06", "checkedAt": "2026-09-06"}
            for identifier in self.DATASET_IDS
        } if include_candidate else {}
        self.spec.write_text(json.dumps({
            "schemaVersion": 1,
            "generatedAt": "2026-09-06T08:00:00Z",
            "corpusContract": {"elements": 51_303, "regularFiles": 46_438, "hardlinks": 4_860, "symlinks": 5},
            "sourceMetadata": {"default": default, "overrides": overrides},
            "datasets": datasets,
        }), encoding="utf-8")

    def _payment_rows(self, version: int) -> dict[str, list[dict[str, str]]]:
        import siope_nonmunicipal as detail

        rows: dict[str, list[dict[str, str]]] = {policy.dataset_id: [] for policy in detail.POLICIES}
        for policy in detail.POLICIES:
            short = policy.key.replace("-", "_")
            count = 1001 if policy.key == "province" and version == 1 else 1
            for index in range(count):
                amount = "1" if policy.key == "province" and version == 1 else str(7 if policy.key == "province" else len(rows) + 1)
                management_code = "1103" if policy.compartment == "SAN" else "1.01"
                management_label = "Competenze personale SAN" if policy.compartment == "SAN" else "Personale territoriale"
                rows[policy.dataset_id].append({
                    "entityCode": f"{short}-001",
                    "taxCode": f"tax-{short}",
                    "codiceIpa": f"ipa-{short}",
                    "entityType": policy.entity_type,
                    "entityName": f"Ente {short}",
                    "validFrom": "2024-01-01",
                    "validTo": "9999-12-31",
                    "region": "Lazio",
                    "province": "Roma",
                    "ipaJoinStatus": "matched",
                    "regionJoinStatus": "matched",
                    "year": "2024",
                    "month": str((index % 3) + 1 if policy.key == "province" else len(rows)),
                    "managementCode": management_code,
                    "compartment": policy.compartment,
                    "managementLabel": management_label,
                    "titleCode": management_code if policy.compartment == "SAN" else "1",
                    "titleLabel": management_label if policy.compartment == "SAN" else detail.TITLE_LABELS["1"],
                    "amountCents": amount,
                })
        return rows

    def _detail(self, rows: dict[str, list[dict[str, str]]], sources: dict[str, dict], release_id: str) -> dict:
        import siope_nonmunicipal as detail

        entities = []
        for policy in detail.POLICIES:
            policy_rows = rows[policy.dataset_id]
            first = policy_rows[0]
            monthly: dict[int, int] = {}
            titles: dict[tuple[str, str], int] = {}
            for row in policy_rows:
                month = int(row["month"])
                monthly[month] = monthly.get(month, 0) + int(row["amountCents"])
                title = (row["titleCode"], row["titleLabel"])
                titles[title] = titles.get(title, 0) + int(row["amountCents"])
            years = []
            for year in sorted(detail.YEARS, reverse=True):
                if year == 2024:
                    years.append({
                        "year": year,
                        "status": "available",
                        "amountCents": sum(monthly.values()),
                        "monthsObserved": sorted(monthly),
                        "monthly": [{"month": month, "amountCents": monthly[month]} for month in sorted(monthly)],
                        "titles": [{"code": code, "label": label, "amountCents": amount} for (code, label), amount in sorted(titles.items())],
                        "provenance": sources[str(year)],
                        "caveats": ["Fixture sintetico.", "Solo per test di promozione."],
                    })
                else:
                    years.append({
                        "year": year,
                        "status": "no_movements",
                        "amountCents": None,
                        "monthsObserved": [],
                        "monthly": [],
                        "titles": [],
                        "provenance": sources[str(year)],
                        "caveats": ["Fixture sintetico.", "Solo per test di promozione."],
                    })
            entities.append({
                "codiceIpa": first["codiceIpa"],
                "taxCode": first["taxCode"],
                "entityType": first["entityType"],
                "entityName": first["entityName"],
                "includedCodes": sorted({row["entityCode"] for row in policy_rows}),
                "years": years,
            })
        return {
            "schemaVersion": 1,
            "scope": "non-municipal-payments",
            "flow": "uscite",
            "unit": "EUR-cent",
            "accountingBasis": "cash",
            "releaseId": release_id,
            "entities": sorted(entities, key=lambda item: item["codiceIpa"]),
        }

    def build_candidate(self, version: int) -> dict:
        import siope_nonmunicipal as detail

        for name in detail.CANONICAL_INPUT_URLS:
            payload = f"closed-siope-v{version}:{name}\n".encode("utf-8")
            (self.source / name).write_bytes(payload)
        files = {}
        for name, url in detail.CANONICAL_INPUT_URLS.items():
            payload = (self.source / name).read_bytes()
            files[name] = {
                "url": url,
                "bytes": len(payload),
                "sha256": digest(payload),
                "acquisitionDate": self.ACQUIRED_AT,
                "etag": None,
                "lastModified": None,
            }
        input_receipt = {"schemaVersion": 1, "scope": "non-municipal-payments-inputs", "files": files}
        input_receipt_sha = digest(detail.canonical_json(input_receipt) + b"\n")
        rows = self._payment_rows(version)
        inventory = [{header: "0" for header in detail.INVENTORY_HEADERS}]
        inventory[0].update({"entityType": "PROVINCIA", "year": "2024", "productStatus": "published-payments"})
        self._write_tsv(self.source / "siope-inventario-enti.psv", detail.INVENTORY_HEADERS, inventory)
        for policy in detail.POLICIES:
            self._write_tsv(self.source / f"{policy.dataset_id}.psv", detail.PAYMENT_HEADERS, rows[policy.dataset_id])
        projection_paths = {
            "siope-inventario-enti": self.source / "siope-inventario-enti.psv",
            **{policy.dataset_id: self.source / f"{policy.dataset_id}.psv" for policy in detail.POLICIES},
        }
        projections = {identifier: detail.projection_metadata(path) for identifier, path in sorted(projection_paths.items())}
        sources = {
            str(year): detail.source_metadata(input_receipt, year, self.ACQUIRED_AT)
            for year in detail.YEARS
        }
        release_id = digest(detail.canonical_json({
            "inputReceiptSha256": input_receipt_sha,
            "projections": projections,
            "sources": sources,
        }))
        native = {
            "schemaVersion": 2,
            "scope": "non-municipal-payments",
            "flow": "uscite",
            "unit": "EUR-cent",
            "accountingBasis": "cash",
            "releaseId": release_id,
            "acquiredAt": self.ACQUIRED_AT,
            "inputReceiptSha256": input_receipt_sha,
            "inputReceipt": input_receipt,
            "sources": sources,
            "projections": projections,
            "inventoryRows": 1,
            "paymentRows": {policy.key: len(rows[policy.dataset_id]) for policy in detail.POLICIES},
            "unresolvedMovements": {str(year): {"unknownCode": {"rows": 0, "amountCents": 0}, "outsideValidity": {"rows": 0, "amountCents": 0}} for year in detail.YEARS},
        }
        self.candidate_manifest.write_bytes(detail.canonical_json(native) + b"\n")
        self.candidate_detail.write_bytes(detail.canonical_json(self._detail(rows, sources, release_id)) + b"\n")
        self.write_spec(include_candidate=True)
        return native

    def release_hashes(self) -> dict[str, str]:
        return {
            path.relative_to(self.root).as_posix(): digest(path.read_bytes())
            for path in self.root.rglob("*")
            if path.is_file() and self.source not in path.parents
        }

    def expected_rows(self, manifest: dict) -> dict[str, int]:
        source_rows = 1 + sum(item["rows"] for item in manifest["projections"].values())
        return {"sourceRows": source_rows, "publicRows": source_rows, "catalogOnlyRows": 0, "derivedOnlyRows": 0}

    def dataset_gate_summary(self, _paths) -> dict[str, object]:
        proof_payload = self.proof.read_bytes()
        catalog_payload = self.catalog.read_bytes()
        proof = json.loads(proof_payload)
        artifact_hashes = proof["artifactSha256"]
        receipt_set = [
            {"id": entry["id"], "sha256": entry["receiptSha256"]}
            for entry in json.loads(catalog_payload)["datasets"]
        ]
        return {
            "proofBytes": len(proof_payload),
            "proofSha256": digest(proof_payload),
            "catalogBytes": len(catalog_payload),
            "catalogSha256": digest(catalog_payload),
            "receipts": len(list(self.receipts.glob("*.receipt.json"))),
            "rowArtifacts": len(list(self.rows.glob("*.jsonl.gz"))),
            "artifactCount": len(artifact_hashes),
            "receiptSetSha256": digest(corpus.canonical_json(receipt_set)),
            "artifactSetSha256": digest(corpus.canonical_json(artifact_hashes)),
            **{field: proof["totals"][field] for field in ("sourceRows", "publicRows", "catalogOnlyRows", "derivedOnlyRows", "sourceBytes")},
        }


class SiopeCompletePromotionTests(TestCase):
    def _setup(self, stack: ExitStack) -> tuple[ClosedSiopePromotionBuilder, object, object, object, object]:
        import integrated_source_release as release
        import siope_nonmunicipal as detail

        temporary = tempfile.TemporaryDirectory()
        self.addCleanup(temporary.cleanup)
        builder = ClosedSiopePromotionBuilder(Path(temporary.name).resolve())
        stack.enter_context(mock.patch.object(corpus, "ROOT", builder.root))
        stack.enter_context(mock.patch.object(append_release, "ROOT", builder.root))
        stack.enter_context(mock.patch.object(detail, "REPO_ROOT", builder.root))
        stack.enter_context(mock.patch.object(release, "EXPECTED_DATASETS", 6))
        artifacts = corpus.build_artifacts(
            spec_path=builder.spec,
            source_root=builder.source,
            catalog_path=builder.catalog,
            rows_dir=builder.rows,
            receipts_dir=builder.receipts,
            proof_path=builder.proof,
            private_map_out=None,
        )
        corpus.commit_artifacts(artifacts)
        builder.unrelated_row_hashes = {
            path.name: digest(path.read_bytes()) for path in builder.rows.glob("*.jsonl.gz")
        }
        return builder, release, detail, append_release, corpus

    def _assert_promoted(self, builder: ClosedSiopePromotionBuilder, detail, manifest: dict) -> None:
        self.assertEqual(
            json.loads(builder.release_proof.read_text())["datasets"]["publicRows"],
            builder.expected_rows(manifest)["publicRows"],
        )
        self.assertEqual(
            json.loads((builder.generated / "siope-nonmunicipal-provenance.json").read_text()),
            manifest,
        )
        for name, expected_hash in builder.unrelated_row_hashes.items():
            self.assertEqual(digest((builder.rows / name).read_bytes()), expected_hash)
        detail.validate_committed_detail(
            builder.detail,
            provenance_path=builder.generated / "siope-nonmunicipal-provenance.json",
            view_proof_path=builder.view_proof,
            catalog_path=builder.catalog,
            rows_dir=builder.rows,
            receipts_dir=builder.receipts,
            dataset_proof_path=builder.proof,
            release_proof_path=builder.release_proof,
        )

    def _release_gates(self, stack: ExitStack, builder: ClosedSiopePromotionBuilder, release) -> None:
        stack.enter_context(mock.patch.object(release, "_validate_archive_receipt", return_value={
            "receiptBytes": 10, "receiptSha256": "1" * 64, "archiveBytes": 100,
            "archiveSha256": "2" * 64, "elementSetSha256": "3" * 64, "shards": 1,
            "shardBytes": 100, "entries": release.EXPECTED_CORPUS["entries"],
            "regular": release.EXPECTED_CORPUS["regular"], "hardlink": release.EXPECTED_CORPUS["hardlink"],
            "symlink": release.EXPECTED_CORPUS["symlink"], "storedBytes": 100, "logicalBytes": 100,
        }))
        stack.enter_context(mock.patch.object(release, "_validate_source_catalog", return_value={
            "proofBytes": 20, "proofSha256": "4" * 64, "catalogBytes": 30,
            "catalogSha256": "5" * 64, "identities": 1, "published": 1,
            "quarantined": 0, "totalOccurrences": 1,
        }))
        stack.enter_context(mock.patch.object(release, "_validate_datasets", side_effect=builder.dataset_gate_summary))

    def _append_kwargs(self, builder: ClosedSiopePromotionBuilder) -> dict:
        return {
            "spec_path": builder.spec,
            "source_root": builder.source,
            "dataset_ids": set(builder.DATASET_IDS),
            "catalog_path": builder.catalog,
            "rows_dir": builder.rows,
            "receipts_dir": builder.receipts,
            "proof_path": builder.proof,
            "candidate_detail_path": builder.candidate_detail,
            "candidate_manifest_path": builder.candidate_manifest,
            "detail_path": builder.detail,
            "view_proof_path": builder.view_proof,
            "release_proof_path": builder.release_proof,
        }

    def test_manual_refresh_promotes_reviewed_contract_and_rolls_back_byte_for_byte(self) -> None:
        with ExitStack() as stack:
            builder, release, detail, _append, _corpus = self._setup(stack)
            manifest = builder.build_candidate(1)
            kwargs = self._append_kwargs(builder)
            before = builder.release_hashes()
            expected = builder.expected_rows(manifest)
            wrong = dict(expected)
            wrong["sourceRows"] -= 1
            stack.enter_context(mock.patch.object(release, "EXPECTED_DATASET_ROWS", wrong))
            self._release_gates(stack, builder, release)
            with self.assertRaisesRegex(append_release.AppendError, "Contratto aggregato da revisionare"):
                append_release.append(**kwargs)
            self.assertEqual(builder.release_hashes(), before)
            stack.enter_context(mock.patch.object(release, "EXPECTED_DATASET_ROWS", expected))
            append_release.append(**kwargs)
            first = builder.release_hashes()
            append_release.append(**kwargs)
            self.assertEqual(builder.release_hashes(), first)
            stale = builder.rows / corpus.row_chunk_name("siope-uscite-province", 1)
            self.assertTrue(stale.is_file())

            builder.build_candidate(2)
            builder.write_spec(include_candidate=True)
            before_update = builder.release_hashes()
            updated_manifest = json.loads(builder.candidate_manifest.read_text())
            wrong_update = builder.expected_rows(updated_manifest)
            wrong_update["sourceRows"] -= 1
            stack.enter_context(mock.patch.object(release, "EXPECTED_DATASET_ROWS", wrong_update))
            with self.assertRaisesRegex(append_release.AppendError, "Contratto aggregato da revisionare"):
                append_release.append(**kwargs)
            self.assertEqual(builder.release_hashes(), before_update)
            updated_expected = builder.expected_rows(updated_manifest)
            stack.enter_context(mock.patch.object(release, "EXPECTED_DATASET_ROWS", updated_expected))
            calls = 0
            original_write = corpus.write_bytes

            def fail_write(path: Path, payload: bytes) -> None:
                nonlocal calls
                calls += 1
                if calls == 2:
                    raise OSError("synthetic write failure")
                original_write(path, payload)

            with mock.patch.object(corpus, "write_bytes", side_effect=fail_write):
                with self.assertRaisesRegex(OSError, "synthetic write failure"):
                    append_release.append(**kwargs)
            self.assertEqual(builder.release_hashes(), before_update)
            with mock.patch.object(detail, "build_committed_view_proof", side_effect=RuntimeError("synthetic seal failure")):
                with self.assertRaisesRegex(RuntimeError, "synthetic seal failure"):
                    append_release.append(**kwargs)
            self.assertEqual(builder.release_hashes(), before_update)
            append_release.append(**kwargs)
            self.assertFalse(stale.exists())
            self._assert_promoted(builder, detail, updated_manifest)

    def test_automated_refresh_uses_candidate_manifest_and_rolls_back_seal_failure(self) -> None:
        import integrated_source_release as release
        import siope_nonmunicipal_contract as refresh_contract

        with ExitStack() as stack:
            builder, release, detail, _append, _corpus = self._setup(stack)
            manifest = builder.build_candidate(1)
            kwargs = self._append_kwargs(builder)
            stack.enter_context(mock.patch.object(corpus, "DEFAULT_SPEC", builder.spec))
            stack.enter_context(mock.patch.object(release, "DEFAULT_DATASET_SPEC", builder.spec))
            stack.enter_context(mock.patch.object(refresh_contract, "ROOT", builder.root))
            stack.enter_context(mock.patch.object(refresh_contract, "FIXED_ROWS", {"sourceRows": 1, "publicRows": 1, "catalogOnlyRows": 0, "derivedOnlyRows": 0}))
            provenance = builder.generated / "siope-nonmunicipal-provenance.json"
            provenance.parent.mkdir(parents=True, exist_ok=True)
            provenance.write_bytes(detail.canonical_json(manifest) + b"\n")
            self._release_gates(stack, builder, release)
            append_release.append(**kwargs)
            updated = builder.build_candidate(2)
            provenance.write_bytes(detail.canonical_json(updated) + b"\n")
            before_update = builder.release_hashes()
            with mock.patch.object(detail, "build_committed_view_proof", side_effect=RuntimeError("automated seal failure")):
                with self.assertRaisesRegex(RuntimeError, "automated seal failure"):
                    append_release.append(**kwargs)
            self.assertEqual(builder.release_hashes(), before_update)
            append_release.append(**kwargs)
            self.assertNotEqual(builder.release_hashes(), before_update)
            self._assert_promoted(builder, detail, updated)
