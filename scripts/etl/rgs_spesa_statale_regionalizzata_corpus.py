#!/usr/bin/env python3
"""Project RGS "Spesa Statale Regionalizzata" 2008-2013 and 2020-2022 into public corpus rows.

Same BDAP series as the typed 2023 slice (SRS_SPE_BIL_SPESR_001), one file per
year, fail-closed per year: source bytes, shape, dimensions and the
national/regions/macro-areas reconciliation are pinned in the source lock, and a
year that diverges stops the projection instead of being filled in.

The official CSVs are kept as deterministic gzip fixtures: the lock pins the
original bytes, verified after decompression, so compression is only a way of
storing them (about 4% of the original size).

Each slice has its own lock and is published once; --check verifies all of them.

Schema drift between years is expected and declared, not normalised: 2008-2013,
2020 and 2021 carry an empty eighth column, 2008-2010 have 15 categories instead
of 16, mission 033 "Fondi da ripartire" appears up to 2017 and again in 2021,
and category 09 changes label in 2023. Corpus rows are text cells,
so each year keeps its own labels and codes are never compared across years.
"""

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

import integrated_curated_datasets as corpus
from integrated_corpus_append import append_integrated_datasets

ROOT = Path(__file__).resolve().parents[2]
# One lock per slice, published separately; the corpus accepts only new datasets.
SLICES = {
    "2008-2013": (ROOT / "scripts/etl/specs/rgs-spesa-statale-regionalizzata-2008-2013.source.json", tuple(range(2008, 2014))),
    "2020-2022": (ROOT / "scripts/etl/specs/rgs-spesa-statale-regionalizzata-2020-2022.source.json", (2020, 2021, 2022)),
}
CORPUS_SPEC = ROOT / "scripts/etl/specs/integrated-curated-datasets.source.json"
CATALOG = ROOT / "src/data/generated/integrated/catalog.json"
ROWS_DIR = ROOT / "src/data/generated/integrated/rows"
RECEIPTS_DIR = ROOT / "data/source-ledger/datasets"
DATASET_PROOF = ROOT / "data/source-ledger/dataset-proof.json"
RELEASE_PROOF = ROOT / "data/source-ledger/release-proof.json"

RECORD_ID = "SRS_SPE_BIL_SPESR_001"
SOURCE_HEADERS = [
    "Anno di Interesse",
    "Territorio",
    "Titolo",
    "Categoria",
    "Missione",
    "Tipo Misura",
    "Importo",
]
HEADERS = [
    "Anno",
    "Territorio",
    "Livello territoriale",
    "Titolo",
    "Categoria",
    "Missione",
    "Misura",
    "Valore",
    "URL fonte",
]
TERRITORIES_BY_LEVEL = {
    "Italia": ["ITALIA"],
    "Ripartizione": ["CENTRO", "ISOLE", "NORD-EST", "NORD-OVEST", "SUD"],
    "Regione": [
        "ABRUZZO", "BASILICATA", "CALABRIA", "CAMPANIA", "EMILIA-ROMAGNA",
        "FRIULI-VENEZIA GIULIA", "LAZIO", "LIGURIA", "LOMBARDIA", "MARCHE",
        "MOLISE", "PIEMONTE", "PUGLIA", "SARDEGNA", "SICILIA", "TOSCANA",
        "TRENTINO-ALTO ADIGE/SÜDTIROL", "UMBRIA", "VALLE D'AOSTA/VALLÉE D'AOSTE",
        "VENETO",
    ],
}
LEVEL_OF = {name: level for level, names in TERRITORIES_BY_LEVEL.items() for name in names}
MEASURES = [
    "Spesa Complessiva - Valori Assoluti (mln)",
    "Spesa Complessiva - in rapporto al PIL (%)",
    "Spesa Complessiva - per abitante (Euro)",
    "Spesa Complessiva - per Kmq (Euro)",
]
ABSOLUTE_MEASURE = MEASURES[0]
AMOUNT = re.compile(r"(?:0|[1-9][0-9]*)\.[0-9]{2}\Z")


class SourceError(ValueError):
    """The acquired CSV or the committed projection violates the reviewed contract."""


