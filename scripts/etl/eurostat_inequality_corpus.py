#!/usr/bin/env python3
"""Project the locked Eurostat EU-SILC inequality responses into corpus rows.

The committed fixture directory keeps the two original JSON-stat responses. The
parser reads their numeric values as ``Decimal`` and emits one small PSV with
the exact public contract used by the integrated corpus. The source responses
are filtered to Italy, the total population and survey years 2014-2025.
"""

from __future__ import annotations

import argparse
import csv
import gzip
import hashlib
import io
import json
import sys
import tempfile
from decimal import Decimal, InvalidOperation
from pathlib import Path
from typing import Any

import integrated_curated_datasets as corpus
from integrated_corpus_append import append_integrated_datasets

ROOT = Path(__file__).resolve().parents[2]
DATASET_ID = "eurostat-disuguaglianza-redditi"
SOURCE_SPEC = ROOT / "scripts/etl/specs/eurostat-inequality.source.json"
CORPUS_SPEC = ROOT / "scripts/etl/specs/integrated-curated-datasets.source.json"
CATALOG = ROOT / "src/data/generated/integrated/catalog.json"
ROWS_DIR = ROOT / "src/data/generated/integrated/rows"
RECEIPTS_DIR = ROOT / "data/source-ledger/datasets"
DATASET_PROOF = ROOT / "data/source-ledger/dataset-proof.json"
RELEASE_PROOF = ROOT / "data/source-ledger/release-proof.json"
PROJECTION_RELATIVE_PATH = "eurostat-disuguaglianza-redditi.psv"
ACQUISITION_DATE = "2026-09-12"
SURVEY_YEARS = list(range(2014, 2026))
HEADERS = [
    "Indicatore",
    "Anno rilevazione",
    "Anno redditi",
    "Valore",
    "Unità",
    "Stato",
    "URL fonte",
]

ASSET_DEFINITIONS = {
    "gini": {
        "filename": "ilc_di12.json",
        "datasetCode": "ilc_di12",
        "url": (
            "https://ec.europa.eu/eurostat/api/dissemination/statistics/1.0/data/"
            "ilc_di12?format=JSON&lang=EN&freq=A&age=TOTAL&statinfo=GINI_HND&geo=IT&"
            "sinceTimePeriod=2014&untilTimePeriod=2025"
        ),
        "landingUrl": "https://ec.europa.eu/eurostat/databrowser/view/ilc_di12/default/table?lang=en",
        "sourceUpdated": "2026-06-08T23:00:00+0200",
        "structure": {"id": "ILC_DI12", "agencyId": "ESTAT", "version": "36.0"},
        "dimensions": ["freq", "age", "statinfo", "geo", "time"],
        "codes": {
            "freq": ["A"],
            "age": ["TOTAL"],
            "statinfo": ["GINI_HND"],
            "geo": ["IT"],
            "time": [str(year) for year in SURVEY_YEARS],
        },
    },
    "s80s20": {
        "filename": "ilc_di11.json",
        "datasetCode": "ilc_di11",
        "url": (
            "https://ec.europa.eu/eurostat/api/dissemination/statistics/1.0/data/"
            "ilc_di11?format=JSON&lang=EN&freq=A&age=TOTAL&sex=T&unit=RAT&geo=IT&"
            "sinceTimePeriod=2014&untilTimePeriod=2025"
        ),
        "landingUrl": "https://ec.europa.eu/eurostat/databrowser/view/ilc_di11/default/table?lang=en",
        "sourceUpdated": "2026-06-08T23:00:00+0200",
        "structure": {"id": "ILC_DI11", "agencyId": "ESTAT", "version": "76.0"},
        "dimensions": ["freq", "age", "sex", "unit", "geo", "time"],
        "codes": {
            "freq": ["A"],
            "age": ["TOTAL"],
            "sex": ["T"],
            "unit": ["RAT"],
            "geo": ["IT"],
            "time": [str(year) for year in SURVEY_YEARS],
        },
    },
}

INDICATOR_ROWS = {
    "gini": ("scala da 0 a 100", "Gini"),
    "s80s20": ("rapporto", "S80/S20"),
}


class SourceError(ValueError):
    """The locked source or public projection violates its contract."""


def sha256_bytes(payload: bytes) -> str:
    return hashlib.sha256(payload).hexdigest()


def canonical_json(value: object) -> bytes:
    return (
        json.dumps(value, ensure_ascii=False, sort_keys=True, separators=(",", ":"))
        + "\n"
    ).encode("utf-8")


def lock_sha256(spec: dict[str, Any]) -> str:
    copy = json.loads(json.dumps(spec))
    copy["integrity"]["lockSha256"] = ""
    return sha256_bytes(canonical_json(copy))


