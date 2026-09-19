#!/usr/bin/env python3
"""Camera XIX deputies, groups, organs and institutional offices.

Structure comes from the official SPARQL endpoint of dati.camera.it (OCD); the
personal profile pages of camera.it add anagraphic detail, election geography
and the parliamentary offices that the RDF does not expose. Offline --check
validates the committed artifact; --write refreshes from the official sources
and fails closed on empty, duplicate or unreconciled coverage.
"""

from __future__ import annotations

import argparse
import hashlib
import json
import re
import ssl
import time
import urllib.error
import urllib.parse
import urllib.request
from collections import Counter, defaultdict
from concurrent.futures import ThreadPoolExecutor
from datetime import datetime, timezone
from html import unescape
from pathlib import Path
from typing import Any
from urllib.parse import urlparse

ROOT = Path(__file__).resolve().parents[2]
SPEC = ROOT / "scripts/etl/specs/politici-camera-xix.source.json"
OUTPUT = ROOT / "src/data/generated/politici-camera-xix.json"
DATASET = "politici-camera-xix"
LEGISLATURE_URI = "http://dati.camera.it/ocd/legislatura.rdf/repubblica_19"
ENDPOINT = "https://dati.camera.it/sparql"
LANDING = "https://dati.camera.it/"
PROFILE_BASE = "https://www.camera.it/deputati/elenco/19-"
PHOTO_BASE = "https://documenti.camera.it/_dati/leg19/schededeputatinuovosito/fotoDefinitivo/big/d"
GROUP_PAGE_BASE = "https://www.camera.it/leg19/217?idlegislatura=19&shadow_gruppi_parlamentari="
LICENSE_URL = "https://creativecommons.org/licenses/by/4.0/"
SHA_RE = re.compile(r"^[0-9a-f]{64}$")
ISO_DATE = re.compile(r"^\d{4}-\d{2}-\d{2}$")
GROUP_ID_RE = re.compile(r"/gruppoParlamentare\.rdf/(gr\d+)$")
DEPUTY_ID_RE = re.compile(r"/deputato\.rdf/(d(\d+)_19)$")
ORGAN_ID_RE = re.compile(r"/organo\.rdf/(o19_\d+)$")
USER_AGENT = "DoveVannoINostriSoldi-ETL/1.0 (+https://github.com/Italian-Builders-Org/DoveVannoINostriSoldi)"
PRESIDENCY_ORGAN_LABEL = "UFFICIO DI PRESIDENZA"
CHAMBER_ORGAN_LABEL = "CAMERA DEI DEPUTATI"

ITALIAN_MONTHS = {
    "gennaio": 1, "febbraio": 2, "marzo": 3, "aprile": 4, "maggio": 5, "giugno": 6,
    "luglio": 7, "agosto": 8, "settembre": 9, "ottobre": 10, "novembre": 11, "dicembre": 12,
}
MONTH_NAMES = tuple(ITALIAN_MONTHS)


def italian_long_date(iso: str) -> str:
    year, month, day = (int(part) for part in iso.split("-"))
    return f"{day} {MONTH_NAMES[month - 1]} {year}"

GROUP_ROLE_LABELS = {
    "PRESIDENTE": "Presidente del gruppo",
    "VICEPRES. VICARIO": "Vicepresidente vicario del gruppo",
    "VICEPRESIDENTE": "Vicepresidente del gruppo",
    "TESORIERE": "Tesoriere del gruppo",
    "SEGRETARIO": "Segretario del gruppo",
    "SEGRETARIO D'AULA": "Segretario d'Aula del gruppo",
    "DELEGATO D'AULA": "Delegato d'Aula del gruppo",
    "RAPPRESENTANTE COMPONENTE GRUPPO MISTO": "Rappresentante di componente del gruppo Misto",
}
GROUP_ROLE_RANK = {role: index for index, role in enumerate(GROUP_ROLE_LABELS)}

INSTITUTIONAL_ROLE_LABELS = {
    "PRESIDENTE": "Presidente dell'Ufficio di Presidenza",
    "VICEPRESIDENTE": "Vicepresidente della Camera dei deputati",
    "QUESTORE": "Questore della Camera dei deputati",
    "SEGRETARIO": "Segretario di Presidenza della Camera",
}
INSTITUTIONAL_ROLE_RANK = {role: index for index, role in enumerate(INSTITUTIONAL_ROLE_LABELS)}

