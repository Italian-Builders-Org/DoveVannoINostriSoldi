#!/usr/bin/env python3
"""Senate XIX roster and dated group history from official dati.senato.it sources."""

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
from datetime import datetime, timezone
from html.parser import HTMLParser
from pathlib import Path
from typing import Any
from urllib.parse import urlparse

ROOT = Path(__file__).resolve().parents[2]
SPEC = ROOT / "scripts/etl/specs/politici-senato-xix.source.json"
OUTPUT = ROOT / "src/data/generated/politici-senato-xix.json"
DATASET = "politici-senato-xix"
LANDING = "https://dati.senato.it/DatiSenato/browse/composizione?legislatura=19&testo_generico=11"
GROUPS_LANDING = "https://dati.senato.it/DatiSenato/browse/6?legislatura=19&testo_generico=11&active_tab_78=80"
ENDPOINT = "https://dati.senato.it/DatiSenato/virtuoso_bridge/query/execute"
SPARQL_ENDPOINT = "https://dati.senato.it/sparql"
PRESIDENCY_ORGAN = "http://dati.senato.it/presidenza/19"
LICENSE_URL = "https://creativecommons.org/licenses/by/3.0/it/"
SENATOR_RE = re.compile(r"^http://dati\.senato\.it/senatore/(\d+)$")
GROUP_RE = re.compile(r"^http://dati\.senato\.it/gruppo/(\d+)$")
SHA_RE = re.compile(r"^[0-9a-f]{64}$")
DATE_RE = re.compile(r"^\d{4}-\d{2}-\d{2}$")
USER_AGENT = "DoveVannoINostriSoldi-ETL/1.0 (+https://github.com/Italian-Builders-Org/DoveVannoINostriSoldi)"

EXPECTED_HEADERS = {
    "legislatureRoster": [
        "senatore", "nome", "cognome", "sesso", "legislatura", "inizioMandato",
        "fineMandato", "tipoMandato", "tipoFineMandato", "dataNascita",
        "cittaNascita", "provinciaNascita", "nazioneNascita",
    ],
    "currentRoster": ["senatore", "nome", "cognome", "dataInizio", "dataFine"],
    "currentGroups": ["gruppo", "nomeGruppo", "senatore", "nome", "cognome", "carica", "inizioAdesione"],
    "profiles": ["senatore", "professione", "collegio", "regione", "tipoElezione", "carica", "inizioCarica"],
}

PROFILES_QUERY = """
PREFIX osr: <http://dati.senato.it/osr/>
PREFIX rdfs: <http://www.w3.org/2000/01/rdf-schema#>

SELECT DISTINCT ?senatore ?professione ?collegio ?regione ?tipoElezione ?carica ?inizioCarica
WHERE {
  ?senatore a osr:Senatore ;
            osr:mandato ?mandato .
  ?mandato osr:legislatura ?legislatura .
  FILTER(STR(?legislatura) = "19")
  FILTER NOT EXISTS { ?mandato osr:fine ?fineMandato }
  OPTIONAL { ?senatore osr:professione ?nodoProfessione . ?nodoProfessione rdfs:label ?professione }
  OPTIONAL { ?mandato osr:collegioElezione ?collegio }
  OPTIONAL { ?mandato osr:regioneElezione ?regione }
  OPTIONAL { ?mandato osr:tipoElezione ?tipoElezione }
  OPTIONAL {
    ?senatore osr:afferisce ?afferenza .
    ?afferenza osr:organo <http://dati.senato.it/presidenza/19> ;
               osr:carica ?carica ;
               osr:inizio ?inizioCarica .
    FILTER NOT EXISTS { ?afferenza osr:fine ?fineCarica }
  }
}
ORDER BY ?senatore
""".strip()

GROUP_MEMBERSHIPS_QUERY = """
PREFIX ocd: <http://dati.camera.it/ocd/>
PREFIX osr: <http://dati.senato.it/osr/>
SELECT DISTINCT ?senatore ?gruppo ?inizio ?fine WHERE {
  ?senatore a osr:Senatore ; ocd:aderisce ?adesione .
  ?adesione osr:legislatura 19 ; osr:gruppo ?gruppo ; osr:inizio ?inizio .
  OPTIONAL { ?adesione osr:fine ?fine }
}
ORDER BY ?senatore ?inizio
""".strip()

