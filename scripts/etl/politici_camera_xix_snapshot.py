#!/usr/bin/env python3
"""Camera XIX deputies + parliamentary groups snapshot (dati.camera.it SPARQL).

Offline --check validates the committed artifact. Live refresh hits the official
SPARQL endpoint and fail-closes on empty, duplicate, or unreconciled coverage.
"""

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
LICENSE_URL = "https://creativecommons.org/licenses/by/4.0/"
SHA_RE = re.compile(r"^[0-9a-f]{64}$")
ISO_DATE = re.compile(r"^\d{4}-\d{2}-\d{2}$")
GROUP_ID_RE = re.compile(r"/gruppoParlamentare\.rdf/(gr\d+)$")
DEPUTY_ID_RE = re.compile(r"/deputato\.rdf/(d\d+_19)$")
USER_AGENT = "DoveVannoINostriSoldi-ETL/1.0 (+https://github.com/Italian-Builders-Org/DoveVannoINostriSoldi)"

SPARQL = """
PREFIX ocd: <http://dati.camera.it/ocd/>
PREFIX rdfs: <http://www.w3.org/2000/01/rdf-schema#>
PREFIX foaf: <http://xmlns.com/foaf/0.1/>

SELECT DISTINCT ?deputato ?nome ?cognome ?gender ?page ?foto ?gruppo ?gruppoLabel ?start
WHERE {
  ?deputato a ocd:deputato ;
            ocd:rif_leg <http://dati.camera.it/ocd/legislatura.rdf/repubblica_19> ;
            foaf:firstName ?nome ;
            foaf:surname ?cognome ;
            ocd:aderisce ?adesione .
  ?adesione ocd:rif_gruppoParlamentare ?gruppo .
  ?gruppo rdfs:label ?gruppoLabel .
  FILTER NOT EXISTS { ?adesione ocd:endDate ?ended }
  OPTIONAL { ?deputato foaf:gender ?gender }
  OPTIONAL { ?deputato foaf:page ?page }
  OPTIONAL { ?deputato foaf:depiction ?foto }
  OPTIONAL { ?adesione ocd:startDate ?start }
}
ORDER BY ?cognome ?nome ?start
""".strip()


class SnapshotError(ValueError):
    """Committed snapshot or live SPARQL payload failed closed."""


def require(condition: bool, message: str) -> None:
    if not condition:
        raise SnapshotError(message)


def sha256_bytes(raw: bytes) -> str:
    return hashlib.sha256(raw).hexdigest()


def load_spec(path: Path = SPEC) -> dict[str, Any]:
    spec = json.loads(path.read_text(encoding="utf-8"))
    require(spec["datasetId"] == DATASET, "dataset identity differs")
    require(spec["source"]["endpointUrl"] == ENDPOINT, "endpoint diverge")
    require(spec["source"]["landingUrl"] == LANDING, "landing diverge")
    require(spec["source"]["legislatureUri"] == LEGISLATURE_URI, "legislature diverge")
    require(spec["source"]["licenseUrl"] == LICENSE_URL, "license URL diverge")
    return spec


def title_case_name(value: str) -> str:
    return " ".join(part.capitalize() for part in value.strip().split())