QUERIES = {
    "roster": """
PREFIX ocd: <http://dati.camera.it/ocd/>
PREFIX rdfs: <http://www.w3.org/2000/01/rdf-schema#>
PREFIX foaf: <http://xmlns.com/foaf/0.1/>

SELECT DISTINCT ?deputato ?nome ?cognome ?gender ?gruppo ?gruppoLabel ?inizioGruppo
WHERE {
  ?deputato a ocd:deputato ;
            ocd:rif_leg <http://dati.camera.it/ocd/legislatura.rdf/repubblica_19> ;
            foaf:firstName ?nome ;
            foaf:surname ?cognome ;
            ocd:aderisce ?adesione .
  ?adesione ocd:rif_gruppoParlamentare ?gruppo .
  ?gruppo rdfs:label ?gruppoLabel .
  FILTER NOT EXISTS { ?adesione ocd:endDate ?fineAdesione }
  OPTIONAL { ?deputato foaf:gender ?gender }
  OPTIONAL { ?adesione ocd:startDate ?inizioGruppo }
}
ORDER BY ?cognome ?nome ?inizioGruppo
""".strip(),
    "groupRoles": """
PREFIX ocd: <http://dati.camera.it/ocd/>

SELECT DISTINCT ?deputato ?gruppo ?ruolo ?inizio
WHERE {
  ?incarico a ocd:incarico ;
            ocd:rif_leg <http://dati.camera.it/ocd/legislatura.rdf/repubblica_19> ;
            ocd:rif_deputato ?deputato ;
            ocd:rif_gruppoParlamentare ?gruppo ;
            ocd:ruolo ?ruolo ;
            ocd:startDate ?inizio .
  FILTER NOT EXISTS { ?incarico ocd:endDate ?fine }
}
ORDER BY ?gruppo ?ruolo ?deputato
""".strip(),
    "organs": """
PREFIX ocd: <http://dati.camera.it/ocd/>
PREFIX rdfs: <http://www.w3.org/2000/01/rdf-schema#>
PREFIX dc: <http://purl.org/dc/elements/1.1/>

SELECT DISTINCT ?deputato ?organo ?organoLabel ?inizio ?tipo
WHERE {
  ?deputato a ocd:deputato ;
            ocd:rif_leg <http://dati.camera.it/ocd/legislatura.rdf/repubblica_19> ;
            ocd:membro ?appartenenza .
  ?appartenenza ocd:rif_organo ?organo ;
                ocd:startDate ?inizio ;
                dc:type ?tipo .
  ?organo rdfs:label ?organoLabel .
  FILTER NOT EXISTS { ?appartenenza ocd:endDate ?fine }
}
ORDER BY ?organo ?deputato
""".strip(),
}

CANONICAL_GROUP_LABELS = (
    "PARTITO DEMOCRATICO - ITALIA DEMOCRATICA E PROGRESSISTA",
    "AZIONE-POPOLARI EUROPEISTI RIFORMATORI-RENEW EUROPE",
    "FORZA ITALIA - BERLUSCONI PRESIDENTE - PPE",
    "ALLEANZA VERDI E SINISTRA",
    "FRATELLI D'ITALIA",
    "ITALIA VIVA-CASA RIFORMISTA",
    "LEGA - SALVINI PREMIER",
    "MOVIMENTO 5 STELLE",
    "NOI MODERATI",
    "MISTO",
)


class SnapshotError(ValueError):
    """Committed snapshot or live official payload failed closed."""


def require(condition: bool, message: str) -> None:
    if not condition:
        raise SnapshotError(message)


def sha256_bytes(raw: bytes) -> str:
    return hashlib.sha256(raw).hexdigest()


def load_spec(path: Path = SPEC) -> dict[str, Any]:
    spec = json.loads(path.read_text(encoding="utf-8"))
    require(spec["datasetId"] == DATASET, "dataset identity differs")
    source = spec["source"]
    require(source["endpointUrl"] == ENDPOINT, "endpoint diverge")
    require(source["landingUrl"] == LANDING, "landing diverge")
    require(source["legislatureUri"] == LEGISLATURE_URI, "legislature diverge")
    require(source["licenseUrl"] == LICENSE_URL, "license URL diverge")
    require(source["profileBaseUrl"] == PROFILE_BASE, "profile base diverge")
    require(source["photoBaseUrl"] == PHOTO_BASE, "photo base diverge")
    return spec


def title_case_name(value: str) -> str:
    """The Camera publishes names in caps: restore casing across spaces, apostrophes and hyphens."""
    def fix(token: str) -> str:
        return re.sub(r"(^|['’\-])([a-zà-ü])", lambda match: match.group(1) + match.group(2).upper(), token.casefold())

    return " ".join(fix(part) for part in value.strip().split())


def normalize_group_label(label: str) -> str:
    text = " ".join(label.split())
    for name in CANONICAL_GROUP_LABELS:
        if text.startswith(name):
            return name
    return re.sub(r"\s+dal\s+\d{4}-\d{2}-\d{2}$", "", text, flags=re.IGNORECASE).strip() or label.strip()


def parse_uri_id(uri: str, pattern: re.Pattern[str], kind: str) -> str:
    match = pattern.search(uri)
    require(bool(match), f"{kind} URI non riconosciuto: {uri}")
    assert match is not None
    return match.group(1)


def binding_value(row: dict[str, Any], key: str) -> str | None:
    cell = row.get(key)
    if not cell:
        return None
    value = cell.get("value")
    return value if isinstance(value, str) and value.strip() else None


def italian_date(value: str) -> str | None:
    match = re.match(r"^(\d{1,2})\s+([A-Za-zàèéìòù]+)\s+(\d{4})$", value.strip())
    if match is None:
        return None
    month = ITALIAN_MONTHS.get(match.group(2).casefold())
    if month is None:
        return None
    return f"{int(match.group(3)):04d}-{month:02d}-{int(match.group(1)):02d}"


def compact_date(value: str) -> str | None:
    """OCD dates arrive as YYYYMMDD."""
    if re.fullmatch(r"\d{8}", value or ""):
        return f"{value[0:4]}-{value[4:6]}-{value[6:8]}"
    return value if ISO_DATE.match(value or "") else None


def strip_tags(fragment: str) -> str:
    text = re.sub(r"<[^>]+>", " ", fragment)
    return re.sub(r"\s+", " ", unescape(text)).strip()


