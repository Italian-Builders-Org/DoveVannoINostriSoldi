#!/usr/bin/env python3
"""Camera XIX acts, iter states and final nominal votes per deputy.

Acts of parliamentary and government initiative, their official iter and the
final votes with per-deputy positions come from the official SPARQL endpoint of
dati.camera.it (OCD). Offline --check validates the committed artifact; --write
refreshes from the official source and fails closed on empty, duplicate,
unmapped or unreconciled coverage.
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

from atomic_snapshot import write_atomic
from parliament_snapshot_json import serialize_snapshot

ROOT = Path(__file__).resolve().parents[2]
SPEC = ROOT / "scripts/etl/specs/camera-atti-voti-xix.source.json"
OUTPUT = ROOT / "src/data/generated/camera-atti-voti-xix.json"
DATASET = "camera-atti-voti-xix"
LEGISLATURE_URI = "http://dati.camera.it/ocd/legislatura.rdf/repubblica_19"
LEGISLATURE_START = "2022-10-13"
ENDPOINT = "https://dati.camera.it/sparql"
LANDING = "https://dati.camera.it/"
LICENSE_URL = "https://creativecommons.org/licenses/by/4.0/"
ACT_PAGE_BASE = "https://www.camera.it/leg19/126?tab=1&leg=19&idDocumento={number}&sede=&tipo="
USER_AGENT = "DoveVannoINostriSoldi-ETL/1.0 (+https://github.com/Italian-Builders-Org/DoveVannoINostriSoldi)"
FETCH_TIMEOUT = 300
FETCH_ATTEMPTS = 4
NOMINAL_VOTE_WORKERS = 4
PAGE_SIZE = 5000
ENDPOINT_ROW_CAP = 10000
MAX_ITER_LESS_SHARE = 0.01

SHA_RE = re.compile(r"^[0-9a-f]{64}$")
ISO_DATE = re.compile(r"^\d{4}-\d{2}-\d{2}$")
ACT_ID_RE = re.compile(r"/attocamera\.rdf/(ac19_(\d+(?:-[A-Za-z]+)?))$")
DEPUTY_ID_RE = re.compile(r"/deputato\.rdf/(d(\d+)_19)$")
FIRST_SIGNER_RE = re.compile(r"^d\d+_19$")
NATURE_RE = re.compile(r"/natura\.rdf/([a-z_]+)$")
VOTE_ID_RE = re.compile(r"/votazione\.rdf/(vs19_\d+_\d+)$")
SESSION_ID_RE = re.compile(r"/seduta\.rdf/(s19_\d+)$")
GOVERNMENT_ID_RE = re.compile(r"/governo\.rdf/(g\d+)$")

NATURE_IDS = (
    "proposta_legge_ordinaria",
    "proposta_legge_costituzionale",
    "disegno_legge_ordinario",
    "disegno_legge_costituzionale",
)

OCD_PREFIX = """PREFIX ocd: <http://dati.camera.it/ocd/>
PREFIX dc: <http://purl.org/dc/elements/1.1/>
PREFIX rdfs: <http://www.w3.org/2000/01/rdf-schema#>
"""

QUERIES = {
    "acts": OCD_PREFIX + """
SELECT DISTINCT ?atto ?natura ?titolo ?data ?iniziativa ?primo ?governo ?governoLabel
WHERE {
  ?atto a ocd:atto ; ocd:rif_leg <http://dati.camera.it/ocd/legislatura.rdf/repubblica_19> ;
        ocd:primo_firmatario ?primo ; ocd:rif_natura ?natura .
  OPTIONAL { ?atto dc:title ?titolo }
  OPTIONAL { ?atto dc:date ?data }
  OPTIONAL { ?atto ocd:iniziativa ?iniziativa }
  OPTIONAL {
    ?primo ocd:rif_membroGoverno ?membroGoverno .
    ?membroGoverno ocd:rif_governo ?governo .
    ?governo rdfs:label ?governoLabel .
  }
}
ORDER BY ?atto
""".strip(),
    "coSigners": OCD_PREFIX + """
SELECT DISTINCT ?atto ?altro
WHERE {
  ?atto a ocd:atto ; ocd:rif_leg <http://dati.camera.it/ocd/legislatura.rdf/repubblica_19> ;
        ocd:primo_firmatario ?primo ; ocd:altro_firmatario ?altro .
}
ORDER BY ?atto ?altro
""".strip(),
    "iterStates": OCD_PREFIX + """
SELECT DISTINCT ?atto ?stato ?statoLabel ?statoData
WHERE {
  ?atto a ocd:atto ; ocd:rif_leg <http://dati.camera.it/ocd/legislatura.rdf/repubblica_19> ;
        ocd:primo_firmatario ?primo ; ocd:rif_statoIter ?stato .
  ?stato dc:title ?statoLabel .
  OPTIONAL { ?stato dc:date ?statoData }
}
ORDER BY ?atto ?statoData
""".strip(),
    "finalVotes": OCD_PREFIX + """