GROUP_NAMES_QUERY = """
PREFIX osr: <http://dati.senato.it/osr/>
SELECT DISTINCT ?gruppo ?inizio ?fine ?nome ?breve WHERE {
  ?adesione osr:legislatura 19 ; osr:gruppo ?gruppo .
  ?gruppo osr:denominazione ?denominazione .
  ?denominazione osr:inizio ?inizio ; osr:titolo ?nome .
  OPTIONAL { ?denominazione osr:fine ?fine }
  OPTIONAL { ?denominazione osr:titoloBreve ?breve }
}
ORDER BY ?gruppo ?inizio
""".strip()

SENATO_VOTES_OUTPUT = ROOT / "src/data/generated/senato-atti-voti-xix.json"
GROUP_HISTORY_HEADERS = {
    "memberships": ["senatore", "gruppo", "inizio", "fine"],
    "names": ["gruppo", "inizio", "fine", "nome", "breve"],
}

GROUP_ROLE_LABELS = {
    "Presidente": "Presidente del gruppo",
    "Vicepresidente Vicario": "Vicepresidente vicario del gruppo",
    "Vicepresidente": "Vicepresidente del gruppo",
    "Tesoriere": "Tesoriere del gruppo",
    "Segretario": "Segretario del gruppo",
    "Segretario d'Aula": "Segretario d'Aula del gruppo",
    "Membro": None,
}
GROUP_ROLE_RANK = {role: index for index, role in enumerate(GROUP_ROLE_LABELS)}

MONTHS_IT = (
    "gennaio", "febbraio", "marzo", "aprile", "maggio", "giugno",
    "luglio", "agosto", "settembre", "ottobre", "novembre", "dicembre",
)


def italian_long_date(iso: str) -> str:
    year, month, day = (int(part) for part in iso.split("-"))
    return f"{day} {MONTHS_IT[month - 1]} {year}"


ELECTION_METHODS = {
    "Eletto uninominale dalla XVIII legislatura": "uninominale",
    "Eletto proporzionale dalla XVIII legislatura": "proporzionale",
    "circoscrizioni estere": "circoscrizione-estero",
}

PRESIDENCY_ROLE_RANK = {
    "Presidente del Senato": 0,
    "Vice Presidente del Senato": 1,
    "Questore del Senato": 2,
    "Segretario della Presidenza del Senato": 3,
}


class SnapshotError(ValueError):
    """Official response or committed artifact failed validation."""


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
    require(source.get("groupsLandingUrl") == GROUPS_LANDING, "groups landing diverge")
    require(source.get("endpointUrl") == ENDPOINT, "endpoint diverge")
    require(source.get("licenseUrl") == LICENSE_URL, "license URL diverge")
    return spec


def value(row: dict[str, Any], key: str) -> str | None:
    cell = row.get(key)
    if not isinstance(cell, dict):
        return None
    raw = cell.get("value")
    return raw.strip() if isinstance(raw, str) and raw.strip() else None


def parse_id(uri: str, pattern: re.Pattern[str], kind: str) -> str:
    match = pattern.match(uri)
    require(match is not None, f"{kind} URI non riconosciuto: {uri}")
    assert match is not None
    return match.group(1)


def bindings(payload: dict[str, Any], source_id: str, headers: dict[str, list[str]] = EXPECTED_HEADERS) -> list[dict[str, Any]]:
    head = payload.get("head") or {}
    require(head.get("vars") == headers[source_id], f"{source_id}: schema inatteso")
    rows = (payload.get("results") or {}).get("bindings")
    require(isinstance(rows, list) and rows, f"{source_id}: righe assenti")
    return rows


