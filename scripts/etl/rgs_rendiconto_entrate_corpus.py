#!/usr/bin/env python3
"""Project the State revenue outturn (Rendiconto, Titolo I) 2011-2025 into corpus rows (#759).

OpenBDAP (the RGS CKAN) publishes the Rendiconto generale dello Stato, revenue
side, per chapter and article: one package per financial year,
spd_rnd_ent_elb_art_01_<anno> (series RND_ENT_ELB_CAPAR_001), 42 columns with
forecasts, collections and residuals on competence (CP), residuals (RS) and
cash (CS). The corpus keeps only Titolo I (entrate tributarie), aggregated to
one row per year, nature, category and tipologia: the level at which IRPEF,
IRES, IVA and the substitute taxes are identifiable. Titolo II-IV, and so
borrowing (Titolo IV), stay out.

Fail-closed checks, besides bytes, schema and year of every file:

- on every article row of every year, all titles included: accertato (Totale
  CP) = versato + rimasto da versare + rimasto da riscuotere, the same identity
  on residuals, cash collected = collected on residuals + on competence, and
  residuals at 31/12 = what is left to collect on both, to the cent;
- the Titolo I final forecasts of every year equal ENTRATE_TRIBUTARIE of the
  balances file RND_SAL_CRU_ESERC_001, to the cent;
- Titolo I totals, row and group counts of every year are pinned in the lock;
- a CKAN package_show snapshot verifies licence, dates and resource offline.

The balances file reports final forecasts, not outturn: it is a control, not a
source of rows. Only its ENTRATE_TRIBUTARIE column is used.
"""

from __future__ import annotations

import argparse
import csv
import gzip
import io
import json
import re
import tempfile
from collections import defaultdict
from decimal import Decimal
from pathlib import Path

import integrated_curated_datasets as corpus
from integrated_corpus_append import append_integrated_datasets

ROOT = Path(__file__).resolve().parents[2]
SPEC = ROOT / "scripts/etl/specs/rgs-rendiconto-entrate-tributarie.source.json"
CORPUS_SPEC = ROOT / "scripts/etl/specs/integrated-curated-datasets.source.json"
CATALOG = ROOT / "src/data/generated/integrated/catalog.json"
ROWS_DIR = ROOT / "src/data/generated/integrated/rows"
RECEIPTS_DIR = ROOT / "data/source-ledger/datasets"
DATASET_PROOF = ROOT / "data/source-ledger/dataset-proof.json"
RELEASE_PROOF = ROOT / "data/source-ledger/release-proof.json"

DATASET_ID = "rgs-rendiconto-entrate-tributarie-2011-2025"
RECORD_ID = "RND_ENT_ELB_CAPAR_001"
BALANCES_RECORD_ID = "RND_SAL_CRU_ESERC_001"
YEARS = tuple(range(2011, 2026))
TITLE_CODE = "1"
TITLE_LABEL = "TITOLO I - ENTRATE TRIBUTARIE"
BASE_URL = "https://bdap-opendata.rgs.mef.gov.it/"
LICENSE_URL = "http://creativecommons.org/licenses/by/3.0"
LICENSE_DEED = "https://creativecommons.org/licenses/by/3.0/"

