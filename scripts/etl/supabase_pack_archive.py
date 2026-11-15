#!/usr/bin/env python3
"""Pack remaining files into bounded private objects; verify full file restore."""
import argparse
import hashlib
import json
from pathlib import Path
import sys
from urllib.error import HTTPError

from supabase_corpus_bulk import load_database_url
from supabase_snapshot_documents import file_inventory
from supabase_snapshot_storage import (
    PART_BYTES,
    BUCKET,
    StorageClient,
    storage_credentials,
    file_parts,
    commit_receipts,
)


def archive_packs(root, inventory, part_bytes=PART_BYTES):
    payload = bytearray()
    segments = []
    completed = []
    for item in inventory:
        parts = []
        digest = hashlib.sha256()
        total = 0
        for block in file_parts(root / item["path"], item["source_sha256"], part_bytes):
            digest.update(block)
            total += len(block)
            position = 0
            while position < len(block):
                take = min(part_bytes - len(payload), len(block) - position)
                piece = block[position : position + take]
                segment = {
                    "offset": len(payload),
                    "bytes": take,
                    "sha256": hashlib.sha256(piece).hexdigest(),
                }
                parts.append(segment)
                segments.append(segment)
                payload.extend(piece)
                position += take
                if len(payload) == part_bytes:
                    key = "sha256/" + hashlib.sha256(payload).hexdigest()
                    for segment in segments:
                        segment["key"] = key
                    yield {"payload": bytes(payload), "completed": completed}
                    payload = bytearray()
                    segments = []
                    completed = []
        if digest.hexdigest() != item["source_sha256"] or total != item["source_bytes"]:
            raise ValueError("source changed while packing")
        completed.append(
            {
                "source_sha256": item["source_sha256"],
                "source_bytes": total,
                "bucket": BUCKET,
                "parts": parts,
            }
        )
    if payload or completed:
        key = "sha256/" + hashlib.sha256(payload).hexdigest()
        for segment in segments:
            segment["key"] = key
        yield {"payload": bytes(payload), "completed": completed}


def load_receipts(conn):
    return {
        sha: {
            "source_sha256": sha,
            "source_bytes": size,
            "bucket": bucket,
            "parts": parts,
        }
        for sha, size, bucket, parts in conn.execute(
            "SELECT source_sha256,source_bytes,bucket,parts FROM dvns_snapshots.blobs"
        )
    }


def verify_restore(client, inventory, receipts):
    # Sequential file order permits a one-object cache, bounded to 4 MiB.
    cached_key = None
    cached_payload = None
    count = total = 0
    for item in inventory:
        receipt = receipts.get(item["source_sha256"])
        if (
            not receipt
            or receipt["source_bytes"] != item["source_bytes"]
            or receipt["bucket"] != BUCKET
        ):
            raise ValueError("missing or divergent file receipt")
        digest = hashlib.sha256()
        size = 0
        for part in receipt["parts"]:
            if cached_key != part["key"]:
                with client.open(
                    "/object/authenticated/" + BUCKET + "/" + part["key"]
                ) as response:
                    payload = response.read(PART_BYTES + 1)
                if len(payload) > PART_BYTES or hashlib.sha256(
                    payload
                ).hexdigest() != part["key"].removeprefix("sha256/"):
                    raise ValueError("restored archive object hash mismatch")
                cached_payload = payload
                cached_key = part["key"]
            offset = part.get("offset", 0)
            end = offset + part["bytes"]
            if offset < 0 or end > len(cached_payload):
                raise ValueError("invalid archived file offset")
            piece = cached_payload[offset:end]
            if hashlib.sha256(piece).hexdigest() != part["sha256"]:
                raise ValueError("restored file segment hash mismatch")
            digest.update(piece)
            size += len(piece)
        if digest.hexdigest() != item["source_sha256"] or size != item["source_bytes"]:
            raise ValueError("restored file hash or byte count mismatch")
        count += 1
        total += size
        if count % 500 == 0:
            print(
                json.dumps({"event": "restored", "files": count, "bytes": total}),
                flush=True,
            )
    return count, total


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument(
        "--root", type=Path, default=Path(__file__).resolve().parents[2]
    )
    parser.add_argument("--env-file", type=Path, required=True)
    parser.add_argument("--storage-env-file", type=Path, required=True)
    parser.add_argument("--path", action="append")
    parser.add_argument("--verify-only", action="store_true")
    args = parser.parse_args()
    import psycopg

    inventory = file_inventory(
        args.root,
        json.loads((args.root / "scripts/ci/generated-artifacts.json").read_bytes()),
    )
    if args.path:
        inventory = [item for item in inventory if item["path"] in args.path]
        if len(inventory) != len(set(args.path)):
            parser.error("unknown archive path")
    client = StorageClient(*storage_credentials(args.storage_env_file))
    try:
        with psycopg.connect(
            load_database_url(args.env_file),
            autocommit=True,
            connect_timeout=15,
            prepare_threshold=None,
        ) as conn:
            if not conn.execute(
                "SELECT pg_try_advisory_lock(hashtext('dvns-storage-archive'),0)"
            ).fetchone()[0]:
                raise ValueError("another packed archive importer is active")
            if (
                conn.execute(
                    "SELECT current_setting('default_transaction_read_only')"
                ).fetchone()[0]
                == "on"
            ):
                raise ValueError("project is read-only; resolve capacity first")
            client.ensure_bucket()
            receipts = load_receipts(conn)
            missing = [
                item for item in inventory if item["source_sha256"] not in receipts
            ]
            if not args.verify_only:
                for index, pack in enumerate(archive_packs(args.root, missing), 1):
                    if pack["payload"]:
                        client.put_part(pack["payload"])
                    if pack["completed"]:
                        commit_receipts(conn, pack["completed"])
                    print(
                        json.dumps(
                            {
                                "event": "pack_verified",
                                "pack": index,
                                "files_completed": len(pack["completed"]),
                            }
                        ),
                        flush=True,
                    )
            count, total = verify_restore(client, inventory, load_receipts(conn))
            print(
                json.dumps(
                    {
                        "event": "archive_restore_complete",
                        "files": count,
                        "bytes": total,
                        "bucket": BUCKET,
                    }
                ),
                flush=True,
            )
    except Exception as error:
        print(
            json.dumps(
                {
                    "event": "failed",
                    "error_type": type(error).__name__,
                    "http_status": getattr(error, "code", None),
                    "reason": (
                        str(error)
                        if isinstance(error, ValueError)
                        else "Archive operation failed; credentials omitted"
                    ),
                }
            ),
            flush=True,
        )
        return 2
    return 0


if __name__ == "__main__":
    sys.exit(main())
