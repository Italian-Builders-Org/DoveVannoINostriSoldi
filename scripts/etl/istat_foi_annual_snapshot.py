#!/usr/bin/env python3
"""Build the source-locked ISTAT FOI annual series 1996-2025, spliced to base 2025.

Used to turn nominal amounts into real ones with the index Italian law uses for
revaluations (issue #825). Inputs: the three per-base annual SDMX-CSV responses
and ISTAT's splicing-coefficient workbook, pinned by URL, bytes and SHA-256 in
the source spec; --check stays offline.
"""
from __future__ import annotations

import argparse
import csv
import io
import json
import re
import sys
from decimal import ROUND_HALF_UP, Decimal, InvalidOperation
from pathlib import Path
from typing import Any
from zipfile import BadZipFile, ZipFile

import integrated_curated_datasets as corpus
from istat_bes_snapshot import sha256_bytes

ROOT = Path(__file__).resolve().parents[2]
DEFAULT_SPEC = ROOT / "scripts/etl/specs/istat-foi-annuale.source.json"
DEFAULT_DATA = ROOT / "src/data/generated/istat-foi-annuale.json"
DATASET_ID = "istat-foi-annuale"
BASE_ASSETS = ("base-1995", "base-2010", "base-2015")
SDMX_PREFIX = "https://esploradati.istat.it/SDMXWS/rest/data/IT1,"
NS = "{http://schemas.openxmlformats.org/spreadsheetml/2006/main}"
REL_ID = "{http://schemas.openxmlformats.org/officeDocument/2006/relationships}id"
WORKBOOK_SHEET = "IT"
# The workbook spells the no-tobacco code in lower case.
WORKBOOK_CODES = {"00": "00", "00ST": "00st"}
COEFFICIENT_COLUMNS = ("D", "E", "F")

CAVEATS = (
    "FOI: indice dei prezzi al consumo per le famiglie di operai e impiegati, media annua. È l'indice delle rivalutazioni di legge; non è spesa pubblica.",
    "Ogni anno conserva il valore pubblicato nella propria base (1995, 2010 o 2015). La serie in base 2025 è derivata dividendo per i coefficienti di raccordo ufficiali ISTAT e arrotondando al centesimo.",
    "Il FOI senza tabacchi è la variante usata per adeguare canoni e assegni; il FOI generale include i tabacchi.",
    "FOI, NIC e IPCA sono indici diversi per popolazione di riferimento e finalità.",
)


class SnapshotError(ValueError):
    pass


def require(condition: object, message: str) -> None:
    if not condition:
        raise SnapshotError(message)


def load_spec(path: Path) -> dict[str, Any]:
    try:
        spec = json.loads(path.read_text(encoding="utf-8"))
    except (OSError, json.JSONDecodeError) as error:
        raise SnapshotError(f"source lock illeggibile: {error}") from error
    require(spec.get("schemaVersion") == 1 and spec.get("datasetId") == DATASET_ID, "source lock: identità inattesa")
    require(spec.get("series") == {"00": "foi", "00ST": "foiNoTobacco"}, "source lock: serie inattese")
    assets = (spec.get("source") or {}).get("assets") or {}
    require(set(assets) == {*BASE_ASSETS, "raccordo"}, "source lock: set asset inatteso")
    for name in BASE_ASSETS:
        require(str(assets[name].get("url", "")).startswith(SDMX_PREFIX + assets[name].get("dataflowId", "?") + ","), f"source lock: URL {name} non ufficiale")
    require(str(assets["raccordo"].get("url", "")).startswith("https://esploradati.istat.it/databrowser/DWL/"), "source lock: URL raccordo non ufficiale")
    for name, asset in assets.items():
        digest = str(asset.get("sha256", ""))
        require(type(asset.get("bytes")) is int and asset["bytes"] > 0 and len(digest) == 64 and not set(digest) - set("0123456789abcdef"), f"source lock: byte o sha256 non validi per {name}")
    years = [year for name in BASE_ASSETS for year in range(assets[name]["from"], assets[name]["to"] + 1)]
    require(years == list(range(spec["period"]["from"], spec["period"]["to"] + 1)), "source lock: le basi non coprono il periodo senza buchi")
    return spec


