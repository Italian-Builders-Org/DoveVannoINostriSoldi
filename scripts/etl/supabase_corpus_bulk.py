#!/usr/bin/env python3
"""Preflight pinned public corpus chunks for a bounded COPY importer.

No database write is performed by this command. Credentials are read literally,
never interpolated by a shell and never included in exception messages.
"""
import argparse
import gzip
import hashlib
import json
from pathlib import Path
from urllib.parse import parse_qs, urlsplit

from supabase_corpus_export import (
    CATALOG,
    LEDGER,
    checked,
    load_catalog,
    release,
    snapshot_id,
)

PROJECT = "zvqhikeylxynsljwgosc"
CHUNK_ROWS = 1000


def load_database_url(env_file):
    values = {}
    for line in env_file.read_text().splitlines():
        if line.strip() and not line.lstrip().startswith("#") and "=" in line:
            key, value = line.split("=", 1)
            values[key.strip()] = value.strip().strip("\"'")
    uri = values.get("DVNS_DATABASE_URL", "")
    try:
        parsed = urlsplit(uri)
        valid = (
            parsed.scheme in ("postgres", "postgresql")
            and parsed.password
            and (
                (
                    parsed.hostname == f"db.{PROJECT}.supabase.co"
                    and parsed.username == "postgres"
                )
                or (
                    parsed.hostname == "aws-0-eu-west-1.pooler.supabase.com"
                    and parsed.username == f"postgres.{PROJECT}"
                )
            )
            and parsed.path == "/postgres"
            and parse_qs(parsed.query).get("sslmode") in (["require"], ["verify-full"])
        )
    except ValueError:
        valid = False
    if not valid:
        raise ValueError(
            "Missing or invalid DVNS connection: require target project, password and TLS"
        )
    return uri


class BulkManifest:
    def __init__(self, root):
        self.root = Path(root)
        self.catalog = load_catalog(self.root)
        self.snapshot_id = snapshot_id(self.root)
        proof = release(self.root)
        self.artifacts = json.loads(
            checked(
                self.root / LEDGER / "dataset-proof.json",
                proof["datasets"]["proofSha256"],
            )
        )["artifactSha256"]
        self.datasets = {item["id"]: item for item in self.catalog["datasets"]}

    def receipt(self, dataset_id):
        item = self.datasets[dataset_id]
        return json.loads(
            checked(
                self.root / LEDGER / "datasets" / f"{dataset_id}.receipt.json",
                item["receiptSha256"],
            )
        )

    def chunks(self, dataset_id):
        item = self.datasets[dataset_id]
        if (
            item["publication"] not in ("rows", "source-index")
            or item["publicRows"] <= 0
        ):
            raise ValueError("publication does not permit public row import")
        prefix = f"src/data/generated/integrated/rows/{dataset_id}.part-"
        expected = sorted(path for path in self.artifacts if path.startswith(prefix))
        actual = sorted(
            p.relative_to(self.root).as_posix()
            for p in (self.root / "src/data/generated/integrated/rows").glob(
                f"{dataset_id}.part-*.jsonl.gz"
            )
        )
        if (
            actual != expected
            or len(expected) != (item["publicRows"] + CHUNK_ROWS - 1) // CHUNK_ROWS
        ):
            raise ValueError("missing or extra chunk")
        for index, path in enumerate(expected):
            if path != f"{prefix}{index:05d}.jsonl.gz":
                raise ValueError("non-contiguous chunk ordinals")
            compressed = checked(self.root / path, self.artifacts[path])
            payload = gzip.decompress(compressed)
            rows = [json.loads(line) for line in payload.splitlines()]
            first = index * CHUNK_ROWS + 1
            if len(rows) != min(CHUNK_ROWS, item["publicRows"] - first + 1):
                raise ValueError("chunk row count mismatch")
            yield {
                "path": path,
                "sha256": self.artifacts[path],
                "payload": payload,
                "rows": rows,
                "first_ordinal": first,
            }

    def verify(self, dataset_id):
        receipt = self.receipt(dataset_id)
        digest = hashlib.sha256()
        count = chunks = size = 0
        for chunk in self.chunks(dataset_id):
            digest.update(chunk["payload"])
            count += len(chunk["rows"])
            size += len(chunk["payload"])
            chunks += 1
        if digest.hexdigest() != receipt["rowsSha256"]:
            raise ValueError("dataset rows hash mismatch")
        if count != receipt["publication"]["publicRows"]:
            raise ValueError("dataset row count mismatch")
        return {
            "dataset": dataset_id,
            "rows": count,
            "chunks": chunks,
            "uncompressed_bytes": size,
            "sha256": digest.hexdigest(),
        }


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument(
        "--root", type=Path, default=Path(__file__).resolve().parents[2]
    )
    parser.add_argument("--dataset", action="append")
    args = parser.parse_args()
    manifest = BulkManifest(args.root)
    selected = args.dataset or [
        item["id"]
        for item in manifest.catalog["datasets"]
        if item["publication"] in ("rows", "source-index") and item["publicRows"] > 0
    ]
    for dataset_id in selected:
        print(json.dumps(manifest.verify(dataset_id)), flush=True)


if __name__ == "__main__":
    main()
