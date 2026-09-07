#!/usr/bin/env python3
"""Build the hash-pinned OpenBDAP SSN 2024 Conto Economico snapshot.

The sources are three public OpenBDAP resources: entity-level CSV plus bounded
national and regional OData JSON inputs. The ETL is intentionally offline: the
caller downloads the exact catalogued resources and passes them to ``--input``,
``--national-input`` and ``--regional-input``. This keeps refreshes reviewable
and makes a network/schema change fail closed. Amounts are parsed as decimal
euros and stored as integer cents. The entity source contains a separate row
for every (region, BDAP entity, SSN entity, voice) tuple; those dimensions are
never silently collapsed.
"""

from __future__ import annotations

import argparse
import csv
import copy
import hashlib
import json
import re
import tempfile
from collections import OrderedDict
from dataclasses import dataclass
from datetime import datetime
from pathlib import Path
from typing import Iterable

from monetary import AmountError, AmountRangeError, MoneyPolicy, parse_cents
from monetary import MAX_SAFE_CENTS as MAX_SAFE_INTEGER


ROOT = Path(__file__).resolve().parents[2]
DEFAULT_LOCK = ROOT / "scripts/etl/specs/ssn-cce-2024.source.json"
DEFAULT_OUTPUT = ROOT / "src/data/generated/ssn-cce-2024.json"
DATE_RE = re.compile(r"^\d{2}/\d{2}/\d{4}$")
ISO_DATE_RE = re.compile(r"^\d{4}-\d{2}-\d{2}$")
ISO_TIMESTAMP_RE = re.compile(r"^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}Z$")
AMOUNT_RE = re.compile(r"^-?\d+\.\d{2}$")
MONEY_POLICY = MoneyPolicy(
    pattern=AMOUNT_RE,
    decimal_separator=".",
    unit="euros",
    allow_negative=True,
    rounding="reject",
    strip_whitespace=True,
)

EXPECTED_METRICS = {
    "productionCosts": ("BZ9999", "Totale costi della produzione (B)"),
    "personnelCost": ("BA2080", "Totale Costo del personale"),
    "healthcareWorkServices": (
        "BA1350",
        "B.2.A.15) Consulenze, Collaborazioni, Interinale e altre prestazioni di lavoro sanitarie e sociosanitarie",
    ),
    "nonHealthcareWorkServices": (
        "BA1750",
        "B.2.B.2) Consulenze, Collaborazioni, Interinale e altre prestazioni di lavoro non sanitarie",
    ),
    "purchasedServices": ("BA0390", "B.2) Acquisti di servizi"),
}


class SnapshotError(ValueError):
    """Raised when a source or generated snapshot diverges from the contract."""


def sha256_bytes(payload: bytes) -> str:
    return hashlib.sha256(payload).hexdigest()


def canonical_json(value: object) -> bytes:
    return json.dumps(
        value,
        ensure_ascii=False,
        sort_keys=True,
        separators=(",", ":"),
        allow_nan=False,
    ).encode("utf-8")


def canonical_lock_sha256(lock: dict[str, object]) -> str:
    candidate = copy.deepcopy(lock)
    integrity = candidate.get("integrity")
    if not isinstance(integrity, dict) or "lockSha256" not in integrity:
        raise SnapshotError("integrity.lockSha256 mancante")
    integrity["lockSha256"] = ""
    return sha256_bytes(canonical_json(candidate))


def require_dict(value: object, label: str) -> dict[str, object]:
    if not isinstance(value, dict):
        raise SnapshotError(f"{label} deve essere un oggetto")
    return value


def require_list(value: object, label: str) -> list[object]:
    if not isinstance(value, list):
        raise SnapshotError(f"{label} deve essere un elenco")
    return value


def text(value: object, label: str) -> str:
    if not isinstance(value, str) or not value.strip():
        raise SnapshotError(f"{label} mancante")
    return value.strip()


