#!/usr/bin/env python3
"""Build the small SIOPE snapshot consumed by DoveVannoINostriSoldi.

The public SIOPE source publishes one national ZIP per year with *pure monthly*
cash movements. Downloading and parsing that file during a web request would be
slow, expensive and fragile, so this script is intended for a scheduled ETL.

It checks Last-Modified first and only downloads the large source files when one
of the upstreams changed. The generated JSON keeps source timestamps and method
metadata so every chart can explain exactly what it represents.

Scope of v1: cash payments made by municipalities (COMUNE). Region is joined by
codice fiscale against the official IPA "Amministrazioni" dataset. Therefore a
regional total means "payments by municipalities whose legal seat is in that
region", not "all public money spent inside that territory".
"""

from __future__ import annotations

import argparse
import csv
import io
import json
import os
import re
import tempfile
import time
import urllib.request
import zipfile
from collections import defaultdict
from datetime import datetime, timezone
from pathlib import Path
from typing import Iterable

SIOPE_BASE = "https://www.siope.it/documenti/siope2/open/last"
SIOPE_REGISTRY_FILE = "SIOPE_ANAGRAFICHE.zip"
IPA_ADMINISTRATIONS_URL = (
    "https://indicepa.gov.it/ipa-dati/dataset/502ff370-1b2c-4310-94c7-f39ceb7500e3/"
    "resource/3ed63523-ff9c-41f6-a6fe-980f3d9e501f/download/amministrazioni.txt"
)
DEFAULT_OUTPUT = Path("src/data/generated/siope-municipal.json")
USER_AGENT = "DoveVannoINostriSoldi-ETL/1.0 (+https://github.com/Italian-Builders-Org/DoveVannoINostriSoldi)"
CHUNK_SIZE = 1 << 20
MAX_ATTEMPTS = 3

TITLE_LABELS = {
    "0": "Pagamenti da regolarizzare",
    "1": "Spese correnti",
    "2": "Spese in conto capitale",
    "3": "Spese per incremento di attività finanziarie",
    "4": "Rimborso prestiti",
    "5": "Chiusura anticipazioni da tesoriere/cassiere",
    "7": "Uscite per conto terzi e partite di giro",
}

MONTH_NAMES = [
    "Gennaio",
    "Febbraio",
    "Marzo",
    "Aprile",
    "Maggio",
    "Giugno",
    "Luglio",
    "Agosto",
    "Settembre",
    "Ottobre",
    "Novembre",
    "Dicembre",
]


def utc_now() -> str:
    return datetime.now(timezone.utc).isoformat(timespec="seconds")


def request(url: str, *, range_byte: bool = False):
    headers = {"User-Agent": USER_AGENT, "Accept": "*/*"}
    if range_byte:
        headers["Range"] = "bytes=0-0"
    return urllib.request.Request(url, headers=headers)


def open_with_retry(url: str, *, timeout: int, range_byte: bool = False):
    last_error: Exception | None = None
    for attempt in range(MAX_ATTEMPTS):
        try:
            return urllib.request.urlopen(
                request(url, range_byte=range_byte),
                timeout=timeout,
            )
        except Exception as error:
            last_error = error
            if attempt + 1 < MAX_ATTEMPTS:
                time.sleep(2 * (attempt + 1))
    assert last_error is not None
    raise last_error


def remote_metadata(url: str) -> dict[str, str | None]:
    """Read source validators without downloading the body."""
    with open_with_retry(url, timeout=90, range_byte=True) as response:
        response.read(1)
        return {
            "lastModified": response.headers.get("Last-Modified"),
            "etag": response.headers.get("ETag"),
            "contentRange": response.headers.get("Content-Range"),
        }


def download(url: str, destination: Path, *, timeout: int = 600) -> dict[str, str | None]:
    tmp = destination.with_suffix(destination.suffix + ".part")
    received = 0
    with open_with_retry(url, timeout=timeout) as response, tmp.open("wb") as handle:
        while True:
            chunk = response.read(CHUNK_SIZE)
            if not chunk:
                break
            handle.write(chunk)
            received += len(chunk)
        metadata = {
            "lastModified": response.headers.get("Last-Modified"),
            "etag": response.headers.get("ETag"),
        }

    if received == 0:
        tmp.unlink(missing_ok=True)
        raise RuntimeError(f"Fonte vuota: {url}")

    os.replace(tmp, destination)
    print(f"downloaded {destination.name}: {received / 1_000_000:.1f} MB")
    return metadata


