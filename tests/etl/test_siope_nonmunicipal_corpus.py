from __future__ import annotations

import hashlib
import json
import sys
import tempfile
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


class SiopeCompletePromotionTests(TestCase):
    def test_refresh_uses_the_reviewed_contract_and_seals_real_provenance(self) -> None:
        import shutil
        from test_siope_nonmunicipal import SiopeNonMunicipalTests
        import siope_nonmunicipal as detail
        import integrated_source_release as release
        fixture = SiopeNonMunicipalTests()
        fixture.setUp()
        self.addCleanup(fixture.tearDown)
        manifest = fixture.build()
        with tempfile.TemporaryDirectory() as directory:
            root = Path(directory).resolve()
            ledger = root / "data/source-ledger"
            shutil.copytree(ROOT / "data/source-ledger", ledger,
                ignore=shutil.ignore_patterns("datasets", "dataset-proof.json", "release-proof.json"))
            generated = root / "src/data/generated"
            spec_path = root / "spec.json"
            old = b"entityCode|amountCents\nold|1\n"
            (fixture.output / "old.psv").write_bytes(old)
            old_item = dataset("old", "old.psv", old)
            spec = {"schemaVersion": 1, "generatedAt": "2026-09-06T08:00:00Z",
                "corpusContract": {"elements": 51_303, "regularFiles": 46_438, "hardlinks": 4_860, "symlinks": 5},
                "sourceMetadata": {"default": {"holder": "Fixture", "referencePeriod": None,
                    "publicationDate": None, "acquisitionDate": "2026-09-06", "checkedAt": "2026-09-06",
                    "updateFrequency": None, "canonicalUrls": []}, "overrides": {}}, "datasets": [old_item]}
            spec_path.write_text(json.dumps(spec))
            kwargs = dict(spec_path=spec_path, source_root=fixture.output, dataset_ids=set(manifest["projections"]),
                catalog_path=generated / "integrated/catalog.json", rows_dir=generated / "integrated/rows",
                receipts_dir=ledger / "datasets", proof_path=ledger / "dataset-proof.json",
                candidate_detail_path=fixture.output / "siope-nonmunicipal-detail.json",
                candidate_manifest_path=fixture.output / "siope-nonmunicipal-release.json",
                detail_path=generated / "siope-nonmunicipal-detail.json",
                view_proof_path=generated / "siope-nonmunicipal-view-proof.json",
                release_proof_path=ledger / "release-proof.json")
            expected = {"sourceRows": 1 + sum(p["rows"] for p in manifest["projections"].values()),
                "publicRows": 1 + sum(p["rows"] for p in manifest["projections"].values()),
                "catalogOnlyRows": 0, "derivedOnlyRows": 0}
            with mock.patch.object(corpus, "ROOT", root), mock.patch.object(append_release, "ROOT", root), mock.patch.object(detail, "REPO_ROOT", root), mock.patch.object(release, "EXPECTED_DATASETS", 1 + len(manifest["projections"])):
                artifacts = corpus.build_artifacts(spec_path=spec_path, source_root=fixture.output,
                    catalog_path=kwargs["catalog_path"], rows_dir=kwargs["rows_dir"], receipts_dir=kwargs["receipts_dir"],
                    proof_path=kwargs["proof_path"], private_map_out=None)
                corpus.commit_artifacts(artifacts)
                for identifier in sorted(kwargs["dataset_ids"]):
                    name = f"{identifier}.psv"
                    spec["datasets"].append(dataset(identifier, name, (fixture.output / name).read_bytes()))
                spec_path.write_text(json.dumps(spec))
                def hashes():
                    return {p.relative_to(root).as_posix(): digest(p.read_bytes()) for p in root.rglob("*") if p.is_file()}
                before = hashes()
                with self.assertRaisesRegex(append_release.AppendError, "Contratto aggregato da revisionare"):
                    append_release.append(**kwargs)
                self.assertEqual(hashes(), before)
                # Only fixture contracts are substituted: all validators and sealers run.
                with mock.patch.object(release, "EXPECTED_DATASET_ROWS", expected):
                    append_release.append(**kwargs)
                    # Reacquire a different row set, then review the revised counts explicitly.
                    from test_siope_nonmunicipal import zipped
                    zipped(fixture.input / "SIOPE_USCITE.2026.zip", {"USCITE_2026.csv": [
                        ["100", "2026", "01", "1.01", "100"],
                        ["100", "2026", "03", "1.01", "50"],
                    ]})
                    fixture.write_input_receipt()
                    updated = fixture.build()
                    for item in spec["datasets"]:
                        if item["id"] in kwargs["dataset_ids"]:
                            item["expected"].update(updated["projections"][item["id"]])
                    spec_path.write_text(json.dumps(spec))
                    before_update = hashes()
                    with self.assertRaisesRegex(append_release.AppendError, "Contratto aggregato da revisionare"):
                        append_release.append(**kwargs)
                    self.assertEqual(hashes(), before_update)
                    new_count = 1 + sum(p["rows"] for p in updated["projections"].values())
                    revised = dict(expected, sourceRows=new_count, publicRows=new_count)
                    with mock.patch.object(release, "EXPECTED_DATASET_ROWS", revised):
                        append_release.append(**kwargs)
                actual = json.loads(kwargs["release_proof_path"].read_text())
                self.assertEqual(actual["datasets"]["publicRows"], new_count)
                self.assertEqual(json.loads((generated / "siope-nonmunicipal-provenance.json").read_text()), updated)
                detail.validate_committed_detail(kwargs["detail_path"],
                    provenance_path=generated / "siope-nonmunicipal-provenance.json",
                    view_proof_path=kwargs["view_proof_path"], catalog_path=kwargs["catalog_path"], rows_dir=kwargs["rows_dir"],
                    receipts_dir=kwargs["receipts_dir"], dataset_proof_path=kwargs["proof_path"], release_proof_path=kwargs["release_proof_path"])
                for key, value in before.items():
                    if key.startswith("src/data/generated/integrated/rows/"):
                        self.assertEqual(digest((root / key).read_bytes()), value)