def _reject_json_constant(value: str) -> object:
    raise SourceError(f"costante JSON non finita: {value}")


def _reject_duplicate_keys(pairs: list[tuple[str, object]]) -> dict[str, object]:
    result: dict[str, object] = {}
    for key, value in pairs:
        if key in result:
            raise SourceError(f"chiave JSON duplicata: {key}")
        result[key] = value
    return result


def parse_json(payload: bytes, label: str) -> dict[str, Any]:
    try:
        value = json.loads(
            payload.decode("utf-8"),
            parse_float=Decimal,
            parse_constant=_reject_json_constant,
            object_pairs_hook=_reject_duplicate_keys,
        )
    except (UnicodeDecodeError, json.JSONDecodeError, SourceError, ValueError) as error:
        raise SourceError(f"JSON-stat illeggibile: {label}") from error
    if not isinstance(value, dict):
        raise SourceError(f"JSON-stat non oggetto: {label}")
    return value


def _ordered_codes(document: dict[str, Any], dimension: str, label: str) -> list[str]:
    try:
        index = document["dimension"][dimension]["category"]["index"]
    except (KeyError, TypeError) as error:
        raise SourceError(f"indice dimensionale mancante: {label}:{dimension}") from error
    if not isinstance(index, dict) or any(
        isinstance(position, bool) or not isinstance(position, int)
        for position in index.values()
    ):
        raise SourceError(f"indice dimensionale non valido: {label}:{dimension}")
    positions = list(index.values())
    if sorted(positions) != list(range(len(positions))):
        raise SourceError(f"indice dimensionale non contiguo: {label}:{dimension}")
    return sorted(index, key=index.get)


def _validate_document(
    document: dict[str, Any],
    *,
    indicator: str,
    asset: dict[str, Any],
) -> None:
    if (
        document.get("class") != "dataset"
        or document.get("version") != "2.0"
        or document.get("source") != "ESTAT"
    ):
        raise SourceError(f"JSON-stat Eurostat inatteso: {indicator}")
    structure = (document.get("extension") or {}).get("datastructure")
    if structure != asset["structure"]:
        raise SourceError(f"struttura SDMX inattesa: {indicator}")
    if document.get("id") != asset["dimensions"]:
        raise SourceError(f"ordine dimensioni inatteso: {indicator}")
    sizes = document.get("size")
    expected_sizes = [len(asset["codes"][dimension]) for dimension in asset["dimensions"]]
    if sizes != expected_sizes:
        raise SourceError(f"size dimensionale inatteso: {indicator}")
    for dimension in asset["dimensions"]:
        if _ordered_codes(document, dimension, indicator) != asset["codes"][dimension]:
            raise SourceError(f"codici dimensionali inattesi: {indicator}:{dimension}")
    values = document.get("value")
    expected_value_keys = {str(index) for index in range(len(SURVEY_YEARS))}
    if not isinstance(values, dict) or set(values) != expected_value_keys:
        raise SourceError(f"celle JSON-stat incomplete: {indicator}")
    status = document.get("status", {})
    if not isinstance(status, dict):
        raise SourceError(f"status JSON-stat non valido: {indicator}")
    if not set(status).issubset(expected_value_keys):
        raise SourceError(f"status JSON-stat riferito a celle inesistenti: {indicator}")
    if any(flag not in {"b"} for flag in status.values()):
        raise SourceError(f"status JSON-stat sconosciuto: {indicator}")
    expected_updated = asset.get("sourceUpdated")
    if not isinstance(expected_updated, str) or document.get("updated") != expected_updated:
        raise SourceError(f"sourceUpdated divergente: {indicator}")


def _flat_index(document: dict[str, Any], coordinates: dict[str, str]) -> str:
    offset = 0
    for dimension, size in zip(document["id"], document["size"], strict=True):
        try:
            position = document["dimension"][dimension]["category"]["index"][coordinates[dimension]]
        except (KeyError, TypeError) as error:
            raise SourceError(f"coordinata mancante: {dimension}") from error
        offset = offset * size + position
    return str(offset)


def _cell(
    document: dict[str, Any],
    coordinates: dict[str, str],
    *,
    indicator: str,
) -> tuple[Decimal, str | None]:
    key = _flat_index(document, coordinates)
    values = document["value"]
    if key not in values or values[key] is None:
        raise SourceError(f"cella mancante: {indicator}/{coordinates['time']}")
    raw = values[key]
    try:
        value = raw if isinstance(raw, Decimal) else Decimal(str(raw))
    except (InvalidOperation, ValueError) as error:
        raise SourceError(f"valore non numerico: {indicator}/{coordinates['time']}") from error
    if not value.is_finite() or value < 0:
        raise SourceError(f"valore negativo o non finito: {indicator}/{coordinates['time']}")
    if indicator == "gini" and value > Decimal("100"):
        raise SourceError(f"Gini fuori scala: {coordinates['time']}")
    status = document.get("status", {})
    flag = status.get(key)
    return value, flag


