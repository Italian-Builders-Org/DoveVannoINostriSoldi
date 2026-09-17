#!/usr/bin/env python3
"""Government roster snapshot from the official governo.it institutional page.

Offline --check validates the committed artifact. Live refresh reads the public
roster of Presidency, ministries, vice ministers and undersecretaries and fails
closed on unexpected markup, unknown role captions or coverage below floor.
"""

from __future__ import annotations

import argparse
import hashlib
import json
import re
import ssl
import unicodedata
import urllib.error
import urllib.request
from collections import Counter
from datetime import datetime, timezone
from html.parser import HTMLParser
from pathlib import Path
from typing import Any
from urllib.parse import urlparse

ROOT = Path(__file__).resolve().parents[2]
SPEC = ROOT / "scripts/etl/specs/governo-meloni.source.json"
OUTPUT = ROOT / "src/data/generated/governo-meloni.json"
DATASET = "governo-meloni"
LANDING = "https://www.governo.it/it/ministri-e-sottosegretari"
LICENSE_URL = "https://www.governo.it/it/note-legali"
MEMBER_URL_RE = re.compile(r"^https://www\.governo\.it/it/governo/meloni/([a-z-]+)/([a-z0-9-]+)$")
SHA_RE = re.compile(r"^[0-9a-f]{64}$")
DATE_RE = re.compile(r"^\d{4}-\d{2}-\d{2}$")
CONTENT_MARKER = '<div class="region region-content">'
USER_AGENT = "DoveVannoINostriSoldi-ETL/1.0 (+https://github.com/Italian-Builders-Org/DoveVannoINostriSoldi)"

PRESIDENCY_ID = "presidenza-del-consiglio"
PRESIDENCY_LABEL = "Presidenza del Consiglio dei Ministri"

ROLE_KINDS = {
    "presidente del consiglio dei ministri": ("presidente-del-consiglio", "Presidente del Consiglio dei Ministri"),
    "vice presidente": ("vice-presidente", "Vice Presidente del Consiglio dei Ministri"),
    "ministro": ("ministro", "Ministro"),
    "vice ministro": ("vice-ministro", "Vice Ministro"),
    "sottosegretario di stato": ("sottosegretario", "Sottosegretario di Stato"),
}
ROLE_RANK = {
    "presidente-del-consiglio": 0,
    "vice-presidente": 1,
    "ministro": 2,
    "vice-ministro": 3,
    "sottosegretario": 4,
}


class SnapshotError(ValueError):
    """Official roster or committed artifact failed validation."""


def require(condition: bool, message: str) -> None:
    if not condition:
        raise SnapshotError(message)


def sha256_bytes(raw: bytes) -> str:
    return hashlib.sha256(raw).hexdigest()


def load_spec(path: Path = SPEC) -> dict[str, Any]:
    spec = json.loads(path.read_text(encoding="utf-8"))
    require(spec.get("datasetId") == DATASET, "dataset identity differs")
    source = spec.get("source") or {}
    require(source.get("landingUrl") == LANDING, "landing diverge")
    require(source.get("licenseUrl") == LICENSE_URL, "license URL diverge")
    return spec


def slugify(label: str) -> str:
    folded = unicodedata.normalize("NFKD", label.replace("’", "'"))
    ascii_only = "".join(char for char in folded if not unicodedata.combining(char))
    slug = re.sub(r"[^a-z0-9]+", "-", ascii_only.casefold()).strip("-")
    require(bool(slug), f"slug vuoto per: {label}")
    return slug


def area_label(section: str) -> str | None:
    """Short area name derived from the official section heading."""
    for prefix in ("Ministero degli ", "Ministero della ", "Ministero delle ", "Ministero del ", "Ministero dell'", "Ministero di ", "Ministro per i ", "Ministro per il ", "Ministro per la ", "Ministro per le ", "Ministro per gli ", "Ministro per lo ", "Ministro per l'"):
        if section.startswith(prefix):
            rest = section[len(prefix):].strip()
            return rest[:1].upper() + rest[1:] if rest else None
    return None


class RosterParser(HTMLParser):
    """Collect person links and captions of the roster in document order."""

    CAPTION_TAGS = {"h3", "h4", "p"}

    def __init__(self) -> None:
        super().__init__(convert_charrefs=True)
        self.events: list[tuple[str, str, str]] = []
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
        if text and self._href:
            self.events.append(("person", text, self._href.strip()))
        elif text:
            self.events.append(("caption", text, tag))
        self._capture = None
        self._buffer = []
        self._href = None

    def handle_data(self, data: str) -> None:
        if self._capture:
            self._buffer.append(data)


