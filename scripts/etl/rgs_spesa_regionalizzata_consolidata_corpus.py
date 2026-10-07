#!/usr/bin/env python3
"""Project RGS "Spesa Statale Regionalizzata" consolidata, enti and fondi 2008-2023 into corpus rows.

Besides the Bilancio series (SRS_SPE_BIL_SPESR_001, projected by
rgs_spesa_statale_regionalizzata_corpus.py and by the typed 2023 slice), the
same RGS publication has three territorial series with one 104-row file per
year (26 territories x 4 measures):

- SRS_SPE_PAR_SPESR_001, spesa consolidata;
- SRS_SPE_PAR_SPENT_001, spesa degli Enti oggetto della pubblicazione;
- SRS_SPE_PAR_SPFON_001, spesa attraverso i Fondi oggetto della pubblicazione.

Each series becomes one corpus dataset with all years (column Anno). The CKAN
description of the consolidated series is copied from the Bilancio one, so the
scope is proven on the data instead: for every year and territory, Bilancio +
Enti + Fondi must equal Consolidata within a declared tolerance, otherwise the
projection stops (#728). The Bilancio side comes from the committed, locked
sources: the 2008-2022 gzip fixtures and the 2023 typed snapshot.

Like the Bilancio series, the official CSVs are kept as deterministic gzip
fixtures and the lock pins the original bytes, verified after decompression.
"""

from __future__ import annotations

import argparse
import csv
import gzip
import io
import json
from decimal import Decimal
from pathlib import Path

import integrated_curated_datasets as corpus
import rgs_spesa_statale_regionalizzata_corpus as bilancio
import rgs_state_budget_territorial_snapshot as bilancio_2023

ROOT = Path(__file__).resolve().parents[2]
SPEC = ROOT / "scripts/etl/specs/rgs-spesa-regionalizzata-consolidata-enti-fondi.source.json"
CORPUS_SPEC = bilancio.CORPUS_SPEC
BILANCIO_2023_SNAPSHOT = ROOT / "src/data/generated/rgs-state-budget-territorial-2023.json"

YEARS = tuple(range(2008, 2024))
# Order matters: the identity reads the three components and the consolidated total by key.
SERIES = {
    "consolidata": ("SRS_SPE_PAR_SPESR_001", "rgs-spesa-statale-regionalizzata-consolidata", "spesr"),
    "enti": ("SRS_SPE_PAR_SPENT_001", "rgs-spesa-statale-regionalizzata-enti", "spent"),
    "fondi": ("SRS_SPE_PAR_SPFON_001", "rgs-spesa-statale-regionalizzata-fondi", "spfon"),
}
SOURCE_HEADERS = ["Anno di Interesse", "Territorio", "Tipo Misura", "Importo"]
HEADERS = ["Anno", "Territorio", "Livello territoriale", "Misura", "Valore", "URL fonte"]
LEVEL_OF = bilancio.LEVEL_OF
MEASURES = bilancio.MEASURES
ABSOLUTE_MEASURE = bilancio.ABSOLUTE_MEASURE
AMOUNT = bilancio.AMOUNT
# Hundredths of million EUR. Measured maximum |B + E + F - C| over 16 years x
# 26 territories is 13 (Abruzzo 2008, Sardegna 2022): the residual of four values rounded to
# two decimals, one of which (Bilancio) is itself a sum of a few hundred rounded
# rows. The tolerance is fixed here as well as in the lock, so that a lock
# cannot loosen it on its own.
IDENTITY_TOLERANCE_HUNDREDTHS = 15
RECONCILIATION_CEILING_HUNDREDTHS = 5

SourceError = bilancio.SourceError


def expected_metadata(dataset: dict, series: dict) -> dict:
    """Source metadata the corpus override must carry for one dataset."""
    years = dataset["years"]
    return {
        "holder": series["holder"],
        "referencePeriod": f"Esercizi finanziari {years[0]['year']}-{years[-1]['year']}; {dataset['scope']}",
        # l'ultima annualità pubblicata data la serie
        "publicationDate": max(entry["publicationDate"] for entry in years),
        "acquisitionDate": series["acquisitionDate"],
        "checkedAt": series["checkedAt"],
        "updateFrequency": series["updateFrequency"],
        # Il catalogo runtime ammette al massimo 8 URL per dataset: la ricerca CKAN della serie
        # elenca tutti i pacchetti annuali, la pagina e il file più recenti la datano; ogni riga
        # cita già il file del proprio anno e il lock conserva pagina e file di ogni anno.
        "canonicalUrls": sorted({dataset["catalogUrl"], years[-1]["landingUrl"], years[-1]["url"]}),
    }


