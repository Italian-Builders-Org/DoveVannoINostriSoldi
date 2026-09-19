#!/usr/bin/env python3
"""Profile Ministry medical-device spending inputs without publishing rows."""
from __future__ import annotations

import argparse
import csv
import hashlib
import json
import re
import zipfile
from collections import Counter
from datetime import date
from decimal import Decimal, InvalidOperation
from pathlib import Path
from urllib.parse import urlparse

from monetary import add_decimals


SPENDING_HEADERS = ["Anno", "CodRegCommit", "CodASL", "AziendaSanitaria", "CodTipoDM", "NumRep", "CodiceCND", "CostoAcq"]
SPENDING_HEADERS_2018_2019 = [
    "Anno", "CodRegCommit", "RegioneCommit", "CodASL", "AziendaSanitaria",
    "CodiceCND", "CodTipoDM", "NumRep", "CostoAcq",
]
REGISTRY_HEADERS = ["tipologia_dm", "progressivo_dm_ass", "data_prima_pubblicazione", "dm_riferimento", "gruppo_dm_simili", "iscrizione_repertorio", "data_inizio_validita", "data_fine_validita", "fabbricante_assemblatore", "cod_fiscale", "PARTITAIVA_VATNUMBER_MAND", "cod_catalogo_fabbr_ass", "denominazione_commerciale", "classificazione_cnd", "descrizione_cnd", "data_fine_commercio", ""]
CND_HEADERS = ["codice_ramo_cnd", "descrizione_ramo_cnd", "livello_finale", "riferimento_civab", "data_inzio_validita", "data_fine_validita"]
DEFAULT_SPEC = Path(__file__).with_name("specs") / "medical-device-spending-pilot.source.json"
MAX_MEMBER_BYTES = 600 * 1024 * 1024
MONEY_RE = re.compile(r"-?(?:\d+|\d{1,3}(?:\.\d{3})+)(?:,\d{1,5})?")
SHA256_RE = re.compile(r"[0-9a-f]{64}")
DEVICE_NUMBER_RE = re.compile(r"[0-9]+")
OFFICIAL_HOSTS = {"www.salute.gov.it", "www.dati.salute.gov.it"}
SPENDING_EXPECTED_KEYS = frozenset(
    {
        "rows",
        "types",
        "decimalScaleRows",
        "zeroAmounts",
        "negativeAmounts",
        "totalEuroExact",
        "matchedRows",
        "unresolvedRows",
        "missingKeyRows",
        "invalidKeyRows",
        "notFoundRows",
        "ambiguousRows",
        "unresolvedEuroExact",
        "repeatedBusinessGrains",
        "maxBusinessGrainOccurrences",
    }
)
REGISTRY_EXPECTED_KEYS = frozenset(
    {
        "rows",
        "types",
        "duplicateCompositeKeys",
        "duplicateBareNumbersAcrossTypes",
        "sentinelValidTo",
    }
)
CLASSIFICATION_EXPECTED_KEYS = frozenset(
    {"rows", "distinctCodes", "codesWithMultipleVersions", "maxVersions"}
)


class SourceError(ValueError):
    """An acquired source violates its observed contract."""


def _require_expected_keys(value: object, expected: frozenset[str], label: str) -> None:
    if not isinstance(value, dict) or set(value) != expected:
        raise SourceError(f"Profilo atteso {label} inatteso")


def canonical_lock_sha256(spec: dict[str, object]) -> str:
    clone = json.loads(json.dumps(spec))
    clone["integrity"]["lockSha256"] = ""
    payload = json.dumps(clone, ensure_ascii=False, sort_keys=True, separators=(",", ":")).encode()
    return hashlib.sha256(payload).hexdigest()


