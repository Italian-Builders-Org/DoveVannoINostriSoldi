#!/usr/bin/env python3
"""Build and validate the national Consulenti Pubblici statistics snapshot."""

from __future__ import annotations

import argparse
import json
import socket
import sys
import time
import urllib.error
import urllib.request
from datetime import datetime, timezone
from decimal import Decimal, InvalidOperation, ROUND_HALF_UP
from pathlib import Path
from urllib.parse import urlparse

ENDPOINT = "https://adp-api.perlapa.gov.it/api/public/incarichi/StatisticheIncarichi"
LANDING_URL = "https://consulentipubblici.dfp.gov.it/progetto"
LICENSE_URL = "https://www.perlapa.gov.it/cd-note-legali.html"
OUTPUT = Path("src/data/generated/consulenti-overview.json")
OFFICIAL_HOSTS = {"adp-api.perlapa.gov.it"}
USER_AGENT = (
    "DoveVannoINostriSoldi-ETL/1.0 "
    "(+https://github.com/Italian-Builders-Org/DoveVannoINostriSoldi)"
)
TRANSIENT_HTTP = {408, 425, 429, 500, 502, 503, 504}
MAX_RETRIES = 2
MAX_SAFE_INTEGER = 9_007_199_254_740_991


class StructuralError(RuntimeError):
    """The upstream replied, but its payload no longer matches the contract."""


def utc_now() -> str:
    return datetime.now(timezone.utc).isoformat(timespec="seconds").replace("+00:00", "Z")


def required_dict(value: object, field: str) -> dict:
    if not isinstance(value, dict):
        raise StructuralError(f"{field}: oggetto atteso")
    return value


def required_list(value: object, field: str) -> list:
    if not isinstance(value, list) or not value:
        raise StructuralError(f"{field}: lista non vuota attesa")
    return value


def safe_integer(value: object, field: str) -> int:
    if isinstance(value, bool) or not isinstance(value, int):
        raise StructuralError(f"{field}: intero atteso")
    if value < 0 or value > MAX_SAFE_INTEGER:
        raise StructuralError(f"{field}: intero fuori intervallo")
    return value


def money_cents(value: object, field: str) -> int:
    if isinstance(value, bool) or not isinstance(value, (int, Decimal)):
        raise StructuralError(f"{field}: importo numerico atteso")
    try:
        decimal = Decimal(value)
    except (InvalidOperation, ValueError) as error:
        raise StructuralError(f"{field}: importo non valido") from error
    if not decimal.is_finite() or decimal < 0:
        raise StructuralError(f"{field}: importo non negativo atteso")
    cents = int((decimal * 100).quantize(Decimal("1"), rounding=ROUND_HALF_UP))
    if cents > MAX_SAFE_INTEGER:
        raise StructuralError(f"{field}: importo oltre il limite sicuro JavaScript")
    return cents


def common_record(raw: object, field: str) -> dict[str, int]:
    record = required_dict(raw, field)
    assignments = safe_integer(record.get("numeroIncarichi"), f"{field}.numeroIncarichi")
    completed = safe_integer(record.get("incarichiConclusi"), f"{field}.incarichiConclusi")
    if completed > assignments:
        raise StructuralError(f"{field}: incarichi conclusi superiori al totale")
    return {
        "year": safe_integer(record.get("annoConferimento"), f"{field}.annoConferimento"),
        "assignments": assignments,
        "paidCents": money_cents(record.get("ammontareErogato"), f"{field}.ammontareErogato"),
        "completedAssignments": completed,
    }


def normalize_external(raw: object, index: int) -> dict[str, int]:
    field = f"consulenti[{index}]"
    record = required_dict(raw, field)
    normalized = common_record(record, field)
    normalized.update(
        {
            "individualRecipients": safe_integer(
                record.get("personaFisicaCount"), f"{field}.personaFisicaCount"
            ),
            "organizationRecipients": safe_integer(
                record.get("personaGiuridicaCount"), f"{field}.personaGiuridicaCount"
            ),
        }
    )
    return normalized


def normalize_employee(raw: object, index: int) -> dict[str, int]:
    field = f"dipendenti[{index}]"
    record = required_dict(raw, field)
    normalized = common_record(record, field)
    managers = safe_integer(record.get("dirigentiCount"), f"{field}.dirigentiCount")
    non_managers = safe_integer(record.get("nonDirigentiCount"), f"{field}.nonDirigentiCount")
    if managers + non_managers != normalized["assignments"]:
        raise StructuralError(
            f"{field}: dirigenti e non dirigenti non riconciliano con il totale incarichi"
        )
    normalized.update(
        {
            "managerAssignments": managers,
            "nonManagerAssignments": non_managers,
            "publicAdministrationGrantorRecords": safe_integer(
                record.get("paConferenteCount"), f"{field}.paConferenteCount"
            ),
        }
    )
    return normalized