def scaled(text: str | None, scale: int, where: str) -> int:
    try:
        value = Decimal(str(text)) * scale
    except InvalidOperation as error:
        raise SnapshotError(f"{where}: valore non numerico {text!r}") from error
    exact = value.quantize(Decimal(1), rounding=ROUND_HALF_UP)
    # Excel stores 1.074 as 1.0740000000000001: tolerate binary noise, not real digits.
    require(abs(value - exact) < Decimal("1e-9"), f"{where}: precisione {text!r} oltre quella pubblicata")
    return int(exact)


def base_values(payload: bytes, name: str, spec: dict[str, Any]) -> dict[tuple[str, int], int]:
    asset = spec["source"]["assets"][name]
    reader = csv.DictReader(io.StringIO(payload.decode("utf-8-sig"), newline=""))
    coicop = [field for field in reader.fieldnames or [] if field.endswith("COICOP_REV_ISTAT") and not field.startswith("NOTE_")]
    require(len(coicop) == 1, f"{name}: colonna COICOP assente o ambigua")
    values: dict[tuple[str, int], int] = {}
    for row in reader:
        where = f"{name} {row.get(coicop[0])}/{row.get('TIME_PERIOD')}"
        require(row["DATAFLOW"] == f"IT1:{asset['dataflowId']}(1.0)", f"{where}: dataflow inatteso")
        require((row["FREQ"], row["REF_AREA"], row["DATA_TYPE"], row["MEASURE"]) == ("A", "IT", asset["dataType"], "4"), f"{where}: riga fuori chiave")
        require(row[coicop[0]] in spec["series"], f"{where}: serie inattesa")
        require(not row["OBS_STATUS"], f"{where}: flag inatteso {row['OBS_STATUS']!r}")
        key = (row[coicop[0]], int(row["TIME_PERIOD"]))
        require(key not in values, f"{where}: riga duplicata")
        values[key] = scaled(row["OBS_VALUE"], 10, where)
    expected = {(code, year) for code in spec["series"] for year in range(asset["from"], asset["to"] + 1)}
    require(set(values) == expected, f"{name}: anni o serie diversi dall'atteso")
    return values


def workbook_cells(payload: bytes) -> dict[str, str | None]:
    try:
        with ZipFile(io.BytesIO(payload)) as archive:
            def xml(member: str):
                return corpus.safe_xml(archive.read(member), DATASET_ID, member)

            strings = ["".join(node.text or "" for node in item.iter(NS + "t")) for item in xml("xl/sharedStrings.xml")]
            targets = {item.get("Id"): item.get("Target") for item in xml("xl/_rels/workbook.xml.rels")}
            sheets = [sheet for sheet in xml("xl/workbook.xml").iter(NS + "sheet") if sheet.get("name") == WORKBOOK_SHEET]
            require(len(sheets) == 1, f"raccordo: foglio {WORKBOOK_SHEET} assente o duplicato")
            target = re.sub(r"^/?(xl/)?", "", str(targets.get(sheets[0].get(REL_ID), "")))
            require(re.fullmatch(r"worksheets/sheet\d+\.xml", target), "raccordo: percorso foglio inatteso")
            cells: dict[str, str | None] = {}
            for cell in xml("xl/" + target).iter(NS + "c"):
                value = cell.find(NS + "v")
                text = None if value is None else value.text
                cells[cell.get("r")] = strings[int(text)] if cell.get("t") == "s" and text is not None else text
            return cells
    except (BadZipFile, KeyError, corpus.DatasetBuildError) as error:
        raise SnapshotError(f"raccordo: workbook illeggibile ({error})") from error


