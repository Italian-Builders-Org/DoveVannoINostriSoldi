#!/usr/bin/env python3
"""Build the official list of Italian Comuni within 20 km of the Swiss border.

The Italy-Switzerland agreement of 23 December 2020 on cross-border workers
(ratified by law 13 June 2023, no. 83) applies to residents of the Comuni in
Annex B of the mutual agreement of 22 December 2023, in force from 1 January
2024. Many of their residents work in Switzerland and that income does not
reach, or only partly reaches, the IRPEF returns the MEF aggregates by Comune
(issue #869): DVNS flags these Comuni, it does not estimate anything.

Sources, all pinned by bytes and SHA-256 in the spec:

- the XLSX list published by the Swiss Federal Tax Administration (parsed);
- the signed agreement PDF, which the XLSX names as authoritative: it is a
  scan, so a reviewed transcription is committed and must match the XLSX row
  by row;
- the two annexes of Gazzetta Ufficiale no. 236 of 8 October 2024 that quote
  Annex B: every name they list must be on the list.

Names are joined to ISTAT codes only inside the province the list states,
against the 2023 SITUAS registry (the list's vintage); Comuni merged since then
map to their successor only through a declared, registry-checked succession.
"""

from __future__ import annotations

import argparse
import hashlib
import json
import re
import sys
import unicodedata
from pathlib import Path
from typing import Any

ROOT = Path(__file__).resolve().parents[2]
DEFAULT_SPEC = ROOT / "scripts/etl/specs/svizzera-frontalieri-comuni-20km.source.json"
DEFAULT_OUTPUT = ROOT / "src/data/generated/svizzera-frontalieri-comuni-20km.json"
DEFAULT_GEOGRAPHY = ROOT / "src/data/generated/istat-municipality-geography.json"
DATASET_ID = "svizzera-frontalieri-comuni-20km"
COLUMNS = ["istatCode", "name", "provinceCode", "listedAs"]
SHA256 = re.compile(r"[0-9a-f]{64}\Z")
MUNICIPALITY_CODE = re.compile(r"[0-9]{6}\Z")

# Province names as the list writes them, to the ISTAT prefix of their municipal codes.
PROVINCE_PREFIX = {
    "Aosta": "007",
    "Bergamo": "016",
    "Bolzano": "021",
    "Brescia": "017",
    "Como": "013",
    "Lecco": "097",
    "Monza e della Brianza": "108",
    "Sondrio": "014",
    "Trento": "022",
    "Varese": "012",
    "Verbano-Cusio-Ossola": "103",
    "Vercelli": "002",
}


class BorderZoneError(ValueError):
    """Schema, provenance or reconciliation drift blocks publication."""


def sha256_bytes(payload: bytes) -> str:
    return hashlib.sha256(payload).hexdigest()


def fold(value: str) -> str:
    text = unicodedata.normalize("NFKD", value.replace("’", "'"))
    text = "".join(char for char in text if not unicodedata.combining(char))
    return re.sub(r"[^a-z0-9]", "", text.lower())


def load_spec(path: Path = DEFAULT_SPEC) -> dict[str, Any]:
    spec = json.loads(path.read_text(encoding="utf-8"))
    if spec.get("schemaVersion") != 1 or spec.get("datasetId") != DATASET_ID:
        raise BorderZoneError("spec: schemaVersion o datasetId inattesi")
    source = spec["source"]
    authoritative = source["authoritative"]
    for url in (source["url"], source["landingUrl"], authoritative["url"], authoritative["landingUrl"]):
        if not url.startswith("https://www.estv.admin.ch/"):
            raise BorderZoneError(f"spec: URL non ufficiale {url}")
    for check in spec["crossChecks"]:
        if not check["url"].startswith("https://www.gazzettaufficiale.it/"):
            raise BorderZoneError("spec: controllo incrociato non dalla Gazzetta Ufficiale")
        if not SHA256.match(check["sha256"]):
            raise BorderZoneError("spec: hash della Gazzetta Ufficiale non valido")
    if not SHA256.match(source["sha256"]) or not SHA256.match(authoritative["sha256"]):
        raise BorderZoneError("spec: hash della fonte non valido")
    return spec


