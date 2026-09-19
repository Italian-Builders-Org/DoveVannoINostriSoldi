#!/usr/bin/env python3
"""Government in office: appointments, departments and people.

The authoritative structure comes from the Camera dei deputati open data (OCD):
it publishes every current government appointment with its role, department and
the stable `persona` identity that also links deputies and senators. The public
roster on governo.it adds the institutional page of each member. Offline --check
validates the committed artifact; --write fails closed on unknown roles, missing
departments or coverage below floor.
"""

from __future__ import annotations

import argparse
import hashlib
import json
import re
import ssl
import time
import unicodedata
import urllib.error
import urllib.parse
import urllib.request
from collections import Counter, defaultdict
from datetime import datetime, timezone
from html.parser import HTMLParser
from pathlib import Path
from typing import Any

ROOT = Path(__file__).resolve().parents[2]
SPEC = ROOT / "scripts/etl/specs/governo-meloni.source.json"
OUTPUT = ROOT / "src/data/generated/governo-meloni.json"
DATASET = "governo-meloni"
ENDPOINT = "https://dati.camera.it/sparql"
LANDING = "https://dati.camera.it/"
ROSTER_URL = "https://www.governo.it/it/ministri-e-sottosegretari"
LICENSE_URL = "https://creativecommons.org/licenses/by/4.0/"
LEGISLATURE_URI = "http://dati.camera.it/ocd/legislatura.rdf/repubblica_19"
MEMBER_URL_RE = re.compile(r"^https://www\.governo\.it/it/governo/meloni/([a-z-]+)/([a-z0-9-]+)$")
GOVERNMENT_RE = re.compile(r"/governo\.rdf/(g\d+)$")
ORGAN_RE = re.compile(r"/organoGoverno\.rdf/(og\d+_\d+)$")
PERSON_RE = re.compile(r"/persona\.rdf/p(\d+)$")
SHA_RE = re.compile(r"^[0-9a-f]{64}$")
DATE_RE = re.compile(r"^\d{4}-\d{2}-\d{2}$")
USER_AGENT = "DoveVannoINostriSoldi-ETL/1.0 (+https://github.com/Italian-Builders-Org/DoveVannoINostriSoldi)"

ROLES = {
    "PRESIDENTE DEL CONSIGLIO": ("presidente-del-consiglio", "Presidente del Consiglio dei ministri"),
    "VICEPRESIDENTE DEL CONSIGLIO": ("vice-presidente", "Vicepresidente del Consiglio dei ministri"),
    "MINISTRO": ("ministro", "Ministro"),
    "MINISTRO SENZA PORTAFOGLIO": ("ministro-senza-portafoglio", "Ministro senza portafoglio"),
    "VICE MINISTRO": ("vice-ministro", "Vice ministro"),
    "SOTTOSEGRETARIO DI STATO": ("sottosegretario", "Sottosegretario di Stato"),
}
ROLE_RANK = {kind: index for index, (kind, _) in enumerate(ROLES.values())}

MEMBERS_QUERY = """
PREFIX ocd: <http://dati.camera.it/ocd/>
PREFIX rdfs: <http://www.w3.org/2000/01/rdf-schema#>
PREFIX foaf: <http://xmlns.com/foaf/0.1/>

SELECT DISTINCT ?governo ?governoLabel ?membro ?ruolo ?nome ?cognome ?persona ?organo ?organoLabel ?inizio ?interim
WHERE {
  ?governo a ocd:governo ;
           ocd:rif_leg <http://dati.camera.it/ocd/legislatura.rdf/repubblica_19> ;
           rdfs:label ?governoLabel ;
           ocd:rif_membroGoverno ?membro .
  ?membro ocd:membroGoverno ?ruolo ;
          foaf:firstName ?nome ;
          foaf:surname ?cognome ;
          ocd:rif_persona ?persona ;
          ocd:rif_organoGoverno ?organo ;
          ocd:startDate ?inizio .
  ?organo rdfs:label ?organoLabel .
  OPTIONAL { ?membro ocd:interim ?interim }
  FILTER NOT EXISTS { ?membro ocd:endDate ?fine }
}
ORDER BY ?cognome ?nome ?ruolo
""".strip()