def classify_organ(label: str) -> str:
    upper = label.upper()
    if "COMMISSIONE PARLAMENTARE" in upper or "COMMISSIONE BICAMERALE" in upper:
        return "bicamerale"
    if re.match(r"^(I|II|III|IV|V|VI|VII|VIII|IX|X|XI|XII|XIII|XIV)\s+COMMISSIONE", upper):
        return "commissione-permanente"
    if upper.startswith("GIUNTA"):
        return "giunta"
    if upper.startswith("DELEGAZIONE") or "ASSEMBLEA PARLAMENTARE" in upper:
        return "delegazione"
    if upper.startswith("COMITATO"):
        return "comitato"
    if "UFFICIO" in upper or "CONFERENZA" in upper:
        return "ufficio"
    if "COMMISSIONE" in upper:
        return "commissione"
    return "organo"


# --------------------------------------------------------------------------- #
# Official profile pages
# --------------------------------------------------------------------------- #

ANAGRAFICA_ROW = re.compile(r"<li>\s*<span>([^<]+)</span>\s*<strong>(.*?)</strong>\s*</li>", re.S)
OFFICE_SECTION = re.compile(r"<h3>UFFICI PARLAMENTARI</h3>\s*<ul[^>]*>(.*?)</ul>", re.S)
OFFICE_ROW = re.compile(r"<li>(.*?)</li>", re.S)
OFFICE_TEXT = re.compile(
    r"^(?P<role>[A-ZÀ-Ü'’\s]+?)\s*-\s*(?P<organ>.+?)\s+dal\s+(?P<since>\d{1,2}\s+\S+\s+\d{4})"
    r"(?:\s+al\s+(?P<until>\d{1,2}\s+\S+\s+\d{4}))?$"
)
PHOTO_IN_PAGE = re.compile(r"fotoDefinitivo/big/d(\d+)\.jpg")
SOCIAL_LINK = re.compile(r'<a\s+href="([^"]+)"[^>]*class="logo ([a-z-]+)-logo"')
GROUP_SECTION = re.compile(r"<h3>GRUPPO PARLAMENTARE</h3>\s*<ul[^>]*>(.*?)</ul>", re.S)
GROUP_PAGE_ID = re.compile(r"shadow_gruppi_parlamentari=(\d+)")
GROUP_ROW_TEXT = re.compile(r"^(?P<label>.+?)\s+dal\s+\d{1,2}\s+\S+\s+\d{4}(?:\s+al\s+(?P<until>\d{1,2}\s+\S+\s+\d{4}))?$")
SOCIAL_PLATFORMS = {"x": "x", "twitter": "x", "facebook": "facebook", "instagram": "instagram", "youtube": "youtube"}


def parse_profile(numeric_id: str, html: str) -> dict[str, Any]:
    """Read anagraphic fields and current parliamentary offices of one deputy."""
    section_start = html.find('id="info-anagrafica"')
    require(section_start > 0, f"d{numeric_id}: scheda senza anagrafica")
    section = html[section_start:]

    fields: dict[str, str] = {}
    for label, value in ANAGRAFICA_ROW.findall(section):
        key = re.sub(r"\s+", " ", unescape(label)).strip().upper()
        text = strip_tags(value)
        if key and text and key not in fields:
            fields[key] = text

    photo_match = PHOTO_IN_PAGE.search(html)
    require(photo_match is not None, f"d{numeric_id}: foto ufficiale assente nella scheda")
    assert photo_match is not None
    require(photo_match.group(1) == numeric_id, f"d{numeric_id}: foto di un'altra identità")

    group_display: str | None = None
    group_page_id: str | None = None
    group_section = GROUP_SECTION.search(section)
    require(group_section is not None, f"d{numeric_id}: gruppo parlamentare assente nella scheda")
    assert group_section is not None
    for row in OFFICE_ROW.findall(group_section.group(1)):
        text = strip_tags(row)
        parsed = GROUP_ROW_TEXT.match(text)
        if parsed is None or parsed.group("until"):
            continue
        require(group_display is None, f"d{numeric_id}: più gruppi correnti nella scheda ufficiale")
        group_display = parsed.group("label").strip()
        page_id = GROUP_PAGE_ID.search(row)
        group_page_id = page_id.group(1) if page_id else None
    require(bool(group_display), f"d{numeric_id}: gruppo corrente non interpretabile nella scheda")

    offices: list[dict[str, str]] = []
    office_section = OFFICE_SECTION.search(section)
    if office_section is not None:
        for row in OFFICE_ROW.findall(office_section.group(1)):
            text = strip_tags(row)
            if not text:
                continue
            parsed = OFFICE_TEXT.match(text)
            require(parsed is not None, f"d{numeric_id}: ufficio parlamentare non interpretabile: {text!r}")
            assert parsed is not None
            if parsed.group("until"):
                continue
            since = italian_date(parsed.group("since"))
            require(since is not None, f"d{numeric_id}: data ufficio non valida")
            assert since is not None
            offices.append({
                "role": re.sub(r"\s+", " ", parsed.group("role")).strip().replace("’", "'"),
                "organ": re.sub(r"\s+", " ", parsed.group("organ")).strip(),
                "since": since,
            })

    social: dict[str, str] = {}
    for href, platform in SOCIAL_LINK.findall(html):
        key = SOCIAL_PLATFORMS.get(platform)
        if key and key not in social and href.startswith("https://"):
            social[key] = unescape(href)

    return {
        "birthDate": italian_date(fields.get("DATA DI NASCITA", "")),
        "birthPlace": fields.get("COMUNE DI NASCITA"),
        "constituency": fields.get("CIRCOSCRIZIONE DI ELEZIONE"),
        "college": fields.get("COLLEGIO DI ELEZIONE"),
        "coalition": fields.get("COALIZIONE DI ELEZIONE"),
        "professionNote": fields.get("FORMAZIONE O NOTE PROFESSIONALI"),
        "proclamationDate": italian_date(fields.get("PROCLAMAZIONE", "")),
        "offices": offices,
        "socialLinks": social,
        "groupDisplayLabel": group_display,
        "groupPageId": group_page_id,
    }


