#!/usr/bin/env python3
"""Build the fail-closed ItaliaDomani snapshot for PNRR childcare projects."""

from __future__ import annotations

import argparse
import csv
import hashlib
import json
import os
import re
import sys
import tempfile
from datetime import datetime, timezone
from decimal import Decimal, InvalidOperation, ROUND_HALF_UP
from pathlib import Path
from urllib.parse import urlparse

DEFAULT_SPEC = Path("scripts/etl/specs/pnrr-childcare.source.json")
DEFAULT_DATA = Path("src/data/generated/pnrr-childcare.data.json")
DEFAULT_META = Path("src/data/generated/pnrr-childcare.meta.json")
MAX_SAFE_INTEGER = 9_007_199_254_740_991
CUP_RE = re.compile(r"^[A-Z0-9]{15}$")
CIG_RE = re.compile(r"^[A-Z0-9]{10}$")
SHA256_RE = re.compile(r"^[a-f0-9]{64}$")
OFFICIAL_HOST = "www.italiadomani.gov.it"
ASSET_KEYS = frozenset({"projects", "locations", "tenders", "awardees"})
EXPECTED_ASSET_FILE_NAMES = {
    "projects": "PNRR_Progetti.csv",
    "locations": "PNRR_Localizzazione.csv",
    "tenders": "PNRR_Gare.csv",
    "awardees": "PNRR_Aggiudicatari_Gare.csv",
}
EXPECTED_COVERAGE_KEYS = frozenset({
    "referenceDate", "projectRows", "uniqueProjects", "locationRows", "tenderRows",
    "awardeeRows", "projectsWithLocations", "projectsWithTenders", "projectsWithAwardees",
    "municipalities", "unmatchedAwardeeRows",
})
CSV_CONTRACT = {
    "encoding": "utf-8-sig",
    "delimiter": ";",
    "submeasureHeader": "Codice Univoco Submisura",
    "extractionDateHeader": "Data di Estrazione",
}

# This is the complete header contract of the four Italia Domani exports used
# by this ETL.  The source specification repeats these arrays so the lock is
# reviewable without reading the parser; keeping this canonical copy in code
# prevents a source-spec edit from silently turning an unknown column into an
# accepted one.  Additions or renames must be reviewed in both places.
OFFICIAL_CSV_HEADERS = {
    "projects": (
        "Programma", "Missione", "Descrizione Missione", "Componente",
        "Descrizione Componente", "ID Misura", "Codice Univoco Misura",
        "Descrizione Misura", "ID Submisura", "Codice CID",
        "Codice Univoco Submisura", "Descrizione Submisura",
        "Amministrazione Titolare", "Codice Identificativo Procedura di Attivazione",
        "Titolo Procedura", "Tipologia Procedura di Attivazione", "CUP",
        "Codice Locale Progetto", "Stato CUP", "Stato Avanzamento Progetto",
        "CUP Codice Natura", "CUP Descrizione Natura", "CUP Codice Tipologia",
        "CUP Descrizione Tipologia", "CUP Codice Settore", "CUP Descrizione Settore",
        "CUP Codice Sottosettore", "CUP Descrizione Sottosettore",
        "CUP Codice Categoria", "CUP Descrizione Categoria", "Titolo Progetto",
        "Sintesi Progetto", "Descrizione Tipo Aiuto", "Finanziamento - Stato",
        "Finanziamento Stato - Bilancio", "Finanziamento Stato - FOI",
        "Finanziamento Prosecuzione Opere Pubbliche - FPOP",
        "Finanziamento UE (Diverso da PNRR)", "Finanziamento Regione",
        "Finanziamento Provincia", "Finanziamento Comune", "Finanziamento Altro Pubblico",
        "Finanziamento Privato", "Finanziamento da Reperire", "Finanziamento PNRR",
        "Finanziamento PNC", "Altri Fondi", "Finanziamento Totale",
        "Finanziamento Totale Pubblico", "Finanziamento Totale Pubblico Netto",
        "Soggetto Attuatore", "Codice Fiscale Soggetto Attuatore",
        "Flag Progetti in Essere", "Data Inizio Progetto Prevista",
        "Data Inizio Progetto Effettiva", "Data Fine Progetto Prevista",
        "Data Fine Progetto Effettiva", "Data di Estrazione", "Data Ultima Validazione",
        "Esito Ultima Validazione", "Codice Fase Iter di Progetto",
        "Descrizione Fase Iter di Progetto", "Stato Fase Iter di Progetto",
    ),
    "locations": (
        "Codice Univoco Submisura", "Descrizione Submisura", "CUP",
        "Codice Locale Progetto", "Regione", "Descrizione Regione", "Provincia",
        "Descrizione Provincia", "Comune", "Descrizione Comune", "Indirizzo", "CAP",
        "Percentuale di Localizzazione", "Data di Estrazione",
    ),
    "tenders": (
        "Codice Univoco Submisura", "Descrizione Submisura", "Descrizione Procedura di Aggiudicazione",
        "CUP", "Codice Locale Progetto", "CIG", "CIG Accordo Quadro",
        "Codice Procedura Utente", "Modalità di Realizzazione", "Codice Interno PDA",
        "Oggetto Principale del Contratto", "Oggetto Gara", "Data Pubblicazione del CIG",
        "Codice Motivo Assenza CIG", "Descrizione Motivo Assenza CIG",
        "Importo Complessivo Gara", "Importo Aggiudicazione", "Data Aggiudicazione Definitiva",
        "Data di Estrazione",
    ),
    "awardees": (
        "Codice Univoco Submisura", "Descrizione Submisura", "CUP", "Codice Locale Progetto",
        "CIG", "Codice interno PDA", "Codice Fiscale/P.IVA", "Denominazione Aggiudicatario",
        "Ruolo Soggetto", "Descrizione Ruolo Soggetto", "Forma Giuridica Aggiudicatario",
        "Descrizione Forma Giuridica Aggiudicatario", "Codice ATECO Aggiudicatario",
        "Codice Procedura Utente", "Data di Estrazione",
    ),
}

