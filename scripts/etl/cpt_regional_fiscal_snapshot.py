#!/usr/bin/env python3
"""Build the versioned CPT regional revenue/expenditure snapshot.

The two inputs must come from the same Open CPT release and accounting scope.
Amounts in the source CSVs are millions of euro; the snapshot stores integer
cents to keep API, UI and MCP calculations deterministic.
"""

from __future__ import annotations

import argparse
import csv
import hashlib
import json
import re
from dataclasses import dataclass
from datetime import datetime, timezone
from decimal import Decimal, InvalidOperation, ROUND_HALF_UP
from pathlib import Path
from typing import Iterable


REVENUE_TOTAL = "E - 163 - TOTALE ENTRATE"
EXPENDITURE_TOTAL = "S - 445 - TOTALE SPESA"
EXPECTED_REVENUE_SHA256 = "dd28b44c5f4ba0ea0454ce33e1b87ed3dbb14c70bb7f6e38f54c0356adbe3328"
EXPECTED_EXPENDITURE_SHA256 = "a57b6271204045903b7d1a579c5734253e8df81419b1d42e7be451cf4bc64d32"
POPULATION_SHA256 = "c0aec6bec63a449dc9bca454f8e0af5a63c4dbe10ef24155d42eb8fbbdfd919f"
POPULATION_BYTES = 1_504_172
EXPECTED_POPULATION_MAPPING_SHA256 = "bb7260ff76743a42a3881bd57969e9dba6e70dda1e9e1740852c16d656874d61"

REVENUE_URL = "https://politichecoesione.governo.it/media/yhqdfy5d/en_pa_cemacro.csv"
EXPENDITURE_URL = "https://politichecoesione.governo.it/media/e31aeyon/sp_pa_cemacro.csv"
CATALOG_URL = (
    "https://politichecoesione.governo.it/it/politica-di-coesione/"
    "misurazione-valutazione-e-trasparenza/la-misurazione-delle-politiche-di-coesione/"
    "conti-pubblici-territoriali-cpt/i-dati/catalogo-open-cpt/"
)
POPULATION_URL = "https://www.istat.it/wp-content/uploads/2024/12/CENSIMENTO-E-DINAMICA-DELLA-POPOLAZIONE-2023.pdf"


@dataclass(frozen=True)
class Region:
    code: str
    name: str
    population_2023: int


# Manual normalization of the official ISTAT table for resident population at
# 31 December 2023. The reviewed mapping has its own immutable fingerprint
# below; the source PDF is also required and hash-pinned at generation time.
# CPT publishes the two autonomous provinces separately, so the aggregate
# Trentino-Alto Adige is not duplicated here.
REGIONS = {
    "01": Region("01", "Piemonte", 4_251_623),
    "02": Region("02", "Valle d'Aosta/Vallée d'Aoste", 122_877),
    "03": Region("03", "Lombardia", 10_012_054),
    "05": Region("05", "Veneto", 4_852_216),
    "06": Region("06", "Friuli-Venezia Giulia", 1_194_616),
    "07": Region("07", "Liguria", 1_509_140),
    "08": Region("08", "Emilia-Romagna", 4_451_938),
    "09": Region("09", "Toscana", 3_660_530),
    "10": Region("10", "Umbria", 853_068),
    "11": Region("11", "Marche", 1_482_746),
    "12": Region("12", "Lazio", 5_714_745),
    "13": Region("13", "Abruzzo", 1_269_571),
    "14": Region("14", "Molise", 289_224),
    "15": Region("15", "Campania", 5_593_906),
    "16": Region("16", "Puglia", 3_890_661),
    "17": Region("17", "Basilicata", 533_233),
    "18": Region("18", "Calabria", 1_838_568),
    "19": Region("19", "Sicilia", 4_797_359),
    "20": Region("20", "Sardegna", 1_570_453),
    "21": Region("21", "Provincia autonoma di Trento", 545_169),
    "22": Region("22", "Provincia autonoma di Bolzano/Bozen", 537_533),
}


class SnapshotError(ValueError):
    """Raised when an official input no longer matches the expected contract."""


def sha256(path: Path) -> str:
    digest = hashlib.sha256()
    with path.open("rb") as handle:
        for chunk in iter(lambda: handle.read(1024 * 1024), b""):
            digest.update(chunk)
    return digest.hexdigest()


