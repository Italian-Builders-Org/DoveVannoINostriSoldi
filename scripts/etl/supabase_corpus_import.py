#!/usr/bin/env python3
"""Import prevalidated public chunks with atomic COPY/checkpoints and readback.

Explicit env path; no credentials in logs, no raw imports, no public grants.
Run supabase_corpus_bulk.py preflight first. All SQL targets DVNS schemas only.
"""
import argparse
import hashlib
import itertools
import json
from pathlib import Path
import sys
import time

from supabase_corpus_bulk import BulkManifest, load_database_url


def canonical_row(row):
    return (
        json.dumps(row, ensure_ascii=False, sort_keys=True, separators=(",", ":"))
        + "\n"
    ).encode("utf-8")


def chunk_batches(chunks, size):
    if not 1 <= size <= 25:
        raise ValueError("batch size must be between 1 and 25 chunks")
    while batch := list(itertools.islice(chunks, size)):
        yield batch


def log(**values):
    print(json.dumps(values, ensure_ascii=False), flush=True)


def verify_readback(conn, manifest, dataset_id):
    receipt = manifest.receipt(dataset_id)
    expected_count = manifest.datasets[dataset_id]["publicRows"]
    digest = hashlib.sha256()
    count = 0
    with conn.transaction():
        # A server-side cursor bounds client memory; ordinals are release-relative.
        with conn.cursor(name="dvns_readback") as cursor:
            cursor.itersize = 25000
            cursor.execute(
                "SELECT ordinal,payload FROM dvns_corpus.rows WHERE snapshot_id=%s AND dataset_id=%s ORDER BY ordinal",
                (manifest.snapshot_id, dataset_id),
            )
            for ordinal, payload in cursor:
                count += 1
                if ordinal != count:
                    raise ValueError("readback ordinal gap")
                digest.update(canonical_row(payload))
        if count != expected_count or digest.hexdigest() != receipt["rowsSha256"]:
            raise ValueError("readback count or digest mismatch")
        conn.execute(
            """INSERT INTO dvns_metadata.imports(snapshot_id,dataset_id,rows_sha256,verified_rows)
                        VALUES (%s,%s,%s,%s) ON CONFLICT (snapshot_id,dataset_id) DO NOTHING""",
            (manifest.snapshot_id, dataset_id, digest.hexdigest(), count),
        )
        stored = conn.execute(
            "SELECT rows_sha256,verified_rows FROM dvns_metadata.imports WHERE snapshot_id=%s AND dataset_id=%s",
            (manifest.snapshot_id, dataset_id),
        ).fetchone()
        if stored != (digest.hexdigest(), count):
            raise ValueError("stored import receipt mismatch")
    return {"dataset": dataset_id, "rows": count, "sha256": digest.hexdigest()}