SOURCE_HEADERS = [
    "Esercizio Finanziario",
    "Stato di Previsione",
    "Centro Responsabilità",
    "Amministrazione",
    "Numero Capitolo di Entrata",
    "Capitolo di Entrata",
    "Numero Articolo",
    "Articolo",
    "Codice Titolo",
    "Titolo",
    "Codice Natura",
    "Natura",
    "Codice Tipologia",
    "Tipologia",
    "Codice Attività/Provento",
    "Attività/Provento",
    "Codice Categoria",
    "Categoria",
    "Previsioni Iniziali RS",
    "Previsioni Iniziali CP",
    "Previsioni Iniziali CS",
    "Variazioni RS",
    "Variazioni CP",
    "Variazioni CS",
    "Previsioni Definitive RS",
    "Previsioni Definitive CP",
    "Previsioni Definitive CS",
    "Versato RS",
    "Versato CP",
    "Versato CS",
    "Rimasto da Versare RS",
    "Rimasto da Versare CP",
    "Rimasto da Riscuotere RS",
    "Rimasto da Riscuotere CP",
    "Totale RS",
    "Totale CP",
    "Totale CS",
    "Riscosso RS",
    "Maggiori/Minori Entrate RS",
    "Maggiori/Minori Entrate CP",
    "Maggiori/Minori Entrate CS",
    "RS al 31/12",
]
FIRST_AMOUNT = SOURCE_HEADERS.index("Previsioni Iniziali RS")
COLUMN = {name: index for index, name in enumerate(SOURCE_HEADERS)}
# Projected measure -> source column. «Accertato CP» is the source «Totale CP»,
# «Totale residui RS» the source «Totale RS».
MEASURES = [
    ("Previsioni iniziali CP", "Previsioni Iniziali CP"),
    ("Previsioni definitive CP", "Previsioni Definitive CP"),
    ("Accertato CP", "Totale CP"),
    ("Versato CP", "Versato CP"),
    ("Rimasto da versare CP", "Rimasto da Versare CP"),
    ("Rimasto da riscuotere CP", "Rimasto da Riscuotere CP"),
    ("Totale residui RS", "Totale RS"),
    ("Versato RS", "Versato RS"),
    ("Rimasto da versare RS", "Rimasto da Versare RS"),
    ("Rimasto da riscuotere RS", "Rimasto da Riscuotere RS"),
    ("Previsioni definitive CS", "Previsioni Definitive CS"),
    ("Versato CS", "Versato CS"),
    ("Residui al 31/12", "RS al 31/12"),
]
KEY_HEADERS = ["Codice natura", "Natura", "Codice categoria", "Categoria", "Codice tipologia", "Tipologia"]
KEY_SOURCE = ["Codice Natura", "Natura", "Codice Categoria", "Categoria", "Codice Tipologia", "Tipologia"]
HEADERS = ["Anno", *KEY_HEADERS, "Articoli", *(name for name, _ in MEASURES), "URL fonte"]
BALANCES_HEADERS = [
    "ANNO",
    "RISPARMIO_PUBBLICO",
    "SALDO_NETTO",
    "INDEBITAMENTO_NETTO",
    "RICORSO_MERCATO",
    "AVANZO_PRIMARIO",
    "SPESE_CORRENTI",
    "SPESE_INTERESSI",
    "SPESE_CONTO_CAPITALE",
    "SPESE_ACQ_ATT_FINE",
    "SPESE_RIMBORSO_PRESTITI",
    "SPESE_COMPLESSIVE",
    "SPESE_FINALI",
    "SPESE_FIN_NETTO_ATT_FIN",
    "ENTRATE_TRIBUTARIE",
    "ENTRATE_EXTRA_TRIBUTARIE",
    "ENTR_ALIEN_PATR_RISCOS",
    "RISCOSSIONE_CREDITI",
    "ENTR_ACCENSIONE_PRESTITI",
    "ENTRATE_FINALI",
    "ENTR_FIN_NETTO_RISCO_CRED",
    "ENTRATE_CORRENTI",
]
AMOUNT = re.compile(r"-?(?:0|[1-9][0-9]*)\.[0-9]{2}\Z")
CODE = re.compile(r"[1-9][0-9]*\Z")


class SourceError(ValueError):
    """The acquired CSV, its metadata or the committed projection violate the reviewed contract."""


def expected_metadata(spec: dict) -> dict:
    """Source metadata the corpus override must carry."""
    series, years = spec["series"], spec["years"]
    return {
        "holder": series["holder"],
        "referencePeriod": f"Esercizi finanziari {years[0]['year']}-{years[-1]['year']}; {spec['dataset']['scope']}",
        # l'ultimo esercizio pubblicato data la serie
        "publicationDate": max(entry["publicationDate"] for entry in years),
        "acquisitionDate": series["acquisitionDate"],
        "checkedAt": series["checkedAt"],
        "updateFrequency": series["updateFrequency"],
        # ricerca CKAN della serie, pagina e file più recenti, file dei saldi usato come
        # controllo e licenza; ogni riga cita il file del proprio esercizio.
        "canonicalUrls": sorted({
            spec["dataset"]["catalogUrl"], years[-1]["landingUrl"], years[-1]["url"],
            spec["balances"]["url"], LICENSE_DEED,
        }),
    }