def attach_group_history(snapshot: dict[str, Any]) -> None:
    payloads: dict[str, dict[str, Any]] = {}
    raws: dict[str, bytes] = {}
    for key, query in (("memberships", GROUP_MEMBERSHIPS_QUERY), ("names", GROUP_NAMES_QUERY)):
        payloads[key], raws[key] = fetch_sparql(query)

    memberships = set()
    for row in bindings(payloads["memberships"], "memberships", GROUP_HISTORY_HEADERS):
        senator = value(row, "senatore")
        group = value(row, "gruppo")
        start = value(row, "inizio")
        require(senator is not None and group is not None and start is not None, "adesione incompleta")
        memberships.add((
            parse_id(senator, SENATOR_RE, "senatore"),
            f"g{parse_id(group, GROUP_RE, 'gruppo')}",
            start,
            value(row, "fine"),
        ))

    names = set()
    for row in bindings(payloads["names"], "names", GROUP_HISTORY_HEADERS):
        group = value(row, "gruppo")
        start = value(row, "inizio")
        label = value(row, "nome")
        end = value(row, "fine")
        require(group is not None and start is not None and label is not None, "denominazione incompleta")
        if end is not None and end < snapshot["legislature"]["startDate"]:
            continue
        names.add((f"g{parse_id(group, GROUP_RE, 'gruppo')}", label, value(row, "breve"), start, end))

    snapshot["groupMemberships"] = [
        {"senatorId": sid, "groupId": gid, "startDate": start, "endDate": end}
        for sid, gid, start, end in sorted(memberships, key=lambda item: (item[0], item[2], item[1], item[3] or ""))
    ]
    snapshot["groupNames"] = [
        {"groupId": gid, "label": label, "shortLabel": short, "startDate": start, "endDate": end}
        for gid, label, short, start, end in sorted(names, key=lambda item: (item[0], item[3], item[1]))
    ]
    acquired_at = datetime.now(timezone.utc).replace(microsecond=0)
    snapshot["source"]["groupHistory"] = {
        "endpointUrl": SPARQL_ENDPOINT,
        "observedDate": acquired_at.date().isoformat(),
        "acquiredAt": acquired_at.isoformat(),
        "responses": {key: {"bytes": len(raw), "sha256": sha256_bytes(raw)} for key, raw in raws.items()},
    }
    validate_group_history(snapshot)


def validate_group_history(snapshot: dict[str, Any], locks: dict[str, Any] | None = None) -> None:
    memberships = snapshot.get("groupMemberships")
    names = snapshot.get("groupNames")
    require(isinstance(memberships, list) and memberships, "appartenenze storiche assenti")
    require(isinstance(names, list) and names, "denominazioni storiche assenti")
    history = (snapshot.get("source") or {}).get("groupHistory") or {}
    require(history.get("endpointUrl") == SPARQL_ENDPOINT, "fonte storia gruppi divergente")
    require(DATE_RE.fullmatch(str(history.get("observedDate") or "")) is not None, "data storia gruppi invalida")
    responses = history.get("responses") or {}
    require(set(responses) == set(GROUP_HISTORY_HEADERS), "risposte storia gruppi incomplete")
    for key, response in responses.items():
        require(isinstance(response.get("bytes"), int) and response["bytes"] > 0, f"{key}.bytes")
        require(SHA_RE.fullmatch(str(response.get("sha256") or "")) is not None, f"{key}.sha256")
        if locks is not None:
            require(response == locks.get(key), f"{key}: source lock diverge")

    def valid_interval(row: dict[str, Any]) -> bool:
        start, end = row.get("startDate"), row.get("endDate")
        return (isinstance(start, str) and DATE_RE.fullmatch(start) is not None
                and (end is None or isinstance(end, str) and DATE_RE.fullmatch(end) is not None and start <= end))

    for row in [*memberships, *names]:
        require(isinstance(row, dict) and valid_interval(row), "intervallo storico invalido")
    group_ids = {row["groupId"] for row in names}
    require(all(row.get("groupId") in group_ids for row in memberships), "adesione senza denominazione")

    by_senator: dict[str, list[dict[str, Any]]] = defaultdict(list)
    by_group: dict[str, list[dict[str, Any]]] = defaultdict(list)
    for row in memberships:
        require(re.fullmatch(r"\d+", str(row.get("senatorId") or "")) is not None, "id senatore storico invalido")
        by_senator[row["senatorId"]].append(row)
    for row in names:
        require(isinstance(row.get("label"), str) and row["label"], "denominazione storica invalida")
        by_group[row["groupId"]].append(row)

    votes = json.loads(SENATO_VOTES_OUTPUT.read_text(encoding="utf-8"))["finalVotes"]
    for vote in votes:
        date = vote["date"]
        for senator_id in vote["votes"]:
            groups = {row["groupId"] for row in by_senator[senator_id]
                      if row["startDate"] <= date <= (row["endDate"] or "9999-12-31")}
            require(len(groups) == 1, f"{vote['id']}: gruppo storico non determinabile per {senator_id}")
            labels = [row for row in by_group[next(iter(groups))]
                      if row["startDate"] <= date <= (row["endDate"] or "9999-12-31")]
            require(len(labels) == 1, f"{vote['id']}: denominazione storica non determinabile")


