#!/usr/bin/env python3
"""Republican legislatures served, per chamber, by the XIX deputies and senators in office (#556).

Each chamber is read from its own official SPARQL endpoint and keyed on its own
official identity: the Camera persona (dati.camera.it OCD) and the Senato senator
URI (dati.senato.it OSR). The two chambers are never joined by name, so a term in
the other chamber is not counted. The roster is the one already committed in
politici-camera-xix and politici-senato-xix: --check fails closed when either
roster changes without refreshing this snapshot. --write refreshes from the
official endpoints.
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
from collections import defaultdict
from datetime import datetime, timezone
from pathlib import Path
from typing import Any

ROOT = Path(__file__).resolve().parents[2]
SPEC = ROOT / "scripts/etl/specs/parlamento-mandati-xix.source.json"
OUTPUT = ROOT / "src/data/generated/parlamento-mandati-xix.json"
CAMERA_ROSTER = ROOT / "src/data/generated/politici-camera-xix.json"
SENATO_ROSTER = ROOT / "src/data/generated/politici-senato-xix.json"
DATASET = "parlamento-mandati-xix"
CURRENT_LEGISLATURE = 19
CAMERA_ENDPOINT = "https://dati.camera.it/sparql"
CAMERA_LANDING = "https://dati.camera.it/"
CAMERA_LICENSE_URL = "https://creativecommons.org/licenses/by/4.0/"
SENATO_ENDPOINT = "https://dati.senato.it/sparql"
SENATO_LANDING = "https://dati.senato.it/"
SENATO_LICENSE_URL = "https://creativecommons.org/licenses/by/3.0/it/"
SHA_RE = re.compile(r"^[0-9a-f]{64}$")
ISO_DATE = re.compile(r"^\d{4}-\d{2}-\d{2}$")
CAMERA_DEPUTY_RE = re.compile(r"^http://dati\.camera\.it/ocd/deputato\.rdf/(d(\d+)_19)$")
CAMERA_PERSONA_RE = re.compile(r"^http://dati\.camera\.it/ocd/persona\.rdf/p(\d+)$")
CAMERA_MANDATE_RE = {
    "camera": re.compile(r"^http://dati\.camera\.it/ocd/mandatoCamera\.rdf/mc\d+_\d+_\d{8}$"),
    "senato": re.compile(r"^http://dati\.camera\.it/ocd/mandatoSenato\.rdf/ms\d+_\d+_\d{8}$"),
}
CAMERA_LEGISLATURE_RE = re.compile(r"^http://dati\.camera\.it/ocd/legislatura\.rdf/repubblica_(\d+)$")
SENATO_SENATOR_RE = re.compile(r"^http://dati\.senato\.it/senatore/(\d+)$")
SENATO_MANDATE_RE = re.compile(r"^http://dati\.senato\.it/mandato/([CS])_(\d+)_(\d+)_\d+$")
USER_AGENT = "DoveVannoINostriSoldi-ETL/1.0 (+https://github.com/Italian-Builders-Org/DoveVannoINostriSoldi)"

# Every Camera and Senato mandate that the Camera attaches to the persona holding a
# XIX deputy record. The deputy resource also carries rif_mandatoCamera, so the
# persona is pinned to foaf:Person.
CAMERA_QUERY = """
PREFIX ocd: <http://dati.camera.it/ocd/>
PREFIX foaf: <http://xmlns.com/foaf/0.1/>
SELECT DISTINCT ?deputato ?persona ?mandato ?tipo ?legislatura ?inizio ?fine WHERE {
  ?deputato a ocd:deputato ;
            ocd:rif_leg <http://dati.camera.it/ocd/legislatura.rdf/repubblica_19> ;
            ocd:rif_mandatoCamera ?mandato19 .
  ?persona a foaf:Person ;
           ocd:rif_mandatoCamera ?mandato19 .
  { ?persona ocd:rif_mandatoCamera ?mandato } UNION { ?persona ocd:rif_mandatoSenato ?mandato }
  ?mandato a ?tipo ;
           ocd:rif_leg ?legislatura .
  FILTER(?tipo IN (ocd:mandatoCamera, ocd:mandatoSenato))
  OPTIONAL { ?mandato ocd:startDate ?inizio }
  OPTIONAL { ?mandato ocd:endDate ?fine }
}
ORDER BY ?deputato ?legislatura ?mandato
""".strip()

# Every Senato and Camera mandate that the Senato attaches to a senator with an
# open XIX Senate mandate. The Senato types its mandates with the Camera ontology.
SENATO_QUERY = """
PREFIX osr: <http://dati.senato.it/osr/>
PREFIX ocd: <http://dati.camera.it/ocd/>
SELECT DISTINCT ?senatore ?mandato ?tipo ?legislatura ?inizio ?fine WHERE {
  ?senatore a osr:Senatore ;
            osr:mandato ?mandato19 .
  ?mandato19 a ocd:mandatoSenato ;
             osr:legislatura 19 .
  FILTER NOT EXISTS { ?mandato19 osr:fine ?fine19 }
  ?senatore osr:mandato ?mandato .
  ?mandato a ?tipo ;
           osr:legislatura ?legislatura .
  FILTER(?tipo IN (ocd:mandatoCamera, ocd:mandatoSenato))
  OPTIONAL { ?mandato osr:inizio ?inizio }
  OPTIONAL { ?mandato osr:fine ?fine }
}
ORDER BY ?senatore ?legislatura ?mandato
""".strip()

QUERIES = {"camera": CAMERA_QUERY, "senato": SENATO_QUERY}
MANDATE_TYPES = {
    "http://dati.camera.it/ocd/mandatoCamera": "camera",
    "http://dati.camera.it/ocd/mandatoSenato": "senato",
}
CHAMBERS = ("camera", "senato")

CAVEATS = [
    "Ogni persona è letta dalla fonte del ramo in cui siede oggi: la Camera per i deputati, il Senato per i senatori. I mandati nell'altro ramo sono quelli che quella stessa fonte collega alla persona con il proprio identificativo ufficiale; nessuna persona è associata per nome.",
    "«Primo mandato in questo ramo» significa che la XIX è l'unica legislatura repubblicana con un mandato in quel ramo; «primo mandato parlamentare» che non risultano mandati in nessuno dei due rami prima della XIX. Nessuno dei due indica l'assenza di altri incarichi istituzionali.",
    "Per i senatori a vita il conteggio riporta le legislature in cui hanno seduto al Senato, non elezioni.",
    "Una legislatura conta una volta anche quando la fonte pubblica più mandati nello stesso ramo e nella stessa legislatura, per esempio dopo una proclamazione in sostituzione.",
    "Solo legislature repubblicane: Assemblea Costituente e Regno non sono numerate e un loro mandato blocca l'import invece di essere contato.",
    "Nessun importo e nessun calcolo di vitalizio o trattamento previdenziale: sono soltanto mandati pubblicati dalle due Camere.",
]


class SnapshotError(ValueError):
    """Committed snapshot or live official payload failed closed."""


def require(condition: bool, message: str) -> None:
    if not condition:
        raise SnapshotError(message)


def sha256_bytes(raw: bytes) -> str:
    return hashlib.sha256(raw).hexdigest()


def load_spec(path: Path = SPEC) -> dict[str, Any]:
    spec = json.loads(path.read_text(encoding="utf-8"))
    require(spec.get("datasetId") == DATASET, "dataset identity differs")
    source = spec.get("source") or {}
    require((source.get("camera") or {}).get("endpointUrl") == CAMERA_ENDPOINT, "endpoint Camera diverge")
    require((source.get("senato") or {}).get("endpointUrl") == SENATO_ENDPOINT, "endpoint Senato diverge")
    require((source.get("camera") or {}).get("licenseUrl") == CAMERA_LICENSE_URL, "licenza Camera diverge")
    require((source.get("senato") or {}).get("licenseUrl") == SENATO_LICENSE_URL, "licenza Senato diverge")
    return spec


def binding_value(row: dict[str, Any], key: str) -> str | None:
    cell = row.get(key)
    if not cell:
        return None
    value = cell.get("value")
    return value.strip() if isinstance(value, str) and value.strip() else None


def normalize_date(value: str | None, context: str) -> str | None:
    """Camera publishes YYYYMMDD, Senato YYYY-MM-DD; both become ISO or fail."""
    if value is None:
        return None
    if re.fullmatch(r"\d{8}", value):
        value = f"{value[0:4]}-{value[4:6]}-{value[6:8]}"
    require(bool(ISO_DATE.match(value)), f"{context}: data non interpretabile {value!r}")
    return value


def committed_rosters() -> dict[str, list[str]]:
    camera = json.loads(CAMERA_ROSTER.read_text(encoding="utf-8"))
    senato = json.loads(SENATO_ROSTER.read_text(encoding="utf-8"))
    return {
        "camera": sorted(item["id"] for item in camera["deputies"]),
        "senato": sorted(item["id"] for item in senato["senators"]),
    }


# --------------------------------------------------------------------------- #
# Parsing
# --------------------------------------------------------------------------- #


def collect(mandates: dict[str, dict[str, dict[str, Any]]], member_id: str, uri: str, entry: dict[str, Any]) -> None:
    """One mandate URI is one mandate: repeated rows must agree, never merge silently."""
    previous = mandates[member_id].get(uri)
    require(previous is None or previous == entry, f"{member_id}: mandato {uri} con valori discordanti")
    mandates[member_id][uri] = entry


def mandate_chamber(row: dict[str, Any], member_id: str) -> str:
    kind = MANDATE_TYPES.get(binding_value(row, "tipo") or "")
    require(kind is not None, f"{member_id}: tipo di mandato inatteso {binding_value(row, 'tipo')}")
    assert kind is not None
    return kind


def mandate_entry(row: dict[str, Any], member_id: str, chamber: str, legislature: int) -> dict[str, Any]:
    return {
        "chamber": chamber,
        "legislature": legislature,
        "startDate": normalize_date(binding_value(row, "inizio"), member_id),
        "endDate": normalize_date(binding_value(row, "fine"), member_id),
    }


def parse_camera(payload: dict[str, Any]) -> dict[str, dict[str, Any]]:
    mandates: dict[str, dict[str, dict[str, Any]]] = defaultdict(dict)
    persona_of: dict[str, str] = {}
    for row in payload["results"]["bindings"]:
        deputy_uri = binding_value(row, "deputato") or ""
        deputy = CAMERA_DEPUTY_RE.match(deputy_uri)
        require(deputy is not None, f"URI deputato non riconosciuto: {deputy_uri}")
        assert deputy is not None
        member_id = deputy.group(1)
        persona_uri = binding_value(row, "persona") or ""
        persona = CAMERA_PERSONA_RE.match(persona_uri)
        require(persona is not None, f"{member_id}: persona non riconosciuta {persona_uri}")
        assert persona is not None
        require(persona_of.setdefault(member_id, persona_uri) == persona_uri, f"{member_id}: più persone ufficiali")
        chamber = mandate_chamber(row, member_id)
        mandate_uri = binding_value(row, "mandato") or ""
        require(bool(CAMERA_MANDATE_RE[chamber].match(mandate_uri)), f"{member_id}: mandato {chamber} non riconosciuto {mandate_uri}")
        legislature_uri = binding_value(row, "legislatura") or ""
        legislature = CAMERA_LEGISLATURE_RE.match(legislature_uri)
        # Costituente and Regno are outside the republican count: fail instead of guessing a number.
        require(legislature is not None, f"{member_id}: legislatura non repubblicana {legislature_uri}")
        assert legislature is not None
        collect(mandates, member_id, mandate_uri, mandate_entry(row, member_id, chamber, int(legislature.group(1))))
    return {
        member_id: {"sourceUri": persona_of[member_id], "mandates": list(items.values())}
        for member_id, items in mandates.items()
    }


def parse_senato(payload: dict[str, Any]) -> dict[str, dict[str, Any]]:
    mandates: dict[str, dict[str, dict[str, Any]]] = defaultdict(dict)
    uri_of: dict[str, str] = {}
    for row in payload["results"]["bindings"]:
        senator_uri = binding_value(row, "senatore") or ""
        senator = SENATO_SENATOR_RE.match(senator_uri)
        require(senator is not None, f"URI senatore non riconosciuto: {senator_uri}")
        assert senator is not None
        member_id = f"s{senator.group(1)}"
        uri_of[member_id] = senator_uri
        chamber = mandate_chamber(row, member_id)
        mandate_uri = binding_value(row, "mandato") or ""
        match = SENATO_MANDATE_RE.match(mandate_uri)
        require(match is not None, f"{member_id}: mandato non riconosciuto {mandate_uri}")
        assert match is not None
        # The URI prefix (C_/S_) and the declared type must name the same chamber.
        require({"C": "camera", "S": "senato"}[match.group(1)] == chamber, f"{member_id}: tipo e URI del mandato discordano")
        require(match.group(3) == senator.group(1), f"{member_id}: mandato di un altro senatore {mandate_uri}")
        legislature = binding_value(row, "legislatura") or ""
        require(legislature.isdigit() and legislature == match.group(2), f"{member_id}: legislatura incoerente {legislature!r}")
        collect(mandates, member_id, mandate_uri, mandate_entry(row, member_id, chamber, int(legislature)))
    return {
        member_id: {"sourceUri": uri_of[member_id], "mandates": list(items.values())}
        for member_id, items in mandates.items()
    }


def legislatures_of(mandates: list[dict[str, Any]]) -> dict[str, list[int]]:
    return {
        "camera": sorted({item["legislature"] for item in mandates if item["chamber"] == "camera"}),
        "senato": sorted({item["legislature"] for item in mandates if item["chamber"] == "senato"}),
        "parliament": sorted({item["legislature"] for item in mandates}),
    }


def build_members(chamber: str, parsed: dict[str, dict[str, Any]], roster: list[str]) -> list[dict[str, Any]]:
    missing = [member_id for member_id in roster if member_id not in parsed]
    require(not missing, f"{chamber}: membri in carica senza mandati nella fonte: {missing[:5]}")
    members = []
    for member_id in roster:
        mandates = sorted(
            parsed[member_id]["mandates"],
            key=lambda item: (item["legislature"], item["chamber"], item["startDate"] or "", item["endDate"] or "9999"),
        )
        legislatures = legislatures_of(mandates)
        members.append({
            "id": member_id,
            "chamber": chamber,
            "sourceUri": parsed[member_id]["sourceUri"],
            "legislatures": legislatures,
            "firstTermInChamber": legislatures[chamber] == [CURRENT_LEGISLATURE],
            "firstTermInParliament": legislatures["parliament"] == [CURRENT_LEGISLATURE],
            "mandates": mandates,
        })
    return members


def build_snapshot(payloads: dict[str, dict[str, Any]], raws: dict[str, bytes], rosters: dict[str, list[str]]) -> dict[str, Any]:
    camera = build_members("camera", parse_camera(payloads["camera"]), rosters["camera"])
    senato = build_members("senato", parse_senato(payloads["senato"]), rosters["senato"])
    members = camera + senato
    snapshot = {
        "schemaVersion": 1,
        "datasetId": DATASET,
        "legislature": {"number": CURRENT_LEGISLATURE, "label": "XIX Legislatura"},
        "coverage": coverage_of(members),
        "source": {
            "acquiredAt": datetime.now(timezone.utc).replace(microsecond=0).isoformat(),
            "camera": {
                "owner": "Camera dei deputati",
                "endpointUrl": CAMERA_ENDPOINT,
                "landingUrl": CAMERA_LANDING,
                "license": "CC BY 4.0 (dichiarata dal portale dati.camera.it)",
                "licenseUrl": CAMERA_LICENSE_URL,
                "identity": "persona ufficiale OCD (foaf:Person) → ocd:rif_mandatoCamera / ocd:rif_mandatoSenato → ocd:rif_leg",
                "response": {"bytes": len(raws["camera"]), "sha256": sha256_bytes(raws["camera"])},
            },
            "senato": {
                "owner": "Senato della Repubblica",
                "endpointUrl": SENATO_ENDPOINT,
                "landingUrl": SENATO_LANDING,
                "license": "CC BY 3.0 IT (dichiarata dal portale dati.senato.it)",
                "licenseUrl": SENATO_LICENSE_URL,
                "identity": "senatore ufficiale OSR → osr:mandato (ocd:mandatoSenato / ocd:mandatoCamera) → osr:legislatura",
                "response": {"bytes": len(raws["senato"]), "sha256": sha256_bytes(raws["senato"])},
            },
        },
        "caveats": CAVEATS,
        "members": members,
    }
    validate_snapshot(snapshot, rosters=rosters)
    return snapshot


def coverage_of(members: list[dict[str, Any]]) -> dict[str, int]:
    def count(chamber: str, flag: str | None = None) -> int:
        return sum(1 for item in members if item["chamber"] == chamber and (flag is None or item[flag]))

    return {
        "deputies": count("camera"),
        "senators": count("senato"),
        "firstTermInChamberDeputies": count("camera", "firstTermInChamber"),
        "firstTermInChamberSenators": count("senato", "firstTermInChamber"),
        "firstTermInParliamentDeputies": count("camera", "firstTermInParliament"),
        "firstTermInParliamentSenators": count("senato", "firstTermInParliament"),
        "membersWithOtherChamberMandates": sum(
            1 for item in members
            if any(mandate["chamber"] != item["chamber"] for mandate in item["mandates"])
        ),
    }


# --------------------------------------------------------------------------- #
# Validation
# --------------------------------------------------------------------------- #


def validate_snapshot(
    payload: dict[str, Any],
    locks: dict[str, Any] | None = None,
    rosters: dict[str, list[str]] | None = None,
) -> None:
    require(payload.get("schemaVersion") == 1, "schemaVersion inattesa")
    require(payload.get("datasetId") == DATASET, "datasetId inatteso")
    require((payload.get("legislature") or {}).get("number") == CURRENT_LEGISLATURE, "legislatura corrente inattesa")

    source = payload.get("source") or {}
    require(isinstance(source.get("acquiredAt"), str) and "T" in source["acquiredAt"], "acquiredAt")
    for block_name, endpoint, license_url in (
        ("camera", CAMERA_ENDPOINT, CAMERA_LICENSE_URL),
        ("senato", SENATO_ENDPOINT, SENATO_LICENSE_URL),
    ):
        block = source.get(block_name) or {}
        require(block.get("endpointUrl") == endpoint, f"source.{block_name}.endpointUrl diverge")
        require(block.get("licenseUrl") == license_url, f"source.{block_name}.licenseUrl diverge")
        response = block.get("response") or {}
        require(isinstance(response.get("bytes"), int) and response["bytes"] > 0, f"{block_name}.bytes")
        require(bool(SHA_RE.match(str(response.get("sha256") or ""))), f"{block_name}.sha256")
        if locks is not None:
            require(response == locks.get(block_name), f"{block_name}: source lock diverge")

    caveats = payload.get("caveats") or []
    require(isinstance(caveats, list) and len(caveats) >= 3, "caveats assenti")

    members = payload.get("members") or []
    require(isinstance(members, list) and members, "members assenti")
    seen: set[str] = set()
    for member in members:
        member_id = member.get("id")
        chamber = member.get("chamber")
        require(chamber in {"camera", "senato"}, f"{member_id}: ramo inatteso")
        pattern = r"^d\d+_19$" if chamber == "camera" else r"^s\d+$"
        require(isinstance(member_id, str) and re.match(pattern, member_id) is not None, f"id fuori schema: {member_id}")
        require(member_id not in seen, f"membro duplicato: {member_id}")
        seen.add(str(member_id))
        source_uri = str(member.get("sourceUri") or "")
        if chamber == "camera":
            persona = CAMERA_PERSONA_RE.match(source_uri)
            require(persona is not None and member_id == f"d{persona.group(1)}_19", f"{member_id}: persona incoerente")
        else:
            senator = SENATO_SENATOR_RE.match(source_uri)
            require(senator is not None and member_id == f"s{senator.group(1)}", f"{member_id}: senatore incoerente")

        mandates = member.get("mandates") or []
        require(isinstance(mandates, list) and mandates, f"{member_id}: mandati assenti")
        for mandate in mandates:
            require(mandate.get("chamber") in CHAMBERS, f"{member_id}: ramo del mandato inatteso")
            legislature = mandate.get("legislature")
            require(isinstance(legislature, int) and 1 <= legislature <= CURRENT_LEGISLATURE, f"{member_id}: legislatura fuori intervallo")
            start, end = mandate.get("startDate"), mandate.get("endDate")
            for value in (start, end):
                require(value is None or bool(ISO_DATE.match(str(value))), f"{member_id}: data non ISO")
            if start and end:
                require(start <= end, f"{member_id}: mandato con fine prima dell'inizio")
        require(
            any(
                item["chamber"] == chamber and item["legislature"] == CURRENT_LEGISLATURE and item.get("endDate") is None
                for item in mandates
            ),
            f"{member_id}: nessun mandato XIX aperto nel ramo",
        )
        legislatures = member.get("legislatures")
        require(legislatures == legislatures_of(mandates), f"{member_id}: legislature non riconciliano con i mandati")
        require(
            member.get("firstTermInChamber") is (legislatures[chamber] == [CURRENT_LEGISLATURE]),
            f"{member_id}: firstTermInChamber incoerente",
        )
        require(
            member.get("firstTermInParliament") is (legislatures["parliament"] == [CURRENT_LEGISLATURE]),
            f"{member_id}: firstTermInParliament incoerente",
        )

    require(payload.get("coverage") == coverage_of(members), "coverage non riconcilia")
    if rosters is not None:
        for chamber in CHAMBERS:
            ids = sorted(item["id"] for item in members if item["chamber"] == chamber)
            require(ids == rosters[chamber], f"{chamber}: roster diverso dallo snapshot politici committato")


# --------------------------------------------------------------------------- #
# Official fetching
# --------------------------------------------------------------------------- #


def sparql_fetch(endpoint: str, query: str, method: str) -> tuple[dict[str, Any], bytes]:
    """The Camera endpoint takes POST; the Senato one answers 403 to POST and takes GET."""
    params = urllib.parse.urlencode({"query": query, "format": "application/sparql-results+json"})
    headers = {"User-Agent": USER_AGENT, "Accept": "application/sparql-results+json"}
    if method == "POST":
        headers["Content-Type"] = "application/x-www-form-urlencoded; charset=utf-8"
        request = urllib.request.Request(endpoint, data=params.encode("utf-8"), headers=headers, method="POST")
    else:
        request = urllib.request.Request(f"{endpoint}?{params}", headers=headers, method="GET")
    last_error: Exception | None = None
    for attempt in range(4):
        try:
            with urllib.request.urlopen(request, context=ssl.create_default_context(), timeout=240) as response:
                raw = response.read()
            payload = json.loads(raw)
            require("results" in payload and "bindings" in payload["results"], "payload SPARQL senza bindings")
            return payload, raw
        except (urllib.error.URLError, json.JSONDecodeError) as error:
            last_error = error
            time.sleep(3 * (attempt + 1))
    raise SnapshotError(f"SPARQL {endpoint} non raggiungibile: {last_error}")


def refresh() -> dict[str, Any]:
    payloads: dict[str, dict[str, Any]] = {}
    raws: dict[str, bytes] = {}
    for chamber, endpoint, method in (("camera", CAMERA_ENDPOINT, "POST"), ("senato", SENATO_ENDPOINT, "GET")):
        payloads[chamber], raws[chamber] = sparql_fetch(endpoint, QUERIES[chamber], method)
    return build_snapshot(payloads, raws, committed_rosters())


def check_committed(spec: dict[str, Any]) -> None:
    payload = json.loads(OUTPUT.read_text(encoding="utf-8"))
    locks = (spec.get("source") or {}).get("committedResponses")
    require(isinstance(locks, dict), "committedResponses assenti nello spec")
    validate_snapshot(payload, locks=locks, rosters=committed_rosters())
    coverage = payload["coverage"]
    print(
        f"OK {DATASET}: {coverage['deputies']} deputati ({coverage['firstTermInChamberDeputies']} al primo mandato alla Camera, "
        f"{coverage['firstTermInParliamentDeputies']} in Parlamento), {coverage['senators']} senatori "
        f"({coverage['firstTermInChamberSenators']} al primo mandato al Senato, {coverage['firstTermInParliamentSenators']} in Parlamento)"
    )


def main() -> int:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--check", action="store_true", help="valida lo snapshot committato senza rete")
    parser.add_argument("--write", action="store_true", help="interroga le due Camere e riscrive lo snapshot")
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
    print(f"written {OUTPUT.relative_to(ROOT)}; aggiornare committedResponses nello spec con source.camera/senato.response")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