def population_mapping_sha256() -> str:
    payload = "\n".join(
        f"{code};{region.population_2023}" for code, region in REGIONS.items()
    )
    return hashlib.sha256(payload.encode("ascii")).hexdigest()


SOURCE_AMOUNT = re.compile(r"^\d+(?:,\d+)?$")


def amount_cents(raw: str) -> int:
    if not isinstance(raw, str) or not SOURCE_AMOUNT.fullmatch(raw):
        raise SnapshotError(f"Formato importo CPT inatteso: {raw!r}")
    try:
        millions = Decimal(raw.replace(",", "."))
    except (InvalidOperation, AttributeError) as error:
        raise SnapshotError(f"Importo CPT non valido: {raw!r}") from error
    cents = (millions * Decimal(100_000_000)).quantize(Decimal("1"), rounding=ROUND_HALF_UP)
    if cents < 0:
        raise SnapshotError(f"Importo CPT negativo inatteso: {raw!r}")
    return int(cents)


def region_code(raw: str) -> str:
    code = raw.partition(" - ")[0].strip()
    if code not in REGIONS:
        raise SnapshotError(f"Codice territoriale CPT inatteso: {raw!r}")
    return code


def read_flow(path: Path, category_column: str, total_label: str, value_column: str) -> dict[tuple[int, str], int]:
    values: dict[tuple[int, str], int] = {}
    with path.open("r", encoding="ascii", newline="") as handle:
        reader = csv.DictReader(handle, delimiter=";")
        required = {"Regione per Dettaglio", category_column, "Anno", value_column}
        missing = required.difference(reader.fieldnames or [])
        if missing:
            raise SnapshotError(f"Colonne CPT mancanti in {path.name}: {sorted(missing)}")
        for row in reader:
            if row.get(category_column) != total_label:
                continue
            code = region_code(row["Regione per Dettaglio"])
            try:
                year = int(row["Anno"])
            except ValueError as error:
                raise SnapshotError(f"Anno CPT non valido: {row['Anno']!r}") from error
            key = (year, code)
            if key in values:
                raise SnapshotError(f"Riga CPT duplicata: {year}/{code}")
            values[key] = amount_cents(row[value_column])
    return values


def per_capita_cents(amount: int, population: int) -> int:
    return int((Decimal(amount) / Decimal(population)).quantize(Decimal("1"), rounding=ROUND_HALF_UP))