def read_workbook(spec: dict[str, Any], workbook: Path | None = None) -> list[tuple[int, str, str]]:
    """Rows (number, province, Italian name) of the locked XLSX."""
    from openpyxl import load_workbook

    source = spec["source"]
    path = workbook or ROOT / source["path"]
    payload = path.read_bytes()
    if len(payload) != source["bytes"] or sha256_bytes(payload) != source["sha256"]:
        raise BorderZoneError("XLSX AFC: byte o SHA-256 diversi dal source lock")
    sheet = load_workbook(path, read_only=True, data_only=True)[source["sheet"]]
    rows: list[tuple[int, str, str]] = []
    headers_seen = False
    for values in sheet.iter_rows(values_only=True):
        cells = list(values)
        if cells[1:8] == source["headers"]:
            headers_seen = True
            continue
        if not isinstance(cells[0], int):
            continue
        number, _cap, italian, _german, _french, province, _region, validity = cells[:8]
        if validity != source["validity"]:
            raise BorderZoneError(f"XLSX riga {number}: validità {validity} inattesa")
        if province not in PROVINCE_PREFIX:
            raise BorderZoneError(f"XLSX riga {number}: provincia {province!r} sconosciuta")
        rows.append((number, province, str(italian).strip()))
    if not headers_seen:
        raise BorderZoneError("XLSX AFC: intestazioni inattese")
    if [row[0] for row in rows] != list(range(1, spec["expected"]["rows"] + 1)):
        raise BorderZoneError(f"XLSX AFC: righe {len(rows)}, numerazione non continua")
    return rows


def read_transcription(spec: dict[str, Any]) -> list[tuple[int, str, str]]:
    path = ROOT / spec["source"]["authoritative"]["transcription"]["path"]
    lines = path.read_text(encoding="utf-8").splitlines()
    if lines[0] != "n\tprovincia\tcomune":
        raise BorderZoneError("trascrizione: intestazione inattesa")
    rows = []
    for line in lines[1:]:
        number, province, name = line.split("\t")
        rows.append((int(number), province, name))
    return rows


def reconcile_transcription(
    workbook: list[tuple[int, str, str]], transcription: list[tuple[int, str, str]], spec: dict[str, Any]
) -> None:
    """The XLSX must say what the signed PDF says, row by row."""
    corrections = {key: value["name"] for key, value in spec["sourceNameCorrections"].items()}
    if len(workbook) != len(transcription):
        raise BorderZoneError("trascrizione del PDF e XLSX hanno un numero di righe diverso")
    for (number, province, name), (t_number, t_province, t_name) in zip(workbook, transcription):
        printed = corrections.get(t_name, t_name)
        if number != t_number or province != t_province or fold(name) != fold(printed):
            raise BorderZoneError(f"riga {number}: XLSX {name!r} ({province}) e PDF {t_name!r} ({t_province}) diversi")


def geography_years(path: Path, years: tuple[int, int]) -> dict[int, dict[str, list[Any]]]:
    geography = json.loads(path.read_text(encoding="utf-8"))
    found = {year["year"]: year["rows"] for year in geography["years"] if year["year"] in years}
    if set(found) != set(years):
        raise BorderZoneError(f"geografia SITUAS: mancano gli anni {years}")
    columns = geography["columns"]
    code_index = columns.index("istatCode")
    return {year: {row[code_index]: dict(zip(columns, row)) for row in rows} for year, rows in found.items()}


def resolve_codes(rows: list[tuple[int, str, str]], spec: dict[str, Any], geography: Path) -> list[tuple[int, str, str, str]]:
    """(number, listed name, listed-year code, current code) for every row."""
    listed_year, current_year = spec["geographyYear"]["listed"], spec["geographyYear"]["current"]
    years = geography_years(geography, (listed_year, current_year))
    index: dict[tuple[str, str], set[str]] = {}
    for code, record in years[listed_year].items():
        for variant in {record["name"], *record["name"].split("/")}:
            index.setdefault((code[:3], fold(variant)), set()).add(code)
    successors = spec["successors"]
    resolved = []
    for number, province, name in rows:
        codes = index.get((PROVINCE_PREFIX[province], fold(name)), set())
        if len(codes) != 1:
            raise BorderZoneError(f"riga {number}: {name!r} ({province}) non identifica un solo Comune ISTAT {listed_year}")
        code = codes.pop()
        if code in years[current_year]:
            if code in successors:
                raise BorderZoneError(f"riga {number}: successione dichiarata per un Comune ancora esistente")
            current = code
        else:
            successor = successors.get(code)
            if successor is None:
                raise BorderZoneError(f"riga {number}: {name} ({code}) non esiste nel {current_year} e manca la successione")
            current = successor["code"]
            if current not in years[current_year] or current[:3] != code[:3]:
                raise BorderZoneError(f"riga {number}: successore {current} non valido")
        resolved.append((number, name, code, current))
    return resolved


