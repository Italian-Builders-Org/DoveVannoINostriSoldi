#!/usr/bin/env python3
"""Senato XIX bills signed by senators, their phases and final nominal votes.

Each ``osr:Ddl`` node on dati.senato.it is one *phase* of a bill; the snapshot
unit is the bill (``osr:idDdl``). Parliamentary-initiative bills whose first
phase was presented at the Senate with a senator as first signer are kept,
with every phase, the current outcome and the final nominal votes.

The endpoint accepts GET only (POST is refused by the WAF, which also rejects
``BIND``/``IF``); literals are compared through ``STR(?x) = "..."``. Offline
``--check`` validates the committed artifact; ``--write`` refreshes from the
official source and fails closed on empty, duplicate, unmapped or unreconciled
coverage.
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

ROOT = Path(__file__).resolve().parents[2]
SPEC = ROOT / "scripts/etl/specs/senato-atti-voti-xix.source.json"
OUTPUT = ROOT / "src/data/generated/senato-atti-voti-xix.json"
DATASET = "senato-atti-voti-xix"
LEGISLATURE_URI = "http://dati.senato.it/legislatura/19"
LEGISLATURE_START = "2022-10-13"
ENDPOINT = "https://dati.senato.it/sparql"
LANDING = "https://dati.senato.it/"
LICENSE_URL = "https://creativecommons.org/licenses/by/3.0/it/"
DDL_PAGE_BASE = "https://www.senato.it/leg/19/BGT/Schede/Ddliter/{id_ddl}.htm"
USER_AGENT = "DoveVannoINostriSoldi-ETL/1.0 (+https://github.com/Italian-Builders-Org/DoveVannoINostriSoldi)"
FETCH_TIMEOUT = 300
FETCH_ATTEMPTS = 4
NOMINAL_VOTE_WORKERS = 4
PAGE_SIZE = 5000
ENDPOINT_ROW_CAP = 10000

SHA_RE = re.compile(r"^[0-9a-f]{64}$")
ISO_DATE = re.compile(r"^\d{4}-\d{2}-\d{2}$")
ACT_ID_RE = re.compile(r"^ddl-(\d+)$")
DDL_URI_RE = re.compile(r"/ddl/(\d+)$")
SENATORE_URI_RE = re.compile(r"/senatore/(\d+)$")
VOTE_ID_RE = re.compile(r"/votazione/(\d+-\d+-\d+)$")
SESSION_URI_RE = re.compile(r"/seduta(?:assemblea|commissione)/(\S+)$")

NATURE_IDS = ("ordinaria", "costituzionale")
PHASE_KINDS = ("presentato", "trasmesso")

OSR_PREFIX = """PREFIX osr: <http://dati.senato.it/osr/>
PREFIX rdfs: <http://www.w3.org/2000/01/rdf-schema#>
"""

QUERIES = {
    # One row per phase node of every bill that has a senator as first signer
    # on at least one phase; perimeter rules are applied while parsing.
    "phases": OSR_PREFIX + """
SELECT DISTINCT ?ddl ?id ?idFase ?fase ?ramo ?prog ?pt ?stato ?statoData ?dataPres ?natura ?titolo
WHERE {
  ?ddl a osr:Ddl ; osr:legislatura 19 ; osr:idDdl ?id ; osr:idFase ?idFase ; osr:fase ?fase ; osr:ramo ?ramo ;
       osr:progressivoIter ?prog ; osr:presentatoTrasmesso ?pt ; osr:statoDdl ?stato .
  ?any a osr:Ddl ; osr:idDdl ?id ; osr:iniziativa ?ini .
  ?ini osr:primoFirmatario 1 ; osr:senatore ?sen .
  OPTIONAL { ?ddl osr:dataStatoDdl ?statoData }
  OPTIONAL { ?ddl osr:dataPresentazione ?dataPres }
  OPTIONAL { ?ddl osr:natura ?natura }
  OPTIONAL { ?ddl osr:titolo ?titolo }
}
ORDER BY ?ddl
""".strip(),
    # osr:primoFirmatario exists only on the first signer's initiative node
    # (absent on co-signers), so it must be OPTIONAL to collect every signer.
    "signers": OSR_PREFIX + """
SELECT DISTINCT ?ddl ?sen ?primo ?tipo
WHERE {
  ?ddl a osr:Ddl ; osr:legislatura 19 ; osr:idDdl ?id ; osr:iniziativa ?ini .
  ?ini osr:senatore ?sen .
  OPTIONAL { ?ini osr:primoFirmatario ?primo }
  OPTIONAL { ?ini osr:tipoIniziativa ?tipo }
  ?any a osr:Ddl ; osr:idDdl ?id ; osr:iniziativa ?ini2 .
  ?ini2 osr:primoFirmatario 1 ; osr:senatore ?sen2 .
}
ORDER BY ?ddl ?sen
""".strip(),
    "finalVotes": OSR_PREFIX + """
SELECT DISTINCT ?v ?label ?esito ?fav ?con ?ast ?pres ?vot ?magg ?tv ?seduta ?ddl ?id
WHERE {
  ?v a osr:Votazione ; osr:legislatura 19 ; rdfs:label ?label ; osr:esito ?esito ; osr:favorevoli ?fav ; osr:contrari ?con ;
     osr:astenuti ?ast ; osr:presenti ?pres ; osr:votanti ?vot ; osr:maggioranza ?magg ; osr:tipoVotazione ?tv ;
     osr:seduta ?seduta ; osr:oggetto ?ogg .
  ?ogg osr:relativoA ?ddl . ?ddl osr:idDdl ?id .
  FILTER(CONTAINS(LCASE(STR(?label)), "finale"))
}
ORDER BY ?v
""".strip(),
    # All XIX bills with at least one initiative: baseline used to count the
    # disegni without a senator first signer excluded from the perimeter.
    "disegniXix": OSR_PREFIX + """
SELECT (COUNT(DISTINCT ?id) AS ?n)
WHERE {
  ?ddl a osr:Ddl ; osr:legislatura 19 ; osr:idDdl ?id ; osr:iniziativa ?ini .
}
""".strip(),
    # Session dates for the vote's osr:seduta link (osr:dataSeduta).
    "sessions": OSR_PREFIX + """
