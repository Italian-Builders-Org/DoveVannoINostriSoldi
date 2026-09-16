#!/usr/bin/env python3
"""Prepare verified medical-device spending tables for a shared corpus append.

The output is a local candidate, not a sealed release. It keeps the original
CSV bytes and a copy of the corpus spec; no committed artifact is replaced.
BD/RDM and CND are separate corpus tables, never copied into economic facts.
"""
from __future__ import annotations

import argparse
import csv
import hashlib
import json
import shutil
import tempfile
import zipfile
from pathlib import Path

import integrated_curated_datasets as corpus
import medical_device_spending_profile as source
import medical_device_spending_model as model


PILOT_YEARS = (2020, 2021)
HISTORICAL_YEARS = (2018, 2019)
PILOT_DATASET_IDS = {*(f"salute-spesa-dispositivi-{year}" for year in PILOT_YEARS), model.REGISTRY_DATASET, model.CND_DATASET}
HISTORICAL_DATASET_IDS = {*(f"salute-spesa-dispositivi-{year}" for year in HISTORICAL_YEARS)}
DATASET_IDS = PILOT_DATASET_IDS | HISTORICAL_DATASET_IDS


def normalize_registry(registry: Path, item: dict, target: Path) -> dict:
    """Remove only the header's trailing semicolon; preserve all subsequent bytes."""
    archive = item["archive"]
    with corpus.open_verified_pinned_source(registry, archive["bytes"], archive["sha256"], "BD/RDM") as pinned, zipfile.ZipFile(pinned) as zipped, zipped.open(archive["member"]) as raw, target.open("wb") as output:
        header = raw.readline()
        ending = b"\r\n" if header.endswith(b"\r\n") else b"\n"
        body = header[:-len(ending)]
        if body.decode("utf-8-sig").split(";") != source.REGISTRY_HEADERS:
            raise source.SourceError("Intestazione BD/RDM inattesa")
        output.write(body[:-1] + ending)
        shutil.copyfileobj(raw, output, length=1024 * 1024)
    with target.open(encoding="utf-8-sig", newline="") as handle:
        reader = csv.reader(handle, delimiter=";")
        if next(reader) != model.REGISTRY_PUBLIC_HEADERS:
            raise source.SourceError("Intestazione normalizzata BD/RDM inattesa")
        count = 0
        for row in reader:
            if len(row) != len(model.REGISTRY_PUBLIC_HEADERS):
                raise source.SourceError("Colonna BD/RDM senza intestazione non assente")
            count += 1
    if count != item["expected"]["rows"]:
        raise source.SourceError("Conteggio BD/RDM normalizzato divergente")
    with target.open("rb") as handle:
        digest = hashlib.file_digest(handle, "sha256").hexdigest()
    return {"bytes": target.stat().st_size, "sha256": digest, "rows": count,
            "columns": len(model.REGISTRY_PUBLIC_HEADERS), "headers": model.REGISTRY_PUBLIC_HEADERS}


def reference_entry(dataset_id: str, expected: dict, caveats: list[str]) -> dict:
    return {"id": dataset_id, "title": "Dispositivi medici · " + ("anagrafica BD/RDM · 2026-09-14" if dataset_id == model.REGISTRY_DATASET else "classificazione CND · 2026-09-01"),
            "domain": "health", "authority": "primary", "licenseStatus": "verified-open-iodl-2.0",
            "publication": "rows", "evidenceLabel": "documented-fact", "relativePath": f"{dataset_id}.csv",
            "dataKind": "delimited", "delimiter": "semicolon", "encoding": "utf-8-sig",
            "expected": expected, "sourceFields": [],
            "privateFields": sorted(model.REGISTRY_PRIVATE_FIELDS) if dataset_id == model.REGISTRY_DATASET else [],
            "caveats": caveats}