def build_biography(person: dict[str, Any]) -> str:
    female = person.get("gender") == "female"
    parts: list[str] = []
    role = person.get("institutionalRole") or {}
    if role.get("label"):
        parts.append(f"{role['label']} nella XIX legislatura.")
    else:
        parts.append(f"{'Deputata' if female else 'Deputato'} della XIX legislatura.")
    group_bits = f"Gruppo {person.get('groupDisplayLabel') or person['groupLabel']}"
    if person.get("componentLabel"):
        group_bits += f", componente {person['componentLabel']}"
    if person.get("groupRoleLabel"):
        incarico = person["groupRoleLabel"].casefold()
        if person.get("componentLabel"):
            incarico = incarico.replace("del gruppo", "della componente")
        group_bits += f", con incarico di {incarico}"
    parts.append(group_bits + ".")
    if person.get("constituency"):
        where = f"{'Eletta' if female else 'Eletto'} nella circoscrizione {person['constituency']}"
        if person.get("college"):
            where += f" ({person['college']})"
        parts.append(where + ".")
    if person.get("birthDate") and person.get("birthPlace"):
        place = " ".join(part.capitalize() for part in person["birthPlace"].split())
        parts.append(f"Nata a {place} il {italian_long_date(person['birthDate'])}." if female
                     else f"Nato a {place} il {italian_long_date(person['birthDate'])}.")
    if person.get("professionNote"):
        parts.append(f"Formazione o note professionali: {person['professionNote']}.")
    return " ".join(parts)


# --------------------------------------------------------------------------- #
# Snapshot assembly
# --------------------------------------------------------------------------- #