def check_gazzetta(rows: list[tuple[int, str, str]], spec: dict[str, Any]) -> None:
    listed = {fold(name) for _, _, name in rows}
    for check in spec["crossChecks"]:
        missing = [name for name in check["names"] if fold(name) not in listed]
        if missing:
            raise BorderZoneError(f"Gazzetta Ufficiale: {missing} assenti dall'elenco")
        complete = check.get("complete")
        if complete:
            prefixes = set(complete["provinces"])
            in_list = sorted(fold(name) for _, province, name in rows if PROVINCE_PREFIX[province] in prefixes)
            if in_list != sorted(fold(name) for name in check["names"]):
                raise BorderZoneError("Gazzetta Ufficiale: elenco di provincia diverso dall'Allegato B")


def build(spec: dict[str, Any], workbook: Path | None = None, geography: Path = DEFAULT_GEOGRAPHY) -> dict[str, Any]:
    rows = read_workbook(spec, workbook)
    reconcile_transcription(rows, read_transcription(spec), spec)
    check_gazzetta(rows, spec)
    resolved = resolve_codes(rows, spec, geography)
    current_names = geography_years(geography, (spec["geographyYear"]["current"],))[spec["geographyYear"]["current"]]
    by_code: dict[str, list[str]] = {}
    for _, name, _, current in resolved:
        by_code.setdefault(current, []).append(name)
    used_successors = {code: spec["successors"][code]["code"] for _, _, code, current in resolved if code != current}
    if used_successors.keys() != spec["successors"].keys():
        raise BorderZoneError("spec: successioni dichiarate ma non usate")
    output_rows = [
        [code, current_names[code]["name"], code[:3], " | ".join(sorted(names))]
        for code, names in sorted(by_code.items())
    ]
    expected = spec["expected"]
    if len(output_rows) != expected["municipalities"]:
        raise BorderZoneError(f"Comuni attuali {len(output_rows)}, attesi {expected['municipalities']}")
    counts: dict[str, int] = {}
    for _, province, _ in rows:
        counts[PROVINCE_PREFIX[province]] = counts.get(PROVINCE_PREFIX[province], 0) + 1
    if counts != expected["provinces"]:
        raise BorderZoneError(f"righe per provincia {counts} diverse dall'atteso")
    source = spec["source"]
    authoritative = source["authoritative"]
    return {
        "schemaVersion": 1,
        "datasetId": DATASET_ID,
        "source": {
            "owner": source["owner"],
            "title": source["title"],
            "url": source["url"],
            "landingUrl": source["landingUrl"],
            "sha256": source["sha256"],
            "publishedAt": source["publishedAt"],
            "acquiredAt": source["acquiredAt"],
            "licenseId": source["licenseId"],
            "authoritativeTitle": authoritative["title"],
            "authoritativeUrl": authoritative["url"],
            "authoritativeSha256": authoritative["sha256"],
            "signedAt": authoritative["signedAt"],
            "effectiveFrom": authoritative["effectiveFrom"],
            "legalBasis": authoritative["legalBasis"],
        },
        "listedRows": len(rows),
        "previousCodes": dict(sorted(used_successors.items())),
        "columns": COLUMNS,
        "rows": output_rows,
    }


def serialize(data: dict[str, Any]) -> bytes:
    return (json.dumps(data, ensure_ascii=False, separators=(",", ":")) + "\n").encode("utf-8")


def check(spec_path: Path = DEFAULT_SPEC, output: Path = DEFAULT_OUTPUT) -> None:
    rebuilt = serialize(build(load_spec(spec_path)))
    if not output.exists() or output.read_bytes() != rebuilt:
        raise BorderZoneError(f"{output.relative_to(ROOT)} non coincide con le fonti bloccate")


def main() -> int:
    parser = argparse.ArgumentParser(description=__doc__.splitlines()[0])
    mode = parser.add_mutually_exclusive_group(required=True)
    mode.add_argument("--write", action="store_true")
    mode.add_argument("--check", action="store_true")
    args = parser.parse_args()
    try:
        if args.write:
            DEFAULT_OUTPUT.write_bytes(serialize(build(load_spec())))
        check()
        print(f"{DATASET_ID}: OK")
        return 0
    except BorderZoneError as error:
        print(f"{DATASET_ID}: {error}", file=sys.stderr)
        return 1


if __name__ == "__main__":
    raise SystemExit(main())
