#!/usr/bin/env python3
"""Restore a pinned Supabase release into a verified local runtime cache.

Only SELECT and private Storage GET. Never overwrites repository artifacts.
"""
import argparse
import fcntl
import hashlib
import json
import os
from pathlib import Path, PurePosixPath
import re
import tempfile
from supabase_corpus_bulk import load_database_url
from supabase_pack_archive import load_receipts
from supabase_snapshot_documents import parse_document
from supabase_snapshot_storage import (
    BUCKET,
    PART_BYTES,
    StorageClient,
    storage_credentials,
)


def digest_file(path):
    digest = hashlib.sha256()
    with path.open("rb") as stream:
        while block := stream.read(1024 * 1024):
            digest.update(block)
    return digest.hexdigest()


def inventory_digest(inventory):
    return hashlib.sha256(
        json.dumps(
            inventory, ensure_ascii=False, sort_keys=True, separators=(",", ":")
        ).encode()
    ).hexdigest()


def safe_target(root, name):
    parts = PurePosixPath(name).parts
    if (
        not name
        or name.startswith("/")
        or "\\" in name
        or ".." in parts
        or not (
            name.startswith("src/data/generated/")
            or name.startswith("data/source-ledger/")
        )
    ):
        raise ValueError("invalid snapshot path")
    target = root.joinpath(*parts)
    for parent in (root, *target.relative_to(root).parents):
        candidate = parent if parent == root else root / parent
        if candidate.is_symlink():
            raise ValueError("snapshot symlink refused")
    if target.is_symlink():
        raise ValueError("snapshot symlink refused")
    return target


def validate_cache_root(repository, cache):
    repository = repository.resolve()
    resolved = cache.resolve()
    if (
        not resolved.is_relative_to(repository / "artifacts")
        or resolved == repository / "artifacts"
    ):
        raise ValueError("runtime cache must stay inside repository artifacts")
    return resolved


def validate_document(raw, stored):
    if parse_document(raw) != stored:
        raise ValueError("database document differs from archived bytes")