def validate_contract(spec: dict, *, check_corpus: bool = True) -> None:
    series = spec.get("series")
    if not isinstance(series, dict):
        raise SourceError("contratto della serie mancante")
    license_ = series.get("license")
    if (
        series.get("holder") != "Ragioneria Generale dello Stato"
        or series.get("licenseStatus") != "verified-open-cc-by-3.0"
        or not isinstance(license_, dict)
        or license_.get("url") != LICENSE_URL
        or license_.get("ckanLicenseId") != "cc-by"
        or series.get("encoding") != "cp1252"
        or series.get("delimiter") != ";"
        or series.get("lineEnding") != "CRLF"
        or series.get("sourceHeaders") != SOURCE_HEADERS
        or series.get("titleCode") != TITLE_CODE
    ):
        raise SourceError("identità, licenza, formato o perimetro della serie divergenti")
    dataset = spec.get("dataset")
    if (
        not isinstance(dataset, dict)
        or dataset.get("datasetId") != DATASET_ID
        or dataset.get("recordId") != RECORD_ID
        or dataset.get("catalogUrl") != f"{BASE_URL}SpodCkanApi/api/3/action/package_search?q={RECORD_ID}"
    ):
        raise SourceError("identità del dataset divergente")
    if [entry.get("year") for entry in spec.get("years", [])] != list(YEARS):
        raise SourceError("esercizi divergenti dal perimetro 2011-2025")
    for entry in spec["years"]:
        year = entry["year"]
        if entry["packageName"] != f"spd_rnd_ent_elb_art_01_{year}":
            raise SourceError(f"pacchetto CKAN divergente: {year}")
        if entry["url"] != f"{BASE_URL}SpodCkanApi/api/3/datastore/dump/{entry['packageId']}.csv":
            raise SourceError(f"URL del file non ufficiale: {year}")
        if entry["landingUrl"] != f"{BASE_URL}content/{year}-rendiconto-pubblicato-elaborabile-entrate-articolo?metadati=showall":
            raise SourceError(f"pagina ufficiale divergente: {year}")
        if not isinstance(entry.get("trailingSeparator"), bool):
            raise SourceError(f"formato di fine riga non dichiarato: {year}")
    balances = spec.get("balances")
    if (
        not isinstance(balances, dict)
        or balances.get("recordId") != BALANCES_RECORD_ID
        or balances.get("url") != f"{BASE_URL}SpodCkanApi/api/3/datastore/dump/{balances.get('packageId')}.csv"
        or balances.get("sourceHeaders") != BALANCES_HEADERS
        or balances.get("column") != "ENTRATE_TRIBUTARIE"
        or balances.get("firstYear", 0) > YEARS[0]
        or balances.get("lastYear", 0) < YEARS[-1]
    ):
        raise SourceError("contratto del file dei saldi divergente")
    if check_corpus:
        corpus_spec = json.loads(CORPUS_SPEC.read_text(encoding="utf-8"))
        overrides = corpus_spec.get("sourceMetadata", {}).get("overrides", {})
        if overrides.get(DATASET_ID) != expected_metadata(spec):
            raise SourceError(f"metadati corpus divergenti dal source lock: {DATASET_ID}")


def locked_fixture(entry: dict) -> bytes:
    """Decompressed bytes of a committed gzip fixture, after checking the compressed bytes."""
    compressed = (ROOT / entry["fixture"]).read_bytes()
    if len(compressed) != entry["compressedBytes"] or corpus.sha256_bytes(compressed) != entry["compressedSha256"]:
        raise SourceError(f"fixture compressa divergente dal lock: {entry['packageName']}")
    return gzip.decompress(compressed)


def verified_source(entry: dict, input_dir: Path | None = None) -> bytes:
    """Original CSV bytes: from a directory of <pacchetto CKAN>.csv, or decompressed from the fixture."""
    if input_dir is not None:
        payload = (input_dir / f"{entry['packageName']}.csv").read_bytes()
    else:
        payload = locked_fixture(entry)
    if len(payload) != entry["bytes"] or corpus.sha256_bytes(payload) != entry["sha256"]:
        raise SourceError(f"byte sorgente divergenti dal lock: {entry['packageName']}")
    return payload


