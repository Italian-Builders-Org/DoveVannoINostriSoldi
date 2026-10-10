#!/usr/bin/env python3
"""Build and validate the territorial Consulenti Pubblici statistics snapshot.

Scope: ammontare erogato degli incarichi esterni (TipoIncarico=1) ripartito per
``regionePa`` geografica delle PA conferenti. Non limita il perimetro alle sole
Giunte regionali: include tutte le amministrazioni del territorio.
"""

from __future__ import annotations

import argparse
import json
import socket
import sys
import time
import urllib.error
import urllib.parse
import urllib.request
from datetime import datetime, timezone
from decimal import Decimal, InvalidOperation, ROUND_HALF_UP
from pathlib import Path
from typing import Any

NATIONAL_ENDPOINT = "https://adp-api.perlapa.gov.it/api/public/incarichi/StatisticheIncarichi"
REGIONAL_ENDPOINT = (
    "https://adp-api.perlapa.gov.it/api/public/Incarichi/StatisticheIncarichi/Regione"
)
LANDING_URL = "https://consulentipubblici.dfp.gov.it/dati-aggregati"
PROJECT_URL = "https://consulentipubblici.dfp.gov.it/progetto"
LICENSE_URL = "https://www.perlapa.gov.it/cd-note-legali.html"
OUTPUT = Path("src/data/generated/consulenti-regionali.json")
OFFICIAL_HOSTS = {"adp-api.perlapa.gov.it"}
USER_AGENT = (
    "DoveVannoINostriSoldi-ETL/1.0 "
    "(+https://github.com/Italian-Builders-Org/DoveVannoINostriSoldi)"
)
TRANSIENT_HTTP = {408, 425, 429, 500, 502, 503, 504}
MAX_RETRIES = 2
MAX_SAFE_INTEGER = 9_007_199_254_740_991
EXTERNAL_APPOINTMENT_TYPE = "1"
SCOPE = "territorial-external-appointments"


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


def official_url(value: str) -> None:
    parsed = urllib.parse.urlparse(value)
    if parsed.scheme != "https" or parsed.hostname not in OFFICIAL_HOSTS:
        raise StructuralError(f"URL API non ufficiale: {value}")


def fetch_json(url: str, timeout: int) -> Any:
    request = urllib.request.Request(
        url,
        headers={"User-Agent": USER_AGENT, "Accept": "application/json"},
    )
    for attempt in range(MAX_RETRIES + 1):
        try:
            with urllib.request.urlopen(request, timeout=timeout) as response:
                official_url(response.geturl())
                content_type = response.headers.get("Content-Type", "").split(";", 1)[0].lower()
                if content_type != "application/json":
                    raise StructuralError(f"Content-Type inatteso: {content_type or 'assente'}")
                return json.loads(
                    response.read(),
                    parse_float=Decimal,
                    parse_int=int,
                )
        except (urllib.error.HTTPError, urllib.error.URLError, TimeoutError, socket.timeout) as error:
            status = error.code if isinstance(error, urllib.error.HTTPError) else None
            if (status not in TRANSIENT_HTTP and status is not None) or attempt >= MAX_RETRIES:
                raise
            delay = 2**attempt
            print(
                f"::warning::Tentativo Consulenti regionali {attempt + 1} fallito ({error}); "
                f"nuovo tentativo tra {delay}s",
                file=sys.stderr,
            )
            time.sleep(delay)
    raise AssertionError("ciclo retry terminato senza risultato")


def euro_amount(value: object, field: str) -> Decimal:
    if isinstance(value, bool) or not isinstance(value, (int, Decimal)):
        raise StructuralError(f"{field}: importo numerico atteso")
    try:
        decimal = Decimal(value)
    except (InvalidOperation, ValueError) as error:
        raise StructuralError(f"{field}: importo non valido") from error
    if not decimal.is_finite() or decimal < 0:
        raise StructuralError(f"{field}: importo non negativo atteso")
    return decimal