def build_snapshot(
    payloads: dict[str, dict[str, Any]],
    raw_responses: dict[str, bytes],
    *,
    observed_date: str,
) -> dict[str, Any]:
    require(DATE_RE.match(observed_date) is not None, "observedDate non ISO")
    current_rows = bindings(payloads["currentRoster"], "currentRoster")
    detail_rows = bindings(payloads["legislatureRoster"], "legislatureRoster")
    group_rows = bindings(payloads["currentGroups"], "currentGroups")

    current: dict[str, dict[str, Any]] = {}
    for row in current_rows:
        uri = value(row, "senatore")
        require(uri is not None, "currentRoster: senatore assente")
        assert uri is not None
        sid = parse_id(uri, SENATOR_RE, "senatore")
        require(sid not in current, f"currentRoster: senatore duplicato {sid}")
        require(value(row, "dataFine") is None, f"currentRoster: mandato concluso {sid}")
        current[sid] = row

    details: dict[str, dict[str, Any]] = {}
    for row in detail_rows:
        uri = value(row, "senatore")
        require(uri is not None, "legislatureRoster: senatore assente")
        assert uri is not None
        sid = parse_id(uri, SENATOR_RE, "senatore")
        require(sid not in details, f"legislatureRoster: identità duplicata {sid}")
        details[sid] = row
    require(set(current).issubset(details), "senatori correnti senza dati anagrafici")

    memberships: dict[str, list[dict[str, Any]]] = defaultdict(list)
    for row in group_rows:
        uri = value(row, "senatore")
        require(uri is not None, "currentGroups: senatore assente")
        assert uri is not None
        memberships[parse_id(uri, SENATOR_RE, "senatore")].append(row)
    require(set(memberships) == set(current), "roster corrente e composizione gruppi non riconciliano")

    profiles: dict[str, dict[str, Any]] = {}
    for row in bindings(payloads["profiles"], "profiles"):
        uri = value(row, "senatore")
        require(uri is not None, "profiles: senatore assente")
        assert uri is not None
        sid = parse_id(uri, SENATOR_RE, "senatore")
        if sid not in current:
            continue
        entry = profiles.setdefault(sid, {
            "professions": set(), "colleges": set(), "regions": set(),
            "electionTypes": set(), "charges": {},
        })
        for key, bucket in (
            ("professione", "professions"), ("collegio", "colleges"),
            ("regione", "regions"), ("tipoElezione", "electionTypes"),
        ):
            if (cell := value(row, key)) is not None:
                entry[bucket].add(" ".join(cell.split()))
        charge = value(row, "carica")
        if charge is not None:
            normalized = " ".join(charge.split())
            require(normalized in PRESIDENCY_ROLE_RANK, f"{sid}: carica di presidenza inattesa {normalized!r}")
            entry["charges"][normalized] = value(row, "inizioCarica")
    require(set(profiles) == set(current), "profili SPARQL e roster corrente non riconciliano")

    senators: list[dict[str, Any]] = []
    group_counts: Counter[str] = Counter()
    group_meta: dict[str, dict[str, str]] = {}
    life_senators = 0
    elected_senators = 0
    presidency_roles: dict[str, int] = {}

    for sid in sorted(current, key=lambda item: (
        (value(details[item], "cognome") or "").casefold(),
        (value(details[item], "nome") or "").casefold(),
        int(item),
    )):
        detail = details[sid]
        rows = memberships[sid]
        group_ids = {
            parse_id(group_uri, GROUP_RE, "gruppo")
            for row in rows
            if (group_uri := value(row, "gruppo"))
        }
        require(len(group_ids) == 1, f"{sid}: gruppi correnti ambigui {sorted(group_ids)}")
        gid = next(iter(group_ids))
        labels = {label for row in rows if (label := value(row, "nomeGruppo"))}
        require(len(labels) == 1, f"{sid}: etichette gruppo ambigue")
        label = next(iter(labels))
        charges = {charge for row in rows if (charge := value(row, "carica"))}
        for charge in charges:
            require(charge in GROUP_ROLE_RANK, f"{sid}: carica di gruppo inattesa {charge!r}")
        group_role = min(charges, key=lambda item: GROUP_ROLE_RANK[item]) if charges else None
        group_role_label = GROUP_ROLE_LABELS.get(group_role or "")
        group_uri = f"http://dati.senato.it/gruppo/{gid}"
        group_meta[gid] = {"uri": group_uri, "label": label}
        group_counts[gid] += 1

        first = value(detail, "nome")
        last = value(detail, "cognome")
        mandate_type = value(detail, "tipoMandato")
        require(first is not None and last is not None and mandate_type is not None, f"{sid}: identità incompleta")
        assert first and last and mandate_type
        is_life = "vita" in mandate_type.casefold()
        life_senators += int(is_life)
        elected_senators += int(not is_life)
        birth_date = value(detail, "dataNascita")
        birth_city = value(detail, "cittaNascita")
        birth_province = value(detail, "provinciaNascita")
        birth_country = value(detail, "nazioneNascita")
        # The export repeats the province when it matches the city and always states the country.
        place_parts = [birth_city]
        if birth_province and birth_province.casefold() != (birth_city or "").casefold():
            place_parts.append(birth_province)
        if birth_country and birth_country.casefold() != "italia":
            place_parts.append(birth_country)
        birthplace = ", ".join(part for part in place_parts if part)

        profile = profiles[sid]
        require(len(profile["colleges"]) <= 1, f"{sid}: collegi divergenti {sorted(profile['colleges'])}")
        require(len(profile["regions"]) <= 1, f"{sid}: regioni divergenti {sorted(profile['regions'])}")
        require(len(profile["electionTypes"]) <= 1, f"{sid}: tipi elezione divergenti")
        # The Senate publishes several wordings of the same profession: keep the most specific one.
        profession = (
            max(sorted(profile["professions"]), key=len) if profile["professions"] else None
        )
        college = next(iter(profile["colleges"]), None)
        region = next(iter(profile["regions"]), None)
        election_type = next(iter(profile["electionTypes"]), None)
        if election_type is not None:
            require(election_type in ELECTION_METHODS, f"{sid}: tipo elezione inatteso {election_type!r}")
        election_method = ELECTION_METHODS.get(election_type or "")
        institutional_role = None
        if profile["charges"]:
            top = min(profile["charges"], key=lambda item: PRESIDENCY_ROLE_RANK[item])
            institutional_role = {"role": top, "label": top, "since": profile["charges"][top]}
            presidency_roles[top] = presidency_roles.get(top, 0) + 1

        female = (value(detail, "sesso") or "").casefold().startswith("f")
        if institutional_role is not None:
            headline = f"{institutional_role['label']} nella XIX legislatura."
        elif is_life:
            headline = f"{'Senatrice' if female else 'Senatore'} a vita."
        else:
            headline = f"{'Senatrice' if female else 'Senatore'} della XIX legislatura."
        bio_parts = [headline, f"Gruppo {label}" + (f", con incarico di {group_role_label.casefold()}" if group_role_label else "") + "."]
        if region:
            where = f"{'Eletta' if female else 'Eletto'} in {region}"
            if college:
                where += f" ({college})"
            bio_parts.append(where + ".")
        if birth_date and birthplace:
            born = "Nata" if female else "Nato"
            bio_parts.append(f"{born} a {birthplace} il {italian_long_date(birth_date)}.")
        if profession:
            bio_parts.append(f"Professione dichiarata: {profession}.")

        senators.append({
            "id": f"s{sid}",
            "uri": f"http://dati.senato.it/senatore/{sid}",
            "firstName": first,
            "lastName": last,
            "displayName": f"{first} {last}",
            "gender": value(detail, "sesso"),
            "officialPage": f"https://www.senato.it/composizione/senatori/elenco-alfabetico/scheda-attivita?did={sid}",
            "photoUrl": f"https://www.senato.it/leg/19/Immagini/Senatori/{int(sid):08d}.jpg",
            "groupId": f"g{gid}",
            "groupLabel": label,
            "groupRole": group_role if group_role_label else None,
            "groupRoleLabel": group_role_label,
            "institutionalRole": institutional_role,
            "mandateType": mandate_type,
            "isLifeSenator": is_life,
            "electionType": election_type,
            "electionMethod": election_method,
            "region": region,
            "college": college,
            "profession": profession,
            "birthDate": birth_date,
            "birthPlace": birthplace or None,
            "biography": " ".join(bio_parts),
        })

    groups = [
        {
            "id": f"g{gid}",
            "uri": group_meta[gid]["uri"],
            "label": group_meta[gid]["label"],
            "memberCount": count,
            "presidentSenatorId": (
                presidents[0] if len(presidents := [
                    senator["id"] for senator in senators
                    if senator["groupId"] == f"g{gid}" and senator.get("groupRole") == "Presidente"
                ]) == 1 else None
            ),
        }
        for gid, count in sorted(group_counts.items(), key=lambda item: (-item[1], group_meta[item[0]]["label"]))
    ]
    response_meta = {
        key: {"bytes": len(raw), "sha256": sha256_bytes(raw)}
        for key, raw in raw_responses.items()
    }
    snapshot = {
        "schemaVersion": 1,
        "chamber": "senato",
        "legislature": {
            "id": "19",
            "label": "XIX Legislatura",
            "uri": "http://dati.senato.it/legislatura/19",
            "startDate": "2022-10-13",
        },
        "coverage": {
            "senators": len(senators),
            "groups": len(groups),
            "senatorsWithGroup": len(senators),
            "electedSenators": elected_senators,
            "lifeSenators": life_senators,
            "electedSeatCapacity": 200,
            "vacantElectedSeats": 200 - elected_senators,
            "senatorsWithPhoto": len(senators),
            "senatorsWithProfession": sum(1 for item in senators if item["profession"]),
            "senatorsWithRegion": sum(1 for item in senators if item["region"]),
            "groupLeaders": sum(1 for item in senators if item.get("groupRole") == "Presidente"),
            "presidencyRoles": sum(1 for item in senators if item["institutionalRole"]),
        },
        "source": {
            "owner": "Senato della Repubblica",
            "title": "dati.senato.it — Composizione, profili e Consiglio di Presidenza",
            "endpointUrl": ENDPOINT,
            "sparqlEndpointUrl": SPARQL_ENDPOINT,
            "presidencyOrganUri": PRESIDENCY_ORGAN,
            "landingUrl": LANDING,
            "groupsLandingUrl": GROUPS_LANDING,
            "license": "CC BY 3.0 (dichiarata dal portale dati.senato.it)",
            "licenseUrl": LICENSE_URL,
            "observedDate": observed_date,
            "acquiredAt": datetime.now(timezone.utc).replace(microsecond=0).isoformat(),
            "responses": response_meta,
            "cadence": "aggiornamento quotidiano dichiarato dal portale",
        },
        "caveats": [
            "Copre i senatori in carica alla data osservata, inclusi i senatori a vita; gli ex senatori della XIX legislatura non occupano seggi nell'emiciclo.",
            "Le cariche multiple nello stesso gruppo sono deduplicate per URI ufficiale del senatore; gruppi diversi per la stessa persona bloccano l'import.",
            "La descrizione combina soltanto dati anagrafici, tipo di mandato, gruppo, collegio e professione pubblicati dal Senato; non è una biografia editoriale.",
            "Il Senato pubblica più formulazioni della stessa professione: viene tenuta la più specifica, senza fondere valori diversi.",
            "I senatori a vita non hanno regione o collegio di elezione: il campo resta vuoto e non viene riempito per analogia.",
            "Le cariche esposte sono quelle senza data di fine: Consiglio di Presidenza dal grafo SPARQL, incarichi di gruppo dall'export ufficiale.",
            "I soldi pubblici non sono presenti in questo snapshot.",
        ],
        "groups": groups,
        "senators": senators,
    }
    validate_snapshot(snapshot)
    return snapshot


