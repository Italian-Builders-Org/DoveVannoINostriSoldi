#!/usr/bin/env python3
"""Pinned FC80AMMIN 2022 release — Amministrazione function, not total services."""
from __future__ import annotations

import argparse
from collections import Counter
import csv
from datetime import datetime, timezone
from decimal import Decimal
import hashlib
import io
import json
from pathlib import Path
import re

from opencivitas_common import (
    MUNICIPALITY_COLUMNS,
    StructuralError,
    basis_points,
    cents,
    clean_metric,
    load_entities,
    read_outer_file,
    row_dicts,
    snapshot_text,
    xlsx_rows,
)

SPEC_PATH = Path(__file__).with_name("specs") / "opencivitas-2022-amministrazione.source.json"
SPEC = json.loads(SPEC_PATH.read_text(encoding="utf-8"))
OUTPUT = Path("src/data/generated/opencivitas-2022-amministrazione.json")
# Filled after the first verified build; --check pins the immutable artifact.
SEMANTIC_SHA256 = "7ea47114a1e5acdc77f765b7fa9b623a8e167fe2ff802b6be68e20bc5ad68011"

FUNCTION = "AMMINISTRAZIONE"
FAMILY = "FC80AMMIN"

# Descrizioni bloccate dai metadati di QUESTO rilascio: qui i livelli sono "da 0 a 10"
# con la d minuscola, mentre in FC80SOCNID sono "Da 0 a 10". Non riusare le stringhe
# di un'altra funzione.
SELECTED_INDICATORS = {
    "FST_RIPROPORZIONATO_BI": "Spesa standard - Euro",
    "FST_RIPROPORZIONATO_BI_PROAB": "Spesa standard - Euro per abitante",
    "SPESA_STORICA": "Spesa storica - Euro",
    "SPESA_STORICA_PROAB": "Spesa storica - Euro per abitante",
    "DIFF_OUT_PERC": "Quantità di servizi offerti dal comune rispetto alla media di fascia di popolazione - %",
    "POSIZIONE_SPESA_PERC": "Livello della spesa - da 0 a 10",
    "POSIZIONE_OUTPUT_PERC": "Livello dei servizi erogati - da 0 a 10",
    "DESCR_NON_VALUTABILE_SPESA": "Motivo di non valutabilità per la spesa",
    "DESCR_NON_VALUTABILE_OUT": "Motivo di non valutabilità per i servizi offerti",
}
MONEY_CODES = {
    "FST_RIPROPORZIONATO_BI",
    "FST_RIPROPORZIONATO_BI_PROAB",
    "SPESA_STORICA",
    "SPESA_STORICA_PROAB",
}


def verify_bytes(payload: bytes, key: str) -> None:
    expected = SPEC["files"][key]
    if len(payload) != expected["bytes"] or hashlib.sha256(payload).hexdigest() != expected["sha256"]:
        raise StructuralError(f"{FAMILY}: byte/SHA-256 {key} diversi dal lock")


def verify_definitions(definitions: list[dict]) -> None:
    codes = [row.get("VAR_IND_COD") for row in definitions]
    if len(set(codes)) != len(codes):
        raise StructuralError(f"{FAMILY}: metadati indicatori duplicati")
    by_code = {row["VAR_IND_COD"]: row for row in definitions}
    for code, description in SELECTED_INDICATORS.items():
        row = by_code.get(code, {})
        expected_tip = "FS" if code in MONEY_CODES else "LQP"
        if (
            row.get("VAR_IND_DES") != description
            or row.get("VAR_IND_FUNZIONE") != FUNCTION
            or row.get("VAR_IND_LINGUA") != "IT"
            or row.get("VAR_IND_TIP") != expected_tip
        ):
            raise StructuralError(f"{FAMILY}: definizione/unità/perimetro inattesi per {code}")


def load_raw_data(payload: bytes) -> dict[str, dict[str, dict[str, str]]]:
    """FC80AMMIN CSV includes Privacy (unlike FC80RIFIUTI)."""
    raw_csv = read_outer_file(payload, ".csv")
    reader = csv.DictReader(io.TextIOWrapper(io.BytesIO(raw_csv), encoding="utf-8-sig", newline=""), delimiter=";")
    required = {"USERNAME", "Indicatore/Determinante", "Valore", "Anomalia", "Privacy"}
    if reader.fieldnames is None or list(reader.fieldnames) != SPEC["csvHeaders"]:
        raise StructuralError(f"{FAMILY}: schema CSV inatteso")
    if not required.issubset(reader.fieldnames):
        raise StructuralError(f"{FAMILY}: colonne mancanti {sorted(required - set(reader.fieldnames))}")
    selected: dict[str, dict[str, dict[str, str]]] = {}
    for row in reader:
        code = row["Indicatore/Determinante"]
        if code not in SELECTED_INDICATORS:
            continue
        bucket = selected.setdefault(row["USERNAME"], {})
        if code in bucket:
            raise StructuralError(f"{FAMILY}: dati duplicati {row['USERNAME']} / {code}")
        bucket[code] = {
            "value": row["Valore"].strip(),
            "anomaly": row["Anomalia"].strip(),
            "privacy": row["Privacy"].strip(),
        }
    return selected


