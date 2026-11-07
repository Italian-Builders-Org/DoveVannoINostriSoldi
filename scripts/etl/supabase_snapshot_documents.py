#!/usr/bin/env python3
"""Inventory generated files and import faithful JSON documents, privately.

Compressed derived files are inventoried only. No binary archive is silently
expanded into facts. Original JSON text goes to PostgreSQL without float casts.
"""
import argparse
from decimal import Decimal
import fnmatch
import hashlib
import json
from pathlib import Path
import sys

from supabase_corpus_bulk import load_database_url


def parse_document(payload):
    def invalid_constant(_):
        raise ValueError("non-finite JSON number")

    def unique_object(pairs):
        result = {}
        for key, value in pairs:
            if key in result:
                raise ValueError("duplicate JSON object key")
            result[key] = value
        return result

    return json.loads(
        payload,
        parse_float=Decimal,
        parse_constant=invalid_constant,
        object_pairs_hook=unique_object,
    )


def file_inventory(root, registry):
    files = []
    for prefix in registry["generatedDataRoots"]:
        for path in sorted((root / prefix).rglob("*")):
            if path.is_symlink():
                raise ValueError("symlink not allowed in snapshot inventory")
            if not path.is_file():
                continue
            relative = path.relative_to(root).as_posix()
            groups = []
            for artifact in registry["artifacts"]:
                if any(
                    relative == name
                    or relative.startswith(name + "/")
                    or fnmatch.fnmatchcase(relative, name)
                    for name in artifact["files"]
                ):
                    groups.append(artifact["id"])
            excluded = any(item["path"] == relative for item in registry["exclusions"])
            if not groups and not excluded:
                raise ValueError("generated file missing from registry: " + relative)
            digest = hashlib.sha256()
            with path.open("rb") as handle:
                while block := handle.read(1024 * 1024):
                    digest.update(block)
            disposition = (
                "json-document"
                if path.suffix == ".json"
                else (
                    "corpus-chunk"
                    if relative.startswith("src/data/generated/integrated/rows/")
                    else "manifest-only"
                )
            )
            files.append(
                {
                    "path": relative,
                    "groups": sorted(groups),
                    "source_bytes": path.stat().st_size,
                    "source_sha256": digest.hexdigest(),
                    "disposition": disposition,
                }
            )
    return sorted(files, key=lambda item: item["path"])


def document_inventory(root, registry):
    return [
        item
        for item in file_inventory(root, registry)
        if item["disposition"] == "json-document"
    ]


def import_documents(conn, root, registry_payload, inventory, code_sha):
    from psycopg.types.json import Jsonb, set_json_loads

    set_json_loads(parse_document, conn)
    registry = parse_document(registry_payload)
    with conn.transaction():
        conn.execute(
            "INSERT INTO dvns_snapshots.registries VALUES (%s,%s,%s) ON CONFLICT (code_sha) DO NOTHING",
            (
                code_sha,
                hashlib.sha256(registry_payload).hexdigest(),
                Jsonb(registry_payload.decode(), dumps=lambda s: s),
            ),
        )
        stored = conn.execute(
            "SELECT registry_sha256,payload FROM dvns_snapshots.registries WHERE code_sha=%s",
            (code_sha,),
        ).fetchone()
        if stored != (hashlib.sha256(registry_payload).hexdigest(), registry):
            raise ValueError("registry mismatch")
        conn.execute(
            "CREATE TEMP TABLE dvns_expected_files (LIKE dvns_snapshots.files INCLUDING DEFAULTS) ON COMMIT DROP"
        )
        with conn.cursor().copy("COPY dvns_expected_files FROM STDIN") as copy:
            for item in inventory:
                copy.write_row(
                    (
                        code_sha,
                        item["path"],
                        item["source_sha256"],
                        item["source_bytes"],
                        item["groups"],
                        item["disposition"],
                    )
                )
        conn.execute(
            "INSERT INTO dvns_snapshots.files SELECT * FROM dvns_expected_files ON CONFLICT (code_sha,path) DO NOTHING"
        )
        if conn.execute(
            """SELECT EXISTS((SELECT * FROM dvns_expected_files EXCEPT SELECT * FROM dvns_snapshots.files WHERE code_sha=%s)
                            UNION ALL (SELECT * FROM dvns_snapshots.files WHERE code_sha=%s EXCEPT SELECT * FROM dvns_expected_files))""",
            (code_sha, code_sha),
        ).fetchone()[0]:
            raise ValueError("file inventory mismatch")
    count = 0
    for item in inventory:
        if item["disposition"] != "json-document":
            continue
        payload = (root / item["path"]).read_bytes()
        if hashlib.sha256(payload).hexdigest() != item["source_sha256"]:
            raise ValueError("document changed during import")
        expected = parse_document(payload)
        with conn.transaction():
            conn.execute(
                "INSERT INTO dvns_snapshots.documents(code_sha,path,payload) VALUES (%s,%s,%s) ON CONFLICT (code_sha,path) DO NOTHING",
                (
                    code_sha,
                    item["path"],
                    Jsonb(payload.decode("utf-8"), dumps=lambda s: s),
                ),
            )
            actual = conn.execute(
                "SELECT payload FROM dvns_snapshots.documents WHERE code_sha=%s AND path=%s",
                (code_sha, item["path"]),
            ).fetchone()[0]
            if actual != expected:
                raise ValueError("document readback mismatch")
        count += 1
        print(
            json.dumps(
                {
                    "event": "document_verified",
                    "path": item["path"],
                    "source_sha256": item["source_sha256"],
                    "documents": count,
                }
            ),
            flush=True,
        )
    return count


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument(
        "--root", type=Path, default=Path(__file__).resolve().parents[2]
    )
    parser.add_argument("--code-sha", required=True)
    parser.add_argument("--env-file", type=Path)
    args = parser.parse_args()
    if len(args.code_sha) != 40 or any(
        c not in "0123456789abcdef" for c in args.code_sha
    ):
        parser.error("invalid code SHA")
    registry_payload = (args.root / "scripts/ci/generated-artifacts.json").read_bytes()
    registry = json.loads(registry_payload)
    inventory = file_inventory(args.root, registry)
    for item in inventory:
        if item["disposition"] == "json-document":
            parse_document((args.root / item["path"]).read_bytes())
    summary = {
        "event": "inventory",
        "files": len(inventory),
        "documents": sum(i["disposition"] == "json-document" for i in inventory),
        "manifest_only_files": sum(
            i["disposition"] == "manifest-only" for i in inventory
        ),
        "source_bytes": sum(i["source_bytes"] for i in inventory),
    }
    print(json.dumps(summary), flush=True)
    if args.env_file:
        import psycopg

        try:
            with psycopg.connect(
                load_database_url(args.env_file),
                autocommit=True,
                connect_timeout=15,
                prepare_threshold=None,
            ) as conn:
                if not conn.execute(
                    "SELECT pg_try_advisory_lock(hashtext('dvns-corpus-import'),0)"
                ).fetchone()[0]:
                    raise ValueError("another DVNS importer is active")
                conn.execute("SET statement_timeout='120s'")
                count = import_documents(
                    conn, args.root, registry_payload, inventory, args.code_sha
                )
                print(
                    json.dumps(
                        {
                            "event": "documents_complete",
                            "documents": count,
                            "code_sha": args.code_sha,
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
                        "reason": (
                            str(error)
                            if isinstance(error, ValueError)
                            else "Database failure; credentials omitted"
                        ),
                    }
                ),
                flush=True,
            )
            return 2
    return 0


if __name__ == "__main__":
    sys.exit(main())
