#!/usr/bin/env python3
"""Build an offline, hash-pinned RGS consulting payment snapshot."""

from __future__ import annotations

import argparse
import csv
import hashlib
import json
import re
import tempfile
from dataclasses import asdict, dataclass, fields
from decimal import Decimal, InvalidOperation
from pathlib import Path

ROOT = Path(__file__).resolve().parents[2]
DEFAULT_SPEC = ROOT / "scripts/etl/specs/rgs-consulting-payments-2024-2025.source.json"
DEFAULT_OUTPUT = ROOT / "src/data/generated/rgs-consulting-payments-2024-2025.json"
AMOUNT_RE = re.compile(r"^-?\d+\.\d{2}$")
SHA_RE = re.compile(r"^[a-f0-9]{64}$")
MAX_SAFE_INTEGER = 9_007_199_254_740_991

HEADERS = [
    "Esercizio Finanziario", "Stato di Previsione", "Amministrazione",
    "Unità di voto 1° livello", "Unità di voto 2° livello",
    "Numero Capitolo di Spesa", "Capitolo di Spesa",
    "Numero Piano di Gestione", "Piano di Gestione", "Codice Titolo",
    "Titolo", "Codice Categoria", "Categoria", "Codice CE 2° Livello",
    "CE 2° Livello", "Codice CE 3° Livello", "CE 3° Livello",
    "Codice Missione", "Missione", "Codice Programma", "Programma",
    "Codice Centro Responsabilità", "Centro Responsabilità", "Codice Azione",
    "Azione", "Previsioni Iniziali RS", "Previsioni Iniziali CP",
    "Previsioni Iniziali CS", "Variazioni RS", "Variazioni CP",
    "Variazioni CS", "Previsioni Definitive RS", "Previsioni Definitive CP",
    "Previsioni Definitive CS", "Pagato RS", "Pagato CP", "Pagato CS",
    "Rimasto da Pagare RS", "Rimasto da Pagare CP", "Totale RS", "Totale CP",
    "Totale CS", "Economie-Maggiori Spese RS", "Economie-Maggiori Spese CP",
    "Economie-Maggiori Spese CS", "RS al 31/12",
]
CE3 = {
    "2": "Consulenze, analisi e studi",
    "4": "Prestazioni di lavoro parasubordinato",
}
SELECTED_CE2 = ("2", "Spese per acquisto di servizi")
EXPECTED_SOURCES = {
    2024: {
        "datasetId": "spd_rnd_spe_elb_pig_01_2024",
        "landingUrl": "https://bdap-opendata.rgs.mef.gov.it/content/2024-rendiconto-pubblicato-elaborabile-spese-piano-di-gestione",
        "catalogUrl": "https://bdap-opendata.rgs.mef.gov.it/SpodCkanApi/api/3/action/package_show?id=d73a538b-5652-463f-8c97-b09b3ec818cd",
        "csvUrl": "https://bdap-opendata.rgs.mef.gov.it/SpodCkanApi/api/3/datastore/dump/d73a538b-5652-463f-8c97-b09b3ec818cd.csv",
        "schemaUrl": "https://bdap-opendata.rgs.mef.gov.it/sites/default/files/metadata_updfile/report/5189_Rendiconto%20Pubblicato%20Elaborabile%20Spese.pdf",
    },
    2025: {
        "datasetId": "spd_rnd_spe_elb_pig_01_2025",
        "landingUrl": "https://bdap-opendata.rgs.mef.gov.it/content/2025-rendiconto-pubblicato-elaborabile-spese-piano-di-gestione",
        "catalogUrl": "https://bdap-opendata.rgs.mef.gov.it/SpodCkanApi/api/3/action/package_show?id=f65dca45-815a-4e1c-899e-46ab75766047",
        "csvUrl": "https://bdap-opendata.rgs.mef.gov.it/SpodCkanApi/api/3/datastore/dump/f65dca45-815a-4e1c-899e-46ab75766047.csv",
        "schemaUrl": "https://bdap-opendata.rgs.mef.gov.it/sites/default/files/metadata_updfile/report/5507_Rendiconto%20Pubblicato%20Elaborabile%20Spese.pdf",
    },
}


class SnapshotError(ValueError):
    """The source or artifact diverges from the declared contract."""


def require_dict(value: object, label: str) -> dict[str, object]:
    if not isinstance(value, dict):
        raise SnapshotError(f"{label} deve essere un oggetto")
    return value