CSV_CONTRACT["headers"] = {key: list(value) for key, value in OFFICIAL_CSV_HEADERS.items()}


class StructuralError(RuntimeError):
    """The source or generated artifact no longer satisfies its contract."""


def compact_text(value: str | None) -> str | None:
    if value is None:
        return None
    result = " ".join(value.replace("\u00a0", " ").split())
    if result and set(result) == {"#"}:
        return None
    return result or None


def required_text(value: str | None, field: str) -> str:
    result = compact_text(value)
    if result is None:
        raise StructuralError(f"{field}: valore obbligatorio assente")
    return result


def normalized_code(value: str | None) -> str | None:
    text = compact_text(value)
    return text.upper() if text else None


def optional_code(value: str | None, pattern: re.Pattern[str], field: str) -> str | None:
    code = normalized_code(value)
    if code is not None and not pattern.fullmatch(code):
        raise StructuralError(f"{field}: codice non valido: {code}")
    return code


def date_value(value: str | None, field: str) -> str | None:
    text = compact_text(value)
    if text is None:
        return None
    if text in {"00/01/1900", "01/01/1900"}:
        return None
    for pattern in ("%d/%m/%Y", "%Y-%m-%d"):
        try:
            return datetime.strptime(text, pattern).date().isoformat()
        except ValueError:
            continue
    raise StructuralError(f"{field}: data non valida: {text!r}")


def utc_timestamp(value: str | None, field: str) -> str:
    text = required_text(value, field)
    if not re.fullmatch(r"\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}Z", text):
        raise StructuralError(f"{field}: timestamp UTC non valido: {text!r}")
    try:
        parsed = datetime.fromisoformat(text.replace("Z", "+00:00"))
    except ValueError as error:
        raise StructuralError(f"{field}: timestamp UTC non valido: {text!r}") from error
    if parsed.tzinfo != timezone.utc:
        raise StructuralError(f"{field}: timestamp UTC non valido: {text!r}")
    return text


def decimal_value(value: str, field: str) -> Decimal:
    normalized = value.replace("€", "").replace(" ", "")
    if not re.fullmatch(r"\d+(?:[.,]\d+)*", normalized):
        raise StructuralError(f"{field}: numero non valido: {value!r}")
    if "," in normalized:
        if normalized.count(",") != 1:
            raise StructuralError(f"{field}: numero non valido: {value!r}")
        whole, fraction = normalized.split(",")
        groups = whole.split(".")
        if len(groups) > 1 and (not 1 <= len(groups[0]) <= 3 or any(len(group) != 3 for group in groups[1:])):
            raise StructuralError(f"{field}: numero non valido: {value!r}")
        normalized = f"{''.join(groups)}.{fraction}"
    elif "." in normalized:
        groups = normalized.split(".")
        if len(groups) == 2 and len(groups[1]) != 3:
            normalized = f"{groups[0]}.{groups[1]}"
        elif all(len(group) == 3 for group in groups[1:]) and 1 <= len(groups[0]) <= 3:
            normalized = "".join(groups)
        else:
            raise StructuralError(f"{field}: numero non valido: {value!r}")
    try:
        return Decimal(normalized)
    except InvalidOperation as error:
        raise StructuralError(f"{field}: numero non valido: {value!r}") from error


