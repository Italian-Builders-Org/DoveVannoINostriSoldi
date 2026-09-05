"""Shared official SIOPE acquisition, exact municipal joins and cash aggregation.

Both cash directions use the same registry validity, IPA ambiguity rules and
integer-cent aggregation. Presentation contracts remain separate.
"""
from __future__ import annotations

import csv
import hashlib
import io
import os
import re
import time
import urllib.request
import zipfile
from collections import defaultdict
from dataclasses import dataclass
from datetime import date, datetime, timezone
from pathlib import Path
from typing import Iterable

SIOPE_BASE = "https://www.siope.it/documenti/siope2/open/last"
SIOPE_REGISTRY_FILE = "SIOPE_ANAGRAFICHE.zip"
IPA_ADMINISTRATIONS_URL = (
    "https://indicepa.gov.it/ipa-dati/dataset/502ff370-1b2c-4310-94c7-f39ceb7500e3/"
    "resource/3ed63523-ff9c-41f6-a6fe-980f3d9e501f/download/amministrazioni.txt"
)
USER_AGENT = "DoveVannoINostriSoldi-ETL/1.0 (+https://github.com/Italian-Builders-Org/DoveVannoINostriSoldi)"
CHUNK_SIZE = 1 << 20
MAX_ATTEMPTS = 3
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
    digest = hashlib.sha256()
    with open_with_retry(url, timeout=timeout) as response, tmp.open("wb") as handle:
        while True:
            chunk = response.read(CHUNK_SIZE)
            if not chunk:
                break
            handle.write(chunk)
            digest.update(chunk)
            received += len(chunk)
        metadata = {
            "lastModified": response.headers.get("Last-Modified"),
            "etag": response.headers.get("ETag"),
            "sha256": digest.hexdigest(),
        }

    if received == 0:
        tmp.unlink(missing_ok=True)
        raise RuntimeError(f"Fonte vuota: {url}")

    os.replace(tmp, destination)
    print(f"downloaded {destination.name}: {received / 1_000_000:.1f} MB")
    return metadata


def zip_rows(path: Path, member_prefix: str) -> Iterable[list[str]]:
    with zipfile.ZipFile(path) as archive:
        members = [
            name for name in archive.namelist()
            if os.path.basename(name).upper().startswith(member_prefix.upper())
        ]
        if len(members) != 1:
            raise RuntimeError(f"{path.name}: atteso un solo membro {member_prefix!r}, trovati {len(members)}")
        member = members[0]

        with archive.open(member) as binary:
            text = io.TextIOWrapper(binary, encoding="latin-1", newline="")
            yield from csv.reader(text)


def normalize_header(value: str) -> str:
    return re.sub(r"\s+", "_", value.lstrip("\ufeff").strip().lower())


def ipa_rows(path: Path) -> tuple[dict[str, int], list[list[str]]]:
    text = path.read_bytes().decode("utf-8-sig")
    try:
        delimiter = csv.Sniffer().sniff(text[:16_384], delimiters=";\t,|").delimiter
    except csv.Error:
        delimiter = "\t"
    reader = csv.reader(io.StringIO(text), delimiter=delimiter)
    try:
        header = next(reader)
    except StopIteration as error:
        raise RuntimeError("Dataset IPA Amministrazioni vuoto") from error
    index = {normalize_header(name): position for position, name in enumerate(header)}
    if len(index) != len(header):
        raise RuntimeError("Schema IPA inatteso: intestazioni duplicate")
    rows = list(reader)
    if any(len(row) != len(header) for row in rows):
        raise RuntimeError("Schema IPA inatteso: riga incompleta o campi aggiuntivi")
    return index, rows


def parse_ipa_regions(path: Path) -> dict[str, str]:
    index, rows = ipa_rows(path)
    if "cf" not in index or "regione" not in index:
        raise RuntimeError("Schema IPA inatteso: mancano cf/Regione")
    candidates: dict[str, set[str]] = defaultdict(set)
    for row in rows:
        cf = row[index["cf"]].strip()
        region = re.sub(r"\s+", " ", row[index["regione"]].strip())
        if cf and region:
            candidates[cf].add(region)
    return {cf: next(iter(regions)) for cf, regions in candidates.items() if len(regions) == 1}


