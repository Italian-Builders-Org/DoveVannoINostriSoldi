#!/usr/bin/env python3
"""Project RGS Conto Annuale employment by single administration 2010-2024 into corpus rows (#586).

OpenBDAP (the RGS CKAN) publishes one package per survey year,
spd_pca_occ_dip_ente_01_<anno> (series PCA_OCC_DIP_ENTE_001): one row per
administration, contract, macro-category and category, with the same fourteen
measures of the by-type series PCA_OCC_DIP_TENT_001. Each year is summed per
administration (Codice Istituzione) and becomes part of one corpus dataset with
the column Anno: one row per year and administration.

The original CSVs weigh 9-13 MB each (about 148 MB in all) and are not
versioned: like the MEF real-estate census, they stay in a local directory
passed with --input-dir and are verified byte for byte (size and SHA-256)
against the source lock. Only the 2020 file is already in the repository, as
the gzip fixture of the by-type lock (#758), and is reused here.

Two modes, both fail-closed:

- with --input-dir every original is verified against the lock, parsed and
  summed per administration; the projection must match the pinned SHA-256 and
  the committed corpus rows, receipt and catalog entry;
- without --input-dir (offline) the committed corpus rows are read back and
  must reproduce the same pinned projection; the 2020 rows are recomputed from
  the committed fixture.

In both modes, for every year, the per-administration rows summed by type of
administration must give back the by-type file locked by
rgs_conto_annuale_occupazione_corpus.py: permanent staff exactly, flexible work
within the rounding of the integer years (exact from 2021), with the observed
residuals pinned per year. Counts and totals of every year are pinned too.

Flexible work is expressed in annual labour units, not heads, and is never
added to the headcount.
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
from pathlib import Path

import integrated_curated_datasets as corpus
import rgs_conto_annuale_occupazione_corpus as tipologia
from integrated_corpus_append import append_integrated_datasets

ROOT = Path(__file__).resolve().parents[2]
SPEC = ROOT / "scripts/etl/specs/rgs-conto-annuale-occupazione-ente.source.json"
CORPUS_SPEC = ROOT / "scripts/etl/specs/integrated-curated-datasets.source.json"
CATALOG = ROOT / "src/data/generated/integrated/catalog.json"
ROWS_DIR = ROOT / "src/data/generated/integrated/rows"
RECEIPTS_DIR = ROOT / "data/source-ledger/datasets"
DATASET_PROOF = ROOT / "data/source-ledger/dataset-proof.json"
RELEASE_PROOF = ROOT / "data/source-ledger/release-proof.json"

DATASET_ID = "rgs-conto-annuale-occupazione-ente-2010-2024"
RECORD_ID = "PCA_OCC_DIP_ENTE_001"
YEARS = tipologia.YEARS
BASE_URL = tipologia.BASE_URL
LICENSE_URL = tipologia.LICENSE_URL
LICENSE_DEED = tipologia.LICENSE_DEED
MEASURES = tipologia.MEASURES
PERMANENT = tipologia.PERMANENT
FLEXIBLE = tipologia.FLEXIBLE
FULL_TIME = tipologia.FULL_TIME
PART_TIME = tipologia.PART_TIME
SOURCE_HEADERS = tipologia.ENTE_HEADERS
HEADERS = [
    "Anno",
    "Codice istituzione",
    "Codice ente BDAP",
    "Ente",
    "Tipo istituzione",
    "Comparto",
    *MEASURES,
    "URL fonte",
]
FIRST_MEASURE = HEADERS.index(MEASURES[0])
# Comparti di un ente con più contratti (università, ministeri…): elencati in ordine alfabetico.
COMPARTO_SEPARATOR = " / "
CODE = re.compile(r"[1-9][0-9]*\Z")
BDAP_CODE = re.compile(r"(?:[0-9]+)?\Z")
# Flexible work in the by-type file is rounded once per type; in the per-administration
# file of the integer years (2010-2020) once per administration, contract and category.
# Measured maximum 69 units (2019); fixed here as well as pinned per year in the lock,
# so that a lock cannot loosen it. From 2021 both files carry two decimals and the
# sums coincide to the hundredth: no tolerance.
FLEXIBLE_ROUNDING_TOLERANCE = {"integer": 100, "decimal2": 0}


class SourceError(ValueError):
    """The acquired CSV, its metadata or the committed projection violate the reviewed contract."""


def expected_metadata(spec: dict) -> dict:
    """Source metadata the corpus override must carry."""
    series, years = spec["series"], spec["years"]
    return {
        "holder": series["holder"],
        "referencePeriod": f"Rilevazioni {years[0]['year']}-{years[-1]['year']}; {spec['dataset']['scope']}",
        # l'ultima annualità pubblicata data la serie
        "publicationDate": max(entry["publicationDate"] for entry in years),
        "acquisitionDate": series["acquisitionDate"],
        "checkedAt": series["checkedAt"],
        "updateFrequency": series["updateFrequency"],
        # come per la serie per tipologia: ricerca CKAN, pagina e file più recenti, licenza;
        # ogni riga cita il file del proprio anno e il lock conserva pagina e file di ogni anno.
        "canonicalUrls": sorted({
            spec["dataset"]["catalogUrl"], years[-1]["landingUrl"], years[-1]["url"], LICENSE_DEED,
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
    ):
        raise SourceError("identità, licenza o formato della serie divergenti")
    dataset = spec.get("dataset")
    if (
        not isinstance(dataset, dict)
        or dataset.get("datasetId") != DATASET_ID
        or dataset.get("recordId") != RECORD_ID
        or dataset.get("catalogUrl") != f"{BASE_URL}SpodCkanApi/api/3/action/package_search?q={RECORD_ID}"
    ):
        raise SourceError("identità del dataset divergente")
    if [entry.get("year") for entry in spec.get("years", [])] != list(YEARS):
        raise SourceError("annualità divergenti dal perimetro 2010-2024")
    for entry in spec["years"]:
        year = entry["year"]
        if entry["packageName"] != f"spd_pca_occ_dip_ente_01_{year}":
            raise SourceError(f"pacchetto CKAN divergente: {year}")
        if entry["url"] != f"{BASE_URL}SpodCkanApi/api/3/datastore/dump/{entry['packageId']}.csv":
            raise SourceError(f"URL del file non ufficiale: {year}")
        if entry["landingUrl"] != f"{BASE_URL}content/{year}-dipendenti-pubblici-occupazione-complessiva-dati-analitici-ente?metadati=show":
            raise SourceError(f"pagina ufficiale divergente: {year}")
        if entry["valueFormat"] != ("integer" if year <= 2020 else "decimal2"):
            raise SourceError(f"formato dei valori divergente: {year}")
        if not isinstance(entry.get("trailingSeparator"), bool):
            raise SourceError(f"separatore finale non dichiarato: {year}")
    # Il 2020 è lo stesso file già vincolato come fixture dalla serie per tipologia (#758).
    fixture = tipologia.load_spec()["perAdministration2020"]
    entry_2020 = next(entry for entry in spec["years"] if entry["year"] == 2020)
    if any(entry_2020[key] != fixture[key] for key in ("packageName", "packageId", "url", "bytes", "sha256")):
        raise SourceError("file per ente 2020 divergente dalla fixture della serie per tipologia")
    if check_corpus:
        projection_ = spec.get("projection")
        if not isinstance(projection_, dict) or set(projection_) != {"bytes", "sha256", "rows"}:
            raise SourceError("impronta della proiezione mancante")
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


def verified_source(entry: dict, input_dir: Path) -> bytes:
    """Original CSV bytes from a directory of <pacchetto CKAN>.csv, checked against the lock."""
    path = input_dir / f"{entry['packageName']}.csv"
    if not path.is_file():
        raise SourceError(f"CSV originale mancante: {path.name}")
    payload = path.read_bytes()
    if len(payload) != entry["bytes"] or corpus.sha256_bytes(payload) != entry["sha256"]:
        raise SourceError(f"byte sorgente divergenti dal lock: {entry['packageName']}")
    return payload


def fixture_2020() -> bytes:
    """The 2020 original, decompressed from the by-type lock's fixture (same bytes and SHA-256)."""
    entry = tipologia.load_spec()["perAdministration2020"]
    return tipologia.verified_source(entry)