def money_cents(value: str | None, field: str) -> int | None:
    text = compact_text(value)
    if text is None:
        return None
    amount = decimal_value(text, field)
    if amount < 0:
        raise StructuralError(f"{field}: importo negativo inatteso")
    cents = int((amount * 100).quantize(Decimal("1"), rounding=ROUND_HALF_UP))
    if cents > MAX_SAFE_INTEGER:
        raise StructuralError(f"{field}: supera il limite sicuro JavaScript")
    return cents


def share_basis_points(value: str | None, field: str) -> int | None:
    text = compact_text(value)
    if text is None:
        return None
    normalized = text.replace("%", "")
    result = int((decimal_value(normalized, field) * 100).quantize(Decimal("1"), rounding=ROUND_HALF_UP))
    if result < 0 or result > 10_000:
        raise StructuralError(f"{field}: percentuale fuori intervallo")
    return result


def sha256_file(path: Path) -> str:
    digest = hashlib.sha256()
    with path.open("rb") as stream:
        for block in iter(lambda: stream.read(1024 * 1024), b""):
            digest.update(block)
    return digest.hexdigest()


def canonical_sha256(value: object) -> str:
    payload = json.dumps(value, ensure_ascii=False, sort_keys=True, separators=(",", ":"))
    return hashlib.sha256(payload.encode("utf-8")).hexdigest()


def verify_asset(path: Path, asset: dict, label: str) -> None:
    if not path.is_file():
        raise StructuralError(f"{label}: file sorgente assente: {path}")
    observed_bytes = path.stat().st_size
    observed_hash = sha256_file(path)
    if observed_bytes != asset["bytes"] or observed_hash != asset["sha256"]:
        raise StructuralError(
            f"{label}: source lock non corrisponde "
            f"(bytes={observed_bytes}, sha256={observed_hash})"
        )


def validate_source_spec(spec: dict) -> None:
    if spec.get("schemaVersion") != 1 or spec.get("datasetId") != "pnrr_asili":
        raise StructuralError("source spec: schema o dataset inatteso")
    submeasure = spec.get("submeasure")
    if not isinstance(submeasure, dict) or submeasure.get("code") != "M4C1I1.01.00":
        raise StructuralError("source spec: codice submisura inatteso")
    source = spec.get("source")
    if not isinstance(source, dict):
        raise StructuralError("source spec: metadati fonte assenti")
    for field in ("owner", "landingUrl", "license", "licenseUrl", "attribution"):
        required_text(source.get(field), f"source.{field}")
    for field in ("landingUrl",):
        try:
            parsed = urlparse(source[field])
        except (TypeError, ValueError) as error:
            raise StructuralError(f"source.{field}: URL non valido") from error
        if parsed.scheme != "https" or parsed.hostname != OFFICIAL_HOST:
            raise StructuralError(f"source.{field}: URL ufficiale inatteso")
    if source["licenseUrl"] != "https://creativecommons.org/licenses/by/4.0/":
        raise StructuralError("source.licenseUrl: URL licenza inatteso")
    if source["license"] != "CC BY 4.0":
        raise StructuralError("source.license: licenza inattesa")
    if spec.get("csv") != CSV_CONTRACT:
        raise StructuralError("source spec: contratto CSV inatteso")
    assets = source.get("assets")
    if not isinstance(assets, dict) or set(assets) != ASSET_KEYS:
        raise StructuralError("source spec: asset inattesi o mancanti")
    for label, asset in assets.items():
        if not isinstance(asset, dict):
            raise StructuralError(f"source.assets.{label}: metadati assenti")
        for field in ("fileName", "url", "sha256"):
            required_text(asset.get(field), f"source.assets.{label}.{field}")
        if asset["fileName"] != EXPECTED_ASSET_FILE_NAMES[label]:
            raise StructuralError(f"source.assets.{label}.fileName inatteso")
        if not isinstance(asset.get("bytes"), int) or asset["bytes"] <= 0:
            raise StructuralError(f"source.assets.{label}.bytes: dimensione non valida")
        try:
            parsed = urlparse(asset["url"])
        except (TypeError, ValueError) as error:
            raise StructuralError(f"source.assets.{label}.url: URL non valido") from error
        if parsed.scheme != "https" or parsed.hostname != OFFICIAL_HOST:
            raise StructuralError(f"source.assets.{label}.url: URL ufficiale inatteso")
        if not SHA256_RE.fullmatch(asset["sha256"]):
            raise StructuralError(f"source.assets.{label}.sha256: hash non valido")
    expected = spec.get("expected")
    if not isinstance(expected, dict) or set(expected) != EXPECTED_COVERAGE_KEYS:
        raise StructuralError("source spec: copertura attesa assente")
    for key, value in expected.items():
        if key != "referenceDate" and (not isinstance(value, int) or value < 0):
            raise StructuralError(f"expected.{key}: intero non negativo atteso")
    if not isinstance(spec.get("artifactBudgetBytes"), int) or spec["artifactBudgetBytes"] <= 0:
        raise StructuralError("source spec: budget artefatto inatteso")
    date_value(expected.get("referenceDate"), "expected.referenceDate")
    utc_timestamp(spec.get("observedAt"), "observedAt")