def parse_ipa_municipality_identifiers(path: Path) -> dict[str, dict[str, str]]:
    index, rows = ipa_rows(path)
    if "cf" not in index or "cod_amm" not in index:
        raise RuntimeError("Schema IPA inatteso: mancano identificativi cf/cod_amm")
    candidates: dict[str, set[str]] = defaultdict(set)
    for row in rows:
        cf = row[index["cf"]].strip()
        codice_ipa = row[index["cod_amm"]].strip()
        if re.fullmatch(r"\d{11}", cf) and codice_ipa:
            candidates[cf].add(codice_ipa)
    return {cf: {"codiceIpa": next(iter(values))} for cf, values in candidates.items() if len(values) == 1}


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
    year: int,
    ipa_identifiers: dict[str, dict[str, str]] | None = None,
) -> tuple[dict[str, dict], dict[str, dict], int]:
    """Return municipalities whose SIOPE validity intersects the requested year."""
    active: dict[str, dict] = {}
    provinces = parse_siope_provinces(registry_zip)
    period_start = date(year, 1, 1)
    period_end = date(year, 12, 31)

    for row in zip_rows(registry_zip, "ANAG_ENTI_SIOPE"):
        if len(row) != 9:
            raise RuntimeError("ANAG_ENTI_SIOPE: schema inatteso; riga non scartabile")
        code, valid_from, valid_to, cf, name, _municipality, province_code, population, entity_type = (
            value.strip() for value in row
        )
        if entity_type.upper() != "COMUNE":
            continue
        try:
            valid_from_date = date.fromisoformat(valid_from)
            valid_to_date = date.fromisoformat(valid_to)
        except ValueError as error:
            raise RuntimeError(f"ANAG_ENTI_SIOPE: validità non valida per il Comune {cf or code}")
        if valid_from_date > valid_to_date:
            raise RuntimeError(f"ANAG_ENTI_SIOPE: intervallo invertito per il Comune {cf or code}")
        if valid_from_date > period_end or valid_to_date < period_start:
            continue
        if not code or not cf:
            raise RuntimeError("ANAG_ENTI_SIOPE: Comune senza codice ente o codice fiscale")
        region = ipa_regions.get(cf)
        province = provinces.get(province_code)
        if province is None:
            raise RuntimeError(f"Provincia SIOPE sconosciuta per il Comune {cf}: {province_code}")
        municipality = {
            "key": cf,
            "code": code,
            "name": name or "Comune non indicato",
            "cf": cf,
            "region": region,
            "province": province,
            "population": parse_population(population),
            "codiceIpa": (ipa_identifiers or {}).get(cf, {}).get("codiceIpa"),
            "validFrom": valid_from,
            "validTo": valid_to,
        }
        previous = active.get(code)
        if previous is not None and previous["key"] != cf:
            raise RuntimeError(
                f"ANAG_ENTI_SIOPE: codice ente {code} associato a più codici fiscali"
            )
        if previous is not None and municipality["validFrom"] == previous["validFrom"]:
            raise RuntimeError(f"ANAG_ENTI_SIOPE: validità duplicata per il codice ente {code}")
        if previous is None or municipality["validFrom"] > previous["validFrom"]:
            active[code] = municipality

    canonical: dict[str, dict] = {}
    for municipality in active.values():
        key = municipality["key"]
        current = canonical.get(key)
        if current is None or municipality["validFrom"] > current["validFrom"]:
            canonical[key] = municipality.copy()

    return active, canonical, len(canonical)


def title_digit(code: str) -> str:
    return next((character for character in code if character.isdigit()), "?")


def euro(cents: int) -> float:
    return round(cents / 100.0, 2)


def per_capita(cents: int, population: int | None) -> float | None:
    if not population:
        return None
    return round((cents / 100.0) / population, 2)


MAX_SAFE_CENTS = 9_007_199_254_740_991


