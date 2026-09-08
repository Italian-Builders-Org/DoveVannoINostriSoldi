#!/usr/bin/env python3
"""Build the public national ANAC operator awards index.

Reads the hash-pinned full snapshots locked by anac-awardees.source.json.
Operator tax codes are used only inside a temporary SQLite database and are
never written to public shards. Public refs are sequential op-######## values
assigned from the sorted national CF set.
"""

from __future__ import annotations

import argparse
import csv
import gzip
import hashlib
import importlib.util
import io
import json
import re
import shutil
import sqlite3
import sys
import tempfile
import unicodedata
import zipfile
from collections import Counter
from datetime import date, datetime
from decimal import Decimal
from pathlib import Path
from typing import Iterator, Mapping


ROOT = Path(__file__).resolve().parents[2]
DEFAULT_SPEC = ROOT / "scripts" / "etl" / "specs" / "anac-operator-awards-index.source.json"
PARENT_SPEC = ROOT / "scripts" / "etl" / "specs" / "anac-awardees.source.json"
DEFAULT_OUTPUT = ROOT / "src" / "data" / "generated" / "anac-operator-awards-index"
COVERAGE_PATH = ROOT / "scripts" / "etl" / "anac_entity_procurement_coverage.py"

SPEC = importlib.util.spec_from_file_location("anac_entity_procurement_coverage", COVERAGE_PATH)
if SPEC is None or SPEC.loader is None:  # pragma: no cover
    raise RuntimeError("Impossibile caricare anac_entity_procurement_coverage")
base = importlib.util.module_from_spec(SPEC)
sys.modules[SPEC.name] = base
SPEC.loader.exec_module(base)

AWARDEE_HEADERS = (
    "cig", "ruolo", "codice_fiscale", "denominazione", "tipo_soggetto", "id_aggiudicazione",
)
AWARD_HEADERS = (
    "cig", "data_aggiudicazione_definitiva", "esito", "criterio_aggiudicazione",
    "data_comunicazione_esito", "numero_offerte_ammesse", "numero_offerte_escluse",
    "importo_aggiudicazione", "ribasso_aggiudicazione", "num_imprese_offerenti",
    "flag_subappalto", "id_aggiudicazione", "cod_esito", "num_imprese_richiedenti",
    "asta_elettronica", "num_imprese_invitate", "massimo_ribasso", "minimo_ribasso",
    "FLAG_SCOMPUTO", "COD_PRESTAZIONI_COMPRESE", "PRESTAZIONI_COMPRESE",
    "CIG_PROG_ESTERNA", "DATA_INCARICO_PROG", "DATA_CONS_PROG",
    "COD_MODO_RIAGGIUDICAZIONE", "MODO_RIAGGIUDICAZIONE", "FLAG_PROC_ACCELERATA",
    "N_MANIF_INTERESSE",
)
MAX_AWARDS_PUBLISHED = 15
OPERATOR_REF_RE = re.compile(r"^op-[0-9]{8}$")
SEARCH_KEY_RE = re.compile(r"[^0-9A-Z]+")
SHA256_RE = re.compile(r"^[a-f0-9]{64}$")
DECIMAL_RE = re.compile(r"^(?:0|[1-9][0-9]*)(?:\.[0-9]+)?$")
PUBLIC_DATE_RE = re.compile(r"^[0-9]{4}-\d{2}-\d{2}$")
CIG_RE = re.compile(r"^[A-Z0-9]{10}$")
AWARD_ID_RE = re.compile(r"^[0-9]+$")
FALLBACK_NAME = "Denominazione non disponibile nei dati ANAC"
MAX_TEMP_DB_BYTES = 2_000_000_000
MIN_FREE_BYTES = MAX_TEMP_DB_BYTES + 512_000_000


class ContractError(ValueError):
    """Raised when inputs or the published artifact violate the contract."""


