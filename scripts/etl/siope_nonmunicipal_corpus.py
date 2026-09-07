#!/usr/bin/env python3
"""Append a verified SIOPE projection to the immutable integrated corpus release.

The historical private source archive is intentionally not present in a product
checkout.  This command verifies the committed release metadata, preserves its
already committed artifacts byte-for-byte, and uses the existing corpus builder
for the newly acquired, independently hash-locked SIOPE projections.
"""
from __future__ import annotations

import argparse
import json
import tempfile
from pathlib import Path

try:
    from . import integrated_curated_datasets as corpus
    from . import integrated_source_release
    from . import siope_nonmunicipal as detail_etl
except ImportError:
    import integrated_curated_datasets as corpus
    import integrated_source_release
    import siope_nonmunicipal as detail_etl

ROOT = Path(__file__).resolve().parents[2]

class AppendError(RuntimeError):
    pass

def verify_existing_artifacts(proof: dict) -> None:
    hashes = proof.get("artifactSha256")
    if not isinstance(hashes, dict):
        raise AppendError("proof corrente privo degli hash artefatto")
    repository = ROOT.resolve()
    for raw_path, expected_hash in hashes.items():
        if not isinstance(raw_path, str) or not isinstance(expected_hash, str):
            raise AppendError("proof corrente non valido")
        path = (repository / raw_path).resolve()
        if repository not in path.parents or not path.is_file():
            raise AppendError("artefatto corrente mancante o fuori dal repository")
        if corpus.sha256_bytes(path.read_bytes()) != expected_hash:
            raise AppendError(f"hash artefatto corrente divergente: {raw_path}")

def commit_atomically(artifacts: dict[Path, bytes], *, removals: set[Path], protected_paths: set[Path] | None = None, after_write=None, spec_path: Path, catalog_path: Path, rows_dir: Path, receipts_dir: Path, proof_path: Path) -> None:
    """Stage every byte first and restore the previous release on any failure.

    The committed catalog is verified only after all replacement writes.  A
    failed write or validation never leaves a mixed release in the checkout.
    """
    repository = ROOT.resolve()
    targets = set(artifacts) | removals | (protected_paths or set())
    for path in targets:
        resolved = path.resolve()
        if repository not in resolved.parents:
            raise AppendError("artefatto di destinazione fuori dal repository")
    previous = {path: path.read_bytes() if path.exists() else None for path in targets}
    with tempfile.TemporaryDirectory(prefix=".siope-append-", dir=repository) as directory:
        staged = Path(directory)
        for path, payload in artifacts.items():
            relative = path.resolve().relative_to(repository)
            target = staged / relative
            target.parent.mkdir(parents=True, exist_ok=True)
            target.write_bytes(payload)
            if target.read_bytes() != payload:
                raise AppendError("staging release non riproducibile")
        try:
            for path in sorted(artifacts, key=lambda item: item.as_posix()):
                corpus.write_bytes(path, (staged / path.resolve().relative_to(repository)).read_bytes())
            for path in sorted(removals, key=lambda item: item.as_posix()):
                path.unlink(missing_ok=True)
            corpus.check_committed(
                spec_path=spec_path, catalog_path=catalog_path, rows_dir=rows_dir,
                receipts_dir=receipts_dir, proof_path=proof_path,
            )
            if after_write is not None:
                after_write()
        except Exception:
            for path, payload in previous.items():
                if payload is None:
                    path.unlink(missing_ok=True)
                else:
                    corpus.write_bytes(path, payload)
            raise