def build_snapshot(
    payloads: dict[str, dict[str, Any]],
    raws: dict[str, bytes],
    profiles: dict[str, str],
    profile_digest: dict[str, Any],
) -> dict[str, Any]:
    roster_rows = payloads["roster"]["results"]["bindings"]
    require(len(roster_rows) > 0, "SPARQL roster vuoto")

    identity: dict[str, dict[str, Any]] = {}
    membership: dict[str, dict[str, Any]] = {}
    for row in roster_rows:
        uri = binding_value(row, "deputato")
        require(uri is not None, "riga roster senza deputato")
        assert uri is not None
        match = DEPUTY_ID_RE.search(uri)
        require(match is not None, f"deputato URI non riconosciuto: {uri}")
        assert match is not None
        deputy_id, numeric_id = match.group(1), match.group(2)
        first = binding_value(row, "nome")
        last = binding_value(row, "cognome")
        require(bool(first and last), f"{deputy_id}: nome/cognome assenti")
        assert first and last
        group_uri = binding_value(row, "gruppo")
        group_label = binding_value(row, "gruppoLabel")
        require(bool(group_uri and group_label), f"{deputy_id}: gruppo corrente assente")
        assert group_uri and group_label
        start = binding_value(row, "inizioGruppo") or ""
        previous = membership.get(deputy_id)
        if previous is None or start > previous["start"]:
            membership[deputy_id] = {
                "groupId": parse_uri_id(group_uri, GROUP_ID_RE, "gruppo"),
                "groupUri": group_uri,
                "groupLabel": normalize_group_label(group_label),
                "start": start,
            }
        identity.setdefault(deputy_id, {
            "id": deputy_id,
            "numericId": numeric_id,
            "uri": uri,
            "firstName": first.strip(),
            "lastName": last.strip(),
            "displayName": f"{title_case_name(first)} {title_case_name(last)}",
            "gender": binding_value(row, "gender"),
        })

    group_roles: dict[str, dict[str, str]] = {}
    for row in payloads["groupRoles"]["results"]["bindings"]:
        uri = binding_value(row, "deputato")
        role = binding_value(row, "ruolo")
        group_uri = binding_value(row, "gruppo")
        if uri is None or role is None or group_uri is None:
            continue
        deputy_id = parse_uri_id(uri, DEPUTY_ID_RE, "deputato")
        if deputy_id not in identity:
            continue
        # A renamed group keeps its own URI: only roles inside the current group count.
        if parse_uri_id(group_uri, GROUP_ID_RE, "gruppo") != membership[deputy_id]["groupId"]:
            continue
        normalized = re.sub(r"\s+", " ", role).strip().upper().replace("’", "'")
        require(normalized in GROUP_ROLE_RANK, f"{deputy_id}: ruolo di gruppo inatteso {normalized!r}")
        current = group_roles.get(deputy_id)
        if current is None or GROUP_ROLE_RANK[normalized] < GROUP_ROLE_RANK[current["role"]]:
            group_roles[deputy_id] = {
                "role": normalized,
                "label": GROUP_ROLE_LABELS[normalized],
                "since": compact_date(binding_value(row, "inizio") or "") or "",
            }

    organs: dict[str, dict[str, Any]] = {}
    organ_members: dict[str, set[str]] = defaultdict(set)
    for row in payloads["organs"]["results"]["bindings"]:
        deputy_uri = binding_value(row, "deputato")
        organ_uri = binding_value(row, "organo")
        organ_label = binding_value(row, "organoLabel")
        if deputy_uri is None or organ_uri is None or organ_label is None:
            continue
        deputy_id = parse_uri_id(deputy_uri, DEPUTY_ID_RE, "deputato")
        if deputy_id not in identity:
            continue
        if (binding_value(row, "tipo") or "").casefold() != "titolare":
            continue
        organ_id = parse_uri_id(organ_uri, ORGAN_ID_RE, "organo")
        label = re.sub(r"\s*\(\d{2}\.\d{2}\.\d{4}.*$", "", " ".join(organ_label.split())).strip()
        organs.setdefault(organ_id, {
            "id": organ_id,
            "uri": organ_uri,
            "label": label,
            "kind": classify_organ(label),
        })
        organ_members[organ_id].add(deputy_id)

    deputies: list[dict[str, Any]] = []
    group_counts: Counter[str] = Counter()
    group_meta: dict[str, dict[str, str]] = {}
    group_display_labels: dict[str, set[str]] = defaultdict(set)
    group_page_ids: dict[str, set[str]] = defaultdict(set)
    institutional_roles = 0

    for deputy_id in sorted(identity, key=lambda item: (
        identity[item]["lastName"], identity[item]["firstName"], item,
    )):
        person = dict(identity[deputy_id])
        numeric_id = person["numericId"]
        html = profiles.get(numeric_id)
        require(html is not None, f"{deputy_id}: scheda ufficiale mancante")
        assert html is not None
        profile = parse_profile(numeric_id, html)

        group = membership[deputy_id]
        group_counts[group["groupId"]] += 1
        group_meta[group["groupId"]] = {"uri": group["groupUri"], "label": group["groupLabel"]}
        group_display_labels[group["groupId"]].add(profile["groupDisplayLabel"])
        if profile["groupPageId"] is not None:
            group_page_ids[group["groupId"]].add(profile["groupPageId"])

        chamber_office = next(
            (item for item in profile["offices"] if item["organ"].upper() == CHAMBER_ORGAN_LABEL),
            None,
        )
        presidency_office = next(
            (item for item in profile["offices"] if item["organ"].upper() == PRESIDENCY_ORGAN_LABEL),
            None,
        )
        chosen = chamber_office or presidency_office
        institutional_role = None
        if chosen is not None:
            role = chosen["role"].upper()
            require(role in INSTITUTIONAL_ROLE_RANK, f"{deputy_id}: carica istituzionale inattesa {role}")
            institutional_role = {
                "role": role,
                "label": (
                    "Presidente della Camera dei deputati"
                    if chamber_office is not None and role == "PRESIDENTE"
                    else INSTITUTIONAL_ROLE_LABELS[role]
                ),
                "organ": chosen["organ"],
                "since": chosen["since"],
            }
            institutional_roles += 1

        person.update({
            "officialPage": f"{PROFILE_BASE}{numeric_id}",
            "photoUrl": f"{PHOTO_BASE}{numeric_id}.jpg",
            "groupId": group["groupId"],
            "groupLabel": group["groupLabel"],
            "groupDisplayLabel": profile["groupDisplayLabel"],
            "groupSince": compact_date(group["start"]),
            "groupRole": group_roles.get(deputy_id, {}).get("role"),
            "groupRoleLabel": group_roles.get(deputy_id, {}).get("label"),
            "institutionalRole": institutional_role,
            "organIds": sorted(oid for oid, members in organ_members.items() if deputy_id in members),
            "birthDate": profile["birthDate"],
            "birthPlace": profile["birthPlace"],
            "constituency": profile["constituency"],
            "college": profile["college"],
            "coalition": profile["coalition"],
            "professionNote": profile["professionNote"],
            "socialLinks": profile["socialLinks"] or None,
        })
        person["biography"] = build_biography(person)
        deputies.append(person)

    # The Misto group publishes one label per component: the group name is the shared prefix.
    group_titles: dict[str, str] = {}
    for gid, labels in group_display_labels.items():
        title = min(sorted(labels), key=len)
        for label in labels:
            require(
                label == title or label.startswith(f"{title}-") or label.startswith(f"{title} -"),
                f"{gid}: etichetta di gruppo incompatibile {label!r} con {title!r}",
            )
        group_titles[gid] = title
        require(len(group_page_ids[gid]) <= 1, f"{gid}: pagine gruppo divergenti {sorted(group_page_ids[gid])}")

    for deputy in deputies:
        title = group_titles[deputy["groupId"]]
        label = deputy["groupDisplayLabel"]
        deputy["groupDisplayLabel"] = title
        deputy["componentLabel"] = label[len(title):].lstrip("- ").strip() or None if label != title else None
        deputy["biography"] = build_biography(deputy)

    groups = [
        {
            "id": gid,
            "uri": group_meta[gid]["uri"],
            "label": group_meta[gid]["label"],
            "displayLabel": group_titles[gid],
            "componentLabels": sorted(
                {
                    deputy["componentLabel"] for deputy in deputies
                    if deputy["groupId"] == gid and deputy.get("componentLabel")
                }
            ) or None,
            "officialPage": (
                f"{GROUP_PAGE_BASE}{next(iter(group_page_ids[gid]))}"
                if group_page_ids[gid] else f"{GROUP_PAGE_BASE}{gid[2:]}"
            ),
            "memberCount": count,
            # The Misto group has one president per component: no single group president.
            "presidentDeputyId": (
                presidents[0] if len(presidents := [
                    deputy["id"] for deputy in deputies
                    if deputy["groupId"] == gid and deputy.get("groupRole") == "PRESIDENTE"
                ]) == 1 else None
            ),
        }
        for gid, count in sorted(group_counts.items(), key=lambda item: (-item[1], group_meta[item[0]]["label"], item[0]))
    ]

    organ_list = [
        {**organs[oid], "memberCount": len(organ_members[oid])}
        for oid in sorted(organs, key=lambda item: (organs[item]["kind"], organs[item]["label"]))
    ]

    snapshot = {
        "schemaVersion": 2,
        "chamber": "camera",
        "legislature": {
            "id": "repubblica_19",
            "label": "XIX Legislatura",
            "uri": LEGISLATURE_URI,
            "startDate": "2022-10-13",
        },
        "coverage": {
            "deputies": len(deputies),
            "groups": len(groups),
            "deputiesWithGroup": len(deputies),
            "deputiesWithoutGroup": 0,
            "seatCapacity": 400,
            "vacantSeats": 400 - len(deputies),
            "deputiesWithPhoto": sum(1 for item in deputies if item["photoUrl"]),
            "deputiesWithBirthDate": sum(1 for item in deputies if item["birthDate"]),
            "deputiesWithConstituency": sum(1 for item in deputies if item["constituency"]),
            "deputiesWithProfession": sum(1 for item in deputies if item["professionNote"]),
            "groupLeaders": sum(1 for item in deputies if item.get("groupRole") == "PRESIDENTE"),
            "institutionalRoles": institutional_roles,
            "organs": len(organ_list),
        },
        "source": {
            "owner": "Camera dei deputati",
            "title": "Open Data Camera — endpoint SPARQL OCD e schede ufficiali dei deputati",
            "endpointUrl": ENDPOINT,
            "landingUrl": LANDING,
            "profileBaseUrl": PROFILE_BASE,
            "photoBaseUrl": PHOTO_BASE,
            "license": "CC BY 4.0 (dichiarata dal portale dati.camera.it)",
            "licenseUrl": LICENSE_URL,
            "legislatureUri": LEGISLATURE_URI,
            "acquiredAt": datetime.now(timezone.utc).replace(microsecond=0).isoformat(),
            "responses": {
                **{key: {"bytes": len(raw), "sha256": sha256_bytes(raw)} for key, raw in raws.items()},
                "profiles": profile_digest,
            },
            "cadence": "continuo / aggiornamento RDF e schede Camera",
        },
        "caveats": [
            "Copre i deputati con adesione parlamentare aperta nella XIX legislatura; le differenze dai 400 seggi sono esposte come seggi vacanti, non riempite con ex deputati.",
            "Le cariche di gruppo e gli uffici parlamentari sono quelli senza data di fine alla data di acquisizione.",
            "Anagrafica, collegio, coalizione e note professionali provengono dalle schede personali pubblicate su camera.it, non dal grafo RDF.",
            "Non è un grafo di potere o di influenza: mostra appartenenze formali e cariche ufficiali pubblicate dalla Camera.",
            "Lo snapshot non contiene notizie di stampa; la UI interroga separatamente indici live e attribuisce ogni link all'editore.",
            "I soldi pubblici non sono in questo snapshot; per bilanci e spesa usare /parlamento e /governi.",
        ],
        "groups": groups,
        "organs": organ_list,
        "deputies": deputies,
    }
    validate_snapshot(snapshot)
    return snapshot