def load_json(path: Path) -> dict[str, object]:
    try:
        value = json.loads(path.read_text(encoding="utf-8"))
    except (OSError, json.JSONDecodeError) as exc:
        raise ContractError(f"JSON non valido: {path}") from exc
    if not isinstance(value, dict):
        raise ContractError(f"radice JSON non valida: {path}")
    return value


def sha256_path(path: Path) -> str:
    digest = hashlib.sha256()
    with path.open("rb") as stream:
        for chunk in iter(lambda: stream.read(1024 * 1024), b""):
            digest.update(chunk)
    return digest.hexdigest()


def load_source_spec(path: Path) -> tuple[dict[str, object], str]:
    raw = path.read_bytes()
    try:
        specification = json.loads(raw)
    except json.JSONDecodeError as exc:
        raise ContractError(f"Source spec JSON non valido: {exc}") from exc
    if not isinstance(specification, dict):
        raise ContractError("Source spec non valido")
    return specification, hashlib.sha256(raw).hexdigest()


def normalized_name(value: str) -> str:
    return " ".join(unicodedata.normalize("NFKC", value).strip().split())


def search_key(name: str) -> str:
    return SEARCH_KEY_RE.sub("", unicodedata.normalize("NFKC", name).upper())


def canonical_line(record: Mapping[str, object]) -> bytes:
    return (json.dumps(record, ensure_ascii=False, separators=(",", ":"), sort_keys=True) + "\n").encode("utf-8")


def open_csv_member(path: Path, member_name: str, encoding: str) -> tuple[object, csv.DictReader]:
    if path.suffix.lower() == ".csv":
        handle = path.open("r", encoding=encoding, newline="")
        return handle, csv.DictReader(handle, delimiter=";")
    archive = zipfile.ZipFile(path)
    raw = archive.open(member_name)
    text = io.TextIOWrapper(raw, encoding=encoding, newline="")
    reader = csv.DictReader(text, delimiter=";")
    # Keep archive alive via reader attachment.
    reader._dvns_archive = archive  # type: ignore[attr-defined]
    reader._dvns_raw = raw  # type: ignore[attr-defined]
    return text, reader


def close_csv(handle: object) -> None:
    close = getattr(handle, "close", None)
    if callable(close):
        close()


def assert_headers(reader: csv.DictReader, expected: tuple[str, ...], label: str) -> None:
    if tuple(reader.fieldnames or ()) != expected:
        raise ContractError(f"{label}: header CSV inatteso")


def assert_locked_input(path: Path, locked: Mapping[str, object], label: str) -> None:
    archive_bytes = path.stat().st_size
    archive_sha = sha256_path(path)
    if archive_bytes != int(locked["archiveBytes"]):
        raise ContractError(f"{label}: byte archivio non allineati al source lock")
    if archive_sha != locked["archiveSha256"]:
        raise ContractError(f"{label}: SHA-256 archivio non allineato al source lock")
    member = locked["member"]
    assert isinstance(member, Mapping)
    with zipfile.ZipFile(path) as archive:
        info = archive.getinfo(str(member["name"]))
        if info.file_size != int(member["bytes"]):
            raise ContractError(f"{label}: byte membro CSV non allineati")
        if f"{info.CRC:08x}" != str(member["crc32"]):
            raise ContractError(f"{label}: CRC32 membro non allineato")
        digest = hashlib.sha256()
        with archive.open(info) as stream:
            for chunk in iter(lambda: stream.read(1024 * 1024), b""):
                digest.update(chunk)
        if digest.hexdigest() != member["sha256"]:
            raise ContractError(f"{label}: SHA-256 membro non allineato")


def ensure_temp_space(path: Path) -> None:
    usage = shutil.disk_usage(path)
    if usage.free < MIN_FREE_BYTES:
        raise ContractError("spazio disco insufficiente per il database temporaneo")