# Portraits and study/profession notes live on the `persona` resource shared with
# the parliamentary mandates: the most recent Camera legislature tells us which
# archive of official portraits contains the picture of that person.
IDENTITIES_QUERY = """
PREFIX ocd: <http://dati.camera.it/ocd/>
PREFIX dc: <http://purl.org/dc/elements/1.1/>
PREFIX xsd: <http://www.w3.org/2001/XMLSchema#>

SELECT ?persona ?descrizione (MAX(?legNum) AS ?ultimaLegislatura)
WHERE {
  ?governo a ocd:governo ;
           ocd:rif_leg <http://dati.camera.it/ocd/legislatura.rdf/repubblica_19> ;
           ocd:rif_membroGoverno ?membro .
  ?membro ocd:rif_persona ?persona .
  FILTER NOT EXISTS { ?membro ocd:endDate ?fine }
  OPTIONAL { ?persona dc:description ?descrizione }
  OPTIONAL {
    ?persona ocd:rif_mandatoCamera ?mandato .
    ?mandato ocd:rif_leg ?legislatura .
    BIND(xsd:integer(REPLACE(STR(?legislatura), "^.*repubblica_", "")) AS ?legNum)
  }
}
GROUP BY ?persona ?descrizione
""".strip()

PHOTO_TEMPLATE = "https://documenti.camera.it/_dati/leg{legislature}/schededeputatinuovosito/fotoDefinitivo/big/d{persona}.jpg"
PHOTO_RE = re.compile(
    r"^https://documenti\.camera\.it/_dati/leg(1[3-9])/schededeputatinuovosito/fotoDefinitivo/big/d\d+\.jpg$"
)


class SnapshotError(ValueError):
    """Official payload or committed artifact failed validation."""


def require(condition: bool, message: str) -> None:
    if not condition:
        raise SnapshotError(message)


def sha256_bytes(raw: bytes) -> str:
    return hashlib.sha256(raw).hexdigest()


def load_spec(path: Path = SPEC) -> dict[str, Any]:
    spec = json.loads(path.read_text(encoding="utf-8"))
    require(spec.get("datasetId") == DATASET, "dataset identity differs")
    source = spec.get("source") or {}
    require(source.get("endpointUrl") == ENDPOINT, "endpoint diverge")
    require(source.get("rosterUrl") == ROSTER_URL, "roster URL diverge")
    require(source.get("licenseUrl") == LICENSE_URL, "license URL diverge")
    require(source.get("legislatureUri") == LEGISLATURE_URI, "legislature diverge")
    return spec


def slugify(value: str) -> str:
    folded = unicodedata.normalize("NFKD", value).encode("ascii", "ignore").decode("ascii")
    return re.sub(r"-+", "-", re.sub(r"[^a-z0-9]+", "-", folded.casefold())).strip("-")


def title_case_name(value: str) -> str:
    def fix(token: str) -> str:
        return re.sub(r"(^|['’\-])([a-zà-ü])", lambda m: m.group(1) + m.group(2).upper(), token.casefold())

    return " ".join(fix(part) for part in value.strip().split())


def value_of(row: dict[str, Any], key: str) -> str | None:
    cell = row.get(key)
    if not isinstance(cell, dict):
        return None
    raw = cell.get("value")
    return raw.strip() if isinstance(raw, str) and raw.strip() else None


def parse_uri(uri: str, pattern: re.Pattern[str], kind: str) -> str:
    match = pattern.search(uri)
    require(match is not None, f"{kind} URI non riconosciuto: {uri}")
    assert match is not None
    return match.group(1)


def compact_date(value: str) -> str:
    require(bool(re.fullmatch(r"\d{8}", value)), f"data OCD inattesa: {value!r}")
    return f"{value[0:4]}-{value[4:6]}-{value[6:8]}"


