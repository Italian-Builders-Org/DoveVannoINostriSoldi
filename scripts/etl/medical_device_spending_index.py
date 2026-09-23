#!/usr/bin/env python3
"""Build verified search and aggregate views for medical-device spending.

The committed integrated corpus is the only input. A temporary SQLite database
keeps the spending facts off the Python heap; it is never shipped or
used at runtime. Public artifacts contain only derived views and source-row
references bound to the corpus receipts and release proof.
"""
from __future__ import annotations

import argparse
import gzip
import hashlib
import json
import shutil
import sqlite3
import tempfile
import time
import unicodedata
from collections.abc import Iterator
from decimal import Decimal
from pathlib import Path

import integrated_curated_datasets as corpus
import medical_device_spending_profile as source


ROOT = Path(__file__).resolve().parents[2]
OUTPUT = ROOT / "src/data/generated/medical-device-spending-index"
ROWS = ROOT / "src/data/generated/integrated/rows"
PROOF = ROOT / "data/source-ledger/dataset-proof.json"
RECEIPTS = ROOT / "data/source-ledger/datasets"
SOURCE_SPEC = ROOT / "scripts/etl/specs/medical-device-spending-pilot.source.json"
SPENDING = tuple(f"salute-spesa-dispositivi-{year}" for year in range(2018, 2022))
REGISTRY = "salute-dispositivi-bdrdm"
DATASETS = (*SPENDING, REGISTRY)
DETAIL_PREFIXES = 256
MAX_TEMP_DB_BYTES = 3_000_000_000


class IndexError(ValueError):
    """Raised when corpus rows or generated views violate the contract."""


def canonical_line(value: object) -> bytes:
    return corpus.canonical_json(value)


def sha256_path(path: Path) -> str:
    digest = hashlib.sha256()
    with path.open("rb") as handle:
        for block in iter(lambda: handle.read(1024 * 1024), b""):
            digest.update(block)
    return digest.hexdigest()


def normalized_search(*values: str | None) -> str:
    text = " ".join(value or "" for value in values)
    folded = unicodedata.normalize("NFKD", text.upper())
    return "".join(character for character in folded if character.isascii() and character.isalnum())


def euro_to_cents(raw: str) -> int:
    amount = source.parse_source_euros(raw)
    cents = amount * 100
    if cents != cents.to_integral_value():
        raise IndexError("Importo con precisione superiore al centesimo")
    return int(cents)


def cents_to_euro(value: int) -> str:
    return format(Decimal(value) / 100, ".2f")


def load_contract() -> tuple[dict, dict, str]:
    proof = json.loads(PROOF.read_bytes())
    spec_bytes = SOURCE_SPEC.read_bytes()
    spec = source.load_spec(SOURCE_SPEC)
    if not proof.get("complete") or proof.get("schemaVersion") != 1:
        raise IndexError("Prova del corpus incompleta")
    return proof, spec, hashlib.sha256(spec_bytes).hexdigest()


def public_rows(dataset: str, proof: dict) -> Iterator[dict]:
    receipt_path = RECEIPTS / f"{dataset}.receipt.json"
    receipt = json.loads(receipt_path.read_bytes())
    expected_receipt = proof["artifactSha256"].get(receipt_path.relative_to(ROOT).as_posix())
    if expected_receipt != sha256_path(receipt_path) or receipt.get("datasetId") != dataset:
        raise IndexError(f"Ricevuta del corpus non valida: {dataset}")
    rows_digest = hashlib.sha256()
    count = 0
    paths = sorted(ROWS.glob(f"{dataset}.part-*.jsonl.gz"))
    if not paths:
        raise IndexError(f"Partizioni del corpus assenti: {dataset}")
    for path in paths:
        relative = path.relative_to(ROOT).as_posix()
        if proof["artifactSha256"].get(relative) != sha256_path(path):
            raise IndexError(f"Partizione del corpus non valida: {relative}")
        raw = gzip.decompress(path.read_bytes())
        rows_digest.update(raw)
        for line in raw.splitlines():
            count += 1
            row = json.loads(line)
            if row.get("sourceRow") != count or not isinstance(row.get("cells"), dict):
                raise IndexError(f"Ordine o forma delle righe non valida: {dataset}")
            yield row
    if count != receipt["publication"]["publicRows"] or rows_digest.hexdigest() != receipt["rowsSha256"]:
        raise IndexError(f"Riconciliazione delle righe fallita: {dataset}")


