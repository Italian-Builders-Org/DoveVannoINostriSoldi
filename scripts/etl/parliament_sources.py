#!/usr/bin/env python3
"""Validate published parliamentary data and detect new official documents.

The public snapshot contains only normalized values. The source manifest also
tracks official Senate documents that are not safe to publish as structured
data yet. Online discovery never extracts or invents financial figures.
"""

from __future__ import annotations

import argparse
import csv
import hashlib
import html.parser
import http.cookiejar
import io
import json
import re
import socket
import sys
import urllib.error
import urllib.parse
import urllib.request
from dataclasses import dataclass
from datetime import date, datetime
from pathlib import Path
from typing import Any

ROOT = Path(__file__).resolve().parents[2]
SNAPSHOT_PATH = ROOT / "src/data/generated/parliament-overview.json"
MANIFEST_PATH = ROOT / "src/data/generated/parliament-source-manifest.json"
USER_AGENT = "DoveVannoINostriSoldi-ETL/1.0 (+https://github.com/Italian-Builders-Org/DoveVannoINostriSoldi)"
MAX_HTML_BYTES = 2_000_000
MAX_CSV_BYTES = 8_000_000
MAX_PDF_BYTES = 20_000_000
CAMERA_HOSTS = {"trasparenza.camera.it", "documenti.camera.it", "www.camera.it", "camera.it"}
SENATE_HOSTS = {"dati.senato.it", "www.senato.it", "senato.it"}
SOURCE_UNAVAILABLE_HTTP_CODES = {403, 408, 425, 429, 500, 502, 503, 504}
SENATE_DOCUMENT_TYPE = "Rendiconto delle entrate e delle spese e progetto di bilancio interno del Senato"


class StructuralError(RuntimeError):
    """The official source or committed data no longer matches its contract."""


class TemporarySourceError(RuntimeError):
    """The official source returned an incomplete response that can be retried."""


@dataclass(frozen=True, order=True)
class Document:
    kind: str
    year: int
    title: str
    document_url: str
    document_number: int | None = None
    presented_at: str | None = None
    record_url: str | None = None
    asset_sha256: str | None = None
    asset_bytes: int | None = None
    document_suffix: str | None = None

    def identity(self) -> tuple[Any, ...]:
        return (
            self.kind,
            self.year,
            self.document_number,
            self.document_suffix,
            self.title,
            self.presented_at,
            self.record_url,
            self.document_url,
        )


def load_json(path: Path) -> dict[str, Any]:
    try:
        value = json.loads(path.read_text(encoding="utf-8"))
    except (OSError, json.JSONDecodeError) as error:
        raise StructuralError(f"{path}: JSON non leggibile") from error
    if not isinstance(value, dict):
        raise StructuralError(f"{path}: oggetto JSON atteso")
    return value


def require_object(value: Any, field: str) -> dict[str, Any]:
    if not isinstance(value, dict):
        raise StructuralError(f"{field}: oggetto atteso")
    return value


def require_list(value: Any, field: str) -> list[Any]:
    if not isinstance(value, list):
        raise StructuralError(f"{field}: lista attesa")
    return value


def require_text(value: Any, field: str) -> str:
    if not isinstance(value, str) or not value.strip():
        raise StructuralError(f"{field}: testo non vuoto atteso")
    return value.strip()


def require_int(value: Any, field: str, minimum: int, maximum: int) -> int:
    if not isinstance(value, int) or isinstance(value, bool) or not minimum <= value <= maximum:
        raise StructuralError(f"{field}: intero tra {minimum} e {maximum} atteso")
    return value


def index_objects_by_id(value: Any, field: str) -> dict[str, dict[str, Any]]:
    indexed: dict[str, dict[str, Any]] = {}
    for index, raw_item in enumerate(require_list(value, field)):
        item_field = f"{field}[{index}]"
        item = require_object(raw_item, item_field)
        item_id = require_text(item.get("id"), f"{item_field}.id")
        if item_id in indexed:
            raise StructuralError(f"{field}: id duplicato {item_id}")
        indexed[item_id] = item
    return indexed