def normalize(raw: object, observed_at: str) -> dict:
    root = required_dict(raw, "root")
    external = [
        normalize_external(item, index)
        for index, item in enumerate(required_list(root.get("consulenti"), "consulenti"))
    ]
    employees = [
        normalize_employee(item, index)
        for index, item in enumerate(required_list(root.get("dipendenti"), "dipendenti"))
    ]
    external.sort(key=lambda item: item["year"])
    employees.sort(key=lambda item: item["year"])
    external_years = [item["year"] for item in external]
    employee_years = [item["year"] for item in employees]
    if len(external_years) != len(set(external_years)):
        raise StructuralError("consulenti: anni duplicati")
    if len(employee_years) != len(set(employee_years)):
        raise StructuralError("dipendenti: anni duplicati")
    if external_years != employee_years:
        raise StructuralError("consulenti e dipendenti non coprono gli stessi anni")

    return {
        "schemaVersion": 1,
        "transformVersion": 1,
        "scope": "national-annual-overview",
        "generatedAt": observed_at,
        "latestYear": external_years[-1],
        "externalAppointments": external,
        "employeeAppointments": employees,
        "source": {
            "owner": "Dipartimento della Funzione Pubblica",
            "dataset": "Consulenti Pubblici · statistiche nazionali degli incarichi",
            "landingUrl": LANDING_URL,
            "endpoint": ENDPOINT,
            "licenseUrl": LICENSE_URL,
            "reuseTerms": "Riuso consentito con attribuzione e licenza identica o equivalente",
            "observedAt": observed_at,
            "declaredCadence": "Aggiornamento per singola amministrazione e incarico",
            "platformCheckCadence": "Ogni 6 ore",
        },
        "methodology": {
            "amountMeaning": (
                "Ammontare erogato comunicato dalle amministrazioni alla data di consultazione; "
                "non coincide necessariamente con il compenso lordo previsto."
            ),
            "currentYearWarning": (
                "L'anno più recente è parziale e i valori possono crescere o cambiare con nuove comunicazioni."
            ),
            "responsibilityWarning": (
                "I dati sono comunicati dalle singole amministrazioni sotto la propria responsabilità."
            ),
            "publicAdministrationGrantorMeaning": (
                "Il campo paConferenteCount è conservato come conteggio di record della fonte e non "
                "viene presentato come numero di amministrazioni distinte."
            ),
        },
    }


def semantic_view(snapshot: dict) -> dict:
    copied = json.loads(json.dumps(snapshot))
    copied.pop("generatedAt", None)
    source = copied.get("source")
    if isinstance(source, dict):
        source.pop("observedAt", None)
    return copied


def validate_snapshot(snapshot: object) -> None:
    root = required_dict(snapshot, "snapshot")
    if root.get("schemaVersion") != 1 or root.get("transformVersion") != 1:
        raise StructuralError("snapshot: versione non supportata")
    if root.get("scope") != "national-annual-overview":
        raise StructuralError("snapshot.scope non valido")
    observed_at = root.get("generatedAt")
    if not isinstance(observed_at, str):
        raise StructuralError("snapshot.generatedAt: timestamp atteso")
    datetime.fromisoformat(observed_at.replace("Z", "+00:00"))

    source = required_dict(root.get("source"), "snapshot.source")
    if source.get("endpoint") != ENDPOINT or source.get("landingUrl") != LANDING_URL:
        raise StructuralError("snapshot.source: URL ufficiali inattesi")

    external = required_list(root.get("externalAppointments"), "snapshot.externalAppointments")
    employees = required_list(root.get("employeeAppointments"), "snapshot.employeeAppointments")
    raw_shape = {
        "consulenti": [
            {
                "annoConferimento": required_dict(item, "external").get("year"),
                "numeroIncarichi": required_dict(item, "external").get("assignments"),
                "ammontareErogato": Decimal(
                    safe_integer(required_dict(item, "external").get("paidCents"), "paidCents")
                )
                / 100,
                "incarichiConclusi": required_dict(item, "external").get("completedAssignments"),
                "personaFisicaCount": required_dict(item, "external").get("individualRecipients"),
                "personaGiuridicaCount": required_dict(item, "external").get("organizationRecipients"),
            }
            for item in external
        ],
        "dipendenti": [
            {
                "annoConferimento": required_dict(item, "employee").get("year"),
                "numeroIncarichi": required_dict(item, "employee").get("assignments"),
                "ammontareErogato": Decimal(
                    safe_integer(required_dict(item, "employee").get("paidCents"), "paidCents")
                )
                / 100,
                "incarichiConclusi": required_dict(item, "employee").get("completedAssignments"),
                "dirigentiCount": required_dict(item, "employee").get("managerAssignments"),
                "nonDirigentiCount": required_dict(item, "employee").get("nonManagerAssignments"),
                "paConferenteCount": required_dict(item, "employee").get(
                    "publicAdministrationGrantorRecords"
                ),
            }
            for item in employees
        ],
    }
    rebuilt = normalize(raw_shape, observed_at)
    if root.get("latestYear") != rebuilt["latestYear"]:
        raise StructuralError("snapshot.latestYear non corrisponde alla serie")
    for key in ("externalAppointments", "employeeAppointments"):
        if root.get(key) != rebuilt[key]:
            raise StructuralError(f"snapshot.{key}: contratto non valido")