def parse_roster(html: str) -> list[dict[str, Any]]:
    """Turn the official page into ordered appointments with role and section."""
    start = html.find(CONTENT_MARKER)
    require(start >= 0, "regione di contenuto governo.it non trovata")
    end = html.find("<footer", start)
    require(end > start, "chiusura contenuto governo.it non trovata")
    parser = RosterParser()
    parser.feed(html[start:end])

    appointments: list[dict[str, Any]] = []
    section: str | None = None
    pending: dict[str, Any] | None = None

    for kind, text, extra in parser.events:
        if kind == "person":
            if pending is not None:
                appointments.append(pending)
            match = MEMBER_URL_RE.match(extra)
            require(match is not None, f"URL componente inatteso: {extra}")
            assert match is not None
            pending = {
                "displayName": text,
                "officialPage": extra,
                "slug": match.group(2),
                "section": section,
                "roleCaption": None,
            }
            continue
        if pending is not None and pending["roleCaption"] is None and text.casefold() in ROLE_KINDS:
            pending["roleCaption"] = text
            continue
        if pending is not None:
            appointments.append(pending)
            pending = None
        section = text
    if pending is not None:
        appointments.append(pending)

    require(len(appointments) >= 1, "nessun componente del governo trovato")
    for index, appointment in enumerate(appointments):
        caption = appointment["roleCaption"] or appointment["section"]
        require(
            isinstance(caption, str) and caption.casefold() in ROLE_KINDS,
            f"ruolo non riconosciuto per {appointment['displayName']}: {caption!r}",
        )
        appointment["roleCaption"] = caption
        appointment["order"] = index
    return appointments


def build_snapshot(html: str, raw: bytes, *, observed_date: str) -> dict[str, Any]:
    require(DATE_RE.match(observed_date) is not None, "observedDate non ISO")
    appointments = parse_roster(html)

    departments: list[dict[str, Any]] = [
        {"id": PRESIDENCY_ID, "label": PRESIDENCY_LABEL, "kind": "presidenza", "order": 0}
    ]
    department_index = {PRESIDENCY_ID: departments[0]}
    members: list[dict[str, Any]] = []
    seen_member_ids: set[str] = set()

    for appointment in appointments:
        section = appointment["section"]
        require(isinstance(section, str) and section.strip(), f"{appointment['slug']}: sezione ufficiale assente")
        assert isinstance(section, str)
        if section.startswith("Ministero"):
            department_id = slugify(section)
            if department_id not in department_index:
                entry = {
                    "id": department_id,
                    "label": section,
                    "kind": "ministero",
                    "order": len(departments),
                }
                departments.append(entry)
                department_index[department_id] = entry
        else:
            department_id = PRESIDENCY_ID

        role_kind, role_label = ROLE_KINDS[appointment["roleCaption"].casefold()]
        member_id = f"{role_kind}-{appointment['slug']}"
        require(member_id not in seen_member_ids, f"incarico duplicato: {member_id}")
        seen_member_ids.add(member_id)
        members.append({
            "id": member_id,
            "personSlug": appointment["slug"],
            "displayName": appointment["displayName"].replace("’", "'"),
            "officialPage": appointment["officialPage"],
            "roleKind": role_kind,
            "roleLabel": role_label,
            "departmentId": department_id,
            "sectionLabel": section,
            "areaLabel": area_label(section),
            "order": appointment["order"],
        })

    people: list[dict[str, Any]] = []
    by_slug: dict[str, dict[str, Any]] = {}
    for member in members:
        person = by_slug.get(member["personSlug"])
        if person is None:
            person = {
                "slug": member["personSlug"],
                "displayName": member["displayName"],
                "officialPage": member["officialPage"],
                "appointmentIds": [],
            }
            by_slug[member["personSlug"]] = person
            people.append(person)
        require(
            person["displayName"] == member["displayName"],
            f"{member['personSlug']}: nomi divergenti tra incarichi",
        )
        person["appointmentIds"].append(member["id"])
    for person in people:
        ranked = sorted(
            (member for member in members if member["id"] in person["appointmentIds"]),
            key=lambda item: ROLE_RANK[item["roleKind"]],
        )
        person["primaryRoleKind"] = ranked[0]["roleKind"]
        person["primaryAppointmentId"] = ranked[0]["id"]

    kinds = Counter(member["roleKind"] for member in members)
    snapshot = {
        "schemaVersion": 1,
        "institution": "governo",
        "government": {
            "id": "meloni",
            "label": "Governo Meloni",
            "landingUrl": LANDING,
        },
        "coverage": {
            "appointments": len(members),
            "people": len(people),
            "departments": len(departments),
            "ministries": sum(1 for entry in departments if entry["kind"] == "ministero"),
            "presidentOfCouncil": kinds["presidente-del-consiglio"],
            "vicePresidents": kinds["vice-presidente"],
            "ministers": kinds["ministro"],
            "viceMinisters": kinds["vice-ministro"],
            "undersecretaries": kinds["sottosegretario"],
            "ministersWithoutPortfolio": sum(
                1 for member in members
                if member["roleKind"] == "ministro" and member["departmentId"] == PRESIDENCY_ID
            ),
        },
        "source": {
            "owner": "Presidenza del Consiglio dei Ministri",
            "title": "governo.it — Vice Presidenti, Ministri e Sottosegretari",
            "landingUrl": LANDING,
            "license": "Riuso consentito citando la fonte (nota legale governo.it)",
            "licenseUrl": LICENSE_URL,
            "observedDate": observed_date,
            "acquiredAt": datetime.now(timezone.utc).replace(microsecond=0).isoformat(),
            "responseBytes": len(raw),
            "responseSha256": sha256_bytes(raw),
            "cadence": "aggiornamento a ogni variazione della compagine di governo",
        },
        "caveats": [
            "Elenco degli incarichi in corso pubblicato da governo.it: chi cumula due incarichi resta una sola persona con più incarichi dichiarati.",
            "I ministri senza portafoglio sono ricondotti alla Presidenza del Consiglio con la delega indicata dalla fonte ufficiale.",
            "governo.it non pubblica fotografie in questo elenco: le immagini provengono dai portali ufficiali di Camera e Senato solo per chi siede in Parlamento.",
            "Non contiene importi: la spesa dei ministeri è pubblicata in /governi e nelle viste RGS.",
        ],
        "departments": departments,
        "members": members,
        "people": people,
    }
    validate_snapshot(snapshot)
    return snapshot


