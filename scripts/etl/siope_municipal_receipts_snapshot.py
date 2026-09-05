#!/usr/bin/env python3
"""Build separate COMUNE cash-receipt contracts using the shared SIOPE ETL."""
from __future__ import annotations

import argparse
import hashlib
import json
import tempfile
from datetime import datetime
from pathlib import Path

try:
    from . import siope_municipal_core as core
except ImportError:
    import siope_municipal_core as core

SPEC_PATH = Path(__file__).with_name("specs") / "siope-municipal-receipts.source.json"
SPEC = json.loads(SPEC_PATH.read_text(encoding="utf-8"))
YEARS = tuple(SPEC["years"])
TITLE_LABELS = SPEC["titleLabels"]
DETAIL_TITLE_ORDER = tuple(TITLE_LABELS)
OUTPUT_DIR = Path("src/data/generated")


def paths_for_year(year: int) -> tuple[Path, Path]:
    return (
        OUTPUT_DIR / f"siope-municipal-receipts-{year}.json",
        OUTPUT_DIR / f"siope-municipal-receipts-detail-{year}.json",
    )


def source_urls(year: int) -> dict[str, str]:
    return {
        "movements": f"{core.SIOPE_BASE}/SIOPE_ENTRATE.{year}.zip",
        "registry": f"{core.SIOPE_BASE}/{core.SIOPE_REGISTRY_FILE}",
        "ipa": core.IPA_ADMINISTRATIONS_URL,
    }


def acquisition_datetime(value: str) -> datetime:
    try:
        parsed = datetime.fromisoformat(value.replace("Z", "+00:00"))
    except (AttributeError, TypeError, ValueError) as error:
        raise RuntimeError("SIOPE: acquisitionDate raw non valida") from error
    if parsed.tzinfo is None:
        raise RuntimeError("SIOPE: acquisitionDate raw senza fuso orario")
    return parsed


def build_snapshot(
    *, year: int, movements_zip: Path, registry_zip: Path, ipa_path: Path,
    validators: dict, observed_at: str | None = None,
) -> dict:
    if year not in YEARS:
        raise RuntimeError(f"Anno entrate SIOPE non supportato: {year}")
    for key, path in (("movements", movements_zip), ("registry", registry_zip), ("ipa", ipa_path)):
        with path.open("rb") as handle:
            digest = hashlib.file_digest(handle, "sha256").hexdigest()
        if validators.get(key, {}).get("sha256") != digest:
            raise RuntimeError(f"SIOPE: SHA-256 dei byte acquisiti non corrisponde per {key}")
    cash = core.aggregate_cash(
        year=year, flow="entrate", titles=TITLE_LABELS,
        movements_zip=movements_zip, registry_zip=registry_zip, ipa_path=ipa_path,
    )
    acquired_at = max(
        (validators[key].get("acquisitionDate") for key in ("movements", "registry", "ipa")),
        key=acquisition_datetime,
    )
    if observed_at is not None and acquisition_datetime(observed_at) != acquisition_datetime(acquired_at):
        raise RuntimeError("SIOPE: observedAt deve coincidere con il completamento dell'acquisizione")
    observed_at = observed_at or acquired_at
    source = core.build_source(year=year, flow="entrate", validators=validators, observed_at=observed_at)
    source.update({
        "publicationDate": None, "acquisitionDate": observed_at,
        "checkedAt": core.utc_now(), "license": "not-declared",
    })
    observed = cash.observed_keys
    municipalities = cash.municipalities
    with_region = {key for key in observed if municipalities[key]["region"] is not None}
    with_population = {key for key in observed if municipalities[key]["population"] is not None}
    population = sum(municipalities[key]["population"] for key in with_population)
    covered_cents = core.safe_cents(sum(cash.municipality_cents[key] for key in with_population))
    matched = sum(row["region"] is not None for row in municipalities.values())
    detail = core.build_detail(
        cash, year=year, observed_at=observed_at, titles=TITLE_LABELS,
        scope="municipal-receipts-detail",
    )
    detail.update({"flow": "entrate", "unit": "EUR-cent", "accountingBasis": "cash"})
    return {
        "_municipalityDetail": detail,
        "schemaVersion": 1, "scope": "municipal-receipts", "flow": "entrate",
        "unit": "EUR", "accountingBasis": "cash", "year": year,
        "generatedAt": observed_at, "latestMonth": cash.latest_month,
        "latestMonthLabel": core.MONTH_NAMES[cash.latest_month - 1],
        "totalCollected": core.euro(core.safe_cents(sum(cash.municipality_cents.values()))),
        "receiptsWithPopulation": core.euro(covered_cents),
        "populationCovered": population,
        "nationalPerCapita": core.per_capita(covered_cents, population),
        "coverage": {
            "activeSiopeMunicipalities": len(municipalities),
            "matchedToIpaRegion": matched, "unmatchedToIpaRegion": len(municipalities) - matched,
            "withMovements": len(observed), "withRegion": len(with_region),
            "withoutRegion": len(observed - with_region),
            "receiptsWithoutRegion": core.euro(core.safe_cents(sum(cash.municipality_cents[key] for key in observed - with_region))),
            "movementRows": cash.rows_total, "includedMovementRows": cash.rows_included,
            "malformedRows": 0, "withPopulation": len(with_population),
            "withoutPopulation": len(observed - with_population),
        },
        "monthly": core.build_monthly(cash), "regions": core.build_regions(cash),
        "titles": [
            {"code": code, "label": TITLE_LABELS[code], "value": core.euro(cents)}
            for code, cents in sorted(cash.title_cents.items(), key=lambda item: item[1], reverse=True)
        ],
        "source": source,
        "methodology": {
            "measure": "incassi di cassa SIOPE dei Comuni; incasso non equivale ad accertamento o competenza",
            "periodicity": "movimenti mensili puri, sommati da gennaio all'ultimo mese disponibile; il 2026 può essere parziale",
            "territorialJoin": "codice fiscale SIOPE → Regione della sede legale in IPA; Provincia pubblicata nell'anagrafica enti SIOPE; codice IPA univoco sullo stesso codice fiscale",
            "populationSource": "popolazione riportata nell'anagrafica enti SIOPE",
            "populationReference": "data di riferimento non dichiarata dalla fonte",
            "populationSourceLastModified": validators["registry"].get("lastModified"),
            "perCapitaCoverage": "numeratore e denominatore includono soltanto i Comuni con popolazione valida",
            "warning": (
                "Gli incassi non sono accertamenti né entrate di competenza. Il totale regionale riguarda "
                "i Comuni con sede nella regione, non tutta l'entrata pubblica originata nel territorio. "
                "Il periodo 2026 può essere parziale e non va confrontato con anni completi come trend omogeneo. "
                "Il pro capite usa la popolazione SIOPE senza data di riferimento dichiarata. "
                "Entrate e uscite restano distinte: non si calcolano saldo di cassa, residuo fiscale o efficienza."
            ),
        },
    }