def require_list(value: object, label: str) -> list[object]:
    if not isinstance(value, list):
        raise SnapshotError(f"{label} deve essere un elenco")
    return value


def require_text(value: object, label: str) -> str:
    if not isinstance(value, str) or not value.strip():
        raise SnapshotError(f"{label} mancante")
    return value.strip()


def require_safe_integer(value: object, label: str) -> int:
    if isinstance(value, bool) or not isinstance(value, int) or abs(value) > MAX_SAFE_INTEGER:
        raise SnapshotError(f"{label} deve essere un intero sicuro")
    return value


def sha256_bytes(payload: bytes) -> str:
    return hashlib.sha256(payload).hexdigest()


def canonical_json(value: object) -> bytes:
    return json.dumps(value, ensure_ascii=False, sort_keys=True, separators=(",", ":"), allow_nan=False).encode("utf-8")


def validate_spec(spec: dict[str, object]) -> None:
    if (
        require_safe_integer(spec.get("schemaVersion"), "schemaVersion") != 1
        or spec.get("datasetId") != "rgs-consulting-payments-2024-2025"
    ):
        raise SnapshotError("source spec non supportata")
    generated_at = require_text(spec.get("generatedAt"), "generatedAt")
    if not re.fullmatch(r"\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}Z", generated_at):
        raise SnapshotError("timestamp di generazione non valido")
    if require_list(spec.get("canonicalHeaders"), "canonicalHeaders") != HEADERS or len(HEADERS) != 46:
        raise SnapshotError("header canonici divergenti")
    pairs: dict[str, str] = {}
    for raw in require_list(spec.get("selectedCe3"), "selectedCe3"):
        item = require_dict(raw, "selectedCe3[]")
        code = require_text(item.get("code"), "selectedCe3[].code")
        if code in pairs:
            raise SnapshotError("categoria CE3 duplicata")
        pairs[code] = require_text(item.get("label"), "selectedCe3[].label")
    if pairs != CE3:
        raise SnapshotError("coppie codice/etichetta CE3 divergenti")
    selected_ce2 = require_dict(spec.get("selectedCe2"), "selectedCe2")
    if (selected_ce2.get("code"), selected_ce2.get("label")) != SELECTED_CE2:
        raise SnapshotError("coppia codice/etichetta CE2 divergente")
    source = require_dict(spec.get("source"), "source")
    if (
        source.get("licenseId") != "cc-by"
        or source.get("license") != "Creative Commons Attribution"
        or source.get("licenseVersion") != "3.0"
        or source.get("licenseUrl") != "https://creativecommons.org/licenses/by/3.0/"
    ):
        raise SnapshotError("licenza sorgente inattesa")
    for key in ("publisher", "catalogUrl", "observedAt", "licenseUrl"):
        require_text(source.get(key), f"source.{key}")
    if not str(source["catalogUrl"]).startswith("https://bdap-opendata.rgs.mef.gov.it/"):
        raise SnapshotError("catalogo sorgente non ufficiale")
    if not re.fullmatch(r"\d{4}-\d{2}-\d{2}", str(source["observedAt"])):
        raise SnapshotError("data di osservazione sorgente non valida")
    license_evidence = require_dict(source.get("licenseEvidence"), "source.licenseEvidence")
    if (
        license_evidence.get("kind") != "record_landing_page_link"
        or license_evidence.get("observedHref") != "http://creativecommons.org/licenses/by/3.0"
        or license_evidence.get("cssSelector")
        != ".field-name-metadata-license a[href='http://creativecommons.org/licenses/by/3.0']"
        or license_evidence.get("observedAt") != source["observedAt"]
        or require_list(license_evidence.get("landingUrls"), "source.licenseEvidence.landingUrls")
        != [EXPECTED_SOURCES[year]["landingUrl"] for year in sorted(EXPECTED_SOURCES)]
    ):
        raise SnapshotError("prova record-specifica della licenza divergente")

    years: set[int] = set()
    sources = require_list(spec.get("sources"), "sources")
    if len(sources) != 2:
        raise SnapshotError("sono richieste due sorgenti annuali")
    for raw in sources:
        item = require_dict(raw, "sources[]")
        year = require_safe_integer(item.get("year"), "sources[].year")
        if year not in (2024, 2025) or year in years:
            raise SnapshotError("anno sorgente inatteso o duplicato")
        years.add(year)
        for key in ("datasetId", "landingUrl", "catalogUrl", "csvUrl", "schemaUrl", "sourceSha256"):
            require_text(item.get(key), f"sources[{year}].{key}")
        expected_identity = EXPECTED_SOURCES[year]
        for key, expected_value in expected_identity.items():
            if item.get(key) != expected_value:
                raise SnapshotError(f"identità sorgente {year}/{key} divergente")
        for key in ("landingUrl", "catalogUrl", "csvUrl", "schemaUrl"):
            if not str(item[key]).startswith("https://bdap-opendata.rgs.mef.gov.it/"):
                raise SnapshotError(f"URL OpenBDAP non ufficiale: {year}/{key}")
        if item.get("encoding") != "cp1252" or item.get("delimiter") != ";" or item.get("lineEnding") != "CRLF":
            raise SnapshotError(f"formato CSV inatteso per {year}")
        if item.get("trailingEmptyField") is not (year == 2025):
            raise SnapshotError(f"regola campo terminale inattesa per {year}")
        for key in ("sourceBytes", "expectedSourceRows", "expectedSelectedRows", "expectedPaidCents"):
            if require_safe_integer(item.get(key), f"sources[{year}].{key}") < 1:
                raise SnapshotError(f"sources[{year}].{key} non valido")
        if not isinstance(item.get("sourceSha256"), str) or not SHA_RE.fullmatch(str(item["sourceSha256"])):
            raise SnapshotError(f"sources[{year}].sourceSha256 non valido")
    if years != {2024, 2025}:
        raise SnapshotError("copertura anni incompleta")