def validate_snapshot(payload: dict[str, Any], locks: dict[str, Any] | None = None) -> None:
    require(payload.get("schemaVersion") == 1 and payload.get("chamber") == "senato", "schema/chamber inattesi")
    coverage = payload.get("coverage") or {}
    senators = payload.get("senators") or []
    groups = payload.get("groups") or []
    require(isinstance(senators, list) and 200 <= len(senators) <= 210, "coverage senatori fuori intervallo")
    require(isinstance(groups, list) and 5 <= len(groups) <= 15, "coverage gruppi fuori intervallo")
    require(coverage.get("senators") == len(senators), "coverage.senators non riconcilia")
    require(coverage.get("groups") == len(groups), "coverage.groups non riconcilia")
    require(coverage.get("senatorsWithGroup") == len(senators), "senatori senza gruppo")
    require(coverage.get("electedSenators", 0) + coverage.get("lifeSenators", 0) == len(senators), "tipi mandato non riconciliano")
    require(coverage.get("vacantElectedSeats") == 200 - coverage.get("electedSenators", 0), "seggi elettivi non riconciliano")

    group_ids = {group.get("id") for group in groups}
    require(len(group_ids) == len(groups), "gruppi duplicati")
    senator_ids = {senator.get("id") for senator in senators}
    require(len(senator_ids) == len(senators), "senatori duplicati")
    presidents = 0
    for senator in senators:
        sid = senator.get("id")
        require(senator.get("groupId") in group_ids, f"{sid}: gruppo sconosciuto")
        for key in ("uri", "officialPage", "photoUrl"):
            parsed = urlparse(str(senator.get(key) or ""))
            require(parsed.scheme in {"http", "https"} and bool(parsed.netloc), f"{sid}.{key}")
        require(isinstance(senator.get("biography"), str) and senator["biography"], f"{sid}: bio assente")
        role = senator.get("groupRole")
        if role is not None:
            require(role in GROUP_ROLE_RANK and GROUP_ROLE_LABELS[role], f"{sid}: groupRole inatteso")
            require(senator.get("groupRoleLabel") == GROUP_ROLE_LABELS[role], f"{sid}: groupRoleLabel incoerente")
        charge = senator.get("institutionalRole")
        if charge is not None:
            require(charge.get("role") in PRESIDENCY_ROLE_RANK, f"{sid}: carica di presidenza inattesa")
            require(DATE_RE.match(str(charge.get("since") or "")) is not None, f"{sid}: data carica invalida")
            if charge.get("role") == "Presidente del Senato":
                presidents += 1
        if senator.get("isLifeSenator"):
            require(senator.get("region") is None, f"{sid}: senatore a vita con regione di elezione")
        method = senator.get("electionMethod")
        if method is not None:
            require(method in set(ELECTION_METHODS.values()), f"{sid}: electionMethod inatteso")
            require(ELECTION_METHODS.get(str(senator.get("electionType"))) == method, f"{sid}: electionMethod incoerente")
    require(presidents == 1, f"Presidente del Senato non unico: {presidents}")

    for group in groups:
        count = sum(1 for senator in senators if senator.get("groupId") == group.get("id"))
        require(group.get("memberCount") == count, f"{group.get('id')}: memberCount non riconcilia")
        president = group.get("presidentSenatorId")
        if president is not None:
            require(president in senator_ids, f"{group.get('id')}: presidente sconosciuto")

    require(coverage.get("senatorsWithPhoto") == len(senators), "foto ufficiali incomplete")
    require(coverage.get("presidencyRoles") == sum(1 for item in senators if item.get("institutionalRole")), "presidencyRoles non riconcilia")
    require(coverage.get("groupLeaders") == sum(1 for item in senators if item.get("groupRole") == "Presidente"), "groupLeaders non riconcilia")
    require(coverage.get("senatorsWithProfession", 0) >= int(len(senators) * 0.9), "professioni sotto soglia")

    source = payload.get("source") or {}
    require(source.get("landingUrl") == LANDING and source.get("endpointUrl") == ENDPOINT, "provenance diverge")
    require(source.get("sparqlEndpointUrl") == SPARQL_ENDPOINT, "endpoint SPARQL diverge")
    require(source.get("presidencyOrganUri") == PRESIDENCY_ORGAN, "organo di presidenza diverge")
    require(source.get("licenseUrl") == LICENSE_URL, "licenza diverge")
    require(DATE_RE.match(str(source.get("observedDate") or "")) is not None, "observedDate invalida")
    responses = source.get("responses") or {}
    require(set(responses) == set(EXPECTED_HEADERS), "response set inatteso")
    for key, response in responses.items():
        require(isinstance(response.get("bytes"), int) and response["bytes"] > 0, f"{key}.bytes")
        require(SHA_RE.match(str(response.get("sha256") or "")) is not None, f"{key}.sha256")
        if locks:
            require(response == locks.get(key), f"{key}: source lock diverge")