def dataset_entry(year: int, release: dict) -> dict:
    archive = release["archive"]
    headers = source.spending_headers(year)
    caveats = [
        (
            "CostoAcq: euro nel lessico originale italiano; virgola decimale e punto delle migliaia. "
            "Conversione esatta con parse_source_euros e somme con monetary.add_decimals, senza float."
        ),
        (
            "Spesa rilevata nel perimetro pubblicato, non automaticamente tutta la spesa SSN; "
            "non sommare con CE, SIOPE o aggiudicazioni. Non misura incassi del fabbricante o prezzi unitari."
        ),
        (
            "Ogni record originale resta distinto, incluse rettifiche negative, zeri e righe ripetute. "
            "Una cella vuota non è uno zero."
        ),
        "CodASL è contestualizzato da CodRegCommit e Anno; nessun raccordo implicito con IPA, CE o SIOPE.",
        (
            "CodTipoDM e NumRep formano la chiave composta. L'arricchimento BD/RDM è separato; "
            "le righe non abbinate restano nella tabella e nella spesa osservata."
        ),
        (
            "CodiceCND conserva la classificazione della fonte, senza sostituirla con quella corrente "
            "o rinominarla CID/EMDN. Il CSV non dichiara una versione della classificazione."
        ),
    ]
    if year in HISTORICAL_YEARS:
        caveats.append(
            "CodRegCommit e CodASL restano stringhe nel lessico della fonte; zeri iniziali e RegioneCommit "
            "non vengono riscritti mediante raccordi impliciti."
        )
    caveats.append(
        f"Release selezionata: {release['releaseId']}. La data di pubblicazione è quella del catalogo; "
        "la data ZIP non è una data certificata di estrazione ministeriale."
    )
    return {
        "id": f"salute-spesa-dispositivi-{year}",
        "title": f"Dispositivi medici · spesa rilevata per azienda sanitaria · {year}",
        "domain": "health",
        "authority": "primary",
        "licenseStatus": "verified-open-iodl-2.0",
        "publication": "rows",
        "evidenceLabel": "documented-fact",
        "relativePath": f"salute-spesa-dispositivi-{year}.csv",
        "dataKind": "delimited",
        "delimiter": "semicolon",
        "encoding": "utf-8-sig",
        "expected": {
            "bytes": archive["memberBytes"],
            "sha256": archive["memberSha256"],
            "rows": release["expected"]["rows"],
            "columns": len(headers),
            "headers": headers,
        },
        "sourceFields": [],
        "privateFields": [],
        "caveats": caveats,
    }