def load_spec(path: Path = DEFAULT_SPEC) -> dict[str, object]:
    try:
        spec = json.loads(path.read_text(encoding="utf-8"))
    except (OSError, UnicodeDecodeError, json.JSONDecodeError) as error:
        raise SnapshotError(f"source spec illeggibile: {path}") from error
    validate_spec(spec)
    return spec


def parse_amount_cents(raw: str, label: str) -> int:
    value = raw.strip()
    if not AMOUNT_RE.fullmatch(value):
        raise SnapshotError(f"importo non valido in {label}: {raw!r}")
    try:
        cents = int((Decimal(value) * 100).to_integral_exact())
    except (InvalidOperation, ValueError) as error:
        raise SnapshotError(f"importo non valido in {label}: {raw!r}") from error
    if abs(cents) > MAX_SAFE_INTEGER:
        raise SnapshotError(f"importo fuori intervallo sicuro in {label}")
    return cents


@dataclass(frozen=True)
class PaymentRow:
    id: str
    year: int
    forecastCode: str
    administration: str
    chapterNumber: str
    chapter: str
    managementPlanNumber: str
    managementPlan: str
    ce2Code: str
    ce2Label: str
    ce3Code: str
    ce3Label: str
    missionCode: str
    mission: str
    programCode: str
    program: str
    responsibilityCenterCode: str
    responsibilityCenter: str
    actionCode: str
    action: str
    paidResidualCents: int
    paidCurrentCents: int
    paidCashCents: int