def validate_lock(lock: dict[str, object], *, allow_unbound_artifact: bool = False) -> None:
    if lock.get("schemaVersion") != 2:
        raise SnapshotError("schemaVersion source lock non supportata")
    if lock.get("datasetId") != "spd_ssn_cce_elb_voccn_01_2024":
        raise SnapshotError("datasetId SSN inatteso")
    if lock.get("referenceYear") != 2024:
        raise SnapshotError("anno di riferimento inatteso")
    observation = require_dict(lock.get("observation"), "observation")
    if observation.get("type") != "CONSUNTIVO":
        raise SnapshotError("tipo di rilevazione inatteso")
    for key in ("observedAt", "publishedAt"):
        date = text(observation.get(key), f"observation.{key}")
        if not ISO_DATE_RE.fullmatch(date):
            raise SnapshotError(f"data {key} non valida")

    source = require_dict(lock.get("source"), "source")
    for key in ("owner", "publisher", "title", "catalogUrl", "landingUrl", "license", "licenseId", "licenseVersion", "licenseUrl", "rightsHolder", "catalogMetadataCreated", "catalogMetadataModified", "landingPageUpdatedAt", "dataObservedAt"):
        text(source.get(key), f"source.{key}")
    if source.get("licenseId") != "cc-by" or source.get("license") != "Creative Commons Attribution" or source.get("licenseVersion") != "3.0 Unported" or source.get("licenseUrl") != "https://creativecommons.org/licenses/by/3.0/":
        raise SnapshotError("licenza OpenBDAP divergente dal catalogo")
    for key in ("catalogUrl", "landingUrl"):
        if not str(source[key]).startswith("https://bdap-opendata.rgs.mef.gov.it/"):
            raise SnapshotError(f"URL OpenBDAP non ufficiale: source.{key}")

    datasets = require_dict(lock.get("datasets"), "datasets")
    entities_source = require_dict(datasets.get("entities"), "datasets.entities")
    for key in ("datasetId", "landingUrl", "csvUrl", "odataUrl", "encoding", "delimiter", "quote", "lineEnding"):
        text(entities_source.get(key), f"datasets.entities.{key}")
    for key in ("landingUrl", "csvUrl", "odataUrl"):
        if not str(entities_source[key]).startswith("https://bdap-opendata.rgs.mef.gov.it/"):
            raise SnapshotError(f"URL OpenBDAP non ufficiale: datasets.entities.{key}")
    if entities_source.get("encoding") != "UTF-8" or entities_source.get("delimiter") != ";" or entities_source.get("lineEnding") != "CRLF":
        raise SnapshotError("encoding, separatore o line ending CSV inatteso")
    columns = require_list(entities_source.get("columns"), "datasets.entities.columns")
    if len(columns) != 11 or len(set(columns)) != 11 or not all(isinstance(column, str) for column in columns):
        raise SnapshotError("colonne CSV inattese")
    for key in ("expectedRows", "expectedEntities", "expectedExposedEntities", "expectedAggregateEntities", "expectedRegions", "expectedVoices", "sourceBytes"):
        if not isinstance(entities_source.get(key), int) or int(entities_source[key]) <= 0:
            raise SnapshotError(f"datasets.entities.{key} non valido")
    if not isinstance(entities_source.get("sourceSha256"), str) or not re.fullmatch(r"[a-f0-9]{64}", str(entities_source["sourceSha256"])):
        raise SnapshotError("datasets.entities.sourceSha256 non valido")
    for source_name, expected_rows in (("national", 5), ("regional", 105)):
        source_contract = require_dict(datasets.get(source_name), f"datasets.{source_name}")
        for key in ("datasetId", "landingUrl", "odataUrl", "sourceSha256"):
            text(source_contract.get(key), f"datasets.{source_name}.{key}")
        if not str(source_contract["landingUrl"]).startswith("https://bdap-opendata.rgs.mef.gov.it/") or not str(source_contract["odataUrl"]).startswith("https://bdap-opendata.rgs.mef.gov.it/"):
            raise SnapshotError(f"URL OpenBDAP non ufficiale: datasets.{source_name}")
        properties = require_list(source_contract["properties"], f"datasets.{source_name}.properties")
        if len(properties) != (6 if source_name == "national" else 8) or len(set(properties)) != len(properties) or not all(isinstance(prop, str) for prop in properties):
            raise SnapshotError(f"proprietà OData inattese: {source_name}")
        if source_contract.get("expectedRows") != expected_rows:
            raise SnapshotError(f"datasets.{source_name}.expectedRows inatteso")
        if not isinstance(source_contract.get("sourceBytes"), int) or source_contract["sourceBytes"] <= 0:
            raise SnapshotError(f"datasets.{source_name}.sourceBytes non valido")
        if not isinstance(source_contract.get("sourceSha256"), str) or not re.fullmatch(r"[a-f0-9]{64}", source_contract["sourceSha256"]):
            raise SnapshotError(f"datasets.{source_name}.sourceSha256 non valido")
    if entities_source.get("datasetId") != lock["datasetId"] or require_dict(datasets["national"], "datasets.national").get("datasetId") != "SSN_CCE_NAZ_VOCCN_001" or require_dict(datasets["regional"], "datasets.regional").get("datasetId") != "SSN_CCE_REG_VOCCN_001":
        raise SnapshotError("dataset ID SSN non riconciliati")

    metrics = require_list(lock.get("metrics"), "metrics")
    if len(metrics) != 5:
        raise SnapshotError("il contratto deve contenere cinque voci contabili")
    seen_ids: set[str] = set()
    seen_codes: set[str] = set()
    for metric in metrics:
        item = require_dict(metric, "metrics[]")
        metric_id = text(item.get("id"), "metrics[].id")
        code = text(item.get("code"), f"metrics.{metric_id}.code")
        label = text(item.get("label"), f"metrics.{metric_id}.label")
        meaning = text(item.get("meaning"), f"metrics.{metric_id}.meaning")
        if metric_id in seen_ids or code in seen_codes:
            raise SnapshotError("metriche duplicate")
        expected_metric = EXPECTED_METRICS.get(metric_id)
        if expected_metric is None or code != expected_metric[0] or label != expected_metric[1]:
            raise SnapshotError(f"definizione voce non autorizzata: {metric_id}/{code}")
        seen_ids.add(metric_id)
        seen_codes.add(code)
    if seen_ids != set(EXPECTED_METRICS) or seen_codes != {item[0] for item in EXPECTED_METRICS.values()}:
        raise SnapshotError("insieme delle voci contabili inatteso")

    expected = require_dict(lock.get("expected"), "expected")
    for key in ("entitySourceRows", "entities", "exposedEntities", "aggregateEntities", "regions", "voices", "nationalRows", "regionalRows", "referenceYear"):
        value = expected.get(key)
        if not isinstance(value, int) or value < 1:
            raise SnapshotError(f"expected.{key} non valido")
    if expected.get("observationType") != "CONSUNTIVO":
        raise SnapshotError("expected.observationType inatteso")

    integrity = require_dict(lock.get("integrity"), "integrity")
    artifact = require_dict(integrity.get("artifact"), "integrity.artifact")
    artifact_bytes = artifact.get("bytes")
    artifact_sha = artifact.get("sha256")
    if allow_unbound_artifact and artifact_bytes == 0 and artifact_sha == "":
        pass
    elif not isinstance(artifact_bytes, int) or artifact_bytes <= 0 or not isinstance(artifact_sha, str) or not re.fullmatch(r"[a-f0-9]{64}", artifact_sha):
        raise SnapshotError("integrity.artifact non valido")
    declared_lock_sha = integrity.get("lockSha256")
    actual_lock_sha = canonical_lock_sha256(lock)
    if allow_unbound_artifact and declared_lock_sha == "":
        return
    if declared_lock_sha != actual_lock_sha:
        raise SnapshotError(f"source lock modificato senza aggiornare lockSha256: {actual_lock_sha}")