def _source_file(input_dir: Path, asset: dict[str, Any]) -> Path:
    candidates = []
    if asset.get("path"):
        candidates.append(input_dir / asset["path"])
    candidates.append(input_dir / asset["filename"])
    for candidate in candidates:
        if candidate.is_file():
            return candidate
    raise SourceError(f"fixture mancante: {candidates[0]}")


def _read_asset(input_dir: Path, indicator: str, asset: dict[str, Any]) -> dict[str, Any]:
    path = _source_file(input_dir, asset)
    payload = path.read_bytes()
    if len(payload) != asset["bytes"] or sha256_bytes(payload) != asset["sha256"]:
        raise SourceError(f"hash o byte sorgente divergenti: {indicator}")
    document = parse_json(payload, indicator)
    _validate_document(document, indicator=indicator, asset=asset)
    return document


def projection_bytes(spec: dict[str, Any], input_dir: Path) -> bytes:
    documents = {
        indicator: _read_asset(input_dir, indicator, asset)
        for indicator, asset in spec["source"]["assets"].items()
    }
    output = io.StringIO(newline="")
    writer = csv.writer(output, delimiter="|", lineterminator="\n")
    writer.writerow(HEADERS)
    for indicator in ("gini", "s80s20"):
        document = documents[indicator]
        asset = spec["source"]["assets"][indicator]
        unit, _label = INDICATOR_ROWS[indicator]
        for year in SURVEY_YEARS:
            coordinates = {
                dimension: asset["codes"][dimension][0]
                for dimension in asset["dimensions"]
                if dimension != "time"
            }
            coordinates["time"] = str(year)
            value, flag = _cell(document, coordinates, indicator=indicator)
            writer.writerow([
                indicator,
                str(year),
                str(year - 1),
                format(value, "f"),
                unit,
                flag or "",
                asset["url"],
            ])
    payload = output.getvalue().encode("utf-8")
    rows = payload.decode("utf-8").splitlines()
    if len(rows) != 25 or rows[0].split("|") != HEADERS:
        raise SourceError("proiezione PSV non chiusa sulle 24 righe")
    return payload


def load_spec(path: Path = SOURCE_SPEC) -> dict[str, Any]:
    try:
        spec = json.loads(path.read_text(encoding="utf-8"))
    except (OSError, UnicodeDecodeError, json.JSONDecodeError) as error:
        raise SourceError(f"source lock illeggibile: {path}") from error
    if spec.get("schemaVersion") != 1 or spec.get("datasetId") != DATASET_ID:
        raise SourceError("source lock: identità inattesa")
    if spec.get("period") != {"from": 2014, "to": 2025}:
        raise SourceError("source lock: periodo inatteso")
    source = spec.get("source")
    if not isinstance(source, dict) or source.get("licenseId") != "verified-open-eu-reuse":
        raise SourceError("source lock: licenza Eurostat inattesa")
    acquisition = source.get("acquisition")
    if (
        not isinstance(acquisition, dict)
        or acquisition.get("acquiredAt") != ACQUISITION_DATE
        or acquisition.get("checkedAt") != ACQUISITION_DATE
    ):
        raise SourceError("source lock: date di acquisizione/verifica inattese")
    assets = source.get("assets")
    if not isinstance(assets, dict) or set(assets) != set(ASSET_DEFINITIONS):
        raise SourceError("source lock: asset inattesi")
    for indicator, asset in assets.items():
        definition = ASSET_DEFINITIONS[indicator]
        if (
            asset.get("path") != f"tests/fixtures/eurostat-inequality/{definition['filename']}"
            or asset.get("url") != definition["url"]
            or asset.get("landingUrl") != definition["landingUrl"]
            or asset.get("datasetCode") != definition["datasetCode"]
            or asset.get("sourceUpdated") != definition["sourceUpdated"]
            or asset.get("structure") != definition["structure"]
        ):
            raise SourceError(f"source lock: URL o dataset code inatteso: {indicator}")
        if asset.get("dimensions") != definition["dimensions"] or asset.get("codes") != definition["codes"]:
            raise SourceError(f"source lock: dimensioni inattese: {indicator}")
        if not isinstance(asset.get("bytes"), int) or asset["bytes"] <= 0:
            raise SourceError(f"source lock: bytes non validi: {indicator}")
        if not isinstance(asset.get("sha256"), str) or len(asset["sha256"]) != 64:
            raise SourceError(f"source lock: hash non valido: {indicator}")
    projection = spec.get("projection")
    if (
        not isinstance(projection, dict)
        or projection.get("path") != PROJECTION_RELATIVE_PATH
        or projection.get("rows") != 24
        or projection.get("headers") != HEADERS
    ):
        raise SourceError("source lock: contratto PSV inatteso")
    if spec.get("integrity", {}).get("lockSha256") != lock_sha256(spec):
        raise SourceError("source lock: lockSha256 divergente")
    return spec


