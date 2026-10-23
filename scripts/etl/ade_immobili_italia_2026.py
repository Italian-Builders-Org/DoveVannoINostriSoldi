#!/usr/bin/env python3
"""Proietta «Gli immobili in Italia 2026» (anno d'imposta 2023) da open data e API tabelle AdE."""
from __future__ import annotations

import argparse
import csv
import gzip
import html
import io
import json
import re
import tempfile
import unicodedata
from decimal import Decimal, InvalidOperation
from pathlib import Path
from zipfile import ZipFile

import integrated_curated_datasets as corpus
from integrated_corpus_append import append_integrated_datasets

ROOT = Path(__file__).resolve().parents[2]
SPEC_PATH = ROOT / "scripts/etl/specs/ade-immobili-italia-2026.source.json"
CORPUS_SPEC = ROOT / "scripts/etl/specs/integrated-curated-datasets.source.json"
CATALOG = ROOT / "src/data/generated/integrated/catalog.json"
ROWS = ROOT / "src/data/generated/integrated/rows"
RECEIPTS = ROOT / "data/source-ledger/datasets"

PRELIEVO_ID = "ade-immobili-prelievo-2015-2024"
UTILIZZO_ID = "ade-immobili-utilizzo-provincia-2023"
TABELLE_ID = "ade-immobili-tabelle-2026"

PRELIEVO_HEADERS = [
    "Voce",
    "Anno",
    "Importo (mld euro)",
    "URL fonte",
]
UTILIZZO_HEADERS = [
    "Anno imposta",
    "Provincia (sigla)",
    "Categoria utilizzo",
    "Indicatore",
    "Valore",
    "URL fonte",
]
TABELLE_HEADERS = [
    "Tabella id",
    "Titolo tabella",
    "Riga",
    "Colonna",
    "Valore",
    "URL fonte",
]

TABLE_API = (
    "https://www1.finanze.gov.it/finanze/immobili/public/api/api.php/get_table?id={id}&cq=1"
)
OPEN_DATA_URL = "https://www1.finanze.gov.it/finanze/immobili/public/contenuti/opendata.zip"


class SourceError(ValueError):
    """Fonte o proiezione fuori dal contratto verificato."""


def verified_bytes(item: dict) -> bytes:
    raw = (ROOT / item["path"]).read_bytes()
    if len(raw) != item["bytes"] or corpus.sha256_bytes(raw) != item["sha256"]:
        raise SourceError(f"byte o hash divergenti per {item['path']}")
    return raw


def clean_cell(value: str) -> str:
    text = html.unescape(value.strip().strip('"').replace("\r", ""))
    return unicodedata.normalize("NFC", text)


def money_mld(value: str) -> str:
    text = clean_cell(value)
    if not text:
        raise SourceError("importo mancante nel prelievo")
    try:
        number = Decimal(text.replace(",", "."))
    except InvalidOperation as error:
        raise SourceError("importo non numerico") from error
    if not number.is_finite():
        raise SourceError("importo non finito")
    return format(number, "f")


def flatten_headers(head: list[dict]) -> list[str]:
    labels: list[str] = []
    for column in head:
        base = clean_cell(column.get("lbl", ""))
        subs = column.get("sub")
        if subs:
            for sub in subs:
                sub_label = clean_cell(sub.get("lbl", ""))
                labels.append(f"{base} · {sub_label}".strip(" ·"))
        else:
            labels.append(base)
    if not labels:
        raise SourceError("intestazione tabella vuota")
    return labels


def load_table(table_id: str, manifest: dict[str, dict]) -> list[dict] | None:
    meta = manifest[table_id]
    path = ROOT / SPEC["assets"]["tablesDir"] / f"{table_id}.json.gz"
    raw = gzip.decompress(path.read_bytes())
    if len(raw) != meta["bytes"] or corpus.sha256_bytes(raw) != meta["sha256"]:
        raise SourceError(f"tabella {table_id}: hash o byte divergenti")
    payload = json.loads(raw.decode("utf-8"))
    if payload is None:
        return None
    if not isinstance(payload, list) or len(payload) != 1:
        raise SourceError(f"tabella {table_id}: payload API inatteso")
    return payload