def verify_package_metadata(spec: dict) -> None:
    """CKAN package_show snapshot: licence, dates, resource and observed date of every locked file."""
    packages = json.loads(locked_fixture(spec["ckanSnapshot"]))
    if sorted(packages) != sorted(entry["packageName"] for entry in spec["years"]):
        raise SourceError("istantanea CKAN: pacchetti mancanti o inattesi")
    for entry in spec["years"]:
        package = packages[entry["packageName"]]
        observed = re.search(r"Dati osservati al (\d{2})/(\d{2})/(\d{4})", package.get("notes", ""))
        resources = [item for item in package.get("resources", []) if item.get("mimetype") == "text/csv"]
        if (
            package.get("id") != entry["packageId"]
            or package.get("license_id") != spec["series"]["license"]["ckanLicenseId"]
            or package.get("metadata_created", "")[:10] != entry["publicationDate"]
            or package.get("metadata_modified", "")[:10] != entry["metadataModified"]
            or package.get("title") != entry["title"]
            or f"[{RECORD_ID}]" not in package.get("notes", "")
            or observed is None
            or f"{observed[3]}-{observed[2]}-{observed[1]}" != entry["dataObservedAt"]
            or len(resources) != 1
            or resources[0]["url"].replace("http://", "https://", 1) != entry["url"]
            or int(resources[0]["size"]) != entry["bytes"]
        ):
            raise SourceError(f"metadati CKAN divergenti dal lock: {entry['packageName']}")