def restore_file(client, item, receipt, root, cache):
    target = safe_target(root, item["path"])
    if (
        not receipt
        or receipt["bucket"] != BUCKET
        or receipt["source_bytes"] != item["source_bytes"]
        or receipt["source_sha256"] != item["source_sha256"]
    ):
        raise ValueError("missing or divergent archive receipt")
    if (
        target.exists()
        and target.is_file()
        and target.stat().st_size == item["source_bytes"]
        and digest_file(target) == item["source_sha256"]
    ):
        return target
    target.parent.mkdir(parents=True, exist_ok=True)
    total = 0
    digest = hashlib.sha256()
    temporary = None
    try:
        incoming = root / ".incoming"
        if incoming.is_symlink():
            raise ValueError("cache symlink refused")
        incoming.mkdir(exist_ok=True)
        with tempfile.NamedTemporaryFile(dir=incoming, delete=False) as output:
            temporary = Path(output.name)
            for part in receipt["parts"]:
                key = part["key"]
                if not re.fullmatch(r"sha256/[0-9a-f]{64}", key):
                    raise ValueError("invalid archive key")
                if cache.get("key") != key:
                    with client.open(
                        "/object/authenticated/" + BUCKET + "/" + key
                    ) as response:
                        payload = response.read(PART_BYTES + 1)
                    if (
                        len(payload) > PART_BYTES
                        or hashlib.sha256(payload).hexdigest() != key[7:]
                    ):
                        raise ValueError("archive object hash mismatch")
                    cache.clear()
                    cache.update(key=key, payload=payload)
                payload = cache["payload"]
                offset = part.get("offset", 0)
                length = part["bytes"]
                if (
                    type(offset) is not int
                    or type(length) is not int
                    or offset < 0
                    or length <= 0
                    or offset + length > len(payload)
                ):
                    raise ValueError("invalid archive segment")
                piece = payload[offset : offset + length]
                if hashlib.sha256(piece).hexdigest() != part["sha256"]:
                    raise ValueError("archive segment hash mismatch")
                total += len(piece)
                if total > item["source_bytes"]:
                    raise ValueError("archive exceeds file budget")
                digest.update(piece)
                output.write(piece)
            if (
                total != item["source_bytes"]
                or digest.hexdigest() != item["source_sha256"]
            ):
                raise ValueError("restored file hash mismatch")
        temporary.chmod(0o444)
        os.replace(temporary, target)
        return target
    finally:
        if temporary and temporary.exists():
            temporary.unlink()


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument(
        "--root", type=Path, default=Path(__file__).resolve().parents[2]
    )
    parser.add_argument("--env-file", type=Path, required=True)
    parser.add_argument("--storage-env-file", type=Path, required=True)
    parser.add_argument("--cache", type=Path, required=True)
    args = parser.parse_args()
    import psycopg
    from psycopg.types.json import set_json_loads

    args.cache = validate_cache_root(args.root, args.cache)
    pin = json.loads((args.root / "supabase/runtime-release.json").read_bytes())
    registry = (args.root / "scripts/ci/generated-artifacts.json").read_bytes()
    if hashlib.sha256(registry).hexdigest() != pin["registry_sha256"]:
        raise ValueError("local registry differs from pinned release")
    args.cache.mkdir(parents=True, exist_ok=True)
    if args.cache.is_symlink():
        raise ValueError("cache symlink refused")
    with (args.cache / "restore.lock").open("a") as lock:
        fcntl.flock(lock, fcntl.LOCK_EX | fcntl.LOCK_NB)
        with psycopg.connect(
            load_database_url(args.env_file),
            connect_timeout=15,
            autocommit=True,
            application_name="dvns-runtime-restore",
        ) as conn:
            set_json_loads(parse_document, conn)
            with conn.transaction():
                conn.execute("SET TRANSACTION READ ONLY")
                conn.execute("SET LOCAL statement_timeout='30s'")
                remote = conn.execute(
                    "SELECT registry_sha256 FROM dvns_snapshots.registries WHERE code_sha=%s",
                    (pin["code_sha"],),
                ).fetchone()
                if remote != (pin["registry_sha256"],):
                    raise ValueError("remote release registry mismatch")
                inventory = [
                    {
                        "path": p,
                        "source_sha256": h,
                        "source_bytes": n,
                        "groups": g,
                        "disposition": d,
                    }
                    for p, h, n, g, d in conn.execute(
                        "SELECT path,source_sha256,source_bytes,group_ids,disposition FROM dvns_snapshots.files WHERE code_sha=%s ORDER BY path",
                        (pin["code_sha"],),
                    )
                ]
                if inventory_digest(inventory) != pin["inventory_sha256"]:
                    raise ValueError("remote inventory differs from pinned release")
                receipts = load_receipts(conn)
                documents_dir = args.cache / ".database-documents"
                documents_dir.mkdir(exist_ok=True)
                with conn.cursor(name="dvns_runtime_documents") as cursor:
                    cursor.itersize = 1
                    cursor.execute(
                        """SELECT d.path,
                        CASE WHEN octet_length(d.payload::text)<=f.source_bytes*2+1024
                             THEN d.payload::text ELSE NULL END
                        FROM dvns_snapshots.documents d
                        JOIN dvns_snapshots.files f USING(code_sha,path)
                        WHERE d.code_sha=%s ORDER BY d.path""",
                        (pin["code_sha"],),
                    )
                    document_paths = set()
                    for path, payload in cursor:
                        if payload is None:
                            raise ValueError("database document exceeds byte budget")
                        document_paths.add(path)
                        (
                            documents_dir
                            / (hashlib.sha256(path.encode()).hexdigest() + ".json")
                        ).write_text(payload)
                if document_paths != {
                    i["path"] for i in inventory if i["disposition"] == "json-document"
                }:
                    raise ValueError("database documents incomplete")
        # No database session/transaction is held while downloading binary objects.
        selected = [i for i in inventory if i["disposition"] != "corpus-chunk"]
        client = StorageClient(*storage_credentials(args.storage_env_file))
        cache = {}
        documents = 0
        for index, item in enumerate(selected, 1):
            target = restore_file(
                client, item, receipts.get(item["source_sha256"]), args.cache, cache
            )
            if item["disposition"] == "json-document":
                stored = parse_document(
                    (
                        documents_dir
                        / (hashlib.sha256(item["path"].encode()).hexdigest() + ".json")
                    ).read_bytes()
                )
                validate_document(target.read_bytes(), stored)
                documents += 1
            if index % 100 == 0:
                print(
                    json.dumps(
                        {
                            "event": "runtime_restore",
                            "files": index,
                            "total": len(selected),
                        }
                    ),
                    flush=True,
                )
        expected = {i["path"] for i in selected}
        actual = {
            p.relative_to(args.cache).as_posix()
            for prefix in ("src/data/generated", "data/source-ledger")
            for p in (args.cache / prefix).rglob("*")
            if p.is_file()
        }
        if actual != expected:
            raise ValueError("runtime cache contains files outside release")
        result = {
            "event": "runtime_ready",
            "code_sha": pin["code_sha"],
            "files": len(selected),
            "documents": documents,
            "bytes": sum(i["source_bytes"] for i in selected),
            "inventory_sha256": pin["inventory_sha256"],
        }
        (args.cache / "verified.json").write_text(json.dumps(result, indent=2) + "\n")
        print(json.dumps(result), flush=True)


if __name__ == "__main__":
    try:
        main()
    except Exception as error:
        # Never echo SQL, HTTP request headers, connection strings or passwords.
        print(
            json.dumps({"event": "runtime_failed", "type": type(error).__name__}),
            flush=True,
        )
        raise SystemExit(1)
