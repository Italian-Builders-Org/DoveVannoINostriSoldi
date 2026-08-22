#!/usr/bin/env python3
"""Build the compact PCM 2024 financial-account snapshot from the official XLSX."""

from __future__ import annotations

import argparse
import hashlib
import html.parser
import io
import json
import re
import sys
import urllib.parse
import urllib.request
import zipfile
from collections import defaultdict
from datetime import datetime, timezone
from decimal import Decimal, ROUND_HALF_UP
from pathlib import Path
from xml.etree import ElementTree as ET

ROOT = Path(__file__).resolve().parents[2]
DATA_PATH = ROOT / "src/data/generated/pcm-financial-2024.data.json"
META_PATH = ROOT / "src/data/generated/pcm-financial-2024.meta.json"
LANDING_URL = (
    "https://presidenza.governo.it/AmministrazioneTrasparente/Bilanci/"
    "BilancioPreventivoConsultivo/ContoFinanziario/2024/index.html"
)
EXPECTED_LINK_LABEL = "conto finanziario"
EXPECTED_HEADERS = (
    "Esercizio Finanziario",
    "Stato di Previsione (STP)",
    "Codice CDR",
    "Centro di Responsabilita (CDR)",
    "Stato Capitolo",
    "Numero Capitolo",
    "Denominazione Integrale Capitolo",
    "Codice Missione",
    "Descrizione Missione",
    "Codice Programma",
    "Descrizione Programma",
    "Codice TIT",
    "Titolo di Spesa (TIT)",
    "Codice CAT",
    "Categoria di Spesa (CAT)",
    "Codice Divisione COFOG (FO1)",
    "Descrizione Divisione COFOG (FO1)",
    "Codice Gruppo COFOG (FO2)",
    "Descrizione Gruppo COFOG (FO2)",
    "Codice Classe COFOG (FO3)",
    "Descrizione Classe COFOG (FO3",
    "Stanziamento Iniziale di Competenza",
    "Stanziamento Iniziale di Cassa",
    "Stanziamento Definitivo Competenza",
    "Pagato in C/C",
    "Rimasto da Pagare C/C",
    "Impegnato",
    "Economie o maggiori spese in C/C",
    "Residui Accertati",
    "Pagato in C/R",
    "Rimasto da Pagare C/R",
    "Economie o maggiori spese in C/R",
)
MONEY_COLUMNS = {
    "finalCompetenceAppropriationCents": "Stanziamento Definitivo Competenza",
    "paymentsCurrentCents": "Pagato in C/C",
    "remainingCurrentCents": "Rimasto da Pagare C/C",
    "commitmentsCents": "Impegnato",
    "paymentsResidualCents": "Pagato in C/R",
}
NS = {"x": "http://schemas.openxmlformats.org/spreadsheetml/2006/main"}


class LinkParser(html.parser.HTMLParser):
    def __init__(self) -> None:
        super().__init__()
        self.links: list[tuple[str, str]] = []
        self.href: str | None = None
        self.label: list[str] = []

    def handle_starttag(self, tag: str, attrs: list[tuple[str, str | None]]) -> None:
        if tag.lower() == "a":
            self.href = dict(attrs).get("href")
            self.label = []

    def handle_data(self, data: str) -> None:
        if self.href is not None:
            self.label.append(data)

    def handle_endtag(self, tag: str) -> None:
        if tag.lower() == "a" and self.href is not None:
            self.links.append((" ".join("".join(self.label).split()), self.href))
            self.href = None
            self.label = []


def fetch(url: str) -> bytes:
    request = urllib.request.Request(
        url,
        headers={"User-Agent": "DoveVannoINostriSoldi/0.2 source-verifier"},
    )
    with urllib.request.urlopen(request, timeout=60) as response:
        payload = response.read()
        if response.status != 200:
            raise ValueError(f"HTTP inatteso {response.status}: {url}")
        return payload


def discover_workbook_url() -> str:
    parser = LinkParser()
    parser.feed(fetch(LANDING_URL).decode("utf-8", errors="strict"))
    matches = [href for label, href in parser.links if label.casefold() == EXPECTED_LINK_LABEL]
    if len(matches) != 1:
        raise ValueError(f"Atteso un link '{EXPECTED_LINK_LABEL}', trovati {len(matches)}")
    return urllib.parse.urljoin(LANDING_URL, matches[0])


def column_index(reference: str) -> int:
    letters = re.match(r"[A-Z]+", reference)
    if not letters:
        raise ValueError(f"Riferimento cella non valido: {reference}")
    result = 0
    for char in letters.group(0):
        result = result * 26 + ord(char) - 64
    return result - 1


def shared_strings(archive: zipfile.ZipFile) -> list[str]:
    try:
        root = ET.fromstring(archive.read("xl/sharedStrings.xml"))
    except KeyError:
        return []
    return ["".join(item.itertext()) for item in root.findall("x:si", NS)]