def append(*, spec_path: Path, source_root: Path, dataset_ids: set[str], catalog_path: Path, rows_dir: Path, receipts_dir: Path, proof_path: Path, candidate_detail_path: Path | None = None, candidate_manifest_path: Path | None = None, detail_path: Path | None = None, view_proof_path: Path | None = None, release_proof_path: Path | None = None) -> None:
    detail_paths = (candidate_detail_path, candidate_manifest_path, detail_path, view_proof_path, release_proof_path)
    promotes_detail = any(path is not None for path in detail_paths)
    if promotes_detail and (any(path is None for path in detail_paths) or dataset_ids != {"siope-inventario-enti", *[policy.dataset_id for policy in detail_etl.POLICIES]}):
        raise AppendError("vista, proof e tutti i dataset SIOPE devono essere promossi insieme")
    if promotes_detail:
        assert candidate_detail_path is not None and candidate_manifest_path is not None
        detail_etl.validate_candidate_detail(detail_path=candidate_detail_path, projection_dir=source_root, manifest_path=candidate_manifest_path)
    spec, datasets = corpus.load_spec(spec_path)
    selected = [item for item in datasets if item["id"] in dataset_ids]
    if {item["id"] for item in selected} != dataset_ids:
        raise AppendError("dataset SIOPE non presente nella specifica corpus")
    try:
        existing_catalog_payload = catalog_path.read_bytes(); existing_proof_payload = proof_path.read_bytes()
        existing_catalog = json.loads(existing_catalog_payload); existing_proof = json.loads(existing_proof_payload)
    except (OSError, UnicodeDecodeError, json.JSONDecodeError) as error:
        raise AppendError("release corpus corrente illeggibile") from error
    if corpus.canonical_json(existing_catalog) != existing_catalog_payload or corpus.canonical_json(existing_proof) != existing_proof_payload:
        raise AppendError("release corpus corrente non canonica")
    if existing_proof.get("catalogSha256") != corpus.sha256_bytes(existing_catalog_payload):
        raise AppendError("hash catalogo corrente divergente")
    verify_existing_artifacts(existing_proof)
    existing_entries = existing_catalog.get("datasets")
    if not isinstance(existing_entries, list):
        raise AppendError("catalogo corrente privo di dataset")
    old_ids = {entry.get("id") for entry in existing_entries if isinstance(entry, dict)}
    expected_ids = {item["id"] for item in datasets}
    if old_ids - dataset_ids != expected_ids - dataset_ids or not old_ids <= expected_ids:
        raise AppendError("catalogo corrente non coincide con la specifica precedente")
    artifacts: dict[Path, bytes] = {}
    new_entries = []
    totals = dict(existing_catalog["totals"])
    for dataset_id in sorted(dataset_ids & old_ids):
        try:
            receipt = json.loads((receipts_dir / f"{dataset_id}.receipt.json").read_bytes())
        except (OSError, UnicodeDecodeError, json.JSONDecodeError) as error:
            raise AppendError(f"receipt corrente illeggibile per {dataset_id}") from error
        totals["datasets"] -= 1
        totals["sourceRows"] -= receipt["source"]["rows"]
        totals["publicRows"] -= receipt["publication"]["publicRows"]
        totals["catalogOnlyRows"] -= receipt["publication"]["catalogOnlyRows"]
        totals["derivedOnlyRows"] -= receipt["publication"]["derivedOnlyRows"]
        totals["sourceBytes"] -= receipt["source"]["bytes"]
    for item in selected:
        parsed = corpus.parse_dataset(source_root, item)
        entry, rows_payload, receipt, _private_rows = corpus.build_dataset(item, parsed, corpus.resolved_source_metadata(spec, item["id"]))
        receipt_path = receipts_dir / f"{item['id']}.receipt.json"; artifacts[receipt_path] = corpus.canonical_json(receipt)
        if rows_payload is not None:
            for ordinal, chunk in enumerate(corpus.row_payload_chunks(item["id"], rows_payload)):
                artifacts[rows_dir / corpus.row_chunk_name(item["id"], ordinal)] = corpus.canonical_gzip(chunk)
        new_entries.append(entry)
        totals["datasets"] += 1
        totals["sourceRows"] += receipt["source"]["rows"]
        totals["publicRows"] += receipt["publication"]["publicRows"]
        totals["catalogOnlyRows"] += receipt["publication"]["catalogOnlyRows"]
        totals["derivedOnlyRows"] += receipt["publication"]["derivedOnlyRows"]
        totals["sourceBytes"] += receipt["source"]["bytes"]
    if promotes_detail and any(totals[field] != expected for field, expected in integrated_source_release.EXPECTED_DATASET_ROWS.items()):
        raise AppendError("Contratto aggregato da revisionare prima della promozione: aggiornare EXPECTED_DATASET_ROWS e i contratti dipendenti secondo docs/SIOPE_NON_MUNICIPAL.md")
    preserved_entries = [entry for entry in existing_entries if entry["id"] not in dataset_ids]
    catalog = {"schemaVersion": 1, "generatedAt": spec["generatedAt"], "corpusContract": spec["corpusContract"], "totals": totals, "datasets": sorted([*preserved_entries, *new_entries], key=lambda entry: entry["id"])}
    catalog_payload = corpus.canonical_json(catalog); artifacts[catalog_path] = catalog_payload
    hashes = dict(existing_proof["artifactSha256"])
    selected_receipt_keys = {f"{receipts_dir.relative_to(ROOT).as_posix()}/{dataset_id}.receipt.json" for dataset_id in dataset_ids}
    selected_row_prefixes = tuple(f"{rows_dir.relative_to(ROOT).as_posix()}/{dataset_id}.part-" for dataset_id in dataset_ids)
    removed_keys = {key for key in hashes if key in selected_receipt_keys or key.startswith(selected_row_prefixes)}
    removals = {ROOT / key for key in removed_keys}
    for key in removed_keys:
        hashes.pop(key)
    for path, payload in artifacts.items(): hashes[path.relative_to(ROOT).as_posix()] = corpus.sha256_bytes(payload)
    proof = {"schemaVersion": 1, "generatedAt": spec["generatedAt"], "complete": True, "totals": totals, "catalogSha256": corpus.sha256_bytes(catalog_payload), "artifactSha256": dict(sorted(hashes.items()))}
    artifacts[proof_path] = corpus.canonical_json(proof)
    protected_paths: set[Path] = set()
    after_write = None
    if promotes_detail:
        assert candidate_detail_path is not None and detail_path is not None and view_proof_path is not None and release_proof_path is not None
        provenance_path = detail_path.parent / "siope-nonmunicipal-provenance.json"
        protected_paths = {detail_path, view_proof_path, release_proof_path, provenance_path}
        candidate_detail_payload = candidate_detail_path.read_bytes()
        candidate_manifest_payload = candidate_manifest_path.read_bytes()

        def seal_release() -> None:
            corpus.write_bytes(detail_path, candidate_detail_payload)
            corpus.write_bytes(provenance_path, candidate_manifest_payload)
            release_paths = integrated_source_release.ReleasePaths(
                ledger_dir=release_proof_path.parent,
                dataset_spec=spec_path,
                dataset_catalog=catalog_path,
                dataset_rows_dir=rows_dir,
                output=release_proof_path,
            )
            integrated_source_release.build_release(release_paths)
            detail_etl.build_committed_view_proof(
                detail_path=detail_path, provenance_path=provenance_path, view_proof_path=view_proof_path, catalog_path=catalog_path,
                rows_dir=rows_dir, receipts_dir=receipts_dir, dataset_proof_path=proof_path,
                release_proof_path=release_proof_path,
            )
            detail_etl.validate_committed_detail(
                detail_path, provenance_path=provenance_path, view_proof_path=view_proof_path, catalog_path=catalog_path,
                rows_dir=rows_dir, receipts_dir=receipts_dir, dataset_proof_path=proof_path,
                release_proof_path=release_proof_path,
            )

        after_write = seal_release
    commit_atomically(
        artifacts, removals=removals - set(artifacts), protected_paths=protected_paths, after_write=after_write,
        spec_path=spec_path, catalog_path=catalog_path, rows_dir=rows_dir,
        receipts_dir=receipts_dir, proof_path=proof_path,
    )

