#!/usr/bin/env python3
"""Build the source-locked ISTAT crosswalk of the 2026 Sardinian municipal codes.

From 1 January 2026 ISTAT recoded every Sardinian Comune (L.R. 7/2021,
DGR 36/34 of 9 July 2025). Sources released before the reform (MEF IRPEF,
MIM, ReGiS) still publish the previous code, while SITUAS 2026 and IPA use the
new one. This producer reads the official ISTAT CSV, pinned by bytes and
SHA-256, and writes a compact new-code/previous-code table.

The table is also reconciled with the committed SITUAS geography: each
previous code must exist in the 2025 snapshot and each new code in the 2026
snapshot, with the same municipal tax code. A pair that ISTAT and SITUAS do
not both confirm blocks publication. Names never participate in the join.
"""

from __future__ import annotations

import argparse
import csv
import hashlib
import io
import json
import re
import sys
from pathlib import Path
from typing import Any
from zipfile import BadZipFile, ZipFile

ROOT = Path(__file__).resolve().parents[2]
DEFAULT_SPEC = ROOT / "scripts/etl/specs/istat-sardegna-codici-2026.source.json"
DEFAULT_OUTPUT = ROOT / "src/data/generated/istat-sardegna-codici-2026.json"
DEFAULT_GEOGRAPHY = ROOT / "src/data/generated/istat-municipality-geography.json"
DATASET_ID = "istat-sardegna-codici-2026"
OFFICIAL_PREFIX = "https://www.istat.it/"
SARDINIA_REGION_CODE = "20"
COLUMNS = ["code", "previousCode", "name", "provinceCode", "previousProvinceCode"]
MUNICIPALITY_CODE = re.compile(r"[0-9]{6}\Z")
PROVINCE_CODE = re.compile(r"[0-9]{3}\Z")
SHA256 = re.compile(r"[0-9a-f]{64}\Z")
ISO_DATE = re.compile(r"[0-9]{4}-[0-9]{2}-[0-9]{2}\Z")
PUBLISHED_SOURCE_FIELDS = (
    "owner",
    "title",
    "landingUrl",
    "url",
    "bytes",
    "sha256",
    "csvSha256",
    "licenseId",
    "licenseUrl",
    "legalBasis",
    "effectiveFrom",
    "publishedAt",
    "acquiredAt",
)


class CrosswalkError(ValueError):
    """Schema, provenance or reconciliation drift blocks publication."""


def sha256_bytes(payload: bytes) -> str:
    return hashlib.sha256(payload).hexdigest()


def load_spec(path: Path = DEFAULT_SPEC) -> dict[str, Any]:
    spec = json.loads(path.read_text(encoding="utf-8"))
    if spec.get("schemaVersion") != 1 or spec.get("datasetId") != DATASET_ID:
        raise CrosswalkError("spec: schemaVersion o datasetId inattesi")
    source = spec.get("source")
    if not isinstance(source, dict):
        raise CrosswalkError("spec: blocco source mancante")
    for key in ("url", "landingUrl", "licenseUrl"):
        if not str(source.get(key, "")).startswith(OFFICIAL_PREFIX):
            raise CrosswalkError(f"spec: {key} non ufficiale ISTAT")
    for key in ("sha256", "csvSha256"):
        if not SHA256.match(str(source.get(key, ""))):
            raise CrosswalkError(f"spec: {key} non valido")
    for key in ("effectiveFrom", "publishedAt", "acquiredAt", "checkedAt"):
        if not ISO_DATE.match(str(source.get(key, ""))):
            raise CrosswalkError(f"spec: data {key} non valida")
    if not source["publishedAt"] <= source["acquiredAt"]:
        raise CrosswalkError("spec: publishedAt successiva ad acquiredAt")
    return spec


