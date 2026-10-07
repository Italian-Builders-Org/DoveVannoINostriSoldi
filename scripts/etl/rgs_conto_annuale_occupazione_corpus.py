#!/usr/bin/env python3
"""Project RGS Conto Annuale employment by type of administration 2010-2024 into corpus rows (#586).

OpenBDAP (the RGS CKAN) publishes one package per survey year,
spd_pca_occ_dip_tent_01_<anno> (series PCA_OCC_DIP_TENT_001): one row per type
of administration with staff at 31 December, women and men, full time and the
two part-time bands, plus four kinds of flexible work. Each year becomes part
of one corpus dataset with the column Anno.

This is a different channel from the DFP 2020 distribution projected by
conto_annuale.py: other publisher site, other licence (CC BY 3.0 declared on the
OpenBDAP landing pages, cc-by on CKAN), other schema. That ETL stays a closed
contract on the DFP snapshot; this one reuses its locked fixture only as an
independent term of comparison.

Fail-closed checks, besides bytes and schema of every year:

- the 2020 by-type file is recomputed from the 2020 per-administration file
  (spd_pca_occ_dip_ente_01_2020, kept as a gzip fixture): permanent staff must
  match exactly for every type, flexible work within the per-administration
  rounding, with the observed deltas pinned in the lock;
- the 2020 by-type file is reconciled with the DFP 2020 snapshot already in the
  corpus: equal for every type, except the deltas declared in the lock
  (MINISTERI +38), and equal for every administration except two declared ones.

Flexible work is expressed in annual labour units, not heads, and is never
added to the headcount. The history package PCA_OCC_DIP_STOR_001 drifts from
the yearly files and is not used.
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

import conto_annuale as dfp
import integrated_curated_datasets as corpus
from integrated_corpus_append import append_integrated_datasets

ROOT = Path(__file__).resolve().parents[2]
SPEC = ROOT / "scripts/etl/specs/rgs-conto-annuale-occupazione-tipologia.source.json"
CORPUS_SPEC = ROOT / "scripts/etl/specs/integrated-curated-datasets.source.json"
CATALOG = ROOT / "src/data/generated/integrated/catalog.json"
ROWS_DIR = ROOT / "src/data/generated/integrated/rows"
RECEIPTS_DIR = ROOT / "data/source-ledger/datasets"
DATASET_PROOF = ROOT / "data/source-ledger/dataset-proof.json"
RELEASE_PROOF = ROOT / "data/source-ledger/release-proof.json"

DATASET_ID = "rgs-conto-annuale-occupazione-tipologia-2010-2024"
RECORD_ID = "PCA_OCC_DIP_TENT_001"
YEARS = tuple(range(2010, 2025))
BASE_URL = "https://bdap-opendata.rgs.mef.gov.it/"
LICENSE_URL = "http://creativecommons.org/licenses/by/3.0"
LICENSE_DEED = "https://creativecommons.org/licenses/by/3.0/"

MEASURES = [
    "Numero Dipendenti Donne Tempo Pieno",
    "Numero Dipendenti Uomini Tempo Pieno",
    "Numero Dipendenti Donne Part time Inf. 50%",
    "Numero Dipendenti Uomini Part time Inf. 50%",
    "Numero Dipendenti Donne Part time Sup. 50%",
    "Numero Dipendenti Uomini Part time Sup. 50%",
    "Numero Dipendenti Donne Tempo Determinato",
    "Numero Dipendenti Uomini Tempo Determinato",
    "Numero Dipendenti Donne Formazione Lavoro",
    "Numero Dipendenti Uomini Formazione Lavoro",
    "Numero Dipendenti Donne Lavoro Interinale",
    "Numero Dipendenti Uomini Lavoro Interinale",
    "Numero Dipendenti Donne Lavoro Socialmente Utile",
    "Numero Dipendenti Uomini Lavoro Socialmente Utile",
]
FULL_TIME = slice(0, 2)
PART_TIME = slice(2, 6)
PERMANENT = slice(0, 6)
FLEXIBLE = slice(6, 14)
SOURCE_HEADERS = ["Anno Rilevazione", "Tipologia Amministrazione", "Descrizione Tipo Istituzione", *MEASURES]
ENTE_HEADERS = [
    "Anno Rilevazione",
    "Descrizione Tipo Istituzione",
    "Codice Istituzione",
    "Codice Ente BDAP",
    "Descrizione Ente",
    "Codice Comparto",
    "Descrizione Comparto",
    "Codice Contratto Lavoro",
    "Descrizione Contratto Lavoro",
    "Codice Macrocategoria",
    "Descrizione Macrocategoria",
    "Codice Categoria",
    "Descrizione Categoria",
    *MEASURES,
]
HEADERS = ["Anno", "Tipologia amministrazione", "Tipo istituzione", *MEASURES, "URL fonte"]
# Two published formats: integers up to 2020, two decimals from 2021.
VALUE_FORMATS = {
    "integer": (re.compile(r"(?:0|[1-9][0-9]*)\Z"), re.compile(r"(?:0|[1-9][0-9]*)\Z")),
    "decimal2": (re.compile(r"(?:0|[1-9][0-9]*)\.00\Z"), re.compile(r"(?:0|[1-9][0-9]*)\.[0-9]{2}\Z")),
}
DFP_COLUMNS = [
    "personale_tempo_pieno_donne",
    "personale_tempo_pieno_uomini",
    "part_time_inf50percento_donne",
    "part_time_inf50percento_uomini",
    "part_time_sup50percento_donne",
    "part_time_sup50percento_uomini",
]
# Flexible work in the by-type file is rounded once per type, in the
# per-administration file once per administration and contract: the sums
# differ by rounding. Measured maximum 47 units (COMUNI, Tempo Determinato
# Uomini); fixed here as well as in the lock, so that a lock cannot loosen it.
FLEXIBLE_ROUNDING_TOLERANCE = 50


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
        # massimo 8 URL nel catalogo: la ricerca CKAN della serie elenca tutti i pacchetti annuali,
        # pagina e file più recenti la datano, la licenza è quella dichiarata dalle pagine;
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
        if entry["packageName"] != f"spd_pca_occ_dip_tent_01_{year}":
            raise SourceError(f"pacchetto CKAN divergente: {year}")
        if entry["url"] != f"{BASE_URL}SpodCkanApi/api/3/datastore/dump/{entry['packageId']}.csv":
            raise SourceError(f"URL del file non ufficiale: {year}")
        if not entry["landingUrl"].startswith(f"{BASE_URL}content/{year}-"):
            raise SourceError(f"pagina ufficiale divergente: {year}")
        if entry["valueFormat"] != ("integer" if year <= 2020 else "decimal2"):
            raise SourceError(f"formato dei valori divergente: {year}")
    ente = spec.get("perAdministration2020")
    if (
        not isinstance(ente, dict)
        or ente.get("packageName") != "spd_pca_occ_dip_ente_01_2020"
        or ente.get("url") != f"{BASE_URL}SpodCkanApi/api/3/datastore/dump/{ente.get('packageId')}.csv"
        or ente.get("sourceHeaders") != ENTE_HEADERS
        or ente.get("flexibleRoundingTolerance") != FLEXIBLE_ROUNDING_TOLERANCE
    ):
        raise SourceError("contratto del file per ente 2020 divergente")
    if not isinstance(spec.get("dfp2020"), dict):
        raise SourceError("riscontro DFP 2020 mancante")
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
    """CKAN package_show snapshot: licence, dates, resource and observed date of every locked file."""
    packages = json.loads(locked_fixture(spec["ckanSnapshot"]))
    entries = [*spec["years"], spec["perAdministration2020"]]
    if sorted(packages) != sorted(entry["packageName"] for entry in entries):
        raise SourceError("istantanea CKAN: pacchetti mancanti o inattesi")
    for entry in entries:
        package = packages[entry["packageName"]]
        observed = re.search(r"Dati osservati al (\d{2})/(\d{2})/(\d{4})", package.get("notes", ""))
        resources = [item for item in package.get("resources", []) if item.get("mimetype") == "text/csv"]
        if (
            package.get("id") != entry["packageId"]
            or package.get("license_id") != spec["series"]["license"]["ckanLicenseId"]
            or package.get("metadata_created", "")[:10] != entry["publicationDate"]
            or package.get("metadata_modified", "")[:10] != entry["metadataModified"]
            or package.get("title") != entry["title"]
            or observed is None
            or f"{observed[3]}-{observed[2]}-{observed[1]}" != entry["dataObservedAt"]
            or len(resources) != 1
            or resources[0]["url"].replace("http://", "https://", 1) != entry["url"]
            or int(resources[0]["size"]) != entry["bytes"]
        ):
            raise SourceError(f"metadati CKAN divergenti dal lock: {entry['packageName']}")


def read_rows(payload: bytes, label: str, headers: list[str], series: dict, year: int) -> list[list[str]]:
    try:
        text = payload.decode(series["encoding"], errors="strict")
    except UnicodeDecodeError as error:
        raise SourceError(f"codifica divergente dal lock: {label}") from error
    if not text.endswith("\r\n") or "\n" in text.replace("\r\n", ""):
        raise SourceError(f"fine riga divergente dal lock: {label}")
    reader = csv.reader(io.StringIO(text, newline=""), delimiter=series["delimiter"], quotechar='"')
    # ogni riga, intestazione compresa, termina con il separatore: una colonna vuota finale
    if next(reader) != [*headers, ""]:
        raise SourceError(f"intestazione divergente dal lock: {label}")
    rows: list[list[str]] = []
    for number, row in enumerate(reader, start=2):
        if len(row) != len(headers) + 1 or row[-1] != "":
            raise SourceError(f"riga {number} di {label}: colonne divergenti")
        row = row[:-1]
        if row[0] != str(year):
            raise SourceError(f"riga {number}: anno {row[0]!r} in {label}")
        rows.append(row)
    return rows


def parse_year(payload: bytes, entry: dict, series: dict) -> list[list[str]]:
    label = entry["packageName"]
    rows = read_rows(payload, label, SOURCE_HEADERS, series, entry["year"])
    permanent, flexible = VALUE_FORMATS[entry["valueFormat"]]
    for number, row in enumerate(rows, start=2):
        if any(not cell.strip() or cell != cell.strip() or "|" in cell for cell in row):
            raise SourceError(f"riga {number} di {label}: cella vuota, con spazi esterni o con il separatore del corpus")
        values = row[3:]
        if not all(permanent.fullmatch(value) for value in values[PERMANENT]):
            raise SourceError(f"riga {number} di {label}: personale non intero o negativo {values[PERMANENT]}")
        if not all(flexible.fullmatch(value) for value in values[FLEXIBLE]):
            raise SourceError(f"riga {number} di {label}: lavoro flessibile non conforme {values[FLEXIBLE]}")
    return rows


def hundredths(value: str) -> int:
    return int(Decimal(value) * 100)


def observed_year(rows: list[list[str]]) -> dict:
    sums = [sum(hundredths(row[3 + index]) for row in rows) for index in range(len(MEASURES))]
    full_time, part_time = sum(sums[FULL_TIME]) // 100, sum(sums[PART_TIME]) // 100
    return {
        "rows": len(rows),
        "types": len({row[2] for row in rows}),
        "tipologie": len({row[1] for row in rows}),
        "fullTime": full_time,
        "partTime": part_time,
        "permanent": full_time + part_time,
        "flexibleHundredths": sum(sums[FLEXIBLE]),
    }


def validate_year(rows: list[list[str]], entry: dict) -> None:
    if len({row[2] for row in rows}) != len(rows):
        raise SourceError(f"tipo istituzione duplicato in {entry['packageName']}")
    observed = observed_year(rows)
    if observed != entry["expected"]:
        raise SourceError(f"dimensioni o totali divergenti dal lock in {entry['packageName']}: {observed}")


def by_type(rows: list[list[str]]) -> dict[str, list[int]]:
    """Fourteen measures per type, in hundredths (the by-type file has one row per type)."""
    return {row[2]: [hundredths(value) for value in row[3:]] for row in rows}


def per_administration(spec: dict, input_dir: Path | None = None) -> list[list[str]]:
    entry = spec["perAdministration2020"]
    rows = read_rows(verified_source(entry, input_dir), entry["packageName"], ENTE_HEADERS, spec["series"], 2020)
    integer = VALUE_FORMATS["integer"][0]
    # Il file per ente non è proiettato: servono solo tipo, codice e valori. Descrizioni e
    # codici BDAP vuoti (44 celle) restano come pubblicati.
    for number, row in enumerate(rows, start=2):
        if not row[1].strip() or row[1] != row[1].strip() or not re.fullmatch(r"[1-9][0-9]*", row[2]):
            raise SourceError(f"riga {number} del file per ente 2020: tipo o codice istituzione non conforme")
        if not all(integer.fullmatch(value) for value in row[13:]):
            raise SourceError(f"riga {number} del file per ente 2020: valori non interi")
    return rows


def recompute_from_administrations(ente_rows: list[list[str]], tent_rows: list[list[str]], lock: dict) -> dict:
    """By-type totals 2020 recomputed from the per-administration file, fail-closed."""
    sums: dict[str, list[int]] = defaultdict(lambda: [0] * len(MEASURES))
    type_of: dict[str, str] = {}
    for row in ente_rows:
        if type_of.setdefault(row[2], row[1]) != row[1]:
            raise SourceError(f"amministrazione {row[2]} in più tipologie")
        totals = sums[row[1]]
        for index, value in enumerate(row[13:]):
            totals[index] += int(value) * 100
    published = by_type(tent_rows)
    if set(sums) != set(published):
        raise SourceError(f"tipologie divergenti fra file per ente e per tipologia: {sorted(set(sums) ^ set(published))}")
    deltas = {name: [a - b for a, b in zip(sums[name], published[name])] for name in published}
    for name, delta in sorted(deltas.items()):
        if any(delta[PERMANENT]):
            raise SourceError(f"personale 2020 di {name} non ricalcolabile dal file per ente: {delta[PERMANENT]}")
        worst = max(abs(value) for value in delta[FLEXIBLE])
        if worst > FLEXIBLE_ROUNDING_TOLERANCE * 100:
            raise SourceError(f"lavoro flessibile 2020 di {name} fuori tolleranza di arrotondamento: {worst // 100}")
    observed = {
        "rows": len(ente_rows),
        "institutions": len(type_of),
        "types": len(sums),
        "flexibleDeltaByMeasure": [sum(delta[index] for delta in deltas.values()) // 100 for index in range(6, 14)],
        "flexibleSumAbsDelta": sum(abs(value) for delta in deltas.values() for value in delta[FLEXIBLE]) // 100,
        "flexibleMaxAbsDelta": max(abs(value) for delta in deltas.values() for value in delta[FLEXIBLE]) // 100,
    }
    if observed != lock["expected"]:
        raise SourceError(f"ricalcolo dal file per ente 2020 divergente dal lock: {observed}")
    return observed


def dfp_rows() -> list[dict[str, str]]:
    """Rows of the DFP occupazione 2020 snapshot, verified by the Conto Annuale lock."""
    spec = json.loads(dfp.SPEC.read_text(encoding="utf-8"))
    source = next(item for item in spec["sources"] if item["kind"] == "occupazione")
    payload = dfp.read_source(source, spec["year"])
    return list(csv.DictReader(io.StringIO(payload.decode("utf-8-sig"), newline=""), strict=True))


def reconcile_dfp(rows: list[dict[str, str]], tent_rows: list[list[str]], ente_rows: list[list[str]], lock: dict) -> dict:
    """OpenBDAP 2020 against the DFP snapshot: by type and by administration, only declared deltas allowed."""
    aliases = lock["labelAliases"]
    dfp_types: dict[str, list[int]] = defaultdict(lambda: [0] * 6)
    dfp_institutions: dict[str, int] = defaultdict(int)
    for row in rows:
        label = aliases.get(row["desc_tipo_istituzione"], row["desc_tipo_istituzione"])
        values = [int(row[column]) for column in DFP_COLUMNS]
        totals = dfp_types[label]
        for index, value in enumerate(values):
            totals[index] += value
        dfp_institutions[row["codi_istituzione"]] += sum(values)
    published = {name: [value // 100 for value in values[PERMANENT]] for name, values in by_type(tent_rows).items()}
    if set(dfp_types) != set(published):
        raise SourceError(f"tipologie 2020 divergenti da DFP: {sorted(set(dfp_types) ^ set(published))}")
    declared = {(item["type"], item["measure"]): item["delta"] for item in lock["declaredTypeDeltas"]}
    observed_types = []
    for name in sorted(published):
        for index, measure in enumerate(MEASURES[PERMANENT]):
            delta = published[name][index] - dfp_types[name][index]
            if delta != declared.get((name, measure), 0):
                raise SourceError(f"riscontro DFP 2020 divergente: {name}, {measure}: {delta:+d}")
            if delta:
                observed_types.append({"type": name, "measure": measure, "delta": delta})
    if observed_types != lock["declaredTypeDeltas"]:
        raise SourceError("scarti DFP dichiarati non osservati")
    openbdap_institutions: dict[str, int] = defaultdict(int)
    for row in ente_rows:
        openbdap_institutions[row[2]] += sum(int(value) for value in row[13:19])
    common = set(dfp_institutions) & set(openbdap_institutions)
    only_openbdap = set(openbdap_institutions) - set(dfp_institutions)
    differing = sorted(
        ({"code": code, "delta": openbdap_institutions[code] - dfp_institutions[code]}
         for code in common if openbdap_institutions[code] != dfp_institutions[code]),
        key=lambda item: int(item["code"]),
    )
    observed = {
        "dfpPermanent": sum(sum(values) for values in dfp_types.values()),
        "openbdapPermanent": sum(sum(values) for values in published.values()),
        "dfpInstitutions": len(dfp_institutions),
        "commonInstitutions": len(common),
        "openbdapOnlyInstitutions": len(only_openbdap),
        "openbdapOnlyPermanent": sum(openbdap_institutions[code] for code in only_openbdap),
        "differingInstitutions": differing,
    }
    if observed != lock["expected"]:
        raise SourceError(f"riscontro DFP 2020 per amministrazione divergente dal lock: {observed}")
    return observed


def projection(parsed: list[tuple[dict, list[list[str]]]]) -> bytes:
    output = io.StringIO(newline="")
    writer = csv.writer(output, delimiter="|", lineterminator="\n")
    writer.writerow(HEADERS)
    for entry, rows in parsed:
        for row in rows:
            writer.writerow([*row, entry["url"]])
    return output.getvalue().encode("utf-8")


def parsed_years(spec: dict, input_dir: Path | None = None) -> list[tuple[dict, list[list[str]]]]:
    parsed = []
    for entry in spec["years"]:
        rows = parse_year(verified_source(entry, input_dir), entry, spec["series"])
        validate_year(rows, entry)
        parsed.append((entry, rows))
    return parsed


def projections(spec: dict, input_dir: Path | None = None, *, check_corpus: bool = True) -> dict[str, bytes]:
    validate_contract(spec, check_corpus=check_corpus)
    verify_package_metadata(spec)
    parsed = parsed_years(spec, input_dir)
    tent_2020 = next(rows for entry, rows in parsed if entry["year"] == 2020)
    ente_2020 = per_administration(spec, input_dir)
    recompute_from_administrations(ente_2020, tent_2020, spec["perAdministration2020"])
    reconcile_dfp(dfp_rows(), tent_2020, ente_2020, spec["dfp2020"])
    return {DATASET_ID: projection(parsed)}


def check_committed(payloads: dict[str, bytes]) -> None:
    corpus_spec, datasets = corpus.load_spec(CORPUS_SPEC)
    selected = {item["id"]: item for item in datasets if item["id"] in payloads}
    if set(selected) != set(payloads):
        raise SourceError("dataset dell'occupazione per tipologia assente dalla specifica corpus")
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
    print("PASS: Conto Annuale, occupazione per tipologia 2010-2024; fonte, ricalcolo per ente e riscontro DFP 2020 verificati")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
