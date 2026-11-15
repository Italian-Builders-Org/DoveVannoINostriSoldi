"""Derive SQL reader proofs from the release's verified gzip artifacts."""
import argparse
import gzip
import hashlib
import io
import json
from pathlib import Path

ROOT = Path(__file__).resolve().parents[2]
OUTPUT = ROOT / "src/data/supabase-chunk-digests.json"
MAX_RAW_BYTES = 2 * 1024 * 1024
CHUNK_PREFIX = "src/data/generated/integrated/rows/"


def sha256(data: bytes) -> str:
    return hashlib.sha256(data).hexdigest()


def build_manifest() -> str:
    release = json.loads((ROOT / "data/source-ledger/release-proof.json").read_bytes())
    proof_bytes = (ROOT / "data/source-ledger/dataset-proof.json").read_bytes()
    if sha256(proof_bytes) != release["datasets"]["proofSha256"]:
        raise ValueError("Dataset proof differs from the release proof")

    chunks = {}
    artifacts = json.loads(proof_bytes)["artifactSha256"]
    paths = [path for path in artifacts if path.startswith(CHUNK_PREFIX)]
    if len(paths) != release["datasets"]["rowArtifacts"]:
        raise ValueError("Unexpected number of chunk artifacts")

    for path in paths:
        name = path.removeprefix(CHUNK_PREFIX)
        if Path(name).name != name or not name.endswith(".jsonl.gz"):
            raise ValueError(f"Invalid chunk path: {path}")
        compressed = (ROOT / path).read_bytes()
        digest = artifacts[path]
        if sha256(compressed) != digest:
            raise ValueError(f"Chunk differs from the release proof: {path}")
        with gzip.GzipFile(fileobj=io.BytesIO(compressed)) as stream:
            raw = stream.read(MAX_RAW_BYTES + 1)
        if len(raw) > MAX_RAW_BYTES:
            raise ValueError(f"Chunk exceeds the raw byte limit: {path}")
        chunks[digest] = [sha256(raw), len(compressed)]

    entries = [f'  "{digest}": {json.dumps(proof)}' for digest, proof in sorted(chunks.items())]
    return "{\n" + ",\n".join(entries) + "\n}\n"


if __name__ == "__main__":
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--check", action="store_true")
    args = parser.parse_args()
    manifest = build_manifest()
    if args.check:
        if OUTPUT.read_text(encoding="utf-8") != manifest:
            raise SystemExit("Supabase chunk digests differ from the verified release")
    else:
        OUTPUT.write_text(manifest, encoding="utf-8")