def prepare_database(path: Path) -> sqlite3.Connection:
    connection = sqlite3.connect(path)
    connection.executescript(
        """
        PRAGMA journal_mode=OFF;
        PRAGMA synchronous=OFF;
        PRAGMA temp_store=FILE;
        CREATE TABLE devices (
          ref TEXT PRIMARY KEY, prefix TEXT NOT NULL, type TEXT NOT NULL, number TEXT NOT NULL,
          registry_record_id TEXT, name TEXT, catalog TEXT, maker TEXT, role TEXT,
          registry_cnd TEXT, registry_cnd_label TEXT,
          UNIQUE(type, number)
        );
        CREATE TABLE facts (
          ref TEXT NOT NULL, dataset TEXT NOT NULL, source_row INTEGER NOT NULL,
          year INTEGER NOT NULL, region TEXT NOT NULL, company TEXT NOT NULL, company_name TEXT NOT NULL,
          source_cnd TEXT NOT NULL, cents INTEGER NOT NULL, negative INTEGER NOT NULL, zero INTEGER NOT NULL,
          PRIMARY KEY(dataset, source_row)
        );
        CREATE INDEX facts_ref_idx ON facts(ref, year, region, company, source_row);
        CREATE INDEX facts_scope_idx ON facts(year, region, company);
        """
    )
    return connection


def device_ref(kind: str, number: str) -> str:
    return "dm-" + hashlib.sha256(f"{kind}\0{number}".encode()).hexdigest()[:20]


def load_spending(connection: sqlite3.Connection, proof: dict, spec: dict) -> dict[int, dict[str, int]]:
    actual: dict[int, dict[str, int]] = {}
    for dataset in SPENDING:
        year = int(dataset.rsplit("-", 1)[1])
        batch: list[tuple] = []
        devices: dict[tuple[str, str], tuple[str, str, str, str]] = {}
        totals = {"rows": 0, "cents": 0, "negativeRows": 0, "zeroRows": 0}
        for row in public_rows(dataset, proof):
            cells = row["cells"]
            if cells.get("Anno") != str(year):
                raise IndexError(f"Anno divergente: {dataset}")
            kind, number = cells.get("CodTipoDM"), cells.get("NumRep")
            if kind not in {"1", "2"} or not source.DEVICE_NUMBER_RE.fullmatch(number or ""):
                raise IndexError(f"Chiave del fatto non valida: {dataset}:{row['sourceRow']}")
            ref = device_ref(kind, number)
            devices[(kind, number)] = (ref, ref[3:5], kind, number)
            cents = euro_to_cents(cells.get("CostoAcq"))
            batch.append((ref, dataset, row["sourceRow"], year,
                          cells.get("CodRegCommit"), cells.get("CodASL"), cells.get("AziendaSanitaria"),
                          cells.get("CodiceCND"), cents, int(cents < 0), int(cents == 0)))
            totals["rows"] += 1
            totals["cents"] += cents
            totals["negativeRows"] += cents < 0
            totals["zeroRows"] += cents == 0
            if len(batch) == 20_000:
                connection.executemany("INSERT INTO facts VALUES (?,?,?,?,?,?,?,?,?,?,?)", batch)
                batch.clear()
        connection.executemany("INSERT OR IGNORE INTO devices(ref,prefix,type,number) VALUES (?,?,?,?)", devices.values())
        if batch:
            connection.executemany("INSERT INTO facts VALUES (?,?,?,?,?,?,?,?,?,?,?)", batch)
        connection.commit()
        expected = spec["spendingReleases"][str(year)]["expected"]
        if (totals["rows"] != expected["rows"] or cents_to_euro(totals["cents"]) != expected["totalEuroExact"]
                or totals["negativeRows"] != expected["negativeAmounts"]
                or totals["zeroRows"] != expected["zeroAmounts"]):
            raise IndexError(f"Totali della spesa non riconciliati: {year}")
        actual[year] = totals
    return actual


