#!/usr/bin/env python3
"""Build the compact 2025 Ministries snapshot from the official RGS CSV."""

from __future__ import annotations

import argparse
import csv
import hashlib
import io
import json
import urllib.request
from collections import defaultdict
from datetime import datetime, timezone
from decimal import Decimal
from pathlib import Path

ROOT = Path(__file__).resolve().parents[2]
DATA_PATH = ROOT / "src/data/generated/rgs-ministries-2025.data.json"
META_PATH = ROOT / "src/data/generated/rgs-ministries-2025.meta.json"
LANDING_URL = "https://bdap-opendata.rgs.mef.gov.it/content/2025-rendiconto-pubblicato-elaborabile-spese-capitolo?metadati=showall"
RESOURCE_URL = "https://bdap-opendata.rgs.mef.gov.it/export/csv/2025---Rendiconto-Pubblicato-Elaborabile-Spese-Capitolo.csv"
SOURCE_RECORD_ID = "2025_RND_SPE_ELB_CAP_001"
EXPECTED_BYTES = 4_196_648
EXPECTED_SHA256 = "2887db4905d30445abc795083f2861f969173baf235a56917932c9fcc242e368"
EXPECTED_ROWS = 5_395
EXPECTED_HEADERS = (
    "Esercizio Finanziario", "Stato di Previsione", "Amministrazione",
    "Unità di voto 1° livello", "Unità di voto 2° livello", "Numero Capitolo di Spesa",
    "Capitolo di Spesa", "Codice Titolo", "Titolo", "Codice Categoria", "Categoria",
    "Codice Puntato CE", "Codice Missione", "Missione", "Codice Programma", "Programma",
    "Codice Centro Responsabilità", "Centro Responsabilità", "Codice Azione", "Azione",
    "Previsioni Iniziali RS", "Previsioni Iniziali CP", "Previsioni Iniziali CS",
    "Variazioni RS", "Variazioni CP", "Variazioni CS", "Previsioni Definitive RS",
    "Previsioni Definitive CP", "Previsioni Definitive CS", "Pagato RS", "Pagato CP",
    "Pagato CS", "Rimasto da Pagare RS", "Rimasto da Pagare CP", "Totale RS", "Totale CP",
    "Totale CS", "Economie-Maggiori Spese RS", "Economie-Maggiori Spese CP",
    "Economie-Maggiori Spese CS", "RS al 31/12",
)
MONEY_HEADERS = EXPECTED_HEADERS[20:]
EXPECTED_MINISTRIES = {
    "02": "MINISTERO DELL'ECONOMIA E DELLE FINANZE",
    "03": "MINISTERO DELLE IMPRESE E DEL MADE IN ITALY",
    "04": "MINISTERO DEL LAVORO E DELLE POLITICHE SOCIALI",
    "05": "MINISTERO DELLA GIUSTIZIA",
    "06": "MINISTERO DEGLI AFFARI ESTERI E DELLA COOPERAZIONE INTERNAZIONALE",
    "07": "MINISTERO DELL'ISTRUZIONE E DEL MERITO",
    "08": "MINISTERO DELL'INTERNO",
    "09": "MINISTERO DELL'AMBIENTE E DELLA SICUREZZA ENERGETICA",
    "10": "MINISTERO DELLE INFRASTRUTTURE E DEI TRASPORTI",
    "11": "MINISTERO DELL'UNIVERSITA' E DELLA RICERCA",
    "12": "MINISTERO DELLA DIFESA",
    "13": "MINISTERO DELL'AGRICOLTURA, DELLA SOVRANITA' ALIMENTARE E DELLE FORESTE",
    "14": "MINISTERO DELLA CULTURA",
    "15": "MINISTERO DELLA SALUTE",
    "16": "MINISTERO DEL TURISMO",
}
EXPECTED_DEFINITIONS = {
    "commitmentsCp": "Totale CP: pagato CP più rimasto da pagare CP.",
    "remainingCp": "Rimasto da pagare CP: voce RGS che completa il Totale CP; non è un totale di cassa e, da sola, non misura un debito da pagare.",
    "economiesGreaterExpensesCp": "importo di competenza rimasto inutilizzato rispetto alle previsioni o utilizzato oltre i limiti.",
    "paymentsCashCs": "Pagamenti di cassa: pagato CP più pagato su residui RS.",
    "residualsEnd": "Residui al 31 dicembre: rimasto CP più rimasto RS.",
    "notAdditive": "Impegni, pagamenti e residui descrivono fasi diverse e non vanno sommati.",
}