def load_lock(path: Path = DEFAULT_LOCK) -> dict[str, object]:
    try:
        lock = json.loads(path.read_text(encoding="utf-8"))
    except (OSError, UnicodeDecodeError, json.JSONDecodeError) as error:
        raise SnapshotError(f"source lock illeggibile: {path}") from error
    validate_lock(lock, allow_unbound_artifact=True)
    return lock


def parse_amount_cents(raw: str, label: str) -> int:
    try:
        return parse_cents(raw, MONEY_POLICY)
    except AmountRangeError as error:
        raise SnapshotError(f"Importo fuori intervallo sicuro in {label}") from error
    except AmountError as error:
        raise SnapshotError(f"Importo non valido in {label}: {raw!r}") from error


def parse_date(raw: str, label: str) -> str:
    value = raw.strip()
    if not DATE_RE.fullmatch(value):
        raise SnapshotError(f"Data non valida in {label}: {raw!r}")
    try:
        return datetime.strptime(value, "%d/%m/%Y").date().isoformat()
    except ValueError as error:
        raise SnapshotError(f"Data non valida in {label}: {raw!r}") from error


@dataclass
class ParsedRow:
    year: int
    region_code: str
    region_name: str
    observation_type: str
    ssn_code: str
    bdap_code: str
    entity_name: str
    voice_code: str
    voice_label: str
    updated_at: str
    amount_cents: int

    @property
    def entity_key(self) -> tuple[str, str, str]:
        return self.region_code, self.bdap_code, self.ssn_code

    @property
    def voice_key(self) -> tuple[str, str, str, str]:
        return (*self.entity_key, self.voice_code)


def parse_csv(payload: bytes, lock: dict[str, object]) -> list[ParsedRow]:
    csv_contract = require_dict(require_dict(lock["datasets"], "datasets")["entities"], "datasets.entities")
    expected_bytes = int(csv_contract["sourceBytes"])
    expected_sha = str(csv_contract["sourceSha256"])
    if len(payload) != expected_bytes or sha256_bytes(payload) != expected_sha:
        raise SnapshotError("CSV non coincide con source lock (bytes/hash)")
    if payload.startswith(b"\xef\xbb\xbf"):
        raise SnapshotError("BOM UTF-8 non previsto dal source lock")
    if payload.count(b"\r\n") == 0 or payload.count(b"\n") != payload.count(b"\r\n"):
        raise SnapshotError("line ending CSV non conforme: atteso CRLF")
    try:
        text_payload = payload.decode("utf-8")
    except UnicodeDecodeError as error:
        raise SnapshotError("CSV non è UTF-8 valido") from error
    columns = [str(value) for value in csv_contract["columns"]]
    reader = csv.DictReader(text_payload.splitlines(), delimiter=";", quotechar='"', strict=True)
    if reader.fieldnames != columns:
        raise SnapshotError("header CSV divergente dal source lock")

    metrics = {str(item["code"]): str(item["label"]) for item in require_list(lock["metrics"], "metrics")}
    parsed: list[ParsedRow] = []
    seen_voice: set[tuple[str, str, str, str]] = set()
    expected_year = int(lock["referenceYear"])
    expected_type = str(require_dict(lock["observation"], "observation")["type"])
    for row_number, row in enumerate(reader, start=2):
        if None in row:
            raise SnapshotError(f"colonne in eccesso alla riga {row_number}")
        assert row is not None
        year_raw = text(row[columns[0]], f"Anno di Riferimento riga {row_number}")
        if not year_raw.isdigit() or int(year_raw) != expected_year:
            raise SnapshotError(f"anno inatteso alla riga {row_number}")
        region_code = text(row[columns[1]], f"Codice Regione riga {row_number}")
        if not re.fullmatch(r"\d{3}", region_code):
            raise SnapshotError(f"codice Regione non valido alla riga {row_number}")
        region_name = text(row[columns[2]], f"Descrizione Regione riga {row_number}")
        observation_type = text(row[columns[3]], f"Tipo Rilevazione riga {row_number}")
        if observation_type != expected_type:
            raise SnapshotError(f"tipo di rilevazione inatteso alla riga {row_number}")
        ssn_code = text(row[columns[4]], f"Codice Ente SSN riga {row_number}")
        bdap_code = text(row[columns[5]], f"Codice Ente BDAP riga {row_number}")
        if not re.fullmatch(r"\d+", ssn_code) or not re.fullmatch(r"\d+", bdap_code):
            raise SnapshotError(f"codice ente non valido alla riga {row_number}")
        entity_name = text(row[columns[6]], f"Descrizione Ente riga {row_number}")
        voice_code = text(row[columns[7]], f"Codice Voce Contabile riga {row_number}")
        voice_label = text(row[columns[8]], f"Descrizione Voce Contabile riga {row_number}")
        updated_at = parse_date(text(row[columns[9]], f"Data Aggiornamento riga {row_number}"), f"Data Aggiornamento riga {row_number}")
        amount = parse_amount_cents(text(row[columns[10]], f"Importo Totale riga {row_number}"), f"Importo Totale riga {row_number}")
        voice_key = (region_code, bdap_code, ssn_code, voice_code)
        if voice_key in seen_voice:
            raise SnapshotError(f"voce contabile duplicata alla riga {row_number}: {voice_key}")
        seen_voice.add(voice_key)
        if voice_code in metrics and voice_label != metrics[voice_code]:
            raise SnapshotError(f"descrizione voce divergente per {voice_code} alla riga {row_number}")
        parsed.append(ParsedRow(expected_year, region_code, region_name, observation_type, ssn_code, bdap_code, entity_name, voice_code, voice_label, updated_at, amount))

    expected_rows = int(require_dict(lock["expected"], "expected")["entitySourceRows"])
    if len(parsed) != expected_rows:
        raise SnapshotError(f"numero righe inatteso: {len(parsed)} != {expected_rows}")
    if len({row.voice_code for row in parsed}) != int(require_dict(lock["expected"], "expected")["voices"]):
        raise SnapshotError("numero voci contabili inatteso")
    return parsed