SELECT DISTINCT ?seduta ?data ?numero
WHERE {
  ?seduta osr:legislatura 19 ; osr:dataSeduta ?data .
  OPTIONAL { ?seduta osr:numeroSeduta ?numero }
}
ORDER BY ?seduta
""".strip(),
}

NOMINAL_VOTE_QUERY = OSR_PREFIX + """
SELECT DISTINCT ?p ?sen
WHERE {
  <VOT_URI> ?p ?sen .
  FILTER(?p IN (osr:favorevole, osr:contrario, osr:astenuto, osr:presenteNonVotante, osr:inCongedoMissione))
}
ORDER BY ?p ?sen
""".strip()

NOMINAL_PREDICATES = {
    "http://dati.senato.it/osr/favorevole": "F",
    "http://dati.senato.it/osr/contrario": "C",
    "http://dati.senato.it/osr/astenuto": "A",
    "http://dati.senato.it/osr/presenteNonVotante": "P",
    "http://dati.senato.it/osr/inCongedoMissione": "M",
}
VOTE_CODES = tuple(sorted(set(NOMINAL_PREDICATES.values())))

# Outcome classes keyed on the (state, ramo) pair of the last phase.
# officialStates are stored as "stato @ ramo" so the validator can round-trip.
OUTCOME_CLASSES: tuple[tuple[str, str, tuple[str, ...]], ...] = (
    ("assegnato", "Assegnato o in attesa di assegnazione al Senato", (
        "assegnato (no esame) @ S",
        "da assegn. a commis. @ S",
    )),
    ("in-esame", "In esame al Senato", (
        "esame in comm. @ S",
        "in relazione @ S",
        "concluso l'esame @ S",
        "all'esame assemblea @ S",
    )),
    ("approvato-senato-trasmesso", "Approvato dal Senato e trasmesso alla Camera", (
        "approvato @ S",
        "appr. in t.u. @ S",
        "appr. con modificaz @ S",
        "approvato @ C",
        "appr. in t.u. @ C",
        "appr. con modificaz @ C",
        "esame in comm. @ C",
        "in relazione @ C",
        "concluso l'esame @ C",
        "all'esame assemblea @ C",
        "assegnato (no esame) @ C",
        "da assegn. a commis. @ C",
    )),
    ("legge", "Approvato definitivamente: è legge", (
        "appr. definit. Legge @ S",
        "appr. definit. Legge @ C",
    )),
    ("assorbito", "Assorbito da un provvedimento abbinato", (
        "assorbito @ S",
    )),
    ("ritirato", "Ritirato", (
        "ritirato @ S",
    )),
    ("respinto", "Respinto", (
        "respinto @ S",
    )),
)

TERMINAL_STATES = ("assorbito", "ritirato", "respinto")
SENATO_APPROVED_STATES = ("approvato", "appr. in t.u.", "appr. con modificaz")
SENATO_EXAM_STATES = ("esame in comm.", "in relazione", "concluso l'esame", "all'esame assemblea")
SENATO_ASSIGNED_STATES = ("assegnato (no esame)", "da assegn. a commis.")
LEGGE_STATE = "appr. definit. Legge"


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
    return spec


ITALIAN_MONTHS = {
    "gennaio": 1, "febbraio": 2, "marzo": 3, "aprile": 4, "maggio": 5, "giugno": 6,
    "luglio": 7, "agosto": 8, "settembre": 9, "ottobre": 10, "novembre": 11, "dicembre": 12,
}
MONTH_NAMES = tuple(ITALIAN_MONTHS)


def italian_long_date(iso: str) -> str:
    year, month, day = (int(part) for part in iso.split("-"))
    return f"{day} {MONTH_NAMES[month - 1]} {year}"


def binding_value(row: dict[str, Any], key: str) -> str | None:
    cell = row.get(key)
    if not cell:
        return None
    value = cell.get("value")
    return value if isinstance(value, str) and value.strip() else None


def iso_date(value: str | None) -> str | None:
    if value and ISO_DATE.match(value):
        return value
    return None


def parse_uri_id(uri: str, pattern: re.Pattern[str], kind: str) -> str:
    match = pattern.search(uri)
    require(bool(match), f"{kind} URI non riconosciuto: {uri}")
    assert match is not None
    return match.group(1)


def outcome_class_of(state: str, ramo: str) -> str:
    """Fail-closed mapping of the last phase's (statoDdl, ramo) pair."""
    if state in TERMINAL_STATES:
        return state
    if state == LEGGE_STATE:
        return "legge"
    if ramo == "C":
        return "approvato-senato-trasmesso"
    if ramo == "S":
        if state in SENATO_APPROVED_STATES:
            return "approvato-senato-trasmesso"
        if state in SENATO_EXAM_STATES:
            return "in-esame"
        if state in SENATO_ASSIGNED_STATES:
            return "assegnato"
    raise SnapshotError(f"coppia (stato, ramo) non mappata: {state!r} @ {ramo!r}")


def state_at_ramo(entry: str) -> tuple[str, str]:
    state, _, ramo = entry.rpartition(" @ ")
    require(bool(state) and ramo in ("S", "C"), f"officialState non decodificabile: {entry!r}")
    return state, ramo


# --------------------------------------------------------------------------- #
# Official fetching (GET only: the Senato endpoint refuses POST)
# --------------------------------------------------------------------------- #


def sparql_fetch(query: str) -> tuple[dict[str, Any], bytes]:
    url = ENDPOINT + "?" + urllib.parse.urlencode(
        {"query": query, "format": "application/sparql-results+json"}
    )
    request = urllib.request.Request(
        url,
        headers={"User-Agent": USER_AGENT, "Accept": "application/sparql-results+json"},
        method="GET",
    )
    last_error: Exception | None = None
    for attempt in range(FETCH_ATTEMPTS):
        try:
            with urllib.request.urlopen(request, context=ssl.create_default_context(), timeout=FETCH_TIMEOUT) as response:
                raw = response.read()
            payload = json.loads(raw)
            require("results" in payload and "bindings" in payload["results"], "payload SPARQL senza bindings")
            require(
                len(payload["results"]["bindings"]) != ENDPOINT_ROW_CAP,
                "cap endpoint raggiunto",
            )
            return payload, raw
        except (urllib.error.URLError, json.JSONDecodeError) as error:
            last_error = error
            time.sleep(3 * (attempt + 1))
    raise SnapshotError(f"SPARQL Senato non raggiungibile: {last_error}")