def verified_csv(spec: dict[str, Any], archive: Path | None = None) -> bytes:
    source = spec["source"]
    path = archive or ROOT / source["path"]
    payload = path.read_bytes()
    if len(payload) != source["bytes"] or sha256_bytes(payload) != source["sha256"]:
        raise CrosswalkError("zip ISTAT: byte o SHA-256 diversi dal source lock")
    try:
        with ZipFile(io.BytesIO(payload)) as archive_file:
            members = [
                info for info in archive_file.infolist()
                if not info.is_dir() and info.filename.lower().endswith(source["csvMemberSuffix"])
            ]
            if len(members) != 1:
                raise CrosswalkError("zip ISTAT: atteso esattamente un file CSV")
            csv_bytes = archive_file.read(members[0])
    except BadZipFile as error:
        raise CrosswalkError("zip ISTAT non leggibile") from error
    if len(csv_bytes) != source["csvBytes"] or sha256_bytes(csv_bytes) != source["csvSha256"]:
        raise CrosswalkError("CSV ISTAT: byte o SHA-256 diversi dal source lock")
    return csv_bytes


def municipality_prefix(province_code: str) -> str:
    """Metropolitan cities add 200 to the progressive used in municipal codes."""
    number = int(province_code)
    return f"{number - 200 if number >= 200 else number:03d}"


def parse_rows(csv_bytes: bytes, spec: dict[str, Any]) -> list[list[str]]:
    source = spec["source"]
    expected = spec["expected"]
    text = csv_bytes.decode(source["csvEncoding"])
    table = list(csv.reader(io.StringIO(text, newline=""), delimiter=source["csvDelimiter"]))
    if len(table) < 2:
        raise CrosswalkError("CSV ISTAT: intestazione mancante")
    title, headers, *body = table
    if title[0] != expected["title"] or any(cell.strip() for cell in title[1:]):
        raise CrosswalkError("CSV ISTAT: titolo inatteso")
    if headers != expected["headers"]:
        raise CrosswalkError("CSV ISTAT: intestazioni inattese")
    rows: list[list[str]] = []
    for index, cells in enumerate(body, start=3):
        if not any(cell.strip() for cell in cells):
            continue
        if len(cells) != len(headers):
            raise CrosswalkError(f"CSV ISTAT riga {index}: {len(cells)} colonne")
        _, province, code, name, previous, previous_province, _ = (cell.strip() for cell in cells)
        if not MUNICIPALITY_CODE.match(code) or not MUNICIPALITY_CODE.match(previous):
            raise CrosswalkError(f"CSV ISTAT riga {index}: codice comunale non valido")
        if not PROVINCE_CODE.match(province) or not PROVINCE_CODE.match(previous_province):
            raise CrosswalkError(f"CSV ISTAT riga {index}: codice provincia non valido")
        if not code.startswith(municipality_prefix(province)):
            raise CrosswalkError(f"CSV ISTAT riga {index}: {code} fuori dalla provincia {province}")
        if not previous.startswith(municipality_prefix(previous_province)):
            raise CrosswalkError(f"CSV ISTAT riga {index}: {previous} fuori dalla provincia {previous_province}")
        if not name:
            raise CrosswalkError(f"CSV ISTAT riga {index}: denominazione vuota")
        rows.append([code, previous, name, province, previous_province])
    validate_rows(rows, spec)
    return sorted(rows)


def validate_rows(rows: list[list[str]], spec: dict[str, Any]) -> None:
    expected = spec["expected"]
    if len(rows) != expected["municipalities"]:
        raise CrosswalkError(f"tabella: {len(rows)} Comuni, attesi {expected['municipalities']}")
    codes = [row[0] for row in rows]
    previous = [row[1] for row in rows]
    if len(set(codes)) != len(codes) or len(set(previous)) != len(previous):
        raise CrosswalkError("tabella: codici duplicati")
    # Shared values would make an alias ambiguous: the same string would name two Comuni.
    if set(codes) & set(previous):
        raise CrosswalkError("tabella: un codice nuovo coincide con un codice precedente")
    if sorted({row[3] for row in rows}) != expected["provinceCodes"]:
        raise CrosswalkError("tabella: province 2026 inattese")
    if sorted({row[4] for row in rows}) != expected["previousProvinceCodes"]:
        raise CrosswalkError("tabella: province precedenti inattese")