def join_registry(connection: sqlite3.Connection, proof: dict) -> int:
    keys = {(row[0], row[1]) for row in connection.execute("SELECT type,number FROM devices")}
    matched = 0
    updates: list[tuple] = []
    for row in public_rows(REGISTRY, proof):
        cells = row["cells"]
        key = (cells.get("tipologia_dm"), cells.get("progressivo_dm_ass"))
        if key not in keys:
            continue
        updates.append((row["id"], cells.get("denominazione_commerciale"),
                        cells.get("cod_catalogo_fabbr_ass"), cells.get("fabbricante_assemblatore"),
                        "fabbricante" if key[0] == "1" else "assemblatore",
                        cells.get("classificazione_cnd"), cells.get("descrizione_cnd"), key[0], key[1]))
        matched += 1
        if len(updates) == 20_000:
            connection.executemany("""UPDATE devices SET registry_record_id=?,name=?,catalog=?,maker=?,role=?,
                registry_cnd=?,registry_cnd_label=? WHERE type=? AND number=?""", updates)
            updates.clear()
    if updates:
        connection.executemany("""UPDATE devices SET registry_record_id=?,name=?,catalog=?,maker=?,role=?,
            registry_cnd=?,registry_cnd_label=? WHERE type=? AND number=?""", updates)
    connection.commit()
    if matched != connection.execute("SELECT count(*) FROM devices WHERE registry_record_id IS NOT NULL").fetchone()[0]:
        raise IndexError("Join BD/RDM non univoco")
    return matched


def verify_join(connection: sqlite3.Connection, spec: dict) -> None:
    for year in sorted(int(dataset.rsplit("-", 1)[1]) for dataset in SPENDING):
        matched_rows, unresolved_rows, unresolved_cents = connection.execute(
            """SELECT sum(d.registry_record_id IS NOT NULL),sum(d.registry_record_id IS NULL),
               sum(CASE WHEN d.registry_record_id IS NULL THEN f.cents ELSE 0 END)
               FROM facts f JOIN devices d ON d.ref=f.ref WHERE f.year=?""", (year,),
        ).fetchone()
        expected = spec["spendingReleases"][str(year)]["expected"]
        if (matched_rows != expected["matchedRows"] or unresolved_rows != expected["unresolvedRows"]
                or cents_to_euro(unresolved_cents) != expected["unresolvedEuroExact"]):
            raise IndexError(f"Copertura del join non riconciliata: {year}")


def scope_rows(connection: sqlite3.Connection) -> list[dict]:
    scopes: list[dict] = []
    for year, in connection.execute("SELECT DISTINCT year FROM facts ORDER BY year"):
        scopes.append({"key": str(year), "year": year, "region": None, "company": None, "companyName": None})
        for region, in connection.execute("SELECT DISTINCT region FROM facts WHERE year=? ORDER BY region", (year,)):
            scopes.append({"key": f"{year}:{region}", "year": year, "region": region,
                           "company": None, "companyName": None})
            for company, names in connection.execute("""SELECT company,group_concat(DISTINCT hex(company_name)) FROM facts
                    WHERE year=? AND region=? GROUP BY company ORDER BY company""", (year, region)):
                labels = sorted(bytes.fromhex(name).decode("utf-8") for name in names.split(","))
                scopes.append({"key": f"{year}:{region}:{company}", "year": year, "region": region,
                               "company": company, "companyName": labels[0] if len(labels) == 1 else None,
                               "companyNames": labels})
    return scopes


def where_for(scope: dict) -> tuple[str, tuple]:
    if scope["company"] is not None:
        return "f.year=? AND f.region=? AND f.company=?", (scope["year"], scope["region"], scope["company"])
    if scope["region"] is not None:
        return "f.year=? AND f.region=?", (scope["year"], scope["region"])
    return "f.year=?", (scope["year"],)


def aggregate_rows(connection: sqlite3.Connection, scope: dict, field: str) -> list[dict]:
    where, params = where_for(scope)
    if field == "territory":
        if scope["company"] is not None:
            return []
        group = "f.region" if scope["region"] is None else "f.company"
        label = "NULL" if scope["region"] is None else "group_concat(DISTINCT hex(f.company_name))"
        sql = f"""SELECT {group},{label},NULL,count(*),sum(f.cents),sum(f.negative),sum(f.zero),
                  sum(d.registry_record_id IS NOT NULL),sum(d.registry_record_id IS NULL)
                  FROM facts f JOIN devices d ON d.ref=f.ref WHERE {where} GROUP BY {group}"""
    elif field == "cnd":
        sql = f"""SELECT f.source_cnd,NULL,NULL,count(*),sum(f.cents),sum(f.negative),sum(f.zero),
                  sum(d.registry_record_id IS NOT NULL),sum(d.registry_record_id IS NULL)
                  FROM facts f JOIN devices d ON d.ref=f.ref WHERE {where} GROUP BY f.source_cnd"""
    else:
        sql = f"""SELECT NULL,nullif(d.maker,''),nullif(d.role,''),count(*),sum(f.cents),sum(f.negative),sum(f.zero),
                  sum(d.registry_record_id IS NOT NULL),sum(d.registry_record_id IS NULL)
                  FROM facts f JOIN devices d ON d.ref=f.ref WHERE {where}
                  GROUP BY coalesce(d.maker,''),coalesce(d.role,'')"""
    rows = []
    for row in connection.execute(sql, params):
        labels = (sorted(bytes.fromhex(label).decode("utf-8") for label in row[1].split(","))
                  if field == "territory" and row[1] else [])
        rows.append({"code": row[0] or None,
                     "label": labels[0] if len(labels) == 1 else (row[1] or None) if field != "territory" else None,
                     "labels": labels, "role": row[2] or None, "rows": row[3],
                     "spending": cents_to_euro(row[4]), "negativeRows": row[5], "zeroRows": row[6],
                     "matchedRows": row[7], "unresolvedRows": row[8]})
    rows.sort(key=lambda item: (-euro_to_cents(item["spending"].replace(".", ",")), item["label"] or "", item["code"] or ""))
    return rows