def import_dataset(
    conn,
    manifest,
    dataset_id,
    batch_chunks=5,
    max_batches=None,
    max_database_bytes=None,
):
    from psycopg.types.json import Jsonb

    started = time.monotonic()
    source = manifest.verify(
        dataset_id
    )  # No dataset writes before its full source preflight.
    remote = conn.execute(
        "SELECT metadata,receipt FROM dvns_metadata.datasets WHERE snapshot_id=%s AND id=%s",
        (manifest.snapshot_id, dataset_id),
    ).fetchone()
    if remote != (manifest.datasets[dataset_id], manifest.receipt(dataset_id)):
        raise ValueError("remote catalog or receipt differs from pinned snapshot")
    checkpoints = {
        r[0]: (r[1], r[2])
        for r in conn.execute(
            "SELECT chunk_index,compressed_sha256,rows_count FROM dvns_metadata.chunks WHERE snapshot_id=%s AND dataset_id=%s",
            (manifest.snapshot_id, dataset_id),
        ).fetchall()
    }
    pending = []
    for chunk in manifest.chunks(dataset_id):
        index = (chunk["first_ordinal"] - 1) // 1000
        if index in checkpoints:
            if checkpoints.pop(index) != (chunk["sha256"], len(chunk["rows"])):
                raise ValueError("checkpoint differs from pinned chunk")
        else:
            pending.append(chunk["path"])
    if checkpoints:
        raise ValueError("extra checkpoint outside snapshot")
    pending = set(pending)
    batches = 0
    chunks = (
        chunk for chunk in manifest.chunks(dataset_id) if chunk["path"] in pending
    )
    for batch in chunk_batches(chunks, batch_chunks):
        if (
            conn.execute(
                "SELECT current_setting('default_transaction_read_only')"
            ).fetchone()[0]
            == "on"
        ):
            raise ValueError("project is read-only; resolve capacity before import")
        if max_database_bytes is not None:
            current_bytes = conn.execute(
                "SELECT pg_database_size(current_database())"
            ).fetchone()[0]
            if current_bytes >= max_database_bytes:
                raise ValueError(
                    "database size budget reached; capacity review required"
                )
        with conn.transaction():
            conn.execute(
                "CREATE TEMP TABLE dvns_import_expected(ordinal bigint primary key,payload jsonb not null) ON COMMIT DROP"
            )
            with conn.cursor().copy(
                "COPY dvns_import_expected(ordinal,payload) FROM STDIN"
            ) as copy:
                for chunk in batch:
                    for ordinal, row in enumerate(
                        chunk["rows"], chunk["first_ordinal"]
                    ):
                        copy.write_row((ordinal, Jsonb(row)))
            conn.execute(
                """INSERT INTO dvns_corpus.rows(snapshot_id,dataset_id,ordinal,payload)
                            SELECT %s,%s,ordinal,payload FROM dvns_import_expected
                            ON CONFLICT (snapshot_id,dataset_id,ordinal) DO NOTHING""",
                (manifest.snapshot_id, dataset_id),
            )
            # Correlated PK lookups avoid hashing/toasting wide JSONB batches to disk.
            mismatch = conn.execute(
                """SELECT EXISTS (
                SELECT 1 FROM dvns_import_expected e
                WHERE e.payload IS DISTINCT FROM (
                    SELECT r.payload FROM dvns_corpus.rows r
                    WHERE r.snapshot_id=%s AND r.dataset_id=%s AND r.ordinal=e.ordinal))""",
                (manifest.snapshot_id, dataset_id),
            ).fetchone()[0]
            if mismatch:
                raise ValueError("batch payload reconciliation failed")
            with conn.cursor() as cursor:
                cursor.executemany(
                    """INSERT INTO dvns_metadata.chunks
                    (snapshot_id,dataset_id,chunk_index,compressed_sha256,rows_count)
                    VALUES (%s,%s,%s,%s,%s)""",
                    [
                        (
                            manifest.snapshot_id,
                            dataset_id,
                            (c["first_ordinal"] - 1) // 1000,
                            c["sha256"],
                            len(c["rows"]),
                        )
                        for c in batch
                    ],
                )
        batches += 1
        log(
            event="batch",
            dataset=dataset_id,
            last_ordinal=batch[-1]["first_ordinal"] + len(batch[-1]["rows"]) - 1,
            expected=source["rows"],
            seconds=round(time.monotonic() - started, 2),
        )
        if max_batches is not None and batches >= max_batches:
            log(
                event="interrupted_for_resume_test", dataset=dataset_id, batches=batches
            )
            return False
    result = verify_readback(conn, manifest, dataset_id)
    log(event="verified", **result, seconds=round(time.monotonic() - started, 2))
    return True


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument(
        "--root", type=Path, default=Path(__file__).resolve().parents[2]
    )
    parser.add_argument("--env-file", type=Path, required=True)
    parser.add_argument("--dataset", action="append")
    parser.add_argument("--batch-chunks", type=int, default=5)
    parser.add_argument("--max-database-bytes", type=int, default=2 * 1024**3)
    parser.add_argument(
        "--max-batches",
        type=int,
        help="Stop after committed batches to verify restart behavior",
    )
    args = parser.parse_args()
    import psycopg

    manifest = BulkManifest(args.root)
    uri = load_database_url(args.env_file)
    selected = args.dataset or [
        d["id"]
        for d in manifest.catalog["datasets"]
        if d["publication"] in ("rows", "source-index") and d["publicRows"] > 0
    ]
    try:
        with psycopg.connect(
            uri,
            connect_timeout=15,
            application_name="dvns-bulk-import",
            autocommit=True,
            prepare_threshold=None,
        ) as conn:
            if not conn.execute(
                "SELECT pg_try_advisory_lock(hashtext('dvns-corpus-import'),0)"
            ).fetchone()[0]:
                raise ValueError("another DVNS importer is active")
            conn.execute("SET statement_timeout = '120s'")
            conn.execute("SET lock_timeout = '5s'")
            snapshot = conn.execute(
                "SELECT release_proof FROM dvns_metadata.snapshots WHERE id=%s",
                (manifest.snapshot_id,),
            ).fetchone()
            if not snapshot or snapshot[0] != json.loads(
                (args.root / "data/source-ledger/release-proof.json").read_bytes()
            ):
                raise ValueError("remote snapshot proof differs")
            if (
                conn.execute(
                    "SELECT current_setting('default_transaction_read_only')"
                ).fetchone()[0]
                == "on"
            ):
                raise ValueError("project is read-only; resolve capacity before import")
            if (
                conn.execute("SELECT pg_database_size(current_database())").fetchone()[
                    0
                ]
                >= args.max_database_bytes
            ):
                raise ValueError(
                    "database size budget reached; capacity review required"
                )
            for dataset_id in selected:
                if not import_dataset(
                    conn,
                    manifest,
                    dataset_id,
                    args.batch_chunks,
                    args.max_batches,
                    args.max_database_bytes,
                ):
                    return 3
            log(
                event="complete",
                datasets=len(selected),
                snapshot_id=manifest.snapshot_id,
                database_bytes=conn.execute(
                    "SELECT pg_database_size(current_database())"
                ).fetchone()[0],
            )
    except Exception as error:
        # Connection errors may include full credentials; only emit safe type/state.
        log(
            event="failed",
            error_type=type(error).__name__,
            sqlstate=getattr(error, "sqlstate", None),
            reason=(
                str(error)
                if isinstance(error, ValueError)
                else (
                    getattr(getattr(error, "diag", None), "message_primary", None)
                    if getattr(error, "sqlstate", None) == "53100"
                    else "Database operation failed; credentials omitted"
                )
            ),
        )
        return 2
    return 0


if __name__ == "__main__":
    sys.exit(main())
