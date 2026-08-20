#!/usr/bin/env python3
"""Build and validate the versioned OpenCoesione national overview snapshot."""

from __future__ import annotations

import argparse
import json
import os
import socket
import sys
import time
import urllib.error
import urllib.request
from datetime import datetime, timezone
from decimal import Decimal, InvalidOperation, ROUND_HALF_UP
from pathlib import Path
from urllib.parse import urlparse

ENDPOINT = "https://opencoesione.gov.it/it/api/aggregati/"
DEFAULT_OUTPUT = Path("src/data/generated/opencoesione-overview.json")
OFFICIAL_HOSTS = {"opencoesione.gov.it", "www.opencoesione.gov.it"}
USER_AGENT = "DoveVannoINostriSoldi-ETL/1.0 (+https://github.com/Italian-Builders-Org/DoveVannoINostriSoldi)"
TRANSIENT_HTTP = {403, 408, 425, 429, 500, 502, 503, 504}
MONEY_TOLERANCE_CENTS = 200
MAX_SAFE_INTEGER = 9_007_199_254_740_991
MAX_RETRIES = 2


class StructuralError(RuntimeError):
    """The upstream replied, but the contract is no longer trustworthy."""


def utc_now() -> str:
    return datetime.now(timezone.utc).isoformat(timespec="seconds")


def official_url(value: str, *, nullable: bool = False) -> str | None:
    if nullable and not value:
        return None
    parsed = urlparse(value)
    if parsed.scheme != "https" or parsed.hostname not in OFFICIAL_HOSTS:
        raise StructuralError(f"URL OpenCoesione non ufficiale: {value!r}")
    return value


def required_dict(value, field: str) -> dict:
    if not isinstance(value, dict):
        raise StructuralError(f"{field}: oggetto atteso")
    return value


def required_text(value, field: str) -> str:
    if not isinstance(value, str) or not value.strip():
        raise StructuralError(f"{field}: stringa non vuota attesa")
    return value.strip()


def integer(value, field: str) -> int:
    text = required_text(value, field)
    if not text.isdigit():
        raise StructuralError(f"{field}: intero non negativo atteso")
    result = int(text)
    if result > MAX_SAFE_INTEGER:
        raise StructuralError(f"{field}: supera il limite sicuro JavaScript")
    return result


def money_cents(value, field: str) -> int:
    text = required_text(value, field).replace(".", "").replace(",", ".")
    try:
        decimal = Decimal(text)
    except InvalidOperation as error:
        raise StructuralError(f"{field}: importo italiano non valido") from error
    if decimal < 0:
        raise StructuralError(f"{field}: importo negativo inatteso")
    cents = int((decimal * 100).quantize(Decimal("1"), rounding=ROUND_HALF_UP))
    if cents > MAX_SAFE_INTEGER:
        raise StructuralError(f"{field}: supera il limite sicuro JavaScript")
    return cents


def decimal_cents(value, field: str) -> int:
    if isinstance(value, bool) or not isinstance(value, (int, float)):
        raise StructuralError(f"{field}: numero atteso")
    cents = int((Decimal(str(value)) * 100).quantize(Decimal("1"), rounding=ROUND_HALF_UP))
    if cents < 0:
        # Early historical corrections can be negative in the upstream series.
        return 0
    if cents > MAX_SAFE_INTEGER:
        raise StructuralError(f"{field}: supera il limite sicuro JavaScript")
    return cents


def parse_totals(value, field: str) -> dict:
    totals = required_dict(value, field)
    return {
        "publicCostCents": money_cents(totals.get("costo_pubblico"), f"{field}.costo_pubblico"),
        "cohesionPublicCostCents": money_cents(
            totals.get("costo_pubblico_coesione"),
            f"{field}.costo_pubblico_coesione",
        ),
        "paymentsCents": money_cents(totals.get("pagamenti"), f"{field}.pagamenti"),
        "cohesionPaymentsCents": money_cents(
            totals.get("pagamenti_coesione"),
            f"{field}.pagamenti_coesione",
        ),
        "projects": integer(totals.get("progetti"), f"{field}.progetti"),
    }


def parse_dimension(value, field: str, *, links_required: bool) -> list[dict]:
    records = required_dict(value, field)
    if not records:
        raise StructuralError(f"{field}: dimensione vuota")
    parsed = []
    for slug, raw in records.items():
        item = required_dict(raw, f"{field}.{slug}")
        link = item.get("link")
        if links_required:
            link = official_url(required_text(link, f"{field}.{slug}.link"))
        else:
            link = official_url(link, nullable=True) if link else None
        parsed.append(
            {
                "slug": required_text(slug, f"{field}.slug"),
                "label": required_text(item.get("label"), f"{field}.{slug}.label"),
                "sourceUrl": link,
                **parse_totals(item.get("totali"), f"{field}.{slug}.totali"),
            }
        )
    return parsed