def safe_cents(value: int) -> int:
    if type(value) is not int or abs(value) > MAX_SAFE_CENTS:
        raise RuntimeError("SIOPE: importo fuori dall'intervallo intero sicuro")
    return value


def parse_amount(raw: str) -> int:
    # SIOPE supplies signed integer cents, not locale-formatted euro amounts.
    if not re.fullmatch(r"-?[0-9]+", raw):
        raise RuntimeError(f"SIOPE: importo in centesimi non valido: {raw!r}")
    return safe_cents(int(raw))


@dataclass
class MunicipalCash:
    municipalities: dict[str, dict]
    municipality_cents: dict[str, int]
    municipality_title_cents: dict[str, dict[str, int]]
    region_cents: dict[str, int]
    title_cents: dict[str, int]
    national_monthly: list[int]
    observed_keys: set[str]
    months_seen: set[int]
    rows_total: int
    rows_included: int

    @property
    def latest_month(self) -> int:
        return max(self.months_seen)


def aggregate_cash(
    *, year: int, flow: str, titles: dict[str, str], movements_zip: Path,
    registry_zip: Path, ipa_path: Path,
) -> MunicipalCash:
    if flow not in ("entrate", "uscite"):
        raise RuntimeError(f"Direzione SIOPE non valida: {flow}")
    by_code, municipalities, _ = load_municipalities(
        registry_zip, parse_ipa_regions(ipa_path), year,
        parse_ipa_municipality_identifiers(ipa_path),
    )
    totals: dict[str, int] = defaultdict(int)
    by_title: dict[str, dict[str, int]] = defaultdict(lambda: defaultdict(int))
    regions: dict[str, int] = defaultdict(int)
    national_titles: dict[str, int] = defaultdict(int)
    monthly = [0] * 12
    observed: set[str] = set()
    months: set[int] = set()
    seen: set[tuple[str, int, str]] = set()
    rows_total = rows_included = 0
    for row in zip_rows(movements_zip, f"{flow.upper()}_{year}"):
        rows_total += 1
        if len(row) != 5:
            raise RuntimeError(f"SIOPE {flow}: schema inatteso alla riga {rows_total}")
        code, raw_year, raw_month, management_code, raw_amount = (
            value.strip() for value in row
        )
        if raw_year != str(year):
            raise RuntimeError(f"SIOPE {flow}: anno inatteso {raw_year!r}, atteso {year}")
        if not re.fullmatch(r"[0-9]{1,2}", raw_month) or not 1 <= int(raw_month) <= 12:
            raise RuntimeError(f"SIOPE {flow}: mese non valido {raw_month!r}")
        municipality = by_code.get(code)
        if municipality is None:
            continue
        month = int(raw_month)
        cents = parse_amount(raw_amount)
        if not re.fullmatch(r"(?:[0-9](?:\.[0-9]{2}){3}\.[0-9]{3}|[0-9]+)", management_code) or management_code[0] not in titles:
            raise RuntimeError(f"SIOPE {flow}: codice gestionale non valido {management_code!r}")
        movement_key = (code, month, management_code)
        if movement_key in seen:
            raise RuntimeError(f"SIOPE {flow}: movimento duplicato {movement_key}")
        seen.add(movement_key)
        key = municipality["key"]
        region = municipality["region"]
        digit = management_code[0]
        totals[key] = safe_cents(totals[key] + cents)
        by_title[key][digit] = safe_cents(by_title[key][digit] + cents)
        if region:
            regions[region] = safe_cents(regions[region] + cents)
        national_titles[digit] = safe_cents(national_titles[digit] + cents)
        monthly[month - 1] = safe_cents(monthly[month - 1] + cents)
        observed.add(key)
        months.add(month)
        rows_included += 1
    if not months:
        raise RuntimeError(f"Nessun movimento comunale SIOPE trovato per il {year}")
    total = safe_cents(sum(monthly))
    if total != sum(totals.values()) or total != sum(national_titles.values()):
        raise RuntimeError("SIOPE: aggregati nazionali non riconciliati")
    for key, amount in totals.items():
        if amount != sum(by_title[key].values()):
            raise RuntimeError(f"SIOPE: titoli comunali non riconciliati per {key}")
    return MunicipalCash(
        municipalities, totals, by_title, regions, national_titles, monthly,
        observed, months, rows_total, rows_included,
    )