def validate_contract(spec: dict, *, check_corpus: bool = True) -> None:
    series = spec.get("series")
    if not isinstance(series, dict):
        raise SourceError("contratto delle serie mancante")
    if (
        series.get("holder") != "Ragioneria Generale dello Stato"
        or series.get("licenseStatus") != "not-declared"
        or series.get("encoding") != "cp1252"
        or series.get("delimiter") != ";"
        or series.get("lineEnding") != "CRLF"
        or series.get("sourceHeaders") != SOURCE_HEADERS
    ):
        raise SourceError("identità, licenza o formato delle serie divergenti")
    identity = spec.get("identity")
    if not isinstance(identity, dict) or identity.get("toleranceHundredthsMillionEur") != IDENTITY_TOLERANCE_HUNDREDTHS:
        raise SourceError(f"tolleranza dell'identità diversa da {IDENTITY_TOLERANCE_HUNDREDTHS} centesimi di milione")
    if [entry.get("year") for entry in identity.get("years", [])] != list(YEARS):
        raise SourceError("annualità dell'identità divergenti")
    datasets = spec.get("datasets")
    if not isinstance(datasets, dict) or list(datasets) != list(SERIES):
        raise SourceError("serie consolidata, enti e fondi mancanti o fuori ordine")
    corpus_spec = json.loads(CORPUS_SPEC.read_text(encoding="utf-8"))
    overrides = corpus_spec.get("sourceMetadata", {}).get("overrides", {})
    for key, (record_id, dataset_id, prefix) in SERIES.items():
        dataset = datasets[key]
        if (
            dataset.get("recordId") != record_id
            or dataset.get("datasetId") != dataset_id
            or dataset.get("catalogUrl")
            != f"https://bdap-opendata.rgs.mef.gov.it/SpodCkanApi/api/3/action/package_search?q={record_id}"
        ):
            raise SourceError(f"identità della serie {key} divergente")
        if [entry.get("year") for entry in dataset.get("years", [])] != list(YEARS):
            raise SourceError(f"annualità della serie {key} divergenti dal perimetro 2008-2023")
        for entry in dataset["years"]:
            if entry["packageName"] != f"spd_srs_spe_par_{prefix}_01_{entry['year']}":
                raise SourceError(f"pacchetto CKAN divergente: {key} {entry['year']}")
            if not entry["url"].startswith("https://bdap-opendata.rgs.mef.gov.it/") or not entry[
                "landingUrl"
            ].startswith("https://bdap-opendata.rgs.mef.gov.it/"):
                raise SourceError(f"URL non ufficiale: {key} {entry['year']}")
            if entry["reconciliationCeilingHundredths"] != RECONCILIATION_CEILING_HUNDREDTHS:
                raise SourceError(f"soglia di riconciliazione divergente: {key} {entry['year']}")
        if check_corpus and overrides.get(dataset_id) != expected_metadata(dataset, series):
            raise SourceError(f"metadati corpus divergenti dal source lock: {dataset_id}")


def verified_source(entry: dict, input_dir: Path | None = None) -> bytes:
    """Original CSV bytes: from an alternative directory, or decompressed from the fixture."""
    if input_dir is not None:
        payload = (input_dir / f"{entry['packageName']}.csv").read_bytes()
    else:
        compressed = (ROOT / entry["fixture"]).read_bytes()
        if len(compressed) != entry["compressedBytes"] or corpus.sha256_bytes(compressed) != entry["compressedSha256"]:
            raise SourceError(f"fixture compressa divergente dal lock: {entry['packageName']}")
        payload = gzip.decompress(compressed)
    if len(payload) != entry["bytes"] or corpus.sha256_bytes(payload) != entry["sha256"]:
        raise SourceError(f"byte sorgente divergenti dal lock: {entry['packageName']}")
    return payload