def prepare_db(connection: sqlite3.Connection) -> None:
    connection.execute("PRAGMA journal_mode=OFF")
    connection.execute("PRAGMA synchronous=OFF")
    connection.execute("PRAGMA temp_store=FILE")
    connection.execute(
        """
        CREATE TABLE awards (
            cig TEXT NOT NULL,
            award_id TEXT NOT NULL,
            awarded_at TEXT,
            amount TEXT,
            amount_status TEXT NOT NULL,
            PRIMARY KEY (cig, award_id)
        )
        """
    )
    connection.execute(
        """
        CREATE TABLE relations (
            cig TEXT NOT NULL,
            award_id TEXT NOT NULL,
            cf TEXT NOT NULL,
            name TEXT NOT NULL,
            PRIMARY KEY (cig, award_id, cf)
        )
        """
    )
    connection.execute("CREATE INDEX relations_cf_idx ON relations(cf)")


def load_awards(connection: sqlite3.Connection, path: Path, member_name: str, encoding: str, observed: date) -> int:
    handle, reader = open_csv_member(path, member_name, encoding)
    try:
        assert_headers(reader, AWARD_HEADERS, "aggiudicazioni")
        rows = 0
        batch: list[tuple[str, str, str | None, str | None, str]] = []
        for raw in reader:
            rows += 1
            cig = base.normalize_cig(raw.get("cig", ""))
            award_id, award_status = base.parse_award_id(raw.get("id_aggiudicazione", ""))
            if not CIG_RE.fullmatch(cig) or award_status != "known" or award_id is None:
                continue
            date_status, awarded_at = base.parse_date_status(
                raw.get("data_aggiudicazione_definitiva", ""), observed
            )
            if date_status != "valid":
                awarded_at = None
            amount_status, amount, _scale = base.parse_amount(raw.get("importo_aggiudicazione", ""))
            batch.append((cig, award_id, awarded_at, amount, amount_status))
            if len(batch) >= 20_000:
                connection.executemany(
                    "INSERT OR IGNORE INTO awards(cig, award_id, awarded_at, amount, amount_status) "
                    "VALUES (?, ?, ?, ?, ?)",
                    batch,
                )
                batch.clear()
            if rows % 1_000_000 == 0:
                print(f"anac operator index: awards rows={rows}", file=sys.stderr, flush=True)
        if batch:
            connection.executemany(
                "INSERT OR IGNORE INTO awards(cig, award_id, awarded_at, amount, amount_status) "
                "VALUES (?, ?, ?, ?, ?)",
                batch,
            )
        connection.commit()
        return rows
    finally:
        close_csv(handle)


def load_relations(connection: sqlite3.Connection, path: Path, member_name: str, encoding: str) -> Counter[str]:
    handle, reader = open_csv_member(path, member_name, encoding)
    coverage: Counter[str] = Counter()
    try:
        assert_headers(reader, AWARDEE_HEADERS, "aggiudicatari")
        batch: list[tuple[str, str, str, str]] = []
        for raw in reader:
            coverage["rawRows"] += 1
            cig = base.normalize_cig(raw.get("cig", ""))
            award_id, award_status = base.parse_award_id(raw.get("id_aggiudicazione", ""))
            if not CIG_RE.fullmatch(cig) or award_status != "known" or award_id is None:
                coverage["ineligibleKeyRows"] += 1
                continue
            coverage["eligibleKeyRows"] += 1
            cf = base.normalize_cf(raw.get("codice_fiscale", "") or "")
            if not base.valid_entity_cf(cf):
                coverage["unresolvedRows"] += 1
                continue
            assert cf is not None
            name = normalized_name(raw.get("denominazione", "") or "") or FALLBACK_NAME
            batch.append((cig, award_id, cf, name))
            coverage["candidateRows"] += 1
            if len(batch) >= 50_000:
                connection.executemany(
                    "INSERT OR IGNORE INTO relations(cig, award_id, cf, name) VALUES (?, ?, ?, ?)",
                    batch,
                )
                batch.clear()
            if coverage["rawRows"] % 1_000_000 == 0:
                print(
                    f"anac operator index: awardees rows={coverage['rawRows']} candidates={coverage['candidateRows']}",
                    file=sys.stderr,
                    flush=True,
                )
        if batch:
            connection.executemany(
                "INSERT OR IGNORE INTO relations(cig, award_id, cf, name) VALUES (?, ?, ?, ?)",
                batch,
            )
        connection.commit()
        print("anac operator index: pruning unmatched relations", file=sys.stderr, flush=True)
        deleted = connection.execute(
            """
            DELETE FROM relations
            WHERE NOT EXISTS (
                SELECT 1 FROM awards
                WHERE awards.cig = relations.cig AND awards.award_id = relations.award_id
            )
            """
        ).rowcount
        connection.commit()
        coverage["unmatchedRows"] = int(deleted)
        coverage["resolvedRows"] = int(
            connection.execute("SELECT COUNT(*) FROM relations").fetchone()[0]
        )
        return coverage
    finally:
        close_csv(handle)