def read_rows(payload: bytes, entry: dict, series: dict) -> list[list[str]]:
    """CSV rows of one year; the 2023 file has no trailing separator, the others do."""
    label = entry["packageName"]
    try:
        text = payload.decode(series["encoding"], errors="strict")
    except UnicodeDecodeError as error:
        raise SourceError(f"codifica divergente dal lock: {label}") from error
    if not text.endswith("\r\n") or "\n" in text.replace("\r\n", ""):
        raise SourceError(f"fine riga divergente dal lock: {label}")
    trailing = [""] if entry["trailingSeparator"] else []
    reader = csv.reader(io.StringIO(text, newline=""), delimiter=series["delimiter"], quotechar='"')
    if next(reader) != [*SOURCE_HEADERS, *trailing]:
        raise SourceError(f"intestazione divergente dal lock: {label}")
    width = len(SOURCE_HEADERS) + len(trailing)
    rows: list[list[str]] = []
    for number, row in enumerate(reader, start=2):
        if len(row) != width or (trailing and row[-1] != ""):
            raise SourceError(f"riga {number} di {label}: colonne divergenti")
        row = row[:len(SOURCE_HEADERS)]
        if row[0] != str(entry["year"]):
            raise SourceError(f"riga {number}: anno {row[0]!r} in {label}")
        rows.append(row)
    return rows


def hundredths(value: str) -> int:
    return tipologia.hundredths(value)