def validate_snapshot(payload: dict[str, Any], locks: dict[str, Any] | None = None) -> None:
    require(payload.get("schemaVersion") == 2, "schemaVersion inattesa")
    require(payload.get("chamber") == "camera", "chamber inattesa")
    legislature = payload.get("legislature") or {}
    require(legislature.get("id") == "repubblica_19", "legislature.id inatteso")
    require(legislature.get("uri") == LEGISLATURE_URI, "legislature.uri diverge")
    require(bool(ISO_DATE.match(str(legislature.get("startDate") or ""))), "startDate non ISO")

    source = payload.get("source") or {}
    for key, expected in (
        ("endpointUrl", ENDPOINT), ("landingUrl", LANDING), ("legislatureUri", LEGISLATURE_URI),
        ("licenseUrl", LICENSE_URL), ("profileBaseUrl", PROFILE_BASE), ("photoBaseUrl", PHOTO_BASE),
    ):
        require(source.get(key) == expected, f"source.{key} diverge")
    require(isinstance(source.get("acquiredAt"), str) and "T" in source["acquiredAt"], "acquiredAt")
    responses = source.get("responses") or {}
    require(set(responses) == set(QUERIES) | {"profiles"}, "set delle risposte inatteso")
    for key, response in responses.items():
        require(isinstance(response.get("bytes"), int) and response["bytes"] > 0, f"{key}.bytes")
        require(bool(SHA_RE.match(str(response.get("sha256") or ""))), f"{key}.sha256")
        if locks:
            require(response == locks.get(key), f"{key}: source lock diverge")
    require(responses["profiles"].get("count") == payload["coverage"]["deputies"], "profiles.count non riconcilia")

    caveats = payload.get("caveats") or []
    require(isinstance(caveats, list) and len(caveats) >= 3, "caveats assenti")

    groups = payload.get("groups") or []
    deputies = payload.get("deputies") or []
    organs = payload.get("organs") or []
    require(isinstance(groups, list) and len(groups) >= 5, "groups assenti")
    require(isinstance(deputies, list) and 390 <= len(deputies) <= 400, f"composizione Camera fuori intervallo: {len(deputies)}")
    require(isinstance(organs, list) and len(organs) >= 14, "organi assenti")

    coverage = payload.get("coverage") or {}
    require(coverage.get("deputies") == len(deputies), "coverage.deputies non riconcilia")
    require(coverage.get("groups") == len(groups), "coverage.groups non riconcilia")
    require(coverage.get("organs") == len(organs), "coverage.organs non riconcilia")
    require(coverage.get("deputiesWithGroup") == len(deputies), "deputati senza gruppo")
    require(coverage.get("deputiesWithoutGroup") == 0, "deputiesWithoutGroup inatteso")
    require(coverage.get("seatCapacity") == 400, "seatCapacity Camera inattesa")
    require(coverage.get("vacantSeats") == 400 - len(deputies), "vacantSeats non riconcilia")
    require(coverage.get("deputiesWithPhoto") == len(deputies), "foto ufficiali incomplete")

    group_ids: set[str] = set()
    for group in groups:
        gid = group.get("id")
        require(isinstance(gid, str) and gid.startswith("gr") and gid not in group_ids, f"gruppo invalido: {gid}")
        group_ids.add(str(gid))
        require(str(group.get("uri") or "").endswith(f"/gruppoParlamentare.rdf/{gid}"), "group uri")
        require(isinstance(group.get("label"), str) and group["label"].strip(), "group label")
        require(isinstance(group.get("displayLabel"), str) and group["displayLabel"].strip(), "group displayLabel")
        require(isinstance(group.get("memberCount"), int) and group["memberCount"] >= 0, "memberCount")
        require(str(group.get("officialPage") or "").startswith(GROUP_PAGE_BASE), f"{gid}: pagina gruppo")

    organ_ids = {organ["id"] for organ in organs}
    require(len(organ_ids) == len(organs), "organi duplicati")

    deputy_ids: set[str] = set()
    president_count = 0
    for deputy in deputies:
        did = deputy.get("id")
        require(isinstance(did, str) and did.startswith("d") and did.endswith("_19"), f"deputy id: {did}")
        require(did not in deputy_ids, f"deputato duplicato: {did}")
        deputy_ids.add(str(did))
        numeric = str(deputy.get("numericId") or "")
        require(numeric.isdigit() and did == f"d{numeric}_19", f"{did}: numericId incoerente")
        require(str(deputy.get("uri") or "").endswith(f"/deputato.rdf/{did}"), "deputy uri")
        for field in ("firstName", "lastName", "displayName", "biography"):
            require(isinstance(deputy.get(field), str) and deputy[field].strip(), f"{did}.{field}")
        require(deputy.get("officialPage") == f"{PROFILE_BASE}{numeric}", f"{did}: officialPage fuori schema")
        require(deputy.get("photoUrl") == f"{PHOTO_BASE}{numeric}.jpg", f"{did}: photoUrl fuori schema")
        require(deputy.get("groupId") in group_ids, f"{did}: groupId sconosciuto")
        require(isinstance(deputy.get("groupLabel"), str) and deputy["groupLabel"].strip(), f"{did}.groupLabel")
        require(isinstance(deputy.get("groupDisplayLabel"), str) and deputy["groupDisplayLabel"].strip(), f"{did}.groupDisplayLabel")
        if deputy.get("groupRole") is not None:
            require(deputy["groupRole"] in GROUP_ROLE_RANK, f"{did}: groupRole inatteso")
            require(deputy.get("groupRoleLabel") == GROUP_ROLE_LABELS[deputy["groupRole"]], f"{did}: groupRoleLabel incoerente")
        for organ_id in deputy.get("organIds") or []:
            require(organ_id in organ_ids, f"{did}: organo sconosciuto {organ_id}")
        role = deputy.get("institutionalRole")
        if role is not None:
            require(role.get("role") in INSTITUTIONAL_ROLE_RANK, f"{did}: carica istituzionale inattesa")
            require(bool(ISO_DATE.match(str(role.get("since") or ""))), f"{did}: data carica invalida")
            require(bool(str(role.get("label") or "").strip()), f"{did}: etichetta carica assente")
            if role.get("role") == "PRESIDENTE" and str(role.get("organ") or "").upper() == CHAMBER_ORGAN_LABEL:
                president_count += 1
        if deputy.get("birthDate") is not None:
            require(bool(ISO_DATE.match(deputy["birthDate"])), f"{did}: birthDate non ISO")
        social = deputy.get("socialLinks")
        if social is not None:
            for platform, url in social.items():
                require(platform in set(SOCIAL_PLATFORMS.values()), f"{did}: social {platform} inatteso")
                require(urlparse(str(url)).scheme == "https", f"{did}: social non https")
    require(president_count == 1, f"Presidente della Camera non unico: {president_count}")

    for group in groups:
        counted = sum(1 for item in deputies if item.get("groupId") == group["id"])
        require(counted == group["memberCount"], f"{group['id']}: memberCount {group['memberCount']} != {counted}")
        president = group.get("presidentDeputyId")
        if president is not None:
            require(president in deputy_ids, f"{group['id']}: presidente sconosciuto")
    for organ in organs:
        counted = sum(1 for item in deputies if organ["id"] in (item.get("organIds") or []))
        require(counted == organ["memberCount"], f"{organ['id']}: memberCount non riconcilia")

    require(coverage.get("groupLeaders") == sum(1 for item in deputies if item.get("groupRole") == "PRESIDENTE"), "groupLeaders non riconcilia")
    require(coverage.get("institutionalRoles") == sum(1 for item in deputies if item.get("institutionalRole")), "institutionalRoles non riconcilia")
    for key in ("deputiesWithBirthDate", "deputiesWithConstituency"):
        require(coverage.get(key, 0) >= int(len(deputies) * 0.9), f"{key} sotto soglia di completezza")