def selected_rows(path: Path, submeasure: str, expected_headers: tuple[str, ...], label: str):
    with path.open("r", encoding="utf-8-sig", newline="") as stream:
        reader = csv.DictReader(stream, delimiter=";")
        raw_headers = reader.fieldnames or []
        if len(raw_headers) != len(set(raw_headers)):
            raise StructuralError(f"{label}: intestazioni duplicate")
        headers = set(raw_headers)
        if raw_headers != list(expected_headers):
            raise StructuralError(f"{label}: ordine o nomi delle intestazioni inattesi")
        required_headers = set(expected_headers)
        missing = sorted(required_headers - headers)
        if missing:
            raise StructuralError(f"{label}: colonne mancanti: {', '.join(missing)}")
        unexpected = sorted(headers - required_headers)
        if unexpected:
            raise StructuralError(f"{label}: colonne inattese: {', '.join(unexpected)}")
        for row_number, row in enumerate(reader, start=2):
            if None in row:
                raise StructuralError(f"{label}:{row_number}: numero di colonne inatteso")
            if row.get("Codice Univoco Submisura") == submeasure:
                yield row_number, row


# Backwards-compatible names used by the test fixtures and the ETL call sites.
# They intentionally contain every official column, including fields not
# projected into the compact artifact.
PROJECT_HEADERS = frozenset(OFFICIAL_CSV_HEADERS["projects"])
LOCATION_HEADERS = frozenset(OFFICIAL_CSV_HEADERS["locations"])
TENDER_HEADERS = frozenset(OFFICIAL_CSV_HEADERS["tenders"])
AWARDEE_HEADERS = frozenset(OFFICIAL_CSV_HEADERS["awardees"])


def project_record(row: dict, row_number: int) -> dict:
    cup = required_text(row.get("CUP"), f"projects:{row_number}.CUP").upper()
    if not CUP_RE.fullmatch(cup):
        raise StructuralError(f"projects:{row_number}.CUP non valido: {cup}")
    money = lambda header: money_cents(row.get(header), f"projects:{row_number}.{header}")
    return {
        "cup": cup,
        "localProjectCode": compact_text(row.get("Codice Locale Progetto")),
        "title": required_text(row.get("Titolo Progetto"), f"projects:{row_number}.Titolo Progetto"),
        "summary": compact_text(row.get("Sintesi Progetto")),
        "classification": {
            "nature": compact_text(row.get("CUP Descrizione Natura")),
            "type": compact_text(row.get("CUP Descrizione Tipologia")),
            "sector": compact_text(row.get("CUP Descrizione Settore")),
            "subsector": compact_text(row.get("CUP Descrizione Sottosettore")),
            "category": compact_text(row.get("CUP Descrizione Categoria")),
        },
        "status": {
            "cup": compact_text(row.get("Stato CUP")),
            "progress": compact_text(row.get("Stato Avanzamento Progetto")),
            "phaseCode": compact_text(row.get("Codice Fase Iter di Progetto")),
            "phase": compact_text(row.get("Descrizione Fase Iter di Progetto")),
            "phaseStatus": compact_text(row.get("Stato Fase Iter di Progetto")),
            "validationOutcome": compact_text(row.get("Esito Ultima Validazione")),
            "validatedAt": date_value(row.get("Data Ultima Validazione"), f"projects:{row_number}.Data Ultima Validazione"),
        },
        "funding": {
            "pnrrCents": money("Finanziamento PNRR"),
            "totalCents": money("Finanziamento Totale"),
            "netPublicCents": money("Finanziamento Totale Pubblico Netto"),
            "stateCents": money("Finanziamento - Stato"),
            "municipalityCents": money("Finanziamento Comune"),
            "regionCents": money("Finanziamento Regione"),
            "privateCents": money("Finanziamento Privato"),
            "toBeFoundCents": money("Finanziamento da Reperire"),
        },
        "implementer": {
            "name": compact_text(row.get("Soggetto Attuatore")),
            "taxCode": normalized_code(row.get("Codice Fiscale Soggetto Attuatore")),
        },
        "timeline": {
            "plannedStart": date_value(row.get("Data Inizio Progetto Prevista"), f"projects:{row_number}.inizio previsto"),
            "actualStart": date_value(row.get("Data Inizio Progetto Effettiva"), f"projects:{row_number}.inizio effettivo"),
            "plannedEnd": date_value(row.get("Data Fine Progetto Prevista"), f"projects:{row_number}.fine prevista"),
            "actualEnd": date_value(row.get("Data Fine Progetto Effettiva"), f"projects:{row_number}.fine effettiva"),
        },
        "existingProject": compact_text(row.get("Flag Progetti in Essere")),
        "locations": [],
        "tenders": [],
        "awardees": [],
    }