def reconcile_with_geography(rows: list[list[str]], geography_path: Path = DEFAULT_GEOGRAPHY) -> None:
    geography = json.loads(geography_path.read_text(encoding="utf-8"))
    columns = geography["columns"]
    code_index, tax_index, region_index = (columns.index(name) for name in ("istatCode", "taxCode", "regionCode"))
    by_year: dict[int, dict[str, list[Any]]] = {}
    for year in geography["years"]:
        if year["year"] in (2025, 2026):
            by_year[year["year"]] = {row[code_index]: row for row in year["rows"]}
    if set(by_year) != {2025, 2026}:
        raise CrosswalkError("geografia SITUAS: mancano gli anni 2025 e 2026")
    for code, previous, *_ in rows:
        before = by_year[2025].get(previous)
        after = by_year[2026].get(code)
        if before is None or after is None:
            raise CrosswalkError(f"geografia SITUAS: coppia {previous}->{code} assente")
        if before[region_index] != SARDINIA_REGION_CODE or after[region_index] != SARDINIA_REGION_CODE:
            raise CrosswalkError(f"geografia SITUAS: {previous}->{code} fuori dalla Sardegna")
        if not before[tax_index] or before[tax_index] != after[tax_index]:
            raise CrosswalkError(f"geografia SITUAS: codice fiscale diverso per {previous}->{code}")
    for year, expected_codes in ((2025, {row[1] for row in rows}), (2026, {row[0] for row in rows})):
        sardinian = {code for code, row in by_year[year].items() if row[region_index] == SARDINIA_REGION_CODE}
        if sardinian != expected_codes:
            raise CrosswalkError(f"geografia SITUAS {year}: Comuni sardi diversi dalla tabella ISTAT")
    # An alias is safe across source vintages only if neither code names another
    # Comune in the other year: sources keyed on either code then mean one place.
    if {row[0] for row in rows} & set(by_year[2025]) or {row[1] for row in rows} & set(by_year[2026]):
        raise CrosswalkError("geografia SITUAS: un codice della tabella identifica un altro Comune nell'altro anno")


def build(spec: dict[str, Any], archive: Path | None = None, geography: Path = DEFAULT_GEOGRAPHY) -> dict[str, Any]:
    rows = parse_rows(verified_csv(spec, archive), spec)
    reconcile_with_geography(rows, geography)
    return {
        "schemaVersion": 1,
        "datasetId": DATASET_ID,
        "source": {key: spec["source"][key] for key in PUBLISHED_SOURCE_FIELDS},
        "columns": COLUMNS,
        "rows": rows,
    }


def serialize(data: dict[str, Any]) -> bytes:
    return (json.dumps(data, ensure_ascii=False, separators=(",", ":")) + "\n").encode("utf-8")


def check(spec_path: Path = DEFAULT_SPEC, output: Path = DEFAULT_OUTPUT) -> None:
    rebuilt = serialize(build(load_spec(spec_path)))
    if not output.exists() or output.read_bytes() != rebuilt:
        raise CrosswalkError(f"{output.relative_to(ROOT)} non coincide con la tabella ISTAT bloccata")


def main() -> int:
    parser = argparse.ArgumentParser(description=__doc__.splitlines()[0])
    mode = parser.add_mutually_exclusive_group(required=True)
    mode.add_argument("--write", action="store_true")
    mode.add_argument("--check", action="store_true")
    args = parser.parse_args()
    try:
        if args.check:
            check()
            print(f"{DATASET_ID}: OK")
            return 0
        DEFAULT_OUTPUT.write_bytes(serialize(build(load_spec())))
        check()
        print(f"{DATASET_ID}: scritto {DEFAULT_OUTPUT.relative_to(ROOT)}")
        return 0
    except CrosswalkError as error:
        print(f"{DATASET_ID}: {error}", file=sys.stderr)
        return 1


if __name__ == "__main__":
    raise SystemExit(main())