def national_years(payload: object) -> list[dict[str, object]]:
    root = required_dict(payload, "national")
    rows: list[dict[str, object]] = []
    for index, item in enumerate(required_list(root.get("consulenti"), "national.consulenti")):
        field = f"national.consulenti[{index}]"
        record = required_dict(item, field)
        amount = euro_amount(record.get("ammontareErogato"), f"{field}.ammontareErogato")
        rows.append(
            {
                "year": safe_integer(record.get("annoConferimento"), f"{field}.annoConferimento"),
                "assignments": safe_integer(record.get("numeroIncarichi"), f"{field}.numeroIncarichi"),
                "paidEuros": amount,
                "paidCents": money_cents(amount, f"{field}.ammontareErogato"),
            }
        )
    years = [int(row["year"]) for row in rows]
    if len(years) != len(set(years)):
        raise StructuralError("national.consulenti: anni duplicati")
    rows.sort(key=lambda row: int(row["year"]))
    return rows


def normalize_territory_row(raw: object, index: int, year: int) -> dict[str, object]:
    field = f"regioni[{year}][{index}]"
    record = required_dict(raw, field)
    label = record.get("regionePa")
    if not isinstance(label, str) or not label.strip():
        raise StructuralError(f"{field}.regionePa: etichetta non vuota attesa")
    observed_year = safe_integer(record.get("annoConferimento"), f"{field}.annoConferimento")
    if observed_year != year:
        raise StructuralError(f"{field}: anno {observed_year} diverso dalla query {year}")
    assignments = safe_integer(record.get("numeroIncarichi"), f"{field}.numeroIncarichi")
    completed = safe_integer(record.get("incarichiConclusi"), f"{field}.incarichiConclusi")
    if completed > assignments:
        raise StructuralError(f"{field}: incarichi conclusi superiori al totale")
    amount = euro_amount(record.get("ammontareErogato"), f"{field}.ammontareErogato")
    return {
        "territoryLabel": label.strip(),
        "assignments": assignments,
        "paidEuros": amount,
        "paidCents": money_cents(amount, f"{field}.ammontareErogato"),
        "completedAssignments": completed,
        "individualRecipients": safe_integer(
            record.get("personaFisicaCount"), f"{field}.personaFisicaCount"
        ),
        "organizationRecipients": safe_integer(
            record.get("personaGiuridicaCount"), f"{field}.personaGiuridicaCount"
        ),
    }


def normalize_year(
    year: int,
    regional_payload: object,
    national_row: dict[str, object],
) -> dict[str, object]:
    parsed = [
        normalize_territory_row(item, index, year)
        for index, item in enumerate(required_list(regional_payload, f"regioni[{year}]"))
    ]
    labels = [str(row["territoryLabel"]) for row in parsed]
    if len(labels) != len(set(labels)):
        raise StructuralError(f"regioni[{year}]: etichette territorio duplicate")
    assignments = sum(int(row["assignments"]) for row in parsed)
    paid_euros = sum((row["paidEuros"] for row in parsed), Decimal("0"))
    if assignments != national_row["assignments"]:
        raise StructuralError(
            f"regioni[{year}]: somma incarichi {assignments} "
            f"≠ nazionale {national_row['assignments']}"
        )
    if paid_euros != national_row["paidEuros"]:
        raise StructuralError(
            f"regioni[{year}]: somma ammontare euro {paid_euros} "
            f"≠ nazionale {national_row['paidEuros']}"
        )
    rows = [
        {
            "territoryLabel": row["territoryLabel"],
            "assignments": row["assignments"],
            "paidCents": row["paidCents"],
            "completedAssignments": row["completedAssignments"],
            "individualRecipients": row["individualRecipients"],
            "organizationRecipients": row["organizationRecipients"],
        }
        for row in parsed
    ]
    rows.sort(key=lambda row: (-int(row["paidCents"]), str(row["territoryLabel"])))
    territory_paid_cents = sum(int(row["paidCents"]) for row in rows)
    national_paid_cents = int(national_row["paidCents"])
    residual = territory_paid_cents - national_paid_cents
    # Independent half-up to cents can leave a small residue vs the national total.
    if abs(residual) > len(rows):
        raise StructuralError(
            f"regioni[{year}]: residuo di arrotondamento centesimi {residual} fuori soglia"
        )
    return {
        "year": year,
        "territoryCount": len(rows),
        "assignments": assignments,
        "paidCents": national_paid_cents,
        "territoryPaidCentsSum": territory_paid_cents,
        "roundingResidualCents": residual,
        "territories": rows,
    }