def official_url(value: Any, field: str, hosts: set[str]) -> str:
    raw = require_text(value, field)
    parsed = urllib.parse.urlparse(raw)
    if parsed.scheme != "https" or parsed.hostname not in hosts or parsed.username or parsed.password:
        raise StructuralError(f"{field}: URL HTTPS ufficiale atteso")
    return raw


def normalize_official_url(value: str, field: str, hosts: set[str]) -> str:
    raw = value.strip()
    parsed = urllib.parse.urlparse(raw)
    if parsed.scheme == "http" and parsed.hostname in hosts:
        raw = urllib.parse.urlunparse(parsed._replace(scheme="https"))
    return official_url(raw, field, hosts)


def parse_iso_date(value: Any, field: str) -> str:
    raw = require_text(value, field)
    try:
        date.fromisoformat(raw)
    except ValueError as error:
        raise StructuralError(f"{field}: data ISO non valida") from error
    return raw


def normalize_senate_suffix(value: Any, field: str) -> str | None:
    """Normalize the optional Senate number suffix without discarding it."""
    if value is None:
        raise TemporarySourceError(f"Senato CSV: campo mancante {field}")
    if not isinstance(value, str):
        raise StructuralError(f"{field}: testo atteso")
    suffix = " ".join(value.split())
    if not suffix:
        return None
    if len(suffix) > 64 or not suffix.isprintable():
        raise StructuralError(f"{field}: suffisso non valido")
    return suffix


def document_from_mapping(
    value: Any,
    field: str,
    chamber: str,
    *,
    require_asset: bool = False,
) -> Document:
    item = require_object(value, field)
    kind = require_text(item.get("kind"), f"{field}.kind")
    if kind not in {"account", "budget"}:
        raise StructuralError(f"{field}.kind: account o budget atteso")
    hosts = CAMERA_HOSTS if chamber == "camera" else SENATE_HOSTS
    number = item.get("documentNumber")
    asset_sha256: str | None = None
    asset_bytes: int | None = None
    if chamber == "camera" and require_asset:
        asset = require_object(item.get("asset"), f"{field}.asset")
        asset_sha256 = require_text(asset.get("sha256"), f"{field}.asset.sha256")
        if not re.fullmatch(r"[0-9a-f]{64}", asset_sha256):
            raise StructuralError(f"{field}.asset.sha256: SHA-256 minuscolo atteso")
        asset_bytes = require_int(asset.get("bytes"), f"{field}.asset.bytes", 1, MAX_PDF_BYTES)
        if kind == "account":
            evidence = require_list(item.get("evidence"), f"{field}.evidence")
            if not evidence:
                raise StructuralError(f"{field}.evidence: riferimenti al documento richiesti")
            for index, raw_evidence in enumerate(evidence):
                evidence_item = require_object(raw_evidence, f"{field}.evidence[{index}]")
                require_text(evidence_item.get("pages"), f"{field}.evidence[{index}].pages")
                require_text(evidence_item.get("scope"), f"{field}.evidence[{index}].scope")
    return Document(
        kind=kind,
        year=require_int(item.get("year"), f"{field}.year", 1948, 2200),
        title=require_text(item.get("title"), f"{field}.title"),
        document_url=official_url(item.get("documentUrl"), f"{field}.documentUrl", hosts),
        document_number=(
            None if number is None else require_int(number, f"{field}.documentNumber", 1, 10_000)
        ),
        presented_at=(
            None if item.get("presentedAt") is None else parse_iso_date(item.get("presentedAt"), f"{field}.presentedAt")
        ),
        record_url=(
            None if item.get("recordUrl") is None else official_url(item.get("recordUrl"), f"{field}.recordUrl", hosts)
        ),
        asset_sha256=asset_sha256,
        asset_bytes=asset_bytes,
    )