@dataclass(frozen=True)
class ParsedAggregateRow:
    year: int
    region_code: str | None
    region_name: str | None
    voice_code: str
    voice_label: str
    updated_at: str
    amount_cents: int


def parse_odata(payload: bytes, lock: dict[str, object], source_name: str) -> list[ParsedAggregateRow]:
    datasets = require_dict(lock.get("datasets"), "datasets")
    source = require_dict(datasets.get(source_name), f"datasets.{source_name}")
    expected_bytes = source.get("sourceBytes")
    expected_sha = source.get("sourceSha256")
    if not isinstance(expected_bytes, int) or len(payload) != expected_bytes or sha256_bytes(payload) != expected_sha:
        raise SnapshotError(f"JSON OData {source_name} non coincide con source lock (bytes/hash)")
    if payload.startswith(b"\xef\xbb\xbf"):
        raise SnapshotError(f"BOM UTF-8 non previsto nel JSON OData {source_name}")
    try:
        document = json.loads(payload.decode("utf-8"))
    except (UnicodeDecodeError, json.JSONDecodeError) as error:
        raise SnapshotError(f"JSON OData {source_name} illeggibile") from error
    root = require_dict(document, f"odata.{source_name}")
    envelope = require_dict(root.get("d"), f"odata.{source_name}.d")
    rows = require_list(envelope.get("results"), f"odata.{source_name}.d.results")
    expected_rows = source.get("expectedRows")
    if len(rows) != expected_rows:
        raise SnapshotError(f"numero righe OData {source_name} inatteso: {len(rows)} != {expected_rows}")
    properties = [str(value) for value in require_list(source.get("properties"), f"datasets.{source_name}.properties")]
    expected_keys = set(properties) | {"__metadata"}
    metrics = {str(item["code"]): str(item["label"]) for item in require_list(lock["metrics"], "metrics")}
    expected_year = int(lock["referenceYear"])
    parsed: list[ParsedAggregateRow] = []
    seen: set[tuple[str | None, str]] = set()
    region_names: dict[str, str] = {}
    for row_number, raw in enumerate(rows, start=1):
        row = require_dict(raw, f"odata.{source_name}.results[{row_number}]")
        if set(row) != expected_keys:
            raise SnapshotError(f"schema OData {source_name} divergente alla riga {row_number}")
        metadata = require_dict(row.get("__metadata"), f"odata.{source_name}.metadata[{row_number}]")
        text(metadata.get("uri"), f"odata.{source_name}.metadata.uri[{row_number}]")
        row_id = row.get("row_id")
        if not isinstance(row_id, int) or isinstance(row_id, bool) or row_id < 0:
            raise SnapshotError(f"row_id OData {source_name} non valido alla riga {row_number}")
        year_raw = text(row["Ccanno_di_rifer2017547080"], f"Anno OData {source_name} riga {row_number}")
        if not year_raw.isdigit() or int(year_raw) != expected_year:
            raise SnapshotError(f"anno OData {source_name} inatteso alla riga {row_number}")
        region_code: str | None = None
        region_name: str | None = None
        if source_name == "regional":
            region_code = text(row["Cccodice_region1532212456"], f"Codice Regione OData riga {row_number}")
            region_name = text(row["Ccdescrizione_r1013517246"], f"Regione OData riga {row_number}")
            if not re.fullmatch(r"\d{3}", region_code):
                raise SnapshotError(f"codice Regione OData non valido alla riga {row_number}")
            previous_name = region_names.get(region_code)
            if previous_name is not None and previous_name != region_name:
                raise SnapshotError(f"nome Regione OData {source_name} incoerente per {region_code} alla riga {row_number}")
            region_names[region_code] = region_name
        voice_code = text(row["Cccodice_voce_c1597042508"], f"Voce OData {source_name} riga {row_number}")
        voice_label = text(row["Ccdescrizione_vo915899106"], f"Descrizione voce OData riga {row_number}")
        if voice_code not in metrics or voice_label != metrics[voice_code]:
            raise SnapshotError(f"descrizione voce OData divergente alla riga {row_number}")
        updated_at = parse_date(text(row["Ccdata_aggiorna2057202945"], f"Data OData {source_name} riga {row_number}"), f"Data OData {source_name} riga {row_number}")
        amount_cents = parse_amount_cents(text(row["Ccimporto_total1317737785"], f"Importo OData {source_name} riga {row_number}"), f"Importo OData {source_name} riga {row_number}")
        key = (region_code, voice_code)
        if key in seen:
            raise SnapshotError(f"riga OData {source_name} duplicata: {key}")
        seen.add(key)
        parsed.append(ParsedAggregateRow(expected_year, region_code, region_name, voice_code, voice_label, updated_at, amount_cents))

    expected_codes = set(metrics)
    if {row.voice_code for row in parsed} != expected_codes:
        raise SnapshotError(f"insieme voci OData {source_name} inatteso")
    if source_name == "national" and len(parsed) != len(expected_codes):
        raise SnapshotError("dataset nazionale OData non ha una riga per voce")
    if source_name == "regional":
        region_codes = {row.region_code for row in parsed}
        if len(region_codes) != int(source.get("expectedRegions", 0)):
            raise SnapshotError("numero regioni OData inatteso")
        if any(sum(row.region_code == code for row in parsed) != len(expected_codes) for code in region_codes):
            raise SnapshotError("copertura voci regionale OData incompleta")
    return parsed