def load_spec(path: Path = DEFAULT_SPEC) -> dict[str, object]:
    try:
        spec = json.loads(path.read_text(encoding="utf-8"))
    except (OSError, UnicodeError, json.JSONDecodeError) as error:
        raise SourceError("Source lock dispositivi illeggibile") from error
    if spec.get("schemaVersion") != 1 or spec.get("datasetId") != "medical-device-spending-pilot":
        raise SourceError("Identità source lock dispositivi inattesa")
    if spec.get("schemas") != {
        "spendingHeaders": SPENDING_HEADERS,
        "spendingHeaders2018To2019": SPENDING_HEADERS_2018_2019,
        "registryHeaders": REGISTRY_HEADERS,
        "classificationHeaders": CND_HEADERS,
    }:
        raise SourceError("Schemi source lock dispositivi divergenti")
    releases = spec.get("spendingReleases")
    inventory_years = {str(year) for year in range(2012, 2024)}
    if not isinstance(releases, dict) or set(releases) != inventory_years:
        raise SourceError("Release dispositivi inattese")
    release_ids: set[str] = set()
    for year, release in releases.items():
        if not isinstance(release, dict) or release.get("referencePeriod") != year:
            raise SourceError(f"Periodo source lock spesa {year} inatteso")
        expected_license = "IODL-2.0" if year <= "2021" else "not-declared"
        if year <= "2017":
            expected_disposition = "inventory-only"
            expected_acquisition = "cataloged-not-acquired"
        elif year <= "2019":
            expected_disposition = "historical-candidate"
            expected_acquisition = "acquired-profiled"
        elif year <= "2021":
            expected_disposition = "pilot-candidate"
            expected_acquisition = "acquired-profiled"
        else:
            expected_disposition = "blocked-license"
            expected_acquisition = "acquired-profiled"
        if release.get("licenseStatus") != expected_license:
            raise SourceError(f"Licenza source lock spesa {year} inattesa")
        release_id = release.get("releaseId")
        if (
            not isinstance(release_id, str)
            or not release_id
            or release_id in release_ids
            or release.get("publicationDisposition") != expected_disposition
            or release.get("acquisitionStatus") != expected_acquisition
        ):
            raise SourceError(f"Selezione release spesa {year} inattesa")
        release_ids.add(release_id)
        url_fields = ("landingUrl", "downloadUrl")
        if expected_license == "not-declared":
            if not release.get("siteTermsUrl"):
                raise SourceError(f"Contesto licenza source lock spesa {year} assente")
            url_fields += ("siteTermsUrl",)
        _require_official_urls(release, url_fields, f"spesa {year}")
        _require_iso_date(release.get("publicationDate"), f"pubblicazione spesa {year}")
        _require_iso_date(release.get("checkedAt"), f"controllo spesa {year}")
        if expected_acquisition == "acquired-profiled":
            _require_iso_date(release.get("acquisitionDate"), f"acquisizione spesa {year}")
            _require_archive_lock(release.get("archive"), f"spesa {year}")
            _require_expected_keys(release.get("expected"), SPENDING_EXPECTED_KEYS, f"spesa {year}")
        elif "acquisitionDate" in release or "archive" in release or "expected" in release:
            raise SourceError(f"Release non acquisita spesa {year} contiene ricevute")
    registry = spec.get("registry")
    classification = spec.get("classification")
    if not isinstance(registry, dict) or registry.get("licenseStatus") != "IODL-2.0":
        raise SourceError("Metadati source lock BD/RDM inattesi")
    if not isinstance(classification, dict) or classification.get("licenseStatus") != "IODL-2.0":
        raise SourceError("Metadati source lock CND inattesi")
    _require_official_urls(registry, ("landingUrl", "downloadUrl"), "BD/RDM")
    _require_official_urls(classification, ("landingUrl", "downloadUrl"), "CND")
    _require_iso_date(registry.get("referenceDate"), "riferimento BD/RDM")
    _require_iso_date(registry.get("acquisitionDate"), "acquisizione BD/RDM")
    _require_iso_date(classification.get("referenceDate"), "riferimento CND")
    _require_iso_date(classification.get("acquisitionDate"), "acquisizione CND")
    _require_iso_date(registry.get("checkedAt"), "controllo BD/RDM")
    _require_iso_date(classification.get("checkedAt"), "controllo CND")
    _require_archive_lock(registry.get("archive"), "BD/RDM")
    _require_expected_keys(registry.get("expected"), REGISTRY_EXPECTED_KEYS, "BD/RDM")
    if not isinstance(classification.get("bytes"), int) or classification["bytes"] <= 0 or not SHA256_RE.fullmatch(str(classification.get("sha256", ""))):
        raise SourceError("Integrità source lock CND inattesa")
    _require_expected_keys(classification.get("expected"), CLASSIFICATION_EXPECTED_KEYS, "CND")
    integrity = spec.get("integrity")
    if not isinstance(integrity, dict) or integrity.get("algorithm") != "sha256":
        raise SourceError("Algoritmo source lock dispositivi inatteso")
    locked = integrity.get("lockSha256")
    if locked != canonical_lock_sha256(spec):
        raise SourceError("Hash source lock dispositivi divergente")
    return spec