def sparql_fetch_paged(query: str) -> tuple[dict[str, Any], dict[str, Any]]:
    """Fetch an ordered DISTINCT query in deterministic LIMIT/OFFSET pages."""
    payloads: list[dict[str, Any]] = []
    raws: list[bytes] = []
    offset = 0
    while True:
        payload, raw = sparql_fetch(f"{query}\nLIMIT {PAGE_SIZE} OFFSET {offset}")
        payloads.append(payload)
        raws.append(raw)
        if len(payload["results"]["bindings"]) < PAGE_SIZE:
            break
        offset += PAGE_SIZE
    merged = {
        "head": payloads[0].get("head", {}),
        "results": {"bindings": [row for payload in payloads for row in payload["results"]["bindings"]]},
    }
    digest = hashlib.sha256()
    total = 0
    for raw in raws:
        digest.update(raw)
        total += len(raw)
    lock = {
        "pages": len(raws),
        "rows": len(merged["results"]["bindings"]),
        "bytes": total,
        "sha256": digest.hexdigest(),
    }
    return merged, lock


def sparql_fetch_keyset(query: str, key_var: str) -> tuple[dict[str, Any], dict[str, Any]]:
    """Ordered DISTINCT query paged by keyset: FILTER(STR(?key) >= last) + LIMIT.

    OFFSET cannot pass the endpoint's sorted-top cap, so each page resumes from
    the last key of the previous one (inclusive); boundary rows are deduplicated
    at merge. A full page on a single key would not advance and fails closed.
    """
    marker = "}\nORDER BY"
    require(marker in query, "query keyset senza blocco ORDER BY")
    payloads: list[dict[str, Any]] = []
    raws: list[bytes] = []
    seen: set[tuple[str, ...]] = set()
    bindings: list[dict[str, Any]] = []
    last_key: str | None = None
    while True:
        paged = query
        if last_key is not None:
            insert_at = paged.index(marker)
            paged = f'{paged[:insert_at]}  FILTER(STR(?{key_var}) >= "{last_key}")\n{paged[insert_at:]}'
        payload, raw = sparql_fetch(f"{paged}\nLIMIT {PAGE_SIZE}")
        page = payload["results"]["bindings"]
        if len(page) == PAGE_SIZE:
            keys = {binding_value(row, key_var) for row in page}
            require(len(keys) > 1, "pagina keyset su un solo valore: la chiave non avanza")
        payloads.append(payload)
        raws.append(raw)
        for row in page:
            pair = tuple(binding_value(row, var) or "" for var in sorted(row))
            if pair not in seen:
                seen.add(pair)
                bindings.append(row)
        if len(page) < PAGE_SIZE:
            break
        last_key = binding_value(page[-1], key_var)
        require(last_key is not None, "pagina keyset senza chiave")
    merged = {"head": payloads[0].get("head", {}), "results": {"bindings": bindings}}
    digest = hashlib.sha256()
    total = 0
    total_rows = 0
    for raw in raws:
        digest.update(raw)
        total += len(raw)
    for payload in payloads:
        total_rows += len(payload["results"]["bindings"])
    lock = {"pages": len(raws), "rows": total_rows, "bytes": total, "sha256": digest.hexdigest()}
    return merged, lock


def fetch_nominal_votes(vote_uris: list[str]) -> tuple[dict[str, dict[str, Any]], dict[str, Any]]:
    ordered = sorted(vote_uris)

    def fetch(uri: str) -> tuple[dict[str, Any], bytes]:
        return sparql_fetch(NOMINAL_VOTE_QUERY.replace("<VOT_URI>", f"<{uri}>"))

    with ThreadPoolExecutor(max_workers=NOMINAL_VOTE_WORKERS) as pool:
        results = dict(zip(ordered, pool.map(fetch, ordered)))
    digest = hashlib.sha256()
    total = 0
    total_rows = 0
    payloads: dict[str, dict[str, Any]] = {}
    for uri in ordered:
        payload, raw = results[uri]
        payloads[uri] = payload
        digest.update(raw)
        total += len(raw)
        total_rows += len(payload["results"]["bindings"])
    return payloads, {"count": len(ordered), "bytes": total, "rows": total_rows, "sha256": digest.hexdigest()}


# --------------------------------------------------------------------------- #
# Snapshot assembly
# --------------------------------------------------------------------------- #


def parse_phases(payload: dict[str, Any]) -> dict[str, dict[str, Any]]:
    """Phase nodes grouped by bill (idDdl); scalar fields fail on divergence."""
    bills: dict[str, dict[str, Any]] = {}
    for row in payload["results"]["bindings"]:
        ddl_uri = binding_value(row, "ddl")
        id_ddl = binding_value(row, "id")
        require(ddl_uri is not None and id_ddl is not None, "riga phases senza ddl/id")
        assert ddl_uri is not None and id_ddl is not None
        require(DDL_URI_RE.search(ddl_uri) is not None, f"ddl URI non riconosciuto: {ddl_uri}")
        require(re.fullmatch(r"\d+", id_ddl) is not None, f"idDdl non numerico: {id_ddl!r}")
        phase = {
            "ddlUri": ddl_uri,
            "idFase": binding_value(row, "idFase"),
            "fase": binding_value(row, "fase"),
            "ramo": binding_value(row, "ramo"),
            "progressivo": binding_value(row, "prog"),
            "kind": binding_value(row, "pt"),
            "presentedDate": iso_date(binding_value(row, "dataPres")),
            "state": binding_value(row, "stato"),
            "stateDate": iso_date(binding_value(row, "statoData")),
        }
        require(phase["idFase"] is not None and re.fullmatch(r"\d+", phase["idFase"] or "") is not None,
                f"{ddl_uri}: idFase assente")
        require(phase["fase"] is not None, f"{ddl_uri}: fase assente")
        require(phase["ramo"] in ("S", "C"), f"{ddl_uri}: ramo inatteso {phase['ramo']!r}")
        require(phase["kind"] in PHASE_KINDS, f"{ddl_uri}: presentatoTrasmesso inatteso {phase['kind']!r}")
        require(phase["state"] is not None, f"{ddl_uri}: statoDdl assente")
        require(phase["stateDate"] is not None, f"{ddl_uri}: dataStatoDdl assente")
        require(phase["presentedDate"] is not None, f"{ddl_uri}: dataPresentazione assente")
        require(phase["progressivo"] is not None, f"{ddl_uri}: progressivoIter assente")
        phase["progressivo"] = int(phase["progressivo"])
        nature = binding_value(row, "natura")
        require(nature in NATURE_IDS, f"{ddl_uri}: natura inattesa {nature!r}")
        title = binding_value(row, "titolo")
        title = re.sub(r"\s+", " ", unescape(title)).strip() if title else None
        bill = bills.setdefault(id_ddl, {"phases": {}, "natures": set(), "titles": set()})
        bill["phases"][ddl_uri] = phase
        bill["natures"].add(nature)
        if title:
            bill["titles"].add(title)
    for id_ddl, bill in bills.items():
        require(len(bill["natures"]) == 1, f"{id_ddl}: nature multiple {sorted(bill['natures'])}")
    return bills