def _empty_values(metrics: list[dict[str, object]]) -> OrderedDict[str, int]:
    return OrderedDict((str(metric["id"]), 0) for metric in metrics)


def _empty_missing(metrics: list[dict[str, object]]) -> OrderedDict[str, int]:
    return OrderedDict((str(metric["id"]), 0) for metric in metrics)


def build_snapshot(
    lock: dict[str, object],
    entity_rows: Iterable[ParsedRow],
    national_rows: Iterable[ParsedAggregateRow],
    regional_rows: Iterable[ParsedAggregateRow],
    generated_at: str,
) -> dict[str, object]:
    validate_lock(lock, allow_unbound_artifact=True)
    if not ISO_TIMESTAMP_RE.fullmatch(generated_at):
        raise SnapshotError("generatedAt non valida")
    metrics = [require_dict(item, "metrics[]") for item in require_list(lock["metrics"], "metrics")]
    code_to_id = {str(metric["code"]): str(metric["id"]) for metric in metrics}
    metric_ids = list(code_to_id.values())
    expected = require_dict(lock["expected"], "expected")
    all_entity_rows = list(entity_rows)
    official_national_rows = list(national_rows)
    official_regional_rows = list(regional_rows)
    metric_codes = set(code_to_id)
    aggregate_rows = [
        row for row in all_entity_rows
        if row.ssn_code == "999" and row.voice_code in metric_codes
    ]
    detail_rows = [row for row in all_entity_rows if row.ssn_code != "999"]
    if len(aggregate_rows) != int(expected["aggregateEntities"]) * len(metric_ids):
        raise SnapshotError("numero righe aggregate codeSsn=999 inatteso")

    entities: dict[tuple[str, str, str], dict[str, object]] = {}
    region_detail: dict[str, dict[str, object]] = {}
    detail_present = _empty_missing(metrics)
    entity_updated_dates: set[str] = set()
    for row in detail_rows:
        entity_updated_dates.add(row.updated_at)
        entity = entities.setdefault(
            row.entity_key,
            {
                "id": f"{row.region_code}:{row.bdap_code}:{row.ssn_code}",
                "regionCode": row.region_code,
                "region": row.region_name,
                "codeBdap": row.bdap_code,
                "codeSsn": row.ssn_code,
                "name": row.entity_name,
                "values": _empty_values(metrics),
                "present": _empty_missing(metrics),
            },
        )
        for key, expected_value in (("regionCode", row.region_code), ("region", row.region_name), ("codeBdap", row.bdap_code), ("codeSsn", row.ssn_code), ("name", row.entity_name)):
            if entity[key] != expected_value:
                raise SnapshotError(f"identità ente incoerente per {entity['id']}")
        region = region_detail.setdefault(row.region_code, {"code": row.region_code, "name": row.region_name, "entityIds": set(), "present": _empty_missing(metrics)})
        if region["name"] != row.region_name:
            raise SnapshotError(f"nome Regione incoerente per {row.region_code}")
        region["entityIds"].add(entity["id"])
        metric_id = code_to_id.get(row.voice_code)
        if metric_id is None:
            continue
        if entity["present"][metric_id] != 0:
            raise SnapshotError(f"metrica duplicata per ente {entity['id']}: {metric_id}")
        entity["values"][metric_id] = row.amount_cents
        entity["present"][metric_id] = 1
        region["present"][metric_id] += 1
        detail_present[metric_id] += 1

    if len(entities) != int(expected["exposedEntities"]):
        raise SnapshotError(f"entità di dettaglio inattese: {len(entities)} != {expected['exposedEntities']}")
    if len(region_detail) != int(expected["regions"]):
        raise SnapshotError(f"Regioni di dettaglio inattese: {len(region_detail)} != {expected['regions']}")

    aggregate_values: dict[tuple[str, str], int] = {}
    aggregate_names: dict[str, str] = {}
    aggregate_present = _empty_missing(metrics)
    for row in aggregate_rows:
        metric_id = code_to_id.get(row.voice_code)
        if metric_id is None:
            continue
        key = (row.region_code, metric_id)
        if key in aggregate_values:
            raise SnapshotError(f"riga aggregate codeSsn=999 duplicata: {key}")
        aggregate_values[key] = row.amount_cents
        previous_name = aggregate_names.get(row.region_code)
        if previous_name is not None and previous_name != row.region_name:
            raise SnapshotError(f"nome Regione aggregate incoerente per {row.region_code}")
        aggregate_names[row.region_code] = row.region_name
        aggregate_present[metric_id] += 1
    if len(aggregate_names) != int(expected["aggregateEntities"]):
        raise SnapshotError("codici Regione aggregate codeSsn=999 inattesi")

    national_values = _empty_values(metrics)
    national_dates: set[str] = set()
    seen_national: set[str] = set()
    for row in official_national_rows:
        metric_id = code_to_id[row.voice_code]
        if metric_id in seen_national:
            raise SnapshotError(f"voce nazionale duplicata: {metric_id}")
        seen_national.add(metric_id)
        national_values[metric_id] = row.amount_cents
        national_dates.add(row.updated_at)
    if seen_national != set(metric_ids):
        raise SnapshotError("copertura nazionale ufficiale incompleta")

    regional_values: dict[tuple[str, str], int] = {}
    regional_names: dict[str, str] = {}
    regional_dates: set[str] = set()
    for row in official_regional_rows:
        assert row.region_code is not None and row.region_name is not None
        metric_id = code_to_id[row.voice_code]
        key = (row.region_code, metric_id)
        if key in regional_values:
            raise SnapshotError(f"voce regionale duplicata: {key}")
        regional_values[key] = row.amount_cents
        previous_name = regional_names.get(row.region_code)
        if previous_name is not None and previous_name != row.region_name:
            raise SnapshotError(f"nome Regione dataset regionale incoerente per {row.region_code}")
        regional_names[row.region_code] = row.region_name
        regional_dates.add(row.updated_at)
    if len(regional_names) != int(expected["regions"]):
        raise SnapshotError("copertura regionale ufficiale incompleta")

    if set(regional_names) != set(aggregate_names):
        raise SnapshotError("codici Regione codeSsn=999 e dataset regionale divergono")
    for region_code in sorted(regional_names):
        if regional_names[region_code] != aggregate_names[region_code]:
            raise SnapshotError(f"nome Regione divergente: {region_code}")
        for metric_id in metric_ids:
            if aggregate_values.get((region_code, metric_id)) != regional_values.get((region_code, metric_id)):
                raise SnapshotError(f"codeSsn=999 non coincide con regionale: {region_code}/{metric_id}")

    national_regional_difference = OrderedDict()
    for metric_id in metric_ids:
        regional_total = sum(regional_values[(region_code, metric_id)] for region_code in regional_names)
        difference = national_values[metric_id] - regional_total
        if difference != 0:
            raise SnapshotError(f"nazionale e regionale non riconciliati: {metric_id} ({difference} centesimi)")
        national_regional_difference[metric_id] = difference

    ordered_entities: list[dict[str, object]] = []
    for key in sorted(entities, key=lambda item: (item[0], item[2], item[1])):
        entity = entities[key]
        present = entity.pop("present")
        entity["missing"] = OrderedDict((metric_id, 1 - present[metric_id]) for metric_id in metric_ids)
        ordered_entities.append(entity)

    ordered_regions: list[dict[str, object]] = []
    for region_code in sorted(regional_names):
        detail = region_detail[region_code]
        entity_ids = detail["entityIds"]
        present = detail["present"]
        ordered_regions.append({
            "code": region_code,
            "name": regional_names[region_code],
            "detailEntityCount": len(entity_ids),
            "values": OrderedDict((metric_id, regional_values[(region_code, metric_id)]) for metric_id in metric_ids),
            "detailMissing": OrderedDict((metric_id, len(entity_ids) - present[metric_id]) for metric_id in metric_ids),
        })

    source = require_dict(lock["source"], "source")
    datasets = require_dict(lock["datasets"], "datasets")
    source_datasets = {name: require_dict(datasets[name], f"datasets.{name}") for name in ("entities", "national", "regional")}
    snapshot: dict[str, object] = {
        "schemaVersion": 2,
        "datasetId": lock["datasetId"],
        "generatedAt": generated_at,
        "referenceYear": lock["referenceYear"],
        "observation": {
            "type": require_dict(lock["observation"], "observation")["type"],
            "accountingBasis": "Conto Economico consuntivo; competenza economica, non flussi di cassa",
            "observedAt": require_dict(lock["observation"], "observation")["observedAt"],
            "publishedAt": require_dict(lock["observation"], "observation")["publishedAt"],
        },
        "metrics": metrics,
        "national": {
            "values": national_values,
        },
        "detailCoverage": {
            "entityCount": len(ordered_entities),
            "present": detail_present,
            "missing": OrderedDict((metric_id, len(ordered_entities) - detail_present[metric_id]) for metric_id in metric_ids),
        },
        "regions": ordered_regions,
        "entities": ordered_entities,
        "coverage": {
            "sourceRows": len(all_entity_rows),
            "entities": len(ordered_entities),
            "aggregateEntities": len(aggregate_names),
            "regions": len(ordered_regions),
            "voices": len({row.voice_code for row in all_entity_rows}),
            "updatedAtMin": min(entity_updated_dates),
            "updatedAtMax": max(entity_updated_dates),
            "nationalRows": len(official_national_rows),
            "regionalRows": len(official_regional_rows),
            "officialUpdatedAtMin": min(national_dates | regional_dates),
            "officialUpdatedAtMax": max(national_dates | regional_dates),
        },
        "reconciliation": {
            "nationalEqualsRegions": True,
            "regionalMatchesEntityAggregateRows": True,
            "nationalRegionalDifferenceCents": national_regional_difference,
            "entityMetricRowCounts": detail_present,
            "aggregateEntityMetricRowCounts": aggregate_present,
            "accounting": "Il nazionale proviene da SSN_CCE_NAZ_VOCCN_001; le Regioni da SSN_CCE_REG_VOCCN_001; il dettaglio proviene da SSN_CCE_ELB_VOCCN_001 senza le righe aggregate codeSsn=999. I livelli ufficiali non sono sommati fra loro.",
        },
        "source": {
            **source,
            "datasets": {
                "entities": source_datasets["entities"],
                "national": source_datasets["national"],
                "regional": source_datasets["regional"],
            },
        },
        "methodology": {
            "definitions": "Le etichette, i codici delle voci e gli importi sono quelli pubblicati nel Modello di rilevazione del Conto Economico degli enti del SSN. BA2080 è il Totale Costo del personale; BA1350 è la voce aggregata di consulenze, collaborazioni, interinale e altre prestazioni di lavoro sanitarie e sociosanitarie.",
            "comparability": "Il dataset è un consuntivo 2024 di conto economico. Il totale nazionale, gli aggregati regionali e il dettaglio per ente sono livelli ufficiali distinti: non vanno sommati fra loro e non vanno sommati a pagamenti SIOPE, bilanci di previsione o serie INPS.",
            "interpretation": "La differenza fra le voci contabili aiuta a leggere la composizione dei costi dichiarati dagli enti, ma non misura qualità, efficienza, fabbisogno, appropriatezza o illeciti.",
            "externalStaffBoundary": "La fonte non usa le categorie colloquiali gettonisti o cooperative. Il portale conserva e mostra la nomenclatura ufficiale senza trasformarla in una classificazione contrattuale.",
            "geography": "La geografia regionale proviene da SSN_CCE_REG_VOCCN_001; i codici 041 e 042 sono mantenuti separati. Le righe codeSsn=999 dell'entity source sono usate solo per verificare l'aggregato regionale e non sono esposte come enti di dettaglio.",
            "amountUnit": "Importi in centesimi di euro nell'artefatto; la UI può arrotondare solo in visualizzazione.",
        },
    }
    return snapshot