def _require_official_urls(item: dict[str, object], fields: tuple[str, ...], label: str) -> None:
    for field in fields:
        value = item.get(field)
        parsed = urlparse(value if isinstance(value, str) else "")
        if parsed.scheme != "https" or parsed.hostname not in OFFICIAL_HOSTS:
            raise SourceError(f"URL ufficiale {label} inatteso")


def _require_iso_date(value: object, label: str) -> None:
    try:
        date.fromisoformat(value if isinstance(value, str) else "")
    except ValueError as error:
        raise SourceError(f"Data {label} inattesa") from error


def _require_archive_lock(value: object, label: str) -> None:
    if not isinstance(value, dict):
        raise SourceError(f"Integrità archivio {label} inattesa")
    if not isinstance(value.get("bytes"), int) or value["bytes"] <= 0:
        raise SourceError(f"Dimensione archivio {label} inattesa")
    if not isinstance(value.get("memberBytes"), int) or value["memberBytes"] <= 0 or value["memberBytes"] > MAX_MEMBER_BYTES:
        raise SourceError(f"Dimensione membro {label} inattesa")
    if not isinstance(value.get("member"), str) or not value["member"]:
        raise SourceError(f"Nome membro {label} inatteso")
    if not SHA256_RE.fullmatch(str(value.get("sha256", ""))) or not SHA256_RE.fullmatch(str(value.get("memberSha256", ""))):
        raise SourceError(f"Hash archivio {label} inatteso")


def _verify_file(path: Path, expected: dict[str, object], label: str) -> None:
    digest = hashlib.sha256()
    try:
        size = path.stat().st_size
        with path.open("rb") as handle:
            while chunk := handle.read(1024 * 1024):
                digest.update(chunk)
    except OSError as error:
        raise SourceError(f"File {label} illeggibile") from error
    if size != expected["bytes"] or digest.hexdigest() != expected["sha256"]:
        raise SourceError(f"Byte {label} divergenti dal source lock")


def _verify_zip_member(path: Path, expected: dict[str, object], label: str) -> None:
    digest = hashlib.sha256()
    try:
        with zipfile.ZipFile(path) as archive:
            infos = archive.infolist()
            if len(infos) != 1 or infos[0].filename != expected["member"] or infos[0].flag_bits & 1:
                raise SourceError(f"Contenuto archivio {label} inatteso")
            if infos[0].file_size != expected["memberBytes"] or infos[0].file_size > MAX_MEMBER_BYTES:
                raise SourceError(f"Dimensione membro {label} divergente dal source lock")
            with archive.open(infos[0]) as handle:
                while chunk := handle.read(1024 * 1024):
                    digest.update(chunk)
    except (OSError, zipfile.BadZipFile) as error:
        raise SourceError(f"Archivio {label} illeggibile") from error
    if digest.hexdigest() != expected["memberSha256"]:
        raise SourceError(f"Byte membro {label} divergenti dal source lock")


def verify_locked_profile(result: dict[str, object], spec: dict[str, object], year: int) -> None:
    release = spec["spendingReleases"].get(str(year))
    if not isinstance(release, dict):
        raise SourceError(f"Annualità {year} fuori dal perimetro bloccato")
    expected = release["expected"]
    observed = {**result["spending"], **result["join"]}
    if any(observed.get(key) != value for key, value in expected.items()):
        raise SourceError(f"Profilo spesa {year} divergente dal source lock")
    registry_expected = spec["registry"]["expected"]
    if any(result["registry"].get(key) != value for key, value in registry_expected.items()):
        raise SourceError("Profilo BD/RDM divergente dal source lock")
    cnd_expected = spec["classification"]["expected"]
    if any(result["cnd"].get(key) != value for key, value in cnd_expected.items()):
        raise SourceError("Profilo CND divergente dal source lock")


def _zip_rows(path: Path, member: str, encoding: str, headers: list[str], label: str):
    try:
        archive = zipfile.ZipFile(path)
    except (OSError, zipfile.BadZipFile) as error:
        raise SourceError(f"Archivio non valido: {path.name}") from error
    with archive:
        infos = archive.infolist()
        if len(infos) != 1 or infos[0].filename != member or infos[0].file_size > MAX_MEMBER_BYTES or infos[0].flag_bits & 1:
            raise SourceError(f"Contenuto archivio inatteso: {path.name}")
        with archive.open(infos[0]) as raw:
            import io
            with io.TextIOWrapper(raw, encoding=encoding, newline="") as text:
                reader = csv.DictReader(text, delimiter=";")
                _require_headers(reader, headers, label)
                yield from reader