class TokenParser(HTMLParser):
    def __init__(self) -> None:
        super().__init__()
        self.token: str | None = None

    def handle_starttag(self, tag: str, attrs: list[tuple[str, str | None]]) -> None:
        values = dict(attrs)
        if tag == "input" and values.get("name") == "authenticity_token" and values.get("value"):
            self.token = values["value"]


def request(url: str, data: bytes | None = None) -> bytes:
    req = urllib.request.Request(
        url,
        data=data,
        headers={
            "User-Agent": USER_AGENT,
            "Accept": "application/json,text/html",
            "Content-Type": "application/x-www-form-urlencoded; charset=utf-8",
        },
        method="POST" if data is not None else "GET",
    )
    last_error: Exception | None = None
    for attempt in range(4):
        try:
            with urllib.request.urlopen(req, context=ssl.create_default_context(), timeout=120) as response:
                return response.read()
        except urllib.error.URLError as error:
            last_error = error
            time.sleep(3 * (attempt + 1))
    raise SnapshotError(f"fonte Senato non raggiungibile: {last_error}")


def fetch_export(landing_url: str, fields: dict[str, str]) -> tuple[dict[str, Any], bytes]:
    page = request(landing_url)
    parser = TokenParser()
    parser.feed(page.decode("utf-8"))
    require(parser.token is not None, "token export Senato assente")
    body = urllib.parse.urlencode({
        "authenticity_token": parser.token,
        **fields,
        "query_format": "json",
        "commit": "Download",
    }).encode("utf-8")
    raw = request(ENDPOINT, body)
    try:
        return json.loads(raw), raw
    except json.JSONDecodeError as error:
        raise SnapshotError("export Senato non JSON") from error