def location_record(row: dict, row_number: int) -> dict:
    return {
        "regionCode": compact_text(row.get("Regione")),
        "region": required_text(row.get("Descrizione Regione"), f"locations:{row_number}.regione"),
        "provinceCode": compact_text(row.get("Provincia")),
        "province": compact_text(row.get("Descrizione Provincia")),
        "municipalityCode": compact_text(row.get("Comune")),
        "municipality": compact_text(row.get("Descrizione Comune")),
        "address": compact_text(row.get("Indirizzo")),
        "postalCode": compact_text(row.get("CAP")),
        "shareBasisPoints": share_basis_points(row.get("Percentuale di Localizzazione"), f"locations:{row_number}.percentuale"),
    }


def tender_record(row: dict, row_number: int) -> dict:
    cig = optional_code(row.get("CIG"), CIG_RE, f"tenders:{row_number}.CIG")
    framework_cig = optional_code(row.get("CIG Accordo Quadro"), CIG_RE, f"tenders:{row_number}.CIG Accordo Quadro")
    return {
        "cig": cig,
        "frameworkCig": framework_cig,
        "userProcedureCode": compact_text(row.get("Codice Procedura Utente")),
        "internalProcedureCode": compact_text(row.get("Codice Interno PDA")),
        "procedure": compact_text(row.get("Descrizione Procedura di Aggiudicazione")),
        "deliveryMode": compact_text(row.get("Modalità di Realizzazione")),
        "contractType": compact_text(row.get("Oggetto Principale del Contratto")),
        "subject": compact_text(row.get("Oggetto Gara")),
        "publishedAt": date_value(row.get("Data Pubblicazione del CIG"), f"tenders:{row_number}.pubblicazione"),
        "absenceReason": compact_text(row.get("Descrizione Motivo Assenza CIG")),
        "amountCents": money_cents(row.get("Importo Complessivo Gara"), f"tenders:{row_number}.importo"),
        "awardAmountCents": money_cents(row.get("Importo Aggiudicazione"), f"tenders:{row_number}.aggiudicazione"),
        "awardedAt": date_value(row.get("Data Aggiudicazione Definitiva"), f"tenders:{row_number}.data aggiudicazione"),
    }


def awardee_record(row: dict, row_number: int) -> dict:
    cig = optional_code(row.get("CIG"), CIG_RE, f"awardees:{row_number}.CIG")
    return {
        "cig": cig,
        "userProcedureCode": compact_text(row.get("Codice Procedura Utente")),
        "internalProcedureCode": compact_text(row.get("Codice interno PDA")),
        "taxId": normalized_code(row.get("Codice Fiscale/P.IVA")),
        "name": compact_text(row.get("Denominazione Aggiudicatario")),
        "role": compact_text(row.get("Descrizione Ruolo Soggetto")),
        "legalForm": compact_text(row.get("Descrizione Forma Giuridica Aggiudicatario")),
        "atecoCode": compact_text(row.get("Codice ATECO Aggiudicatario")),
    }


def join_key(record: dict) -> tuple[str | None, str | None, str | None]:
    return (record.get("cig"), record.get("internalProcedureCode"), record.get("userProcedureCode"))


def has_join_identity(record: dict) -> bool:
    return any(value is not None for value in join_key(record))


def extraction_date(row: dict, label: str) -> str:
    value = date_value(row.get("Data di Estrazione"), f"{label}.Data di Estrazione")
    if value is None:
        raise StructuralError(f"{label}.Data di Estrazione assente")
    return value