def zip_rows(path: Path, member_prefix: str) -> Iterable[list[str]]:
    with zipfile.ZipFile(path) as archive:
        member = next(
            (
                name
                for name in archive.namelist()
                if os.path.basename(name).upper().startswith(member_prefix.upper())
            ),
            None,
        )
        if member is None:
            raise RuntimeError(f"{path.name}: membro {member_prefix!r} non trovato")

        with archive.open(member) as binary:
            text = io.TextIOWrapper(binary, encoding="latin-1", newline="")
            yield from csv.reader(text)


def normalize_header(value: str) -> str:
    return re.sub(r"\s+", "_", value.lstrip("\ufeff").strip().lower())


def parse_ipa_regions(path: Path) -> dict[str, str]:
    raw = path.read_bytes()
    text = raw.decode("utf-8-sig", errors="replace")
    sample = text[:16_384]
    try:
        dialect = csv.Sniffer().sniff(sample, delimiters=";\t,|")
        delimiter = dialect.delimiter
    except csv.Error:
        delimiter = "\t"

    rows = csv.reader(io.StringIO(text), delimiter=delimiter)
    try:
        header = next(rows)
    except StopIteration as error:
        raise RuntimeError("Dataset IPA Amministrazioni vuoto") from error

    index = {normalize_header(name): position for position, name in enumerate(header)}
    cf_index = index.get("cf")
    region_index = index.get("regione")
    if cf_index is None or region_index is None:
        raise RuntimeError(
            f"Schema IPA inatteso: mancano cf/Regione (campi: {list(index)[:12]})"
        )

    candidates: dict[str, set[str]] = defaultdict(set)
    for row in rows:
        if len(row) <= max(cf_index, region_index):
            continue
        cf = row[cf_index].strip()
        region = re.sub(r"\s+", " ", row[region_index].strip())
        if cf and region:
            candidates[cf].add(region)

    return {
        cf: next(iter(regions))
        for cf, regions in candidates.items()
        if len(regions) == 1
    }


def parse_population(raw: str) -> int | None:
    cleaned = raw.strip().replace(" ", "").replace(".", "")
    if not cleaned:
        return None
    try:
        value = float(cleaned.replace(",", "."))
    except ValueError:
        return None
    # The official registry currently uses 00000001 for several municipalities
    # with thousands of residents. Treat that sentinel as missing instead of
    # creating multi-million-euro per-capita outliers.
    if value <= 1:
        return None
    return round(value)


def parse_siope_provinces(registry_zip: Path) -> dict[str, str]:
    provinces: dict[str, str] = {}
    for row in zip_rows(registry_zip, "ANAG_REG_PROV"):
        if len(row) != 5:
            raise RuntimeError("ANAG_REG_PROV: schema inatteso")
        province_code = row[3].strip()
        province_name = row[4].strip()
        if not re.fullmatch(r"\d{3}", province_code) or not province_name:
            raise RuntimeError("ANAG_REG_PROV: provincia non valida")
        previous = provinces.get(province_code)
        if previous is not None and previous != province_name:
            raise RuntimeError(f"ANAG_REG_PROV: codice provincia duplicato {province_code}")
        provinces[province_code] = province_name
    if not provinces:
        raise RuntimeError("ANAG_REG_PROV: nessuna provincia trovata")
    return provinces