def expected_metadata(year_entry: dict, series: dict) -> dict:
    """Source metadata the corpus override must carry for one year."""
    return {
        "holder": series["holder"],
        "referencePeriod": f"Esercizio finanziario {year_entry['year']}; spesa del Bilancio dello Stato per territorio destinatario finale",
        "publicationDate": year_entry["publicationDate"],
        "acquisitionDate": series["acquisitionDate"],
        "checkedAt": series["checkedAt"],
        "updateFrequency": series["updateFrequency"],
        # il corpus pretende URL ordinati e unici
        "canonicalUrls": sorted({year_entry["landingUrl"], year_entry["url"]}),
    }


def validate_contract(spec: dict, years: tuple[int, ...]) -> None:
    series = spec.get("series")
    if not isinstance(series, dict):
        raise SourceError("contratto della serie mancante")
    if (
        series.get("recordId") != RECORD_ID
        or series.get("holder") != "Ragioneria Generale dello Stato"
        or series.get("licenseStatus") != "not-declared"
        or series.get("encoding") != "cp1252"
        or series.get("delimiter") != ";"
        or series.get("lineEnding") != "CRLF"
        or series.get("sourceHeaders") != SOURCE_HEADERS
    ):
        raise SourceError("identità, licenza o formato della serie divergenti")
    if [entry.get("year") for entry in spec.get("years", [])] != list(years):
        raise SourceError(f"annualità divergenti dal perimetro {years[0]}-{years[-1]}")

    semantics = spec.get("semantics")
    if not isinstance(semantics, dict) or set(semantics) != {"soldi", "periodo", "provenance"}:
        raise SourceError("assi semantici soldi/periodo/provenance mancanti")
    if semantics["soldi"].get("present") is not True or semantics["soldi"].get("measure") != ABSOLUTE_MEASURE:
        raise SourceError("asse soldi deve dichiarare la sola misura in valori assoluti")
    if semantics["provenance"].get("holder") != series["holder"]:
        raise SourceError("asse provenance divergente")

    corpus_spec = json.loads(CORPUS_SPEC.read_text(encoding="utf-8"))
    overrides = corpus_spec.get("sourceMetadata", {}).get("overrides", {})
    for entry in spec["years"]:
        if entry["datasetId"] != f"rgs-spesa-statale-regionalizzata-{entry['year']}":
            raise SourceError(f"identificativo dataset divergente per il {entry['year']}")
        if not entry["url"].startswith("https://bdap-opendata.rgs.mef.gov.it/"):
            raise SourceError(f"URL non ufficiale per il {entry['year']}")
        if overrides.get(entry["datasetId"]) != expected_metadata(entry, series):
            raise SourceError(f"metadati corpus divergenti dal source lock: {entry['datasetId']}")


def verified_source(entry: dict, input_dir: Path | None = None) -> bytes:
    """Original CSV bytes: from an alternative directory, or decompressed from the fixture."""
    if input_dir is not None:
        payload = (input_dir / f"srs-{entry['year']}.csv").read_bytes()
    else:
        compressed = (ROOT / entry["fixture"]).read_bytes()
        if len(compressed) != entry["compressedBytes"] or corpus.sha256_bytes(compressed) != entry["compressedSha256"]:
            raise SourceError(f"fixture compressa divergente dal lock: {entry['year']}")
        payload = gzip.decompress(compressed)
    if len(payload) != entry["bytes"] or corpus.sha256_bytes(payload) != entry["sha256"]:
        raise SourceError(f"byte sorgente divergenti dal lock: {entry['year']}")
    return payload