def parse_csv(payload: bytes, annual: dict[str, object]) -> tuple[list[PaymentRow], int]:
    year = int(annual["year"])
    if len(payload) != annual["sourceBytes"] or sha256_bytes(payload) != annual["sourceSha256"]:
        raise SnapshotError(f"CSV {year} non coincide con source spec (bytes/hash)")
    if payload.count(b"\r\n") == 0 or payload.count(b"\n") != payload.count(b"\r\n"):
        raise SnapshotError(f"line ending CSV {year} non conforme: atteso CRLF")
    try:
        decoded = payload.decode("cp1252")
        reader = csv.reader(decoded.splitlines(), delimiter=";", quotechar='"', strict=True)
        raw_headers = next(reader)
    except (UnicodeDecodeError, csv.Error, StopIteration) as error:
        raise SnapshotError(f"CSV {year} malformato") from error
    trailing = bool(annual["trailingEmptyField"])
    if raw_headers != HEADERS + ([""] if trailing else []):
        raise SnapshotError(f"header CSV {year} divergente")
    index = {name: position for position, name in enumerate(HEADERS)}
    parsed: list[PaymentRow] = []
    seen: set[str] = set()
    source_rows = 0
    try:
        for source_rows, raw_row in enumerate(reader, start=1):
            if len(raw_row) != (47 if trailing else 46):
                raise SnapshotError(f"numero campi inatteso nella riga {source_rows} del {year}")
            if trailing and raw_row[-1] != "":
                raise SnapshotError(f"campo terminale non vuoto nella riga {source_rows} del {year}")
            row = raw_row[:46]
            if row[index["Esercizio Finanziario"]] != str(year):
                raise SnapshotError(f"anno divergente nella riga {source_rows} del {year}")
            ce2 = (row[index["Codice CE 2° Livello"]], row[index["CE 2° Livello"]])
            code, label = row[index["Codice CE 3° Livello"]], row[index["CE 3° Livello"]]
            if ce2 != SELECTED_CE2:
                if label in CE3.values():
                    raise SnapshotError(f"gerarchia CE2 divergente nella riga {source_rows} del {year}")
                continue
            if code in CE3 and label != CE3[code]:
                raise SnapshotError(f"etichetta CE3 divergente nella riga {source_rows} del {year}")
            if label in CE3.values() and CE3.get(code) != label:
                raise SnapshotError(f"codice CE3 divergente nella riga {source_rows} del {year}")
            if (code, label) not in CE3.items():
                continue
            forecast = row[index["Stato di Previsione"]].strip()
            chapter_number = row[index["Numero Capitolo di Spesa"]].strip()
            plan_number = row[index["Numero Piano di Gestione"]].strip()
            if not forecast or not chapter_number or not plan_number:
                raise SnapshotError(f"identità piano di gestione incompleta nella riga {source_rows} del {year}")
            row_id = f"{year}:{forecast}:{chapter_number}:{plan_number}"
            if row_id in seen:
                raise SnapshotError(f"identità piano di gestione duplicata: {row_id}")
            seen.add(row_id)
            paid_rs = parse_amount_cents(row[index["Pagato RS"]], f"{row_id}/Pagato RS")
            paid_cp = parse_amount_cents(row[index["Pagato CP"]], f"{row_id}/Pagato CP")
            paid_cs = parse_amount_cents(row[index["Pagato CS"]], f"{row_id}/Pagato CS")
            if paid_cs != paid_rs + paid_cp:
                raise SnapshotError(f"Pagato CS non riconciliato con RS+CP: {row_id}")
            value = lambda name: row[index[name]].strip()
            parsed.append(PaymentRow(
                id=row_id, year=year, forecastCode=forecast,
                administration=value("Amministrazione"), chapterNumber=chapter_number,
                chapter=value("Capitolo di Spesa"), managementPlanNumber=plan_number,
                managementPlan=value("Piano di Gestione"),
                ce2Code=ce2[0], ce2Label=ce2[1], ce3Code=code, ce3Label=label,
                missionCode=value("Codice Missione"), mission=value("Missione"),
                programCode=value("Codice Programma"), program=value("Programma"),
                responsibilityCenterCode=value("Codice Centro Responsabilità"),
                responsibilityCenter=value("Centro Responsabilità"),
                actionCode=value("Codice Azione"), action=value("Azione"),
                paidResidualCents=paid_rs, paidCurrentCents=paid_cp, paidCashCents=paid_cs,
            ))
    except csv.Error as error:
        raise SnapshotError(f"CSV {year} malformato") from error
    if source_rows != annual["expectedSourceRows"]:
        raise SnapshotError(f"conteggio righe sorgente {year} divergente: {source_rows}")
    if len(parsed) != annual["expectedSelectedRows"]:
        raise SnapshotError(f"conteggio righe selezionate {year} divergente: {len(parsed)}")
    total = sum(row.paidCashCents for row in parsed)
    if total != annual["expectedPaidCents"]:
        raise SnapshotError(f"totale Pagato CS {year} divergente: {total}")
    return parsed, source_rows