ACCENTED_ENDINGS = {"A'": "À", "I'": "Ì", "O'": "Ò", "U'": "Ù"}
PROPER_NOUNS = {"pnrr": "PNRR", "made in italy": "Made in Italy", "parlamento": "Parlamento"}
MONTHS_IT = (
    "gennaio", "febbraio", "marzo", "aprile", "maggio", "giugno",
    "luglio", "agosto", "settembre", "ottobre", "novembre", "dicembre",
)


def italian_long_date(iso: str) -> str:
    year, month, day = (int(part) for part in iso.split("-"))
    return f"{day} {MONTHS_IT[month - 1]} {year}"


def humanize_institution(label: str) -> str:
    """Official labels are uppercase: restore sentence case, accents and proper nouns."""
    text = " ".join(label.split())
    for ending, accented in ACCENTED_ENDINGS.items():
        text = re.sub(rf"{re.escape(ending)}(?=\s|$|,)", accented, text)
    text = text.casefold()
    for needle, replacement in PROPER_NOUNS.items():
        text = re.sub(rf"\b{re.escape(needle)}\b", replacement, text)
    return text[:1].upper() + text[1:]


def classify_department(label: str) -> tuple[str, str]:
    upper = label.upper()
    if upper.startswith("PRESIDENZA DEL CONSIGLIO"):
        return "presidenza", "Presidenza del Consiglio dei ministri"
    if upper.startswith("MINISTERO"):
        return "ministero", humanize_institution(label)
    return "delega", humanize_institution(label)


# --------------------------------------------------------------------------- #
# governo.it roster (institutional pages of the members)
# --------------------------------------------------------------------------- #


class RosterParser(HTMLParser):
    """Collect the person links of the official roster in document order."""

    CAPTION_TAGS = {"h3", "h4", "p"}

    def __init__(self) -> None:
        super().__init__(convert_charrefs=True)
        self.people: list[tuple[str, str]] = []
        self._capture: str | None = None
        self._buffer: list[str] = []
        self._href: str | None = None

    def handle_starttag(self, tag: str, attrs: list[tuple[str, str | None]]) -> None:
        values = {key: (value or "") for key, value in attrs}
        if tag in self.CAPTION_TAGS:
            self._capture = tag
            self._buffer = []
            self._href = None
        elif tag == "a" and self._capture and not self._href:
            self._href = values.get("href", "")

    def handle_endtag(self, tag: str) -> None:
        if tag != self._capture:
            return
        text = re.sub(r"\s+", " ", "".join(self._buffer)).strip()
        if text and self._href and MEMBER_URL_RE.match(self._href.strip()):
            self.people.append((text, self._href.strip()))
        self._capture = None
        self._buffer = []
        self._href = None

    def handle_data(self, data: str) -> None:
        if self._capture:
            self._buffer.append(data)


def parse_roster_pages(html: str) -> dict[str, str]:
    """Map the slug of every member published on governo.it to their page."""
    parser = RosterParser()
    parser.feed(html)
    require(len(parser.people) >= 50, f"roster governo.it troppo corto: {len(parser.people)}")
    pages: dict[str, str] = {}
    for name, url in parser.people:
        match = MEMBER_URL_RE.match(url)
        assert match is not None
        pages.setdefault(slugify(name), url)
        pages.setdefault(re.sub(r"-\d+$", "", match.group(2)), url)
    return pages


def parse_identities(payload: dict[str, Any]) -> dict[str, dict[str, Any]]:
    """Map every persona to its most recent Camera legislature and study note."""
    identities: dict[str, dict[str, Any]] = {}
    for row in (payload.get("results") or {}).get("bindings") or []:
        persona_uri = value_of(row, "persona")
        require(persona_uri is not None, "identita senza persona")
        assert persona_uri is not None
        persona_id = parse_uri(persona_uri, PERSON_RE, "persona")
        legislature = value_of(row, "ultimaLegislatura")
        note = value_of(row, "descrizione")
        entry = identities.setdefault(persona_id, {"legislature": None, "professionNote": None})
        if legislature and legislature.isdigit():
            number = int(legislature)
            require(13 <= number <= 19, f"legislatura di mandato fuori intervallo: {number}")
            entry["legislature"] = max(number, entry["legislature"] or 0)
        if note:
            entry["professionNote"] = re.sub(r"\s+", " ", note).strip().rstrip(".;")
    return identities