def build_snapshot(
    national_payload: object,
    regional_by_year: dict[int, object],
    observed_at: str,
) -> dict[str, object]:
    national = national_years(national_payload)
    years: list[dict[str, object]] = []
    for national_row in national:
        year = national_row["year"]
        if year not in regional_by_year:
            raise StructuralError(f"manca la ripartizione territoriale per {year}")
        years.append(normalize_year(year, regional_by_year[year], national_row))
    return {
        "schemaVersion": 1,
        "transformVersion": 1,
        "scope": SCOPE,
        "generatedAt": observed_at,
        "latestYear": years[-1]["year"],
        "appointmentKind": "external",
        "years": years,
        "soldi": {
            "metric": "ammontareErogato",
            "unit": "EUR-cents",
            "meaning": (
                "Compenso totale erogato comunicato dalle amministrazioni alla data di "
                "consultazione, convertito in centesimi senza arrotondamenti intermedi."
            ),
        },
        "periodo": {
            "grain": "calendar-year",
            "field": "annoConferimento",
            "from": years[0]["year"],
            "to": years[-1]["year"],
            "partialLatestYear": True,
        },
        "provenance": {
            "owner": "Dipartimento della Funzione Pubblica",
            "dataset": (
                "Consulenti Pubblici · statistiche incarichi esterni per territorio (regionePa)"
            ),
            "landingUrl": LANDING_URL,
            "projectUrl": PROJECT_URL,
            "nationalEndpoint": NATIONAL_ENDPOINT,
            "regionalEndpoint": REGIONAL_ENDPOINT,
            "licenseUrl": LICENSE_URL,
            "reuseTerms": "Riuso consentito con attribuzione e licenza identica o equivalente",
            "observedAt": observed_at,
            "declaredCadence": "Aggiornamento per singola amministrazione e incarico",
            "platformCheckCadence": "Ogni 6 ore",
        },
        "methodology": {
            "territoryMeaning": (
                "regionePa è l'etichetta geografica pubblicata dalla fonte per le PA "
                "conferenti del territorio: non coincide con i soli bilanci delle Giunte regionali."
            ),
            "amountMeaning": (
                "Ammontare erogato comunicato dalle amministrazioni alla data di consultazione; "
                "non coincide necessariamente con il compenso lordo previsto."
            ),
            "currentYearWarning": (
                "L'anno più recente è parziale e i valori possono crescere o cambiare con nuove "
                "comunicazioni."
            ),
            "responsibilityWarning": (
                "I dati sono comunicati dalle singole amministrazioni sotto la propria responsabilità."
            ),
            "rgsSeparation": (
                "Questa serie Perla PA non equivale alle categorie contabili RGS di "
                "/spese/consulenze e non va sommata a quel rendiconto."
            ),
            "labelDuplicates": (
                "Le etichette sono quelle pubblicate dalla fonte. Grafie diverse della stessa "
                "Regione restano distinte finché la fonte le pubblica separate."
            ),
        },
    }


def semantic_view(snapshot: dict) -> dict:
    copied = json.loads(json.dumps(snapshot))
    copied.pop("generatedAt", None)
    provenance = copied.get("provenance")
    if isinstance(provenance, dict):
        provenance.pop("observedAt", None)
    return copied