def validate_snapshot(snapshot: dict[str, object], lock: dict[str, object]) -> None:
    validate_lock(lock, allow_unbound_artifact=True)
    if snapshot.get("schemaVersion") != 2 or snapshot.get("datasetId") != lock["datasetId"] or snapshot.get("referenceYear") != 2024:
        raise SnapshotError("metadati snapshot inattesi")
    metrics = require_list(snapshot.get("metrics"), "snapshot.metrics")
    locked_metrics = require_list(lock["metrics"], "metrics")
    if metrics != locked_metrics:
        raise SnapshotError("metriche snapshot divergono dal source lock")
    observation = require_dict(snapshot.get("observation"), "snapshot.observation")
    if observation.get("type") != "CONSUNTIVO" or observation.get("observedAt") != lock["observation"]["observedAt"] or observation.get("publishedAt") != lock["observation"]["publishedAt"]:
        raise SnapshotError("osservazione snapshot inattesa")
    national = require_dict(snapshot.get("national"), "snapshot.national")
    detail_coverage = require_dict(snapshot.get("detailCoverage"), "snapshot.detailCoverage")
    entities = require_list(snapshot.get("entities"), "snapshot.entities")
    regions = require_list(snapshot.get("regions"), "snapshot.regions")
    expected = require_dict(lock["expected"], "expected")
    if len(entities) != int(expected["exposedEntities"]):
        raise SnapshotError("conteggio entità snapshot inatteso")
    if len(regions) != int(expected["regions"]):
        raise SnapshotError("conteggio regioni snapshot inatteso")
    metric_ids = [str(require_dict(metric, "metrics[]")["id"]) for metric in metrics]
    national_values = require_dict(national.get("values"), "snapshot.national.values")
    detail_entity_count = detail_coverage.get("entityCount")
    if detail_entity_count != len(entities):
        raise SnapshotError("conteggio copertura dettaglio inatteso")
    national_present = require_dict(detail_coverage.get("present"), "snapshot.detailCoverage.present")
    national_missing = require_dict(detail_coverage.get("missing"), "snapshot.detailCoverage.missing")
    if set(national_values) != set(metric_ids) or set(national_present) != set(metric_ids) or set(national_missing) != set(metric_ids):
        raise SnapshotError("metriche nazionali incomplete")
    for metric_id in metric_ids:
        if not isinstance(national_values[metric_id], int) or isinstance(national_values[metric_id], bool) or abs(national_values[metric_id]) > MAX_SAFE_INTEGER:
            raise SnapshotError(f"valore nazionale non valido: {metric_id}")
        if national_present[metric_id] + national_missing[metric_id] != len(entities):
            raise SnapshotError(f"copertura nazionale di dettaglio non riconciliata: {metric_id}")

    entity_ids: set[str] = set()
    for raw_entity in entities:
        entity = require_dict(raw_entity, "entities[]")
        entity_id = text(entity.get("id"), "entità.id")
        if entity_id in entity_ids or entity.get("codeSsn") == "999":
            raise SnapshotError("ente aggregate codeSsn=999 esposto o duplicato")
        entity_ids.add(entity_id)
        if entity_id != f"{entity.get('regionCode')}:{entity.get('codeBdap')}:{entity.get('codeSsn')}":
            raise SnapshotError("chiave ente non canonica")
        values = require_dict(entity.get("values"), "entità.values")
        missing = require_dict(entity.get("missing"), "entità.missing")
        if set(values) != set(metric_ids) or set(missing) != set(metric_ids):
            raise SnapshotError("metriche incomplete per entità")
        for metric_id in metric_ids:
            if not isinstance(values[metric_id], int) or isinstance(values[metric_id], bool) or abs(values[metric_id]) > MAX_SAFE_INTEGER:
                raise SnapshotError(f"valore {metric_id} non valido per entità")
            if missing[metric_id] not in (0, 1):
                raise SnapshotError(f"missing {metric_id} non valido per entità")

    region_codes: set[str] = set()
    for raw_region in regions:
        region = require_dict(raw_region, "regions[]")
        region_code = text(region.get("code"), "regione.code")
        if region_code in region_codes:
            raise SnapshotError("Regione duplicata")
        region_codes.add(region_code)
        entity_count = region.get("detailEntityCount")
        if not isinstance(entity_count, int) or entity_count <= 0:
            raise SnapshotError(f"entityCount Regione non valido: {region_code}")
        values = require_dict(region.get("values"), "regione.values")
        missing = require_dict(region.get("detailMissing"), "regione.detailMissing")
        if set(values) != set(metric_ids) or set(missing) != set(metric_ids):
            raise SnapshotError("metriche incomplete per Regione")
        for metric_id in metric_ids:
            if not isinstance(values[metric_id], int) or isinstance(values[metric_id], bool) or abs(values[metric_id]) > MAX_SAFE_INTEGER:
                raise SnapshotError(f"valore {metric_id} non valido per Regione")
            if not isinstance(missing[metric_id], int) or missing[metric_id] < 0 or missing[metric_id] > entity_count:
                raise SnapshotError(f"missing {metric_id} non valido per Regione")
    if sum(int(require_dict(region, "regions[]")["detailEntityCount"]) for region in regions) != len(entities):
        raise SnapshotError("conteggio enti per Regione non riconciliato")

    reconciliation = require_dict(snapshot.get("reconciliation"), "snapshot.reconciliation")
    if reconciliation.get("nationalEqualsRegions") is not True or reconciliation.get("regionalMatchesEntityAggregateRows") is not True:
        raise SnapshotError("invarianti ufficiali non dichiarate")
    differences = require_dict(reconciliation.get("nationalRegionalDifferenceCents"), "nationalRegionalDifferenceCents")
    entity_counts = require_dict(reconciliation.get("entityMetricRowCounts"), "entityMetricRowCounts")
    aggregate_counts = require_dict(reconciliation.get("aggregateEntityMetricRowCounts"), "aggregateEntityMetricRowCounts")
    for metric_id in metric_ids:
        region_total = sum(int(require_dict(region, "regions[]")["values"][metric_id]) for region in regions)
        difference = int(national_values[metric_id]) - region_total
        if differences.get(metric_id) != difference or difference != 0:
            raise SnapshotError(f"differenza nazionale-regioni inattesa: {metric_id}")
        if entity_counts.get(metric_id) + national_missing[metric_id] != len(entities) or aggregate_counts.get(metric_id) != len(regions):
            raise SnapshotError(f"conteggi di copertura inattesi: {metric_id}")
    coverage = require_dict(snapshot.get("coverage"), "snapshot.coverage")
    for key in ("sourceRows", "entities", "aggregateEntities", "regions", "voices", "nationalRows", "regionalRows"):
        expected_key = {
            "sourceRows": "entitySourceRows",
            "entities": "exposedEntities",
        }.get(key, key)
        if coverage.get(key) != expected[expected_key]:
            raise SnapshotError(f"coverage.{key} inattesa")
    for key in ("updatedAtMin", "updatedAtMax", "officialUpdatedAtMin", "officialUpdatedAtMax"):
        if not isinstance(coverage.get(key), str) or not ISO_DATE_RE.fullmatch(coverage[key]):
            raise SnapshotError(f"coverage.{key} inattesa")
    source = require_dict(snapshot.get("source"), "snapshot.source")
    lock_source = require_dict(lock["source"], "source")
    for key, expected_value in lock_source.items():
        if source.get(key) != expected_value:
            raise SnapshotError(f"provenance source.{key} inattesa")
    source_datasets = require_dict(source.get("datasets"), "snapshot.source.datasets")
    lock_datasets = require_dict(lock["datasets"], "datasets")
    for name in ("entities", "national", "regional"):
        if source_datasets.get(name) != lock_datasets.get(name):
            raise SnapshotError(f"provenance datasets.{name} inattesa")