def prepare_historical(
    spending: dict[int, Path], registry: Path, cnd: Path, output: Path,
    *, lock_path: Path = source.DEFAULT_SPEC, base_spec_path: Path | None = None,
) -> None:
    if set(spending) != set(HISTORICAL_YEARS):
        raise source.SourceError("L'estensione storica richiede soltanto le annualità 2018 e 2019")
    if output.exists():
        raise source.SourceError("La directory candidata esiste già: scegliere una nuova destinazione")
    lock = source.load_spec(lock_path)
    spec, existing = corpus.load_spec(base_spec_path or corpus.DEFAULT_SPEC)
    existing_ids = {item["id"] for item in existing}
    if not PILOT_DATASET_IDS <= existing_ids:
        raise source.SourceError("Il corpus di base non contiene il pilota dispositivi completo")
    if HISTORICAL_DATASET_IDS & existing_ids:
        raise source.SourceError("Annualità storiche già nel corpus: serve una revisione esplicita della release")
    source._verify_file(registry, lock["registry"]["archive"], "BD/RDM")
    source._verify_zip_member(registry, lock["registry"]["archive"], "BD/RDM")
    source._verify_file(cnd, lock["classification"], "CND")
    output.parent.mkdir(parents=True, exist_ok=True)
    with tempfile.TemporaryDirectory(prefix=".medical-device-history-", dir=output.parent) as directory:
        staging = Path(directory)
        profiles = {}
        for year in HISTORICAL_YEARS:
            release = lock["spendingReleases"][str(year)]
            if release["publicationDisposition"] != "historical-candidate" or release["licenseStatus"] != "IODL-2.0":
                raise source.SourceError(f"Release storica {year} non ammessa nel candidato")
            archive = release["archive"]
            source._verify_file(spending[year], archive, f"spesa {year}")
            source._verify_zip_member(spending[year], archive, f"spesa {year}")
            result = source.profile(
                spending[year], registry, cnd, year,
                spending_member=archive["member"],
                registry_member=lock["registry"]["archive"]["member"],
            )
            source.verify_locked_profile(result, lock, year)
            profiles[str(year)] = result
            item = dataset_entry(year, release)
            target = staging / item["relativePath"]
            with zipfile.ZipFile(spending[year]) as zipped, zipped.open(archive["member"]) as raw, target.open("wb") as handle:
                shutil.copyfileobj(raw, handle, length=1024 * 1024)
            source._verify_file(target, item["expected"], f"CSV candidato {year}")
            spec["datasets"].append(item)
            spec["sourceMetadata"]["overrides"][item["id"]] = {
                "holder": lock["holder"],
                "referencePeriod": str(year),
                "publicationDate": release["publicationDate"],
                "acquisitionDate": release["acquisitionDate"],
                "checkedAt": release["checkedAt"],
                "updateFrequency": "una tantum (risorsa annuale); acquisizione e promozione manuali",
                "canonicalUrls": [release["landingUrl"], release["downloadUrl"]],
            }
        corpus.validate_spec(spec)
        (staging / "candidate.source.json").write_text(
            json.dumps(spec, ensure_ascii=False, indent=2) + "\n", encoding="utf-8",
        )
        (staging / "profile.json").write_bytes(corpus.canonical_json({
            "sourceLockSha256": lock["integrity"]["lockSha256"],
            "registrySnapshotDate": lock["registry"]["referenceDate"],
            "classificationSnapshotDate": lock["classification"]["referenceDate"],
            "profiles": profiles,
        }))
        staging.rename(output)