def award_operator_counts(connection: sqlite3.Connection) -> None:
    connection.execute("DROP TABLE IF EXISTS award_cf_counts")
    connection.execute(
        """
        CREATE TABLE award_cf_counts AS
        SELECT cig, award_id, COUNT(*) AS cf_count
        FROM relations
        GROUP BY cig, award_id
        """
    )
    connection.execute(
        "CREATE INDEX award_cf_counts_idx ON award_cf_counts(cig, award_id)"
    )
    connection.commit()


def most_frequent_name(names: list[str]) -> str:
    counts = Counter(names)
    best = sorted(counts.items(), key=lambda item: (-item[1], item[0]))[0][0]
    return best


def project_operator(
    ref: str,
    rows: list[tuple[object, ...]],
) -> dict[str, object]:
    names = [str(row[2]) for row in rows]
    display = most_frequent_name(names) if names else FALLBACK_NAME
    name_variants = len(set(names))
    awards_by_key: dict[tuple[str, str], dict[str, object]] = {}
    attributed_value = Decimal(0)
    attributed_award_count = 0
    years: list[int] = []
    for cig, award_id, _name, awarded_at, amount, amount_status, cf_count in rows:
        key = (str(cig), str(award_id))
        attribution = "single-operator" if int(cf_count) == 1 else "multipart"
        if key not in awards_by_key:
            awards_by_key[key] = {
                "cig": cig,
                "awardId": award_id,
                "awardedAt": awarded_at,
                "amount": amount,
                "amountStatus": amount_status,
                "attribution": attribution,
            }
            if awarded_at and PUBLIC_DATE_RE.fullmatch(str(awarded_at)):
                years.append(int(str(awarded_at)[:4]))
            if attribution == "single-operator" and amount is not None and amount_status in {
                "positive-exact-cent", "positive-subcent", "zero",
            }:
                attributed_value += Decimal(str(amount))
                attributed_award_count += 1
    award_list = sorted(
        awards_by_key.values(),
        key=lambda item: (
            item["awardedAt"] is None,
            str(item["awardedAt"] or ""),
            str(item["cig"]),
            str(item["awardId"]),
        ),
        reverse=True,
    )
    published = award_list[:MAX_AWARDS_PUBLISHED]
    year_min = min(years) if years else None
    year_max = max(years) if years else None
    return {
        "schemaVersion": 1,
        "ref": ref,
        "name": display,
        "searchKey": search_key(display),
        "nameVariants": name_variants,
        "awardCount": len(awards_by_key),
        "attributedAwardCount": attributed_award_count,
        "attributedValue": format(attributed_value, "f"),
        "yearMin": year_min,
        "yearMax": year_max,
        "awardsPublished": len(published),
        "awardsTruncated": len(award_list) > len(published),
        "awards": published,
    }