def project_prelievo(spec: dict, manifest: dict[str, dict]) -> bytes:
    table_id = spec["prelievoTableId"]
    loaded = load_table(table_id, manifest)
    if loaded is None:
        raise SourceError("tabella prelievo non disponibile via API")
    block = loaded[0]
    headers = flatten_headers(block["head"])
    years = headers[1:]
    if years != [str(year) for year in range(2015, 2025)]:
        raise SourceError("anni del prelievo divergenti")
    url = TABLE_API.format(id=table_id)
    output = io.StringIO(newline="")
    writer = csv.writer(output, delimiter="|", lineterminator="\n")
    writer.writerow(PRELIEVO_HEADERS)
    for row_index, row in enumerate(block["body"], start=1):
        cells = [clean_cell(value) for value in row["celle"]]
        if len(cells) != len(headers):
            raise SourceError(f"prelievo riga {row_index}: colonne divergenti")
        voce = cells[0]
        for year, amount in zip(years, cells[1:], strict=True):
            writer.writerow([voce, year, money_mld(amount), url])
    return output.getvalue().encode("utf-8")


def utilizzo_indicator(label: str) -> tuple[str, str] | None:
    match = re.match(r"^(.*) - (Numero immobili totale|Rendita catastale totale|VSM totale)$", label)
    if not match:
        return None
    return match.group(2), match.group(1).strip()


def project_utilizzo(spec: dict) -> bytes:
    archive = verified_bytes(spec["assets"]["opendataZip"])
    url = OPEN_DATA_URL
    output = io.StringIO(newline="")
    writer = csv.writer(output, delimiter="|", lineterminator="\n")
    writer.writerow(UTILIZZO_HEADERS)
    with ZipFile(io.BytesIO(archive)) as zf:
        for member in spec["utilizzoCsvMembers"]:
            raw = zf.read(member)
            category = member.split("/")[-1].replace("_PROV_23.csv", "").replace("utilizzo_", "")
            category = category.replace("_", " ")
            rows = list(csv.reader(io.StringIO(raw.decode("utf-8")), delimiter=";"))
            header = [clean_cell(value) for value in rows[0]]
            for row in rows[1:]:
                if not row or not row[0].strip():
                    continue
                provincia = clean_cell(row[0])
                for label, value in zip(header[1:], row[1:], strict=True):
                    parsed = utilizzo_indicator(label)
                    if parsed is None:
                        raise SourceError(f"colonna utilizzo non riconosciuta: {label}")
                    indicatore, owner = parsed
                    writer.writerow([2023, provincia, category, f"{owner} · {indicatore}", clean_cell(value), url])
    return output.getvalue().encode("utf-8")


def project_tabelle(spec: dict, manifest: dict[str, dict]) -> tuple[bytes, list[str]]:
    output = io.StringIO(newline="")
    writer = csv.writer(output, delimiter="|", lineterminator="\n")
    writer.writerow(TABELLE_HEADERS)
    missing: list[str] = []
    for table_id in sorted(manifest):
        if not table_id.startswith("2026_"):
            continue
        loaded = load_table(table_id, manifest)
        if loaded is None:
            missing.append(table_id)
            continue
        block = loaded[0]
        title = clean_cell(block.get("titolo", ""))
        headers = flatten_headers(block["head"])
        url = TABLE_API.format(id=table_id)
        for row_index, row in enumerate(block["body"], start=1):
            cells = [clean_cell(value) for value in row["celle"]]
            if len(cells) != len(headers):
                raise SourceError(f"{table_id} riga {row_index}: colonne divergenti")
            for column, value in zip(headers, cells, strict=True):
                writer.writerow([table_id, title, str(row_index), column, value, url])
    return output.getvalue().encode("utf-8"), missing


