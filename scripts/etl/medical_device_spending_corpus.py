#!/usr/bin/env python3
"""Prepare the verified 2020–2021 source tables for the shared corpus append.

The output is a local candidate, not a sealed release. It keeps the original
CSV bytes and a copy of the corpus spec; no committed artifact is replaced.
BD/RDM and CND remain separate inputs to the join audit, not copied into facts.
"""
from __future__ import annotations

import argparse
import json
import shutil
import tempfile
import zipfile
from pathlib import Path

import integrated_curated_datasets as corpus
import medical_device_spending_profile as source


PILOT_YEARS = (2020, 2021)


def dataset_entry(year: int, release: dict) -> dict:
    archive = release["archive"]
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
            "columns": len(source.SPENDING_HEADERS),
            "headers": source.SPENDING_HEADERS,
        },
        "sourceFields": [],
        "privateFields": [],
        "caveats": [
            "CostoAcq: euro nel lessico originale italiano; virgola decimale e punto delle migliaia. "
            "Conversione esatta con parse_source_euros e somme con monetary.add_decimals, senza float.",
            "Spesa rilevata nel perimetro pubblicato, non automaticamente tutta la spesa SSN; "
            "non sommare con CE, SIOPE o aggiudicazioni. Non misura incassi del fabbricante o prezzi unitari.",
            "Ogni record originale resta distinto, incluse rettifiche negative, zeri e righe ripetute. "
            "Una cella vuota non è uno zero.",
            "CodASL è contestualizzato da CodRegCommit e Anno; nessun raccordo implicito con IPA, CE o SIOPE.",
            "CodTipoDM e NumRep formano la chiave composta. L'arricchimento BD/RDM è separato; "
            "le righe non abbinate restano nella tabella e nella spesa osservata.",
            "CodiceCND conserva la classificazione della fonte, senza sostituirla con quella corrente "
            "o rinominarla CID/EMDN. Il CSV non dichiara una versione della classificazione.",
            f"Release selezionata: {release['releaseId']}. La data di pubblicazione è quella del catalogo; "
            "la data ZIP non è una data certificata di estrazione ministeriale.",
        ],
    }


def prepare(
    spending: dict[int, Path], registry: Path, cnd: Path, output: Path,
    *, lock_path: Path = source.DEFAULT_SPEC,
) -> None:
    if set(spending) != set(PILOT_YEARS):
        raise source.SourceError("Il candidato richiede soltanto le annualità pilota 2020 e 2021")
    if output.exists():
        raise source.SourceError("La directory candidata esiste già: scegliere una nuova destinazione")
    lock = source.load_spec(lock_path)
    spec, existing = corpus.load_spec(corpus.DEFAULT_SPEC)
    ids = {f"salute-spesa-dispositivi-{year}" for year in PILOT_YEARS}
    if ids & {item["id"] for item in existing}:
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
                "updateFrequency": "annuale; revisioni possibili, acquisizione e promozione manuali",
                "canonicalUrls": [release["landingUrl"], release["downloadUrl"]],
            }
        corpus.validate_spec(spec)
        (staging / "candidate.source.json").write_bytes(corpus.canonical_json(spec))
        (staging / "profile.json").write_bytes(corpus.canonical_json({
            "sourceLockSha256": lock["integrity"]["lockSha256"],
            "registrySnapshotDate": lock["registry"]["referenceDate"],
            "classificationSnapshotDate": lock["classification"]["referenceDate"],
            "profiles": profiles,
        }))
        staging.rename(output)


def main() -> int:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--spending-2020", type=Path, required=True)
    parser.add_argument("--spending-2021", type=Path, required=True)
    parser.add_argument("--registry", type=Path, required=True)
    parser.add_argument("--cnd", type=Path, required=True)
    parser.add_argument("--output-dir", type=Path, required=True, help="Nuova directory locale, fuori dagli artifact pubblicati")
    args = parser.parse_args()
    prepare({2020: args.spending_2020, 2021: args.spending_2021}, args.registry, args.cnd, args.output_dir)
    print(json.dumps({"status": "candidate-only", "years": PILOT_YEARS, "output": str(args.output_dir)}, ensure_ascii=False))
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