def validate_public_snapshot(snapshot: dict[str, Any]) -> None:
    if snapshot.get("schemaVersion") != 1 or snapshot.get("transformVersion") != 2:
        raise StructuralError("parliament-overview: versione 1 attesa")
    chambers = require_list(snapshot.get("chambers"), "parliament-overview.chambers")
    if not 1 <= len(chambers) <= 2:
        raise StructuralError("parliament-overview.chambers: uno o due rami attesi")
    seen: set[str] = set()
    for index, raw_chamber in enumerate(chambers):
        field = f"parliament-overview.chambers[{index}]"
        chamber = require_object(raw_chamber, field)
        chamber_id = require_text(chamber.get("id"), f"{field}.id")
        if chamber_id not in {"camera", "senato"} or chamber_id in seen:
            raise StructuralError(f"{field}.id non valido o duplicato")
        seen.add(chamber_id)
        if chamber.get("structuredStatus") != "structured-summary":
            raise StructuralError(f"{field}: una fonte soltanto documentale non è pubblicabile")
        statements = require_list(chamber.get("statements"), f"{field}.statements")
        if not statements:
            raise StructuralError(f"{field}.statements: lista non vuota attesa")
        for statement_index, raw_statement in enumerate(statements):
            statement_field = f"{field}.statements[{statement_index}]"
            statement = require_object(raw_statement, statement_field)
            document_from_mapping(statement, statement_field, chamber_id)
            if not any(
                isinstance(statement.get(key), (dict, list)) and len(statement[key]) > 0
                for key in ("values", "categories", "highlights")
            ):
                raise StructuralError(f"{statement_field}: valori strutturati mancanti")
            if chamber_id == "camera" and statement.get("kind") == "account" and statement.get("year") == 2025:
                categories_by_id = index_objects_by_id(
                    statement.get("categories"),
                    f"{statement_field}.categories",
                )
                pensions = require_object(categories_by_id.get("pensions"), f"{statement_field}.pensions")
                if pensions.get("label") != "Spese previdenziali":
                    raise StructuralError(f"{statement_field}.pensions: il Titolo III non è la sola voce vitalizi")
                if pensions.get("paid") != 418.22631632:
                    raise StructuralError(f"{statement_field}.pensions: pagamenti effettivi inattesi")
                components = index_objects_by_id(
                    pensions.get("components"),
                    f"{statement_field}.pensions.components",
                )
                component_values = {
                    component_id: component.get("paid")
                    for component_id, component in components.items()
                }
                if component_values != {
                    "former-deputies": 96.48449618,
                    "retired-staff": 321.74182014,
                }:
                    raise StructuralError(f"{statement_field}.pensions: Categorie XII e XIII inattese")
                caveat = require_text(pensions.get("caveat"), f"{statement_field}.pensions.caveat")
                if "non equivale ai soli vitalizi" not in caveat.lower():
                    raise StructuralError(f"{statement_field}.pensions: limite semantico mancante")
                employees = require_object(categories_by_id.get("employees"), f"{statement_field}.employees")
                if employees.get("paid") != 204.11385629:
                    raise StructuralError(f"{statement_field}.employees: pagamenti effettivi inattesi")