def _require_headers(reader, expected: list[str], label: str) -> None:
    if reader.fieldnames != expected:
        raise SourceError(f"Header {label} divergente")


def spending_headers(year: int) -> list[str]:
    if year in {2018, 2019}:
        return SPENDING_HEADERS_2018_2019
    if year in {2020, 2021, 2022, 2023}:
        return SPENDING_HEADERS
    raise SourceError(f"Schema spesa {year} non supportato")


def _require_row_shape(
    row: dict[str | None, str | list[str] | None],
    expected: list[str],
    label: str,
    index: int,
    *,
    allow_missing_empty_header: bool = False,
) -> None:
    invalid_value = any(
        not isinstance(row[field], str) and not (allow_missing_empty_header and field == "" and row[field] is None)
        for field in expected
    )
    if set(row) != set(expected) or invalid_value:
        raise SourceError(f"Forma riga {label} divergente alla riga {index}")


def parse_source_euros(raw: str) -> Decimal:
    if not isinstance(raw, str) or not MONEY_RE.fullmatch(raw):
        raise SourceError("Importo fuori dal lessico monetario osservato")
    try:
        return Decimal(raw.replace(".", "").replace(",", "."))
    except InvalidOperation as error:
        raise SourceError("Importo non decimale") from error


def profile(
    spending_zip: Path,
    registry_zip: Path,
    cnd_csv: Path,
    year: int = 2021,
    *,
    spending_member: str | None = None,
    registry_member: str,
) -> dict[str, object]:
    registry_keys: dict[tuple[str, str], str] = {}
    bare_types: dict[str, set[str]] = {}
    registry_types: Counter[str] = Counter()
    sentinel = 0
    rows = _zip_rows(registry_zip, registry_member, "utf-8-sig", REGISTRY_HEADERS, "BD/RDM")
    try:
        for index, row in enumerate(rows, 1):
            _require_row_shape(row, REGISTRY_HEADERS, "BD/RDM", index, allow_missing_empty_header=True)
            device_type, number = row["tipologia_dm"], row["progressivo_dm_ass"]
            if device_type not in {"1", "2"} or not number:
                raise SourceError(f"Chiave BD/RDM non valida alla riga {index}")
            key = (device_type, number)
            if key in registry_keys:
                raise SourceError(f"Chiave BD/RDM duplicata alla riga {index}")
            registry_keys[key] = row["classificazione_cnd"]
            bare_types.setdefault(number, set()).add(device_type)
            registry_types[device_type] += 1
            sentinel += row["data_fine_validita"].startswith("9999-12-31")
    except (UnicodeError, csv.Error) as error:
        raise SourceError("CSV BD/RDM illeggibile") from error

    spending_types: Counter[str] = Counter()
    years: Counter[str] = Counter()
    total_euro = matched_euro = unresolved_euro = Decimal(0)
    scales: Counter[int] = Counter()
    grains: Counter[tuple[str, str, str, str, str]] = Counter()
    matched = unresolved = missing_key = invalid_key = not_found = zero = negative = cnd_different = 0
    spending_headers_for_year = spending_headers(year)
    spending_rows = _zip_rows(
        spending_zip,
        spending_member or f"Appendice rapporto {year}.csv",
        "ascii",
        spending_headers_for_year,
        "spesa",
    )
    try:
        for index, row in enumerate(spending_rows, 1):
            _require_row_shape(row, spending_headers_for_year, "spesa", index)
            device_type, number = row["CodTipoDM"], row["NumRep"]
            if row["Anno"] != str(year):
                raise SourceError(f"Periodo spesa divergente alla riga {index}")
            years[row["Anno"]] += 1
            spending_types[device_type or "<missing>"] += 1
            grains[(row["CodRegCommit"], row["CodASL"], device_type, number, row["CodiceCND"])] += 1
            try:
                amount = parse_source_euros(row["CostoAcq"])
            except ValueError as error:
                raise SourceError(f"Importo spesa non valido alla riga {index}") from error
            scales[len(row["CostoAcq"].rsplit(",", 1)[1]) if "," in row["CostoAcq"] else 0] += 1
            total_euro = add_decimals(total_euro, amount)
            zero += amount == 0
            negative += amount < 0
            if not device_type or not number:
                missing_key += 1
                unresolved += 1
                unresolved_euro = add_decimals(unresolved_euro, amount)
            elif device_type not in {"1", "2"} or not DEVICE_NUMBER_RE.fullmatch(number):
                invalid_key += 1
                unresolved += 1
                unresolved_euro = add_decimals(unresolved_euro, amount)
            elif (device_type, number) in registry_keys:
                matched += 1
                matched_euro = add_decimals(matched_euro, amount)
                cnd_different += row["CodiceCND"] != registry_keys[(device_type, number)]
            else:
                not_found += 1
                unresolved += 1
                unresolved_euro = add_decimals(unresolved_euro, amount)
    except (UnicodeError, csv.Error) as error:
        raise SourceError("CSV spesa illeggibile") from error
    if total_euro != add_decimals(matched_euro, unresolved_euro) or matched + unresolved != sum(years.values()):
        raise SourceError("Riconciliazione del left join non chiusa")

    codes: Counter[str] = Counter()
    try:
        with cnd_csv.open(encoding="utf-8-sig", newline="") as handle:
            reader = csv.DictReader(handle, delimiter=";")
            _require_headers(reader, CND_HEADERS, "CND")
            for index, row in enumerate(reader, 1):
                _require_row_shape(row, CND_HEADERS, "CND", index)
                code = row["codice_ramo_cnd"]
                if not code or not row["data_inzio_validita"]:
                    raise SourceError(f"Chiave CND non valida alla riga {index}")
                codes[code] += 1
    except (OSError, UnicodeError, csv.Error) as error:
        raise SourceError("CSV CND illeggibile") from error

    return {
        "spending": {"rows": sum(years.values()), "years": dict(years), "types": dict(spending_types), "totalEuroExact": str(total_euro), "decimalScaleRows": {str(key): value for key, value in sorted(scales.items())}, "zeroAmounts": zero, "negativeAmounts": negative, "repeatedBusinessGrains": sum(count > 1 for count in grains.values()), "maxBusinessGrainOccurrences": max(grains.values(), default=0)},
        "registry": {"rows": len(registry_keys), "types": dict(registry_types), "duplicateCompositeKeys": 0, "duplicateBareNumbersAcrossTypes": sum(len(types) > 1 for types in bare_types.values()), "sentinelValidTo": sentinel},
        "cnd": {"rows": sum(codes.values()), "distinctCodes": len(codes), "codesWithMultipleVersions": sum(count > 1 for count in codes.values()), "maxVersions": max(codes.values(), default=0)},
        "join": {"matchedRows": matched, "unresolvedRows": unresolved, "missingKeyRows": missing_key, "invalidKeyRows": invalid_key, "notFoundRows": not_found, "ambiguousRows": 0, "matchedEuroExact": str(matched_euro), "unresolvedEuroExact": str(unresolved_euro), "sourceCurrentCndDifferentRows": cnd_different},
    }