def normalize_group_label(label: str) -> str:
    text = " ".join(label.split())
    canonical = (
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
    for name in canonical:
        if text.startswith(name):
            return name
    # Camera labels sometimes append " dal YYYY-MM-DD"
    text = re.sub(r"\s+dal\s+\d{4}-\d{2}-\d{2}$", "", text, flags=re.IGNORECASE)
    return text.strip() or label.strip()


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


def pick_current_membership(rows: list[dict[str, Any]]) -> dict[str, Any] | None:
    """Pick the latest among memberships already filtered as open by SPARQL."""
    if not rows:
        return None

    def sort_key(row: dict[str, Any]) -> tuple[str, str]:
        start = binding_value(row, "start") or ""
        group = binding_value(row, "gruppo") or ""
        return (start, group)

    return max(rows, key=sort_key)


def validate_snapshot(payload: dict[str, Any], *, expected_sha: str | None = None) -> None:
    require(payload.get("schemaVersion") == 1, "schemaVersion inattesa")
    require(payload.get("chamber") == "camera", "chamber inattesa")
    legislature = payload.get("legislature") or {}
    require(legislature.get("id") == "repubblica_19", "legislature.id inatteso")
    require(legislature.get("uri") == LEGISLATURE_URI, "legislature.uri diverge")
    require(bool(ISO_DATE.match(str(legislature.get("startDate") or ""))), "startDate non ISO")

    source = payload.get("source") or {}
    require(source.get("endpointUrl") == ENDPOINT, "source.endpointUrl diverge")
    require(source.get("landingUrl") == LANDING, "source.landingUrl diverge")
    require(source.get("legislatureUri") == LEGISLATURE_URI, "source.legislatureUri diverge")
    require(source.get("licenseUrl") == LICENSE_URL, "source.licenseUrl diverge")
    require(SHA_RE.match(str(source.get("responseSha256") or "")), "responseSha256 non valido")
    require(isinstance(source.get("responseBytes"), int) and source["responseBytes"] > 0, "responseBytes")
    require(isinstance(source.get("acquiredAt"), str) and "T" in source["acquiredAt"], "acquiredAt")
    require(urlparse(str(source.get("landingUrl"))).scheme == "https", "landing non https")

    caveats = payload.get("caveats") or []
    require(isinstance(caveats, list) and len(caveats) >= 1, "caveats assenti")

    groups = payload.get("groups") or []
    deputies = payload.get("deputies") or []
    require(isinstance(groups, list) and len(groups) >= 1, "groups assenti")
    require(isinstance(deputies, list) and len(deputies) >= 1, "deputies assenti")

    coverage = payload.get("coverage") or {}
    require(coverage.get("deputies") == len(deputies), "coverage.deputies non riconcilia")
    require(coverage.get("groups") == len(groups), "coverage.groups non riconcilia")
    with_group = sum(1 for d in deputies if d.get("groupId"))
    without_group = sum(1 for d in deputies if not d.get("groupId"))
    require(coverage.get("deputiesWithGroup") == with_group, "deputiesWithGroup non riconcilia")
    require(coverage.get("deputiesWithoutGroup") == without_group, "deputiesWithoutGroup non riconcilia")
    require(with_group + without_group == len(deputies), "with/without non sommano")

    group_ids: set[str] = set()
    for group in groups:
        gid = group.get("id")
        require(isinstance(gid, str) and gid.startswith("gr"), f"group id invalido: {gid}")
        require(gid not in group_ids, f"gruppo duplicato: {gid}")
        group_ids.add(gid)
        require(str(group.get("uri") or "").endswith(f"/gruppoParlamentare.rdf/{gid}"), "group uri")
        require(isinstance(group.get("label"), str) and group["label"].strip(), "group label")
        require(isinstance(group.get("memberCount"), int) and group["memberCount"] >= 0, "memberCount")

    deputy_ids: set[str] = set()
    for deputy in deputies:
        did = deputy.get("id")
        require(isinstance(did, str) and did.startswith("d") and did.endswith("_19"), f"deputy id: {did}")
        require(did not in deputy_ids, f"deputato duplicato: {did}")
        deputy_ids.add(did)
        require(str(deputy.get("uri") or "").endswith(f"/deputato.rdf/{did}"), "deputy uri")
        for field in ("firstName", "lastName", "displayName"):
            require(isinstance(deputy.get(field), str) and deputy[field].strip(), f"{did}.{field}")
        gid = deputy.get("groupId")
        if gid is not None:
            require(gid in group_ids, f"{did}: groupId sconosciuto {gid}")
            require(isinstance(deputy.get("groupLabel"), str) and deputy["groupLabel"].strip(), f"{did}.groupLabel")
        else:
            require(deputy.get("groupLabel") in (None, ""), f"{did}: label senza gruppo")
        for url_field in ("officialPage", "photoUrl"):
            value = deputy.get(url_field)
            if value is None:
                continue
            parsed = urlparse(str(value))
            require(parsed.scheme in {"http", "https"} and bool(parsed.netloc), f"{did}.{url_field}")

    for group in groups:
        counted = sum(1 for d in deputies if d.get("groupId") == group["id"])
        require(counted == group["memberCount"], f"{group['id']}: memberCount {group['memberCount']} != {counted}")

    # Vacancies can make current membership lower than the 400-seat capacity.
    require(390 <= len(deputies) <= 400, f"composizione Camera corrente fuori intervallo: {len(deputies)}")
    require(without_group == 0, f"deputati correnti senza gruppo: {without_group}")
    require(coverage.get("seatCapacity") == 400, "seatCapacity Camera inattesa")
    require(coverage.get("vacantSeats") == 400 - len(deputies), "vacantSeats Camera non riconcilia")

    if expected_sha is not None:
        require(source["responseSha256"] == expected_sha, "responseSha256 diverge dallo source lock")


def build_snapshot_from_bindings(bindings: list[dict[str, Any]], *, response_bytes: int, response_sha: str) -> dict[str, Any]:
    require(len(bindings) > 0, "SPARQL vuoto")
    by_deputy: dict[str, list[dict[str, Any]]] = defaultdict(list)
    identity: dict[str, dict[str, Any]] = {}

    for row in bindings:
        uri = binding_value(row, "deputato")
        require(uri is not None, "riga senza deputato")
        assert uri is not None
        did = parse_uri_id(uri, DEPUTY_ID_RE, "deputato")
        by_deputy[did].append(row)
        if did not in identity:
            first = binding_value(row, "nome")
            last = binding_value(row, "cognome")
            require(first and last, f"{did}: nome/cognome assenti")
            assert first and last
            identity[did] = {
                "id": did,
                "uri": uri,
                "firstName": first.strip(),
                "lastName": last.strip(),
                "displayName": f"{title_case_name(first)} {title_case_name(last)}",
                "gender": binding_value(row, "gender"),
                "officialPage": binding_value(row, "page"),
                "photoUrl": binding_value(row, "foto"),
            }

    deputies: list[dict[str, Any]] = []
    group_members: Counter[str] = Counter()
    group_meta: dict[str, dict[str, str]] = {}

    for did, rows in sorted(by_deputy.items(), key=lambda item: (
        identity[item[0]]["lastName"],
        identity[item[0]]["firstName"],
        item[0],
    )):
        membership = pick_current_membership(rows)
        group_id = None
        group_label = None
        if membership is not None:
            group_uri = binding_value(membership, "gruppo")
            raw_label = binding_value(membership, "gruppoLabel")
            if group_uri and raw_label:
                group_id = parse_uri_id(group_uri, GROUP_ID_RE, "gruppo")
                group_label = normalize_group_label(raw_label)
                group_members[group_id] += 1
                group_meta[group_id] = {"uri": group_uri, "label": group_label}

        person = dict(identity[did])
        person["groupId"] = group_id
        person["groupLabel"] = group_label
        deputies.append(person)

    groups = [
        {
            "id": gid,
            "uri": group_meta[gid]["uri"],
            "label": group_meta[gid]["label"],
            "memberCount": group_members[gid],
        }
        for gid in sorted(group_members.keys(), key=lambda g: (-group_members[g], group_meta[g]["label"], g))
    ]

    with_group = sum(1 for d in deputies if d["groupId"])
    snapshot = {
        "schemaVersion": 1,
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
            "deputiesWithGroup": with_group,
            "deputiesWithoutGroup": len(deputies) - with_group,
            "seatCapacity": 400,
            "vacantSeats": 400 - len(deputies),
        },
        "source": {
            "owner": "Camera dei deputati",
            "title": "Open Data Camera — endpoint SPARQL OCD",
            "endpointUrl": ENDPOINT,
            "landingUrl": LANDING,
            "license": "CC BY 4.0 (dichiarata dal portale dati.camera.it)",
            "licenseUrl": LICENSE_URL,
            "legislatureUri": LEGISLATURE_URI,
            "acquiredAt": datetime.now(timezone.utc).replace(microsecond=0).isoformat(),
            "responseBytes": response_bytes,
            "responseSha256": response_sha,
            "cadence": "continuo / aggiornamento RDF Camera",
        },
        "caveats": [
            "Copre i deputati con adesione parlamentare aperta nella XIX legislatura pubblicati su dati.camera.it; eventuali differenze dai 400 seggi sono esposte come seggi vacanti, non riempite con ex deputati.",
            "Il gruppo parlamentare corrente è l'adesione senza data di fine; le adesioni concluse e gli ex deputati non occupano seggi nell'emiciclo.",
            "Le etichette dei gruppi possono includere frammenti di data nella fonte RDF; qui sono normalizzate al nome del gruppo.",
            "Non è un grafo di potere o di influenza: mostra solo appartenenza formale a gruppi parlamentari e schede ufficiali.",
            "Lo snapshot non contiene notizie di stampa; la UI può interrogare separatamente indici live e deve attribuire ogni link all'editore.",
            "I soldi pubblici non sono in questo snapshot; per bilanci Camera e spesa di governo usare /parlamento e /governi.",
        ],
        "groups": groups,
        "deputies": deputies,
    }
    validate_snapshot(snapshot)
    return snapshot


