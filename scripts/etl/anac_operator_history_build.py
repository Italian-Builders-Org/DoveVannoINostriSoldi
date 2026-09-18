"""Build reconciled history summaries using the existing ANAC source locks."""

from __future__ import annotations

import argparse
import csv
import gzip
import hashlib
import io
import json
import sqlite3
import zipfile
from contextlib import ExitStack, closing
from datetime import datetime
from pathlib import Path

import anac_operator_awards_index as index
from anac_operator_history import (
    CIG_FIELDS,
    clean_text,
    project_cig,
    summarize_history,
    validate_summary,
)
from anac_operator_history_blocks import write_blocks


ROOT = Path(__file__).resolve().parents[2]


def load_cigs(db: sqlite3.Connection, cache: Path) -> dict[str, int]:
    db.execute("PRAGMA busy_timeout=30000")
    spec = index.load_json(ROOT / "scripts/etl/specs/anac-cig-2007-2025.source.json")
    if db.execute("SELECT COUNT(*) FROM awards").fetchone()[0] > 6_000_000:
        raise index.ContractError("L'universo CIG supera il budget del join in memoria")
    target_cigs = {row[0] for row in db.execute("SELECT DISTINCT cig FROM awards")}
    db.execute(
        "CREATE TABLE procedures(cig TEXT PRIMARY KEY, payload TEXT, authority_cf TEXT, authority_label TEXT)"
    )
    coverage = {"rows": 0, "prevalentRows": 0, "matchedCigs": 0, "conflictingCigs": 0}
    for resource in spec["resources"]:
        path = cache / str(resource["year"]) / resource["fileName"]
        index.assert_locked_input(path, resource, resource["fileName"])
        with zipfile.ZipFile(path) as archive:
            with archive.open(resource["member"]["name"]) as raw:
                reader = csv.DictReader(
                    io.TextIOWrapper(raw, encoding="utf-8-sig"), delimiter=";"
                )
                if not set(CIG_FIELDS).issubset(reader.fieldnames or []):
                    raise index.ContractError(f"Colonne CIG mancanti: {path.name}")
                for row in reader:
                    coverage["rows"] += 1
                    if row["flag_prevalente"].strip() != "1":
                        continue
                    coverage["prevalentRows"] += 1
                    cig = index.base.normalize_cig(row["cig"])
                    if not index.CIG_RE.fullmatch(cig):
                        raise index.ContractError("CIG prevalente non valido")
                    if cig not in target_cigs:
                        continue
                    payload = project_cig(row)
                    if payload["cigYear"] != resource["year"]:
                        raise index.ContractError(
                            f"Anno CIG non allineato al source lock: {cig}"
                        )
                    cf = index.base.normalize_cf(row["cf_amministrazione_appaltante"])
                    if not index.base.valid_entity_cf(cf):
                        cf = None
                    label = clean_text(
                        row["denominazione_amministrazione_appaltante"], 500
                    )
                    encoded = json.dumps(payload, sort_keys=True, separators=(",", ":"))
                    db.execute(
                        """INSERT INTO procedures VALUES (?, ?, ?, ?)
                        ON CONFLICT(cig) DO UPDATE SET
                        payload=CASE WHEN procedures.payload=excluded.payload
                            AND procedures.authority_cf IS excluded.authority_cf THEN procedures.payload ELSE NULL END,
                        authority_cf=CASE WHEN procedures.payload=excluded.payload
                            AND procedures.authority_cf IS excluded.authority_cf THEN procedures.authority_cf ELSE NULL END,
                        authority_label=CASE WHEN procedures.authority_label IS NULL THEN excluded.authority_label
                            WHEN excluded.authority_label IS NULL THEN procedures.authority_label
                            ELSE MIN(procedures.authority_label, excluded.authority_label) END""",
                        (cig, encoded, cf, label),
                    )
        db.commit()
        print(f"CIG verified: {path.name}", flush=True)
    db.execute(
        """CREATE TABLE authorities AS
        SELECT authority_cf, printf('authority-%08d', ROW_NUMBER() OVER (ORDER BY authority_cf)) AS ref,
            MIN(authority_label) AS label
        FROM procedures WHERE payload IS NOT NULL AND authority_cf IS NOT NULL GROUP BY authority_cf"""
    )
    db.execute("CREATE UNIQUE INDEX authorities_cf ON authorities(authority_cf)")
    db.commit()
    coverage["matchedCigs"] = db.execute(
        "SELECT COUNT(*) FROM procedures WHERE payload IS NOT NULL"
    ).fetchone()[0]
    coverage["conflictingCigs"] = db.execute(
        "SELECT COUNT(*) FROM procedures WHERE payload IS NULL"
    ).fetchone()[0]
    return coverage