def validate_manifest(manifest: dict[str, Any], snapshot: dict[str, Any]) -> tuple[list[Document], list[Document], int]:
    if manifest.get("schemaVersion") != 1 or manifest.get("discoveryVersion") != 1:
        raise StructuralError("parliament-source-manifest: versione 1 attesa")
    snapshot_artifact = require_object(manifest.get("snapshotArtifact"), "manifest.snapshotArtifact")
    if snapshot_artifact.get("path") != "src/data/generated/parliament-overview.json":
        raise StructuralError("manifest.snapshotArtifact.path: percorso inatteso")
    expected_snapshot_bytes = require_int(
        snapshot_artifact.get("bytes"), "manifest.snapshotArtifact.bytes", 1, MAX_CSV_BYTES
    )
    expected_snapshot_sha256 = require_text(
        snapshot_artifact.get("sha256"), "manifest.snapshotArtifact.sha256"
    )
    if not re.fullmatch(r"[0-9a-f]{64}", expected_snapshot_sha256):
        raise StructuralError("manifest.snapshotArtifact.sha256: SHA-256 minuscolo atteso")
    snapshot_payload = SNAPSHOT_PATH.read_bytes()
    if (
        len(snapshot_payload) != expected_snapshot_bytes
        or hashlib.sha256(snapshot_payload).hexdigest() != expected_snapshot_sha256
    ):
        raise StructuralError("manifest.snapshotArtifact: snapshot pubblico non riconciliato")
    verified_at = require_text(manifest.get("verifiedAt"), "manifest.verifiedAt")
    try:
        datetime.fromisoformat(verified_at.replace("Z", "+00:00"))
    except ValueError as error:
        raise StructuralError("manifest.verifiedAt: timestamp non valido") from error

    camera = require_object(manifest.get("camera"), "manifest.camera")
    official_url(camera.get("landingUrl"), "manifest.camera.landingUrl", CAMERA_HOSTS)
    camera_docs = [
        document_from_mapping(
            item,
            f"manifest.camera.documents[{index}]",
            "camera",
            require_asset=True,
        )
        for index, item in enumerate(require_list(camera.get("documents"), "manifest.camera.documents"))
    ]
    if not camera_docs or len({item.identity() for item in camera_docs}) != len(camera_docs):
        raise StructuralError("manifest.camera.documents: documenti mancanti o duplicati")

    senate = require_object(manifest.get("senato"), "manifest.senato")
    official_url(senate.get("landingUrl"), "manifest.senato.landingUrl", SENATE_HOSTS)
    official_url(senate.get("registryUrl"), "manifest.senato.registryUrl", SENATE_HOSTS)
    require_int(senate.get("legislature"), "manifest.senato.legislature", 1, 100)
    if senate.get("documentSeries") != "VIII":
        raise StructuralError("manifest.senato.documentSeries: VIII atteso")
    known_max = require_int(senate.get("knownMaxDocumentNumber"), "manifest.senato.knownMaxDocumentNumber", 1, 10_000)
    senate_docs: list[Document] = []
    for index, item in enumerate(require_list(senate.get("latestDocuments"), "manifest.senato.latestDocuments")):
        field = f"manifest.senato.latestDocuments[{index}]"
        record = require_object(item, field)
        if record.get("publicationStatus") != "metadata-only":
            raise StructuralError(f"{field}.publicationStatus: metadata-only atteso")
        document = document_from_mapping(record, field, "senato")
        if document.document_number is None or document.presented_at is None or document.record_url is None:
            raise StructuralError(f"{field}: provenienza Senato incompleta")
        senate_docs.append(document)
    if {item.kind for item in senate_docs} != {"account", "budget"}:
        raise StructuralError("manifest.senato.latestDocuments: ultimo rendiconto e ultimo bilancio attesi")
    if max(item.document_number or 0 for item in senate_docs) != known_max:
        raise StructuralError("manifest.senato: numero massimo incoerente")

    public_camera = next(
        (item for item in require_list(snapshot.get("chambers"), "snapshot.chambers") if item.get("id") == "camera"),
        None,
    )
    if public_camera is not None:
        public_docs = {
            (item.get("kind"), item.get("year"), item.get("documentUrl"))
            for item in require_list(public_camera.get("statements"), "snapshot.camera.statements")
        }
        manifest_docs = {(item.kind, item.year, item.document_url) for item in camera_docs}
        if not public_docs <= manifest_docs:
            raise StructuralError("snapshot Camera: documento non presente nel manifesto delle fonti")
    if any(item.get("id") == "senato" for item in snapshot.get("chambers", [])):
        raise StructuralError("snapshot Senato: i documenti metadata-only non devono essere pubblicati")
    return camera_docs, senate_docs, known_max


class CameraLinkParser(html.parser.HTMLParser):
    def __init__(self) -> None:
        super().__init__(convert_charrefs=True)
        self._href: str | None = None
        self._title: str | None = None
        self._text: list[str] = []
        self.links: list[tuple[str, str]] = []

    def handle_starttag(self, tag: str, attrs: list[tuple[str, str | None]]) -> None:
        if tag.lower() != "a":
            return
        values = dict(attrs)
        self._href = values.get("href")
        self._title = values.get("title")
        self._text = []

    def handle_data(self, data: str) -> None:
        if self._href is not None:
            self._text.append(data)

    def handle_endtag(self, tag: str) -> None:
        if tag.lower() != "a" or self._href is None:
            return
        label = self._title or " ".join(self._text)
        label = " ".join(label.replace("\xa0", " ").split())
        self.links.append((label, self._href))
        self._href = None
        self._title = None
        self._text = []