def artifact_bytes(snapshot: dict[str, object]) -> bytes:
    return canonical_json(snapshot) + b"\n"


def write_atomically(path: Path, payload: bytes) -> None:
    path.parent.mkdir(parents=True, exist_ok=True)
    temp_name: Path | None = None
    try:
        with tempfile.NamedTemporaryFile(dir=path.parent, prefix=f".{path.name}.", delete=False) as tmp:
            tmp.write(payload)
            temp_name = Path(tmp.name)
        temp_name.replace(path)
    finally:
        if temp_name is not None:
            temp_name.unlink(missing_ok=True)


def generate(
    lock: dict[str, object],
    entity_input_path: Path,
    national_input_path: Path,
    regional_input_path: Path,
    generated_at: str,
    output_path: Path,
) -> tuple[int, str]:
    entity_rows = parse_csv(entity_input_path.read_bytes(), lock)
    national_rows = parse_odata(national_input_path.read_bytes(), lock, "national")
    regional_rows = parse_odata(regional_input_path.read_bytes(), lock, "regional")
    snapshot = build_snapshot(lock, entity_rows, national_rows, regional_rows, generated_at)
    validate_snapshot(snapshot, lock)
    artifact = artifact_bytes(snapshot)
    expected_artifact = require_dict(require_dict(lock["integrity"], "integrity")["artifact"], "artifact")
    if expected_artifact.get("bytes", 0) not in (0, len(artifact)) or expected_artifact.get("sha256", "") not in ("", sha256_bytes(artifact)):
        raise SnapshotError("artefatto divergente dal source lock")
    write_atomically(output_path, artifact)
    return len(artifact), sha256_bytes(artifact)