def splicing_coefficients(payload: bytes, spec: dict[str, Any]) -> list[dict[str, int]]:
    cells = workbook_cells(payload)
    bases = [spec["source"]["assets"][name]["base"] for name in BASE_ASSETS] + [spec["targetBase"]]
    pairs = list(zip(bases, bases[1:]))
    for column, (old, new) in zip(COEFFICIENT_COLUMNS, pairs, strict=True):
        header = " ".join(str(cells.get(f"{column}4") or "").split()).lower()
        require(f"da base {old} a base {new}" in header, f"raccordo: intestazione {column}4 inattesa {header!r}")
    rows = {}
    for code, workbook_code in WORKBOOK_CODES.items():
        found = [ref[1:] for ref, text in cells.items() if ref.startswith("A") and text == workbook_code]
        require(len(found) == 1, f"raccordo: riga {workbook_code} assente o duplicata")
        rows[code] = found[0]
    return [
        {"from": old, "to": new, **{f"{spec['series'][code]}Thousandths": scaled(cells.get(f"{column}{row}"), 1000, f"raccordo {code} {old}-{new}") for code, row in rows.items()}}
        for column, (old, new) in zip(COEFFICIENT_COLUMNS, pairs)
    ]


def base2025(tenths: int, factors: list[int]) -> int:
    value = Decimal(tenths) * 10
    for thousandths in factors:
        value = value * 1000 / thousandths
    return int(value.quantize(Decimal(1), rounding=ROUND_HALF_UP))


def build_snapshot(inputs: dict[str, bytes], spec: dict[str, Any]) -> dict[str, Any]:
    assets = spec["source"]["assets"]
    for name, asset in assets.items():
        payload = inputs.get(name, b"")
        require(len(payload) == asset["bytes"] and sha256_bytes(payload) == asset["sha256"], f"input {name}: byte/hash diversi dal lock")
    splicing = splicing_coefficients(inputs["raccordo"], spec)
    observations = []
    for name in BASE_ASSETS:
        values = base_values(inputs[name], name, spec)
        for year in range(assets[name]["from"], assets[name]["to"] + 1):
            row: dict[str, Any] = {"year": year, "base": assets[name]["base"]}
            row.update({f"{field}Tenths": values[(code, year)] for code, field in spec["series"].items()})
            observations.append(row)
    for row in observations:
        row["base2025"] = chained(row, splicing, spec)

    source = spec["source"]
    snapshot = {
        "schemaVersion": 1,
        "datasetId": DATASET_ID,
        "referencePeriod": f"{spec['period']['from']}-{spec['period']['to']}",
        "observedAt": source["acquisition"]["checkedAt"],
        "caveats": list(CAVEATS),
        "units": {
            "foiTenths": "decimi di indice nella base pubblicata per quell'anno (base=100)",
            "base2025": "centesimi di indice, base 2025=100, derivati con i coefficienti di raccordo",
            "splicing": "millesimi: indice medio dell'anno della nuova base espresso nella base precedente, diviso 100",
        },
        "series": {"foi": "FOI indice generale", "foiNoTobacco": "FOI indice generale senza tabacchi"},
        "splicing": splicing,
        "observations": observations,
        "semantics": {
            "soldi": {"applicable": False, "unit": "non applicabile", "nature": "indice dei prezzi al consumo (FOI), non flusso monetario pubblico"},
            "periodo": {"referencePeriod": f"{spec['period']['from']}-{spec['period']['to']}", "granularity": "anno solare, media annua pubblicata da ISTAT"},
            "provenance": {
                "holder": source["owner"],
                "landingUrl": source["landingUrl"],
                "license": source["licenseId"],
                "licenseNote": source["licenseNote"],
                "acquisitionDate": source["acquisition"]["acquiredAt"],
                "assets": {name: provenance_entry(asset) for name, asset in assets.items()},
            },
        },
    }
    validate_snapshot(snapshot, spec)
    return snapshot


def provenance_entry(asset: dict[str, Any]) -> dict[str, Any]:
    return {key: asset[key] for key in ("url", "dataflowId", "format", "bytes", "sha256")}