def parse_year(payload: bytes, entry: dict, series: dict) -> list[list[str]]:
    label = entry["packageName"]
    try:
        text = payload.decode(series["encoding"], errors="strict")
    except UnicodeDecodeError as error:
        raise SourceError(f"codifica divergente dal lock: {label}") from error
    if not text.endswith("\r\n") or "\n" in text.replace("\r\n", ""):
        raise SourceError(f"fine riga divergente dal lock: {label}")
    reader = csv.reader(io.StringIO(text, newline=""), delimiter=series["delimiter"], quotechar='"')
    expected_header = SOURCE_HEADERS + ([""] if entry["trailingEmptyColumn"] else [])
    if next(reader) != expected_header:
        raise SourceError(f"intestazione divergente dal lock: {label}")
    width = len(expected_header)
    rows: list[list[str]] = []
    for number, row in enumerate(reader, start=2):
        if len(row) != width or (entry["trailingEmptyColumn"] and row[-1] != ""):
            raise SourceError(f"riga {number} di {label}: colonne divergenti")
        row = row[:4]
        if row[0] != str(entry["year"]):
            raise SourceError(f"riga {number}: anno {row[0]!r} in {label}")
        if row[1] not in LEVEL_OF:
            raise SourceError(f"riga {number} di {label}: territorio fuori allowlist {row[1]!r}")
        if row[2] not in MEASURES:
            raise SourceError(f"riga {number} di {label}: misura sconosciuta {row[2]!r}")
        if not AMOUNT.fullmatch(row[3]):
            raise SourceError(f"riga {number} di {label}: importo non conforme {row[3]!r}")
        if "|" in "".join(row):
            raise SourceError(f"riga {number} di {label}: separatore del corpus in una cella")
        rows.append(row)
    return rows


def absolute_totals(rows: list[list[str]]) -> dict[str, int]:
    """Absolute amount per territory, in hundredths of million EUR."""
    return {row[1]: int(Decimal(row[3]) * 100) for row in rows if row[2] == ABSOLUTE_MEASURE}


def reconciliation(totals: dict[str, int]) -> dict:
    national = totals.get("ITALIA", 0)
    regions = sum(value for name, value in totals.items() if LEVEL_OF[name] == "Regione")
    macroareas = sum(value for name, value in totals.items() if LEVEL_OF[name] == "Ripartizione")
    return {
        "nationalHundredthsMillionEur": national,
        "regionDeltaHundredthsMillionEur": regions - national,
        "macroareaDeltaHundredthsMillionEur": macroareas - national,
    }


def validate_year(rows: list[list[str]], entry: dict) -> None:
    label = entry["packageName"]
    if len({(row[1], row[2]) for row in rows}) != len(rows):
        raise SourceError(f"combinazioni duplicate in {label}")
    observed = {
        "rows": len(rows),
        "territories": len({row[1] for row in rows}),
        "measures": len({row[2] for row in rows}),
        "zeroValues": sum(1 for row in rows if Decimal(row[3]) == 0),
        "reconciliation": reconciliation(absolute_totals(rows)),
    }
    if observed != entry["expected"]:
        raise SourceError(f"dimensioni o riconciliazione divergenti dal lock in {label}: {observed}")
    if observed["rows"] != len(LEVEL_OF) * len(MEASURES):
        raise SourceError(f"{label}: attese {len(LEVEL_OF) * len(MEASURES)} righe, una per territorio e misura")
    recon = observed["reconciliation"]
    ceiling = entry["reconciliationCeilingHundredths"]
    if max(abs(recon["regionDeltaHundredthsMillionEur"]), abs(recon["macroareaDeltaHundredthsMillionEur"])) > ceiling:
        raise SourceError(f"{label} non riconcilia entro {ceiling} centesimi di milione")


def bilancio_totals() -> dict[int, dict[str, int]]:
    """Bilancio (SRS_SPE_BIL_SPESR_001) absolute totals per year and territory, from the locked sources."""
    totals: dict[int, dict[str, int]] = {}
    for name in bilancio.SLICES:
        spec, years = bilancio.load_slice(name)
        bilancio.validate_contract(spec, years)
        for entry in spec["years"]:
            rows = bilancio.parse_year(bilancio.verified_source(entry), entry, spec["series"])
            bilancio.validate_year(rows, entry)
            year_totals: dict[str, int] = {}
            for row in rows:
                if row[5] == ABSOLUTE_MEASURE:
                    year_totals[row[1]] = year_totals.get(row[1], 0) + int(Decimal(row[6]) * 100)
            totals[entry["year"]] = year_totals
    snapshot_spec = bilancio_2023.load_spec()
    snapshot = json.loads(BILANCIO_2023_SNAPSHOT.read_text(encoding="utf-8"))
    bilancio_2023.validate_snapshot(snapshot, snapshot_spec)
    measures = [measure["label"] for measure in snapshot["dimensions"]["measures"]]
    absolute = measures.index(ABSOLUTE_MEASURE)
    territories = [item["label"] for item in snapshot["dimensions"]["territories"]]
    year_totals = {}
    for row in snapshot["rows"]:
        territory = territories[row["territory"]]
        year_totals[territory] = year_totals.get(territory, 0) + row["values"][absolute]
    totals[snapshot["year"]] = year_totals
    return totals


