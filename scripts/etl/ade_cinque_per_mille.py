#!/usr/bin/env python3
"""Ricostruisce offline il 5 per mille AF 2024 dai sette CSV ufficiali AdE."""
from __future__ import annotations

import argparse
import csv
import gzip
import io
import json
import re
import tempfile
from decimal import Decimal
from pathlib import Path
from zipfile import ZipFile

import integrated_curated_datasets as corpus
from integrated_corpus_append import append_integrated_datasets

ROOT = Path(__file__).resolve().parents[2]
SPEC = ROOT / "scripts/etl/specs/ade-cinque-per-mille.source.json"
CORPUS_SPEC = ROOT / "scripts/etl/specs/integrated-curated-datasets.source.json"
DATASET_ID = "ade-cinque-per-mille-territori-2024"
CATALOG = ROOT / "src/data/generated/integrated/catalog.json"
ROWS = ROOT / "src/data/generated/integrated/rows"
RECEIPTS = ROOT / "data/source-ledger/datasets"
SOURCE_HEADERS = [
    "Prog", "Codice fiscale", "Denominazione", "Regione", "PR", "Comune", "ETS", "ASD",
    "Ricerca scientifica", "Ricerca sanitaria", "Comuni", "Beni culturali e paesaggistici",
    "Enti Gestori aree protette", "Numero scelte", "Importo delle scelte espresse",
    "Importo proporzionale per le scelte generiche",
    "Importo proporzionale per ripartizione importi inferiori a 100 euro", "Importo totale erogabile",
]
HEADERS = [
    "Anno finanziario", "Territorio", "Enti ammessi", "Enti con importo erogabile pubblicato",
    "Enti senza importo erogabile pubblicato", "Scelte pubblicate", "Enti senza numero scelte pubblicato",
    "Scelte espresse (euro)", "Scelte generiche (euro)", "Redistribuzione quote sotto soglia (euro)",
    "Totale erogabile pubblicato (euro)", "URL fonte",
]
NOTE = "Gli importi non comprendono le quote della singola categoria nella quale l’ente ammesso è destinatario di un importo inferiore a 100 euro, non erogabile e ripartito all’interno della medesima categoria ai sensi dell’art. 11, comma 1, del DPCM 23 luglio 2020"


class SourceError(ValueError):
    """Blocca fonti o proiezioni che non rispettano la copertura verificata."""


def verified_bytes(item: dict) -> bytes:
    if "member" in item:
        with ZipFile(ROOT / item["path"]) as archive:
            raw = archive.read(item["member"])
    else:
        raw = gzip.decompress((ROOT / item["path"]).read_bytes())
    if len(raw) != item["bytes"] or corpus.sha256_bytes(raw) != item["sha256"]:
        raise SourceError("byte o hash della fonte divergenti")
    return raw


def load_rows(spec: dict) -> list[list[str]]:
    license_info = spec["license"]
    if (license_info.get("status") != "verified-open-cad-art52-cc-by-4.0"
            or license_info.get("url") != "https://creativecommons.org/licenses/by/4.0/"):
        raise SourceError("base di riuso non verificata")
    expected_evidence = {
        "https://www.agid.gov.it/sites/agid/files/2024-05/lg-open-data_v.1.0_1.pdf",
        "https://www.agenziaentrate.gov.it/portale/elenco-complessivo-dei-beneficiari",
        "https://www.agenziaentrate.gov.it/portale/web/guest/privacy",
    }
    if len(license_info["evidence"]) != 3 or {item["url"] for item in license_info["evidence"]} != expected_evidence:
        raise SourceError("evidenze della base di riuso incomplete")
    for evidence in license_info["evidence"]:
        verified_bytes(evidence)
    if spec.get("financialYear") != 2024 or [p["part"] for p in spec["parts"]] != list(range(1, 8)):
        raise SourceError("anno o inventario delle parti divergente")
    raw_archive = (ROOT / spec["archive"]["path"]).read_bytes()
    if len(raw_archive) != spec["archive"]["bytes"] or corpus.sha256_bytes(raw_archive) != spec["archive"]["sha256"]:
        raise SourceError("byte o hash dell'archivio originale divergenti")
    with ZipFile(io.BytesIO(raw_archive)) as archive:
        expected_members = [part["member"] for part in spec["parts"]] + ["LEGGIMI.txt"]
        if archive.namelist() != expected_members or corpus.sha256_bytes(archive.read("LEGGIMI.txt")) != spec["archive"]["readmeSha256"]:
            raise SourceError("inventario dell'archivio originale divergente")
    result = []
    for part in spec["parts"]:
        title = ("5 per mille anno finanziario 2024\nElenco enti destinatari del contributo "
                 f"ammessi in una o più categorie di beneficiari\nparte {part['part']} di 7")
        rows = list(csv.reader(io.StringIO(verified_bytes(part).decode("utf-8")), delimiter=";"))
        if rows[:2] != [[title], SOURCE_HEADERS] or rows[-1] != [NOTE]:
            raise SourceError("intestazione, anno o nota della parte divergenti")
        if len(rows) - 3 != part["rows"]:
            raise SourceError("numero di righe della parte divergente")
        result.extend(rows[2:-1])
    return result