def parse_camera_documents(payload: str) -> list[Document]:
    parser = CameraLinkParser()
    parser.feed(payload)
    found: list[Document] = []
    for title, raw_url in parser.links:
        account = re.fullmatch(r"Conto Consuntivo (\d{4})", title, flags=re.IGNORECASE)
        budget = re.fullmatch(r"Bilancio (\d{4})(?: e bilancio pluriennale \d{4}-\d{4})?", title, flags=re.IGNORECASE)
        if not account and not budget:
            continue
        url = normalize_official_url(raw_url, "Camera.documentUrl", CAMERA_HOSTS)
        kind = "account" if account else "budget"
        year = int((account or budget).group(1))
        found.append(Document(kind=kind, year=year, title=title, document_url=url))
    if not found or len({item.identity() for item in found}) != len(found):
        raise StructuralError("Camera: documenti principali mancanti o duplicati")
    return sorted(found)


def parse_senate_documents(payload: str, series: str = "VIII") -> list[Document]:
    reader = csv.DictReader(io.StringIO(payload))
    required = {
        "documento", "legislatura", "tipoDoc", "numeroDoc", "numeroRomano",
        "suffissoNumeroDoc", "titolo", "dataPresentazione", "URLTesto",
    }
    if reader.fieldnames is None or not required <= set(reader.fieldnames):
        raise StructuralError(f"Senato CSV: colonne mancanti {sorted(required - set(reader.fieldnames or []))}")
    documents_by_identity: dict[tuple[Any, ...], Document] = {}
    for row in reader:
        if row["numeroRomano"].strip() != series or row["tipoDoc"].strip() != SENATE_DOCUMENT_TYPE:
            continue
        indispensable = ("documento", "numeroDoc", "titolo", "dataPresentazione", "URLTesto")
        missing = [
            field
            for field in indispensable
            if not isinstance(row.get(field), str) or not row[field].strip()
        ]
        if missing:
            record = row.get("documento") or "record senza URL"
            raise TemporarySourceError(
                "Senato CSV: risposta temporaneamente incompleta "
                f"per {record!r}; campi mancanti: {', '.join(missing)}"
            )
        title = " ".join(row["titolo"].split())
        account = re.fullmatch(
            r"Rendiconto delle entrate e delle spese del Senato per l'anno finanziario (\d{4})",
            title,
            flags=re.IGNORECASE,
        )
        budget = re.fullmatch(
            r"Progetto di bilancio interno del Senato per l'anno finanziario (\d{4})",
            title,
            flags=re.IGNORECASE,
        )
        if not account and not budget:
            raise StructuralError(f"Senato CSV: titolo del Doc. {series} non riconosciuto: {title}")
        raw_number = row["numeroDoc"].strip()
        try:
            number = int(raw_number)
        except ValueError as error:
            raise StructuralError(
                "Senato CSV: numero documento non valido "
                f"per {row['documento']!r}: {raw_number!r}"
            ) from error
        kind = "account" if account else "budget"
        year = int((account or budget).group(1))
        record_url = normalize_official_url(row["documento"], "Senato.recordUrl", SENATE_HOSTS)
        document_url = normalize_official_url(row["URLTesto"], "Senato.documentUrl", SENATE_HOSTS)
        presented_at = parse_iso_date(row["dataPresentazione"], "Senato.dataPresentazione")
        suffix = normalize_senate_suffix(row.get("suffissoNumeroDoc"), "Senato.suffissoNumeroDoc")
        document = Document(
            kind,
            year,
            title,
            document_url,
            number,
            presented_at,
            record_url,
            document_suffix=suffix,
        )
        # Exact duplicate rows are harmless; variants by URL, date or suffix
        # remain distinct so the caller can fail closed against the manifest.
        documents_by_identity.setdefault(document.identity(), document)
    if not documents_by_identity:
        raise StructuralError(f"Senato CSV: nessun documento della serie {series}")
    return sorted(
        documents_by_identity.values(),
        key=lambda item: (
            item.document_number or 0,
            item.document_suffix or "",
            item.presented_at or "",
            item.document_url,
        ),
    )


def limited_read(response: Any, maximum: int, field: str) -> bytes:
    content_length = response.headers.get("Content-Length")
    if content_length and int(content_length) > maximum:
        raise StructuralError(f"{field}: risposta troppo grande")
    payload = response.read(maximum + 1)
    if len(payload) > maximum:
        raise StructuralError(f"{field}: risposta troppo grande")
    return payload