def parse_signers(payload: dict[str, Any], bills: dict[str, dict[str, Any]]) -> dict[str, dict[str, Any]]:
    """Senator signatures per bill: primo=1 marks the first signer of a node."""
    node_to_bill = {
        uri: id_ddl
        for id_ddl, bill in bills.items()
        for uri in bill["phases"]
    }
    per_bill: dict[str, dict[str, Any]] = defaultdict(
        lambda: {"senators": set(), "primoByNode": defaultdict(set)}
    )
    for row in payload["results"]["bindings"]:
        ddl_uri = binding_value(row, "ddl")
        sen_uri = binding_value(row, "sen")
        require(ddl_uri is not None and sen_uri is not None, "riga signers senza ddl/sen")
        assert ddl_uri is not None and sen_uri is not None
        id_ddl = node_to_bill.get(ddl_uri)
        if id_ddl is None:
            continue
        sen_id = parse_uri_id(sen_uri, SENATORE_URI_RE, "senatore")
        primo = binding_value(row, "primo")
        require(primo in (None, "1"), f"{ddl_uri}: primoFirmatario inatteso {primo!r}")
        per_bill[id_ddl]["senators"].add(sen_id)
        if primo == "1":
            per_bill[id_ddl]["primoByNode"][ddl_uri].add(sen_id)
    return per_bill


def initial_perimeter_phases(bill: dict[str, Any]) -> list[dict[str, Any]]:
    """Phase nodes at the lowest progressivoIter marked presentato on ramo S."""
    phases = list(bill["phases"].values())
    lowest = min(phase["progressivo"] for phase in phases)
    return [
        phase for phase in phases
        if phase["progressivo"] == lowest and phase["kind"] == "presentato" and phase["ramo"] == "S"
    ]


def parse_final_votes(
    payload: dict[str, Any], perimeter_ids: set[str]
) -> tuple[dict[str, dict[str, Any]], int]:
    """Final votes grouped by vote URI; kept when linked to a perimeter bill."""
    votes: dict[str, dict[str, Any]] = {}
    other = 0
    for row in payload["results"]["bindings"]:
        vote_uri = binding_value(row, "v")
        id_ddl = binding_value(row, "id")
        require(vote_uri is not None and id_ddl is not None, "riga finalVotes senza v/id")
        assert vote_uri is not None and id_ddl is not None
        vote = votes.setdefault(vote_uri, {"rows": [], "billIds": set()})
        vote["rows"].append(row)
        vote["billIds"].add(id_ddl)
    kept: dict[str, dict[str, Any]] = {}
    for vote_uri, vote in votes.items():
        scalars: dict[str, set[str | None]] = defaultdict(set)
        for row in vote["rows"]:
            for key in ("label", "esito", "fav", "con", "ast", "pres", "vot", "magg", "tv", "seduta"):
                scalars[key].add(binding_value(row, key))
        for key, values in scalars.items():
            require(len(values) == 1, f"{vote_uri}: valori multipli per {key}")
        entry = {
            "uri": vote_uri,
            "id": parse_uri_id(vote_uri, VOTE_ID_RE, "votazione"),
            "label": scalars["label"].pop(),
            "esito": scalars["esito"].pop(),
            "favorevoli": int(scalars["fav"].pop() or "-1"),
            "contrari": int(scalars["con"].pop() or "-1"),
            "astenuti": int(scalars["ast"].pop() or "-1"),
            "presenti": int(scalars["pres"].pop() or "-1"),
            "votanti": int(scalars["vot"].pop() or "-1"),
            "maggioranza": int(scalars["magg"].pop() or "-1"),
            "voteType": scalars["tv"].pop(),
            "sessionUri": scalars["seduta"].pop(),
            "billIds": sorted(vote["billIds"]),
        }
        for key in ("favorevoli", "contrari", "astenuti", "presenti", "votanti", "maggioranza"):
            require(entry[key] >= 0, f"{vote_uri}: {key} assente o negativo")
        require(entry["esito"] is not None, f"{vote_uri}: esito assente")
        require(entry["sessionUri"] is not None, f"{vote_uri}: seduta assente")
        if set(entry["billIds"]) & perimeter_ids:
            kept[vote_uri] = entry
        else:
            other += 1
    return kept, other


def parse_sessions(payload: dict[str, Any]) -> dict[str, dict[str, Any]]:
    sessions: dict[str, dict[str, Any]] = {}
    for row in payload["results"]["bindings"]:
        uri = binding_value(row, "seduta")
        date = iso_date(binding_value(row, "data"))
        numero = binding_value(row, "numero")
        require(uri is not None, "riga sessions senza seduta")
        assert uri is not None
        require(SESSION_URI_RE.search(uri) is not None, f"seduta URI non riconosciuta: {uri}")
        require(date is not None, f"{uri}: dataSeduta assente o non ISO")
        sessions[uri] = {"date": date, "numero": numero}
    return sessions


def parse_nominal(payload: dict[str, Any], vote_uri: str) -> dict[str, str]:
    votes: dict[str, str] = {}
    for row in payload["results"]["bindings"]:
        pred = binding_value(row, "p")
        sen_uri = binding_value(row, "sen")
        require(pred in NOMINAL_PREDICATES, f"{vote_uri}: predicato nominale inatteso {pred!r}")
        require(sen_uri is not None, f"{vote_uri}: nominale senza senatore")
        assert pred is not None and sen_uri is not None
        sen_id = parse_uri_id(sen_uri, SENATORE_URI_RE, "senatore")
        require(sen_id not in votes, f"{vote_uri}: senatore {sen_id} in due liste")
        votes[sen_id] = NOMINAL_PREDICATES[pred]
    return votes