def official_url(value: str) -> None:
    parsed = urlparse(value)
    if parsed.scheme != "https" or parsed.hostname not in OFFICIAL_HOSTS:
        raise StructuralError(f"URL API non ufficiale: {value}")


def fetch_json(timeout: int) -> tuple[dict, str]:
    request = urllib.request.Request(
        ENDPOINT,
        headers={"User-Agent": USER_AGENT, "Accept": "application/json"},
    )
    for attempt in range(MAX_RETRIES + 1):
        try:
            with urllib.request.urlopen(request, timeout=timeout) as response:
                official_url(response.geturl())
                content_type = response.headers.get("Content-Type", "").split(";", 1)[0].lower()
                if content_type != "application/json":
                    raise StructuralError(f"Content-Type inatteso: {content_type or 'assente'}")
                payload = json.loads(
                    response.read(),
                    parse_float=Decimal,
                    parse_int=int,
                )
            return required_dict(payload, "root"), utc_now()
        except (urllib.error.HTTPError, urllib.error.URLError, TimeoutError, socket.timeout) as error:
            status = error.code if isinstance(error, urllib.error.HTTPError) else None
            if (status not in TRANSIENT_HTTP and status is not None) or attempt >= MAX_RETRIES:
                raise
            delay = 2**attempt
            print(
                f"::warning::Tentativo Consulenti Pubblici {attempt + 1} fallito ({error}); "
                f"nuovo tentativo tra {delay}s",
                file=sys.stderr,
            )
            time.sleep(delay)
    raise AssertionError("ciclo retry terminato senza risultato")


def load_json(path: Path) -> dict:
    return required_dict(
        json.loads(path.read_text(encoding="utf-8"), parse_float=Decimal),
        str(path),
    )


def write_if_changed(snapshot: dict, output: Path) -> bool:
    if output.exists():
        current = load_json(output)
        validate_snapshot(current)
        if semantic_view(current) == semantic_view(snapshot):
            print("Nessuna variazione nei dati Consulenti Pubblici.")
            return False
    output.parent.mkdir(parents=True, exist_ok=True)
    output.write_text(json.dumps(snapshot, ensure_ascii=False, indent=2) + "\n", encoding="utf-8")
    return True


def main() -> int:
    parser = argparse.ArgumentParser()
    parser.add_argument("--check", action="store_true", help="Valida lo snapshot senza rete")
    parser.add_argument("--input", type=Path, help="Payload JSON locale per test o rigenerazione")
    parser.add_argument("--output", type=Path, default=OUTPUT)
    parser.add_argument("--timeout", type=int, default=20)
    args = parser.parse_args()

    if args.check:
        validate_snapshot(load_json(args.output))
        print(f"Snapshot Consulenti Pubblici valido: {args.output}")
        return 0

    if args.input:
        raw = load_json(args.input)
        observed_at = utc_now()
    else:
        raw, observed_at = fetch_json(args.timeout)
    snapshot = normalize(raw, observed_at)
    validate_snapshot(snapshot)
    changed = write_if_changed(snapshot, args.output)
    latest_external = snapshot["externalAppointments"][-1]
    latest_employee = snapshot["employeeAppointments"][-1]
    print(
        json.dumps(
            {
                "changed": changed,
                "latestYear": snapshot["latestYear"],
                "externalAssignments": latest_external["assignments"],
                "employeeAssignments": latest_employee["assignments"],
                "externalPaidCents": latest_external["paidCents"],
                "employeePaidCents": latest_employee["paidCents"],
            },
            ensure_ascii=False,
            indent=2,
        )
    )
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