def load_municipalities(
    registry_zip: Path,
    ipa_regions: dict[str, str],
) -> tuple[dict[str, dict], dict[str, dict], int]:
    """Return mappings by SIOPE code and canonical municipality key (CF)."""
    active: dict[str, dict] = {}
    active_municipalities = 0
    provinces = parse_siope_provinces(registry_zip)

    for row in zip_rows(registry_zip, "ANAG_ENTI_SIOPE"):
        if len(row) != 9:
            continue
        code, valid_from, valid_to, cf, name, _municipality, province_code, population, entity_type = (
            value.strip() for value in row
        )
        if valid_to != "9999-12-31" or entity_type.upper() != "COMUNE":
            continue
        active_municipalities += 1
        region = ipa_regions.get(cf)
        if not code or not cf or not region:
            continue
        province = provinces.get(province_code)
        if province is None:
            raise RuntimeError(f"Provincia SIOPE sconosciuta per il Comune {cf}: {province_code}")
        active[code] = {
            "key": cf,
            "code": code,
            "name": name or "Comune non indicato",
            "cf": cf,
            "region": region,
            "province": province,
            "population": parse_population(population),
            "validFrom": valid_from,
        }

    canonical: dict[str, dict] = {}
    for municipality in active.values():
        key = municipality["key"]
        current = canonical.get(key)
        if current is None or municipality["validFrom"] > current["validFrom"]:
            canonical[key] = municipality.copy()

    return active, canonical, active_municipalities


def title_digit(code: str) -> str:
    return next((character for character in code if character.isdigit()), "?")


def euro(cents: int) -> float:
    return round(cents / 100.0, 2)


def per_capita(cents: int, population: int | None) -> float | None:
    if not population:
        return None
    return round((cents / 100.0) / population, 2)


def municipality_rankings(
    items: list[dict],
    limit: int = 100,
) -> tuple[list[dict], list[dict]]:
    """Build independent, deterministic absolute and per-capita rankings."""
    by_value = sorted(
        items,
        key=lambda item: (-item["value"], item["codiceFiscale"]),
    )[:limit]
    by_per_capita = sorted(
        (item for item in items if item["perCapita"] is not None),
        key=lambda item: (
            -item["perCapita"],
            -item["value"],
            item["codiceFiscale"],
        ),
    )[:limit]
    return by_value, by_per_capita