def normalize_municipality(username: str, entity: dict, rows: dict) -> dict:
    warnings: list[str] = []

    def metric(code: str, *, required: bool = True) -> Decimal | None:
        return clean_metric(rows, code, warnings, required=required, decimal_separator=",")

    for code in MONEY_CODES:
        if rows[code]["anomaly"] or rows[code]["privacy"]:
            raise StructuralError(f"{username}: flag su misura monetaria {code}")

    historical = metric("SPESA_STORICA")
    standard = metric("FST_RIPROPORZIONATO_BI")
    historical_pc = metric("SPESA_STORICA_PROAB")
    standard_pc = metric("FST_RIPROPORZIONATO_BI_PROAB")
    if None in (historical, standard, historical_pc, standard_pc):
        raise StructuralError(f"{username}: valori monetari principali non disponibili")
    assert historical is not None and standard is not None and historical_pc is not None and standard_pc is not None
    if historical < 0 or standard <= 0 or historical_pc < 0 or standard_pc <= 0:
        raise StructuralError(f"{username}: valori monetari fuori intervallo")
    if historical > 0:
        population_from_historical = historical / historical_pc
        population_from_standard = standard / standard_pc
        relative_population_gap = abs(population_from_historical - population_from_standard) / population_from_standard
        if relative_population_gap > Decimal("0.000001"):
            raise StructuralError(f"{username}: totali e valori per abitante non riconciliati")

    historical_cents = cents(historical, "SPESA_STORICA")
    standard_cents = cents(standard, "FST_RIPROPORZIONATO_BI")
    historical_pc_cents = cents(historical_pc, "SPESA_STORICA_PROAB")
    standard_pc_cents = cents(standard_pc, "FST_RIPROPORZIONATO_BI_PROAB")
    difference_cents = historical_cents - standard_cents
    difference_pc_cents = historical_pc_cents - standard_pc_cents
    calculated_difference_bp = basis_points((historical - standard) / standard * 100, "differenza percentuale")

    output_difference = metric("DIFF_OUT_PERC", required=False)
    spending_level = metric("POSIZIONE_SPESA_PERC", required=False)
    service_level = metric("POSIZIONE_OUTPUT_PERC", required=False)
    for value, field in ((spending_level, "livello spesa"), (service_level, "livello servizi")):
        if value is not None and (value != value.to_integral_value() or not 0 <= value <= 10):
            raise StructuralError(f"{username}: {field} fuori intervallo")

    spending_reason = rows.get("DESCR_NON_VALUTABILE_SPESA", {}).get("value") or None
    services_reason = rows.get("DESCR_NON_VALUTABILE_OUT", {}).get("value") or None
    return {
        **entity,
        "historicalSpendingCents": historical_cents,
        "standardSpendingCents": standard_cents,
        "differenceCents": difference_cents,
        "historicalPerCapitaCents": historical_pc_cents,
        "standardPerCapitaCents": standard_pc_cents,
        "differencePerCapitaCents": difference_pc_cents,
        "differenceBasisPoints": calculated_difference_bp,
        "serviceDifferenceBasisPoints": None if output_difference is None else basis_points(output_difference, "differenza servizi"),
        "spendingLevel": None if spending_level is None else int(spending_level),
        "serviceLevel": None if service_level is None else int(service_level),
        "spendingAssessmentReason": spending_reason,
        "servicesAssessmentReason": services_reason,
        "sourceWarnings": warnings,
    }


def incomplete_historical(rows: dict) -> bool:
    return any(not rows[code]["value"] for code in MONEY_CODES)