def verify_package_metadata(spec: dict) -> None:
    """CKAN package_show snapshot: licence, dates, title, record and resource of every locked file."""
    packages = json.loads(locked_fixture(spec["ckanSnapshot"]))
    entries = [*spec["years"], spec["balances"]]
    if sorted(packages) != sorted(entry["packageName"] for entry in entries):
        raise SourceError("istantanea CKAN: pacchetti mancanti o inattesi")
    for entry in entries:
        package = packages[entry["packageName"]]
        record = entry.get("recordId", RECORD_ID)
        resources = [item for item in package.get("resources", []) if item.get("mimetype") == "text/csv"]
        if (
            package.get("id") != entry["packageId"]
            or package.get("license_id") != spec["series"]["license"]["ckanLicenseId"]
            or package.get("metadata_created", "")[:10] != entry["publicationDate"]
            or package.get("metadata_modified", "")[:10] != entry["metadataModified"]
            or package.get("title") != entry["title"]
            or not re.search(rf"\[(?:\d{{4}}_)?{record}\]", package.get("notes", ""))
            or len(resources) != 1
            or resources[0]["url"].replace("http://", "https://", 1) != entry["url"]
            or int(resources[0]["size"]) != entry["bytes"]
        ):
            raise SourceError(f"metadati CKAN divergenti dal lock: {entry['packageName']}")


def decoded_lines(payload: bytes, label: str, series: dict) -> str:
    try:
        text = payload.decode(series["encoding"], errors="strict")
    except UnicodeDecodeError as error:
        raise SourceError(f"codifica divergente dal lock: {label}") from error
    if not text.endswith("\r\n") or "\n" in text.replace("\r\n", ""):
        raise SourceError(f"fine riga divergente dal lock: {label}")
    return text


def read_rows(payload: bytes, entry: dict, series: dict) -> list[list[str]]:
    """Article rows of one year; every row has the 42 columns and the year of the file."""
    label, year = entry["packageName"], entry["year"]
    text = decoded_lines(payload, label, series)
    reader = csv.reader(io.StringIO(text, newline=""), delimiter=series["delimiter"], quotechar='"', strict=True)
    # fino al 2023 ogni riga, intestazione compresa, termina con il separatore
    tail = [""] if entry["trailingSeparator"] else []
    width = len(SOURCE_HEADERS) + len(tail)
    if next(reader) != [*SOURCE_HEADERS, *tail]:
        raise SourceError(f"intestazione divergente dal lock: {label}")
    rows: list[list[str]] = []
    for number, row in enumerate(reader, start=2):
        if len(row) != width or row[len(SOURCE_HEADERS):] != tail:
            raise SourceError(f"riga {number} di {label}: colonne divergenti")
        row = row[: len(SOURCE_HEADERS)]
        if row[0] != str(year):
            raise SourceError(f"riga {number}: esercizio {row[0]!r} in {label}")
        if not all(AMOUNT.fullmatch(value) for value in row[FIRST_AMOUNT:]):
            raise SourceError(f"riga {number} di {label}: importo non conforme")
        rows.append(row)
    return rows


def amount(row: list[str], column: str) -> Decimal:
    return Decimal(row[COLUMN[column]])


IDENTITIES = {
    # accertato in competenza
    "Totale CP": ("Versato CP", "Rimasto da Versare CP", "Rimasto da Riscuotere CP"),
    # gestione dei residui
    "Totale RS": ("Versato RS", "Rimasto da Versare RS", "Rimasto da Riscuotere RS"),
    # cassa = versato sui residui + versato in competenza
    "Versato CS": ("Versato RS", "Versato CP"),
    "Totale CS": ("Versato CS",),
    # residui a fine esercizio = rimasto da versare e da riscuotere, residui e competenza
    "RS al 31/12": ("Rimasto da Versare RS", "Rimasto da Riscuotere RS", "Rimasto da Versare CP", "Rimasto da Riscuotere CP"),
}


def check_identities(rows: list[list[str]], label: str) -> Decimal:
    """Accounting identities on every article row, to the cent; returns the largest residual (zero)."""
    for number, row in enumerate(rows, start=2):
        for total, parts in IDENTITIES.items():
            residual = amount(row, total) - sum((amount(row, part) for part in parts), Decimal("0.00"))
            if residual:
                raise SourceError(
                    f"riga {number} di {label}: {total} diverso da {' + '.join(parts)} di {residual} euro"
                )
    return Decimal("0.00")


