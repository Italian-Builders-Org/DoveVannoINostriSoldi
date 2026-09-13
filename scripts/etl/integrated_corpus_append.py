"""Small public adapter for appending independently locked corpus datasets."""

from __future__ import annotations

from pathlib import Path

import siope_nonmunicipal as siope_detail
from siope_nonmunicipal_corpus import append


def append_integrated_datasets(
    *,
    spec_path: Path,
    source_root: Path,
    dataset_ids: set[str],
    catalog_path: Path,
    rows_dir: Path,
    receipts_dir: Path,
    proof_path: Path,
    release_proof_path: Path,
) -> None:
    """Append datasets and seal the corpus and aggregate release in one rollback boundary."""

    repository = release_proof_path.resolve().parents[2]
    siope_generated = repository / "src/data/generated"
    detail_path = siope_generated / "siope-nonmunicipal-detail.json"
    provenance_path = siope_generated / "siope-nonmunicipal-provenance.json"
    view_proof_path = siope_generated / "siope-nonmunicipal-view-proof.json"

    def reseal_siope_view() -> None:
        siope_detail.build_committed_view_proof(
            detail_path=detail_path,
            provenance_path=provenance_path,
            view_proof_path=view_proof_path,
            catalog_path=catalog_path,
            rows_dir=rows_dir,
            receipts_dir=receipts_dir,
            dataset_proof_path=proof_path,
            release_proof_path=release_proof_path,
        )
        siope_detail.validate_committed_detail(
            detail_path,
            provenance_path=provenance_path,
            view_proof_path=view_proof_path,
            catalog_path=catalog_path,
            rows_dir=rows_dir,
            receipts_dir=receipts_dir,
            dataset_proof_path=proof_path,
            release_proof_path=release_proof_path,
        )

    append(
        spec_path=spec_path,
        source_root=source_root,
        dataset_ids=dataset_ids,
        catalog_path=catalog_path,
        rows_dir=rows_dir,
        receipts_dir=receipts_dir,
        proof_path=proof_path,
        corpus_release_proof_path=release_proof_path,
        correlated_paths={view_proof_path},
        after_release_seal=reseal_siope_view,
    )