def build_snapshot(
    payloads: dict[str, dict[str, Any]],
    response_locks: dict[str, dict[str, Any]],
    nominal_payloads: dict[str, dict[str, Any]],
    nominal_digest: dict[str, Any],
) -> dict[str, Any]:
    bills = parse_phases(payloads["phases"])
    signers = parse_signers(payloads["signers"], bills)
    disegni_total = int(binding_value(payloads["disegniXix"]["results"]["bindings"][0], "n") or "-1")
    require(disegni_total >= len(bills), "disegniXix sotto i disegni con primo firmatario senatore")
    excluded_no_senator_first = disegni_total - len(bills)

    perimeter_ids: set[str] = set()
    acts_core: dict[str, dict[str, Any]] = {}
    for id_ddl, bill in bills.items():
        initial = initial_perimeter_phases(bill)
        if not initial:
            continue
        primos: set[str] = set()
        primo_nodes: list[dict[str, Any]] = []
        for phase in initial:
            node_primos = (signers.get(id_ddl) or {}).get("primoByNode", {}).get(phase["ddlUri"], set())
            if node_primos:
                primo_nodes.append(phase)
                primos.update(node_primos)
        require(len(primos) == 1, f"{id_ddl}: primi firmatari sulla fase iniziale {sorted(primos)}")
        first_signer = sorted(primos)[0]
        base = min(primo_nodes or initial, key=lambda phase: int(phase["idFase"]))
        senators = (signers.get(id_ddl) or {}).get("senators", set())
        co_signers = sorted(senators - {first_signer}, key=int)
        phases_sorted = sorted(bill["phases"].values(), key=lambda phase: (phase["progressivo"], phase["ddlUri"]))
        current = max(phases_sorted, key=lambda phase: (phase["progressivo"], phase["stateDate"], phase["ddlUri"]))
        outcome = outcome_class_of(current["state"], current["ramo"])
        titles = sorted(bill["titles"], key=lambda item: (-len(item), item))
        perimeter_ids.add(id_ddl)
        acts_core[id_ddl] = {
            "id": f"ddl-{id_ddl}",
            "idDdl": id_ddl,
            "number": base["fase"],
            "natureId": sorted(bill["natures"])[0],
            "title": titles[0] if titles else None,
            "presentedDate": base["presentedDate"],
            "phases": phases_sorted,
            "currentPhase": dict(current),
            "outcomeClass": outcome,
            "firstSignerId": first_signer,
            "coSignerIds": co_signers,
        }

    vote_entries, votes_on_other_acts = parse_final_votes(payloads["finalVotes"], perimeter_ids)
    sessions = parse_sessions(payloads["sessions"])
    final_votes: dict[str, dict[str, Any]] = {}
    for vote_uri, entry in vote_entries.items():
        session = sessions.get(entry["sessionUri"])
        require(session is not None, f"{vote_uri}: seduta senza data")
        assert session is not None
        numero = session["numero"]
        require(numero is not None and numero.isdigit(), f"{vote_uri}: seduta senza numeroSeduta")
        assert numero is not None
        secret = entry["voteType"] == "segreta"
        votes = {} if secret else parse_nominal(nominal_payloads[vote_uri], vote_uri)
        counts = Counter(votes.values())
        require(
            entry["favorevoli"] + entry["contrari"] + entry["astenuti"] == entry["votanti"],
            f"{vote_uri}: votanti non riconcilia",
        )
        require(entry["presenti"] >= entry["votanti"], f"{vote_uri}: presenti sotto votanti")
        require(
            (entry["esito"] == "approvato") == (entry["favorevoli"] > entry["maggioranza"]),
            f"{vote_uri}: esito/maggioranza incoerenti",
        )
        require(counts["F"] == entry["favorevoli"], f"{vote_uri}: favorevoli nominali non riconciliati")
        require(counts["C"] == entry["contrari"], f"{vote_uri}: contrari nominali non riconciliati")
        require(counts["A"] == entry["astenuti"], f"{vote_uri}: astenuti nominali non riconciliati")
        final_votes[vote_uri] = {
            "id": entry["id"],
            "uri": vote_uri,
            "label": entry["label"],
            "esito": entry["esito"],
            "favorevoli": entry["favorevoli"],
            "contrari": entry["contrari"],
            "astenuti": entry["astenuti"],
            "presenti": entry["presenti"],
            "votanti": entry["votanti"],
            "maggioranza": entry["maggioranza"],
            "voteType": entry["voteType"],
            "sessionId": f"19-{numero}",
            "sessionUri": entry["sessionUri"],
            "date": session["date"],
            "approved": entry["esito"] == "approvato",
            "secret": secret,
            "votes": votes,
        }

    act_list: list[dict[str, Any]] = []
    first_signers: set[str] = set()
    co_signer_set: set[str] = set()
    signatures = 0
    acts_by_nature: Counter[str] = Counter()
    acts_by_outcome: Counter[str] = Counter()
    multi_phase = 0
    for id_ddl in sorted(acts_core, key=int):
        act = acts_core[id_ddl]
        vote_ids = sorted(
            (entry["id"] for entry in vote_entries.values() if id_ddl in entry["billIds"]),
            key=lambda item: tuple(int(part) for part in item.split("-")),
        )
        if len(act["phases"]) > 1:
            multi_phase += 1
        first_signers.add(act["firstSignerId"])
        co_signer_set.update(act["coSignerIds"])
        signatures += 1 + len(act["coSignerIds"])
        acts_by_nature[act["natureId"]] += 1
        acts_by_outcome[act["outcomeClass"]] += 1
        act_list.append({
            **{key: act[key] for key in ("id", "idDdl", "number", "natureId", "title", "presentedDate")},
            "phases": act["phases"],
            "currentPhase": act["currentPhase"],
            "outcomeClass": act["outcomeClass"],
            "firstSignerId": act["firstSignerId"],
            "coSignerIds": act["coSignerIds"],
            "finalVoteIds": vote_ids,
            "officialPage": DDL_PAGE_BASE.format(id_ddl=id_ddl),
        })

    today = datetime.now(timezone.utc)
    observed = today.date().isoformat()
    snapshot = {
        "schemaVersion": 1,
        "chamber": "senato",
        "legislature": {
            "number": 19,
            "id": "19",
            "label": "XIX Legislatura",
            "uri": LEGISLATURE_URI,
            "startDate": LEGISLATURE_START,
        },
        "period": {
            "kind": "legislature-to-date",
            "startDate": LEGISLATURE_START,
            "observedDate": observed,
            "label": f"Dall'inizio della XIX legislatura al {italian_long_date(observed)}",
        },
        "soldi": {"present": False, "note": "Disegni di legge, fasi e votazioni: nessun importo."},
        "provenance": {
            "kind": "official-sparql",
            "owner": "Senato della Repubblica",
            "title": "Open Data Senato — disegni di legge, fasi dell'iter e votazioni (dati.senato.it)",
            "endpointUrl": ENDPOINT,
            "landingUrl": LANDING,
            "license": "CC BY 3.0 IT",
            "licenseUrl": LICENSE_URL,
            "legislatureUri": LEGISLATURE_URI,
            "acquiredAt": today.replace(microsecond=0).isoformat(),
            "responses": {
                **response_locks,
                "nominalVotes": nominal_digest,
            },
            "gap": "La Camera espone atti, iter e voti nominali su dati.camera.it con ontologia diversa: è coperta dallo snapshot separato camera-atti-voti-xix.",
        },
        "outcomeClasses": [
            {
                "id": class_id,
                "label": label,
                "officialStates": sorted(states),
            }
            for class_id, label, states in OUTCOME_CLASSES
        ],
        "coverage": {
            "acts": len(act_list),
            "actsByNature": {key: acts_by_nature[key] for key in sorted(acts_by_nature)},
            "phases": sum(len(act["phases"]) for act in act_list),
            "actsWithMultiplePhases": multi_phase,
            "signatures": signatures,
            "actsExcludedNonSenatorFirstSigner": excluded_no_senator_first,
            "finalVotes": len(final_votes),
            "finalVotesOnOtherActs": votes_on_other_acts,
            "nominalVotes": sum(len(vote["votes"]) for vote in final_votes.values()),
            "secretFinalVotes": sum(1 for vote in final_votes.values() if vote["secret"]),
            "senatorsAsFirstSigner": len(first_signers),
            "senatorsAsCoSigner": len(co_signer_set),
            "actsByOutcomeClass": {key: acts_by_outcome[key] for key in sorted(acts_by_outcome)},
        },
        "acts": act_list,
        "finalVotes": [
            final_votes[uri]
            for uri in sorted(final_votes, key=lambda item: tuple(int(p) for p in final_votes[item]["id"].split("-")))
        ],
        "caveats": [
            f"Il perimetro è l'iniziativa parlamentare a prima firma di un senatore: sono esclusi i disegni di legge a prima firma di deputati, del Governo, delle Regioni, del CNEL e di iniziativa popolare ({excluded_no_senator_first} disegni XIX con iniziative ma senza primo firmatario senatore nella fonte).",
            f"Le votazioni finali su disegni di legge non a prima firma di un senatore ({votes_on_other_acts} nella fonte) non sono incluse: compaiono solo le finali sugli atti del perimetro.",
            "La firma di un disegno di legge non equivale alla paternità del testo finale: l'iter parlamentare può modificare il testo approvato.",
            "'Arrivata in fondo' corrisponde alla classe 'legge' ricavata dalle etichette ufficiali degli stati del Senato.",
            "I conteggi di firme, disegni e voti non misurano produttività o merito dei senatori.",
            "Nel conteggio ufficiale del Senato gli astenuti contano fra i votanti (alla Camera no): i numeri dei due rami non sono direttamente confrontabili.",
            "'Non presente' indica l'assenza da tutte le liste ufficiali della votazione, senza distinguere il motivo.",
            "Nelle votazioni segrete il voto individuale non è pubblico: il nominale non è disponibile.",
            "La Camera è coperta da uno snapshot separato (camera-atti-voti-xix) con ontologia e regole di conteggio proprie.",
            "Nessun importo in questo snapshot: per la spesa pubblica usare le sezioni dedicate.",
        ],
    }
    validate_snapshot(snapshot)
    return snapshot