def validate_snapshot(payload: dict[str, Any], *, expected_sha: str | None = None) -> None:
    require(payload.get("schemaVersion") == 1, "schemaVersion inattesa")
    require(payload.get("institution") == "governo", "institution inattesa")
    government = payload.get("government") or {}
    require(government.get("id") == "meloni", "government.id inatteso")
    require(government.get("landingUrl") == LANDING, "government.landingUrl diverge")

    members = payload.get("members") or []
    people = payload.get("people") or []
    departments = payload.get("departments") or []
    require(isinstance(members, list) and len(members) >= 40, "incarichi assenti o troppo pochi")
    require(isinstance(people, list) and len(people) >= 40, "persone assenti o troppo poche")
    require(isinstance(departments, list) and len(departments) >= 10, "dicasteri assenti")

    department_ids = {entry["id"] for entry in departments}
    require(len(department_ids) == len(departments), "dicasteri duplicati")
    require(PRESIDENCY_ID in department_ids, "Presidenza del Consiglio assente")
    for entry in departments:
        require(entry.get("kind") in {"presidenza", "ministero"}, f"{entry.get('id')}: kind inatteso")
        require(isinstance(entry.get("label"), str) and entry["label"].strip(), f"{entry.get('id')}: label")

    member_ids: set[str] = set()
    for member in members:
        mid = member.get("id")
        require(isinstance(mid, str) and mid not in member_ids, f"incarico duplicato: {mid}")
        member_ids.add(str(mid))
        require(member.get("roleKind") in ROLE_RANK, f"{mid}: roleKind inatteso")
        require(member.get("departmentId") in department_ids, f"{mid}: dicastero sconosciuto")
        require(isinstance(member.get("displayName"), str) and member["displayName"].strip(), f"{mid}: nome")
        parsed = urlparse(str(member.get("officialPage") or ""))
        require(parsed.scheme == "https" and parsed.netloc == "www.governo.it", f"{mid}: pagina ufficiale")
        require(MEMBER_URL_RE.match(str(member["officialPage"])) is not None, f"{mid}: URL fuori schema")

    slugs = {person["slug"] for person in people}
    require(len(slugs) == len(people), "persone duplicate")
    require(slugs == {member["personSlug"] for member in members}, "persone e incarichi non riconciliano")
    linked = sorted(pid for person in people for pid in person["appointmentIds"])
    require(linked == sorted(member_ids), "collegamenti incarico-persona non riconciliano")
    for person in people:
        require(person.get("primaryRoleKind") in ROLE_RANK, f"{person.get('slug')}: ruolo principale")
        require(person.get("primaryAppointmentId") in member_ids, f"{person.get('slug')}: incarico principale")

    coverage = payload.get("coverage") or {}
    require(coverage.get("appointments") == len(members), "coverage.appointments non riconcilia")
    require(coverage.get("people") == len(people), "coverage.people non riconcilia")
    require(coverage.get("departments") == len(departments), "coverage.departments non riconcilia")
    kinds = Counter(member["roleKind"] for member in members)
    for key, role in (
        ("presidentOfCouncil", "presidente-del-consiglio"),
        ("vicePresidents", "vice-presidente"),
        ("ministers", "ministro"),
        ("viceMinisters", "vice-ministro"),
        ("undersecretaries", "sottosegretario"),
    ):
        require(coverage.get(key) == kinds[role], f"coverage.{key} non riconcilia")
    require(coverage.get("presidentOfCouncil") == 1, "Presidente del Consiglio non unico")
    require(coverage.get("vicePresidents", 0) >= 1, "Vice Presidenti assenti")
    require(coverage.get("ministries") == sum(1 for entry in departments if entry["kind"] == "ministero"), "coverage.ministries")
    require(sum(kinds.values()) == len(members), "somma ruoli non riconcilia")

    source = payload.get("source") or {}
    require(source.get("landingUrl") == LANDING, "source.landingUrl diverge")
    require(source.get("licenseUrl") == LICENSE_URL, "source.licenseUrl diverge")
    require(DATE_RE.match(str(source.get("observedDate") or "")) is not None, "observedDate invalida")
    require(isinstance(source.get("responseBytes"), int) and source["responseBytes"] > 0, "responseBytes")
    require(SHA_RE.match(str(source.get("responseSha256") or "")) is not None, "responseSha256 invalido")
    require(isinstance(payload.get("caveats"), list) and payload["caveats"], "caveats assenti")
    if expected_sha:
        require(source["responseSha256"] == expected_sha, "responseSha256 diverge dal source lock")