def cell_value(cell: ET.Element, strings: list[str]) -> object | None:
    cell_type = cell.attrib.get("t")
    value_node = cell.find("x:v", NS)
    if cell_type == "inlineStr":
        inline = cell.find("x:is", NS)
        return "".join(inline.itertext()) if inline is not None else None
    if value_node is None or value_node.text is None:
        return None
    raw = value_node.text
    if cell_type == "s":
        return strings[int(raw)]
    if cell_type in {"str", "e"}:
        return raw
    if cell_type == "b":
        return raw == "1"
    return Decimal(raw)


def parse_xlsx(payload: bytes) -> list[list[object | None]]:
    if not payload.startswith(b"PK"):
        raise ValueError("Il file PCM non è un archivio XLSX")
    with zipfile.ZipFile(io.BytesIO(payload)) as archive:
        strings = shared_strings(archive)
        worksheet = ET.fromstring(archive.read("xl/worksheets/sheet1.xml"))
        parsed: list[list[object | None]] = []
        for row in worksheet.findall(".//x:sheetData/x:row", NS):
            values: list[object | None] = [None] * len(EXPECTED_HEADERS)
            for cell in row.findall("x:c", NS):
                index = column_index(cell.attrib["r"])
                if index < len(values):
                    values[index] = cell_value(cell, strings)
            parsed.append(values)
    if not parsed:
        raise ValueError("Workbook PCM vuoto")
    headers = tuple(str(value or "").strip() for value in parsed[0])
    if headers != EXPECTED_HEADERS:
        raise ValueError("Schema PCM inatteso: intestazioni cambiate")
    return parsed[1:]


def decimal_value(value: object | None) -> Decimal:
    if value is None or value == "":
        return Decimal(0)
    try:
        return Decimal(str(value))
    except Exception as error:
        raise ValueError(f"Importo PCM non numerico: {value!r}") from error


def cents(value: Decimal) -> int:
    return int((value * 100).quantize(Decimal("1"), rounding=ROUND_HALF_UP))


def canonical_bytes(value: object) -> bytes:
    return (json.dumps(value, ensure_ascii=False, indent=2, sort_keys=True) + "\n").encode()