def build_snapshot(spec: dict, paths: dict[str, Path], observed_at: str) -> tuple[dict, dict]:
    validate_source_spec(spec)
    utc_timestamp(observed_at, "observed_at")
    if set(paths) != ASSET_KEYS:
        raise StructuralError("input: asset sorgente inattesi o mancanti")
    submeasure = spec["submeasure"]["code"]
    for label, path in paths.items():
        verify_asset(path, spec["source"]["assets"][label], label)

    projects: dict[str, dict] = {}
    extraction_dates: set[str] = set()
    counts = {"projectRows": 0, "locationRows": 0, "tenderRows": 0, "awardeeRows": 0}

    for row_number, row in selected_rows(paths["projects"], submeasure, OFFICIAL_CSV_HEADERS["projects"], "projects"):
        counts["projectRows"] += 1
        extraction_dates.add(extraction_date(row, f"projects:{row_number}"))
        project = project_record(row, row_number)
        if project["cup"] in projects:
            raise StructuralError(f"projects: CUP duplicato {project['cup']}")
        projects[project["cup"]] = project

    for row_number, row in selected_rows(paths["locations"], submeasure, OFFICIAL_CSV_HEADERS["locations"], "locations"):
        counts["locationRows"] += 1
        extraction_dates.add(extraction_date(row, f"locations:{row_number}"))
        cup = required_text(row.get("CUP"), f"locations:{row_number}.CUP").upper()
        if cup not in projects:
            raise StructuralError(f"locations:{row_number}: CUP senza progetto {cup}")
        projects[cup]["locations"].append(location_record(row, row_number))

    for row_number, row in selected_rows(paths["tenders"], submeasure, OFFICIAL_CSV_HEADERS["tenders"], "tenders"):
        counts["tenderRows"] += 1
        extraction_dates.add(extraction_date(row, f"tenders:{row_number}"))
        cup = required_text(row.get("CUP"), f"tenders:{row_number}.CUP").upper()
        if cup not in projects:
            raise StructuralError(f"tenders:{row_number}: CUP senza progetto {cup}")
        projects[cup]["tenders"].append(tender_record(row, row_number))

    unmatched_awardees = 0
    for row_number, row in selected_rows(paths["awardees"], submeasure, OFFICIAL_CSV_HEADERS["awardees"], "awardees"):
        counts["awardeeRows"] += 1
        extraction_dates.add(extraction_date(row, f"awardees:{row_number}"))
        cup = required_text(row.get("CUP"), f"awardees:{row_number}.CUP").upper()
        if cup not in projects:
            raise StructuralError(f"awardees:{row_number}: CUP senza progetto {cup}")
        awardee = awardee_record(row, row_number)
        projects[cup]["awardees"].append(awardee)
        tender_keys = {join_key(item) for item in projects[cup]["tenders"]}
        if not has_join_identity(awardee) or join_key(awardee) not in tender_keys:
            unmatched_awardees += 1

    expected = spec["expected"]
    if extraction_dates != {expected["referenceDate"]}:
        raise StructuralError(f"date di estrazione inattese: {sorted(extraction_dates)}")

    project_list = sorted(projects.values(), key=lambda item: item["cup"])
    for project in project_list:
        project["locations"].sort(key=lambda item: (item["region"], item["province"] or "", item["municipality"] or "", item["address"] or ""))
        project["tenders"].sort(key=lambda item: (item["cig"] or "", item["internalProcedureCode"] or "", item["subject"] or ""))
        project["awardees"].sort(key=lambda item: (item["cig"] or "", item["internalProcedureCode"] or "", item["name"] or "", item["taxId"] or ""))

    coverage = {
        **counts,
        "uniqueProjects": len(project_list),
        "projectsWithLocations": sum(bool(item["locations"]) for item in project_list),
        "projectsWithTenders": sum(bool(item["tenders"]) for item in project_list),
        "projectsWithAwardees": sum(bool(item["awardees"]) for item in project_list),
        "municipalities": len({(location["regionCode"], location["provinceCode"], location["municipalityCode"]) for item in project_list for location in item["locations"]}),
        "unmatchedAwardeeRows": unmatched_awardees,
    }
    for key, expected_value in expected.items():
        if key == "referenceDate":
            continue
        if coverage.get(key) != expected_value:
            raise StructuralError(f"coverage.{key}: atteso {expected_value}, trovato {coverage.get(key)}")

    totals = {
        "pnrrFundingCents": sum(item["funding"]["pnrrCents"] or 0 for item in project_list),
        "totalFundingCents": sum(item["funding"]["totalCents"] or 0 for item in project_list),
        "tenderAmountCents": sum(tender["amountCents"] or 0 for item in project_list for tender in item["tenders"]),
        "awardAmountCents": sum(tender["awardAmountCents"] or 0 for item in project_list for tender in item["tenders"]),
    }
    data = {
        "schemaVersion": 1,
        "dataset": "pnrr_asili",
        "submeasure": spec["submeasure"],
        "referenceDate": expected["referenceDate"],
        "projects": project_list,
    }
    meta = {
        "schemaVersion": 1,
        "dataset": "pnrr_asili",
        "generatedAt": observed_at,
        "observedAt": observed_at,
        "referenceDate": expected["referenceDate"],
        "submeasure": spec["submeasure"],
        "coverage": coverage,
        "totals": totals,
        "source": spec["source"],
        "methodology": {
            "join": "Progetti e localizzazioni per CUP; gare e aggiudicatari restano collegabili per CUP + CIG + Codice interno PDA + Codice procedura utente.",
            "fundingWarning": "Il finanziamento PNRR non è un pagamento osservato e l'importo di gara non è necessariamente spesa erogata.",
            "territorialWarning": "Un CUP può avere più localizzazioni; le righe territoriali non vanno sommate come progetti distinti.",
            "validationWarning": "L'esito di validazione proviene dalla fonte e va mostrato senza trasformarlo in un giudizio sul progetto.",
        },
        "integrity": {
            "algorithm": "sha256",
            "sourceLockSha256": canonical_sha256({key: value for key, value in spec.items() if key != "integrity"}),
            "dataArtifact": {},
        },
    }
    return data, meta