def build_operator_records(connection: sqlite3.Connection) -> Iterator[dict[str, object]]:
    cursor = connection.execute(
        """
        SELECT r.cf, r.cig, r.award_id, r.name, a.awarded_at, a.amount, a.amount_status, c.cf_count
        FROM relations r
        JOIN awards a ON a.cig = r.cig AND a.award_id = r.award_id
        JOIN award_cf_counts c ON c.cig = r.cig AND c.award_id = r.award_id
        ORDER BY r.cf, r.cig, r.award_id
        """
    )
    current_cf: str | None = None
    buffer: list[tuple[object, ...]] = []
    index = 0
    for row in cursor:
        cf = str(row[0])
        payload = row[1:]
        if current_cf is None:
            current_cf = cf
        if cf != current_cf:
            index += 1
            yield project_operator(f"op-{index:08d}", buffer)
            if index % 50_000 == 0:
                print(f"anac operator index: projected {index}", file=sys.stderr, flush=True)
            current_cf = cf
            buffer = [payload]
        else:
            buffer.append(payload)
    if current_cf is not None and buffer:
        index += 1
        yield project_operator(f"op-{index:08d}", buffer)
        print(f"anac operator index: projected {index}", file=sys.stderr, flush=True)


def write_artifacts(
    output: Path,
    records: Iterator[dict[str, object]],
    *,
    specification: Mapping[str, object],
    specification_sha: str,
    parent_spec_sha: str,
    parent_inputs: Mapping[str, object],
    coverage: Mapping[str, object],
    award_rows: int,
) -> dict[str, object]:
    if output.exists():
        shutil.rmtree(output)
    operators_dir = output / "operators"
    operators_dir.mkdir(parents=True)
    search_path = output / "search.jsonl.gz"

    handles: dict[str, tuple[object, gzip.GzipFile]] = {}
    shard_counts: Counter[str] = Counter()
    totals = Counter(
        operators=0,
        awards=0,
        attributedAwards=0,
        awardsPublished=0,
        awardsTruncatedOperators=0,
    )
    attributed_value_total = Decimal(0)
    try:
        for code in (f"{value:02x}" for value in range(256)):
            raw = (operators_dir / f"{code}.jsonl.gz").open("wb")
            handles[code] = (raw, gzip.GzipFile(filename="", mode="wb", fileobj=raw, mtime=0))
        with search_path.open("wb") as search_raw:
            search_gz = gzip.GzipFile(filename="", mode="wb", fileobj=search_raw, mtime=0)
            try:
                for record in records:
                    ref = str(record["ref"])
                    bucket = hashlib.sha256(ref.encode("utf-8")).hexdigest()[:2]
                    handles[bucket][1].write(canonical_line(record))
                    shard_counts[bucket] += 1
                    search_gz.write(
                        canonical_line(
                            {
                                "schemaVersion": 1,
                                "ref": ref,
                                "name": record["name"],
                                "searchKey": record["searchKey"],
                                "awardCount": record["awardCount"],
                                "attributedAwardCount": record["attributedAwardCount"],
                                "attributedValue": record["attributedValue"],
                                "yearMin": record["yearMin"],
                                "yearMax": record["yearMax"],
                            }
                        )
                    )
                    totals["operators"] += 1
                    totals["awards"] += int(record["awardCount"])
                    totals["attributedAwards"] += int(record["attributedAwardCount"])
                    totals["awardsPublished"] += int(record["awardsPublished"])
                    if record["awardsTruncated"]:
                        totals["awardsTruncatedOperators"] += 1
                    attributed_value_total += Decimal(str(record["attributedValue"]))
            finally:
                search_gz.close()
    finally:
        for raw, compressed in handles.values():
            compressed.close()
            raw.close()

    shards = []
    for code in (f"{value:02x}" for value in range(256)):
        path = operators_dir / f"{code}.jsonl.gz"
        shards.append(
            {
                "id": code,
                "path": f"src/data/generated/anac-operator-awards-index/operators/{code}.jsonl.gz",
                "bytes": path.stat().st_size,
                "sha256": sha256_path(path),
                "operators": int(shard_counts[code]),
            }
        )

    meta = {
        "schemaVersion": 1,
        "dataset": "anac-operator-awards-index",
        "distributionKind": "sharded-public-operator-index",
        "observedAt": specification["observedAt"],
        "generatedAt": specification["generatedAt"],
        "scope": specification["scope"],
        "contract": specification["contract"],
        "privacy": specification["privacy"],
        "limitations": specification["limitations"],
        "provenance": {
            "parentSpecPath": "scripts/etl/specs/anac-awardees.source.json",
            "parentSpecSha256": parent_spec_sha,
            "inputs": parent_inputs,
            "money": {
                "nature": "award-declared",
                "unit": "EUR",
                "note": "Importo di aggiudicazione dichiarato ANAC; non pagamento.",
            },
            "periodo": {
                "reference": "data_aggiudicazione_definitiva when valid",
                "publication": {
                    "awardeesSourceLastModified": parent_inputs["awardees"]["sourceLastModified"],
                    "awardsSourceLastModified": parent_inputs["awards"]["sourceLastModified"],
                },
                "acquisition": specification["observedAt"],
                "checkedAt": specification["generatedAt"],
            },
        },
        "coverage": {
            "awardRowsRaw": award_rows,
            "awardeeRows": dict(coverage),
            "operatorsWithValidCf": int(totals["operators"]),
        },
        "totals": {
            "operators": int(totals["operators"]),
            "awardRelations": int(totals["awards"]),
            "attributedAwards": int(totals["attributedAwards"]),
            "attributedValue": format(attributed_value_total, "f"),
            "awardsPublished": int(totals["awardsPublished"]),
            "awardsTruncatedOperators": int(totals["awardsTruncatedOperators"]),
        },
        "search": {
            "path": "src/data/generated/anac-operator-awards-index/search.jsonl.gz",
            "bytes": search_path.stat().st_size,
            "sha256": sha256_path(search_path),
            "operators": int(totals["operators"]),
        },
        "shards": shards,
        "sourceSpecSha256": specification_sha,
    }
    (output / "meta.json").write_text(
        json.dumps(meta, ensure_ascii=False, indent=2) + "\n", encoding="utf-8"
    )
    return meta


