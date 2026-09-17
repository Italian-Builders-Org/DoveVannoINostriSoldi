#!/usr/bin/env python3
"""Current Senate XIX roster and groups from official dati.senato.it exports."""

from __future__ import annotations

import argparse
import hashlib
import json
import re
import ssl
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


def bindings(payload: dict[str, Any], source_id: str) -> list[dict[str, Any]]:
    head = payload.get("head") or {}
    require(head.get("vars") == EXPECTED_HEADERS[source_id], f"{source_id}: schema inatteso")
    rows = (payload.get("results") or {}).get("bindings")
    require(isinstance(rows, list) and rows, f"{source_id}: righe assenti")
    return rows


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

    senators: list[dict[str, Any]] = []
    group_counts: Counter[str] = Counter()
    group_meta: dict[str, dict[str, str]] = {}
    life_senators = 0
    elected_senators = 0

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
        birthplace = ", ".join(part for part in (birth_city, birth_province, birth_country) if part)
        role = "Senatore/trice a vita" if is_life else "Senatore/trice"
        bio_parts = [f"{role} della XIX Legislatura.", f"Aderisce al gruppo {label}."]
        if birth_date and birthplace:
            bio_parts.append(f"Nascita: {birth_date}, {birthplace}.")

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
            "mandateType": mandate_type,
            "isLifeSenator": is_life,
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
        },
        "source": {
            "owner": "Senato della Repubblica",
            "title": "dati.senato.it — Composizione",
            "endpointUrl": ENDPOINT,
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
            "La descrizione combina soltanto dati anagrafici, tipo di mandato e gruppo pubblicati dal Senato; non è una biografia editoriale.",
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
    for senator in senators:
        require(senator.get("groupId") in group_ids, f"{senator.get('id')}: gruppo sconosciuto")
        for key in ("uri", "officialPage", "photoUrl"):
            parsed = urlparse(str(senator.get(key) or ""))
            require(parsed.scheme in {"http", "https"} and bool(parsed.netloc), f"{senator.get('id')}.{key}")
        require(isinstance(senator.get("biography"), str) and senator["biography"], f"{senator.get('id')}: bio assente")
    for group in groups:
        count = sum(1 for senator in senators if senator.get("groupId") == group.get("id"))
        require(group.get("memberCount") == count, f"{group.get('id')}: memberCount non riconcilia")

    source = payload.get("source") or {}
    require(source.get("landingUrl") == LANDING and source.get("endpointUrl") == ENDPOINT, "provenance diverge")
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
    try:
        with urllib.request.urlopen(req, context=ssl.create_default_context(), timeout=120) as response:
            return response.read()
    except urllib.error.URLError as error:
        raise SnapshotError(f"fonte Senato non raggiungibile: {error}") from error


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
    return build_snapshot(payloads, raws, observed_date=observed_date)


def check_committed(spec: dict[str, Any]) -> None:
    payload = json.loads(OUTPUT.read_text(encoding="utf-8"))
    locks = (spec.get("source") or {}).get("committedResponses") or {}
    validate_snapshot(payload, locks=locks)
    require(payload["source"]["observedDate"] == spec["period"]["observedDate"], "period observedDate diverge")
    require(payload["coverage"]["senators"] >= spec["coverageFloor"]["senators"], "coverage senators sotto floor")
    require(payload["coverage"]["groups"] >= spec["coverageFloor"]["groups"], "coverage groups sotto floor")
    print(f"OK politici-senato-xix: {payload['coverage']['senators']} senatori, {payload['coverage']['groups']} gruppi")


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
    snapshot = refresh(spec)
    OUTPUT.write_text(json.dumps(snapshot, ensure_ascii=False, indent=2) + "\n", encoding="utf-8")
    print(f"written {OUTPUT.relative_to(ROOT)} ({snapshot['coverage']['senators']} senators)")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