# --------------------------------------------------------------------------- #
# Validation
# --------------------------------------------------------------------------- #


def validate_snapshot(payload: dict[str, Any], locks: dict[str, Any] | None = None) -> None:
    require(payload.get("schemaVersion") == 1, "schemaVersion inattesa")
    require(payload.get("chamber") == "senato", "chamber inattesa")
    legislature = payload.get("legislature") or {}
    require(legislature.get("number") == 19, "legislature.number inatteso")
    require(legislature.get("id") == "19", "legislature.id inatteso")
    require(legislature.get("uri") == LEGISLATURE_URI, "legislature.uri diverge")
    require(legislature.get("startDate") == LEGISLATURE_START, "legislature.startDate diverge")

    period = payload.get("period") or {}
    require(period.get("kind") == "legislature-to-date", "period.kind inatteso")
    require(period.get("startDate") == LEGISLATURE_START, "period.startDate diverge")
    require(bool(ISO_DATE.match(str(period.get("observedDate") or ""))), "observedDate non ISO")

    soldi = payload.get("soldi") or {}
    require(soldi.get("present") is False, "soldi.present inatteso")

    provenance = payload.get("provenance") or {}
    for key, expected in (
        ("kind", "official-sparql"), ("owner", "Senato della Repubblica"),
        ("endpointUrl", ENDPOINT), ("landingUrl", LANDING),
        ("legislatureUri", LEGISLATURE_URI), ("licenseUrl", LICENSE_URL),
    ):
        require(provenance.get(key) == expected, f"provenance.{key} diverge")
    require(isinstance(provenance.get("acquiredAt"), str) and "T" in provenance["acquiredAt"], "acquiredAt")
    responses = provenance.get("responses") or {}
    require(set(responses) == set(QUERIES) | {"nominalVotes"}, "set delle risposte inatteso")
    for key, response in responses.items():
        require(isinstance(response.get("bytes"), int) and response["bytes"] > 0, f"{key}.bytes")
        require(isinstance(response.get("rows"), int) and response["rows"] > 0, f"{key}.rows")
        require(bool(SHA_RE.match(str(response.get("sha256") or ""))), f"{key}.sha256")
        if key == "nominalVotes":
            require(isinstance(response.get("count"), int) and response["count"] > 0, "nominalVotes.count")
        else:
            require(isinstance(response.get("pages"), int) and response["pages"] > 0, f"{key}.pages")
        if locks:
            require(response == locks.get(key), f"{key}: source lock diverge")

    outcome_classes = payload.get("outcomeClasses") or []
    class_ids = [item.get("id") for item in outcome_classes]
    require(class_ids == [class_id for class_id, _l, _s in OUTCOME_CLASSES], "outcomeClasses ids inattesi")
    for item, (class_id, _label, states) in zip(outcome_classes, OUTCOME_CLASSES):
        require(item.get("label"), f"{class_id}: label assente")
        require(item.get("officialStates") == sorted(states), f"{class_id}: officialStates divergono")
        for entry in item["officialStates"]:
            state, ramo = state_at_ramo(entry)
            require(outcome_class_of(state, ramo) == class_id,
                    f"{class_id}: officialState {entry!r} mappa a {outcome_class_of(state, ramo)!r}")

    acts = payload.get("acts") or []
    require(isinstance(acts, list) and acts, "acts assenti")
    act_ids: set[str] = set()
    for act in acts:
        aid = act.get("id")
        require(isinstance(aid, str) and ACT_ID_RE.fullmatch(aid) is not None, f"act id inatteso {aid!r}")
        require(act.get("idDdl") == ACT_ID_RE.fullmatch(aid).group(1), f"{aid}: idDdl incoerente")
        act_ids.add(aid)
        require(isinstance(act.get("number"), str) and act["number"], f"{aid}: number assente")
        require(act.get("natureId") in NATURE_IDS, f"{aid}: natureId inatteso")
        first = act.get("firstSignerId")
        require(isinstance(first, str) and first.isdigit(), f"{aid}: firstSignerId inatteso")
        co = act.get("coSignerIds") or []
        require(isinstance(co, list) and len(set(co)) == len(co), f"{aid}: coSignerIds duplicati")
        require(first not in co, f"{aid}: primo firmatario tra i cofirmatari")
        for item in co:
            require(isinstance(item, str) and item.isdigit(), f"{aid}: coSignerId inatteso {item!r}")
        phases = act.get("phases") or []
        require(isinstance(phases, list) and phases, f"{aid}: phases assenti")
        require(
            [phase["progressivo"] for phase in phases]
            == sorted(phase["progressivo"] for phase in phases),
            f"{aid}: phases non ordinate per progressivo",
        )
        lowest = phases[0]["progressivo"]
        require(
            any(phase["kind"] == "presentato" and phase["ramo"] == "S"
                for phase in phases if phase["progressivo"] == lowest),
            f"{aid}: fase iniziale non presentata al Senato",
        )
        seen_uris: set[str] = set()
        for phase in phases:
            uri = phase.get("ddlUri")
            require(isinstance(uri, str) and DDL_URI_RE.search(uri) is not None, f"{aid}: ddlUri inatteso")
            require(uri not in seen_uris, f"{aid}: fase duplicata {uri}")
            seen_uris.add(uri)
            require(isinstance(phase.get("idFase"), str) and phase["idFase"].isdigit(), f"{aid}: idFase inatteso")
            require(isinstance(phase.get("fase"), str) and phase["fase"], f"{aid}: fase assente")
            require(phase.get("ramo") in ("S", "C"), f"{aid}: ramo inatteso")
            require(phase.get("kind") in PHASE_KINDS, f"{aid}: kind inatteso")
            require(isinstance(phase.get("progressivo"), int) and phase["progressivo"] >= 0, f"{aid}: progressivo inatteso")
            require(bool(ISO_DATE.match(str(phase.get("presentedDate") or ""))), f"{aid}: presentedDate non ISO")
            require(isinstance(phase.get("state"), str) and phase["state"], f"{aid}: state assente")
            require(bool(ISO_DATE.match(str(phase.get("stateDate") or ""))), f"{aid}: stateDate non ISO")
        current = act.get("currentPhase") or {}
        require(current in phases, f"{aid}: currentPhase non fra le fasi")
        outcome = act.get("outcomeClass")
        require(outcome in class_ids, f"{aid}: outcomeClass inattesa")
        require(
            outcome_class_of(current["state"], current["ramo"]) == outcome,
            f"{aid}: outcomeClass incoerente con currentPhase",
        )
        class_states = next(item["officialStates"] for item in outcome_classes if item["id"] == outcome)
        require(
            f"{current['state']} @ {current['ramo']}" in class_states,
            f"{aid}: stato corrente {current['state']!r} @ {current['ramo']} non dichiarato in {outcome}",
        )
        require(
            act.get("officialPage") == DDL_PAGE_BASE.format(id_ddl=act["idDdl"]),
            f"{aid}: officialPage incoerente",
        )
        for vid in act.get("finalVoteIds") or []:
            require(isinstance(vid, str), f"{aid}: finalVoteId inatteso {vid!r}")

    final_votes = payload.get("finalVotes") or []
    require(isinstance(final_votes, list), "finalVotes assenti")
    vote_ids: set[str] = set()
    for vote in final_votes:
        vid = vote.get("id")
        require(isinstance(vid, str) and re.fullmatch(r"19-\d+-\d+", vid) is not None, f"voto id inatteso {vid!r}")
        vote_ids.add(vid)
        session_id = vote.get("sessionId")
        require(isinstance(session_id, str) and vid.startswith(f"{session_id}-"), f"{vid}: sessionId incoerente")
        require(bool(ISO_DATE.match(str(vote.get("date") or ""))), f"{vid}: date non ISO")
        for key in ("favorevoli", "contrari", "astenuti", "presenti", "votanti", "maggioranza"):
            require(isinstance(vote.get(key), int) and vote[key] >= 0, f"{vid}.{key}")
        require(
            vote["favorevoli"] + vote["contrari"] + vote["astenuti"] == vote["votanti"],
            f"{vid}: votanti non riconcilia",
        )
        require(vote["presenti"] >= vote["votanti"], f"{vid}: presenti sotto votanti")
        require(
            vote.get("approved") == (vote["esito"] == "approvato"),
            f"{vid}: approved incoerente con esito",
        )
        require(
            (vote["esito"] == "approvato") == (vote["favorevoli"] > vote["maggioranza"]),
            f"{vid}: esito/maggioranza incoerenti",
        )
        require(isinstance(vote.get("secret"), bool), f"{vid}: secret")
        votes = vote.get("votes")
        require(isinstance(votes, dict), f"{vid}: votes assenti")
        if vote["secret"]:
            require(not votes, f"{vid}: nominale presente su voto segreto")
        else:
            require(votes, f"{vid}: nominale assente su voto non segreto")
        for sen_id, code in votes.items():
            require(isinstance(sen_id, str) and sen_id.isdigit(), f"{vid}: chiave voto {sen_id!r}")
            require(code in VOTE_CODES, f"{vid}: codice voto {code!r}")
        counts = Counter(votes.values())
        require(counts["F"] == vote["favorevoli"], f"{vid}: favorevoli nominali non riconciliati")
        require(counts["C"] == vote["contrari"], f"{vid}: contrari nominali non riconciliati")
        require(counts["A"] == vote["astenuti"], f"{vid}: astenuti nominali non riconciliati")

    referenced = {vid for act in acts for vid in (act.get("finalVoteIds") or [])}
    require(referenced == vote_ids, "finalVoteIds non riconciliati con finalVotes")

    coverage = payload.get("coverage") or {}
    require(coverage.get("acts") == len(acts), "coverage.acts non riconcilia")
    require(coverage.get("phases") == sum(len(act["phases"]) for act in acts),
            "coverage.phases non riconcilia")
    require(
        coverage.get("actsWithMultiplePhases") == sum(1 for act in acts if len(act["phases"]) > 1),
        "coverage.actsWithMultiplePhases non riconcilia",
    )
    require(coverage.get("actsByNature") == dict(sorted(Counter(act["natureId"] for act in acts).items())),
            "coverage.actsByNature non riconcilia")
    require(coverage.get("signatures") == sum(1 + len(act.get("coSignerIds") or []) for act in acts),
            "coverage.signatures non riconcilia")
    require(
        isinstance(coverage.get("actsExcludedNonSenatorFirstSigner"), int)
        and coverage["actsExcludedNonSenatorFirstSigner"] >= 0,
        "coverage.actsExcludedNonSenatorFirstSigner",
    )
    require(coverage.get("finalVotes") == len(final_votes), "coverage.finalVotes non riconcilia")
    require(isinstance(coverage.get("finalVotesOnOtherActs"), int) and coverage["finalVotesOnOtherActs"] >= 0,
            "coverage.finalVotesOnOtherActs")
    require(coverage.get("nominalVotes") == sum(len(vote["votes"]) for vote in final_votes),
            "coverage.nominalVotes non riconcilia")
    require(coverage.get("secretFinalVotes") == sum(1 for vote in final_votes if vote["secret"]),
            "coverage.secretFinalVotes non riconcilia")
    require(coverage.get("senatorsAsFirstSigner") == len({act["firstSignerId"] for act in acts}),
            "coverage.senatorsAsFirstSigner non riconcilia")
    require(coverage.get("senatorsAsCoSigner") == len({item for act in acts for item in (act.get("coSignerIds") or [])}),
            "coverage.senatorsAsCoSigner non riconcilia")
    expected_outcomes = Counter(act["outcomeClass"] for act in acts)
    require(coverage.get("actsByOutcomeClass") == dict(sorted(expected_outcomes.items())),
            "coverage.actsByOutcomeClass non riconcilia")

    caveats = payload.get("caveats") or []
    require(isinstance(caveats, list) and len(caveats) >= 6, "caveats assenti")