def fetch() -> bytes:
    request = urllib.request.Request(RESOURCE_URL, headers={"User-Agent": "DoveVannoINostriSoldi/0.2 source-verifier"})
    with urllib.request.urlopen(request, timeout=90) as response:
        if response.status != 200:
            raise ValueError(f"HTTP inatteso {response.status}")
        return response.read()


def decimal_value(row: dict[str, str], field: str) -> Decimal:
    try:
        return Decimal(row[field])
    except Exception as error:
        raise ValueError(f"Importo RGS non numerico in {field}: {row.get(field)!r}") from error


def money_cents(row: dict[str, str], field: str) -> int:
    value = decimal_value(row, field)
    if value.as_tuple().exponent < -2:
        raise ValueError(f"Importo RGS con frazioni di centesimo in {field}: {row[field]!r}")
    scaled = value * 100
    if scaled != scaled.to_integral_value():
        raise ValueError(f"Importo RGS non convertibile in centesimi in {field}: {row[field]!r}")
    return int(scaled)


def parse(payload: bytes) -> list[dict[str, str]]:
    if len(payload) != EXPECTED_BYTES or hashlib.sha256(payload).hexdigest() != EXPECTED_SHA256:
        raise ValueError("Asset RGS diverso dal file validato")
    text = payload.decode("cp1252", errors="strict")
    reader = csv.DictReader(io.StringIO(text), delimiter=";", quotechar='"')
    if tuple(reader.fieldnames or ()) != EXPECTED_HEADERS:
        raise ValueError("Schema RGS inatteso: intestazioni cambiate")
    rows = list(reader)
    if len(rows) != EXPECTED_ROWS:
        raise ValueError(f"Copertura RGS inattesa: {len(rows)} righe")
    return rows


def validate_row(row: dict[str, str]) -> None:
    values = {field: money_cents(row, field) for field in MONEY_HEADERS}
    identities = (
        ("Previsioni Definitive RS", "Previsioni Iniziali RS", "Variazioni RS"),
        ("Previsioni Definitive CP", "Previsioni Iniziali CP", "Variazioni CP"),
        ("Previsioni Definitive CS", "Previsioni Iniziali CS", "Variazioni CS"),
        ("Pagato CS", "Pagato CP", "Pagato RS"),
        ("Totale RS", "Pagato RS", "Rimasto da Pagare RS"),
        ("Totale CP", "Pagato CP", "Rimasto da Pagare CP"),
        ("RS al 31/12", "Rimasto da Pagare CP", "Rimasto da Pagare RS"),
    )
    for total, first, second in identities:
        if values[total] != values[first] + values[second]:
            raise ValueError(f"Identità RGS non riconciliata: {total}")
    if values["Totale CS"] != values["Pagato CS"]:
        raise ValueError("Identità RGS non riconciliata: Totale CS")
    for frame in ("RS", "CP", "CS"):
        if values[f"Economie-Maggiori Spese {frame}"] != values[f"Totale {frame}"] - values[f"Previsioni Definitive {frame}"]:
            raise ValueError(f"Identità RGS non riconciliata: economie {frame}")


def validate_ministry(row: dict[str, str]) -> None:
    code = row["Stato di Previsione"]
    if EXPECTED_MINISTRIES.get(code) != row["Amministrazione"]:
        raise ValueError(f"Amministrazione RGS inattesa per il codice {code}")