def build_snapshot(spec: dict[str, object], inputs: dict[int, bytes]) -> dict[str, object]:
    validate_spec(spec)
    if set(inputs) != set(EXPECTED_SOURCES):
        raise SnapshotError("input annuali inattesi: richiesti esattamente 2024 e 2025")
    rows: list[PaymentRow] = []
    annual_coverage: list[dict[str, object]] = []
    resources: list[dict[str, object]] = []
    for raw in require_list(spec["sources"], "sources"):
        annual = require_dict(raw, "sources[]")
        year = int(annual["year"])
        if year not in inputs:
            raise SnapshotError(f"input {year} mancante")
        selected, source_rows = parse_csv(inputs[year], annual)
        rows.extend(selected)
        annual_coverage.append({
            "year": year, "sourceRows": source_rows, "selectedRows": len(selected),
            "zeroPaidRows": sum(row.paidCashCents == 0 for row in selected),
            "paidCashCents": sum(row.paidCashCents for row in selected),
            "byCe3": {code: sum(row.ce3Code == code for row in selected) for code in sorted(CE3)},
        })
        resources.append({key: annual[key] for key in (
            "year", "datasetId", "landingUrl", "catalogUrl", "csvUrl", "schemaUrl", "sourceBytes", "sourceSha256"
        )})
    rows.sort(key=lambda row: (row.year, row.forecastCode, row.chapterNumber, row.managementPlanNumber))
    if len({row.id for row in rows}) != len(rows):
        raise SnapshotError("identità piano di gestione duplicata fra le sorgenti")
    source = require_dict(spec["source"], "source")
    snapshot = {
        "schemaVersion": 1, "datasetId": spec["datasetId"], "generatedAt": spec["generatedAt"],
        "title": "Pagamenti per consulenze e lavoro parasubordinato nel Rendiconto dello Stato",
        "accountingGrain": "Una riga per esercizio, stato di previsione, capitolo e piano di gestione (PG).",
        "years": [2024, 2025], "amountUnit": "euro_cents",
        "coverage": {
            "sourceRows": sum(int(item["sourceRows"]) for item in annual_coverage),
            "selectedRows": len(rows), "zeroPaidRows": sum(row.paidCashCents == 0 for row in rows),
            "paidCashCents": sum(row.paidCashCents for row in rows), "annual": annual_coverage,
        },
        "methodology": {
            "selection": "Nel CE2 2 — Spese per acquisto di servizi, sono incluse tutte e sole le righe con la coppia ufficiale codice/etichetta CE3 2 — Consulenze, analisi e studi oppure 4 — Prestazioni di lavoro parasubordinato. Non sono applicati filtri testuali.",
            "amount": "Pagato CS in centesimi di euro, verificato riga per riga come Pagato RS + Pagato CP. Zero è un valore osservato e non un dato mancante.",
            "period": "Rendiconti pubblicati per gli esercizi finanziari 2024 e 2025.",
            "scope": "Bilancio finanziario dello Stato, dettaglio per piano di gestione; non comprende automaticamente altri comparti della pubblica amministrazione.",
        },
        "caveats": [
            "Le righe sono aggregati contabili per piano di gestione, non transazioni né contratti individuali.",
            "La fonte non identifica consulenti, beneficiari o singole prestazioni.",
            "Il confronto tra amministrazioni non è una classifica di efficienza o performance.",
            "Il Rendiconto 2026 non era disponibile alla data di osservazione; il 2026 non è stimato.",
        ],
        "source": {
            "publisher": source["publisher"], "catalogUrl": source["catalogUrl"],
            "observedAt": source["observedAt"], "license": source["license"],
            "licenseId": source["licenseId"], "licenseVersion": source["licenseVersion"],
            "licenseUrl": source["licenseUrl"], "licenseEvidence": source["licenseEvidence"],
            "resources": resources,
        },
        "categories": [{"code": code, "label": label} for code, label in CE3.items()],
        "rows": [asdict(row) for row in rows],
    }
    validate_snapshot(snapshot, spec)
    return snapshot