def prepare(
    spending: dict[int, Path], registry: Path, cnd: Path, output: Path,
    *, lock_path: Path = source.DEFAULT_SPEC, base_spec_path: Path | None = None,
) -> None:
    if set(spending) != set(PILOT_YEARS):
        raise source.SourceError("Il candidato richiede soltanto le annualità pilota 2020 e 2021")
    if output.exists():
        raise source.SourceError("La directory candidata esiste già: scegliere una nuova destinazione")
    lock = source.load_spec(lock_path)
    spec, existing = corpus.load_spec(base_spec_path or corpus.DEFAULT_SPEC)
    if DATASET_IDS & {item["id"] for item in existing}:
        raise source.SourceError("Dataset già nel corpus: serve una revisione esplicita della release")
    source._verify_file(registry, lock["registry"]["archive"], "BD/RDM")
    source._verify_zip_member(registry, lock["registry"]["archive"], "BD/RDM")
    source._verify_file(cnd, lock["classification"], "CND")
    output.parent.mkdir(parents=True, exist_ok=True)
    with tempfile.TemporaryDirectory(prefix=".medical-device-candidate-", dir=output.parent) as directory:
        staging = Path(directory)
        profiles = {}
        for year in PILOT_YEARS:
            release = lock["spendingReleases"][str(year)]
            if release["publicationDisposition"] != "pilot-candidate" or release["licenseStatus"] != "IODL-2.0":
                raise source.SourceError(f"Release {year} non ammessa nel candidato")
            archive = release["archive"]
            source._verify_file(spending[year], archive, f"spesa {year}")
            source._verify_zip_member(spending[year], archive, f"spesa {year}")
            result = source.profile(
                spending[year], registry, cnd, year,
                spending_member=archive["member"],
                registry_member=lock["registry"]["archive"]["member"],
            )
            source.verify_locked_profile(result, lock, year)
            profiles[str(year)] = result
            item = dataset_entry(year, release)
            target = staging / item["relativePath"]
            with zipfile.ZipFile(spending[year]) as zipped, zipped.open(archive["member"]) as raw, target.open("wb") as handle:
                shutil.copyfileobj(raw, handle, length=1024 * 1024)
            source._verify_file(target, item["expected"], f"CSV candidato {year}")
            spec["datasets"].append(item)
            spec["sourceMetadata"]["overrides"][item["id"]] = {
                "holder": lock["holder"],
                "referencePeriod": str(year),
                "publicationDate": release["publicationDate"],
                "acquisitionDate": release["acquisitionDate"],
                "checkedAt": release["checkedAt"],
                "updateFrequency": "una tantum (risorsa annuale); acquisizione e promozione manuali",
                "canonicalUrls": [release["landingUrl"], release["downloadUrl"]],
            }
        registry_expected = normalize_registry(registry, lock["registry"], staging / f"{model.REGISTRY_DATASET}.csv")
        references = [
            reference_entry(model.REGISTRY_DATASET, registry_expected, [
                "Snapshot BD/RDM corrente al 14 settembre 2026, non storico dell'anno di spesa. Nessuna misura monetaria.",
                "Chiave composta tipologia_dm + progressivo_dm_ass; iscrizione_repertorio è soltanto un flag S/N.",
                "Proiezione DVNS: rimosso soltanto il separatore finale dell'intestazione; tutte le righe originali hanno 16 celle. Byte e hash originali nel source lock del pilota.",
                "Campi fiscali e loro copie oscurati dalla policy condivisa prima degli hash pubblici. PARTITAIVA_VATNUMBER_MAND non viene reinterpretato come partita IVA del fabbricante.",
                "9999/12/31 è una fine validità convenzionale, non una scadenza commerciale. Nessuna riclassificazione storica o unificazione societaria.",
                "Fabbricante/assemblatore non significa fornitore contrattuale o beneficiario del pagamento.",
            ]),
            reference_entry(model.CND_DATASET, {"bytes": lock["classification"]["bytes"], "sha256": lock["classification"]["sha256"],
                "rows": lock["classification"]["expected"]["rows"], "columns": len(source.CND_HEADERS), "headers": source.CND_HEADERS}, [
                "CND: snapshot del 1 settembre 2026, senza misure monetarie. Conservati tutti i codici e intervalli di validità della fonte.",
                "Uno stesso codice può avere più versioni; codice e sola data iniziale non identificano sempre un intervallo univoco.",
                "Non sostituisce la CND dei file di spesa; nessuna equivalenza o conversione automatica in CID o EMDN.",
            ]),
        ]
        shutil.copyfile(cnd, staging / f"{model.CND_DATASET}.csv")
        source._verify_file(staging / f"{model.CND_DATASET}.csv", lock["classification"], "CND candidata")
        for item, key, frequency in zip(references, ("registry", "classification"), ("settimanale", "mensile"), strict=True):
            metadata = lock[key]
            spec["datasets"].append(item)
            spec["sourceMetadata"]["overrides"][item["id"]] = {
                "holder": lock["holder"], "referencePeriod": metadata["referenceDate"],
                "publicationDate": None, "acquisitionDate": metadata["acquisitionDate"], "checkedAt": metadata["checkedAt"],
                "updateFrequency": frequency + "; acquisizione e promozione manuali",
                "canonicalUrls": [metadata["landingUrl"], metadata["downloadUrl"]],
            }
        corpus.validate_spec(spec)
        (staging / "candidate.source.json").write_text(
            json.dumps(spec, ensure_ascii=False, indent=2) + "\n",
            encoding="utf-8",
        )
        (staging / "profile.json").write_bytes(corpus.canonical_json({
            "sourceLockSha256": lock["integrity"]["lockSha256"],
            "registrySnapshotDate": lock["registry"]["referenceDate"],
            "classificationSnapshotDate": lock["classification"]["referenceDate"],
            "profiles": profiles,
        }))
        staging.rename(output)