def normalize_rows(entities: dict, raw: dict) -> list[dict]:
    unknown = set(raw) - set(entities)
    if unknown != set(SPEC["excludedAggregates"]):
        raise StructuralError(f"{FAMILY}: join enti sconosciuti o aggregati inattesi")
    excluded_incomplete = set(SPEC["excludedIncompleteHistorical"])
    seen_incomplete: set[str] = set()
    result = []
    for username in sorted(set(raw) & set(entities)):
        entity = dict(entities[username])
        if entity["region"] == "EMILIA ROMAGNA":
            entity["region"] = "EMILIA-ROMAGNA"
        if entity["region"] not in SPEC["regionCounts"]:
            raise StructuralError(f"{FAMILY}: Comune fuori RSO {username}")
        rows = raw[username]
        if set(rows) != set(SELECTED_INDICATORS):
            raise StructuralError(f"{FAMILY}: indicatori comunali mancanti {username}")
        if incomplete_historical(rows):
            seen_incomplete.add(username)
            continue
        result.append(normalize_municipality(username, entity, rows))
    if seen_incomplete != excluded_incomplete:
        raise StructuralError(
            f"{FAMILY}: Comuni con spesa storica incompleta diversi dal lock "
            f"(attesi {sorted(excluded_incomplete)}, trovati {sorted(seen_incomplete)})"
        )
    if len(result) != SPEC["municipalities"] or Counter(row["region"] for row in result) != SPEC["regionCounts"]:
        raise StructuralError(f"{FAMILY}: copertura RSO non riconciliata")
    codes = [row["istatCode"] for row in result]
    if len(set(codes)) != len(codes):
        raise StructuralError(f"{FAMILY}: codice ISTAT duplicato")
    verify_national_totals(result)
    return sorted(result, key=lambda row: row["istatCode"])


def verify_national_totals(published: list[dict]) -> None:
    """Il fabbisogno è riproporzionato sul totale della spesa storica della funzione.

    L'uguaglianza vale sull'insieme completo dei Comuni joinati: i 9 esclusi perché
    privi di spesa storica portano fabbisogno senza contropartita, quindi sui Comuni
    pubblicati la somma del fabbisogno resta inferiore di quell'importo. Entrambi i
    lati sono vincolati nel lock: se la fonte cambia, il bundle si blocca invece di
    pubblicare una differenza aggregata che sembrerebbe un risparmio.
    """
    expected = SPEC["nationalTotals"]
    historical = sum(row["historicalSpendingCents"] for row in published)
    standard = sum(row["standardSpendingCents"] for row in published)
    if historical != expected["historicalSpendingCents"]:
        raise StructuralError(f"{FAMILY}: spesa storica totale diversa dal lock")
    if standard != expected["standardSpendingCentsPublished"]:
        raise StructuralError(f"{FAMILY}: fabbisogno totale pubblicato diverso dal lock")
    joined = expected["standardSpendingCentsJoined"]
    if joined - expected["standardSpendingCentsExcluded"] != standard:
        raise StructuralError(f"{FAMILY}: i totali dichiarati nel lock non sono coerenti fra loro")
    if abs(expected["historicalSpendingCents"] - joined) > expected["roundingToleranceCents"]:
        raise StructuralError(f"{FAMILY}: il fabbisogno non riproporziona più sul totale della spesa storica")


def normalize(data: bytes, entities: bytes, indicators: bytes, observed_at: str) -> dict:
    for key, payload in (("data", data), ("entities", entities), ("indicators", indicators)):
        verify_bytes(payload, key)
    definitions = list(row_dicts(xlsx_rows(read_outer_file(indicators, ".xlsx"))))
    verify_definitions(definitions)
    municipalities = normalize_rows(load_entities(entities), load_raw_data(data))
    return {
        "schemaVersion": 1,
        "transformVersion": 1,
        "scope": "ordinary-statute-municipalities-administration-fc80-2022",
        "referenceYear": 2022,
        "publishedAt": SPEC["publishedAt"],
        "modifiedAt": SPEC["modifiedAt"],
        "generatedAt": observed_at,
        "coverage": {
            "municipalities": len(municipalities),
            "regions": 15,
            "regionNames": sorted(SPEC["regionCounts"]),
            "territorialScope": "Comuni delle Regioni a statuto ordinario",
            "function": FUNCTION,
        },
        "municipalityColumns": list(MUNICIPALITY_COLUMNS),
        "municipalityRows": [[row[column] for column in MUNICIPALITY_COLUMNS] for row in municipalities],
        "source": {
            "owner": SPEC["owner"],
            "publisher": SPEC["publisher"],
            "dataset": "Comuni · Amministrazione · Indicatori e determinanti 2022 (FC80AMMIN)",
            "landingUrl": "https://www.opencivitas.it/it/open-data",
            "datasetUrl": SPEC["datasetPageUrl"],
            **{key + "Url": item["url"] for key, item in SPEC["files"].items()},
            "license": SPEC["license"],
            "licenseUrl": SPEC["licenseUrl"],
            "observedAt": observed_at,
            "declaredCadence": "Irregolare",
            "family": FAMILY,
            "releaseVersion": 1,
            "sha256": {key: item["sha256"] for key, item in SPEC["files"].items()},
            "bytes": {key: item["bytes"] for key, item in SPEC["files"].items()},
        },
        "methodology": {
            "differenceMeaning": "Differenza tra spesa storica e spesa standard sulla funzione Amministrazione. Non è una misura di spreco.",
            "serviceMeaning": "Il confronto sui servizi usa la media dei Comuni della stessa fascia di popolazione, perimetro Amministrazione.",
            "perCapitaMeaning": "Euro per abitante pubblicati dalla fonte; nessuna popolazione ricostruita o imputata.",
            "coverageWarning": "RSS e Province autonome fuori perimetro; esclusi gli aggregati di Italia, regioni, aree e fasce. Esclusi 9 Comuni con SPESA_STORICA o SPESA_STORICA_PROAB vuoti nella fonte (FST presente): nessuna imputazione a zero.",
            "rankingWarning": "I livelli della fonte non costituiscono un ranking di efficienza.",
            "functionSeparationWarning": "FC80AMMIN 2022 è distinto da FC80TOT 2022, FC80RIFIUTI 2022, FC80TERRVIAB 2022, FC80SOCNID 2022 e dalle altre funzioni: nessuna somma o confronto silenzioso fra funzioni o annualità.",
            "nationalDifferenceWarning": SPEC["nationalTotals"]["note"],
        },
    }