def scope_payload(connection: sqlite3.Connection, scope: dict) -> dict:
    where, params = where_for(scope)
    values = connection.execute(f"""SELECT count(*),sum(f.cents),sum(f.negative),sum(f.zero),
        sum(d.registry_record_id IS NOT NULL),sum(CASE WHEN d.registry_record_id IS NOT NULL THEN f.cents ELSE 0 END),
        sum(d.registry_record_id IS NULL),sum(CASE WHEN d.registry_record_id IS NULL THEN f.cents ELSE 0 END)
        FROM facts f JOIN devices d ON d.ref=f.ref WHERE {where}""", params).fetchone()
    coverage = {"rows": values[0], "spending": cents_to_euro(values[1]), "negativeRows": values[2],
                "zeroRows": values[3], "matchedRows": values[4], "matchedSpending": cents_to_euro(values[5]),
                "unresolvedRows": values[6], "unresolvedSpending": cents_to_euro(values[7])}
    return {"schemaVersion": 1, "scope": scope, "coverage": coverage,
            "territories": aggregate_rows(connection, scope, "territory"),
            "classifications": aggregate_rows(connection, scope, "cnd"),
            "manufacturers": aggregate_rows(connection, scope, "maker")}


def write_packed(path: Path, payloads: Iterator[tuple[str, bytes]]) -> tuple[list[dict], int, str]:
    blocks: list[dict] = []
    digest = hashlib.sha256()
    offset = 0
    with path.open("wb") as output:
        for key, raw in payloads:
            compressed = corpus.canonical_gzip(raw)
            output.write(compressed)
            digest.update(compressed)
            blocks.append({"key": key, "offset": offset, "bytes": len(compressed),
                           "rawBytes": len(raw), "sha256": hashlib.sha256(compressed).hexdigest()})
            offset += len(compressed)
    return blocks, offset, digest.hexdigest()


