#!/usr/bin/env python3
"""Italian MEPs currently in office from the European Parliament Open Data API.

Acquires show-current filtered by country-of-representation=IT, pins the raw
response, and publishes a typed snapshot for the separate /politici/europa view.
Never mixes MEPs into the national Camera/Senato/Governo graph.
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
from collections import Counter
from datetime import datetime, timezone
from pathlib import Path
from typing import Any

ROOT = Path(__file__).resolve().parents[2]
SPEC = ROOT / "scripts/etl/specs/politici-eurodeputati-it.source.json"
OUTPUT = ROOT / "src/data/generated/politici-eurodeputati-it.json"
DATASET = "politici-eurodeputati-it"
ENDPOINT = "https://data.europarl.europa.eu/api/v2/meps/show-current"
LANDING = "https://www.europarl.europa.eu/meps/it/home"
API_DOCS = "https://data.europarl.europa.eu/en/developer-corner/opendata-api"
LICENSE_URL = "https://creativecommons.org/licenses/by/4.0/"
COUNTRY = "IT"
PROFILE_TEMPLATE = "https://www.europarl.europa.eu/meps/it/{mep_id}"
SHA_RE = re.compile(r"^[0-9a-f]{64}$")
DATE_RE = re.compile(r"^\d{4}-\d{2}-\d{2}$")
ID_RE = re.compile(r"^\d+$")
USER_AGENT = "DoveVannoINostriSoldi-ETL/1.0 (+https://github.com/Italian-Builders-Org/DoveVannoINostriSoldi)"


class SnapshotError(ValueError):
    """Official payload or committed artifact failed validation."""


def require(condition: bool, message: str) -> None:
    if not condition:
        raise SnapshotError(message)


def load_spec(path: Path = SPEC) -> dict[str, Any]:
    spec = json.loads(path.read_text(encoding="utf-8"))
    require(spec.get("datasetId") == DATASET, "dataset identity differs")
    source = spec.get("source") or {}
    require(source.get("endpointUrl") == ENDPOINT, "endpoint diverge")
    require(source.get("landingUrl") == LANDING, "landing diverge")
    require(source.get("licenseUrl") == LICENSE_URL, "license diverge")
    require(source.get("apiDocsUrl") == API_DOCS, "api docs diverge")
    coverage = spec.get("expectedCoverage") or {}
    require(coverage.get("countryOfRepresentation") == COUNTRY, "country filter diverge")
    require(isinstance(coverage.get("memberFloor"), int) and coverage["memberFloor"] >= 1, "memberFloor")
    require(isinstance(coverage.get("memberCeiling"), int) and coverage["memberCeiling"] >= coverage["memberFloor"], "memberCeiling")
    require(bool(DATE_RE.match(str((spec.get("period") or {}).get("observedDate") or ""))), "observedDate non ISO")
    require(isinstance(spec.get("caveats"), list) and len(spec["caveats"]) >= 4, "caveats assenti nella spec")
    responses = source.get("committedResponses") or {}
    require(set(responses) == {"currentMepsItaly"}, "committedResponses set inatteso")
    for key, response in responses.items():
        require(isinstance(response.get("bytes"), int) and response["bytes"] > 0, f"{key}.bytes")
        require(bool(SHA_RE.match(str(response.get("sha256") or ""))), f"{key}.sha256")
    return spec


def ssl_context() -> ssl.SSLContext:
    try:
        import certifi  # type: ignore
    except ImportError:
        return ssl.create_default_context()
    return ssl.create_default_context(cafile=certifi.where())


def fetch_current_italy() -> tuple[list[dict[str, Any]], bytes]:
    query = urllib.parse.urlencode({
        "format": "application/ld+json",
        "country-of-representation": COUNTRY,
        "limit": "100",
        "offset": "0",
    })
    url = f"{ENDPOINT}?{query}"
    request = urllib.request.Request(
        url,
        headers={
            "User-Agent": USER_AGENT,
            "Accept": "application/ld+json",
        },
        method="GET",
    )
    context = ssl_context()
    last_error: Exception | None = None
    for attempt in range(4):
        try:
            with urllib.request.urlopen(request, context=context, timeout=120) as response:
                raw = response.read()
            payload = json.loads(raw)
            rows = payload.get("data")
            require(isinstance(rows, list), "payload data non è una lista")
            require(len(rows) <= 100, "paginazione inattesa: oltre 100 eurodeputati IT")
            return rows, raw
        except (urllib.error.URLError, json.JSONDecodeError, SnapshotError) as error:
            last_error = error
            time.sleep(3 * (attempt + 1))
    raise SnapshotError(f"Open Data PE non raggiungibile: {last_error}")


def build_snapshot(spec: dict[str, Any], rows: list[dict[str, Any]], raw: bytes) -> dict[str, Any]:
    coverage = spec["expectedCoverage"]
    meps: list[dict[str, Any]] = []
    seen: set[str] = set()
    for row in rows:
        mep_id = str(row.get("identifier") or "").strip()
        require(bool(ID_RE.match(mep_id)), f"identificativo MEP non numerico: {mep_id!r}")
        require(mep_id not in seen, f"MEP duplicato: {mep_id}")
        seen.add(mep_id)
        country = str(row.get("api:country-of-representation") or "").strip()
        require(country == COUNTRY, f"country non IT per {mep_id}: {country!r}")
        given = str(row.get("givenName") or "").strip()
        family = str(row.get("familyName") or "").strip()
        label = str(row.get("label") or "").strip()
        group_code = str(row.get("api:political-group") or "").strip()
        require(given and family and label and group_code, f"campi anagrafici incompleti per {mep_id}")
        meps.append({
            "id": mep_id,
            "givenName": given,
            "familyName": family,
            "displayName": f"{given} {family}",
            "sortLabel": str(row.get("sortLabel") or f"{family} {given}").strip(),
            "groupCode": group_code,
            "countryOfRepresentation": COUNTRY,
            "officialPage": PROFILE_TEMPLATE.format(mep_id=mep_id),
            "openDataId": str(row.get("id") or f"person/{mep_id}"),
        })

    meps.sort(key=lambda item: (item["familyName"].casefold(), item["givenName"].casefold(), item["id"]))
    floor = int(coverage["memberFloor"])
    ceiling = int(coverage["memberCeiling"])
    require(floor <= len(meps) <= ceiling, f"copertura IT fuori range {floor}-{ceiling}: {len(meps)}")

    group_counter = Counter(item["groupCode"] for item in meps)
    groups = [
        {"code": code, "memberCount": count}
        for code, count in sorted(group_counter.items(), key=lambda pair: (-pair[1], pair[0].casefold()))
    ]

    digest = hashlib.sha256(raw).hexdigest()
    snapshot = {
        "schemaVersion": 1,
        "datasetId": DATASET,
        "institution": {
            "id": "parlamento-europeo",
            "label": "Parlamento europeo",
            "chamberLabel": "Eurodeputati eletti in Italia",
            "landingUrl": LANDING,
            "openDataUrl": API_DOCS,
        },
        "period": {
            "kind": "point-in-time",
            "label": spec["period"]["label"],
            "observedDate": spec["period"]["observedDate"],
        },
        "coverage": {
            "countryOfRepresentation": COUNTRY,
            "memberCount": len(meps),
            "groupCount": len(groups),
        },
        "groups": groups,
        "meps": meps,
        "semantics": {
            "soldi": dict(spec["semantics"]["soldi"]),
            "periodo": dict(spec["semantics"]["periodo"]),
            "provenance": dict(spec["semantics"]["provenance"]),
        },
        "source": {
            "owner": spec["source"]["owner"],
            "endpointUrl": ENDPOINT,
            "landingUrl": LANDING,
            "apiDocsUrl": API_DOCS,
            "license": spec["source"]["license"],
            "licenseUrl": LICENSE_URL,
            "observedDate": spec["period"]["observedDate"],
            "acquiredAt": datetime.now(timezone.utc).replace(microsecond=0).isoformat(),
            "query": {
                "countryOfRepresentation": COUNTRY,
                "limit": 100,
                "offset": 0,
            },
            "responses": {
                "currentMepsItaly": {"bytes": len(raw), "sha256": digest},
            },
            "cadence": "rilevazione puntuale; rieseguire --write dopo ricambio o sostituzione",
        },
        "caveats": list(spec["caveats"]),
    }
    validate_snapshot(snapshot)
    return snapshot


def validate_snapshot(payload: dict[str, Any], locks: dict[str, Any] | None = None) -> None:
    require(payload.get("schemaVersion") == 1, "schemaVersion inattesa")
    require(payload.get("datasetId") == DATASET, "datasetId inatteso")
    institution = payload.get("institution") or {}
    require(institution.get("id") == "parlamento-europeo", "institution.id")
    require(institution.get("landingUrl") == LANDING, "institution.landingUrl")
    period = payload.get("period") or {}
    require(period.get("kind") == "point-in-time", "period.kind")
    require(bool(DATE_RE.match(str(period.get("observedDate") or ""))), "period.observedDate")
    coverage = payload.get("coverage") or {}
    require(coverage.get("countryOfRepresentation") == COUNTRY, "coverage.country")
    meps = payload.get("meps") or []
    groups = payload.get("groups") or []
    require(isinstance(meps, list) and len(meps) >= 1, "meps assenti")
    require(coverage.get("memberCount") == len(meps), "memberCount diverge")
    require(coverage.get("groupCount") == len(groups), "groupCount diverge")
    seen: set[str] = set()
    group_counts: Counter[str] = Counter()
    previous_key: tuple[str, str, str] | None = None
    for mep in meps:
        mep_id = str(mep.get("id") or "")
        require(bool(ID_RE.match(mep_id)), f"mep.id non numerico: {mep_id!r}")
        require(mep_id not in seen, f"mep duplicato: {mep_id}")
        seen.add(mep_id)
        require(mep.get("countryOfRepresentation") == COUNTRY, f"country non IT: {mep_id}")
        for field in ("givenName", "familyName", "displayName", "sortLabel", "groupCode", "officialPage", "openDataId"):
            require(isinstance(mep.get(field), str) and mep[field].strip(), f"{mep_id}.{field}")
        require(mep["officialPage"] == PROFILE_TEMPLATE.format(mep_id=mep_id), f"scheda ufficiale non canonica: {mep_id}")
        require(mep["displayName"] == f"{mep['givenName']} {mep['familyName']}", f"displayName incoerente: {mep_id}")
        key = (mep["familyName"].casefold(), mep["givenName"].casefold(), mep_id)
        if previous_key is not None:
            require(previous_key <= key, "meps non in ordine alfabetico")
        previous_key = key
        group_counts[mep["groupCode"]] += 1

    declared = {group["code"]: group["memberCount"] for group in groups}
    require(declared == dict(group_counts), "conteggi per gruppo divergono dalle persone")
    for group in groups:
        require(isinstance(group.get("code"), str) and group["code"].strip(), "group.code")
        require(isinstance(group.get("memberCount"), int) and group["memberCount"] > 0, "group.memberCount")

    semantics = payload.get("semantics") or {}
    require(semantics.get("soldi", {}).get("present") is False, "soldi.present deve essere false")
    require((semantics.get("provenance") or {}).get("kind") == "official-open-data-api", "provenance.kind")
    caveats = payload.get("caveats") or []
    require(isinstance(caveats, list) and len(caveats) >= 4, "caveats assenti")
    require(any("separata" in caveat.casefold() or "non mescola" in caveat.casefold() for caveat in caveats), "manca caveat di separazione nazionale")
    require(any("non si inferiscono" in caveat.casefold() or "affiliazioni" in caveat.casefold() for caveat in caveats), "manca caveat sulle affiliazioni nazionali")

    source = payload.get("source") or {}
    require(source.get("endpointUrl") == ENDPOINT, "source.endpointUrl")
    require(source.get("licenseUrl") == LICENSE_URL, "source.licenseUrl")
    require(source.get("observedDate") == period.get("observedDate"), "observedDate source/period")
    responses = source.get("responses") or {}
    require(set(responses) == {"currentMepsItaly"}, "response set inatteso")
    for key, response in responses.items():
        require(isinstance(response.get("bytes"), int) and response["bytes"] > 0, f"{key}.bytes")
        require(bool(SHA_RE.match(str(response.get("sha256") or ""))), f"{key}.sha256")
        if locks:
            require(response == locks.get(key), f"{key}: source lock diverge")


def check_committed(spec: dict[str, Any]) -> None:
    payload = json.loads(OUTPUT.read_text(encoding="utf-8"))
    validate_snapshot(payload, locks=(spec.get("source") or {}).get("committedResponses") or None)
    require(payload["source"]["observedDate"] == spec["period"]["observedDate"], "observedDate divergente dalla spec")
    require(payload["coverage"]["countryOfRepresentation"] == COUNTRY, "country divergente")
    floor = int(spec["expectedCoverage"]["memberFloor"])
    ceiling = int(spec["expectedCoverage"]["memberCeiling"])
    count = int(payload["coverage"]["memberCount"])
    require(floor <= count <= ceiling, f"memberCount fuori range: {count}")
    print(f"OK {DATASET}: {count} eurodeputati IT, {payload['coverage']['groupCount']} gruppi UE")


def update_source_lock(spec: dict[str, Any], raw: bytes, observed_date: str) -> None:
    digest = hashlib.sha256(raw).hexdigest()
    spec["period"]["observedDate"] = observed_date
    spec["semantics"]["periodo"]["observedDate"] = observed_date
    spec["source"]["committedResponses"] = {
        "currentMepsItaly": {"bytes": len(raw), "sha256": digest},
    }
    SPEC.write_text(json.dumps(spec, ensure_ascii=False, indent=2) + "\n", encoding="utf-8")


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

    rows, raw = fetch_current_italy()
    observed_date = datetime.now(timezone.utc).date().isoformat()
    spec["period"]["observedDate"] = observed_date
    spec["semantics"]["periodo"]["observedDate"] = observed_date
    snapshot = build_snapshot(spec, rows, raw)
    update_source_lock(spec, raw, observed_date)
    OUTPUT.write_text(json.dumps(snapshot, ensure_ascii=False, indent=2) + "\n", encoding="utf-8")
    print(
        f"written {OUTPUT.relative_to(ROOT)} "
        f"({snapshot['coverage']['memberCount']} MEPs IT, {snapshot['coverage']['groupCount']} groups)"
    )
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