def verify_prepared(source_root: Path, dataset_ids: set[str] = DATASET_IDS) -> None:
    """Reproduce the selected published medical-device tables from prepared CSVs."""
    spec, datasets = corpus.load_spec(corpus.DEFAULT_SPEC)
    selected = [item for item in datasets if item["id"] in dataset_ids]
    if {item["id"] for item in selected} != dataset_ids:
        raise source.SourceError("Le tabelle selezionate dei dispositivi medici non sono tutte nel corpus")
    catalog = json.loads(corpus.DEFAULT_CATALOG.read_bytes())
    for item in selected:
        entry, receipt, artifacts = corpus.build_delimited_artifacts(
            source_root, item, corpus.resolved_source_metadata(spec, item["id"]), corpus.DEFAULT_ROWS_DIR,
        )
        expected_paths = set(corpus.DEFAULT_ROWS_DIR.glob(f"{item['id']}.part-*.jsonl.gz"))
        if set(artifacts) != expected_paths or any(path.read_bytes() != payload for path, payload in artifacts.items()):
            raise source.SourceError(f"Proiezione corpus divergente: {item['id']}")
        if (corpus.DEFAULT_RECEIPTS_DIR / f"{item['id']}.receipt.json").read_bytes() != corpus.canonical_json(receipt):
            raise source.SourceError(f"Ricevuta corpus divergente: {item['id']}")
        if next((row for row in catalog["datasets"] if row["id"] == item["id"]), None) != entry:
            raise source.SourceError(f"Catalogo divergente: {item['id']}")
        print(f"Verificato {item['id']}: {entry['publicRows']} righe", flush=True)


def main() -> int:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--historical", action="store_true", help="Prepara l'estensione storica 2018–2019")
    parser.add_argument("--spending-2018", type=Path)
    parser.add_argument("--spending-2019", type=Path)
    parser.add_argument("--spending-2020", type=Path)
    parser.add_argument("--spending-2021", type=Path)
    parser.add_argument("--registry", type=Path)
    parser.add_argument("--cnd", type=Path)
    parser.add_argument("--output-dir", type=Path, help="Nuova directory locale, fuori dagli artifact pubblicati")
    parser.add_argument("--base-spec", type=Path, help="Spec del corpus precedente all'append da preparare")
    parser.add_argument("--check", action="store_true")
    parser.add_argument("--check-scope", choices=("pilot", "historical", "all"))
    parser.add_argument("--input-dir", type=Path, help="CSV preparati da input ufficiali verificati; necessari per --check")
    args = parser.parse_args()
    if args.check:
        if args.input_dir is None or args.historical or any((
            args.spending_2018, args.spending_2019, args.spending_2020, args.spending_2021,
            args.registry, args.cnd, args.output_dir, args.base_spec,
        )):
            parser.error("--check richiede solo --input-dir e, facoltativamente, --check-scope")
        scopes = {
            "pilot": PILOT_DATASET_IDS,
            "historical": HISTORICAL_DATASET_IDS,
            "all": DATASET_IDS,
        }
        verify_prepared(args.input_dir, scopes[args.check_scope or "all"])
        return 0
    if args.input_dir is not None:
        parser.error("--input-dir è ammesso soltanto con --check")
    if args.check_scope is not None:
        parser.error("--check-scope è ammesso soltanto con --check")
    common = (args.registry, args.cnd, args.output_dir)
    if args.historical:
        if not all((*common, args.spending_2018, args.spending_2019)) or any((args.spending_2020, args.spending_2021)):
            parser.error("estensione storica: richiesti solo 2018, 2019, --registry, --cnd e --output-dir")
        prepare_historical(
            {2018: args.spending_2018, 2019: args.spending_2019},
            args.registry, args.cnd, args.output_dir,
            base_spec_path=args.base_spec,
        )
        years = HISTORICAL_YEARS
    else:
        if not all((*common, args.spending_2020, args.spending_2021)) or any((args.spending_2018, args.spending_2019)):
            parser.error("pilota: richiesti solo 2020, 2021, --registry, --cnd e --output-dir")
        prepare(
            {2020: args.spending_2020, 2021: args.spending_2021},
            args.registry, args.cnd, args.output_dir,
            base_spec_path=args.base_spec,
        )
        years = PILOT_YEARS
    print(json.dumps({"status": "candidate-only", "years": years, "output": str(args.output_dir)}, ensure_ascii=False))
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