def fetch_sparql(query: str) -> tuple[dict[str, Any], bytes]:
    url = f"{SPARQL_ENDPOINT}?" + urllib.parse.urlencode({
        "query": query,
        "format": "application/sparql-results+json",
    })
    req = urllib.request.Request(
        url,
        headers={"User-Agent": USER_AGENT, "Accept": "application/sparql-results+json"},
        method="GET",
    )
    try:
        with urllib.request.urlopen(req, context=ssl.create_default_context(), timeout=180) as response:
            raw = response.read()
    except urllib.error.URLError as error:
        raise SnapshotError(f"SPARQL Senato non raggiungibile: {error}") from error
    try:
        return json.loads(raw), raw
    except json.JSONDecodeError as error:
        raise SnapshotError("SPARQL Senato non JSON") from error


def refresh(spec: dict[str, Any]) -> dict[str, Any]:
    observed_date = datetime.now(timezone.utc).date().isoformat()
    exports = {
        "legislatureRoster": (LANDING, {"alias": "senatori-legislatura", "id": "2", "legislatura": "19", "search[legislatura]": "19"}),
        "currentRoster": (LANDING, {"alias": "senatori-carica-data", "id": "16", "legislatura": "19", "search[data]": observed_date}),
        "currentGroups": (GROUPS_LANDING, {"alias": "composizione-gruppi-data", "id": "3", "legislatura": "19", "active_tab[active_tab_78]": "80", "search[data]": observed_date}),
    }
    payloads: dict[str, dict[str, Any]] = {}
    raws: dict[str, bytes] = {}
    for key, (landing, fields) in exports.items():
        payloads[key], raws[key] = fetch_export(landing, fields)
    payloads["profiles"], raws["profiles"] = fetch_sparql(PROFILES_QUERY)
    snapshot = build_snapshot(payloads, raws, observed_date=observed_date)
    attach_group_history(snapshot)
    return snapshot


