#!/usr/bin/env python3
"""Head of State node: official identity from the Camera archive, declared office.

quirinale.it refuses every programmatic request (HTTP 403, robots.txt included),
so the officeholder's tenure cannot be acquired from a machine-readable official
source: it is declared in the spec and flagged as such in the published payload.
Name, stable person identifier and official portrait come from the Camera dei
deputati open data, where the President is recorded as a former deputy.
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
from datetime import datetime, timezone
from pathlib import Path
from typing import Any

ROOT = Path(__file__).resolve().parents[2]
SPEC = ROOT / "scripts/etl/specs/presidente-repubblica.source.json"
OUTPUT = ROOT / "src/data/generated/presidente-repubblica.json"
DATASET = "presidente-repubblica"
ENDPOINT = "https://dati.camera.it/sparql"
QUIRINALE = "https://www.quirinale.it/pagine/il-presidente"
LICENSE_URL = "https://creativecommons.org/licenses/by/4.0/"
PHOTO_TEMPLATE = "https://documenti.camera.it/apps/nuovosito/deputato/getFoto.asp?id={persona}&legislatura=15"
SHA_RE = re.compile(r"^[0-9a-f]{64}$")
DATE_RE = re.compile(r"^\d{4}-\d{2}-\d{2}$")
USER_AGENT = "DoveVannoINostriSoldi-ETL/1.0 (+https://github.com/Italian-Builders-Org/DoveVannoINostriSoldi)"
MONTHS_IT = (
    "gennaio", "febbraio", "marzo", "aprile", "maggio", "giugno",
    "luglio", "agosto", "settembre", "ottobre", "novembre", "dicembre",
)

IDENTITY_QUERY = """
PREFIX ocd: <http://dati.camera.it/ocd/>
PREFIX foaf: <http://xmlns.com/foaf/0.1/>
PREFIX rdfs: <http://www.w3.org/2000/01/rdf-schema#>