def chained(row: dict[str, Any], splicing: list[dict[str, Any]], spec: dict[str, Any]) -> dict[str, int]:
    steps = [step for step in splicing if step["from"] >= row["base"]]
    return {f"{field}Hundredths": base2025(row[f"{field}Tenths"], [step[f"{field}Thousandths"] for step in steps]) for field in spec["series"].values()}


def validate_snapshot(snapshot: dict[str, Any], spec: dict[str, Any]) -> None:
    require(snapshot.get("schemaVersion") == 1 and snapshot.get("datasetId") == DATASET_ID, "artefatto: identità inattesa")
    assets = spec["source"]["assets"]
    expected_bases = [(year, assets[name]["base"]) for name in BASE_ASSETS for year in range(assets[name]["from"], assets[name]["to"] + 1)]
    observations = snapshot.get("observations") or []
    require([(row.get("year"), row.get("base")) for row in observations] == expected_bases, "artefatto: anni o basi mancanti o fuori ordine")
    fields = list(spec["series"].values())
    for row in observations:
        require(all(type(row.get(f"{field}Tenths")) is int and row[f"{field}Tenths"] > 0 for field in fields), f"artefatto: indice non valido nel {row['year']}")
    by_year = {row["year"]: row for row in observations}
    splicing = snapshot.get("splicing") or []
    bases = [assets[name]["base"] for name in BASE_ASSETS] + [spec["targetBase"]]
    require([(step.get("from"), step.get("to")) for step in splicing] == list(zip(bases, bases[1:])), "artefatto: raccordi mancanti")
    for step in splicing:
        for field in fields:
            # ISTAT's coefficient is the new base year's average in the old base, over 100.
            target = by_year[step["to"]]
            require(
                target["base"] == step["from"] and step[f"{field}Thousandths"] == target[f"{field}Tenths"],
                f"artefatto: raccordo {step['from']}-{step['to']} incoerente con l'indice pubblicato ({field})",
            )
    for row in observations:
        require(row.get("base2025") == chained(row, splicing, spec), f"artefatto: catena in base {spec['targetBase']} incoerente nel {row['year']}")
    require(by_year[spec["targetBase"]]["base2025"] == {f"{field}Hundredths": 10000 for field in fields}, "artefatto: l'anno base 2025 non vale 100")
    provenance = snapshot["semantics"]["provenance"]["assets"]
    require(provenance == {name: provenance_entry(asset) for name, asset in assets.items()}, "artefatto: provenienza divergente dal source lock")


def encode(snapshot: dict[str, Any]) -> bytes:
    return (json.dumps(snapshot, ensure_ascii=False, indent=2) + "\n").encode("utf-8")


def main() -> int:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--spec", type=Path, default=DEFAULT_SPEC)
    parser.add_argument("--data", type=Path, default=DEFAULT_DATA)
    parser.add_argument("--input-dir", type=Path, help="cartella con i quattro file scaricati dagli URL del lock")
    parser.add_argument("--write", action="store_true")
    parser.add_argument("--check", action="store_true")
    args = parser.parse_args()
    try:
        spec = load_spec(args.spec)
        if args.check:
            validate_snapshot(json.loads(args.data.read_text(encoding="utf-8")), spec)
            print(f"{DATASET_ID}: lock e artefatto coerenti")
            return 0
        require(args.input_dir, "serve --input-dir oppure --check")
        inputs = {name: (args.input_dir / asset["filename"]).read_bytes() for name, asset in spec["source"]["assets"].items()}
        payload = encode(build_snapshot(inputs, spec))
        if args.write:
            args.data.write_bytes(payload)
        print(f"{DATASET_ID}: build ok, {len(payload)} byte" + (", scritto" if args.write else ""))
        return 0
    except (ValueError, OSError, KeyError) as error:  # SnapshotError and JSONDecodeError are ValueErrors
        print(f"{DATASET_ID}: {error}", file=sys.stderr)
        return 1


if __name__ == "__main__":
    raise SystemExit(main())