def check_committed(spec: dict[str, Any]) -> None:
    payload = json.loads(OUTPUT.read_text(encoding="utf-8"))
    locks = (spec.get("source") or {}).get("committedResponses") or {}
    history_locks = (spec.get("source") or {}).get("groupHistoryResponses") or {}
    require(set(history_locks) == set(GROUP_HISTORY_HEADERS), "source lock storia gruppi assente")
    validate_snapshot(payload, locks=locks)
    validate_group_history(payload, locks=history_locks)
    require(payload["source"]["observedDate"] == spec["period"]["observedDate"], "period observedDate diverge")
    require(payload["coverage"]["senators"] >= spec["coverageFloor"]["senators"], "coverage senators sotto floor")
    require(payload["coverage"]["groups"] >= spec["coverageFloor"]["groups"], "coverage groups sotto floor")
    print(f"OK politici-senato-xix: {payload['coverage']['senators']} senatori, {payload['coverage']['groups']} gruppi")


def main() -> int:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--check", action="store_true")
    parser.add_argument("--write", action="store_true")
    parser.add_argument("--write-history", action="store_true")
    args = parser.parse_args()
    if sum((args.check, args.write, args.write_history)) != 1:
        raise SystemExit("specificare esattamente --check, --write oppure --write-history")
    spec = load_spec()
    if args.check:
        check_committed(spec)
        return 0
    if args.write_history:
        snapshot = json.loads(OUTPUT.read_text(encoding="utf-8"))
        validate_snapshot(snapshot, locks=(spec.get("source") or {}).get("committedResponses"))
        attach_group_history(snapshot)
    else:
        snapshot = refresh(spec)
    OUTPUT.write_text(json.dumps(snapshot, ensure_ascii=False, indent=2) + "\n", encoding="utf-8")
    print(f"written {OUTPUT.relative_to(ROOT)} ({snapshot['coverage']['senators']} senators)")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