def number(raw: str, *, money: bool) -> str | None:
    if not raw:
        return None
    pattern = r"(?:\d+|\d{1,3}(?:\.\d{3})+)" + (r",\d{2}" if money else "")
    if re.fullmatch(pattern, raw) is None:
        raise SourceError("formato numerico inatteso")
    return raw.replace(".", "").replace(",", ".")


def project_rows(rows: list[list[str]], spec: dict) -> bytes:
    if len(rows) != spec["expected"]["rows"]:
        raise SourceError("numero di enti divergente")
    seen = set()
    sums = [Decimal(0)] * 5
    missing = [0] * 5
    territories = {}
    for ordinal, row in enumerate(rows, 1):
        if len(row) != len(SOURCE_HEADERS) or row[0] != str(ordinal):
            raise SourceError("schema o progressivo divergenti")
        if re.fullmatch(r"'\d{11}'", row[1]) is None or not row[2].strip():
            raise SourceError("codice ente o denominazione non validi")
        code = row[1][1:-1]
        if code in seen:
            raise SourceError("codice ente duplicato fra le parti")
        seen.add(code)
        if any(value not in {"", "X"} for value in row[6:13]) or "X" not in row[6:13]:
            raise SourceError("categoria di ammissione inattesa")
        values = [number(value, money=index > 0) for index, value in enumerate(row[13:])]
        for index, value in enumerate(values):
            if value is None:
                missing[index] += 1
            else:
                sums[index] += Decimal(value)
        # Non convertire i componenti mancanti in zero per forzare una quadratura.
        if all(value is not None for value in values[1:]):
            if sum((Decimal(value) for value in values[1:4]), Decimal(0)) != Decimal(values[4]):
                raise SourceError("riconciliazione dell'importo erogabile divergente")
        group = territories.setdefault(row[3], {"entities": 0, "sums": [Decimal(0)] * 5, "observed": [0] * 5})
        group["entities"] += 1
        for index, value in enumerate(values):
            if value is not None:
                group["sums"][index] += Decimal(value)
                group["observed"][index] += 1
    if missing != spec["expected"]["missingNumericCells"] or sums != [Decimal(v) for v in spec["expected"]["observedSums"]]:
        raise SourceError("somma o celle mancanti divergenti dagli originali")
    if len(territories) != spec["expected"]["territories"]:
        raise SourceError("numero di territori pubblicati divergente")
    output = io.StringIO(newline="")
    writer = csv.writer(output, delimiter="|", lineterminator="\n")
    writer.writerow(HEADERS)
    for territory, group in sorted(territories.items()):
        observed = group["observed"]
        values = [format(value, ".2f" if index else ".0f") if observed[index] else None
                  for index, value in enumerate(group["sums"])]
        writer.writerow([2024, territory or None, group["entities"], observed[4],
                         group["entities"] - observed[4], values[0], group["entities"] - observed[0],
                         *values[1:], "https://www.agenziaentrate.gov.it/portale/elenco-complessivo-dei-beneficiari"])
    return output.getvalue().encode("utf-8")


def check_committed(payload: bytes) -> None:
    spec, datasets = corpus.load_spec(CORPUS_SPEC)
    item = next(item for item in datasets if item["id"] == DATASET_ID)
    with tempfile.TemporaryDirectory() as directory:
        source_root = Path(directory)
        (source_root / item["relativePath"]).write_bytes(payload)
        parsed = corpus.parse_dataset(source_root, item)
        entry, expected, receipt, _ = corpus.build_dataset(item, parsed, corpus.resolved_source_metadata(spec, DATASET_ID))
    actual = b"".join(gzip.decompress(path.read_bytes()) for path in sorted(ROWS.glob(f"{DATASET_ID}.part-*.jsonl.gz")))
    catalog = json.loads(CATALOG.read_bytes())
    if (actual != expected or receipt != json.loads((RECEIPTS / f"{DATASET_ID}.receipt.json").read_bytes())
            or entry != next(row for row in catalog["datasets"] if row["id"] == DATASET_ID)):
        raise SourceError("righe, ricevuta o catalogo divergenti dagli originali AdE")


def publish(payload: bytes) -> None:
    with tempfile.TemporaryDirectory() as directory:
        source_root = Path(directory)
        (source_root / f"{DATASET_ID}.psv").write_bytes(payload)
        append_integrated_datasets(
            spec_path=CORPUS_SPEC, source_root=source_root, dataset_ids={DATASET_ID},
            catalog_path=CATALOG, rows_dir=ROWS, receipts_dir=RECEIPTS,
            proof_path=ROOT / "data/source-ledger/dataset-proof.json",
            release_proof_path=ROOT / "data/source-ledger/release-proof.json",
        )


def main() -> int:
    parser = argparse.ArgumentParser(description=__doc__)
    action = parser.add_mutually_exclusive_group(required=True)
    action.add_argument("--publish", action="store_true")
    action.add_argument("--check", action="store_true")
    args = parser.parse_args()
    spec = json.loads(SPEC.read_text(encoding="utf-8"))
    payload = project_rows(load_rows(spec), spec)
    publish(payload) if args.publish else check_committed(payload)
    print("PASS: 5 per mille AF 2024, sette parti, 90.627 enti, 22 aggregati territoriali e originali completi verificati")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