def register_mission_label(labels: dict[tuple[str, str], str], row: dict[str, str]) -> None:
    key = (row["Stato di Previsione"], row["Codice Missione"])
    label = row["Missione"]
    previous = labels.setdefault(key, label)
    if previous != label:
        raise ValueError(f"Etichetta missione RGS in conflitto per {key[0]}:{key[1]}")


def validate_coverage(source_rows: int, included_rows: int) -> None:
    if source_rows != EXPECTED_ROWS or included_rows != source_rows:
        raise ValueError(f"Copertura RGS non completa: {included_rows}/{source_rows} righe incluse")


def validate_source_manifest(meta: dict) -> None:
    source = meta.get("source", {})
    if (
        source.get("owner") != "Ragioneria Generale dello Stato"
        or source.get("sourceRecordId") != SOURCE_RECORD_ID
        or source.get("referencePeriod") != "2025"
        or source.get("landingUrl") != LANDING_URL
        or source.get("resourceUrl") != RESOURCE_URL
    ):
        raise ValueError("Identità della fonte Ministeri inattesa")
    if meta.get("asset") != {
        "bytes": EXPECTED_BYTES,
        "sha256": EXPECTED_SHA256,
        "encoding": "cp1252",
        "delimiter": ";",
    }:
        raise ValueError("CSV Ministeri non legato alla fonte validata")


def canonical_bytes(value: object) -> bytes:
    return (json.dumps(value, ensure_ascii=False, indent=2, sort_keys=True) + "\n").encode()


def build_snapshot(payload: bytes, acquired_at: str) -> tuple[dict, dict]:
    rows = parse(payload)
    ministries: dict[tuple[str, str], dict[str, int]] = defaultdict(lambda: defaultdict(int))
    missions: dict[tuple[str, str, str, str], dict[str, int]] = defaultdict(lambda: defaultdict(int))
    mission_labels: dict[tuple[str, str], str] = {}
    included_rows = 0
    for row in rows:
        validate_row(row)
        if row["Esercizio Finanziario"] != "2025":
            raise ValueError("Esercizio RGS inatteso")
        validate_ministry(row)
        register_mission_label(mission_labels, row)
        ministry = (row["Stato di Previsione"], row["Amministrazione"])
        mission = (*ministry, row["Codice Missione"], row["Missione"])
        for field in ("Totale CP", "Pagato CP", "Pagato RS", "Pagato CS", "Rimasto da Pagare CP", "Rimasto da Pagare RS", "RS al 31/12"):
            value = money_cents(row, field)
            ministries[ministry][field] += value
            missions[mission][field] += value
        included_rows += 1
    validate_coverage(len(rows), included_rows)
    if len(ministries) != 15 or {code: label for code, label in ministries} != EXPECTED_MINISTRIES:
        raise ValueError("Identità delle 15 amministrazioni RGS inattesa")

    ministry_rows = []
    for (code, label), values in ministries.items():
        mission_rows = [
            {
                "code": mission_code,
                "label": mission_label,
                "commitmentsCpCents": mission_values["Totale CP"],
                "paymentsCompetenceCpCents": mission_values["Pagato CP"],
                "remainingCpCents": mission_values["Rimasto da Pagare CP"],
            }
            for (ministry_code, _, mission_code, mission_label), mission_values in missions.items()
            if ministry_code == code
        ]
        mission_rows.sort(key=lambda item: (-item["commitmentsCpCents"], item["code"]))
        ministry_rows.append({
            "code": code,
            "label": label,
            "commitmentsCpCents": values["Totale CP"],
            "paymentsCompetenceCpCents": values["Pagato CP"],
            "paymentsResidualRsCents": values["Pagato RS"],
            "paymentsCashCsCents": values["Pagato CS"],
            "remainingCpCents": values["Rimasto da Pagare CP"],
            "remainingRsCents": values["Rimasto da Pagare RS"],
            "residualsEndCents": values["RS al 31/12"],
            "missions": mission_rows,
        })
    ministry_rows.sort(key=lambda item: (-item["commitmentsCpCents"], item["code"]))

    totals = {
        key: sum(item[key] for item in ministry_rows)
        for key in (
            "commitmentsCpCents", "paymentsCompetenceCpCents", "paymentsResidualRsCents",
            "paymentsCashCsCents", "remainingCpCents", "remainingRsCents", "residualsEndCents",
        )
    }
    if totals["paymentsCashCsCents"] != totals["paymentsCompetenceCpCents"] + totals["paymentsResidualRsCents"]:
        raise ValueError("Pagamenti CS aggregati non riconciliati")
    if totals["commitmentsCpCents"] != totals["paymentsCompetenceCpCents"] + totals["remainingCpCents"]:
        raise ValueError("Totale CP aggregato non riconciliato")
    if totals["residualsEndCents"] != totals["remainingCpCents"] + totals["remainingRsCents"]:
        raise ValueError("Residui finali aggregati non riconciliati")

    data = {
        "schemaVersion": 1,
        "referenceYear": 2025,
        "period": {"kind": "consuntivo", "year": 2025},
        "accountingFrame": "competenza",
        "unit": "EUR",
        "valueEncoding": "integer_cents",
        "totals": totals,
        "ministries": ministry_rows,
        "coverage": {"sourceRows": len(rows), "includedRows": included_rows, "headers": len(EXPECTED_HEADERS), "ministries": len(ministry_rows), "rowsReconciled": included_rows},
        "definitions": EXPECTED_DEFINITIONS,
    }
    data_bytes = canonical_bytes(data)
    meta = {
        "schemaVersion": 1,
        "source": {
            "owner": "Ragioneria Generale dello Stato",
            "landingUrl": LANDING_URL,
            "resourceUrl": RESOURCE_URL,
            "sourceRecordId": SOURCE_RECORD_ID,
            "referencePeriod": "2025",
            "createdAt": "2026-05-28",
            "updatedAt": "2026-07-14",
            "acquiredAt": acquired_at,
            "format": "csv",
            "licenseStatus": "declared",
            "licenseName": "CC BY 3.0",
        },
        "asset": {"bytes": len(payload), "sha256": hashlib.sha256(payload).hexdigest(), "encoding": "cp1252", "delimiter": ";"},
        "transformation": {"version": 1, "description": "41 colonne validate; 5.395 righe riconciliate e aggregate per Ministero e missione senza mescolare CP, RS e CS."},
        "dataArtifact": {"path": str(DATA_PATH.relative_to(ROOT)), "bytes": len(data_bytes), "sha256": hashlib.sha256(data_bytes).hexdigest()},
    }
    return data, meta