def official_photo_url(persona_id: str, legislature: int | None) -> str | None:
    """Only publish a portrait we can actually see in the official archive."""
    if legislature is None:
        return None
    url = PHOTO_TEMPLATE.format(legislature=legislature, persona=persona_id)
    require(bool(PHOTO_RE.match(url)), f"URL ritratto fuori schema: {url}")
    return url if photo_exists(url) else None


def match_official_page(display_name: str, pages: dict[str, str]) -> str | None:
    """governo.it may publish a longer legal name: accept a unique prefix match."""
    slug = slugify(display_name)
    if slug in pages:
        return pages[slug]
    candidates = sorted({url for key, url in pages.items() if key.startswith(f"{slug}-")})
    return candidates[0] if len(candidates) == 1 else None


# --------------------------------------------------------------------------- #
# Snapshot assembly
# --------------------------------------------------------------------------- #


def build_snapshot(
    payload: dict[str, Any],
    raw: bytes,
    roster_html: str,
    roster_raw: bytes,
    identities_payload: dict[str, Any],
    identities_raw: bytes,
) -> dict[str, Any]:
    rows = (payload.get("results") or {}).get("bindings") or []
    require(len(rows) >= 50, f"incarichi di governo insufficienti: {len(rows)}")

    governments = {
        (value_of(row, "governo") or "", value_of(row, "governoLabel") or "")
        for row in rows
    }
    require(len(governments) == 1, f"governi ambigui nella legislatura XIX: {sorted(governments)}")
    government_uri, government_label = next(iter(governments))
    government_id = parse_uri(government_uri, GOVERNMENT_RE, "governo")

    pages = parse_roster_pages(roster_html)
    identities = parse_identities(identities_payload)

    departments: dict[str, dict[str, Any]] = {}
    appointments: list[dict[str, Any]] = []
    people: dict[str, dict[str, Any]] = {}
    seen: set[str] = set()

    for row in rows:
        role_raw = value_of(row, "ruolo")
        require(role_raw is not None, "incarico senza ruolo")
        assert role_raw is not None
        role = " ".join(role_raw.split()).upper()
        require(role in ROLES, f"ruolo di governo inatteso: {role!r}")
        role_kind, role_label = ROLES[role]

        organ_uri = value_of(row, "organo")
        organ_label = value_of(row, "organoLabel")
        person_uri = value_of(row, "persona")
        first = value_of(row, "nome")
        last = value_of(row, "cognome")
        member_uri = value_of(row, "membro")
        since_raw = value_of(row, "inizio")
        require(
            None not in (organ_uri, organ_label, person_uri, first, last, member_uri, since_raw),
            f"incarico incompleto: {member_uri}",
        )
        assert organ_uri and organ_label and person_uri and first and last and member_uri and since_raw

        department_id = parse_uri(organ_uri, ORGAN_RE, "organoGoverno")
        kind, display = classify_department(" ".join(organ_label.split()))
        departments.setdefault(department_id, {
            "id": department_id,
            "uri": organ_uri,
            "label": " ".join(organ_label.split()),
            "displayLabel": display,
            "kind": kind,
        })

        person_id = parse_uri(person_uri, PERSON_RE, "persona")
        display_name = f"{title_case_name(first)} {title_case_name(last)}"
        appointment_id = member_uri.rsplit("/", 1)[-1]
        require(appointment_id not in seen, f"incarico duplicato: {appointment_id}")
        seen.add(appointment_id)

        appointment = {
            "id": appointment_id,
            "uri": member_uri,
            "personaId": person_id,
            "personName": display_name,
            "role": role,
            "roleKind": role_kind,
            "roleLabel": role_label,
            "departmentId": department_id,
            "since": compact_date(since_raw),
            "interim": (value_of(row, "interim") or "0") == "1",
        }
        appointments.append(appointment)

        if person_id not in people:
            identity = identities.get(person_id) or {"legislature": None, "professionNote": None}
            people[person_id] = {
                "personaId": person_id,
                "uri": person_uri,
                "firstName": title_case_name(first),
                "lastName": title_case_name(last),
                "displayName": display_name,
                "appointmentIds": [],
                "officialPage": match_official_page(display_name, pages),
                "cameraLegislature": identity["legislature"],
                "photoUrl": official_photo_url(person_id, identity["legislature"]),
                "professionNote": identity["professionNote"],
            }
        person = people[person_id]
        person["appointmentIds"].append(appointment_id)

    appointments.sort(key=lambda item: (ROLE_RANK[item["roleKind"]], item["personName"], item["id"]))
    by_id = {item["id"]: item for item in appointments}

    for person in people.values():
        person["appointmentIds"] = sorted(
            person["appointmentIds"],
            key=lambda item: (ROLE_RANK[by_id[item]["roleKind"]], by_id[item]["since"]),
        )
        primary = by_id[person["appointmentIds"][0]]
        person["primaryRoleKind"] = primary["roleKind"]
        person["primaryRoleLabel"] = primary["roleLabel"]
        person["primaryDepartmentId"] = primary["departmentId"]
        person["since"] = min(by_id[item]["since"] for item in person["appointmentIds"])
        person["biography"] = build_biography(person, by_id, departments)

    for department in departments.values():
        department["memberCount"] = sum(1 for item in appointments if item["departmentId"] == department["id"])

    role_counts = Counter(item["roleKind"] for item in appointments)
    snapshot = {
        "schemaVersion": 2,
        "government": {
            "id": government_id,
            "uri": government_uri,
            "label": re.sub(r"\s*\(.*\)$", "", government_label).strip(),
            "startDate": min(item["since"] for item in appointments if item["roleKind"] == "presidente-del-consiglio"),
            "legislatureUri": LEGISLATURE_URI,
            "landingUrl": ROSTER_URL,
        },
        "coverage": {
            "appointments": len(appointments),
            "people": len(people),
            "departments": len(departments),
            "ministries": sum(1 for item in departments.values() if item["kind"] == "ministero"),
            "ministers": role_counts["ministro"] + role_counts["ministro-senza-portafoglio"],
            "viceMinisters": role_counts["vice-ministro"],
            "undersecretaries": role_counts["sottosegretario"],
            "peopleWithOfficialPage": sum(1 for item in people.values() if item["officialPage"]),
            "peopleWithPhoto": sum(1 for item in people.values() if item["photoUrl"]),
            "peopleWithProfessionNote": sum(1 for item in people.values() if item["professionNote"]),
        },
        "source": {
            "owner": "Camera dei deputati (struttura) e Presidenza del Consiglio dei ministri (schede)",
            "title": "Open Data Camera — incarichi di governo in corso; governo.it — elenco ministri e sottosegretari",
            "endpointUrl": ENDPOINT,
            "landingUrl": LANDING,
            "rosterUrl": ROSTER_URL,
            "legislatureUri": LEGISLATURE_URI,
            "license": "CC BY 4.0 (dati.camera.it); riuso con citazione della fonte (governo.it)",
            "licenseUrl": LICENSE_URL,
            "acquiredAt": datetime.now(timezone.utc).replace(microsecond=0).isoformat(),
            "responses": {
                "members": {"bytes": len(raw), "sha256": sha256_bytes(raw)},
                "identities": {"bytes": len(identities_raw), "sha256": sha256_bytes(identities_raw)},
                "roster": {"bytes": len(roster_raw), "sha256": sha256_bytes(roster_raw)},
            },
            "cadence": "continuo / aggiornamento RDF Camera a ogni decreto di nomina",
        },
        "caveats": [
            "Sono esposti solo gli incarichi senza data di fine: i componenti cessati non compaiono.",
            "Chi cumula due incarichi compare una volta come persona con più incarichi, ordinati per rango istituzionale.",
            "I ministri senza portafoglio sono ricondotti alla delega dichiarata dalla fonte, non a un ministero con bilancio.",
            "L'identità persona è quella pubblicata dalla Camera: consente di collegare gli incarichi ai mandati parlamentari senza confronti sui nomi.",
            "Le schede su governo.it non coprono tutti i componenti: quando mancano, il collegamento resta vuoto invece di essere dedotto.",
            "Il ritratto proviene dall'archivio Camera della legislatura del mandato parlamentare più recente ed è verificato una richiesta alla volta: chi non è mai stato deputato resta senza fotografia ufficiale invece di riceverne una non verificabile.",
            "La nota di studi e professione è il testo pubblicato dalla Camera sulla persona: la fonte lo tronca a ottanta caratteri e non viene integrato.",
            "Nessun importo in questo snapshot: per la spesa dei ministeri usare /governi e le viste RGS.",
        ],
        "departments": sorted(departments.values(), key=lambda item: (item["kind"] != "presidenza", item["displayLabel"])),
        "appointments": appointments,
        "people": sorted(people.values(), key=lambda item: (ROLE_RANK[item["primaryRoleKind"]], item["lastName"], item["firstName"])),
    }
    validate_snapshot(snapshot)
    return snapshot