def reconcile(items: list[dict], total: dict, field: str) -> dict:
    result = {
        "publicCostDeltaCents": sum(item["publicCostCents"] for item in items)
        - total["publicCostCents"],
        "cohesionPublicCostDeltaCents": sum(item["cohesionPublicCostCents"] for item in items)
        - total["cohesionPublicCostCents"],
        "paymentsDeltaCents": sum(item["paymentsCents"] for item in items)
        - total["paymentsCents"],
        "cohesionPaymentsDeltaCents": sum(item["cohesionPaymentsCents"] for item in items)
        - total["cohesionPaymentsCents"],
        "projectsDelta": sum(item["projects"] for item in items) - total["projects"],
    }
    for money_field in (
        "publicCostDeltaCents",
        "cohesionPublicCostDeltaCents",
        "paymentsDeltaCents",
        "cohesionPaymentsDeltaCents",
    ):
        if abs(result[money_field]) > MONEY_TOLERANCE_CENTS:
            raise StructuralError(f"{field}: {money_field} non riconciliato ({result[money_field]} cent)")
    if result["projectsDelta"] != 0:
        raise StructuralError(f"{field}: progetti non riconciliati ({result['projectsDelta']})")
    return result


def normalize(raw: dict, observed_at: str) -> dict:
    root = required_dict(raw, "root")
    raw_date = required_text(root.get("data_aggiornamento"), "data_aggiornamento")
    try:
        reference_date = datetime.strptime(raw_date, "%Y%m%d").date().isoformat()
    except ValueError as error:
        raise StructuralError("data_aggiornamento: formato YYYYMMDD atteso") from error

    aggregations = required_dict(root.get("aggregati"), "aggregati")
    national = parse_totals(aggregations.get("totali"), "aggregati.totali")
    statuses = parse_dimension(
        aggregations.get("stati_progetti"),
        "aggregati.stati_progetti",
        links_required=False,
    )
    themes = parse_dimension(aggregations.get("temi"), "aggregati.temi", links_required=True)
    natures = parse_dimension(aggregations.get("nature"), "aggregati.nature", links_required=True)

    raw_series = aggregations.get("impegni_e_pagamenti_per_anno")
    if not isinstance(raw_series, list) or not raw_series:
        raise StructuralError("aggregati.impegni_e_pagamenti_per_anno: lista non vuota attesa")
    annual_series = []
    previous_year = 0
    for index, raw_point in enumerate(raw_series):
        point = required_dict(raw_point, f"annualSeries[{index}]")
        year = point.get("anno")
        if not isinstance(year, int) or year <= previous_year or year > 2200:
            raise StructuralError(f"annualSeries[{index}].anno non valido")
        previous_year = year
        annual_series.append(
            {
                "year": year,
                "commitmentsCents": decimal_cents(
                    point.get("ammontare_impegni"),
                    f"annualSeries[{index}].ammontare_impegni",
                ),
                "paymentsCents": decimal_cents(
                    point.get("ammontare_pagamenti"),
                    f"annualSeries[{index}].ammontare_pagamenti",
                ),
            }
        )

    return {
        "schemaVersion": 1,
        "generatedAt": observed_at,
        "referenceDate": reference_date,
        "scope": "national-overview",
        "totals": national,
        "statuses": statuses,
        "themes": themes,
        "natures": natures,
        "annualSeries": annual_series,
        "reconciliation": {
            "statuses": reconcile(statuses, national, "stati_progetti"),
            "themes": reconcile(themes, national, "temi"),
            "natures": reconcile(natures, national, "nature"),
        },
        "source": {
            "owner": "Dipartimento per le Politiche di Coesione",
            "dataset": "OpenCoesione · aggregati nazionali",
            "endpoint": ENDPOINT,
            "license": "CC BY 4.0",
            "declaredCadence": "Bimestrale prevista",
            "platformCheckCadence": "Ogni 6 ore",
            "observedAt": observed_at,
        },
        "methodology": {
            "paymentCostRatioMeaning": (
                "Rapporto finanziario tra pagamenti registrati e costo pubblico; "
                "non misura l'avanzamento fisico dei progetti."
            ),
            "territorialWarning": (
                "I progetti multilocalizzati possono comparire in più territori: "
                "le aggregazioni territoriali non sono additive."
            ),
            "roundingToleranceCents": MONEY_TOLERANCE_CENTS,
        },
    }