def fetch_landing() -> tuple[str, bytes]:
    request = urllib.request.Request(
        LANDING,
        headers={"User-Agent": USER_AGENT, "Accept": "text/html"},
        method="GET",
    )
    try:
        with urllib.request.urlopen(request, context=ssl.create_default_context(), timeout=120) as response:
            raw = response.read()
    except urllib.error.URLError as error:
        raise SnapshotError(f"governo.it non raggiungibile: {error}") from error
    require(len(raw) > 20000, "risposta governo.it troppo breve")
    return raw.decode("utf-8"), raw


def check_committed(spec: dict[str, Any]) -> None:
    payload = json.loads(OUTPUT.read_text(encoding="utf-8"))
    lock = (spec.get("source") or {}).get("committedResponse") or {}
    expected_sha = str(lock.get("sha256") or "")
    validate_snapshot(payload, expected_sha=expected_sha or None)
    if lock.get("bytes"):
        require(payload["source"]["responseBytes"] == lock["bytes"], "responseBytes diverge dal lock")
    require(payload["source"]["observedDate"] == spec["period"]["observedDate"], "observedDate diverge dallo spec")
    floor = spec.get("coverageFloor") or {}
    coverage = payload["coverage"]
    require(coverage["appointments"] >= floor.get("appointments", 60), "appointments sotto floor")
    require(coverage["people"] >= floor.get("people", 58), "people sotto floor")
    require(coverage["ministries"] >= floor.get("ministries", 14), "ministries sotto floor")
    require(coverage["ministers"] >= floor.get("ministers", 20), "ministers sotto floor")
    print(
        f"OK governo-meloni: {coverage['appointments']} incarichi, {coverage['people']} persone, "
        f"{coverage['ministries']} ministeri"
    )


def main() -> int:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--check", action="store_true", help="valida lo snapshot committato senza rete")
    parser.add_argument("--write", action="store_true", help="scarica governo.it e riscrive lo snapshot")
    args = parser.parse_args()
    if args.check == args.write:
        raise SystemExit("specificare esattamente una azione: --check oppure --write")

    spec = load_spec()
    if args.check:
        check_committed(spec)
        return 0

    html, raw = fetch_landing()
    snapshot = build_snapshot(html, raw, observed_date=datetime.now(timezone.utc).date().isoformat())
    OUTPUT.parent.mkdir(parents=True, exist_ok=True)
    OUTPUT.write_text(json.dumps(snapshot, ensure_ascii=False, indent=2) + "\n", encoding="utf-8")
    print(f"written {OUTPUT.relative_to(ROOT)} ({snapshot['coverage']['appointments']} incarichi)")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