def build_snapshot(payload: bytes, source_url: str, acquired_at: str) -> tuple[dict, dict]:
    rows = parse_xlsx(payload)
    headers = {header: index for index, header in enumerate(EXPECTED_HEADERS)}
    blank_rows = sum(all(value is None for value in row) for row in rows)
    rows = [row for row in rows if not all(value is None for value in row)]
    if len(rows) != 572 or blank_rows != 1:
        raise ValueError(f"Copertura PCM inattesa: {len(rows)} righe, {blank_rows} vuote")

    years = {int(decimal_value(row[headers["Esercizio Finanziario"]])) for row in rows}
    states = {int(decimal_value(row[headers["Stato di Previsione (STP)"]])) for row in rows}
    if years != {2024} or states != {19}:
        raise ValueError(f"Perimetro PCM inatteso: esercizi {years}, stati {states}")

    totals = {key: Decimal(0) for key in MONEY_COLUMNS}
    missions: dict[tuple[str, str], dict[str, Decimal]] = defaultdict(
        lambda: {"payments": Decimal(0), "commitments": Decimal(0)}
    )
    reconciliation_failures = 0
    centres = set()
    for row in rows:
        for key, column in MONEY_COLUMNS.items():
            totals[key] += decimal_value(row[headers[column]])
        paid_current = decimal_value(row[headers["Pagato in C/C"]])
        remaining_current = decimal_value(row[headers["Rimasto da Pagare C/C"]])
        committed = decimal_value(row[headers["Impegnato"]])
        if abs(committed - paid_current - remaining_current) > Decimal("0.01"):
            reconciliation_failures += 1
        mission_key = (
            str(row[headers["Codice Missione"]]).strip(),
            str(row[headers["Descrizione Missione"]]).strip(),
        )
        missions[mission_key]["payments"] += paid_current + decimal_value(
            row[headers["Pagato in C/R"]]
        )
        missions[mission_key]["commitments"] += committed
        centres.add(str(row[headers["Codice CDR"]]).strip())
    if reconciliation_failures:
        raise ValueError(f"Impegni non riconciliati in {reconciliation_failures} righe")

    total_cents = {key: cents(value) for key, value in totals.items()}
    total_cents["paymentsTotalCents"] = (
        total_cents["paymentsCurrentCents"] + total_cents["paymentsResidualCents"]
    )
    mission_rows = [
        {
            "code": code,
            "label": label,
            "paymentsCents": cents(values["payments"]),
            "commitmentsCents": cents(values["commitments"]),
        }
        for (code, label), values in missions.items()
    ]
    mission_rows.sort(key=lambda item: (-item["paymentsCents"], item["code"]))
    if sum(item["paymentsCents"] for item in mission_rows) != total_cents["paymentsTotalCents"]:
        raise ValueError("Pagamenti per missione non riconciliati")
    if sum(item["commitmentsCents"] for item in mission_rows) != total_cents["commitmentsCents"]:
        raise ValueError("Impegni per missione non riconciliati")

    data = {
        "schemaVersion": 1,
        "referenceYear": 2024,
        "unit": "euro_cents",
        "totals": total_cents,
        "missions": mission_rows,
        "coverage": {
            "sourceRows": len(rows),
            "excludedBlankRows": blank_rows,
            "centresOfResponsibility": len(centres),
            "missions": len(mission_rows),
            "currentAccountRowsReconciled": len(rows),
        },
        "definitions": {
            "scope": "Rendiconto finanziario della sola Presidenza del Consiglio dei ministri.",
            "commitments": "Obbligazioni registrate nell'esercizio, in competenza.",
            "paymentsCurrent": "Pagamenti dell'esercizio su impegni dello stesso esercizio.",
            "paymentsResidual": "Pagamenti dell'esercizio su residui di esercizi precedenti.",
            "paymentsTotal": "Somma dei pagamenti in conto competenza e in conto residui.",
            "notComparable": "Stanziamenti, impegni e pagamenti descrivono fasi diverse e non vengono sommati.",
        },
    }
    data_bytes = canonical_bytes(data)
    meta = {
        "schemaVersion": 1,
        "source": {
            "owner": "Presidenza del Consiglio dei ministri",
            "landingUrl": LANDING_URL,
            "resourceUrl": source_url,
            "sourceRecordId": "pcm:conto-finanziario:2024",
            "referencePeriod": "2024",
            "approvedAt": "2025-06-10",
            "publishedAt": "2025-06-19",
            "acquiredAt": acquired_at,
            "format": "xlsx",
            "licenseStatus": "not-declared",
            "rightsNote": "La pagina ufficiale non dichiara una licenza per il workbook.",
        },
        "asset": {
            "bytes": len(payload),
            "sha256": hashlib.sha256(payload).hexdigest(),
        },
        "transformation": {
            "version": 1,
            "description": "Esclusa una riga vuota; importi convertiti in centesimi; missioni aggregate e riconciliate con i totali.",
            "headers": len(EXPECTED_HEADERS),
        },
        "dataArtifact": {
            "path": str(DATA_PATH.relative_to(ROOT)),
            "bytes": len(data_bytes),
            "sha256": hashlib.sha256(data_bytes).hexdigest(),
        },
    }
    return data, meta


def validate_committed() -> None:
    data_bytes = DATA_PATH.read_bytes()
    data = json.loads(data_bytes)
    meta = json.loads(META_PATH.read_text())
    expected = meta["dataArtifact"]
    if len(data_bytes) != expected["bytes"] or hashlib.sha256(data_bytes).hexdigest() != expected["sha256"]:
        raise ValueError("Artefatto dati PCM non legato al manifesto")
    totals = data["totals"]
    if totals["paymentsTotalCents"] != totals["paymentsCurrentCents"] + totals["paymentsResidualCents"]:
        raise ValueError("Totale pagamenti PCM non riconciliato")
    if sum(item["paymentsCents"] for item in data["missions"]) != totals["paymentsTotalCents"]:
        raise ValueError("Missioni PCM non riconciliate")
    if data["coverage"] != {
        "sourceRows": 572,
        "excludedBlankRows": 1,
        "centresOfResponsibility": 20,
        "missions": 13,
        "currentAccountRowsReconciled": 572,
    }:
        raise ValueError("Copertura PCM inattesa")


def main() -> int:
    parser = argparse.ArgumentParser()
    parser.add_argument("--check", action="store_true")
    parser.add_argument("--input-xlsx", type=Path)
    parser.add_argument("--source-url")
    args = parser.parse_args()
    if args.check:
        validate_committed()
        print("PCM 2024: snapshot e manifesto validi")
        return 0

    source_url = args.source_url or discover_workbook_url()
    payload = args.input_xlsx.read_bytes() if args.input_xlsx else fetch(source_url)
    acquired_at = datetime.now(timezone.utc).replace(microsecond=0).isoformat().replace("+00:00", "Z")
    data, meta = build_snapshot(payload, source_url, acquired_at)
    DATA_PATH.write_bytes(canonical_bytes(data))
    META_PATH.write_bytes(canonical_bytes(meta))
    validate_committed()
    print(f"PCM 2024: {meta['asset']['bytes']} byte, SHA-256 {meta['asset']['sha256']}")
    return 0


if __name__ == "__main__":
    sys.exit(main())