def fetch_json(timeout: int) -> tuple[dict, str]:
    request = urllib.request.Request(
        ENDPOINT,
        headers={"User-Agent": USER_AGENT, "Accept": "application/json"},
    )
    for attempt in range(MAX_RETRIES + 1):
        try:
            with urllib.request.urlopen(request, timeout=timeout) as response:
                final_url = response.geturl()
                official_url(final_url)
                content_type = response.headers.get("Content-Type", "").split(";", 1)[0].strip().lower()
                if content_type != "application/json":
                    raise StructuralError(f"Content-Type inatteso: {content_type or 'assente'}")
                body = response.read()
            try:
                return json.loads(body), utc_now()
            except json.JSONDecodeError as error:
                raise StructuralError("Risposta OpenCoesione non è JSON valido") from error
        except (urllib.error.HTTPError, urllib.error.URLError, TimeoutError, socket.timeout) as error:
            status = error.code if isinstance(error, urllib.error.HTTPError) else None
            transient = status in TRANSIENT_HTTP or status is None
            if not transient or attempt >= MAX_RETRIES:
                raise
            delay_seconds = 2**attempt
            print(
                f"::warning::Tentativo OpenCoesione {attempt + 1} fallito ({error}); "
                f"nuovo tentativo tra {delay_seconds}s",
                file=sys.stderr,
            )
            time.sleep(delay_seconds)

    raise AssertionError("ciclo retry OpenCoesione terminato senza risultato")


def validate_snapshot(snapshot: dict) -> None:
    normalized = normalize_like_snapshot(snapshot)
    for name, result in normalized["calculatedReconciliation"].items():
        claimed = normalized["reconciliation"].get(name)
        if claimed != result:
            raise StructuralError(f"snapshot {name}: scarto memorizzato non corrisponde ai dati")
        for money_field in (
            "publicCostDeltaCents",
            "cohesionPublicCostDeltaCents",
            "paymentsDeltaCents",
            "cohesionPaymentsDeltaCents",
        ):
            if abs(result[money_field]) > MONEY_TOLERANCE_CENTS:
                raise StructuralError(f"snapshot {name}: {money_field} oltre tolleranza")
        if result["projectsDelta"] != 0:
            raise StructuralError(f"snapshot {name}: progetti non riconciliati")


def normalize_like_snapshot(snapshot: dict) -> dict:
    if snapshot.get("schemaVersion") != 1 or snapshot.get("scope") != "national-overview":
        raise StructuralError("Snapshot OpenCoesione con schema o scope inatteso")
    datetime.fromisoformat(required_text(snapshot.get("generatedAt"), "generatedAt").replace("Z", "+00:00"))
    datetime.strptime(required_text(snapshot.get("referenceDate"), "referenceDate"), "%Y-%m-%d")
    endpoint = required_dict(snapshot.get("source"), "source").get("endpoint")
    official_url(required_text(endpoint, "source.endpoint"))
    for key in ("statuses", "themes", "natures", "annualSeries"):
        if not isinstance(snapshot.get(key), list) or not snapshot[key]:
            raise StructuralError(f"{key}: lista non vuota attesa")
    totals = snapshot_totals(snapshot.get("totals"), "totals")
    dimensions = {
        key: snapshot_dimensions(snapshot[key], key)
        for key in ("statuses", "themes", "natures")
    }
    claimed = required_dict(snapshot.get("reconciliation"), "reconciliation")
    for name in dimensions:
        result = required_dict(claimed.get(name), f"reconciliation.{name}")
        for field in (
            "publicCostDeltaCents",
            "cohesionPublicCostDeltaCents",
            "paymentsDeltaCents",
            "cohesionPaymentsDeltaCents",
            "projectsDelta",
        ):
            value = result.get(field)
            if isinstance(value, bool) or not isinstance(value, int):
                raise StructuralError(f"reconciliation.{name}.{field}: intero atteso")
    return {
        **snapshot,
        "calculatedReconciliation": {
            name: reconcile(items, totals, name)
            for name, items in dimensions.items()
        },
    }


def snapshot_integer(value, field: str) -> int:
    if isinstance(value, bool) or not isinstance(value, int) or value < 0 or value > MAX_SAFE_INTEGER:
        raise StructuralError(f"{field}: intero sicuro non negativo atteso")
    return value