def build_analysis(
    spec: dict,
    manifest: dict[str, dict],
    prelievo_psv: bytes,
    utilizzo_psv: bytes,
    missing_tables: list[str],
) -> tuple[bytes, bytes]:
    prelievo_rows = list(csv.DictReader(io.StringIO(prelievo_psv.decode("utf-8")), delimiter="|"))
    imu_2024 = next(
        (row for row in prelievo_rows if row["Voce"].startswith("IMU di cui") and row["Anno"] == "2024"),
        None,
    )
    pat_2024 = next(
        (
            row for row in prelievo_rows
            if "patrimoniale" in row["Voce"].lower() and row["Anno"] == "2024" and "reddituale" not in row["Voce"].lower()
        ),
        None,
    )
    if not imu_2024 or not pat_2024:
        raise SourceError("evidenze prelievo 2024 assenti")

    chapters = []
    tree = json.loads(gzip.decompress(verified_bytes(spec["assets"]["apiTree"])).decode("utf-8"))
    for edition in tree["tree_tabelle"]:
        if edition["id"] != str(spec["publicationEdition"]):
            continue
        for chapter in edition["figli"]:
            chapters.append({
                "id": chapter["id"],
                "title": clean_cell(html.unescape(chapter["lbl"])),
                "tables": sum(1 for tid in manifest if tid.startswith(chapter["id"])),
            })

    data = {
        "caveats": [
            "Anno d'imposta 2023: stock, VSM e utilizzi open data; il prelievo tabella 4.4 arriva al 2024 in miliardi di euro, non è cassa comunale.",
            "IMU/TASI nel prelievo sono gettito nazionale pubblicato da AdE, non aliquote per singolo Comune: il capitolo IMU per comune del volume 2026 non è ancora nelle API/tabelle scaricabili.",
            f"{len(missing_tables)} tabelle dell’edizione 2026 rispondono null dall’API ufficiale: restano citate nel volume PDF, non inventiamo le celle mancanti.",
            "VSM, rendite e numeri immobili non sono euro di bilancio né pagamenti SIOPE; non sommarli a spesa pubblica o entrate IRPEF.",
            "Le province open data usano sigle catastali: il collegamento ai Comuni passa da territorio/provincia, non da codice ISTAT in questa fonte.",
            "Licenza CC BY 3.0 IT dichiarata nel portale open data AdE/MEF; attribuzione obbligatoria.",
        ],
        "coverage": {
            "taxYear": spec["taxYear"],
            "edition": spec["publicationEdition"],
            "openDataZipBytes": spec["assets"]["opendataZip"]["bytes"],
            "tableCount": sum(1 for tid in manifest if tid.startswith("2026_")),
            "tablesAvailableViaApi": sum(1 for tid in manifest if tid.startswith("2026_")) - len(missing_tables),
            "tablesMissingViaApi": missing_tables,
            "utilizzoProvinciaRows": sum(1 for _ in csv.reader(io.StringIO(utilizzo_psv.decode()), delimiter="|")) - 1,
        },
        "hero": {
            "imuGettito2024Mld": imu_2024["Importo (mld euro)"],
            "prelievoPatrimoniale2024Mld": pat_2024["Importo (mld euro)"],
        },
        "chapters": chapters,
        "prelievoSeries": [
            {
                "voce": row["Voce"],
                "anno": int(row["Anno"]),
                "mldEuro": row["Importo (mld euro)"],
                "sourceUrl": row["URL fonte"],
            }
            for row in prelievo_rows
            if row["Voce"].startswith(("IMU di cui", "TASI di cui", "Cedolare secca", '"Imposte di natura'))
        ],
        "sources": {
            "landingUrl": spec["landingUrl"],
            "openDataPortalUrl": spec["openDataPortalUrl"],
            "openDataZipUrl": OPEN_DATA_URL,
            "volumePdfUrl": spec["assets"]["volumePdf"]["url"],
            "licenseUrl": spec["license"]["url"],
        },
    }
    meta = {
        "datasetId": "ade-immobili-italia-2026",
        "schemaVersion": 1,
        "semantics": {
            "periodo": {
                "referencePeriod": f"anno d'imposta {spec['taxYear']}",
                "note": "Edizione 2026 del volume AdE; prelievo tabellare fino al 2024.",
            },
            "provenance": {
                "canonicalUrls": [
                    spec["landingUrl"],
                    spec["openDataPortalUrl"],
                    OPEN_DATA_URL,
                    spec["assets"]["volumePdf"]["url"],
                ],
                "acquisitionDate": "2026-10-23",
                "checkedAt": "2026-10-23",
                "publicationDate": None,
            },
        },
    }
    return (
        json.dumps(data, ensure_ascii=False, separators=(",", ":")).encode("utf-8"),
        json.dumps(meta, ensure_ascii=False, separators=(",", ":")).encode("utf-8"),
    )


def publish_dataset(dataset_id: str, relative_path: str, payload: bytes) -> None:
    with tempfile.TemporaryDirectory() as directory:
        source_root = Path(directory)
        (source_root / relative_path).write_bytes(payload)
        append_integrated_datasets(
            spec_path=CORPUS_SPEC,
            source_root=source_root,
            dataset_ids={dataset_id},
            catalog_path=CATALOG,
            rows_dir=ROWS,
            receipts_dir=RECEIPTS,
            proof_path=ROOT / "data/source-ledger/dataset-proof.json",
            release_proof_path=ROOT / "data/source-ledger/release-proof.json",
        )