def open_official(opener: Any, request: urllib.request.Request, hosts: set[str], timeout: int):
    response = opener.open(request, timeout=timeout)
    official_url(response.geturl(), "risposta finale", hosts)
    return response


def download_camera(landing_url: str, timeout: int) -> list[Document]:
    request = urllib.request.Request(landing_url, headers={"User-Agent": USER_AGENT, "Accept": "text/html"})
    with open_official(urllib.request.build_opener(), request, CAMERA_HOSTS, timeout) as response:
        content_type = response.headers.get("Content-Type", "").split(";", 1)[0].lower()
        if content_type not in {"text/html", "application/xhtml+xml"}:
            raise StructuralError(f"Camera: HTML atteso, ricevuto {content_type or 'nessun Content-Type'}")
        payload = limited_read(response, MAX_HTML_BYTES, "Camera").decode("utf-8")
    return parse_camera_documents(payload)


def verify_camera_asset(document: Document, timeout: int) -> None:
    if document.asset_sha256 is None or document.asset_bytes is None:
        raise StructuralError(f"Camera {document.year}: lock del PDF mancante")
    request = urllib.request.Request(
        document.document_url,
        headers={"User-Agent": USER_AGENT, "Accept": "application/pdf"},
    )
    with open_official(urllib.request.build_opener(), request, CAMERA_HOSTS, timeout) as response:
        content_type = response.headers.get("Content-Type", "").split(";", 1)[0].lower()
        if content_type != "application/pdf":
            raise StructuralError(
                f"Camera {document.year}: PDF atteso, ricevuto {content_type or 'nessun Content-Type'}"
            )
        payload = limited_read(response, MAX_PDF_BYTES, f"Camera PDF {document.year}")
    observed_sha256 = hashlib.sha256(payload).hexdigest()
    if len(payload) != document.asset_bytes or observed_sha256 != document.asset_sha256:
        raise StructuralError(
            f"Camera {document.year}: PDF ufficiale modificato "
            f"(bytes={len(payload)}, sha256={observed_sha256})"
        )


class SenateFormParser(html.parser.HTMLParser):
    def __init__(self) -> None:
        super().__init__(convert_charrefs=True)
        self.in_target = False
        self.values: dict[str, str] = {}

    def handle_starttag(self, tag: str, attrs: list[tuple[str, str | None]]) -> None:
        values = dict(attrs)
        if tag.lower() == "form" and values.get("id") == "41":
            self.in_target = True
        elif self.in_target and tag.lower() == "input" and values.get("name") and values.get("value") is not None:
            self.values[values["name"]] = values["value"] or ""

    def handle_endtag(self, tag: str) -> None:
        if tag.lower() == "form" and self.in_target:
            self.in_target = False


def download_senate(registry_url: str, legislature: int, timeout: int) -> list[Document]:
    cookie_jar = http.cookiejar.CookieJar()
    opener = urllib.request.build_opener(urllib.request.HTTPCookieProcessor(cookie_jar))
    page_request = urllib.request.Request(registry_url, headers={"User-Agent": USER_AGENT, "Accept": "text/html"})
    with open_official(opener, page_request, SENATE_HOSTS, timeout) as response:
        content_type = response.headers.get("Content-Type", "").split(";", 1)[0].lower()
        if content_type not in {"text/html", "application/xhtml+xml"}:
            raise StructuralError("Senato: pagina HTML del registro attesa")
        page = limited_read(response, MAX_HTML_BYTES, "Senato registro").decode("utf-8")
    form = SenateFormParser()
    form.feed(page)
    token = form.values.get("authenticity_token")
    if not token or form.values.get("alias") != "elenco-documenti-date" or form.values.get("id") != "41":
        raise StructuralError("Senato: form ufficiale dei documenti non trovato")
    today = date.today().isoformat()
    parameters = {
        "authenticity_token": token,
        "alias": "elenco-documenti-date",
        "id": "41",
        "legislatura": str(legislature),
        "active_tab[active_tab_88]": "356",
        "search[legislatura]": str(legislature),
        "search[dataInizio]": "2022-10-13",
        "search[dataFine]": today,
        "query_format": "csv",
        "commit": "Download",
    }
    endpoint = urllib.parse.urljoin(registry_url, "/DatiSenato/virtuoso_bridge/query/execute")
    post_request = urllib.request.Request(
        endpoint,
        data=urllib.parse.urlencode(parameters).encode("ascii"),
        headers={"User-Agent": USER_AGENT, "Accept": "text/csv", "Content-Type": "application/x-www-form-urlencoded"},
        method="POST",
    )
    with open_official(opener, post_request, SENATE_HOSTS, timeout) as response:
        content_type = response.headers.get("Content-Type", "").split(";", 1)[0].lower()
        if content_type not in {"text/csv", "application/csv"}:
            raise StructuralError(f"Senato: CSV atteso, ricevuto {content_type or 'nessun Content-Type'}")
        payload = limited_read(response, MAX_CSV_BYTES, "Senato CSV").decode("utf-8-sig")
    return parse_senate_documents(payload)