def build_biography(
    person: dict[str, Any],
    by_id: dict[str, dict[str, Any]],
    departments: dict[str, dict[str, Any]],
) -> str:
    parts: list[str] = []
    for appointment_id in person["appointmentIds"]:
        appointment = by_id[appointment_id]
        department = departments[appointment["departmentId"]]
        if department["kind"] == "ministero":
            where = f" — {department['displayLabel']}"
        elif department["kind"] == "delega":
            where = f" con delega: {department['displayLabel']}"
        else:
            where = " presso la Presidenza del Consiglio dei ministri"
        interim = " (incarico ad interim)" if appointment["interim"] else ""
        parts.append(f"{appointment['roleLabel']}{where}, dal {italian_long_date(appointment['since'])}{interim}.")
    return " ".join(parts)


def validate_snapshot(payload: dict[str, Any], locks: dict[str, Any] | None = None) -> None:
    require(payload.get("schemaVersion") == 2, "schemaVersion inattesa")
    government = payload.get("government") or {}
    require(bool(GOVERNMENT_RE.search(str(government.get("uri") or ""))), "government.uri")
    require(government.get("legislatureUri") == LEGISLATURE_URI, "government.legislatureUri")
    require(bool(DATE_RE.match(str(government.get("startDate") or ""))), "government.startDate")
    require(isinstance(government.get("label"), str) and government["label"].strip(), "government.label")

    source = payload.get("source") or {}
    for key, expected in (("endpointUrl", ENDPOINT), ("landingUrl", LANDING), ("rosterUrl", ROSTER_URL), ("licenseUrl", LICENSE_URL)):
        require(source.get(key) == expected, f"source.{key} diverge")
    responses = source.get("responses") or {}
    require(set(responses) == {"members", "identities", "roster"}, "response set inatteso")
    for key, response in responses.items():
        require(isinstance(response.get("bytes"), int) and response["bytes"] > 0, f"{key}.bytes")
        require(bool(SHA_RE.match(str(response.get("sha256") or ""))), f"{key}.sha256")
        if locks:
            require(response == locks.get(key), f"{key}: source lock diverge")

    departments = payload.get("departments") or []
    appointments = payload.get("appointments") or []
    people = payload.get("people") or []
    require(isinstance(departments, list) and len(departments) >= 15, "dicasteri insufficienti")
    require(isinstance(appointments, list) and len(appointments) >= 50, "incarichi insufficienti")
    require(isinstance(people, list) and len(people) >= 50, "componenti insufficienti")

    department_ids = {item["id"] for item in departments}
    require(len(department_ids) == len(departments), "dicasteri duplicati")
    presidency = [item for item in departments if item["kind"] == "presidenza"]
    require(len(presidency) == 1, "Presidenza del Consiglio non unica")
    for department in departments:
        require(item_kind := department.get("kind") in {"presidenza", "ministero", "delega"}, "kind dicastero")
        require(isinstance(department.get("displayLabel"), str) and department["displayLabel"].strip(), "displayLabel")
        counted = sum(1 for item in appointments if item["departmentId"] == department["id"])
        require(department.get("memberCount") == counted, f"{department['id']}: memberCount non riconcilia")

    appointment_ids = {item["id"] for item in appointments}
    require(len(appointment_ids) == len(appointments), "incarichi duplicati")
    premiers = [item for item in appointments if item["roleKind"] == "presidente-del-consiglio"]
    require(len(premiers) == 1, f"Presidente del Consiglio non unico: {len(premiers)}")
    for appointment in appointments:
        require(appointment.get("roleKind") in ROLE_RANK, "roleKind inatteso")
        require(appointment.get("role") in ROLES, "role inatteso")
        require(ROLES[appointment["role"]] == (appointment["roleKind"], appointment["roleLabel"]), "ruolo incoerente")
        require(appointment.get("departmentId") in department_ids, "dicastero sconosciuto")
        require(bool(DATE_RE.match(str(appointment.get("since") or ""))), "since non ISO")
        require(isinstance(appointment.get("interim"), bool), "interim non booleano")
        require(str(appointment.get("personaId") or "").isdigit(), "personaId invalido")

    person_ids = {item["personaId"] for item in people}
    require(len(person_ids) == len(people), "persone duplicate")
    require({item["personaId"] for item in appointments} == person_ids, "persone e incarichi non riconciliano")
    for person in people:
        pid = person["personaId"]
        for field in ("firstName", "lastName", "displayName", "biography"):
            require(isinstance(person.get(field), str) and person[field].strip(), f"{pid}.{field}")
        ids = person.get("appointmentIds") or []
        require(bool(ids) and all(item in appointment_ids for item in ids), f"{pid}: incarichi sconosciuti")
        require(person.get("primaryRoleKind") in ROLE_RANK, f"{pid}: primaryRoleKind")
        require(person.get("primaryDepartmentId") in department_ids, f"{pid}: primaryDepartmentId")
        require(bool(DATE_RE.match(str(person.get("since") or ""))), f"{pid}: since")
        page = person.get("officialPage")
        if page is not None:
            require(bool(MEMBER_URL_RE.match(str(page))), f"{pid}: scheda governo.it fuori schema")
        photo = person.get("photoUrl")
        legislature = person.get("cameraLegislature")
        if legislature is not None:
            require(isinstance(legislature, int) and 13 <= legislature <= 19, f"{pid}: legislatura mandato")
        if photo is not None:
            require(bool(PHOTO_RE.match(str(photo))), f"{pid}: ritratto fuori schema")
            require(str(photo).endswith(f"d{pid}.jpg"), f"{pid}: ritratto di un'altra persona")
            require(f"/leg{legislature}/" in str(photo), f"{pid}: ritratto e legislatura incoerenti")
        note = person.get("professionNote")
        if note is not None:
            require(isinstance(note, str) and note.strip() == note and note, f"{pid}: nota professionale")

    coverage = payload.get("coverage") or {}
    require(coverage.get("appointments") == len(appointments), "coverage.appointments")
    require(coverage.get("people") == len(people), "coverage.people")
    require(coverage.get("departments") == len(departments), "coverage.departments")
    role_counts = Counter(item["roleKind"] for item in appointments)
    require(coverage.get("ministers") == role_counts["ministro"] + role_counts["ministro-senza-portafoglio"], "coverage.ministers")
    require(coverage.get("viceMinisters") == role_counts["vice-ministro"], "coverage.viceMinisters")
    require(coverage.get("undersecretaries") == role_counts["sottosegretario"], "coverage.undersecretaries")
    require(
        coverage.get("peopleWithOfficialPage") == sum(1 for item in people if item.get("officialPage")),
        "coverage.peopleWithOfficialPage non riconcilia",
    )
    require(coverage.get("peopleWithOfficialPage", 0) >= int(len(people) * 0.8), "schede governo.it sotto soglia")
    require(
        coverage.get("peopleWithPhoto") == sum(1 for item in people if item.get("photoUrl")),
        "coverage.peopleWithPhoto non riconcilia",
    )
    require(
        coverage.get("peopleWithProfessionNote") == sum(1 for item in people if item.get("professionNote")),
        "coverage.peopleWithProfessionNote non riconcilia",
    )

    caveats = payload.get("caveats") or []
    require(isinstance(caveats, list) and len(caveats) >= 4, "caveats assenti")