def build_snapshot(
    *,
    year: int,
    movements_zip: Path,
    registry_zip: Path,
    ipa_path: Path,
    validators: dict[str, dict[str, str | None]],
) -> dict:
    ipa_regions = parse_ipa_regions(ipa_path)
    by_code, municipalities, active_siope_count = load_municipalities(
        registry_zip,
        ipa_regions,
    )

    municipality_cents: dict[str, int] = defaultdict(int)
    region_cents: dict[str, int] = defaultdict(int)
    title_cents: dict[str, int] = defaultdict(int)
    national_monthly = [0] * 12
    observed_keys: set[str] = set()
    months_seen: set[int] = set()

    rows_total = 0
    rows_included = 0
    malformed = 0

    for row in zip_rows(movements_zip, f"USCITE_{year}"):
        rows_total += 1
        if len(row) != 5:
            malformed += 1
            continue
        code, raw_year, raw_month, management_code, raw_amount = (
            value.strip() for value in row
        )
        if raw_year != str(year):
            continue
        municipality = by_code.get(code)
        if municipality is None:
            continue
        try:
            month = int(raw_month)
            cents = int(raw_amount)
        except ValueError:
            malformed += 1
            continue
        if not 1 <= month <= 12:
            malformed += 1
            continue

        key = municipality["key"]
        region = municipality["region"]
        digit = title_digit(management_code)
        municipality_cents[key] += cents
        region_cents[region] += cents
        title_cents[digit] += cents
        national_monthly[month - 1] += cents
        observed_keys.add(key)
        months_seen.add(month)
        rows_included += 1

    if not months_seen:
        raise RuntimeError(f"Nessun movimento comunale SIOPE trovato per il {year}")

    latest_month = max(months_seen)
    regions: list[dict] = []
    for region, cents in region_cents.items():
        keys = {
            key
            for key in observed_keys
            if municipalities[key]["region"] == region
        }
        population_keys = {
            key for key in keys if municipalities[key]["population"] is not None
        }
        population_values = [municipalities[key]["population"] for key in population_keys]
        population = sum(population_values) if population_values else None
        per_capita_cents = sum(municipality_cents[key] for key in population_keys)
        regions.append(
            {
                "region": region,
                "value": euro(cents),
                "perCapitaValue": euro(per_capita_cents),
                "population": population,
                "perCapita": per_capita(per_capita_cents, population),
                "municipalities": len(keys),
                "municipalitiesWithPopulation": len(population_keys),
            }
        )
    regions.sort(key=lambda item: item["value"], reverse=True)

    municipalities_with_movements: list[dict] = []
    for key, cents in municipality_cents.items():
        municipality = municipalities[key]
        population = municipality["population"]
        municipalities_with_movements.append(
            {
                "name": municipality["name"],
                "region": municipality["region"],
                "province": municipality["province"],
                "codiceFiscale": municipality["cf"],
                "population": population,
                "value": euro(cents),
                "perCapita": per_capita(cents, population),
            }
        )
    top_municipalities_by_value, top_municipalities_by_per_capita = (
        municipality_rankings(municipalities_with_movements)
    )

    titles = [
        {
            "code": digit,
            "label": TITLE_LABELS.get(digit, f"Titolo {digit}"),
            "value": euro(cents),
        }
        for digit, cents in sorted(
            title_cents.items(),
            key=lambda item: item[1],
            reverse=True,
        )
    ]

    monthly: list[dict] = []
    cumulative = 0
    for month in sorted(months_seen):
        cents = national_monthly[month - 1]
        cumulative += cents
        monthly.append(
            {
                "month": month,
                "label": MONTH_NAMES[month - 1],
                "flow": euro(cents),
                "cumulative": euro(cumulative),
            }
        )

    observed_population = sum(
        municipalities[key]["population"] or 0 for key in observed_keys
    )
    payments_with_population_cents = sum(
        municipality_cents[key]
        for key in observed_keys
        if municipalities[key]["population"] is not None
    )
    municipalities_with_population = sum(
        municipalities[key]["population"] is not None for key in observed_keys
    )
    latest_total_cents = sum(national_monthly)

    return {
        "schemaVersion": 3,
        "generatedAt": utc_now(),
        "scope": "municipalities",
        "year": year,
        "latestMonth": latest_month,
        "latestMonthLabel": MONTH_NAMES[latest_month - 1],
        "totalPaid": euro(latest_total_cents),
        "paymentsWithPopulation": euro(payments_with_population_cents),
        "populationCovered": observed_population,
        "nationalPerCapita": per_capita(
            payments_with_population_cents,
            observed_population,
        ),
        "coverage": {
            "activeSiopeMunicipalities": active_siope_count,
            "matchedToIpaRegion": len(municipalities),
            "withMovements": len(observed_keys),
            "unmatchedToIpaRegion": max(active_siope_count - len(municipalities), 0),
            "movementRows": rows_total,
            "includedMovementRows": rows_included,
            "malformedRows": malformed,
            "withPopulation": municipalities_with_population,
            "withoutPopulation": len(observed_keys) - municipalities_with_population,
        },
        "monthly": monthly,
        "regions": regions,
        "titles": titles,
        # Kept as a backwards-compatible alias for existing API/MCP clients.
        "topMunicipalities": top_municipalities_by_value,
        "topMunicipalitiesByValue": top_municipalities_by_value,
        "topMunicipalitiesByPerCapita": top_municipalities_by_per_capita,
        "source": {
            "siopeOwner": "Ragioneria Generale dello Stato · banca dati gestita da Banca d'Italia",
            "siopeMovementsUrl": f"{SIOPE_BASE}/SIOPE_USCITE.{year}.zip",
            "siopeRegistryUrl": f"{SIOPE_BASE}/{SIOPE_REGISTRY_FILE}",
            "ipaUrl": IPA_ADMINISTRATIONS_URL,
            "siopeMovementsLastModified": validators["movements"].get("lastModified"),
            "siopeRegistryLastModified": validators["registry"].get("lastModified"),
            "ipaLastModified": validators["ipa"].get("lastModified"),
            "observedAt": utc_now(),
        },
        "methodology": {
            "measure": "pagamenti di cassa SIOPE dei Comuni",
            "periodicity": "movimenti mensili puri, sommati da gennaio all'ultimo mese disponibile",
            "territorialJoin": (
                "codice fiscale SIOPE → Regione della sede legale in IPA; "
                "Provincia pubblicata nell'anagrafica enti SIOPE"
            ),
            "populationSource": "popolazione riportata nell'anagrafica enti SIOPE",
            "populationReference": "data di riferimento non dichiarata dalla fonte",
            "populationSourceLastModified": validators["registry"].get("lastModified"),
            "perCapitaCoverage": (
                "numeratore e denominatore includono soltanto i Comuni con popolazione valida"
            ),
            "warning": (
                "Il totale regionale rappresenta i pagamenti dei Comuni con sede nella regione; "
                "non misura tutta la spesa pubblica effettuata fisicamente nel territorio. "
                "Il valore pro capite usa la popolazione dell'anagrafica SIOPE: turismo, "
                "pendolarismo, ricostruzioni e servizi sovracomunali possono alterare il confronto."
            ),
        },
    }