def encoded_json(value: object, pretty: bool) -> bytes:
    options = {"ensure_ascii": False, "sort_keys": True}
    if pretty:
        options["indent"] = 2
    else:
        options["separators"] = (",", ":")
    return (json.dumps(value, **options) + "\n").encode("utf-8")


def validate_artifacts(spec: dict, data_path: Path, meta_path: Path) -> tuple[dict, dict]:
    validate_source_spec(spec)
    try:
        data_bytes = data_path.read_bytes()
        meta = json.loads(meta_path.read_text(encoding="utf-8"))
        data = json.loads(data_bytes)
    except (OSError, json.JSONDecodeError) as error:
        raise StructuralError(f"artefatti non leggibili: {error}") from error
    if not isinstance(data, dict) or data.get("schemaVersion") != 1 or data.get("dataset") != "pnrr_asili":
        raise StructuralError("data artifact: schema o dataset inatteso")
    if not isinstance(meta, dict) or meta.get("schemaVersion") != 1 or meta.get("dataset") != "pnrr_asili":
        raise StructuralError("meta artifact: schema o dataset inatteso")
    utc_timestamp(meta.get("generatedAt"), "meta.generatedAt")
    utc_timestamp(meta.get("observedAt"), "meta.observedAt")
    if meta["observedAt"] != meta["generatedAt"]:
        raise StructuralError("meta artifact: observedAt e generatedAt non riconciliati")
    if meta.get("submeasure") != spec.get("submeasure") or data.get("submeasure") != spec.get("submeasure"):
        raise StructuralError("artifact: submisura non riconciliata con la source spec")
    if meta.get("source") != spec.get("source"):
        raise StructuralError("meta artifact: fonte non riconciliata con la source spec")
    if meta.get("referenceDate") != data.get("referenceDate"):
        raise StructuralError("meta artifact: data e metadati hanno date di riferimento diverse")
    if not isinstance(data.get("projects"), list):
        raise StructuralError("data artifact: projects deve essere un elenco")
    if len(data["projects"]) != spec["expected"]["uniqueProjects"]:
        raise StructuralError("data artifact: conteggio progetti inatteso")
    actual = {"bytes": len(data_bytes), "sha256": hashlib.sha256(data_bytes).hexdigest()}
    if meta.get("integrity", {}).get("dataArtifact") != actual:
        raise StructuralError("meta artifact: hash o dimensione del data artifact non corrisponde")
    expected_lock = canonical_sha256({key: value for key, value in spec.items() if key != "integrity"})
    if meta["integrity"].get("sourceLockSha256") != expected_lock:
        raise StructuralError("meta artifact: source lock non corrisponde")
    if actual["bytes"] > spec["artifactBudgetBytes"]:
        raise StructuralError("data artifact supera il budget dichiarato")
    if meta.get("coverage", {}).get("uniqueProjects") != len(data["projects"]):
        raise StructuralError("meta artifact: coverage non riconciliata")
    for key, expected_value in spec["expected"].items():
        if key != "referenceDate" and meta.get("coverage", {}).get(key) != expected_value:
            raise StructuralError(f"meta artifact: coverage.{key} non riconciliata")
    return data, meta