def validate_snapshot(snapshot: object) -> None:
    root = required_dict(snapshot, "snapshot")
    if root.get("schemaVersion") != 1 or root.get("transformVersion") != 1:
        raise StructuralError("snapshot: versione non supportata")
    if root.get("scope") != SCOPE:
        raise StructuralError("snapshot.scope non valido")
    if root.get("appointmentKind") != "external":
        raise StructuralError("snapshot.appointmentKind non valido")
    observed_at = root.get("generatedAt")
    if not isinstance(observed_at, str):
        raise StructuralError("snapshot.generatedAt: timestamp atteso")
    datetime.fromisoformat(observed_at.replace("Z", "+00:00"))

    provenance = required_dict(root.get("provenance"), "snapshot.provenance")
    if provenance.get("nationalEndpoint") != NATIONAL_ENDPOINT:
        raise StructuralError("snapshot.provenance.nationalEndpoint inatteso")
    if provenance.get("regionalEndpoint") != REGIONAL_ENDPOINT:
        raise StructuralError("snapshot.provenance.regionalEndpoint inatteso")
    if provenance.get("landingUrl") != LANDING_URL:
        raise StructuralError("snapshot.provenance.landingUrl inatteso")

    years = required_list(root.get("years"), "snapshot.years")
    seen_years: list[int] = []
    for item in years:
        year_record = required_dict(item, "year")
        year = safe_integer(year_record.get("year"), "year.year")
        if year in seen_years:
            raise StructuralError(f"snapshot.years: anno duplicato {year}")
        seen_years.append(year)
        territories = required_list(year_record.get("territories"), f"year[{year}].territories")
        territory_count = safe_integer(
            year_record.get("territoryCount"), f"year[{year}].territoryCount"
        )
        if territory_count != len(territories):
            raise StructuralError(f"year[{year}].territoryCount non coincide con le righe")
        assignments = safe_integer(year_record.get("assignments"), f"year[{year}].assignments")
        paid_cents = safe_integer(year_record.get("paidCents"), f"year[{year}].paidCents")
        territory_paid_sum = safe_integer(
            year_record.get("territoryPaidCentsSum"), f"year[{year}].territoryPaidCentsSum"
        )
        residual = year_record.get("roundingResidualCents")
        if not isinstance(residual, int) or isinstance(residual, bool):
            raise StructuralError(f"year[{year}].roundingResidualCents: intero atteso")
        if residual != territory_paid_sum - paid_cents:
            raise StructuralError(f"year[{year}]: residuo di arrotondamento incoerente")
        if abs(residual) > territory_count:
            raise StructuralError(f"year[{year}]: residuo di arrotondamento fuori soglia")

        labels: list[str] = []
        assignment_sum = 0
        paid_sum = 0
        normalized_rows: list[dict[str, object]] = []
        for index, row in enumerate(territories):
            field = f"year[{year}].territories[{index}]"
            record = required_dict(row, field)
            label = record.get("territoryLabel")
            if not isinstance(label, str) or not label.strip():
                raise StructuralError(f"{field}.territoryLabel: etichetta non vuota attesa")
            row_assignments = safe_integer(record.get("assignments"), f"{field}.assignments")
            completed = safe_integer(
                record.get("completedAssignments"), f"{field}.completedAssignments"
            )
            if completed > row_assignments:
                raise StructuralError(f"{field}: conclusi superiori al totale")
            row_paid = safe_integer(record.get("paidCents"), f"{field}.paidCents")
            normalized = {
                "territoryLabel": label.strip(),
                "assignments": row_assignments,
                "paidCents": row_paid,
                "completedAssignments": completed,
                "individualRecipients": safe_integer(
                    record.get("individualRecipients"), f"{field}.individualRecipients"
                ),
                "organizationRecipients": safe_integer(
                    record.get("organizationRecipients"), f"{field}.organizationRecipients"
                ),
            }
            if record != normalized:
                raise StructuralError(f"{field}: contratto non valido")
            labels.append(normalized["territoryLabel"])
            assignment_sum += row_assignments
            paid_sum += row_paid
            normalized_rows.append(normalized)
        if len(labels) != len(set(labels)):
            raise StructuralError(f"year[{year}]: etichette territorio duplicate")
        if assignment_sum != assignments:
            raise StructuralError(f"year[{year}]: somma incarichi non riconcilia")
        if paid_sum != territory_paid_sum:
            raise StructuralError(f"year[{year}]: somma centesimi territorio non riconcilia")
        expected_order = sorted(
            normalized_rows,
            key=lambda row: (-int(row["paidCents"]), str(row["territoryLabel"])),
        )
        if normalized_rows != expected_order:
            raise StructuralError(f"year[{year}]: ordinamento territori non valido")

    if seen_years != sorted(seen_years):
        raise StructuralError("snapshot.years: anni non ordinati")
    if root.get("latestYear") != seen_years[-1]:
        raise StructuralError("snapshot.latestYear non corrisponde alla serie")
    periodo = required_dict(root.get("periodo"), "snapshot.periodo")
    if periodo.get("from") != seen_years[0] or periodo.get("to") != seen_years[-1]:
        raise StructuralError("snapshot.periodo non coerente con gli anni")
    soldi = required_dict(root.get("soldi"), "snapshot.soldi")
    if soldi.get("unit") != "EUR-cents" or soldi.get("metric") != "ammontareErogato":
        raise StructuralError("snapshot.soldi non valido")