def build_artifacts(connection: sqlite3.Connection, destination: Path, proof: dict, spec: dict,
                    spec_sha: str, yearly: dict[int, dict[str, int]], matched: int,
                    *, show_timings: bool = False) -> None:
    checkpoint = time.perf_counter()

    def report(label: str) -> None:
        nonlocal checkpoint
        now = time.perf_counter()
        if show_timings:
            print(f"[ok] Medical device artifact: {label} ({now - checkpoint:.2f}s)", flush=True)
        checkpoint = now

    destination.mkdir(parents=True)
    scopes = scope_rows(connection)
    scope_ids = {scope["key"]: index for index, scope in enumerate(scopes)}
    report("scope inventory")

    connection.executescript("""
        CREATE TEMP TABLE search_records(ref TEXT PRIMARY KEY, payload TEXT NOT NULL);
    """)

    def store_search_records() -> None:
        sql = """SELECT d.ref,d.type,d.number,d.registry_record_id,d.name,d.catalog,d.maker,d.role,
          d.registry_cnd,d.registry_cnd_label,f.year,f.region,f.company,count(*),sum(f.cents)
          FROM devices d JOIN facts f ON f.ref=d.ref GROUP BY d.ref,f.year,f.region,f.company
          ORDER BY d.ref,f.year,f.region,f.company"""
        current = None
        item = None
        for row in connection.execute(sql):
            if row[0] != current:
                if item is not None:
                    store_search_record(connection, item)
                current = row[0]
                item = {"schemaVersion": 1, "ref": row[0], "type": row[1], "number": row[2],
                        "registryRecordId": row[3], "name": row[4], "catalog": row[5], "manufacturer": row[6],
                        "role": row[7], "classification": row[8], "classificationLabel": row[9],
                        "searchKey": normalized_search(row[2], row[4], row[5], row[6], row[8], row[9]),
                        "scopes": [], "years": {}}
            item["scopes"].append(scope_ids[f"{row[10]}:{row[11]}:{row[12]}"])
            year = str(row[10])
            summary = item["years"].setdefault(year, {"rows": 0, "spending": "0.00"})
            summary["rows"] += row[13]
            summary["spending"] = cents_to_euro(euro_to_cents(summary["spending"].replace(".", ",")) + row[14])
        if item is not None:
            store_search_record(connection, item)
        connection.commit()

    def store_search_record(connection: sqlite3.Connection, item: dict) -> None:
        lightweight = {key: item[key] for key in ("schemaVersion", "ref", "type", "number", "searchKey", "scopes", "years")}
        connection.execute("INSERT INTO search_records VALUES (?,?)", (item["ref"], canonical_line(lightweight).decode("utf-8")))

    store_search_records()
    report("search records")
    search_raw = "".join(row[0] for row in connection.execute("SELECT payload FROM search_records ORDER BY ref")).encode("utf-8")
    search_payload = corpus.canonical_gzip(search_raw)
    (destination / "search.jsonl.gz").write_bytes(search_payload)
    report("search artifact")

    connection.execute("CREATE INDEX devices_prefix_idx ON devices(prefix, ref)")
    report("detail lookup index")

    def detail_payloads() -> Iterator[tuple[str, bytes]]:
        for value in range(DETAIL_PREFIXES):
            prefix = f"{value:02x}"
            lines = []
            sql = """SELECT d.ref,d.type,d.number,d.registry_record_id,d.name,d.catalog,d.maker,d.role,
              d.registry_cnd,d.registry_cnd_label,f.dataset,f.source_row,f.year,f.region,f.company,
              f.company_name,f.source_cnd,f.cents
              FROM devices d JOIN facts f ON f.ref=d.ref WHERE d.prefix=?
              ORDER BY d.ref,f.year,f.region,f.company,f.source_row"""
            current = None
            item = None
            for row in connection.execute(sql, (prefix,)):
                if row[0] != current:
                    if item is not None:
                        lines.append(canonical_line(item))
                    current = row[0]
                    item = {"schemaVersion": 1, "ref": row[0], "type": row[1], "number": row[2],
                            "registryRecordId": row[3], "name": row[4], "catalog": row[5],
                            "manufacturer": row[6], "role": row[7], "classification": row[8],
                            "classificationLabel": row[9], "facts": []}
                item["facts"].append({"datasetId": row[10], "sourceRow": row[11],
                                      "year": row[12], "region": row[13], "company": row[14],
                                      "companyName": row[15], "sourceClassification": row[16],
                                      "spending": cents_to_euro(row[17]),
                                      "joinStatus": "matched" if row[3] is not None else "not_found"})
            if item is not None:
                lines.append(canonical_line(item))
            yield prefix, b"".join(lines)

    detail_blocks, detail_bytes, detail_sha = write_packed(destination / "details.jsonl.gz", detail_payloads())
    report("detail artifact")
    detail_counts = {row[0]: (row[1], row[2]) for row in connection.execute(
        """SELECT d.prefix,count(DISTINCT d.ref),count(*) FROM devices d JOIN facts f ON f.ref=d.ref GROUP BY d.prefix"""
    )}
    detail_blocks = [{**block, "records": detail_counts[block["key"]][0],
                      "facts": detail_counts[block["key"]][1]} for block in detail_blocks]
    scope_blocks, scope_bytes, scope_sha = write_packed(
        destination / "aggregates.json.gz",
        ((scope["key"], corpus.canonical_json(scope_payload(connection, scope))) for scope in scopes),
    )
    report("aggregate artifact")
    device_count = connection.execute("SELECT count(*) FROM devices").fetchone()[0]
    fact_count = connection.execute("SELECT count(*) FROM facts").fetchone()[0]
    receipt_sha = {dataset: sha256_path(RECEIPTS / f"{dataset}.receipt.json") for dataset in DATASETS}
    meta = {
        "schemaVersion": 1, "dataset": "salute-spesa-dispositivi-index",
        "distributionKind": "derived-corpus-search-and-aggregate-index",
        "registrySnapshotDate": spec["registry"]["referenceDate"],
        "sourceSpecSha256": spec_sha, "corpusCatalogSha256": proof["catalogSha256"],
        "sourceReceiptSha256": receipt_sha,
        "coverage": {"devicesWithSpending": device_count, "matchedDevices": matched,
                     "unresolvedDevices": device_count - matched, "facts": fact_count,
                     "years": {str(year): {**values, "spending": cents_to_euro(values["cents"])}
                               for year, values in yearly.items()}},
        "contract": {"money": "integer cents derived from exact source decimals; negative adjustments retained",
                     "deviceKey": ["type", "number"], "companyKey": ["year", "region", "company"],
                     "manufacturerRole": "current BD/RDM snapshot; not supplier, payee or historical attribution",
                     "unresolved": "retained in facts, coverage and aggregate null manufacturer group"},
        "search": {"path": "search.jsonl.gz", "bytes": len(search_payload), "rawBytes": len(search_raw),
                   "sha256": hashlib.sha256(search_payload).hexdigest(), "records": device_count},
        "details": {"path": "details.jsonl.gz", "bytes": detail_bytes, "sha256": detail_sha,
                    "blocks": detail_blocks},
        "aggregates": {"path": "aggregates.json.gz", "bytes": scope_bytes, "sha256": scope_sha,
                       "scopes": [{**scope, **block} for scope, block in zip(scopes, scope_blocks, strict=True)]},
    }
    (destination / "meta.json").write_bytes(corpus.canonical_json(meta))
    report("metadata")