def stage_file(path: Path, payload: bytes) -> Path:
    path.parent.mkdir(parents=True, exist_ok=True)
    descriptor, temporary_name = tempfile.mkstemp(prefix=f".{path.name}.", dir=path.parent)
    temporary = Path(temporary_name)
    try:
        with os.fdopen(descriptor, "wb") as handle:
            handle.write(payload)
            handle.flush()
            os.fsync(handle.fileno())
    except Exception:
        temporary.unlink(missing_ok=True)
        raise
    return temporary


def restore_file(path: Path, previous: bytes | None) -> None:
    if previous is None:
        path.unlink(missing_ok=True)
        return
    temporary = stage_file(path, previous)
    os.replace(temporary, path)


def write_artifacts_atomically(data_path: Path, meta_path: Path, data_payload: bytes, meta_payload: bytes) -> None:
    previous_data = data_path.read_bytes() if data_path.exists() else None
    previous_meta = meta_path.read_bytes() if meta_path.exists() else None
    staged_data: Path | None = None
    staged_meta: Path | None = None
    data_replaced = False
    meta_replaced = False
    try:
        staged_data = stage_file(data_path, data_payload)
        staged_meta = stage_file(meta_path, meta_payload)
        os.replace(staged_data, data_path)
        data_replaced = True
        os.replace(staged_meta, meta_path)
        meta_replaced = True
    except Exception:
        if data_replaced:
            restore_file(data_path, previous_data)
        if meta_replaced:
            restore_file(meta_path, previous_meta)
        raise
    finally:
        if staged_data is not None:
            staged_data.unlink(missing_ok=True)
        if staged_meta is not None:
            staged_meta.unlink(missing_ok=True)


def main() -> int:
    parser = argparse.ArgumentParser()
    parser.add_argument("--spec", type=Path, default=DEFAULT_SPEC)
    parser.add_argument("--projects-input", type=Path)
    parser.add_argument("--locations-input", type=Path)
    parser.add_argument("--tenders-input", type=Path)
    parser.add_argument("--awardees-input", type=Path)
    parser.add_argument("--data-output", type=Path, default=DEFAULT_DATA)
    parser.add_argument("--meta-output", type=Path, default=DEFAULT_META)
    parser.add_argument("--observed-at")
    parser.add_argument("--check", action="store_true")
    arguments = parser.parse_args()
    spec = json.loads(arguments.spec.read_text(encoding="utf-8"))
    validate_source_spec(spec)

    if arguments.check:
        data, meta = validate_artifacts(spec, arguments.data_output, arguments.meta_output)
        print(json.dumps({"projects": len(data["projects"]), "bytes": meta["integrity"]["dataArtifact"]["bytes"], "sha256": meta["integrity"]["dataArtifact"]["sha256"]}, indent=2))
        return 0

    input_paths = {
        "projects": arguments.projects_input,
        "locations": arguments.locations_input,
        "tenders": arguments.tenders_input,
        "awardees": arguments.awardees_input,
    }
    missing = [key for key, value in input_paths.items() if value is None]
    if missing:
        raise StructuralError(f"input obbligatori assenti: {', '.join(missing)}")
    observed_at = arguments.observed_at or spec["observedAt"]
    utc_timestamp(observed_at, "observed-at")
    data, meta = build_snapshot(spec, input_paths, observed_at)
    data_payload = encoded_json(data, pretty=False)
    meta["integrity"]["dataArtifact"] = {
        "bytes": len(data_payload),
        "sha256": hashlib.sha256(data_payload).hexdigest(),
    }
    if len(data_payload) > spec["artifactBudgetBytes"]:
        raise StructuralError(f"data artifact di {len(data_payload)} byte oltre il budget")
    write_artifacts_atomically(
        arguments.data_output,
        arguments.meta_output,
        data_payload,
        encoded_json(meta, pretty=True),
    )
    validate_artifacts(spec, arguments.data_output, arguments.meta_output)
    print(json.dumps({"coverage": meta["coverage"], "totals": meta["totals"], "integrity": meta["integrity"]}, ensure_ascii=False, indent=2))
    return 0


if __name__ == "__main__":
    try:
        raise SystemExit(main())
    except (StructuralError, OSError, json.JSONDecodeError, KeyError) as error:
        print(f"errore strutturale PNRR asili: {error}", file=sys.stderr)
        raise SystemExit(2) from error