def build_regions(cash: MunicipalCash) -> list[dict]:
    regions = []
    for region, cents in cash.region_cents.items():
        keys = {key for key in cash.observed_keys if cash.municipalities[key]["region"] == region}
        population_keys = {key for key in keys if cash.municipalities[key]["population"] is not None}
        population_values = [cash.municipalities[key]["population"] for key in population_keys]
        population = sum(population_values) if population_values else None
        covered = safe_cents(sum(cash.municipality_cents[key] for key in population_keys))
        regions.append({
            "region": region, "value": euro(cents), "perCapitaValue": euro(covered),
            "population": population, "perCapita": per_capita(covered, population),
            "municipalities": len(keys), "municipalitiesWithPopulation": len(population_keys),
        })
    return sorted(regions, key=lambda item: item["value"], reverse=True)


def build_monthly(cash: MunicipalCash) -> list[dict]:
    monthly = []
    cumulative = 0
    for month in sorted(cash.months_seen):
        cents = cash.national_monthly[month - 1]
        cumulative = safe_cents(cumulative + cents)
        monthly.append({
            "month": month, "label": MONTH_NAMES[month - 1],
            "flow": euro(cents), "cumulative": euro(cumulative),
        })
    return monthly


def build_detail(cash: MunicipalCash, *, year: int, observed_at: str, titles: dict[str, str], scope: str) -> dict:
    rows = []
    for key in sorted(cash.municipalities):
        municipality = cash.municipalities[key]
        observed = key in cash.observed_keys
        rows.append([
            municipality["cf"], municipality["codiceIpa"], municipality["name"],
            municipality["province"], municipality["region"], municipality["population"],
            cash.municipality_cents[key] if observed else None,
            [cash.municipality_title_cents[key].get(code, 0) for code in titles] if observed else None,
        ])
    return {
        "schemaVersion": 1, "scope": scope, "year": year,
        "latestMonth": cash.latest_month, "generatedAt": observed_at,
        "titleOrder": list(titles), "titleLabels": titles,
        "columns": ["taxCode", "codiceIpa", "name", "province", "region", "population", "totalCents", "titleCents"],
        "coverage": {
            "activeMunicipalities": len(rows), "withMovements": len(cash.observed_keys),
            "withoutMovements": len(rows) - len(cash.observed_keys),
            "withPopulation": sum(row[5] is not None for row in rows),
            "withRegion": sum(row[4] is not None for row in rows),
            "withIpaIdentifier": sum(row[1] is not None for row in rows),
        },
        "municipalities": rows,
        "methodology": {
            "join": "codice fiscale del Comune nell'anagrafica SIOPE",
            "absence": "totalCents e titleCents null indicano nessun movimento osservato; zero indica un valore osservato",
            "amounts": "centesimi di euro interi; i Titoli riconciliano con il totale comunale",
        },
    }


def build_source(*, year: int, flow: str, validators: dict, observed_at: str) -> dict:
    source = {
        "siopeOwner": "Ragioneria Generale dello Stato · banca dati gestita da Banca d'Italia",
        "siopeMovementsUrl": f"{SIOPE_BASE}/SIOPE_{flow.upper()}.{year}.zip",
        "siopeRegistryUrl": f"{SIOPE_BASE}/{SIOPE_REGISTRY_FILE}",
        "ipaUrl": IPA_ADMINISTRATIONS_URL,
        "observedAt": observed_at,
    }
    for key, prefix in (("movements", "siopeMovements"), ("registry", "siopeRegistry"), ("ipa", "ipa")):
        digest = validators[key].get("sha256")
        if not isinstance(digest, str) or not re.fullmatch(r"[a-f0-9]{64}", digest):
            raise RuntimeError(f"SIOPE: SHA-256 {key} mancante o non valido")
        for field in ("lastModified", "etag", "sha256"):
            source[prefix + field[0].upper() + field[1:]] = validators[key].get(field)
    return source