# --------------------------------------------------------------------------- #
# Official fetching
# --------------------------------------------------------------------------- #


def fetch_sparql(query: str) -> tuple[dict[str, Any], bytes]:
    body = urllib.parse.urlencode({"query": query, "format": "application/sparql-results+json"}).encode("utf-8")
    request = urllib.request.Request(
        ENDPOINT,
        data=body,
        headers={
            "User-Agent": USER_AGENT,
            "Accept": "application/sparql-results+json",
            "Content-Type": "application/x-www-form-urlencoded; charset=utf-8",
        },
        method="POST",
    )
    last_error: Exception | None = None
    for attempt in range(4):
        try:
            with urllib.request.urlopen(request, context=ssl.create_default_context(), timeout=180) as response:
                raw = response.read()
            return json.loads(raw), raw
        except (urllib.error.URLError, json.JSONDecodeError) as error:
            last_error = error
            time.sleep(3 * (attempt + 1))
    raise SnapshotError(f"SPARQL Camera non raggiungibile: {last_error}")


def photo_exists(url: str) -> bool:
    """A HEAD on the portrait archive: absent pictures answer 404, never a stub."""
    request = urllib.request.Request(
        url,
        headers={"User-Agent": USER_AGENT, "Accept": "image/jpeg"},
        method="HEAD",
    )
    for attempt in range(3):
        try:
            with urllib.request.urlopen(request, context=ssl.create_default_context(), timeout=30) as response:
                content_type = (response.headers.get("Content-Type") or "").split(";")[0].strip()
                length = int(response.headers.get("Content-Length") or 0)
                return content_type == "image/jpeg" and length > 1000
        except urllib.error.HTTPError as error:
            if error.code == 404:
                return False
            time.sleep(2 * (attempt + 1))
        except urllib.error.URLError:
            time.sleep(2 * (attempt + 1))
    raise SnapshotError(f"archivio ritratti Camera non raggiungibile: {url}")