def validate_projection(payload: bytes, spec: dict[str, Any]) -> None:
    projection = spec["projection"]
    if len(payload) != projection["bytes"] or sha256_bytes(payload) != projection["sha256"]:
        raise SourceError("hash o byte della proiezione divergenti")
    if projection["rows"] != 24 or projection["columns"] != len(HEADERS):
        raise SourceError("contratto della proiezione divergente")


def _locked_projection(spec: dict[str, Any]) -> bytes:
    return projection_bytes(spec, ROOT)


def _validate_corpus_contract(
    source_spec: dict[str, Any],
    corpus_spec: dict[str, Any],
    item: dict[str, Any],
) -> dict[str, Any]:
    source = source_spec["source"]
    acquisition = source["acquisition"]
    metadata = corpus.resolved_source_metadata(corpus_spec, DATASET_ID)
    if (
        metadata.get("acquisitionDate") != acquisition.get("acquiredAt")
        or metadata.get("checkedAt") != acquisition.get("checkedAt")
        or metadata.get("publicationDate") is not None
        or metadata.get("holder") != source.get("owner")
        or item.get("licenseStatus") != source.get("licenseId")
    ):
        raise SourceError("metadata corpus inequality divergenti dalla source lock")
    return metadata


def _load_corpus_contract(
    source_spec: dict[str, Any],
) -> tuple[dict[str, Any], dict[str, Any], dict[str, Any]]:
    corpus_spec, datasets = corpus.load_spec(CORPUS_SPEC)
    item = next((item for item in datasets if item["id"] == DATASET_ID), None)
    if item is None:
        raise SourceError("dataset inequality assente dalla specifica corpus")
    metadata = _validate_corpus_contract(source_spec, corpus_spec, item)
    return corpus_spec, item, metadata


def check_committed() -> None:
    spec = load_spec()
    payload = _locked_projection(spec)
    validate_projection(payload, spec)
    with tempfile.TemporaryDirectory() as directory:
        source_root = Path(directory)
        (source_root / PROJECTION_RELATIVE_PATH).write_bytes(payload)
        _, item, metadata = _load_corpus_contract(spec)
        parsed = corpus.parse_dataset(source_root, item)
        entry, rows_payload, receipt, _ = corpus.build_dataset(
            item, parsed, metadata
        )
        actual_rows = b"".join(
            gzip.decompress(path.read_bytes())
            for path in sorted(ROWS_DIR.glob(f"{DATASET_ID}.part-*.jsonl.gz"))
        )
        actual_receipt = json.loads((RECEIPTS_DIR / f"{DATASET_ID}.receipt.json").read_bytes())
        actual_catalog = json.loads(CATALOG.read_bytes())
        actual_entry = next((value for value in actual_catalog["datasets"] if value["id"] == DATASET_ID), None)
        if rows_payload != actual_rows or receipt != actual_receipt or entry != actual_entry:
            raise SourceError("artefatti corpus inequality divergono dalla proiezione")


def publish() -> None:
    spec = load_spec()
    payload = _locked_projection(spec)
    validate_projection(payload, spec)
    _load_corpus_contract(spec)
    with tempfile.TemporaryDirectory() as directory:
        source_root = Path(directory)
        (source_root / PROJECTION_RELATIVE_PATH).write_bytes(payload)
        append_integrated_datasets(
            spec_path=CORPUS_SPEC,
            source_root=source_root,
            dataset_ids={DATASET_ID},
            catalog_path=CATALOG,
            rows_dir=ROWS_DIR,
            receipts_dir=RECEIPTS_DIR,
            proof_path=DATASET_PROOF,
            release_proof_path=RELEASE_PROOF,
        )


def main() -> int:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("action", choices=("check", "publish"))
    args = parser.parse_args()
    try:
        if args.action == "check":
            check_committed()
            print("eurostat-inequality: source lock, proiezione e corpus coerenti")
        else:
            publish()
            print("eurostat-inequality: dataset pubblicato nel corpus integrato")
        return 0
    except (SourceError, corpus.DatasetBuildError, OSError, json.JSONDecodeError) as error:
        print(f"eurostat-inequality: {error}", file=sys.stderr)
        return 1


if __name__ == "__main__":
    raise SystemExit(main())
