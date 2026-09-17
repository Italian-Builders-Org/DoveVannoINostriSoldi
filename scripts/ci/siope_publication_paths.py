"""Closed publication surface for the five SIOPE nonmunicipal projections."""
import re

IDS = ("siope-inventario-enti", "siope-uscite-asl", "siope-uscite-province", "siope-uscite-regioni", "siope-uscite-citta-metropolitane")
FIXED = frozenset({
    "src/data/generated/siope-nonmunicipal-provenance.json",
    "src/data/generated/siope-nonmunicipal-detail.json",
    "src/data/generated/siope-nonmunicipal-view-proof.json",
    "src/data/generated/integrated/catalog.json",
    "data/source-ledger/dataset-proof.json",
    "data/source-ledger/release-proof.json",
    "docs/SOURCE_SNAPSHOT_INVENTORY.md",
    *(f"data/source-ledger/datasets/{identifier}.receipt.json" for identifier in IDS),
})
CHUNK = re.compile(r"src/data/generated/integrated/rows/(?:" + "|".join(IDS) + r")\.part-[0-9]{5}\.jsonl\.gz\Z")


def allowed(path: str) -> bool:
    return path in FIXED or CHUNK.fullmatch(path) is not None


def current_paths(root) -> set[str]:
    rows = root / "src/data/generated/integrated/rows"
    return set(FIXED) | {path.relative_to(root).as_posix() for path in rows.iterdir() if CHUNK.fullmatch(path.relative_to(root).as_posix())}