# --------------------------------------------------------------------------- #
# Official fetching
# --------------------------------------------------------------------------- #


def sparql_fetch(query: str) -> tuple[dict[str, Any], bytes]:
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
            payload = json.loads(raw)
            require("results" in payload and "bindings" in payload["results"], "payload SPARQL senza bindings")
            return payload, raw
        except (urllib.error.URLError, json.JSONDecodeError) as error:
            last_error = error
            time.sleep(3 * (attempt + 1))
    raise SnapshotError(f"SPARQL Camera non raggiungibile: {last_error}")


def fetch_profile(numeric_id: str) -> bytes:
    request = urllib.request.Request(
        f"{PROFILE_BASE}{numeric_id}",
        headers={"User-Agent": USER_AGENT, "Accept": "text/html"},
        method="GET",
    )
    last_error: Exception | None = None
    for attempt in range(4):
        try:
            with urllib.request.urlopen(request, context=ssl.create_default_context(), timeout=90) as response:
                raw = response.read()
            require(len(raw) > 5000, f"d{numeric_id}: scheda troppo breve")
            return raw
        except urllib.error.URLError as error:
            last_error = error
            time.sleep(2 * (attempt + 1))
    raise SnapshotError(f"scheda d{numeric_id} non raggiungibile: {last_error}")