def aggregate(rows: list[list[str]], label: str) -> list[list[str]]:
    """Titolo I rows grouped by nature, category and tipologia, measures summed exactly."""
    groups: dict[tuple[int, int, int], dict] = {}
    for number, row in enumerate(rows, start=2):
        if row[COLUMN["Codice Titolo"]] != TITLE_CODE:
            continue
        if row[COLUMN["Titolo"]] != TITLE_LABEL:
            raise SourceError(f"riga {number} di {label}: etichetta del Titolo I divergente")
        key_cells = [row[COLUMN[name]] for name in KEY_SOURCE]
        codes = key_cells[0::2]
        if not all(CODE.fullmatch(code) for code in codes):
            raise SourceError(f"riga {number} di {label}: codice di natura, categoria o tipologia non conforme")
        if any(not cell.strip() or cell != cell.strip() or "|" in cell for cell in key_cells):
            raise SourceError(f"riga {number} di {label}: etichetta vuota, con spazi esterni o con il separatore del corpus")
        key = (int(codes[0]), int(codes[1]), int(codes[2]))
        group = groups.setdefault(key, {"labels": key_cells, "articles": 0, "sums": [Decimal("0.00")] * len(MEASURES)})
        if group["labels"] != key_cells:
            raise SourceError(f"riga {number} di {label}: etichette divergenti per lo stesso codice {key}")
        group["articles"] += 1
        group["sums"] = [total + amount(row, column) for total, (_, column) in zip(group["sums"], MEASURES)]
    return [
        [*groups[key]["labels"], str(groups[key]["articles"]), *(str(value) for value in groups[key]["sums"])]
        for key in sorted(groups)
    ]


def observed_year(rows: list[list[str]], groups: list[list[str]]) -> dict:
    first = len(KEY_HEADERS) + 1
    totals = {
        name: str(sum((Decimal(group[first + index]) for group in groups), Decimal("0.00")))
        for index, (name, _) in enumerate(MEASURES)
    }
    return {
        "rows": len(rows),
        "titleIRows": sum(int(group[len(KEY_HEADERS)]) for group in groups),
        "groups": len(groups),
        "titleITotals": totals,
    }


def parse_year(payload: bytes, entry: dict, series: dict) -> list[list[str]]:
    rows = read_rows(payload, entry, series)
    check_identities(rows, entry["packageName"])
    groups = aggregate(rows, entry["packageName"])
    observed = observed_year(rows, groups)
    if observed != entry["expected"]:
        raise SourceError(f"dimensioni o totali divergenti dal lock in {entry['packageName']}: {observed}")
    return groups


def balances_by_year(payload: bytes, spec: dict) -> dict[int, Decimal]:
    """ENTRATE_TRIBUTARIE of the balances file, by year."""
    lock = spec["balances"]
    text = decoded_lines(payload, lock["packageName"], spec["series"])
    reader = csv.reader(io.StringIO(text, newline=""), delimiter=";", quotechar='"', strict=True)
    if next(reader) != [*BALANCES_HEADERS, ""]:
        raise SourceError("intestazione del file dei saldi divergente dal lock")
    column = BALANCES_HEADERS.index(lock["column"])
    values: dict[int, Decimal] = {}
    for number, row in enumerate(reader, start=2):
        if len(row) != len(BALANCES_HEADERS) + 1 or row[-1] != "" or not re.fullmatch(r"\d{4}", row[0]):
            raise SourceError(f"riga {number} del file dei saldi: colonne o anno divergenti")
        if not all(AMOUNT.fullmatch(value) for value in row[1:-1]):
            raise SourceError(f"riga {number} del file dei saldi: importo non conforme")
        year = int(row[0])
        if year in values:
            raise SourceError(f"anno {year} duplicato nel file dei saldi")
        values[year] = Decimal(row[column])
    if sorted(values) != list(range(lock["firstYear"], lock["lastYear"] + 1)):
        raise SourceError("anni del file dei saldi divergenti dal lock")
    return values