def validate_meta(
    meta: Mapping[str, object],
    *,
    output: Path,
    specification: Mapping[str, object],
    specification_sha: str,
) -> None:
    if meta.get("dataset") != "anac-operator-awards-index":
        raise ContractError("dataset meta inatteso")
    if meta.get("sourceSpecSha256") != specification_sha:
        raise ContractError("sourceSpecSha256 non allineato")
    privacy = meta.get("privacy")
    if not isinstance(privacy, Mapping):
        raise ContractError("privacy assente")
    if privacy.get("containsOperatorTaxIds") is not False:
        raise ContractError("privacy: CF operatori non ammessi")
    if privacy.get("containsOperatorTaxIdHashes") is not False:
        raise ContractError("privacy: hash CF non ammessi")
    contract = meta.get("contract")
    if not isinstance(contract, Mapping):
        raise ContractError("contract assente")
    if contract.get("maxAwardsPublishedPerOperator") != MAX_AWARDS_PUBLISHED:
        raise ContractError("max awards pubblicato non allineato")
    search = meta.get("search")
    if not isinstance(search, Mapping):
        raise ContractError("search meta assente")
    search_file = output / "search.jsonl.gz"
    if not search_file.exists():
        raise ContractError("search.jsonl.gz assente")
    if int(search["bytes"]) != search_file.stat().st_size:
        raise ContractError("byte search non allineati")
    if search["sha256"] != sha256_path(search_file):
        raise ContractError("SHA-256 search non allineato")
    shards = meta.get("shards")
    if not isinstance(shards, list) or len(shards) != 256:
        raise ContractError("shards non validi")
    for shard in shards:
        if not isinstance(shard, Mapping):
            raise ContractError("shard non valido")
        path = output / "operators" / f"{shard['id']}.jsonl.gz"
        if int(shard["bytes"]) != path.stat().st_size:
            raise ContractError(f"byte shard {shard['id']} non allineati")
        if shard["sha256"] != sha256_path(path):
            raise ContractError(f"SHA-256 shard {shard['id']} non allineato")
    if meta.get("scope") != specification.get("scope"):
        raise ContractError("scope non allineato allo source lock")
    if meta.get("limitations") != specification.get("limitations"):
        raise ContractError("limitations non allineate")