def fetch_profiles(numeric_ids: list[str]) -> tuple[dict[str, str], dict[str, Any]]:
    ordered = sorted(set(numeric_ids), key=int)
    with ThreadPoolExecutor(max_workers=6) as pool:
        raws = dict(zip(ordered, pool.map(fetch_profile, ordered)))
    digest = hashlib.sha256()
    total = 0
    for numeric_id in ordered:
        digest.update(raws[numeric_id])
        total += len(raws[numeric_id])
    return (
        {key: value.decode("utf-8", errors="replace") for key, value in raws.items()},
        {"count": len(ordered), "bytes": total, "sha256": digest.hexdigest()},
    )


def check_committed(spec: dict[str, Any]) -> None:
    payload = json.loads(OUTPUT.read_text(encoding="utf-8"))
    locks = (spec.get("source") or {}).get("committedResponses") or None
    validate_snapshot(payload, locks=locks)
    floor = spec.get("coverageFloor") or {}
    coverage = payload["coverage"]
    require(coverage["deputies"] >= int(floor.get("deputies", 390)), "coverage deputies sotto floor")
    require(coverage["groups"] >= int(floor.get("groups", 5)), "coverage groups sotto floor")
    require(coverage["organs"] >= int(floor.get("organs", 14)), "coverage organs sotto floor")
    print(
        f"OK politici-camera-xix: {coverage['deputies']} deputati, {coverage['groups']} gruppi, "
        f"{coverage['organs']} organi, {coverage['institutionalRoles']} cariche di presidenza"
    )


def refresh() -> dict[str, Any]:
    payloads: dict[str, dict[str, Any]] = {}
    raws: dict[str, bytes] = {}
    for key, query in QUERIES.items():
        payloads[key], raws[key] = sparql_fetch(query)
    numeric_ids = sorted({
        match.group(2)
        for row in payloads["roster"]["results"]["bindings"]
        if (uri := binding_value(row, "deputato")) and (match := DEPUTY_ID_RE.search(uri))
    }, key=int)
    require(len(numeric_ids) >= 390, f"deputati correnti insufficienti: {len(numeric_ids)}")
    profiles, digest = fetch_profiles(numeric_ids)
    return build_snapshot(payloads, raws, profiles, digest)


def main() -> int:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--check", action="store_true", help="valida lo snapshot committato senza rete")
    parser.add_argument("--write", action="store_true", help="scarica fonti Camera e riscrive lo snapshot")
    args = parser.parse_args()
    if args.check == args.write:
        raise SystemExit("specificare esattamente una azione: --check oppure --write")

    spec = load_spec()
    if args.check:
        check_committed(spec)
        return 0

    snapshot = refresh()
    OUTPUT.parent.mkdir(parents=True, exist_ok=True)
    OUTPUT.write_text(json.dumps(snapshot, ensure_ascii=False, indent=2) + "\n", encoding="utf-8")
    print(f"written {OUTPUT.relative_to(ROOT)} ({snapshot['coverage']['deputies']} deputies)")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