def validate_committed() -> None:
    data_bytes = DATA_PATH.read_bytes()
    data = json.loads(data_bytes)
    meta = json.loads(META_PATH.read_text())
    artifact = meta["dataArtifact"]
    if len(data_bytes) != artifact["bytes"] or hashlib.sha256(data_bytes).hexdigest() != artifact["sha256"]:
        raise ValueError("Artefatto Ministeri non legato al manifesto")
    validate_source_manifest(meta)
    if data["coverage"] != {"sourceRows": EXPECTED_ROWS, "includedRows": EXPECTED_ROWS, "headers": 41, "ministries": 15, "rowsReconciled": EXPECTED_ROWS}:
        raise ValueError("Copertura Ministeri inattesa")
    if data.get("definitions") != EXPECTED_DEFINITIONS:
        raise ValueError("Definizioni contabili Ministeri inattese")


def main() -> None:
    parser = argparse.ArgumentParser()
    parser.add_argument("--input", type=Path)
    parser.add_argument("--acquired-at")
    parser.add_argument("--validate-committed", action="store_true")
    args = parser.parse_args()
    if args.validate_committed:
        validate_committed()
        return
    payload = args.input.read_bytes() if args.input else fetch()
    acquired_at = args.acquired_at or datetime.now(timezone.utc).isoformat().replace("+00:00", "Z")
    data, meta = build_snapshot(payload, acquired_at)
    DATA_PATH.write_bytes(canonical_bytes(data))
    META_PATH.write_bytes(canonical_bytes(meta))


if __name__ == "__main__":
    main()