def check_committed(spec: dict, payloads: dict[str, bytes]) -> None:
    spec_doc, datasets = corpus.load_spec(CORPUS_SPEC)
    for dataset_id, payload in payloads.items():
        item = next(row for row in datasets if row["id"] == dataset_id)
        with tempfile.TemporaryDirectory() as directory:
            source_root = Path(directory)
            (source_root / item["relativePath"]).write_bytes(payload)
            parsed = corpus.parse_dataset(source_root, item)
            entry, expected, receipt, _ = corpus.build_dataset(
                item, parsed, corpus.resolved_source_metadata(spec_doc, dataset_id)
            )
        actual = b"".join(
            gzip.decompress(path.read_bytes())
            for path in sorted(ROWS.glob(f"{dataset_id}.part-*.jsonl.gz"))
        )
        catalog = json.loads(CATALOG.read_bytes())
        if (
            actual != expected
            or receipt != json.loads((RECEIPTS / f"{dataset_id}.receipt.json").read_bytes())
            or entry != next(row for row in catalog["datasets"] if row["id"] == dataset_id)
        ):
            raise SourceError(f"commit divergente per {dataset_id}")


def main() -> int:
    parser = argparse.ArgumentParser(description=__doc__)
    group = parser.add_mutually_exclusive_group(required=True)
    group.add_argument("--publish", action="store_true")
    group.add_argument("--check", action="store_true")
    args = parser.parse_args()

    global SPEC
    SPEC = json.loads(SPEC_PATH.read_text(encoding="utf-8"))
    if SPEC["license"]["status"] != "verified-open-cc-by-3.0-it":
        raise SourceError("licenza non verificata")
    verified_bytes(SPEC["license"])
    verified_bytes(SPEC["assets"]["opendataZip"])
    verified_bytes(SPEC["assets"]["apiTree"])
    manifest = json.loads((ROOT / SPEC["assets"]["tableManifest"]["path"]).read_text(encoding="utf-8"))

    prelievo = project_prelievo(SPEC, manifest)
    utilizzo = project_utilizzo(SPEC)
    tabelle, missing_tables = project_tabelle(SPEC, manifest)
    analysis_data, analysis_meta = build_analysis(SPEC, manifest, prelievo, utilizzo, missing_tables)

    payloads = {
        PRELIEVO_ID: prelievo,
        UTILIZZO_ID: utilizzo,
        TABELLE_ID: tabelle,
    }

    if args.publish:
        with tempfile.TemporaryDirectory() as directory:
            source_root = Path(directory)
            for dataset_id, payload in payloads.items():
                relative = SPEC["datasets"][dataset_id]["relativePath"]
                (source_root / relative).write_bytes(payload)
            append_integrated_datasets(
                spec_path=CORPUS_SPEC,
                source_root=source_root,
                dataset_ids=set(payloads),
                catalog_path=CATALOG,
                rows_dir=ROWS,
                receipts_dir=RECEIPTS,
                proof_path=ROOT / "data/source-ledger/dataset-proof.json",
                release_proof_path=ROOT / "data/source-ledger/release-proof.json",
            )
        (ROOT / SPEC["analysisArtifact"]["path"]).write_bytes(analysis_data)
        (ROOT / SPEC["analysisArtifact"]["metaPath"]).write_bytes(analysis_meta)
    else:
        check_committed(SPEC, payloads)
        data_path = ROOT / SPEC["analysisArtifact"]["path"]
        meta_path = ROOT / SPEC["analysisArtifact"]["metaPath"]
        if data_path.read_bytes() != analysis_data or meta_path.read_bytes() != analysis_meta:
            raise SourceError("snapshot analisi divergente")

    print(
        "PASS: AdE immobili 2026 —",
        f"prelievo {sum(1 for _ in csv.reader(io.StringIO(prelievo.decode()), delimiter='|')) - 1} righe,",
        f"utilizzo {sum(1 for _ in csv.reader(io.StringIO(utilizzo.decode()), delimiter='|')) - 1} righe,",
        f"tabelle {sum(1 for _ in csv.reader(io.StringIO(tabelle.decode()), delimiter='|')) - 1} righe",
    )
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