# --------------------------------------------------------------------------- #
# Entry points
# --------------------------------------------------------------------------- #


def check_committed(spec: dict[str, Any]) -> None:
    payload = json.loads(OUTPUT.read_text(encoding="utf-8"))
    locks = (spec.get("source") or {}).get("committedResponses") or None
    validate_snapshot(payload, locks=locks)
    floor = spec.get("coverageFloor") or {}
    coverage = payload["coverage"]
    require(coverage["acts"] >= int(floor.get("acts", 1400)), "coverage acts sotto floor")
    require(coverage["finalVotes"] >= int(floor.get("finalVotes", 40)), "coverage finalVotes sotto floor")
    require(
        coverage["finalVotes"] + coverage.get("finalVotesOnOtherActs", 0)
        >= int(floor.get("finalVotesObserved", 200)),
        "coverage finalVotes osservate sotto floor",
    )
    require(
        coverage["senatorsAsFirstSigner"] >= int(floor.get("senatorsAsFirstSigner", 150)),
        "coverage senatorsAsFirstSigner sotto floor",
    )
    print(
        f"OK senato-atti-voti-xix: {coverage['acts']} disegni, {coverage['finalVotes']} votazioni finali, "
        f"{coverage['senatorsAsFirstSigner']} primi firmatari, {coverage['nominalVotes']} voti nominali"
    )