def source_validators(year: int) -> dict[str, dict[str, str | None]]:
    return {
        "movements": remote_metadata(f"{SIOPE_BASE}/SIOPE_USCITE.{year}.zip"),
        "registry": remote_metadata(f"{SIOPE_BASE}/{SIOPE_REGISTRY_FILE}"),
        "ipa": remote_metadata(IPA_ADMINISTRATIONS_URL),
    }


def is_unchanged(output: Path, year: int, validators: dict) -> bool:
    if not output.exists():
        return False
    try:
        current = json.loads(output.read_text(encoding="utf-8"))
    except (OSError, json.JSONDecodeError):
        return False
    source = current.get("source", {})
    return (
        current.get("schemaVersion") == 3
        and current.get("year") == year
        and source.get("siopeMovementsLastModified")
        == validators["movements"].get("lastModified")
        and source.get("siopeRegistryLastModified")
        == validators["registry"].get("lastModified")
        and source.get("ipaLastModified") == validators["ipa"].get("lastModified")
        and validators["movements"].get("lastModified") is not None
    )


def parse_args() -> argparse.Namespace:
    parser = argparse.ArgumentParser()
    parser.add_argument("--year", type=int, default=datetime.now(timezone.utc).year)
    parser.add_argument("--output", type=Path, default=DEFAULT_OUTPUT)
    parser.add_argument("--force", action="store_true")
    return parser.parse_args()


def main() -> int:
    args = parse_args()
    if args.year < 2016 or args.year > datetime.now(timezone.utc).year + 1:
        raise SystemExit(f"Anno non valido: {args.year}")

    validators = source_validators(args.year)
    print("source validators:", json.dumps(validators, ensure_ascii=False))
    if not args.force and is_unchanged(args.output, args.year, validators):
        print("SIOPE snapshot unchanged; no large download required")
        return 0

    args.output.parent.mkdir(parents=True, exist_ok=True)
    with tempfile.TemporaryDirectory(prefix="trasparenza-siope-") as temp_dir:
        temp = Path(temp_dir)
        movements = temp / f"SIOPE_USCITE.{args.year}.zip"
        registry = temp / SIOPE_REGISTRY_FILE
        ipa = temp / "amministrazioni.txt"

        movement_response = download(
            f"{SIOPE_BASE}/SIOPE_USCITE.{args.year}.zip",
            movements,
        )
        registry_response = download(f"{SIOPE_BASE}/{SIOPE_REGISTRY_FILE}", registry)
        ipa_response = download(IPA_ADMINISTRATIONS_URL, ipa, timeout=180)

        for key, response_meta in (
            ("movements", movement_response),
            ("registry", registry_response),
            ("ipa", ipa_response),
        ):
            validators[key]["lastModified"] = (
                response_meta.get("lastModified")
                or validators[key].get("lastModified")
            )
            validators[key]["etag"] = response_meta.get("etag") or validators[key].get("etag")

        snapshot = build_snapshot(
            year=args.year,
            movements_zip=movements,
            registry_zip=registry,
            ipa_path=ipa,
            validators=validators,
        )

    args.output.write_text(
        json.dumps(snapshot, ensure_ascii=False, indent=2) + "\n",
        encoding="utf-8",
    )
    print(
        "snapshot written:",
        args.output,
        f"regions={len(snapshot['regions'])}",
        f"municipalities={snapshot['coverage']['withMovements']}",
        f"latest={snapshot['latestMonthLabel']}",
        f"total={snapshot['totalPaid']:.2f}",
    )
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