def check(lock: dict[str, object], output_path: Path) -> None:
    validate_lock(lock, allow_unbound_artifact=False)
    payload = output_path.read_bytes()
    expected = require_dict(require_dict(lock["integrity"], "integrity")["artifact"], "artifact")
    if len(payload) != expected["bytes"] or sha256_bytes(payload) != expected["sha256"]:
        raise SnapshotError("artefatto snapshot divergente da bytes/hash bloccati")
    try:
        snapshot = json.loads(payload.decode("utf-8"))
    except (UnicodeDecodeError, json.JSONDecodeError) as error:
        raise SnapshotError("artefatto JSON illeggibile") from error
    validate_snapshot(snapshot, lock)


def main() -> int:
    parser = argparse.ArgumentParser()
    parser.add_argument("--input", type=Path, help="CSV entity-level OpenBDAP input")
    parser.add_argument("--national-input", type=Path, help="Bounded JSON OData national input")
    parser.add_argument("--regional-input", type=Path, help="Bounded JSON OData regional input")
    parser.add_argument("--lock", type=Path, default=DEFAULT_LOCK)
    parser.add_argument("--output", type=Path, default=DEFAULT_OUTPUT)
    parser.add_argument("--generated-at", default="2026-08-21T00:00:00Z")
    parser.add_argument("--check", action="store_true")
    args = parser.parse_args()
    lock = load_lock(args.lock)
    if args.check:
        check(lock, args.output)
        print(f"OK {args.output}")
        return 0
    if not args.input or not args.national_input or not args.regional_input:
        parser.error("--input, --national-input e --regional-input sono obbligatori quando non si usa --check")
    size, digest = generate(lock, args.input, args.national_input, args.regional_input, args.generated_at, args.output)
    print(f"GENERATED bytes={size} sha256={digest}")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