def main() -> int:
    parser = argparse.ArgumentParser()
    parser.add_argument("--spending", type=Path, required=True)
    parser.add_argument("--year", type=int, choices=(2018, 2019, 2020, 2021, 2022, 2023), required=True)
    parser.add_argument("--registry", type=Path, required=True)
    parser.add_argument("--cnd", type=Path, required=True)
    args = parser.parse_args()
    spec = load_spec()
    release = spec["spendingReleases"].get(str(args.year))
    if not isinstance(release, dict) or release.get("acquisitionStatus") != "acquired-profiled":
        raise SourceError(f"Annualità {args.year} fuori dal perimetro acquisito")
    _verify_file(args.spending, release["archive"], f"spesa {args.year}")
    _verify_file(args.registry, spec["registry"]["archive"], "BD/RDM")
    _verify_file(args.cnd, spec["classification"], "CND")
    _verify_zip_member(args.spending, release["archive"], f"spesa {args.year}")
    _verify_zip_member(args.registry, spec["registry"]["archive"], "BD/RDM")
    result = profile(
        args.spending,
        args.registry,
        args.cnd,
        args.year,
        spending_member=release["archive"]["member"],
        registry_member=spec["registry"]["archive"]["member"],
    )
    verify_locked_profile(result, spec, args.year)
    print(json.dumps(result, ensure_ascii=False, sort_keys=True, indent=2))
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