def parse_year(payload: bytes, entry: dict, series: dict) -> list[list[str]]:
    try:
        text = payload.decode(series["encoding"], errors="strict")
    except UnicodeDecodeError as error:
        raise SourceError(f"codifica divergente dal lock: {entry['year']}") from error
    if not text.endswith("\r\n"):
        raise SourceError(f"fine riga divergente dal lock: {entry['year']}")
    reader = csv.reader(io.StringIO(text, newline=""), delimiter=series["delimiter"], quotechar='"')
    expected_header = SOURCE_HEADERS + ([""] if entry["trailingEmptyColumn"] else [])
    header = next(reader)
    if header != expected_header:
        raise SourceError(f"intestazione divergente dal lock: {entry['year']}")
    width = len(expected_header)
    rows: list[list[str]] = []
    for number, row in enumerate(reader, start=2):
        if len(row) != width or (entry["trailingEmptyColumn"] and row[-1] != ""):
            raise SourceError(f"riga {number} del {entry['year']}: colonne divergenti")
        row = row[:7]
        if row[0] != str(entry["year"]):
            raise SourceError(f"riga {number}: anno {row[0]!r} in un file del {entry['year']}")
        if row[1] not in LEVEL_OF:
            raise SourceError(f"riga {number} del {entry['year']}: territorio fuori allowlist {row[1]!r}")
        if row[5] not in MEASURES:
            raise SourceError(f"riga {number} del {entry['year']}: misura sconosciuta {row[5]!r}")
        if not AMOUNT.fullmatch(row[6]):
            raise SourceError(f"riga {number} del {entry['year']}: importo non conforme {row[6]!r}")
        if "|" in "".join(row):
            raise SourceError(f"riga {number} del {entry['year']}: separatore del corpus in una cella")
        rows.append(row)
    return rows


def reconciliation(rows: list[list[str]]) -> dict:
    """National total against the sum of regions and of macro-areas, in hundredths of million EUR."""
    totals: dict[str, int] = {}
    for row in rows:
        if row[5] == ABSOLUTE_MEASURE:
            totals[row[1]] = totals.get(row[1], 0) + int(Decimal(row[6]) * 100)
    national = totals.get("ITALIA", 0)
    regions = sum(value for name, value in totals.items() if LEVEL_OF[name] == "Regione")
    macroareas = sum(value for name, value in totals.items() if LEVEL_OF[name] == "Ripartizione")
    return {
        "nationalHundredthsMillionEur": national,
        "regionsHundredthsMillionEur": regions,
        "regionDeltaHundredthsMillionEur": regions - national,
        "macroareasHundredthsMillionEur": macroareas,
        "macroareaDeltaHundredthsMillionEur": macroareas - national,
    }


def validate_year(rows: list[list[str]], entry: dict) -> None:
    expected = entry["expected"]
    keys = {(row[1], row[2], row[3], row[4], row[5]) for row in rows}
    if len(keys) != len(rows):
        raise SourceError(f"combinazioni duplicate nel {entry['year']}")
    observed = {
        "rows": len(rows),
        "territories": len({row[1] for row in rows}),
        "titles": len({row[2] for row in rows}),
        "categories": len({row[3] for row in rows}),
        "missions": len({row[4] for row in rows}),
        "measures": len({row[5] for row in rows}),
        "zeroValues": sum(1 for row in rows if Decimal(row[6]) == 0),
        "reconciliation": reconciliation(rows),
    }
    if observed != expected:
        raise SourceError(f"dimensioni o riconciliazione divergenti dal lock nel {entry['year']}: {observed}")
    ceiling = entry["reconciliationCeilingHundredths"]
    recon = observed["reconciliation"]
    if max(abs(recon["regionDeltaHundredthsMillionEur"]), abs(recon["macroareaDeltaHundredthsMillionEur"])) > ceiling:
        raise SourceError(f"il {entry['year']} non riconcilia entro {ceiling} centesimi di milione")


def projection(rows: list[list[str]], entry: dict) -> bytes:
    output = io.StringIO(newline="")
    writer = csv.writer(output, delimiter="|", lineterminator="\n")
    writer.writerow(HEADERS)
    for anno, territorio, titolo, categoria, missione, misura, importo in rows:
        writer.writerow([anno, territorio, LEVEL_OF[territorio], titolo, categoria, missione, misura, importo, entry["url"]])
    return output.getvalue().encode("utf-8")


def projections(spec: dict, years: tuple[int, ...], input_dir: Path | None = None) -> dict[str, bytes]:
    validate_contract(spec, years)
    payloads: dict[str, bytes] = {}
    for entry in spec["years"]:
        rows = parse_year(verified_source(entry, input_dir), entry, spec["series"])
        validate_year(rows, entry)
        payloads[entry["datasetId"]] = projection(rows, entry)
    return payloads