def fetch_roster() -> tuple[str, bytes]:
    request = urllib.request.Request(
        ROSTER_URL,
        headers={"User-Agent": USER_AGENT, "Accept": "text/html"},
        method="GET",
    )
    last_error: Exception | None = None
    for attempt in range(4):
        try:
            with urllib.request.urlopen(request, context=ssl.create_default_context(), timeout=120) as response:
                raw = response.read()
            require(len(raw) > 20000, "elenco governo.it troppo breve")
            return raw.decode("utf-8", errors="replace"), raw
        except urllib.error.URLError as error:
            last_error = error
            time.sleep(3 * (attempt + 1))
    raise SnapshotError(f"elenco governo.it non raggiungibile: {last_error}")


def check_committed(spec: dict[str, Any]) -> None:
    payload = json.loads(OUTPUT.read_text(encoding="utf-8"))
    locks = (spec.get("source") or {}).get("committedResponses") or None
    validate_snapshot(payload, locks=locks)
    floor = spec.get("coverageFloor") or {}
    coverage = payload["coverage"]
    for key, minimum in floor.items():
        require(coverage.get(key, 0) >= int(minimum), f"coverage {key} sotto floor")
    print("OK governo-meloni")


def main() -> int:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--check", action="store_true")
    parser.add_argument("--write", action="store_true")
    args = parser.parse_args()
    if args.check == args.write:
        raise SystemExit("specificare esattamente --check oppure --write")

    spec = load_spec()
    if args.check:
        check_committed(spec)
        return 0

    payload, raw = fetch_sparql(MEMBERS_QUERY)
    identities_payload, identities_raw = fetch_sparql(IDENTITIES_QUERY)
    roster_html, roster_raw = fetch_roster()
    snapshot = build_snapshot(payload, raw, roster_html, roster_raw, identities_payload, identities_raw)
    OUTPUT.write_text(json.dumps(snapshot, ensure_ascii=False, indent=2) + "\n", encoding="utf-8")
    print("snapshot written")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
