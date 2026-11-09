#!/usr/bin/env python3
"""Export pinned corpus metadata/pilot SQL without credentials or network.

Large datasets deliberately require a separate bulk COPY importer. This bounded
export is for bootstrapping and verifying the database boundary, not 8M INSERTs.
"""
import argparse
import gzip
import hashlib
import json
from pathlib import Path

CATALOG = "src/data/generated/integrated/catalog.json"
LEDGER = "data/source-ledger"
MAX_PILOT_ROWS = 1000


def digest(data):
    return hashlib.sha256(data).hexdigest()


def checked(path, expected):
    data = path.read_bytes()
    if digest(data) != expected:
        raise ValueError(f"hash mismatch: {path.name}")
    return data


def release(root):
    proof = json.loads((root / LEDGER / "release-proof.json").read_bytes())
    if proof.get("complete") is not True or proof.get("schemaVersion") != 1:
        raise ValueError("incomplete release")
    return proof


def load_catalog(root):
    proof = release(root)
    return json.loads(checked(root / CATALOG, proof["datasets"]["catalogSha256"]))


def dataset_rows(root, dataset_id):
    catalog = load_catalog(root)
    item = next(d for d in catalog["datasets"] if d["id"] == dataset_id)
    if item["publication"] not in ("rows", "source-index"):
        raise ValueError("publication does not permit public rows")
    count = item["publicRows"]
    if not 0 < count <= MAX_PILOT_ROWS:
        raise ValueError("pilot limit exceeded; use bulk COPY")
    receipt = json.loads(
        checked(
            root / LEDGER / "datasets" / f"{dataset_id}.receipt.json",
            item["receiptSha256"],
        )
    )
    proof = release(root)
    artifacts = json.loads(
        checked(root / LEDGER / "dataset-proof.json", proof["datasets"]["proofSha256"])
    )["artifactSha256"]
    chunks = sorted(
        (root / "src/data/generated/integrated/rows").glob(
            f"{dataset_id}.part-*.jsonl.gz"
        )
    )
    expected_names = sorted(
        p
        for p in artifacts
        if p.startswith(f"src/data/generated/integrated/rows/{dataset_id}.part-")
    )
    if [p.relative_to(root).as_posix() for p in chunks] != expected_names:
        raise ValueError("missing or extra chunk")
    payload = b"".join(
        gzip.decompress(checked(p, artifacts[p.relative_to(root).as_posix()]))
        for p in chunks
    )
    if digest(payload) != receipt["rowsSha256"]:
        raise ValueError("rows hash mismatch")
    rows = [json.loads(line) for line in payload.splitlines()]
    if len(rows) != count or count != receipt["publication"]["publicRows"]:
        raise ValueError("row count mismatch")
    return rows


def literal(value):
    # Standard-conforming SQL strings, including apostrophes in public text.
    return "'" + str(value).replace("'", "''") + "'"


def json_literal(value):
    return (
        literal(json.dumps(value, ensure_ascii=False, separators=(",", ":")))
        + "::jsonb"
    )


def snapshot_id(root):
    return digest((root / LEDGER / "release-proof.json").read_bytes())


def catalog_sql(root, code_sha):
    if len(code_sha) != 40 or any(c not in "0123456789abcdef" for c in code_sha):
        raise ValueError("invalid code SHA")
    catalog = load_catalog(root)
    proof = release(root)
    sid = literal(snapshot_id(root))
    statements = [
        "BEGIN;",
        "SET LOCAL standard_conforming_strings = on;",
        f'INSERT INTO dvns_metadata.snapshots(id,code_sha,catalog_sha256,release_proof) VALUES ({sid},{literal(code_sha)},{literal(proof["datasets"]["catalogSha256"])},{json_literal(proof)}) ON CONFLICT (id) DO NOTHING;',
    ]
    for item in catalog["datasets"]:
        receipt = json.loads(
            checked(
                root / LEDGER / "datasets" / f'{item["id"]}.receipt.json',
                item["receiptSha256"],
            )
        )
        values = [
            sid,
            literal(item["id"]),
            literal(item["title"]),
            literal(item["domain"]),
            literal(item["publication"]),
            str(item["publicRows"]),
            json_literal(item),
            json_literal(receipt),
        ]
        statements.append(
            "INSERT INTO dvns_metadata.datasets(snapshot_id,id,title,domain,publication,expected_public_rows,metadata,receipt) VALUES ("
            + ",".join(values)
            + ") ON CONFLICT (snapshot_id,id) DO NOTHING;"
        )
    statements.append("COMMIT;")
    return "\n".join(statements)


def dataset_sql(root, dataset_id):
    rows = dataset_rows(root, dataset_id)  # Validate every byte before emitting SQL.
    sid, did = literal(snapshot_id(root)), literal(dataset_id)
    item = next(d for d in load_catalog(root)["datasets"] if d["id"] == dataset_id)
    receipt = json.loads(
        checked(
            root / LEDGER / "datasets" / f"{dataset_id}.receipt.json",
            item["receiptSha256"],
        )
    )
    statements = [
        "BEGIN;",
        "SET LOCAL standard_conforming_strings = on;",
        "CREATE TEMP TABLE dvns_import_expected (ordinal bigint primary key, payload jsonb) ON COMMIT DROP;",
    ]
    statements.append(
        "INSERT INTO dvns_import_expected VALUES "
        + ",".join(f"({i},{json_literal(row)})" for i, row in enumerate(rows, 1))
        + ";"
    )
    statements.append(
        f"INSERT INTO dvns_corpus.rows SELECT {sid},{did},ordinal,payload FROM dvns_import_expected ON CONFLICT (snapshot_id,dataset_id,ordinal) DO NOTHING;"
    )
    # Equality in both directions catches changed payloads, extra rows and retries.
    statements.append(
        f"""DO $dvns$ BEGIN
IF EXISTS ((SELECT ordinal,payload FROM dvns_import_expected EXCEPT SELECT ordinal,payload FROM dvns_corpus.rows WHERE snapshot_id={sid} AND dataset_id={did}) UNION ALL (SELECT ordinal,payload FROM dvns_corpus.rows WHERE snapshot_id={sid} AND dataset_id={did} EXCEPT SELECT ordinal,payload FROM dvns_import_expected)) THEN
RAISE EXCEPTION 'DVNS payload reconciliation failed'; END IF;
END $dvns$;"""
    )
    statements.append(
        f'INSERT INTO dvns_metadata.imports(snapshot_id,dataset_id,rows_sha256,verified_rows) VALUES ({sid},{did},{literal(receipt["rowsSha256"])},{len(rows)}) ON CONFLICT (snapshot_id,dataset_id) DO NOTHING;'
    )
    statements.append("COMMIT;")
    return "\n".join(statements)


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument(
        "--root", type=Path, default=Path(__file__).resolve().parents[2]
    )
    parser.add_argument("--code-sha")
    parser.add_argument("--dataset")
    parser.add_argument("--out", type=Path, required=True)
    args = parser.parse_args()
    if not args.dataset and not args.code_sha:
        parser.error("--code-sha is required for catalog export")
    sql = (
        dataset_sql(args.root, args.dataset)
        if args.dataset
        else catalog_sql(args.root, args.code_sha)
    )
    args.out.write_text(sql + "\n", encoding="utf-8")
    print(f"Wrote validated SQL: {args.out.name}")


if __name__ == "__main__":
    main()