def reconcile_balances(parsed: list[tuple[dict, list[list[str]]]], balances: dict[int, Decimal]) -> dict[int, Decimal]:
    """Titolo I final forecasts (CP) must equal ENTRATE_TRIBUTARIE of the balances file, every year."""
    index = len(KEY_HEADERS) + 1 + [name for name, _ in MEASURES].index("Previsioni definitive CP")
    gaps: dict[int, Decimal] = {}
    for entry, groups in parsed:
        forecast = sum((Decimal(group[index]) for group in groups), Decimal("0.00"))
        gaps[entry["year"]] = forecast - balances[entry["year"]]
        if gaps[entry["year"]]:
            raise SourceError(
                f"esercizio {entry['year']}: previsioni definitive del Titolo I {forecast} diverse da "
                f"ENTRATE_TRIBUTARIE del file dei saldi {balances[entry['year']]}"
            )
    return gaps


def projection(parsed: list[tuple[dict, list[list[str]]]]) -> bytes:
    output = io.StringIO(newline="")
    writer = csv.writer(output, delimiter="|", lineterminator="\n")
    writer.writerow(HEADERS)
    for entry, groups in parsed:
        for group in groups:
            writer.writerow([str(entry["year"]), *group, entry["url"]])
    return output.getvalue().encode("utf-8")


def parsed_years(spec: dict, input_dir: Path | None = None) -> list[tuple[dict, list[list[str]]]]:
    return [
        (entry, parse_year(verified_source(entry, input_dir), entry, spec["series"]))
        for entry in spec["years"]
    ]


def projections(spec: dict, input_dir: Path | None = None, *, check_corpus: bool = True) -> dict[str, bytes]:
    validate_contract(spec, check_corpus=check_corpus)
    verify_package_metadata(spec)
    parsed = parsed_years(spec, input_dir)
    balances = balances_by_year(verified_source(spec["balances"], input_dir), spec)
    reconcile_balances(parsed, balances)
    return {DATASET_ID: projection(parsed)}


def check_committed(payloads: dict[str, bytes]) -> None:
    corpus_spec, datasets = corpus.load_spec(CORPUS_SPEC)
    selected = {item["id"]: item for item in datasets if item["id"] in payloads}
    if set(selected) != set(payloads):
        raise SourceError("dataset delle entrate tributarie assente dalla specifica corpus")
    catalog = json.loads(CATALOG.read_bytes())
    with tempfile.TemporaryDirectory() as directory:
        source_root = Path(directory)
        for dataset_id, payload in payloads.items():
            item = selected[dataset_id]
            (source_root / item["relativePath"]).write_bytes(payload)
            parsed = corpus.parse_dataset(source_root, item)
            entry, expected_rows, expected_receipt, _ = corpus.build_dataset(
                item, parsed, corpus.resolved_source_metadata(corpus_spec, dataset_id)
            )
            actual_rows = b"".join(
                gzip.decompress(path.read_bytes()) for path in sorted(ROWS_DIR.glob(f"{dataset_id}.part-*.jsonl.gz"))
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


def load_spec(path: Path = SPEC) -> dict:
    return json.loads(path.read_text(encoding="utf-8"))


def main() -> int:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--input-dir", type=Path, help="CSV originali <pacchetto CKAN>.csv, soggetti allo stesso lock")
    parser.add_argument("--output-dir", type=Path)
    parser.add_argument("--publish", action="store_true")
    parser.add_argument("--check", action="store_true")
    args = parser.parse_args()
    if sum(bool(value) for value in (args.output_dir, args.publish, args.check)) != 1:
        parser.error("specificare una sola azione: --output-dir, --publish o --check")
    spec = load_spec()
    if args.output_dir:
        # Prima della registrazione nel corpus: proietta senza controllare l'override.
        payloads = projections(spec, args.input_dir, check_corpus=False)
        args.output_dir.mkdir(parents=True, exist_ok=True)
        for dataset_id, body in payloads.items():
            (args.output_dir / f"{dataset_id}.psv").write_bytes(body)
            print(f"{dataset_id}: bytes={len(body)} sha256={corpus.sha256_bytes(body)} rows={body.count(b'\n') - 1}")
    else:
        payloads = projections(spec, args.input_dir)
        if args.publish:
            publish(payloads)
        else:
            check_committed(payloads)
    print("PASS: Rendiconto dello Stato, entrate tributarie 2011-2025; identità per articolo e saldi verificati")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