def operator_procedures(db: sqlite3.Connection, awards: list[dict]) -> dict[str, dict]:
    cigs = sorted({award["cig"] for award in awards})
    result = {}
    for start in range(0, len(cigs), 500):
        batch = cigs[start : start + 500]
        placeholders = ",".join("?" for _ in batch)
        rows = db.execute(
            f"""SELECT p.cig, p.payload, a.ref, a.label FROM procedures p
            LEFT JOIN authorities a ON a.authority_cf=p.authority_cf
            WHERE p.cig IN ({placeholders}) AND p.payload IS NOT NULL""",
            batch,
        )
        for cig, payload, ref, label in rows:
            result[cig] = {
                **json.loads(payload),
                "authorityRef": ref,
                "authorityLabel": label,
            }
    return result


def prepare(
    db: sqlite3.Connection, awards_cache: Path, cig_cache: Path
) -> dict[str, int]:
    source = index.load_json(index.PARENT_SPEC)
    operator_spec = index.load_json(index.DEFAULT_SPEC)
    observed = datetime.fromisoformat(
        operator_spec["observedAt"].replace("Z", "+00:00")
    ).date()
    paths = {}
    for name in ("awards", "awardees"):
        resource = source["inputs"][name]
        path = awards_cache / (
            "aggiudicazioni_csv.zip" if name == "awards" else "aggiudicatari_csv.zip"
        )
        index.assert_locked_input(path, resource, name)
        paths[name] = path
    index.prepare_db(db)
    db.execute("PRAGMA journal_mode=DELETE")
    db.execute("PRAGMA cache_size=-131072")
    source_awards = source["inputs"]["awards"]
    index.load_awards(
        db,
        paths["awards"],
        source_awards["member"]["name"],
        source_awards["encoding"],
        observed,
    )
    source_awardees = source["inputs"]["awardees"]
    index.load_relations(
        db,
        paths["awardees"],
        source_awardees["member"]["name"],
        source_awardees["encoding"],
    )
    index.award_operator_counts(db)
    return load_cigs(db, cig_cache)


def write_summaries(
    db: sqlite3.Connection, output: Path, coverage: dict[str, int]
) -> None:
    if output.exists():
        raise index.ContractError(
            "La destinazione esiste già; usare una directory nuova"
        )
    output.mkdir(parents=True)
    totals = {"operators": 0, "awardRelations": 0}
    with ExitStack() as stack:
        handles = {
            code: stack.enter_context(
                gzip.GzipFile(
                    filename=str(output / f"{code:02x}.jsonl.gz"), mode="wb", mtime=0
                )
            )
            for code in range(256)
        }
        packs = {
            code: stack.enter_context((output / f"{code:02x}.pack").open("wb"))
            for code in range(256)
        }
        for operator in index.build_operator_records(db, award_limit=None):
            procedures = operator_procedures(db, operator["awards"])
            summary = summarize_history(operator, procedures)
            record = {
                key: operator[key]
                for key in (
                    "ref",
                    "name",
                    "nameVariants",
                    "awardCount",
                    "yearMin",
                    "yearMax",
                    "attributedAwardCount",
                    "attributedValue",
                )
            }
            record.update(summary)
            validate_summary(record)
            bucket = int(hashlib.sha256(operator["ref"].encode()).hexdigest()[:2], 16)
            record["detail"] = write_blocks(
                packs[bucket], operator["ref"], operator["awards"], procedures
            )
            handles[bucket].write(index.canonical_line(record))
            totals["operators"] += 1
            totals["awardRelations"] += operator["awardCount"]
    old_meta = index.load_json(index.DEFAULT_OUTPUT / "meta.json")
    for key, value in totals.items():
        if value != old_meta["totals"][key]:
            raise index.ContractError(f"Lo storico non riconcilia il totale {key}")
    manifest = {
        "schemaVersion": 1,
        "dataset": "anac-operator-history",
        "observedAt": old_meta["observedAt"],
        "generatedAt": old_meta["generatedAt"],
        "totals": totals,
        "coverage": coverage,
        "sourceIndexSha256": index.sha256_path(index.DEFAULT_OUTPUT / "meta.json"),
        "sourceCigSpecSha256": index.sha256_path(
            ROOT / "scripts/etl/specs/anac-cig-2007-2025.source.json"
        ),
        "shards": [
            {
                "id": path.name[:2],
                "bytes": path.stat().st_size,
                "sha256": index.sha256_path(path),
            }
            for path in sorted(output.glob("*.jsonl.gz"))
        ],
        "packs": [
            {
                "id": path.name[:2],
                "bytes": path.stat().st_size,
                "sha256": index.sha256_path(path),
            }
            for path in sorted(output.glob("*.pack"))
        ],
    }
    (output / "manifest.json").write_text(json.dumps(manifest, indent=2) + "\n", encoding="utf-8")


def main() -> None:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--awards-cache", type=Path, required=True)
    parser.add_argument("--cig-cache", type=Path, required=True)
    parser.add_argument("--database", type=Path, required=True)
    parser.add_argument("--output", type=Path, required=True)
    args = parser.parse_args()
    if args.database.exists():
        raise index.ContractError("Il database temporaneo esiste già")
    index.ensure_temp_space(args.database.parent)
    with closing(sqlite3.connect(args.database)) as db, db:
        coverage = prepare(db, args.awards_cache, args.cig_cache)
        write_summaries(db, args.output, coverage)


if __name__ == "__main__":
    main()