def validate_snapshot(snapshot: dict[str, object], spec: dict[str, object]) -> None:
    validate_spec(spec)
    expected_top_level = {
        "schemaVersion", "datasetId", "generatedAt", "title", "accountingGrain",
        "years", "amountUnit", "coverage", "methodology", "caveats", "source",
        "categories", "rows",
    }
    if set(snapshot) != expected_top_level:
        raise SnapshotError("chiavi artefatto inattese")
    years = require_list(snapshot.get("years"), "years")
    exact_years = [require_safe_integer(year, f"years[{index}]") for index, year in enumerate(years)]
    if (
        require_safe_integer(snapshot.get("schemaVersion"), "schemaVersion") != 1
        or snapshot.get("datasetId") != spec["datasetId"]
        or snapshot.get("generatedAt") != spec["generatedAt"]
        or exact_years != [2024, 2025]
        or snapshot.get("amountUnit") != "euro_cents"
    ):
        raise SnapshotError("metadati artefatto divergenti")
    for key in ("title", "accountingGrain"):
        require_text(snapshot.get(key), key)
    methodology = require_dict(snapshot.get("methodology"), "methodology")
    if set(methodology) != {"selection", "amount", "period", "scope"}:
        raise SnapshotError("metodologia artefatto incompleta")
    for key, value in methodology.items():
        require_text(value, f"methodology.{key}")
    caveats = require_list(snapshot.get("caveats"), "caveats")
    if not caveats or not all(isinstance(item, str) and item.strip() for item in caveats):
        raise SnapshotError("limiti artefatto incompleti")
    expected_categories = [{"code": code, "label": label} for code, label in CE3.items()]
    if snapshot.get("categories") != expected_categories:
        raise SnapshotError("categorie artefatto divergenti")

    source_spec = require_dict(spec["source"], "source")
    expected_resources = [
        {key: annual[key] for key in (
            "year", "datasetId", "landingUrl", "catalogUrl", "csvUrl", "schemaUrl",
            "sourceBytes", "sourceSha256",
        )}
        for annual in require_list(spec["sources"], "sources")
    ]
    expected_source = {
        "publisher": source_spec["publisher"], "catalogUrl": source_spec["catalogUrl"],
        "observedAt": source_spec["observedAt"], "license": source_spec["license"],
        "licenseId": source_spec["licenseId"], "licenseVersion": source_spec["licenseVersion"],
        "licenseUrl": source_spec["licenseUrl"], "licenseEvidence": source_spec["licenseEvidence"],
        "resources": expected_resources,
    }
    snapshot_source = require_dict(snapshot.get("source"), "source")
    resources = require_list(snapshot_source.get("resources"), "source.resources")
    for index, raw_resource in enumerate(resources):
        resource = require_dict(raw_resource, f"source.resources[{index}]")
        require_safe_integer(resource.get("year"), f"source.resources[{index}].year")
        require_safe_integer(resource.get("sourceBytes"), f"source.resources[{index}].sourceBytes")
    if snapshot_source != expected_source:
        raise SnapshotError("provenienza artefatto divergente dalla source spec")

    rows = require_list(snapshot.get("rows"), "rows")
    row_keys = {field.name for field in fields(PaymentRow)}
    seen: set[str] = set()
    sort_keys: list[tuple[int, str, str, str]] = []
    annual_rows: dict[int, list[dict[str, object]]] = {2024: [], 2025: []}
    string_fields = row_keys - {
        "year", "paidResidualCents", "paidCurrentCents", "paidCashCents",
    }
    for index, raw_row in enumerate(rows):
        row = require_dict(raw_row, f"rows[{index}]")
        if set(row) != row_keys:
            raise SnapshotError(f"chiavi riga inattese: rows[{index}]")
        for key in string_fields:
            require_text(row.get(key), f"rows[{index}].{key}")
        year = require_safe_integer(row.get("year"), f"rows[{index}].year")
        if year not in annual_rows:
            raise SnapshotError(f"anno riga inatteso: rows[{index}]")
        if (row.get("ce2Code"), row.get("ce2Label")) != SELECTED_CE2:
            raise SnapshotError(f"coppia CE2 riga divergente: rows[{index}]")
        ce3_code = str(row["ce3Code"])
        if CE3.get(ce3_code) != row.get("ce3Label"):
            raise SnapshotError(f"coppia CE3 riga divergente: rows[{index}]")
        expected_id = f'{year}:{row["forecastCode"]}:{row["chapterNumber"]}:{row["managementPlanNumber"]}'
        if row.get("id") != expected_id or expected_id in seen:
            raise SnapshotError(f"identità riga divergente o duplicata: rows[{index}]")
        seen.add(expected_id)
        paid_rs = require_safe_integer(row.get("paidResidualCents"), f"rows[{index}].paidResidualCents")
        paid_cp = require_safe_integer(row.get("paidCurrentCents"), f"rows[{index}].paidCurrentCents")
        paid_cs = require_safe_integer(row.get("paidCashCents"), f"rows[{index}].paidCashCents")
        if paid_cs != paid_rs + paid_cp:
            raise SnapshotError(f"identità contabile riga divergente: rows[{index}]")
        sort_keys.append((year, str(row["forecastCode"]), str(row["chapterNumber"]), str(row["managementPlanNumber"])))
        annual_rows[year].append(row)
    if sort_keys != sorted(sort_keys):
        raise SnapshotError("ordinamento righe divergente")

    coverage = require_dict(snapshot.get("coverage"), "coverage")
    if set(coverage) != {"sourceRows", "selectedRows", "zeroPaidRows", "paidCashCents", "annual"}:
        raise SnapshotError("chiavi copertura inattese")
    for key in ("sourceRows", "selectedRows", "zeroPaidRows", "paidCashCents"):
        require_safe_integer(coverage.get(key), f"coverage.{key}")
    annual_coverage = require_list(coverage.get("annual"), "coverage.annual")
    for index, raw_annual in enumerate(annual_coverage):
        annual = require_dict(raw_annual, f"coverage.annual[{index}]")
        if set(annual) != {"year", "sourceRows", "selectedRows", "zeroPaidRows", "paidCashCents", "byCe3"}:
            raise SnapshotError(f"chiavi copertura annuale inattese: coverage.annual[{index}]")
        for key in ("year", "sourceRows", "selectedRows", "zeroPaidRows", "paidCashCents"):
            require_safe_integer(annual.get(key), f"coverage.annual[{index}].{key}")
        by_ce3 = require_dict(annual.get("byCe3"), f"coverage.annual[{index}].byCe3")
        if set(by_ce3) != set(CE3):
            raise SnapshotError(f"categorie copertura annuale inattese: coverage.annual[{index}].byCe3")
        for code, value in by_ce3.items():
            require_safe_integer(value, f"coverage.annual[{index}].byCe3.{code}")
    expected_annual: list[dict[str, object]] = []
    for annual_spec in require_list(spec["sources"], "sources"):
        annual_contract = require_dict(annual_spec, "sources[]")
        year = int(annual_contract["year"])
        selected = annual_rows[year]
        paid_cash_cents = sum(int(row["paidCashCents"]) for row in selected)
        if (
            len(selected) != annual_contract["expectedSelectedRows"]
            or paid_cash_cents != annual_contract["expectedPaidCents"]
        ):
            raise SnapshotError(f"righe o totale artefatto {year} divergenti dalla source spec")
        expected_annual.append({
            "year": year,
            "sourceRows": annual_contract["expectedSourceRows"],
            "selectedRows": len(selected),
            "zeroPaidRows": sum(row["paidCashCents"] == 0 for row in selected),
            "paidCashCents": paid_cash_cents,
            "byCe3": {code: sum(row["ce3Code"] == code for row in selected) for code in sorted(CE3)},
        })
    expected_coverage = {
        "sourceRows": sum(int(item["sourceRows"]) for item in expected_annual),
        "selectedRows": len(rows),
        "zeroPaidRows": sum(int(item["zeroPaidRows"]) for item in expected_annual),
        "paidCashCents": sum(int(item["paidCashCents"]) for item in expected_annual),
        "annual": expected_annual,
    }
    if coverage != expected_coverage:
        raise SnapshotError("copertura o riconciliazione byCe3 divergente")