def format_value(value: int, value_format: str) -> str:
    """A sum in hundredths, written as the source writes that year: integer or two decimals."""
    if value_format == "integer":
        if value % 100:
            raise SourceError(f"somma non intera in un anno a valori interi: {value}")
        return str(value // 100)
    return f"{value // 100}.{value % 100:02d}"


def aggregate(payload: bytes, entry: dict, series: dict) -> list[list[str]]:
    """One row per administration: identity columns checked constant, the fourteen measures summed."""
    label = entry["packageName"]
    permanent, flexible = tipologia.VALUE_FORMATS[entry["valueFormat"]]
    identity: dict[str, tuple[str, str, str]] = {}
    comparti: dict[str, set[str]] = defaultdict(set)
    sums: dict[str, list[int]] = defaultdict(lambda: [0] * len(MEASURES))
    source_rows = read_rows(payload, entry, series)
    if len(source_rows) != entry["sourceRows"]:
        raise SourceError(f"righe sorgente divergenti dal lock in {label}: {len(source_rows)}")
    for number, row in enumerate(source_rows, start=2):
        tipo, code, bdap, name, comparto = row[1], row[2], row[3], row[4], row[6]
        if any(cell != cell.strip() or "|" in cell for cell in row):
            raise SourceError(f"riga {number} di {label}: spazi esterni o separatore del corpus")
        if not CODE.fullmatch(code) or not BDAP_CODE.fullmatch(bdap) or not tipo or not name or not comparto:
            raise SourceError(f"riga {number} di {label}: codice, tipo, ente o comparto non conforme")
        values = row[13:]
        if not all(permanent.fullmatch(value) for value in values[PERMANENT]):
            raise SourceError(f"riga {number} di {label}: personale non intero o negativo {values[PERMANENT]}")
        if not all(flexible.fullmatch(value) for value in values[FLEXIBLE]):
            raise SourceError(f"riga {number} di {label}: lavoro flessibile non conforme {values[FLEXIBLE]}")
        if identity.setdefault(code, (tipo, bdap, name)) != (tipo, bdap, name):
            raise SourceError(f"istituzione {code} con tipo, codice BDAP o denominazione diversi in {label}")
        comparti[code].add(comparto)
        totals = sums[code]
        for index, value in enumerate(values):
            totals[index] += hundredths(value)
    rows = []
    for code in sorted(identity, key=int):
        tipo, bdap, name = identity[code]
        rows.append([
            str(entry["year"]), code, bdap, name, tipo, COMPARTO_SEPARATOR.join(sorted(comparti[code])),
            *(format_value(value, entry["valueFormat"]) for value in sums[code]),
            entry["url"],
        ])
    return rows


def measures(row: list[str]) -> list[int]:
    return [hundredths(value) for value in row[FIRST_MEASURE:FIRST_MEASURE + len(MEASURES)]]


def observed_year(rows: list[list[str]], entry: dict) -> dict:
    """Pinned counts and totals of one projected year."""
    sums = [0] * len(MEASURES)
    for row in rows:
        for index, value in enumerate(measures(row)):
            sums[index] += value
    full_time, part_time = sum(sums[FULL_TIME]) // 100, sum(sums[PART_TIME]) // 100
    return {
        "institutions": len(rows),
        "types": len({row[4] for row in rows}),
        "multipleComparti": sum(COMPARTO_SEPARATOR in row[5] for row in rows),
        "withoutBdapCode": sum(not row[2] for row in rows),
        "withoutStaff": sum(not any(measures(row)) for row in rows),
        "fullTime": full_time,
        "partTime": part_time,
        "permanent": full_time + part_time,
        "flexibleHundredths": sum(sums[FLEXIBLE]),
    }


def cross_check_types(rows: list[list[str]], tent_rows: list[list[str]], entry: dict) -> dict:
    """Per-administration rows summed by type must give back the by-type file of the same year."""
    year = entry["year"]
    sums: dict[str, list[int]] = defaultdict(lambda: [0] * len(MEASURES))
    for row in rows:
        totals = sums[row[4]]
        for index, value in enumerate(measures(row)):
            totals[index] += value
    published = tipologia.by_type(tent_rows)
    if set(sums) != set(published):
        raise SourceError(f"tipi {year} divergenti dal file per tipologia: {sorted(set(sums) ^ set(published))}")
    tolerance = FLEXIBLE_ROUNDING_TOLERANCE[entry["valueFormat"]] * 100
    deltas = {name: [a - b for a, b in zip(sums[name], published[name])] for name in published}
    for name, delta in sorted(deltas.items()):
        if any(delta[PERMANENT]):
            raise SourceError(f"personale {year} di {name} non ricalcolabile dal file per ente: {delta[PERMANENT]}")
        worst = max(abs(value) for value in delta[FLEXIBLE])
        if worst > tolerance:
            raise SourceError(f"lavoro flessibile {year} di {name} fuori tolleranza di arrotondamento: {worst / 100}")
    return {
        "flexibleDeltaByMeasureHundredths": [sum(delta[index] for delta in deltas.values()) for index in range(6, 14)],
        "flexibleSumAbsDeltaHundredths": sum(abs(value) for delta in deltas.values() for value in delta[FLEXIBLE]),
        "flexibleMaxAbsDeltaHundredths": max(abs(value) for delta in deltas.values() for value in delta[FLEXIBLE]),
    }


def validate_year(rows: list[list[str]], tent_rows: list[list[str]], entry: dict) -> None:
    """Shape, uniqueness, pinned totals and by-type cross-check of one projected year."""
    year = str(entry["year"])
    if any(len(row) != len(HEADERS) or row[0] != year or row[-1] != entry["url"] for row in rows):
        raise SourceError(f"righe {year}: colonne, anno o URL fonte divergenti")
    codes = [row[1] for row in rows]
    if len(set(codes)) != len(codes):
        raise SourceError(f"istituzione duplicata nel {year}")
    if codes != sorted(codes, key=int):
        raise SourceError(f"righe {year} non ordinate per codice istituzione")
    observed = {**observed_year(rows, entry), "typeCrossCheck": cross_check_types(rows, tent_rows, entry)}
    if observed != entry["expected"]:
        raise SourceError(f"dimensioni, totali o ricalcolo per tipo divergenti dal lock nel {year}: {observed}")


def projection(rows: list[list[str]]) -> bytes:
    output = io.StringIO(newline="")
    writer = csv.writer(output, delimiter="|", lineterminator="\n")
    writer.writerow(HEADERS)
    writer.writerows(rows)
    return output.getvalue().encode("utf-8")


def committed_rows() -> list[list[str]]:
    """Corpus rows already published, back in projection order and column order."""
    parts = sorted(ROWS_DIR.glob(f"{DATASET_ID}.part-*.jsonl.gz"))
    if not parts:
        raise SourceError(f"righe del corpus assenti: {DATASET_ID}")
    rows = []
    for path in parts:
        for line in gzip.decompress(path.read_bytes()).splitlines():
            cells = json.loads(line)["cells"]
            if sorted(cells) != sorted(HEADERS):
                raise SourceError(f"colonne del corpus divergenti in {path.name}")
            rows.append([cells[header] for header in HEADERS])
    return rows


def by_year(rows: list[list[str]]) -> dict[int, list[list[str]]]:
    grouped: dict[int, list[list[str]]] = {year: [] for year in YEARS}
    for row in rows:
        if not row[0].isdigit() or int(row[0]) not in grouped:
            raise SourceError(f"anno fuori perimetro nel corpus: {row[0]!r}")
        grouped[int(row[0])].append(row)
    if [row[0] for row in rows] != sorted((row[0] for row in rows), key=int):
        raise SourceError("righe del corpus non ordinate per anno")
    return grouped


def projected_rows(spec: dict, input_dir: Path | None) -> list[list[str]]:
    """From the originals (--input-dir) or, offline, from the committed corpus rows."""
    if input_dir is not None:
        rows = []
        for entry in spec["years"]:
            rows.extend(aggregate(verified_source(entry, input_dir), entry, spec["series"]))
        return rows
    rows = committed_rows()
    # offline il 2020 resta ricalcolabile: il file originale è la fixture della serie per tipologia
    entry_2020 = next(entry for entry in spec["years"] if entry["year"] == 2020)
    if by_year(rows)[2020] != aggregate(fixture_2020(), entry_2020, spec["series"]):
        raise SourceError("righe 2020 del corpus divergenti dal file per ente vincolato")
    return rows


def projections(spec: dict, input_dir: Path | None = None, *, check_corpus: bool = True) -> dict[str, bytes]:
    validate_contract(spec, check_corpus=check_corpus)
    verify_package_metadata(spec)
    rows = projected_rows(spec, input_dir)
    grouped = by_year(rows)
    tent = {entry["year"]: rows_ for entry, rows_ in tipologia.parsed_years(tipologia.load_spec())}
    for entry in spec["years"]:
        validate_year(grouped[entry["year"]], tent[entry["year"]], entry)
    payload = projection(rows)
    if check_corpus:
        observed = {"bytes": len(payload), "sha256": corpus.sha256_bytes(payload), "rows": len(rows)}
        if observed != spec["projection"]:
            raise SourceError(f"proiezione divergente dall'impronta del lock: {observed}")
    return {DATASET_ID: payload}


def check_committed(payloads: dict[str, bytes]) -> None:
    corpus_spec, datasets = corpus.load_spec(CORPUS_SPEC)
    selected = {item["id"]: item for item in datasets if item["id"] in payloads}
    if set(selected) != set(payloads):
        raise SourceError("dataset dell'occupazione per istituzione assente dalla specifica corpus")
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
    parser.add_argument("--input-dir", type=Path, help="CSV originali <pacchetto CKAN>.csv, soggetti al lock")
    parser.add_argument("--output-dir", type=Path)
    parser.add_argument("--publish", action="store_true")
    parser.add_argument("--check", action="store_true")
    args = parser.parse_args()
    if sum(bool(value) for value in (args.output_dir, args.publish, args.check)) != 1:
        parser.error("specificare una sola azione: --output-dir, --publish o --check")
    if (args.output_dir or args.publish) and args.input_dir is None:
        parser.error("--output-dir e --publish richiedono --input-dir con i 15 CSV originali")
    spec = load_spec()
    if args.output_dir:
        # Prima della registrazione nel corpus: proietta senza controllare override e impronta.
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
    source = "CSV originali" if args.input_dir else "righe del corpus e fixture 2020"
    print(f"PASS: Conto Annuale, occupazione per istituzione 2010-2024 ({source}); lock, ricalcolo per tipo e CKAN verificati")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