def validate_public_records(output: Path, meta: Mapping[str, object]) -> None:
    search_count = 0
    with gzip.open(output / "search.jsonl.gz", "rt", encoding="utf-8") as stream:
        for line in stream:
            record = json.loads(line)
            if not OPERATOR_REF_RE.fullmatch(str(record.get("ref", ""))):
                raise ContractError("ref search non valido")
            if "codice_fiscale" in record or "taxId" in record:
                raise ContractError("leak CF nello search index")
            search_count += 1
    if search_count != int(meta["totals"]["operators"]):  # type: ignore[index]
        raise ContractError("conteggio search non allineato")

    operators = 0
    for code in (f"{value:02x}" for value in range(256)):
        path = output / "operators" / f"{code}.jsonl.gz"
        with gzip.open(path, "rt", encoding="utf-8") as stream:
            for line in stream:
                record = json.loads(line)
                ref = str(record.get("ref", ""))
                if not OPERATOR_REF_RE.fullmatch(ref):
                    raise ContractError("ref operatore non valido")
                bucket = hashlib.sha256(ref.encode("utf-8")).hexdigest()[:2]
                if bucket != code:
                    raise ContractError(f"operatore {ref} nello shard sbagliato")
                awards = record.get("awards")
                if not isinstance(awards, list) or len(awards) > MAX_AWARDS_PUBLISHED:
                    raise ContractError("lista awards non valida")
                payload = json.dumps(record)
                if "codice_fiscale" in payload or re.search(r'"taxId"', payload):
                    raise ContractError("leak CF nello shard operatori")
                operators += 1
    if operators != int(meta["totals"]["operators"]):  # type: ignore[index]
        raise ContractError("conteggio operatori non allineato")