def check_identity(
    components: dict[str, dict[int, dict[str, int]]],
    bilancio_by_year: dict[int, dict[str, int]],
    identity: dict,
) -> list[dict]:
    """Bilancio + Enti + Fondi = Consolidata per year and territory, fail-closed."""
    tolerance = identity["toleranceHundredthsMillionEur"]
    observed: list[dict] = []
    for year in YEARS:
        sources = {
            "bilancio": bilancio_by_year.get(year, {}),
            **{key: components[key].get(year, {}) for key in SERIES},
        }
        for key, values in sources.items():
            if set(values) != set(LEVEL_OF):
                raise SourceError(f"copertura territoriale incompleta per l'identità: {key} {year}")
        residuals = {
            territory: sources["bilancio"][territory] + sources["enti"][territory] + sources["fondi"][territory]
            - sources["consolidata"][territory]
            for territory in LEVEL_OF
        }
        worst = max(residuals, key=lambda territory: (abs(residuals[territory]), territory))
        if abs(residuals[worst]) > tolerance:
            raise SourceError(
                f"identità Bilancio + Enti + Fondi = Consolidata fuori tolleranza nel {year}, {worst}: "
                f"{residuals[worst]} centesimi di milione (soglia {tolerance})"
            )
        observed.append({
            "year": year,
            "bilancioHundredthsMillionEur": sources["bilancio"]["ITALIA"],
            "nationalResidualHundredthsMillionEur": residuals["ITALIA"],
            "maxAbsResidualHundredthsMillionEur": abs(residuals[worst]),
            # changes by one for any one-hundredth drift of any territory, even within tolerance
            "sumAbsResidualHundredthsMillionEur": sum(abs(value) for value in residuals.values()),
        })
    if observed != identity["years"]:
        raise SourceError("identità Bilancio + Enti + Fondi = Consolidata divergente dal lock")
    return observed


def projection(rows_by_year: list[tuple[dict, list[list[str]]]]) -> bytes:
    output = io.StringIO(newline="")
    writer = csv.writer(output, delimiter="|", lineterminator="\n")
    writer.writerow(HEADERS)
    for entry, rows in rows_by_year:
        for anno, territorio, misura, importo in rows:
            writer.writerow([anno, territorio, LEVEL_OF[territorio], misura, importo, entry["url"]])
    return output.getvalue().encode("utf-8")


def parsed_series(spec: dict, input_dir: Path | None = None) -> dict[str, list[tuple[dict, list[list[str]]]]]:
    parsed: dict[str, list[tuple[dict, list[list[str]]]]] = {}
    for key in SERIES:
        parsed[key] = []
        for entry in spec["datasets"][key]["years"]:
            rows = parse_year(verified_source(entry, input_dir), entry, spec["series"])
            validate_year(rows, entry)
            parsed[key].append((entry, rows))
    return parsed


def components_of(parsed: dict[str, list[tuple[dict, list[list[str]]]]]) -> dict[str, dict[int, dict[str, int]]]:
    return {key: {entry["year"]: absolute_totals(rows) for entry, rows in years} for key, years in parsed.items()}


def projections(spec: dict, input_dir: Path | None = None, *, check_corpus: bool = True) -> dict[str, bytes]:
    validate_contract(spec, check_corpus=check_corpus)
    parsed = parsed_series(spec, input_dir)
    check_identity(components_of(parsed), bilancio_totals(), spec["identity"])
    return {spec["datasets"][key]["datasetId"]: projection(years) for key, years in parsed.items()}


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
        # Prima della registrazione nel corpus: proietta senza controllare gli override.
        payloads = projections(spec, args.input_dir, check_corpus=False)
        args.output_dir.mkdir(parents=True, exist_ok=True)
        for dataset_id, body in payloads.items():
            (args.output_dir / f"{dataset_id}.psv").write_bytes(body)
            rows = body.count(b"\n") - 1
            print(f"{dataset_id}: bytes={len(body)} sha256={corpus.sha256_bytes(body)} rows={rows}")
    else:
        payloads = projections(spec, args.input_dir)
        if args.publish:
            bilancio.publish(payloads)
        else:
            bilancio.check_committed(payloads)
    print("PASS: spesa regionalizzata consolidata, enti e fondi; fonte, riconciliazioni e identità verificate")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