def compare_directories(actual: Path, expected: Path) -> None:
    actual_files = {path.relative_to(actual) for path in actual.rglob("*") if path.is_file()}
    expected_files = {path.relative_to(expected) for path in expected.rglob("*") if path.is_file()}
    if actual_files != expected_files:
        raise IndexError("Inventario dell'indice divergente")
    for relative in sorted(actual_files):
        if (actual / relative).read_bytes() != (expected / relative).read_bytes():
            raise IndexError(f"Indice divergente: {relative}")


def build(destination: Path, *, show_timings: bool = False) -> None:
    def phase(label: str, operation, *args):
        if show_timings:
            print(f"[start] Medical device index: {label}", flush=True)
        started = time.perf_counter()
        try:
            result = operation(*args)
        except Exception:
            if show_timings:
                print(f"[fail] Medical device index: {label} ({time.perf_counter() - started:.2f}s)", flush=True)
            raise
        if show_timings:
            print(f"[ok] Medical device index: {label} ({time.perf_counter() - started:.2f}s)", flush=True)
        return result

    proof, spec, spec_sha = phase("load contract", load_contract)
    if shutil.disk_usage(destination.parent).free < MAX_TEMP_DB_BYTES:
        raise IndexError("Spazio insufficiente per la derivazione dell'indice")
    with tempfile.TemporaryDirectory(prefix=".medical-device-index-", dir=destination.parent) as directory:
        staging = Path(directory)
        connection = phase("prepare database", prepare_database, staging / "index.sqlite")
        try:
            yearly = phase("load spending", load_spending, connection, proof, spec)
            matched = phase("join registry", join_registry, connection, proof)
            phase("verify join", verify_join, connection, spec)
            phase(
                "build artifacts",
                lambda: build_artifacts(
                    connection, staging / "artifact", proof, spec, spec_sha, yearly, matched,
                    show_timings=show_timings,
                ),
            )
            if (staging / "index.sqlite").stat().st_size > MAX_TEMP_DB_BYTES:
                raise IndexError("Database temporaneo oltre il budget dichiarato")
        finally:
            connection.close()
        if destination.exists():
            shutil.rmtree(destination)
        (staging / "artifact").rename(destination)


def main() -> int:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--check", action="store_true")
    args = parser.parse_args()
    if args.check:
        with tempfile.TemporaryDirectory(prefix="medical-device-index-check-") as directory:
            candidate = Path(directory) / "artifact"
            build(candidate, show_timings=True)
            started = time.perf_counter()
            print("[start] Medical device index: compare committed artifacts", flush=True)
            try:
                compare_directories(candidate, OUTPUT)
            except Exception:
                print(f"[fail] Medical device index: compare committed artifacts ({time.perf_counter() - started:.2f}s)", flush=True)
                raise
            print(f"[ok] Medical device index: compare committed artifacts ({time.perf_counter() - started:.2f}s)", flush=True)
    else:
        build(OUTPUT)
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