def snapshot_totals(value, field: str) -> dict:
    record = required_dict(value, field)
    return {
        key: snapshot_integer(record.get(key), f"{field}.{key}")
        for key in (
            "publicCostCents",
            "cohesionPublicCostCents",
            "paymentsCents",
            "cohesionPaymentsCents",
            "projects",
        )
    }


def snapshot_dimensions(value: list, field: str) -> list[dict]:
    parsed = []
    for index, item in enumerate(value):
        record = required_dict(item, f"{field}[{index}]")
        required_text(record.get("slug"), f"{field}[{index}].slug")
        required_text(record.get("label"), f"{field}[{index}].label")
        link = record.get("sourceUrl")
        if link is not None:
            official_url(required_text(link, f"{field}[{index}].sourceUrl"))
        parsed.append(snapshot_totals(record, f"{field}[{index}]"))
    return parsed


def existing_snapshot(path: Path) -> dict | None:
    if not path.exists():
        return None
    try:
        snapshot = json.loads(path.read_text(encoding="utf-8"))
        validate_snapshot(snapshot)
        return snapshot
    except (OSError, json.JSONDecodeError, StructuralError, ValueError) as error:
        raise StructuralError(f"Snapshot esistente non valido: {error}") from error


def core_payload(snapshot: dict) -> dict:
    return {key: value for key, value in snapshot.items() if key != "generatedAt" and key != "source"} | {
        "source": {key: value for key, value in snapshot["source"].items() if key != "observedAt"}
    }


def write_if_changed(path: Path, snapshot: dict, current: dict | None) -> bool:
    if current is not None and core_payload(current) == core_payload(snapshot):
        print(f"OpenCoesione invariato: release {snapshot['referenceDate']} già acquisita")
        return False
    path.parent.mkdir(parents=True, exist_ok=True)
    temporary = path.with_suffix(path.suffix + ".tmp")
    temporary.write_text(json.dumps(snapshot, ensure_ascii=False, indent=2) + "\n", encoding="utf-8")
    os.replace(temporary, path)
    print(f"Snapshot OpenCoesione aggiornato: {path}")
    return True


def report(snapshot: dict, changed: bool) -> None:
    totals = snapshot["totals"]
    ratio = totals["paymentsCents"] / totals["publicCostCents"] if totals["publicCostCents"] else 0
    print(
        json.dumps(
            {
                "changed": changed,
                "referenceDate": snapshot["referenceDate"],
                "projects": totals["projects"],
                "publicCostEuro": totals["publicCostCents"] // 100,
                "paymentsEuro": totals["paymentsCents"] // 100,
                "paymentCostRatio": round(ratio * 100, 4),
                "statuses": len(snapshot["statuses"]),
                "themes": len(snapshot["themes"]),
                "natures": len(snapshot["natures"]),
                "reconciliation": snapshot["reconciliation"],
            },
            ensure_ascii=False,
            indent=2,
        )
    )


def main() -> int:
    parser = argparse.ArgumentParser()
    parser.add_argument("--output", type=Path, default=DEFAULT_OUTPUT)
    parser.add_argument("--input", type=Path, help="Read a captured upstream JSON instead of the network")
    parser.add_argument("--check", action="store_true", help="Validate the existing snapshot offline")
    parser.add_argument("--timeout", type=int, default=45)
    arguments = parser.parse_args()

    current = existing_snapshot(arguments.output)
    if arguments.check:
        if current is None:
            raise StructuralError(f"Snapshot assente: {arguments.output}")
        report(current, False)
        return 0

    try:
        if arguments.input:
            raw = json.loads(arguments.input.read_text(encoding="utf-8"))
            observed_at = utc_now()
        else:
            raw, observed_at = fetch_json(arguments.timeout)
        snapshot = normalize(raw, observed_at)
    except (urllib.error.HTTPError, urllib.error.URLError, TimeoutError, socket.timeout) as error:
        status = error.code if isinstance(error, urllib.error.HTTPError) else None
        transient = status in TRANSIENT_HTTP or status is None
        if transient and current is not None:
            print(
                f"::warning::OpenCoesione non raggiungibile ({error}); "
                f"mantengo lo snapshot valido del {current['referenceDate']}",
                file=sys.stderr,
            )
            report(current, False)
            return 0
        raise

    changed = write_if_changed(arguments.output, snapshot, current)
    report(snapshot, changed)
    return 0


if __name__ == "__main__":
    try:
        raise SystemExit(main())
    except (StructuralError, OSError, json.JSONDecodeError) as error:
        print(f"errore strutturale OpenCoesione: {error}", file=sys.stderr)
        raise SystemExit(2) from error