def refresh() -> dict[str, Any]:
    payloads: dict[str, dict[str, Any]] = {}
    response_locks: dict[str, dict[str, Any]] = {}
    for key, query in QUERIES.items():
        if key == "signers":
            payloads[key], response_locks[key] = sparql_fetch_keyset(query, "ddl")
        else:
            payloads[key], response_locks[key] = sparql_fetch_paged(query)
    bills = parse_phases(payloads["phases"])
    perimeter = {
        id_ddl for id_ddl, bill in bills.items() if initial_perimeter_phases(bill)
    }
    require(len(perimeter) >= 1400, f"disegni insufficienti: {len(perimeter)}")
    vote_entries, _ = parse_final_votes(payloads["finalVotes"], perimeter)
    nominal_uris = sorted(uri for uri, entry in vote_entries.items() if entry["voteType"] != "segreta")
    nominal_payloads, nominal_digest = fetch_nominal_votes(nominal_uris)
    return build_snapshot(payloads, response_locks, nominal_payloads, nominal_digest)


def main() -> int:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--check", action="store_true", help="valida lo snapshot committato senza rete")
    parser.add_argument("--write", action="store_true", help="scarica la fonte Senato e riscrive lo snapshot")
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
    print(f"written {OUTPUT.relative_to(ROOT)} ({snapshot['coverage']['acts']} acts)")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