def build_snapshot(
    revenue_path: Path,
    expenditure_path: Path,
    population_path: Path,
    observed_at: str,
) -> dict[str, object]:
    revenue_hash = sha256(revenue_path)
    expenditure_hash = sha256(expenditure_path)
    if revenue_hash != EXPECTED_REVENUE_SHA256:
        raise SnapshotError(f"Hash entrate inatteso: {revenue_hash}")
    if expenditure_hash != EXPECTED_EXPENDITURE_SHA256:
        raise SnapshotError(f"Hash spese inatteso: {expenditure_hash}")
    population_hash = sha256(population_path)
    if population_hash != POPULATION_SHA256 or population_path.stat().st_size != POPULATION_BYTES:
        raise SnapshotError("Documento popolazione ISTAT inatteso")
    population_mapping_hash = population_mapping_sha256()
    if population_mapping_hash != EXPECTED_POPULATION_MAPPING_SHA256:
        raise SnapshotError("Normalizzazione della popolazione ISTAT divergente")

    revenues = read_flow(revenue_path, "Categoria Entrate", REVENUE_TOTAL, "E - Consolidato PA")
    expenditures = read_flow(expenditure_path, "Categoria Spese", EXPENDITURE_TOTAL, "S - Consolidato PA")
    if revenues.keys() != expenditures.keys():
        only_revenue = sorted(revenues.keys() - expenditures.keys())
        only_expenditure = sorted(expenditures.keys() - revenues.keys())
        raise SnapshotError(f"Copertura entrate/spese divergente: {only_revenue=}, {only_expenditure=}")

    years = sorted({year for year, _code in revenues})
    if years != list(range(2000, 2024)):
        raise SnapshotError(f"Serie storica CPT inattesa: {years}")
    if any({code for candidate_year, code in revenues if candidate_year == year} != set(REGIONS) for year in years):
        raise SnapshotError("La copertura territoriale CPT non contiene le 21 unità attese per ogni anno")

    rows: list[dict[str, object]] = []
    for year in years:
        for code, region in REGIONS.items():
            revenue = revenues[(year, code)]
            expenditure = expenditures[(year, code)]
            balance = revenue - expenditure
            population = region.population_2023 if year == 2023 else None
            rows.append({
                "year": year,
                "regionCode": code,
                "region": region.name,
                "revenueCents": revenue,
                "expenditureCents": expenditure,
                "balanceCents": balance,
                "population": population,
                "revenuePerCapitaCents": per_capita_cents(revenue, population) if population else None,
                "expenditurePerCapitaCents": per_capita_cents(expenditure, population) if population else None,
                "balancePerCapitaCents": per_capita_cents(balance, population) if population else None,
            })

    return {
        "schemaVersion": 1,
        "referenceYears": years,
        "defaultYear": 2023,
        "unit": "euro_cents",
        "rows": rows,
        "definitions": {
            "scope": "Pubblica Amministrazione consolidata CPT",
            "accountingBasis": "cassa: importi effettivamente incassati e spesi",
            "balanceFormula": "entrate meno spese",
            "positiveBalanceMeaning": "le entrate territorializzate superano le spese territorializzate nel perimetro CPT PA",
            "population": "popolazione residente ISTAT al 31 dicembre 2023; disponibile solo per il 2023",
        },
        "methodology": {
            "warning": "Il saldo è una differenza contabile territorializzata: non misura pressione fiscale, qualità dei servizi, merito politico o trasferimenti netti fra regioni.",
            "comparability": "Entrate e spese provengono dalla stessa release, dallo stesso perimetro PA consolidato e dalla stessa base di cassa CPT.",
            "notFiscalResidual": "Non è il residuo fiscale: il concetto richiede ulteriori scelte di territorializzazione e di perimetro.",
        },
        "provenance": {
            "owner": "Dipartimento per le Politiche di Coesione e per il Sud · Sistema CPT",
            "catalogUrl": CATALOG_URL,
            "observedAt": observed_at,
            "rightsNote": "Le condizioni di riuso vanno verificate sulla scheda ufficiale di ciascuna risorsa.",
            "inputs": [
                {
                    "kind": "revenue",
                    "resourceUrl": REVENUE_URL,
                    "rightsNote": "Consultare la scheda EN_PA_CEMACRO nel catalogo Open CPT.",
                    "bytes": revenue_path.stat().st_size,
                    "sha256": revenue_hash,
                },
                {
                    "kind": "expenditure",
                    "resourceUrl": EXPENDITURE_URL,
                    "rightsNote": "Consultare la scheda SP_PA_CEMACRO nel catalogo Open CPT.",
                    "bytes": expenditure_path.stat().st_size,
                    "sha256": expenditure_hash,
                },
                {
                    "kind": "population",
                    "resourceUrl": POPULATION_URL,
                    "rightsNote": "Consultare le condizioni di riutilizzo ISTAT applicabili al documento.",
                    "referenceDate": "2023-12-31",
                    "locator": "Tavola regionale: popolazione censita al 31 dicembre 2023; Province autonome riportate separatamente.",
                    "normalizedValuesSha256": population_mapping_hash,
                    "bytes": population_path.stat().st_size,
                    "sha256": population_hash,
                },
            ],
        },
    }


def parse_iso_timestamp(raw: str) -> str:
    value = raw.replace("Z", "+00:00")
    try:
        parsed = datetime.fromisoformat(value)
    except ValueError as error:
        raise argparse.ArgumentTypeError("observed-at deve essere ISO 8601") from error
    if parsed.tzinfo is None:
        raise argparse.ArgumentTypeError("observed-at deve includere il fuso orario")
    return parsed.astimezone(timezone.utc).isoformat().replace("+00:00", "Z")


def main(argv: Iterable[str] | None = None) -> int:
    parser = argparse.ArgumentParser()
    parser.add_argument("--revenue", type=Path, required=True)
    parser.add_argument("--expenditure", type=Path, required=True)
    parser.add_argument("--population", type=Path, required=True)
    parser.add_argument("--output", type=Path, required=True)
    parser.add_argument("--observed-at", type=parse_iso_timestamp, required=True)
    args = parser.parse_args(argv)
    snapshot = build_snapshot(args.revenue, args.expenditure, args.population, args.observed_at)
    args.output.parent.mkdir(parents=True, exist_ok=True)
    args.output.write_text(json.dumps(snapshot, ensure_ascii=False, indent=2) + "\n", encoding="utf-8")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