SELECT DISTINCT ?persona ?nome ?cognome ?label ?depiction ?sameAs
WHERE {
  BIND(<http://dati.camera.it/ocd/persona.rdf/p23870> AS ?persona)
  ?persona a foaf:Person ;
           rdfs:label ?label ;
           foaf:firstName ?nome ;
           foaf:surname ?cognome .
  OPTIONAL { ?persona foaf:depiction ?depiction }
  OPTIONAL { ?persona <http://www.w3.org/2002/07/owl#sameAs> ?sameAs }
}
""".strip()


class SnapshotError(ValueError):
    """Official payload or committed artifact failed validation."""


def require(condition: bool, message: str) -> None:
    if not condition:
        raise SnapshotError(message)


def italian_long_date(iso: str) -> str:
    year, month, day = (int(part) for part in iso.split("-"))
    return f"{day} {MONTHS_IT[month - 1]} {year}"


def load_spec(path: Path = SPEC) -> dict[str, Any]:
    spec = json.loads(path.read_text(encoding="utf-8"))
    require(spec.get("datasetId") == DATASET, "dataset identity differs")
    source = spec.get("source") or {}
    require(source.get("endpointUrl") == ENDPOINT, "endpoint diverge")
    require(source.get("landingUrl") == QUIRINALE, "landing diverge")
    require(source.get("licenseUrl") == LICENSE_URL, "license diverge")
    office = spec.get("declaredOffice") or {}
    for key in ("role", "holderName", "personaId", "since", "officialPage"):
        require(bool(str(office.get(key) or "").strip()), f"declaredOffice.{key} assente")
    require(bool(DATE_RE.match(str(office["since"]))), "declaredOffice.since non ISO")
    require(source.get("identityUri", "").endswith(f"/persona.rdf/p{office['personaId']}"), "identità e carica non riconciliano")
    return spec


def build_snapshot(spec: dict[str, Any], payload: dict[str, Any], raw: bytes) -> dict[str, Any]:
    rows = (payload.get("results") or {}).get("bindings") or []
    require(bool(rows), "identità ufficiale non trovata nell'archivio Camera")
    office = spec["declaredOffice"]
    persona_id = str(office["personaId"])

    names = {
        (row["nome"]["value"].strip(), row["cognome"]["value"].strip())
        for row in rows
        if row.get("nome") and row.get("cognome")
    }
    require(len(names) == 1, f"identità ambigua nell'archivio Camera: {sorted(names)}")
    first, last = next(iter(names))
    declared = str(office["holderName"]).casefold()
    require(
        declared == f"{first} {last}".casefold(),
        f"la carica dichiarata ({office['holderName']}) non corrisponde all'identità ufficiale ({first} {last})",
    )

    depictions = {row["depiction"]["value"] for row in rows if row.get("depiction")}
    require(bool(depictions), "ritratto ufficiale assente nell'archivio Camera")
    same_as = sorted({row["sameAs"]["value"] for row in rows if row.get("sameAs")})

    since = str(office["since"])
    second_term = office.get("secondTermSince")
    tenure = f"Presidente della Repubblica dal {italian_long_date(since)}"
    if second_term:
        tenure += f", nel secondo mandato dal {italian_long_date(str(second_term))}"
    biography = (
        f"{tenure}. Capo dello Stato e Presidente del Consiglio superiore della magistratura; "
        "nomina il Presidente del Consiglio dei ministri e i ministri, promulga le leggi e può sciogliere le Camere. "
        "Prima dell'elezione al Quirinale è stato deputato per sette legislature, ministro e giudice della Corte costituzionale."
    )

    snapshot = {
        "schemaVersion": 1,
        "office": {
            "id": "presidente-della-repubblica",
            "role": office["role"],
            "institutionLabel": "Presidenza della Repubblica",
            "officialPage": office["officialPage"],
            "since": since,
            "secondTermSince": second_term,
            "electedOn": office.get("electedOn"),
            "reelectedOn": office.get("reelectedOn"),
        },
        "holder": {
            "personaId": persona_id,
            "uri": f"http://dati.camera.it/ocd/persona.rdf/p{persona_id}",
            "firstName": first.title(),
            "lastName": last.title(),
            "displayName": f"{first.title()} {last.title()}",
            "photoUrl": PHOTO_TEMPLATE.format(persona=persona_id),
            "photoCredit": "Camera dei deputati — archivio ufficiale dei deputati",
            "officialPage": office["officialPage"],
            "biography": biography,
            "sameAs": same_as,
        },
        "provenance": {
            "identity": "official-sparql",
            "identityEndpoint": ENDPOINT,
            "office": "declared-institutional-fact",
            "officeLandingUrl": QUIRINALE,
            "gap": (
                "La titolarità della carica è dichiarata nella spec: quirinale.it risponde 403 a ogni "
                "richiesta programmatica e non pubblica un elenco machine-readable da validare."
            ),
        },
        "source": {
            "owner": "Presidenza della Repubblica (carica) e Camera dei deputati (identità e ritratto)",
            "endpointUrl": ENDPOINT,
            "landingUrl": QUIRINALE,
            "license": spec["source"]["license"],
            "licenseUrl": LICENSE_URL,
            "observedDate": spec["period"]["observedDate"],
            "acquiredAt": datetime.now(timezone.utc).replace(microsecond=0).isoformat(),
            "responses": {"identity": {"bytes": len(raw), "sha256": hashlib.sha256(raw).hexdigest()}},
            "cadence": "revisione manuale a ogni cambio di carica",
        },
        "caveats": list(spec["caveats"]),
    }
    validate_snapshot(snapshot)
    return snapshot


def validate_snapshot(payload: dict[str, Any], locks: dict[str, Any] | None = None) -> None:
    require(payload.get("schemaVersion") == 1, "schemaVersion inattesa")
    office = payload.get("office") or {}
    holder = payload.get("holder") or {}
    provenance = payload.get("provenance") or {}
    require(office.get("id") == "presidente-della-repubblica", "office.id inatteso")
    require(office.get("officialPage") == QUIRINALE, "office.officialPage diverge")
    require(bool(DATE_RE.match(str(office.get("since") or ""))), "office.since non ISO")
    if office.get("secondTermSince") is not None:
        require(bool(DATE_RE.match(str(office["secondTermSince"]))), "secondTermSince non ISO")
    for field in ("displayName", "firstName", "lastName", "biography", "photoUrl", "photoCredit"):
        require(isinstance(holder.get(field), str) and holder[field].strip(), f"holder.{field}")
    require(str(holder.get("personaId") or "").isdigit(), "holder.personaId")
    require(holder["photoUrl"].startswith("https://documenti.camera.it/"), "ritratto non ufficiale")
    require(provenance.get("identity") == "official-sparql", "provenance.identity")
    require(provenance.get("office") == "declared-institutional-fact", "provenance.office")
    require(bool(str(provenance.get("gap") or "").strip()), "il divario di provenance deve restare dichiarato")
    caveats = payload.get("caveats") or []
    require(isinstance(caveats, list) and len(caveats) >= 3, "caveats assenti")
    source = payload.get("source") or {}
    responses = source.get("responses") or {}
    require(set(responses) == {"identity"}, "response set inatteso")
    for key, response in responses.items():
        require(isinstance(response.get("bytes"), int) and response["bytes"] > 0, f"{key}.bytes")
        require(bool(SHA_RE.match(str(response.get("sha256") or ""))), f"{key}.sha256")
        if locks:
            require(response == locks.get(key), f"{key}: source lock diverge")


def fetch_identity() -> tuple[dict[str, Any], bytes]:
    body = urllib.parse.urlencode({
        "query": IDENTITY_QUERY,
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
    last_error: Exception | None = None
    for attempt in range(4):
        try:
            with urllib.request.urlopen(request, context=ssl.create_default_context(), timeout=120) as response:
                raw = response.read()
            return json.loads(raw), raw
        except (urllib.error.URLError, json.JSONDecodeError) as error:
            last_error = error
            time.sleep(3 * (attempt + 1))
    raise SnapshotError(f"SPARQL Camera non raggiungibile: {last_error}")


def check_committed(spec: dict[str, Any]) -> None:
    payload = json.loads(OUTPUT.read_text(encoding="utf-8"))
    validate_snapshot(payload, locks=(spec.get("source") or {}).get("committedResponses") or None)
    office = spec["declaredOffice"]
    require(payload["holder"]["displayName"] == office["holderName"], "titolare divergente dalla spec")
    require(payload["office"]["since"] == office["since"], "inizio carica divergente dalla spec")
    require(payload["source"]["observedDate"] == spec["period"]["observedDate"], "observedDate divergente")
    print(f"OK presidente-repubblica: {payload['holder']['displayName']} dal {payload['office']['since']}")


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

    payload, raw = fetch_identity()
    snapshot = build_snapshot(spec, payload, raw)
    OUTPUT.write_text(json.dumps(snapshot, ensure_ascii=False, indent=2) + "\n", encoding="utf-8")
    print(f"written {OUTPUT.relative_to(ROOT)} ({snapshot['holder']['displayName']})")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