def sparql_fetch(query: str) -> tuple[dict[str, Any], bytes]:
    body = urllib.parse.urlencode({
        "query": query,
        "format": "application/sparql-results+json",
    }).encode("utf-8")
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
    context = ssl.create_default_context()
    try:
        with urllib.request.urlopen(request, context=context, timeout=120) as response:
            raw = response.read()
    except urllib.error.URLError as error:
        raise SnapshotError(f"SPARQL non raggiungibile: {error}") from error
    try:
        payload = json.loads(raw)
    except json.JSONDecodeError as error:
        raise SnapshotError("risposta SPARQL non JSON") from error
    require("results" in payload and "bindings" in payload["results"], "payload SPARQL senza bindings")
    return payload, raw


def check_committed(spec: dict[str, Any]) -> None:
    raw = OUTPUT.read_bytes()
    payload = json.loads(raw)
    lock = (spec.get("source") or {}).get("committedResponse") or {}
    expected_sha = lock.get("sha256")
    expected_bytes = lock.get("bytes")
    if expected_sha:
        require(SHA_RE.match(str(expected_sha)), "lock sha256 invalido")
        require(payload["source"]["responseSha256"] == expected_sha, "committed responseSha256 diverge dal lock")
    if expected_bytes is not None:
        require(payload["source"]["responseBytes"] == expected_bytes, "committed responseBytes diverge dal lock")
    validate_snapshot(payload, expected_sha=expected_sha if expected_sha else None)
    min_deputies = int(spec.get("coverageFloor", {}).get("deputies", 400))
    min_groups = int(spec.get("coverageFloor", {}).get("groups", 5))
    require(payload["coverage"]["deputies"] >= min_deputies, "coverage deputies sotto floor")
    require(payload["coverage"]["groups"] >= min_groups, "coverage groups sotto floor")
    print(f"OK politici-camera-xix: {payload['coverage']['deputies']} deputati, {payload['coverage']['groups']} gruppi")


def write_snapshot(snapshot: dict[str, Any]) -> None:
    OUTPUT.parent.mkdir(parents=True, exist_ok=True)
    OUTPUT.write_text(json.dumps(snapshot, ensure_ascii=False, indent=2) + "\n", encoding="utf-8")
    print(f"written {OUTPUT.relative_to(ROOT)} ({snapshot['coverage']['deputies']} deputies)")


def main() -> int:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--check", action="store_true", help="valida lo snapshot committato senza rete")
    parser.add_argument("--write", action="store_true", help="scarica SPARQL Camera e riscrive lo snapshot")
    args = parser.parse_args()
    if args.check == args.write:
        raise SystemExit("specificare esattamente una azione: --check oppure --write")

    spec = load_spec()
    if args.check:
        check_committed(spec)
        return 0

    payload, raw = sparql_fetch(SPARQL)
    snapshot = build_snapshot_from_bindings(
        payload["results"]["bindings"],
        response_bytes=len(raw),
        response_sha=sha256_bytes(raw),
    )
    write_snapshot(snapshot)
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