def main() -> int:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--source-root", type=Path, required=True)
    parser.add_argument("--dataset", action="append", required=True)
    parser.add_argument("--spec", type=Path, default=ROOT / "scripts/etl/specs/integrated-curated-datasets.source.json")
    parser.add_argument("--candidate-detail", type=Path)
    parser.add_argument("--candidate-manifest", type=Path)
    args = parser.parse_args()
    candidate_detail = args.candidate_detail or args.source_root / "siope-nonmunicipal-detail.json"
    candidate_manifest = args.candidate_manifest or args.source_root / "siope-nonmunicipal-release.json"
    append(
        spec_path=args.spec, source_root=args.source_root, dataset_ids=set(args.dataset),
        catalog_path=ROOT / "src/data/generated/integrated/catalog.json", rows_dir=ROOT / "src/data/generated/integrated/rows",
        receipts_dir=ROOT / "data/source-ledger/datasets", proof_path=ROOT / "data/source-ledger/dataset-proof.json",
        candidate_detail_path=candidate_detail, candidate_manifest_path=candidate_manifest,
        detail_path=ROOT / "src/data/generated/siope-nonmunicipal-detail.json",
        view_proof_path=ROOT / "src/data/generated/siope-nonmunicipal-view-proof.json",
        release_proof_path=ROOT / "data/source-ledger/release-proof.json",
    )
    return 0

if __name__ == "__main__":
    raise SystemExit(main())