SELECT DISTINCT ?vot ?label ?atto ?seduta ?sedutaData ?fav ?con ?ast ?pres ?votanti ?magg ?appr ?fiducia
WHERE {
  ?vot a ocd:votazione ; ocd:rif_leg <http://dati.camera.it/ocd/legislatura.rdf/repubblica_19> ;
       rdfs:label ?label ; ocd:rif_attoCamera ?atto ; ocd:rif_seduta ?seduta ;
       ocd:favorevoli ?fav ; ocd:contrari ?con ; ocd:astenuti ?ast ; ocd:presenti ?pres ;
       ocd:votanti ?votanti ; ocd:maggioranza ?magg ; ocd:approvato ?appr ; ocd:richiestaFiducia ?fiducia .
  ?seduta dc:date ?sedutaData .
  FILTER(CONTAINS(LCASE(STR(?label)), "finale"))
}
ORDER BY ?vot
""".strip(),
}

NOMINAL_VOTE_QUERY = OCD_PREFIX + """
SELECT DISTINCT ?dep ?tipo
WHERE {
  ?v a ocd:voto ; ocd:rif_votazione <VOT_URI> ; ocd:rif_deputato ?dep ; dc:type ?tipo .
}
ORDER BY ?dep
""".strip()

VOTE_TYPE_CODES = {
    "Favorevole": "F",
    "Contrario": "C",
    "Astensione": "A",
    "Non ha votato": "N",
    "Ha votato": "V",
}

# Advancement order: index is the rank used to break same-date iter ties.
OUTCOME_CLASSES: tuple[tuple[str, str, tuple[str, ...]], ...] = (
    ("assegnato", "Assegnato o in attesa di assegnazione", (
        "Da assegnare",
        "Assegnato",
    )),
    ("in-esame", "In esame alla Camera", (
        "In corso di esame in Commissione",
        "Concluso l'esame da parte della Commissione. In stato di relazione",
        "In discussione",
        "Rinviato dall'Assemblea in Commissione",
    )),
    ("approvato-camera-trasmesso", "Approvato dalla Camera e trasmesso al Senato", (
        "Approvato. Trasmesso al Senato",
        "Approvato in testo unificato. Trasmesso al Senato",
        "Approvato con modificazioni. Trasmesso al Senato",
        "Approvato in prima deliberazione. Trasmesso al Senato",
        "Approvato, segue Navette",
    )),
    ("approvato-definitivamente-non-pubblicato", "Approvato definitivamente, non ancora pubblicato in Gazzetta", (
        "Approvato definitivamente, non ancora pubblicato",
        "Approvato definitivamente dal Senato, non ancora pubblicato",
    )),
    ("legge", "Approvato definitivamente: è legge", (
        "Approvato definitivamente. Legge",
        "Approvato definitivamente dal Senato. Legge",
    )),
    ("assorbito", "Assorbito da un provvedimento abbinato", (
        "Assorbito dall'approvazione di pdl abbinato",
        "Assorbito dalla reiezione di pdl abbinato",
    )),
    ("ritirato", "Ritirato", (
        "Ritirato",
    )),
    ("respinto", "Respinto", (
        "Respinto",
    )),
    ("altro-concluso", "Iter concluso in altro modo", (
        "Restituito al Governo per essere ripresentato all'altro ramo",
        "Decreto-legge decaduto",
        "Conclusione anomala per stralcio",
    )),
)

TRANSMITTED_SECOND_DELIBERATION_SUFFIX = (
    "in seconda deliberazione con la maggioranza assoluta dei componenti. Trasmesso al Senato"
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


def compact_date(value: str) -> str | None:
    """OCD dates arrive as YYYYMMDD."""
    if re.fullmatch(r"\d{8}", value or ""):
        return f"{value[0:4]}-{value[4:6]}-{value[6:8]}"
    return value if ISO_DATE.match(value or "") else None


def parse_uri_id(uri: str, pattern: re.Pattern[str], kind: str) -> str:
    match = pattern.search(uri)
    require(bool(match), f"{kind} URI non riconosciuto: {uri}")
    assert match is not None
    return match.group(1)


def outcome_class_of(state_label: str) -> str:
    for class_id, _label, states in OUTCOME_CLASSES:
        if state_label in states:
            return class_id
    if state_label.endswith(TRANSMITTED_SECOND_DELIBERATION_SUFFIX):
        return "approvato-camera-trasmesso"
    raise SnapshotError(f"stato iter non mappato: {state_label!r}")


def pick_current_state(iter_entries: list[dict[str, str]]) -> dict[str, str]:
    """Latest-dated state; same-date ties go to the most advanced outcome class."""
    rank = {class_id: index for index, (class_id, _l, _s) in enumerate(OUTCOME_CLASSES)}
    return max(
        iter_entries,
        key=lambda entry: (entry["date"], rank[outcome_class_of(entry["state"])], entry["state"]),
    )


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
    raise SnapshotError(f"SPARQL Camera non raggiungibile: {last_error}")


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


def parse_acts(payload: dict[str, Any]) -> dict[str, dict[str, Any]]:
    """All supported acts, preserving formal proposer and responsible Government."""
    acts: dict[str, dict[str, Any]] = {}
    for row in payload["results"]["bindings"]:
        act_uri = binding_value(row, "atto")
        require(act_uri is not None, "riga acts senza atto")
        assert act_uri is not None
        match = ACT_ID_RE.search(act_uri)
        require(match is not None, f"atto URI non riconosciuto: {act_uri}")
        assert match is not None
        act_id, number = match.group(1), match.group(2)
        primo_cell = row.get("primo") or {}
        primo_uri = primo_cell.get("value")
        is_bnode = primo_cell.get("type") == "bnode" or (
            isinstance(primo_uri, str) and primo_uri.startswith("nodeID://")
        )
        nature_uri = binding_value(row, "natura")
        require(nature_uri is not None, f"{act_id}: natura assente")
        assert nature_uri is not None
        nature_id = parse_uri_id(nature_uri, NATURE_RE, "natura")
        require(nature_id in NATURE_IDS, f"{act_id}: natura inattesa {nature_id!r}")
        title = binding_value(row, "titolo")
        title = re.sub(r"\s+", " ", unescape(title)).strip() if title else None
        presented = compact_date(binding_value(row, "data") or "")
        initiative_label = binding_value(row, "iniziativa")
        if is_bnode:
            government_uri = binding_value(row, "governo")
            government_label = binding_value(row, "governoLabel")
            initiative = {"kind": "government", "label": initiative_label or "Governo"}
            proposer = {"kind": "government", "label": "Governo"}
            if government_uri is not None or government_label is not None:
                require(government_uri is not None, f"{act_id}: URI Governo responsabile assente")
                require(government_label is not None, f"{act_id}: etichetta Governo responsabile assente")
                assert government_uri is not None and government_label is not None
                government_id = parse_uri_id(government_uri, GOVERNMENT_ID_RE, "Governo")
                responsible_government = {
                    "id": government_id,
                    "label": government_label,
                    "uri": government_uri,
                }
            else:
                responsible_government = None
        else:
            require(primo_uri is not None, f"{act_id}: primo firmatario assente")
            assert primo_uri is not None
            first_signer = parse_uri_id(primo_uri, DEPUTY_ID_RE, "primo firmatario")
            initiative = {"kind": "parliamentary", "label": initiative_label or "Parlamentare"}
            proposer = {"kind": "deputy", "deputyId": first_signer}
            responsible_government = None
        previous = acts.get(act_id)
        if previous is None:
            acts[act_id] = {
                "id": act_id,
                "number": number,
                "baseNumber": int(re.match(r"\d+", number).group()),
                "uri": act_uri,
                "natureId": nature_id,
                "title": title,
                "presentedDate": presented,
                "initiative": initiative,
                "proposer": proposer,
                "responsibleGovernment": responsible_government,
            }
            continue
        for key, value in (
            ("natureId", nature_id), ("title", title), ("presentedDate", presented),
            ("initiative", initiative), ("proposer", proposer),
        ):
            require(previous[key] == value, f"{act_id}: valori multipli divergenti per {key}")
        if responsible_government is not None:
            if previous["responsibleGovernment"] is None:
                previous["responsibleGovernment"] = responsible_government
            else:
                require(
                    previous["responsibleGovernment"] == responsible_government,
                    f"{act_id}: Governi responsabili multipli divergenti",
                )
    return acts


def parse_iter_states(payload: dict[str, Any], act_ids: set[str]) -> dict[str, list[dict[str, str]]]:
    iters: dict[str, dict[tuple[str, str], dict[str, str]]] = defaultdict(dict)
    for row in payload["results"]["bindings"]:
        act_uri = binding_value(row, "atto")
        state_label = binding_value(row, "statoLabel")
        state_date = binding_value(row, "statoData")
        if act_uri is None or state_label is None:
            continue
        match = ACT_ID_RE.search(act_uri)
        if match is None or match.group(1) not in act_ids:
            continue
        require(state_date is not None, f"{match.group(1)}: stato iter senza data ({state_label!r})")
        assert state_date is not None
        date = compact_date(state_date)
        require(date is not None, f"{match.group(1)}: data stato non valida {state_date!r}")
        assert date is not None
        outcome_class_of(state_label)  # fail closed on unmapped labels
        iters[match.group(1)][(state_label, date)] = {"state": state_label, "date": date}
    return {
        act_id: [entries[key] for key in sorted(entries, key=lambda item: (item[1], item[0]))]
        for act_id, entries in iters.items()
    }


def parse_co_signers(payload: dict[str, Any], act_ids: set[str]) -> tuple[dict[str, set[str]], int]:
    co_signers: dict[str, set[str]] = defaultdict(set)
    not_deputy = 0
    for row in payload["results"]["bindings"]:
        act_uri = binding_value(row, "atto")
        other_uri = binding_value(row, "altro")
        if act_uri is None or other_uri is None:
            continue
        match = ACT_ID_RE.search(act_uri)
        if match is None or match.group(1) not in act_ids:
            continue
        deputy = DEPUTY_ID_RE.search(other_uri)
        if deputy is None:
            not_deputy += 1
            continue
        co_signers[match.group(1)].add(deputy.group(1))
    return co_signers, not_deputy


def vote_int(row: dict[str, Any], key: str, vote_uri: str) -> int:
    value = binding_value(row, key)
    require(value is not None and re.fullmatch(r"-?\d+", value), f"{vote_uri}: campo {key} assente o non intero")
    assert value is not None
    return int(value)


def parse_final_votes(
    payload: dict[str, Any], act_ids: set[str]
) -> tuple[dict[str, dict[str, Any]], int]:
    """One final vote per votazione URI, with an explicit excluded count."""
    grouped: dict[str, dict[str, Any]] = {}
    for row in payload["results"]["bindings"]:
        vote_uri = binding_value(row, "vot")
        act_uri = binding_value(row, "atto")
        if vote_uri is None or act_uri is None:
            continue
        vote_match = VOTE_ID_RE.search(vote_uri)
        act_match = ACT_ID_RE.search(act_uri)
        require(vote_match is not None, f"votazione URI non riconosciuta: {vote_uri}")
        require(act_match is not None, f"atto URI non riconosciuto: {act_uri}")
        assert vote_match is not None and act_match is not None
        act_id = act_match.group(1)
        if act_id not in act_ids:
            continue
        session_uri = binding_value(row, "seduta")
        require(session_uri is not None, f"{vote_uri}: seduta assente")
        assert session_uri is not None
        session_id = parse_uri_id(session_uri, SESSION_ID_RE, "seduta")
        date = compact_date(binding_value(row, "sedutaData") or "")
        require(date is not None, f"{vote_uri}: data seduta assente")
        record = {
            "id": vote_match.group(1),
            "uri": vote_uri,
            "actId": act_id,
            "label": binding_value(row, "label"),
            "sessionId": session_id,
            "date": date,
            "favorevoli": vote_int(row, "fav", vote_uri),
            "contrari": vote_int(row, "con", vote_uri),
            "astenuti": vote_int(row, "ast", vote_uri),
            "presenti": vote_int(row, "pres", vote_uri),
            "votanti": vote_int(row, "votanti", vote_uri),
            "maggioranza": vote_int(row, "magg", vote_uri),
            "approved": binding_value(row, "appr") == "1",
            "confidenceVote": binding_value(row, "fiducia") == "1",
        }
        previous = grouped.get(vote_uri)
        if previous is None:
            grouped[vote_uri] = {**record, "actIds": {act_id}}
        else:
            for key in record:
                if key == "actId":
                    continue
                if key == "label":
                    previous["label"] = max(
                        (previous["label"], record["label"]),
                        key=lambda s: (len(s), s),
                    )
                    continue
                require(previous[key] == record[key], f"{vote_uri}: valori multipli divergenti per {key}")
            previous["actIds"].add(act_id)
    all_vote_uris = {binding_value(row, "vot") for row in payload["results"]["bindings"]}
    all_vote_uris.discard(None)
    return grouped, len(all_vote_uris - set(grouped))


def parse_nominal_votes(payload: dict[str, Any], vote_uri: str) -> dict[str, str]:
    votes: dict[str, str] = {}
    for row in payload["results"]["bindings"]:
        dep_uri = binding_value(row, "dep")
        tipo = binding_value(row, "tipo")
        require(dep_uri is not None and tipo is not None, f"{vote_uri}: voto senza deputato o tipo")
        assert dep_uri is not None and tipo is not None
        match = DEPUTY_ID_RE.search(dep_uri)
        require(match is not None, f"{vote_uri}: votante non deputato XIX {dep_uri}")
        assert match is not None
        code = VOTE_TYPE_CODES.get(tipo)
        require(code is not None, f"{vote_uri}: tipo voto inatteso {tipo!r}")
        assert code is not None
        numeric_id = match.group(2)
        previous = votes.get(numeric_id)
        require(previous is None or previous == code, f"{vote_uri}: voto conflittuale per d{numeric_id}")
        votes[numeric_id] = code
    return votes


def build_snapshot(
    payloads: dict[str, dict[str, Any]],
    response_locks: dict[str, dict[str, Any]],
    nominal_payloads: dict[str, dict[str, Any]],
    nominal_digest: dict[str, Any],
) -> dict[str, Any]:
    acts = parse_acts(payloads["acts"])
    require(len(acts) > 0, "SPARQL acts vuoto")
    act_ids = set(acts)

    co_signers, co_signers_not_deputy = parse_co_signers(payloads["coSigners"], act_ids)
    iters = parse_iter_states(payloads["iterStates"], act_ids)
    vote_groups, final_votes_excluded = parse_final_votes(payloads["finalVotes"], act_ids)
    relation_excluded_votes = final_votes_excluded
    final_votes_observed = len(vote_groups) + final_votes_excluded

    final_votes: dict[str, dict[str, Any]] = {}
    quality_excluded_vote_uris: set[str] = set()
    for uri in sorted(vote_groups):
        group = vote_groups[uri]
        if len(group["actIds"]) != 1:
            quality_excluded_vote_uris.add(uri)
            continue
        record = {key: value for key, value in group.items() if key != "actIds"}
        record["actId"] = sorted(group["actIds"])[0]
        votes = parse_nominal_votes(nominal_payloads[uri], uri)
        record["votes"] = {key: votes[key] for key in sorted(votes, key=int)}
        record["secret"] = "V" in votes.values()
        counts = Counter(votes.values())
        if (
            counts["F"] != record["favorevoli"]
            or counts["C"] != record["contrari"]
            or counts["A"] != record["astenuti"]
        ):
            quality_excluded_vote_uris.add(uri)
        if record["favorevoli"] + record["contrari"] != record["votanti"]:
            quality_excluded_vote_uris.add(uri)
        if record["favorevoli"] + record["contrari"] + record["astenuti"] != record["presenti"]:
            quality_excluded_vote_uris.add(uri)
        if record["approved"] != (record["favorevoli"] > record["maggioranza"]):
            quality_excluded_vote_uris.add(uri)
        if uri not in quality_excluded_vote_uris:
            final_votes[uri] = record
    final_votes_excluded += len(quality_excluded_vote_uris)

    iter_less = sorted(act_id for act_id in act_ids if not iters.get(act_id))
    require(
        len(iter_less) <= int(len(act_ids) * MAX_ITER_LESS_SHARE),
        f"atti senza iter oltre soglia: {len(iter_less)} su {len(act_ids)}",
    )

    outcome_classes: dict[str, dict[str, Any]] = {
        class_id: {"id": class_id, "label": label, "officialStates": set(states)}
        for class_id, label, states in OUTCOME_CLASSES
    }
    for entries in iters.values():
        for entry in entries:
            outcome_classes[outcome_class_of(entry["state"])]["officialStates"].add(entry["state"])

    act_list: list[dict[str, Any]] = []
    acts_by_nature: Counter[str] = Counter()
    acts_by_outcome: Counter[str] = Counter()
    first_signers: set[str] = set()
    co_signer_set: set[str] = set()
    signatures = 0
    for act_id in sorted(act_ids, key=lambda item: (acts[item]["baseNumber"], acts[item]["number"])):
        act = acts[act_id]
        entries = iters.get(act_id) or []
        current = pick_current_state(entries) if entries else None
        outcome = outcome_class_of(current["state"]) if current else None
        proposer_deputy = (
            act["proposer"]["deputyId"] if act["proposer"]["kind"] == "deputy" else None
        )
        co = sorted(co_signers.get(act_id, set()) - ({proposer_deputy} if proposer_deputy else set()))
        vote_ids = sorted(vote["id"] for vote in final_votes.values() if vote["actId"] == act_id)
        if proposer_deputy:
            first_signers.add(proposer_deputy)
        co_signer_set.update(co)
        signatures += (1 if proposer_deputy else 0) + len(co)
        acts_by_nature[act["natureId"]] += 1
        if outcome is not None:
            acts_by_outcome[outcome] += 1
        act_list.append({
            "id": act_id,
            "number": act["number"],
            "baseNumber": act["baseNumber"],
            "uri": act["uri"],
            "natureId": act["natureId"],
            "title": act["title"],
            "presentedDate": act["presentedDate"],
            "initiative": act["initiative"],
            "proposer": act["proposer"],
            "responsibleGovernment": act["responsibleGovernment"],
            "coSignerIds": co,
            "iter": entries,
            "currentState": current,
            "outcomeClass": outcome,
            "finalVoteIds": vote_ids,
            "officialPage": ACT_PAGE_BASE.format(number=act["number"]),
        })

    today = datetime.now(timezone.utc)
    observed = today.date().isoformat()
    snapshot = {
        "schemaVersion": 2,
        "chamber": "camera",
        "legislature": {
            "number": 19,
            "id": "repubblica_19",
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
        "soldi": {"present": False, "note": "Atti, iter e votazioni: nessun importo."},
        "provenance": {
            "kind": "official-sparql",
            "owner": "Camera dei deputati",
            "title": "Open Data Camera — atti di iniziativa parlamentare e governativa, iter e votazioni finali (OCD)",
            "endpointUrl": ENDPOINT,
            "landingUrl": LANDING,
            "license": "CC BY 4.0 (dichiarata dal portale dati.camera.it)",
            "licenseUrl": LICENSE_URL,
            "legislatureUri": LEGISLATURE_URI,
            "acquiredAt": today.replace(microsecond=0).isoformat(),
            "responses": {
                **response_locks,
                "nominalVotes": nominal_digest,
            },
            "gap": "Il Senato espone DDL, iter e voti nominali su dati.senato.it con ontologia diversa: non è incluso in questo snapshot e richiede un adapter separato.",
        },
        "outcomeClasses": [
            {
                "id": outcome_classes[class_id]["id"],
                "label": outcome_classes[class_id]["label"],
                "officialStates": sorted(outcome_classes[class_id]["officialStates"]),
            }
            for class_id, _label, _states in OUTCOME_CLASSES
        ],
        "coverage": {
            "acts": len(act_list),
            "actsByInitiative": {
                "parliamentary": sum(1 for act in act_list if act["initiative"]["kind"] == "parliamentary"),
                "government": sum(1 for act in act_list if act["initiative"]["kind"] == "government"),
            },
            "actsByNature": {key: acts_by_nature[key] for key in sorted(acts_by_nature)},
            "signatures": signatures,
            "coSignersNotDeputyXix": co_signers_not_deputy,
            "actsWithoutIterState": len(iter_less),
            "finalVotes": len(final_votes),
            "finalVotesObserved": final_votes_observed,
            "finalVotesExcluded": final_votes_excluded,
            "nominalVotes": sum(len(vote["votes"]) for vote in final_votes.values()),
            "secretFinalVotes": sum(1 for vote in final_votes.values() if vote["secret"]),
            "deputiesAsFirstSigner": len(first_signers),
            "deputiesAsCoSigner": len(co_signer_set),
            "actsByOutcomeClass": {key: acts_by_outcome[key] for key in sorted(acts_by_outcome)},
        },
        "acts": act_list,
        "finalVotes": [final_votes[uri] for uri in sorted(final_votes, key=lambda item: final_votes[item]["id"])],
        "caveats": [
            "Negli atti di iniziativa governativa il proponente formale è il Governo: i membri del Governo presenti nella sorgente non sono attribuiti come autori individuali.",
            "Il Governo responsabile deriva dalla relazione ufficiale esposta da dati.camera.it ed è mantenuto distinto dal proponente formale.",
            "Una votazione finale riguarda l'atto nel suo complesso: non prova sostegno o opposizione a ogni singola misura contenuta nel testo.",
            f"Sono escluse {relation_excluded_votes} votazioni finali il cui collegamento all'atto non è risolvibile nel perimetro ufficiale acquisito.",
            f"Sono escluse {len(quality_excluded_vote_uris)} votazioni finali i cui conteggi o collegamenti ufficiali non si riconciliano.",
            "La firma di un atto non equivale alla paternità del testo finale: l'iter parlamentare può modificare il testo approvato.",
            "'Arrivata in fondo' corrisponde alla classe 'legge' ricavata dalle etichette ufficiali degli stati iter della Camera.",
            "I conteggi di firme, atti e voti non misurano produttività o merito dei deputati.",
            "'Non ha votato' non distingue assenza, missione o scelta: la fonte non espone quel dettaglio in questo endpoint.",
            "Nel conteggio ufficiale della Camera gli astenuti sono presenti ma non votanti.",
            "Nelle votazioni segrete il voto individuale non è pubblico: il nominativo risulta 'Ha votato' senza posizione.",
            "Questo snapshot copre la Camera; il Senato ha uno snapshot separato (senato-atti-voti-xix) con ontologia e regole di conteggio proprie.",
            "Nessun importo in questo snapshot: per la spesa pubblica usare le sezioni dedicate.",
        ],
    }
    validate_snapshot(snapshot)
    return snapshot


# --------------------------------------------------------------------------- #
# Validation
# --------------------------------------------------------------------------- #


def validate_snapshot(payload: dict[str, Any], locks: dict[str, Any] | None = None) -> None:
    require(payload.get("schemaVersion") == 2, "schemaVersion inattesa")
    require(payload.get("chamber") == "camera", "chamber inattesa")
    legislature = payload.get("legislature") or {}
    require(legislature.get("number") == 19, "legislature.number inatteso")
    require(legislature.get("id") == "repubblica_19", "legislature.id inatteso")
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
        ("kind", "official-sparql"), ("owner", "Camera dei deputati"),
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
    require([item.get("id") for item in outcome_classes] == [cid for cid, _l, _s in OUTCOME_CLASSES],
            "outcomeClasses fuori ordine o incomplete")
    state_to_class: dict[str, str] = {}
    class_states: dict[str, set[str]] = {}
    for item in outcome_classes:
        states = item.get("officialStates") or []
        require(isinstance(item.get("label"), str) and item["label"].strip(), f"{item.get('id')}: label assente")
        require(isinstance(states, list) and states, f"{item.get('id')}: officialStates assenti")
        for state in states:
            require(isinstance(state, str) and state.strip(), f"{item.get('id')}: stato vuoto")
            require(state not in state_to_class, f"stato {state!r} in più classi")
            require(
                outcome_class_of(state) == item["id"],
                f"stato {state!r} dichiarato in classe {item['id']} ma mappato altrove",
            )
            state_to_class[state] = item["id"]
        class_states[item["id"]] = set(states)
    rank = {item["id"]: index for index, item in enumerate(outcome_classes)}

    acts = payload.get("acts") or []
    final_votes = payload.get("finalVotes") or []
    require(isinstance(acts, list) and len(acts) > 0, "acts assenti")
    require(isinstance(final_votes, list) and len(final_votes) > 0, "finalVotes assenti")

    vote_ids: set[str] = set()
    for vote in final_votes:
        vid = vote.get("id")
        require(isinstance(vid, str) and vid not in vote_ids, f"votazione duplicata: {vid}")
        vote_ids.add(str(vid))
    vote_act_by_id = {vote["id"]: vote.get("actId") for vote in final_votes}

    act_ids: set[str] = set()
    linked_vote_ids: set[str] = set()
    iter_less = 0
    previous_key: tuple[int, str] | None = None
    for act in acts:
        aid = act.get("id")
        require(isinstance(aid, str) and aid not in act_ids, f"atto duplicato: {aid}")
        act_ids.add(str(aid))
        match = re.fullmatch(r"ac19_(\d+(?:-[A-Za-z]+)?)", aid)
        require(match is not None and match.group(1) == act.get("number"), f"{aid}: number incoerente")
        require(
            isinstance(act.get("baseNumber"), int)
            and act["baseNumber"] == int(re.match(r"\d+", act["number"]).group()),
            f"{aid}: baseNumber incoerente",
        )
        order_key = (act["baseNumber"], act["number"])
        require(previous_key is None or order_key > previous_key, "acts fuori ordine")
        previous_key = order_key
        require(str(act.get("uri") or "").endswith(f"/attocamera.rdf/{aid}"), f"{aid}: uri")
        require(act.get("natureId") in NATURE_IDS, f"{aid}: natureId {act.get('natureId')!r}")
        require(act.get("title") is None or (isinstance(act["title"], str) and act["title"].strip()), f"{aid}.title")
        if act.get("presentedDate") is not None:
            require(bool(ISO_DATE.match(act["presentedDate"])), f"{aid}: presentedDate non ISO")
        initiative = act.get("initiative") or {}
        proposer = act.get("proposer") or {}
        responsible_government = act.get("responsibleGovernment")
        require(initiative.get("kind") in {"parliamentary", "government"}, f"{aid}: initiative.kind")
        require(isinstance(initiative.get("label"), str) and initiative["label"].strip(), f"{aid}: initiative.label")
        if initiative["kind"] == "parliamentary":
            require(proposer.get("kind") == "deputy", f"{aid}: proponente parlamentare")
            first = proposer.get("deputyId")
            require(isinstance(first, str) and FIRST_SIGNER_RE.match(first), f"{aid}: proposer.deputyId {first!r}")
            require(responsible_government is None, f"{aid}: Governo su iniziativa parlamentare")
        else:
            require(proposer == {"kind": "government", "label": "Governo"}, f"{aid}: proponente Governo")
            if responsible_government is not None:
                require(isinstance(responsible_government, dict), f"{aid}: Governo responsabile")
                government_uri = responsible_government.get("uri")
                require(isinstance(government_uri, str), f"{aid}: URI Governo responsabile")
                government_id = parse_uri_id(government_uri, GOVERNMENT_ID_RE, "Governo responsabile")
                require(responsible_government.get("id") == government_id, f"{aid}: id Governo responsabile")
                require(
                    isinstance(responsible_government.get("label"), str)
                    and responsible_government["label"].strip(),
                    f"{aid}: etichetta Governo responsabile",
                )
            first = None
        co = act.get("coSignerIds") or []
        require(isinstance(co, list) and len(set(co)) == len(co), f"{aid}: coSignerIds")
        require(all(isinstance(item, str) and FIRST_SIGNER_RE.match(item) for item in co), f"{aid}: coSigner non deputato")
        require(first is None or first not in co, f"{aid}: primo firmatario fra i cofirmatari")
        entries = act.get("iter") or []
        require(isinstance(entries, list), f"{aid}.iter")
        if not entries:
            iter_less += 1
        for entry in entries:
            require(entry.get("state") in state_to_class, f"{aid}: stato iter non mappato {entry.get('state')!r}")
            require(bool(ISO_DATE.match(str(entry.get("date") or ""))), f"{aid}: data iter non ISO")
        current = act.get("currentState")
        outcome = act.get("outcomeClass")
        if not entries:
            require(current is None and outcome is None, f"{aid}: currentState senza iter")
        else:
            expected = pick_current_state(entries)
            require(current == expected, f"{aid}: currentState incoerente con la regola")
            require(outcome in rank, f"{aid}: outcomeClass {outcome!r}")
            require(current["state"] in class_states[outcome], f"{aid}: stato fuori dalla classe dichiarata")
        for vid in act.get("finalVoteIds") or []:
            require(vid in vote_ids, f"{aid}: finalVoteId sconosciuto {vid}")
            require(vote_act_by_id[vid] == aid and vid not in linked_vote_ids,
                    f"{aid}: finalVoteId attribuito a un altro atto o ripetuto {vid}")
            linked_vote_ids.add(vid)
        require(act.get("officialPage") == ACT_PAGE_BASE.format(number=act["number"]), f"{aid}: officialPage")
    require(linked_vote_ids == vote_ids, "votazioni senza atto collegato")
    require(iter_less <= int(len(acts) * MAX_ITER_LESS_SHARE), f"atti senza iter oltre soglia: {iter_less}")

    for vote in final_votes:
        vid = vote["id"]
        require(str(vote.get("uri") or "").endswith(f"/votazione.rdf/{vid}"), f"{vid}: uri")
        require(vote.get("actId") in act_ids, f"{vid}: actId sconosciuto")
        require(isinstance(vote.get("label"), str) and vote["label"].strip(), f"{vid}.label")
        require(isinstance(vote.get("sessionId"), str) and re.fullmatch(r"s19_\d+", vote["sessionId"]), f"{vid}: sessionId")
        require(bool(ISO_DATE.match(str(vote.get("date") or ""))), f"{vid}: date non ISO")
        for key in ("favorevoli", "contrari", "astenuti", "presenti", "votanti", "maggioranza"):
            require(isinstance(vote.get(key), int) and vote[key] >= 0, f"{vid}.{key}")
        require(vote["favorevoli"] + vote["contrari"] == vote["votanti"],
                f"{vid}: votanti non riconcilia")
        require(vote["favorevoli"] + vote["contrari"] + vote["astenuti"] == vote["presenti"],
                f"{vid}: presenti non riconcilia")
        require(vote.get("approved") == (vote["favorevoli"] > vote["maggioranza"]), f"{vid}: approved incoerente")
        require(isinstance(vote.get("confidenceVote"), bool), f"{vid}: confidenceVote")
        votes = vote.get("votes") or {}
        require(isinstance(votes, dict) and votes, f"{vid}: votes assenti")
        codes = set(VOTE_TYPE_CODES.values())
        for numeric_id, code in votes.items():
            require(isinstance(numeric_id, str) and numeric_id.isdigit(), f"{vid}: chiave voto {numeric_id!r}")
            require(code in codes, f"{vid}: codice voto {code!r}")
        counts = Counter(votes.values())
        require(vote.get("secret") == ("V" in counts), f"{vid}: flag secret incoerente")
        require(counts["F"] == vote["favorevoli"], f"{vid}: favorevoli nominali non riconciliati")
        require(counts["C"] == vote["contrari"], f"{vid}: contrari nominali non riconciliati")
        require(counts["A"] == vote["astenuti"], f"{vid}: astenuti nominali non riconciliati")

    coverage = payload.get("coverage") or {}
    require(coverage.get("acts") == len(acts), "coverage.acts non riconcilia")
    expected_initiatives = Counter(act["initiative"]["kind"] for act in acts)
    require(
        coverage.get("actsByInitiative")
        == {
            "parliamentary": expected_initiatives["parliamentary"],
            "government": expected_initiatives["government"],
        },
        "coverage.actsByInitiative non riconcilia",
    )
    require(coverage.get("actsByNature") == dict(sorted(Counter(act["natureId"] for act in acts).items())),
            "coverage.actsByNature non riconcilia")
    require(coverage.get("signatures") == sum(
        (1 if act["proposer"]["kind"] == "deputy" else 0) + len(act.get("coSignerIds") or [])
        for act in acts
    ),
            "coverage.signatures non riconcilia")
    require(isinstance(coverage.get("coSignersNotDeputyXix"), int) and coverage["coSignersNotDeputyXix"] >= 0,
            "coverage.coSignersNotDeputyXix")
    require(coverage.get("actsWithoutIterState") == iter_less, "coverage.actsWithoutIterState non riconcilia")
    require(coverage.get("finalVotes") == len(final_votes), "coverage.finalVotes non riconcilia")
    require(isinstance(coverage.get("finalVotesObserved"), int), "coverage.finalVotesObserved")
    require(isinstance(coverage.get("finalVotesExcluded"), int) and coverage["finalVotesExcluded"] >= 0,
            "coverage.finalVotesExcluded")
    require(
        coverage["finalVotesObserved"] == len(final_votes) + coverage["finalVotesExcluded"],
        "coverage votazioni finali non riconciliata",
    )
    require(coverage.get("nominalVotes") == sum(len(vote["votes"]) for vote in final_votes),
            "coverage.nominalVotes non riconcilia")
    require(coverage.get("secretFinalVotes") == sum(1 for vote in final_votes if vote["secret"]),
            "coverage.secretFinalVotes non riconcilia")
    require(coverage.get("deputiesAsFirstSigner") == len({
        act["proposer"]["deputyId"] for act in acts if act["proposer"]["kind"] == "deputy"
    }),
            "coverage.deputiesAsFirstSigner non riconcilia")
    require(coverage.get("deputiesAsCoSigner") == len({item for act in acts for item in (act.get("coSignerIds") or [])}),
            "coverage.deputiesAsCoSigner non riconcilia")
    expected_outcomes = Counter(act["outcomeClass"] for act in acts if act.get("outcomeClass"))
    require(coverage.get("actsByOutcomeClass") == dict(sorted(expected_outcomes.items())),
            "coverage.actsByOutcomeClass non riconcilia")

    caveats = payload.get("caveats") or []
    require(isinstance(caveats, list) and len(caveats) >= 5, "caveats assenti")


# --------------------------------------------------------------------------- #
# Entry points
# --------------------------------------------------------------------------- #


def require_coverage_floor(coverage: dict[str, Any], spec: dict[str, Any]) -> None:
    floor = spec.get("coverageFloor") or {}
    require(coverage["acts"] >= int(floor.get("acts", 2500)), "coverage acts sotto floor")
    require(coverage["finalVotes"] >= int(floor.get("finalVotes", 50)), "coverage finalVotes sotto floor")
    require(
        coverage["finalVotesObserved"] >= int(floor.get("finalVotesObserved", 300)),
        "coverage finalVotes osservate sotto floor",
    )
    require(
        coverage["deputiesAsFirstSigner"] >= int(floor.get("deputiesAsFirstSigner", 300)),
        "coverage deputiesAsFirstSigner sotto floor",
    )


def check_committed(spec: dict[str, Any]) -> None:
    payload = json.loads(OUTPUT.read_text(encoding="utf-8"))
    locks = (spec.get("source") or {}).get("committedResponses") or None
    validate_snapshot(payload, locks=locks)
    coverage = payload["coverage"]
    require_coverage_floor(coverage, spec)
    print(
        f"OK camera-atti-voti-xix: {coverage['acts']} atti, {coverage['finalVotes']} votazioni finali, "
        f"{coverage['deputiesAsFirstSigner']} primi firmatari, {coverage['nominalVotes']} voti nominali"
    )


def refresh() -> dict[str, Any]:
    payloads: dict[str, dict[str, Any]] = {}
    response_locks: dict[str, dict[str, Any]] = {}
    for key, query in QUERIES.items():
        if key == "coSigners":
            payloads[key], response_locks[key] = sparql_fetch_keyset(query, "atto")
        else:
            payloads[key], response_locks[key] = sparql_fetch_paged(query)
    acts = parse_acts(payloads["acts"])
    require(len(acts) >= 2500, f"atti insufficienti: {len(acts)}")
    act_ids = set(acts)
    vote_groups, _ = parse_final_votes(payloads["finalVotes"], act_ids)
    nominal_payloads, nominal_digest = fetch_nominal_votes(sorted(vote_groups))
    return build_snapshot(payloads, response_locks, nominal_payloads, nominal_digest)


def main() -> int:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--check", action="store_true", help="valida lo snapshot committato senza rete")
    parser.add_argument("--write", action="store_true", help="scarica la fonte Camera e riscrive lo snapshot")
    args = parser.parse_args()
    if args.check == args.write:
        raise SystemExit("specificare esattamente una azione: --check oppure --write")

    spec = load_spec()
    if args.check:
        check_committed(spec)
        return 0

    snapshot = refresh()
    require_coverage_floor(snapshot["coverage"], spec)
    OUTPUT.parent.mkdir(parents=True, exist_ok=True)
    write_atomic(OUTPUT, serialize_snapshot(snapshot))
    print(f"written {OUTPUT.relative_to(ROOT)} ({snapshot['coverage']['acts']} acts)")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