def compare_documents(label: str, expected: list[Document], actual: list[Document]) -> None:
    expected_set = {item.identity() for item in expected}
    actual_set = {item.identity() for item in actual}
    if expected_set == actual_set:
        return
    def sort_identity(identity: tuple[Any, ...]) -> tuple[str, ...]:
        return tuple("" if value is None else str(value) for value in identity)

    added = sorted(actual_set - expected_set, key=sort_identity)
    removed = sorted(expected_set - actual_set, key=sort_identity)
    details = []
    if added:
        details.append(f"nuovi={added}")
    if removed:
        details.append(f"mancanti_o_modificati={removed}")
    raise StructuralError(f"{label}: il registro ufficiale è cambiato; revisione necessaria ({'; '.join(details)})")


def online_check(manifest: dict[str, Any], expected_camera: list[Document], expected_senate: list[Document], known_max: int, timeout: int) -> None:
    camera = require_object(manifest["camera"], "manifest.camera")
    actual_camera = download_camera(camera["landingUrl"], timeout)
    compare_documents("Camera", expected_camera, actual_camera)
    for document in expected_camera:
        verify_camera_asset(document, timeout)

    senate = require_object(manifest["senato"], "manifest.senato")
    actual_senate = download_senate(senate["registryUrl"], senate["legislature"], timeout)
    latest_number = max(item.document_number or 0 for item in actual_senate)
    if latest_number > known_max:
        new_documents = [item.identity() for item in actual_senate if (item.document_number or 0) > known_max]
        raise StructuralError(f"Senato: nuovi documenti ufficiali da verificare: {new_documents}")
    expected_numbers = {item.document_number for item in expected_senate}
    actual_latest = [item for item in actual_senate if item.document_number in expected_numbers]
    compare_documents("Senato", expected_senate, actual_latest)


def parse_args() -> argparse.Namespace:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--check", action="store_true", help="validate committed files without network access")
    parser.add_argument("--timeout", type=int, default=45, help="network timeout in seconds")
    return parser.parse_args()


def main() -> int:
    args = parse_args()
    try:
        snapshot = load_json(SNAPSHOT_PATH)
        manifest = load_json(MANIFEST_PATH)
        validate_public_snapshot(snapshot)
        camera_docs, senate_docs, known_max = validate_manifest(manifest, snapshot)
        if not args.check:
            online_check(manifest, camera_docs, senate_docs, known_max, args.timeout)
    except TemporarySourceError as error:
        print(f"fonte ufficiale temporaneamente incompleta: {error}", file=sys.stderr)
        return 2
    except StructuralError as error:
        print(f"errore strutturale: {error}", file=sys.stderr)
        return 1
    except urllib.error.HTTPError as error:
        if error.code not in SOURCE_UNAVAILABLE_HTTP_CODES:
            print(f"errore permanente dalla fonte ufficiale: HTTP {error.code}", file=sys.stderr)
            return 1
        print(f"fonte ufficiale temporaneamente non raggiungibile: {error}", file=sys.stderr)
        return 2
    except (urllib.error.URLError, TimeoutError, socket.timeout) as error:
        print(f"fonte ufficiale temporaneamente non raggiungibile: {error}", file=sys.stderr)
        return 2
    print(
        "Parlamento: snapshot pubblico strutturato valido; "
        f"{len(camera_docs)} documenti Camera e {len(senate_docs)} metadati Senato verificati"
    )
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