def load_json(path: Path) -> Any:
    return json.loads(path.read_text(encoding="utf-8"), parse_float=Decimal, parse_int=int)


def write_if_changed(snapshot: dict, output: Path) -> bool:
    if output.exists():
        current = load_json(output)
        validate_snapshot(current)
        if semantic_view(current) == semantic_view(snapshot):
            print("Nessuna variazione nei dati Consulenti per territorio.")
            return False
    output.parent.mkdir(parents=True, exist_ok=True)
    output.write_text(json.dumps(snapshot, ensure_ascii=False, indent=2) + "\n", encoding="utf-8")
    return True


def fetch_bundle(timeout: int) -> tuple[object, dict[int, object], str]:
    national = fetch_json(NATIONAL_ENDPOINT, timeout)
    observed_at = utc_now()
    regional_by_year: dict[int, object] = {}
    for row in national_years(national):
        year = row["year"]
        query = urllib.parse.urlencode(
            {
                "AnnoConferimento": str(year),
                "TipoIncarico": EXTERNAL_APPOINTMENT_TYPE,
            }
        )
        regional_by_year[year] = fetch_json(f"{REGIONAL_ENDPOINT}?{query}", timeout)
    return national, regional_by_year, observed_at


def main() -> int:
    parser = argparse.ArgumentParser()
    parser.add_argument("--check", action="store_true", help="Valida lo snapshot senza rete")
    parser.add_argument(
        "--input-dir",
        type=Path,
        help="Cartella con national.json e regioni-YYYY.json per test o rigenerazione offline",
    )
    parser.add_argument("--output", type=Path, default=OUTPUT)
    parser.add_argument("--timeout", type=int, default=20)
    args = parser.parse_args()

    if args.check:
        validate_snapshot(load_json(args.output))
        print(f"Snapshot Consulenti per territorio valido: {args.output}")
        return 0

    if args.input_dir:
        national = load_json(args.input_dir / "national.json")
        observed_at = utc_now()
        regional_by_year = {}
        for row in national_years(national):
            path = args.input_dir / f"regioni-{row['year']}.json"
            regional_by_year[row["year"]] = load_json(path)
    else:
        national, regional_by_year, observed_at = fetch_bundle(args.timeout)

    snapshot = build_snapshot(national, regional_by_year, observed_at)
    validate_snapshot(snapshot)
    changed = write_if_changed(snapshot, args.output)
    latest = snapshot["years"][-1]
    print(
        json.dumps(
            {
                "changed": changed,
                "latestYear": snapshot["latestYear"],
                "territoryCount": latest["territoryCount"],
                "assignments": latest["assignments"],
                "paidCents": latest["paidCents"],
            },
            ensure_ascii=False,
            indent=2,
        )
    )
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