def check_committed(payloads: dict[str, bytes]) -> None:
    corpus_spec, datasets = corpus.load_spec(CORPUS_SPEC)
    selected = {item["id"]: item for item in datasets if item["id"] in payloads}
    if set(selected) != set(payloads):
        raise SourceError("dataset della spesa statale regionalizzata assenti dalla specifica corpus")
    with tempfile.TemporaryDirectory() as directory:
        source_root = Path(directory)
        catalog = json.loads(CATALOG.read_bytes())
        for dataset_id, payload in payloads.items():
            item = selected[dataset_id]
            (source_root / item["relativePath"]).write_bytes(payload)
            parsed = corpus.parse_dataset(source_root, item)
            entry, expected_rows, expected_receipt, _ = corpus.build_dataset(
                item, parsed, corpus.resolved_source_metadata(corpus_spec, dataset_id)
            )
            actual_rows = b"".join(
                gzip.decompress(path.read_bytes())
                for path in sorted(ROWS_DIR.glob(f"{dataset_id}.part-*.jsonl.gz"))
            )
            actual_receipt = json.loads((RECEIPTS_DIR / f"{dataset_id}.receipt.json").read_bytes())
            actual_entry = next((value for value in catalog["datasets"] if value["id"] == dataset_id), None)
            if expected_rows != actual_rows or expected_receipt != actual_receipt or entry != actual_entry:
                raise SourceError(f"proiezione pubblica divergente dalla fonte RGS: {dataset_id}")


def publish(payloads: dict[str, bytes]) -> None:
    with tempfile.TemporaryDirectory() as directory:
        source_root = Path(directory)
        for dataset_id, payload in payloads.items():
            (source_root / f"{dataset_id}.psv").write_bytes(payload)
        append_integrated_datasets(
            spec_path=CORPUS_SPEC,
            source_root=source_root,
            dataset_ids=set(payloads),
            catalog_path=CATALOG,
            rows_dir=ROWS_DIR,
            receipts_dir=RECEIPTS_DIR,
            proof_path=DATASET_PROOF,
            release_proof_path=RELEASE_PROOF,
        )


def load_slice(name: str) -> tuple[dict, tuple[int, ...]]:
    path, years = SLICES[name]
    return json.loads(path.read_text(encoding="utf-8")), years


def main() -> int:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--slice", choices=sorted(SLICES), help="fetta da proiettare o pubblicare")
    parser.add_argument("--input-dir", type=Path, help="CSV originali srs-ANNO.csv, soggetti allo stesso lock")
    parser.add_argument("--output-dir", type=Path)
    parser.add_argument("--publish", action="store_true")
    parser.add_argument("--check", action="store_true")
    args = parser.parse_args()
    if sum(bool(value) for value in (args.output_dir, args.publish, args.check)) != 1:
        parser.error("specificare una sola azione: --output-dir, --publish o --check")
    if (args.output_dir or args.publish) and not args.slice:
        parser.error("--output-dir e --publish richiedono --slice")
    names = [args.slice] if args.slice else sorted(SLICES)
    if args.output_dir:
        # Prima della registrazione nel corpus: proietta senza controllare gli override.
        spec, _ = load_slice(args.slice)
        args.output_dir.mkdir(parents=True, exist_ok=True)
        for entry in spec["years"]:
            rows = parse_year(verified_source(entry, args.input_dir), entry, spec["series"])
            validate_year(rows, entry)
            body = projection(rows, entry)
            (args.output_dir / f"{entry['datasetId']}.psv").write_bytes(body)
            print(f"{entry['datasetId']}: bytes={len(body)} sha256={corpus.sha256_bytes(body)} rows={len(rows)}")
    else:
        for name in names:
            spec, years = load_slice(name)
            payloads = projections(spec, years, args.input_dir)
            if args.publish:
                publish(payloads)
            else:
                check_committed(payloads)
    print(f"PASS: spesa statale regionalizzata {', '.join(names)}, fonte e riconciliazioni verificate")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