def is_unchanged(output: Path, detail_output: Path, year: int, validators: dict) -> bool:
    try:
        from .siope_receipts_check import validate_snapshot
    except ImportError:
        from siope_receipts_check import validate_snapshot
    try:
        current = json.loads(output.read_text(encoding="utf-8"))
        detail = json.loads(detail_output.read_text(encoding="utf-8"))
        validate_snapshot(current, detail)
    except (OSError, ValueError, KeyError, TypeError, AssertionError, RuntimeError):
        return False
    return current["year"] == year and all(
        validators[key].get("lastModified") is not None
        and current["source"].get(prefix + "LastModified") == validators[key]["lastModified"]
        and (validators[key].get("etag") is None or current["source"].get(prefix + "Etag") == validators[key]["etag"])
        for key, prefix in (("movements", "siopeMovements"), ("registry", "siopeRegistry"), ("ipa", "ipa"))
    )


def acquired_inputs(directory: Path, year: int, *, offline: bool) -> tuple[dict, dict]:
    paths = {
        "movements": directory / f"SIOPE_ENTRATE.{year}.zip",
        "registry": directory / core.SIOPE_REGISTRY_FILE,
        "ipa": directory / "amministrazioni.txt",
    }
    validators = {}
    for key, url in source_urls(year).items():
        path = paths[key]
        sidecar = path.with_name(path.name + ".metadata.json")
        if offline:
            metadata = json.loads(sidecar.read_text(encoding="utf-8"))
            with path.open("rb") as handle:
                digest = hashlib.file_digest(handle, "sha256").hexdigest()
            if metadata.get("url") != url or metadata.get("sha256") != digest or metadata.get("byteSize") != path.stat().st_size:
                raise RuntimeError(f"SIOPE: ricevuta raw non valida per {path.name}")
            acquisition_datetime(metadata.get("acquisitionDate"))
        else:
            metadata = core.download(url, path)
            metadata.update({"url": url, "acquisitionDate": core.utc_now(), "byteSize": path.stat().st_size})
            sidecar.write_text(json.dumps(metadata, indent=2) + "\n", encoding="utf-8")
        validators[key] = metadata
    return paths, validators


def main() -> int:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--year", type=int, choices=YEARS)
    parser.add_argument("--output", type=Path)
    parser.add_argument("--detail-output", type=Path)
    parser.add_argument("--input-dir", type=Path, help="Rebuild from saved official bytes and verified metadata sidecars, without network")
    parser.add_argument("--force", action="store_true")
    parser.add_argument("--check", action="store_true", help="Check every published year offline")
    args = parser.parse_args()
    try:
        from .siope_receipts_check import check_committed_snapshots, validate_snapshot
    except ImportError:
        from siope_receipts_check import check_committed_snapshots, validate_snapshot
    if args.check:
        print(json.dumps(check_committed_snapshots(years=(args.year,) if args.year else YEARS), ensure_ascii=False))
        return 0
    if args.year is None:
        parser.error("--year is required for generation")
    default_output, default_detail = paths_for_year(args.year)
    output, detail_output = args.output or default_output, args.detail_output or default_detail
    if not args.input_dir:
        validators = {key: core.remote_metadata(url) for key, url in source_urls(args.year).items()}
        if not args.force and is_unchanged(output, detail_output, args.year, validators):
            print("SIOPE receipts unchanged; no large download required")
            return 0
    with tempfile.TemporaryDirectory(prefix=".siope-receipts-", dir=".") as workspace:
        paths, validators = acquired_inputs(args.input_dir or Path(workspace), args.year, offline=bool(args.input_dir))
        snapshot = build_snapshot(
            year=args.year, movements_zip=paths["movements"], registry_zip=paths["registry"],
            ipa_path=paths["ipa"], validators=validators,
        )
        detail = snapshot.pop("_municipalityDetail")
        validate_snapshot(snapshot, detail)
    output.parent.mkdir(parents=True, exist_ok=True)
    detail_output.parent.mkdir(parents=True, exist_ok=True)
    output.write_text(json.dumps(snapshot, ensure_ascii=False, indent=2) + "\n", encoding="utf-8")
    detail_output.write_text(json.dumps(detail, ensure_ascii=False, separators=(",", ":")) + "\n", encoding="utf-8")
    print(json.dumps({"year": args.year, "totalCollected": snapshot["totalCollected"], "latestMonth": snapshot["latestMonth"], "municipalities": len(detail["municipalities"])}))
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