def semantic_digest(snapshot: dict) -> str:
    value = {key: item for key, item in snapshot.items() if key != "generatedAt"}
    value["source"] = {key: item for key, item in snapshot["source"].items() if key != "observedAt"}
    return hashlib.sha256(json.dumps(value, sort_keys=True, ensure_ascii=False, separators=(",", ":")).encode()).hexdigest()


def validate_snapshot(snapshot: dict) -> None:
    if not isinstance(snapshot, dict) or not isinstance(snapshot.get("source"), dict):
        raise StructuralError(f"{FAMILY}: oggetto snapshot e fonte attesi")
    observed = snapshot.get("generatedAt")
    if (
        not isinstance(observed, str)
        or observed != snapshot["source"].get("observedAt")
        or not re.fullmatch(r"\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d+)?(?:Z|[+-]\d{2}:\d{2})", observed)
    ):
        raise StructuralError(f"{FAMILY}: timestamp di acquisizione non coerenti")
    try:
        date = datetime.fromisoformat(observed.replace("Z", "+00:00"))
        if date.tzinfo is None or date < datetime(2025, 6, 16, tzinfo=timezone.utc):
            raise ValueError("acquisizione precedente al rilascio")
    except ValueError as error:
        raise StructuralError(f"{FAMILY}: timestamp ISO con fuso atteso") from error
    if SEMANTIC_SHA256 == "PENDING":
        raise StructuralError(f"{FAMILY}: SEMANTIC_SHA256 non ancora fissato")
    if semantic_digest(snapshot) != SEMANTIC_SHA256:
        raise StructuralError(f"{FAMILY}: SHA-256 semantico diverso dal rilascio verificato")


def main() -> None:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--check", action="store_true")
    parser.add_argument("--input-dir", type=Path, help="Directory dei tre ZIP ufficiali pinned; nessuna rete")
    parser.add_argument("--output", type=Path, default=OUTPUT)
    parser.add_argument("--print-semantic-sha", action="store_true", help="Stampa il digest senza pin (solo build)")
    args = parser.parse_args()
    if args.check:
        validate_snapshot(json.loads(args.output.read_text(encoding="utf-8")))
        print(f"{FAMILY} 2022: snapshot verificato offline")
        return
    if args.input_dir is None:
        parser.error("specificare --input-dir con i tre ZIP ufficiali")
    payloads = {
        key: (args.input_dir / item["url"].rsplit("/", 1)[1]).read_bytes()
        for key, item in SPEC["files"].items()
    }
    result = normalize(
        **payloads,
        observed_at=datetime.now(timezone.utc).isoformat(timespec="seconds").replace("+00:00", "Z"),
    )
    digest = semantic_digest(result)
    if args.print_semantic_sha or SEMANTIC_SHA256 == "PENDING":
        print(f"{FAMILY} semantic sha256={digest}")
    if SEMANTIC_SHA256 != "PENDING":
        validate_snapshot(result)
    if args.output.exists() and SEMANTIC_SHA256 != "PENDING":
        current = json.loads(args.output.read_text(encoding="utf-8"))
        validate_snapshot(current)
        if semantic_digest(current) == digest:
            print(f"{FAMILY} 2022: nessuna variazione")
            return
    args.output.parent.mkdir(parents=True, exist_ok=True)
    # newline esplicito: su Windows write_text tradurrebbe in CRLF e l'artefatto non
    # sarebbe piu' identico byte per byte a quello costruito su Linux (i generati sono `-text`).
    args.output.write_text(snapshot_text(result), encoding="utf-8", newline="\n")
    print(f"{FAMILY} 2022: {len(result['municipalityRows'])} Comuni")


if __name__ == "__main__":
    main()