def generate(
    *,
    awardees_input: Path,
    awards_input: Path,
    output: Path,
    specification: dict[str, object],
    specification_sha: str,
    fixture: bool,
) -> dict[str, object]:
    parent, parent_sha = load_source_spec(PARENT_SPEC)
    inputs = parent["inputs"]
    assert isinstance(inputs, Mapping)
    if not fixture:
        assert_locked_input(awardees_input, inputs["awardees"], "aggiudicatari")  # type: ignore[arg-type]
        assert_locked_input(awards_input, inputs["awards"], "aggiudicazioni")  # type: ignore[arg-type]
        if specification.get("parent") != {
            "path": "scripts/etl/specs/anac-awardees.source.json",
            "sha256": parent_sha,
        }:
            raise ContractError("parent source lock non allineato")

    observed_at = str(specification["observedAt"])
    observed = datetime.fromisoformat(observed_at.replace("Z", "+00:00")).date()
    awardees_member = "aggiudicatari_csv.csv" if awardees_input.suffix.lower() == ".zip" else awardees_input.name
    awards_member = "aggiudicazioni_csv.csv" if awards_input.suffix.lower() == ".zip" else awards_input.name
    if not fixture:
        awardees_member = str(inputs["awardees"]["member"]["name"])  # type: ignore[index]
        awards_member = str(inputs["awards"]["member"]["name"])  # type: ignore[index]
        encoding_awardees = str(inputs["awardees"]["encoding"])  # type: ignore[index]
        encoding_awards = str(inputs["awards"]["encoding"])  # type: ignore[index]
    else:
        encoding_awardees = "utf-8-sig"
        encoding_awards = "utf-8-sig"

    ensure_temp_space(output.parent if output.parent.exists() else ROOT)
    with tempfile.TemporaryDirectory(prefix="anac-operator-index-") as temp_dir:
        db_path = Path(temp_dir) / "index.sqlite"
        connection = sqlite3.connect(db_path)
        try:
            prepare_db(connection)
            print("anac operator index: loading awards", file=sys.stderr, flush=True)
            award_rows = load_awards(connection, awards_input, awards_member, encoding_awards, observed)
            print("anac operator index: loading awardees", file=sys.stderr, flush=True)
            coverage = load_relations(connection, awardees_input, awardees_member, encoding_awardees)
            print("anac operator index: computing award operator counts", file=sys.stderr, flush=True)
            award_operator_counts(connection)
            meta = write_artifacts(
                output,
                build_operator_records(connection),
                specification=specification,
                specification_sha=specification_sha,
                parent_spec_sha=parent_sha,
                parent_inputs={
                    "awardees": {
                        "archiveBytes": inputs["awardees"]["archiveBytes"] if not fixture else awardees_input.stat().st_size,  # type: ignore[index]
                        "archiveSha256": inputs["awardees"]["archiveSha256"] if not fixture else sha256_path(awardees_input),  # type: ignore[index]
                        "resourceUrl": inputs["awardees"]["resourceUrl"] if not fixture else "fixture://awardees",  # type: ignore[index]
                        "sourceLastModified": inputs["awardees"]["sourceLastModified"] if not fixture else None,  # type: ignore[index]
                        "datasetPageUrl": inputs["awardees"]["datasetPageUrl"] if not fixture else None,  # type: ignore[index]
                    },
                    "awards": {
                        "archiveBytes": inputs["awards"]["archiveBytes"] if not fixture else awards_input.stat().st_size,  # type: ignore[index]
                        "archiveSha256": inputs["awards"]["archiveSha256"] if not fixture else sha256_path(awards_input),  # type: ignore[index]
                        "resourceUrl": inputs["awards"]["resourceUrl"] if not fixture else "fixture://awards",  # type: ignore[index]
                        "sourceLastModified": inputs["awards"]["sourceLastModified"] if not fixture else None,  # type: ignore[index]
                        "datasetPageUrl": inputs["awards"]["datasetPageUrl"] if not fixture else None,  # type: ignore[index]
                    },
                },
                coverage=coverage,
                award_rows=award_rows,
            )
        finally:
            connection.close()
    validate_meta(
        meta,
        output=output,
        specification=specification,
        specification_sha=specification_sha,
    )
    validate_public_records(output, meta)
    return meta


def main() -> int:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--awardees-input", type=Path)
    parser.add_argument("--awards-input", type=Path)
    parser.add_argument("--source-spec", type=Path, default=DEFAULT_SPEC)
    parser.add_argument("--output", type=Path, default=DEFAULT_OUTPUT)
    parser.add_argument("--fixture", action="store_true")
    parser.add_argument("--check", action="store_true")
    args = parser.parse_args()
    try:
        specification, specification_sha = load_source_spec(args.source_spec)
        if args.check:
            meta = load_json(args.output / "meta.json")
            validate_meta(
                meta,
                output=args.output,
                specification=specification,
                specification_sha=specification_sha,
            )
            validate_public_records(args.output, meta)
            print(f"PASS {args.output}")
            return 0
        if not args.awardees_input or not args.awards_input:
            parser.error("generation requires --awardees-input and --awards-input")
        meta = generate(
            awardees_input=args.awardees_input,
            awards_input=args.awards_input,
            output=args.output,
            specification=specification,
            specification_sha=specification_sha,
            fixture=args.fixture,
        )
        print(
            f"Wrote {args.output} operators={meta['totals']['operators']} "  # type: ignore[index]
            f"search_bytes={meta['search']['bytes']}",  # type: ignore[index]
            flush=True,
        )
        return 0
    except ContractError as exc:
        print(f"ERROR: {exc}", file=sys.stderr)
        return 1


if __name__ == "__main__":
    raise SystemExit(main())