def write_snapshot(snapshot: dict[str, object], output: Path) -> None:
    output.parent.mkdir(parents=True, exist_ok=True)
    with tempfile.NamedTemporaryFile(dir=output.parent, delete=False) as handle:
        temporary = Path(handle.name)
        handle.write(canonical_json(snapshot) + b"\n")
    temporary.replace(output)


def check_snapshot(spec: dict[str, object], inputs: dict[int, bytes], output: Path) -> None:
    try:
        committed = json.loads(output.read_text(encoding="utf-8"))
    except (OSError, UnicodeDecodeError, json.JSONDecodeError) as error:
        raise SnapshotError("snapshot illeggibile") from error
    validate_snapshot(require_dict(committed, "snapshot"), spec)
    if output.read_bytes() != canonical_json(build_snapshot(spec, inputs)) + b"\n":
        raise SnapshotError("snapshot generato divergente: rigenerare l'artefatto")


def main() -> int:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--input-2024", type=Path, required=True)
    parser.add_argument("--input-2025", type=Path, required=True)
    parser.add_argument("--spec", type=Path, default=DEFAULT_SPEC)
    parser.add_argument("--output", type=Path, default=DEFAULT_OUTPUT)
    parser.add_argument("--check", action="store_true")
    args = parser.parse_args()
    spec = load_spec(args.spec)
    inputs = {2024: args.input_2024.read_bytes(), 2025: args.input_2025.read_bytes()}
    if args.check:
        check_snapshot(spec, inputs, args.output)
    else:
        write_snapshot(build_snapshot(spec, inputs), args.output)
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
