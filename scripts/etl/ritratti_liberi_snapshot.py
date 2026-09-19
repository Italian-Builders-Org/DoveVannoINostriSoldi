#!/usr/bin/env python3
"""Free-licensed portraits for the government members who never sat in Parliament.

The Camera archive publishes a portrait only for people who held a parliamentary
mandate, and governo.it publishes none: seven ministers and one undersecretary of
the government in office would stay faceless on the institutional map. This ETL
takes their picture from Wikimedia Commons through a person identifier declared in
the spec, and publishes it only when the file carries a free licence and a named
author. Identity is never guessed from a name: the Wikidata item is declared and
its label is verified before anything is published.
"""

from __future__ import annotations

import argparse
import hashlib
import html
import json
import re
import ssl
import time
import unicodedata
import urllib.error
import urllib.parse
import urllib.request
from datetime import datetime, timezone
from pathlib import Path
from typing import Any

ROOT = Path(__file__).resolve().parents[2]
SPEC = ROOT / "scripts/etl/specs/ritratti-liberi.source.json"
OUTPUT = ROOT / "src/data/generated/ritratti-liberi.json"
DATASET = "ritratti-liberi"
WIKIDATA_API = "https://www.wikidata.org/w/api.php"
COMMONS_API = "https://commons.wikimedia.org/w/api.php"
COMMONS_LANDING = "https://commons.wikimedia.org/"
USER_AGENT = (
    "DoveVannoINostriSoldi-ETL/1.0 "
    "(+https://github.com/Italian-Builders-Org/DoveVannoINostriSoldi; ritratti istituzionali)"
)
SHA_RE = re.compile(r"^[0-9a-f]{64}$")
QID_RE = re.compile(r"^Q\d+$")
ALLOWED_MIME = {"image/jpeg", "image/png"}
TAG_RE = re.compile(r"<[^>]+>")
SPACE_RE = re.compile(r"\s+")


class SnapshotError(ValueError):
    """Official payload or committed artifact failed validation."""


def require(condition: bool, message: str) -> None:
    if not condition:
        raise SnapshotError(message)


def fold(value: str) -> str:
    stripped = unicodedata.normalize("NFKD", value)
    without_marks = "".join(char for char in stripped if not unicodedata.combining(char))
    return SPACE_RE.sub(" ", without_marks).strip().casefold()


def plain_text(value: str) -> str:
    """Commons returns author and credit as HTML: keep the words, drop the markup."""
    text = html.unescape(TAG_RE.sub(" ", value))
    return SPACE_RE.sub(" ", text).strip()


def load_spec(path: Path = SPEC) -> dict[str, Any]:
    spec = json.loads(path.read_text(encoding="utf-8"))
    require(spec.get("datasetId") == DATASET, "dataset identity differs")
    source = spec.get("source") or {}
    require(source.get("wikidataApiUrl") == WIKIDATA_API, "endpoint Wikidata diverge")
    require(source.get("commonsApiUrl") == COMMONS_API, "endpoint Commons diverge")
    width = source.get("thumbnailWidth")
    require(isinstance(width, int) and 240 <= width <= 1024, "thumbnailWidth fuori intervallo")
    allowed = source.get("allowedLicenses")
    require(isinstance(allowed, list) and len(allowed) >= 4, "elenco licenze ammesse assente")
    people = source.get("people")
    require(isinstance(people, list) and len(people) >= 1, "nessuna persona dichiarata")
    seen_persona: set[str] = set()
    seen_qid: set[str] = set()
    for person in people:
        for key in ("personaId", "name", "wikidataId", "wikidataLabel", "role"):
            require(bool(str(person.get(key) or "").strip()), f"people.{key} assente")
        require(str(person["personaId"]).isdigit(), "personaId non numerico")
        require(bool(QID_RE.match(str(person["wikidataId"]))), "wikidataId non valido")
        require(person["personaId"] not in seen_persona, f"persona duplicata: {person['personaId']}")
        require(person["wikidataId"] not in seen_qid, f"elemento Wikidata duplicato: {person['wikidataId']}")
        seen_persona.add(person["personaId"])
        seen_qid.add(person["wikidataId"])
    floor = (spec.get("coverageFloor") or {}).get("portraits")
    require(isinstance(floor, int) and floor >= 1, "coverageFloor.portraits assente")
    require(floor <= len(people), "coverageFloor.portraits supera le persone dichiarate")
    return spec


def request_json(url: str, params: dict[str, str]) -> tuple[dict[str, Any], bytes]:
    query = urllib.parse.urlencode(params)
    request = urllib.request.Request(
        f"{url}?{query}",
        headers={"User-Agent": USER_AGENT, "Accept": "application/json"},
        method="GET",
    )
    last_error: Exception | None = None
    for attempt in range(4):
        try:
            with urllib.request.urlopen(request, context=ssl.create_default_context(), timeout=90) as response:
                raw = response.read()
            return json.loads(raw), raw
        except (urllib.error.URLError, json.JSONDecodeError) as error:
            last_error = error
            time.sleep(5 * (attempt + 1))
    raise SnapshotError(f"{url} non raggiungibile: {last_error}")


def fetch_bytes(url: str) -> bytes:
    request = urllib.request.Request(url, headers={"User-Agent": USER_AGENT}, method="GET")
    last_error: Exception | None = None
    for attempt in range(3):
        try:
            with urllib.request.urlopen(request, context=ssl.create_default_context(), timeout=90) as response:
                return response.read()
        except urllib.error.URLError as error:
            last_error = error
            time.sleep(4 * (attempt + 1))
    raise SnapshotError(f"immagine non scaricabile: {url} ({last_error})")


def fetch_wikidata(people: list[dict[str, Any]]) -> tuple[dict[str, Any], bytes]:
    return request_json(
        WIKIDATA_API,
        {
            "action": "wbgetentities",
            "ids": "|".join(person["wikidataId"] for person in people),
            "props": "labels|claims|sitelinks",
            "languages": "it|en",
            "sitefilter": "itwiki",
            "format": "json",
            "formatversion": "2",
        },
    )


def portrait_file(entity: dict[str, Any]) -> str | None:
    claims = (entity.get("claims") or {}).get("P18") or []
    for claim in claims:
        if claim.get("rank") == "deprecated":
            continue
        value = ((claim.get("mainsnak") or {}).get("datavalue") or {}).get("value")
        if isinstance(value, str) and value.strip():
            return value.strip()
    return None


def fetch_commons(titles: list[str], width: int) -> tuple[dict[str, Any], bytes]:
    return request_json(
        COMMONS_API,
        {
            "action": "query",
            "prop": "imageinfo",
            "titles": "|".join(titles),
            "iiprop": "url|size|mime|extmetadata",
            "iiurlwidth": str(width),
            "iiextmetadatafilter": "LicenseShortName|License|LicenseUrl|Artist|Credit|ImageDescription",
            "format": "json",
            "formatversion": "2",
        },
    )


def canonical_url(value: str) -> str:
    """Commons hands out tracking parameters and a rotating host: keep neither."""
    parsed = urllib.parse.urlsplit(value)
    hostname = parsed.hostname or ""
    is_wikimedia = hostname == "wikimedia.org" or hostname.endswith(".wikimedia.org")
    host = "upload.wikimedia.org" if is_wikimedia else parsed.netloc
    return urllib.parse.urlunsplit(("https", host, parsed.path, "", ""))


def build_snapshot(
    spec: dict[str, Any],
    wikidata_payload: dict[str, Any],
    wikidata_raw: bytes,
    commons_payload: dict[str, Any] | None,
    commons_raw: bytes,
) -> dict[str, Any]:
    source = spec["source"]
    width = int(source["thumbnailWidth"])
    allowed = {str(item).casefold() for item in source["allowedLicenses"]}
    entities = wikidata_payload.get("entities") or {}

    files: dict[str, str] = {}
    labels: dict[str, str] = {}
    for person in source["people"]:
        qid = person["wikidataId"]
        entity = entities.get(qid)
        require(isinstance(entity, dict), f"{qid}: elemento Wikidata assente")
        label = ((entity.get("labels") or {}).get("it") or {}).get("value")
        require(isinstance(label, str) and label.strip(), f"{qid}: etichetta italiana assente")
        require(
            fold(label) == fold(str(person["wikidataLabel"])),
            f"{qid}: etichetta '{label}' diversa da quella dichiarata '{person['wikidataLabel']}'",
        )
        file_name = portrait_file(entity)
        require(bool(file_name), f"{qid}: nessuna immagine (P18) sull'elemento dichiarato")
        files[qid] = f"File:{file_name}"
        labels[qid] = label

    if commons_payload is None:
        commons_payload, commons_raw = fetch_commons(sorted(set(files.values())), width)

    pages = (commons_payload.get("query") or {}).get("pages") or []
    by_title = {str(page.get("title")): page for page in pages}

    portraits: list[dict[str, Any]] = []
    for person in source["people"]:
        qid = person["wikidataId"]
        title = files[qid]
        page = by_title.get(title)
        require(isinstance(page, dict) and not page.get("missing"), f"{title}: file assente su Commons")
        info = (page.get("imageinfo") or [{}])[0]
        meta = info.get("extmetadata") or {}
        license_id = str((meta.get("License") or {}).get("value") or "").casefold()
        license_label = plain_text(str((meta.get("LicenseShortName") or {}).get("value") or ""))
        if license_id in {"", "none"}:
            # Some free templates ({{Attribution}}) carry no machine-readable id:
            # the short name is then the only declaration of the terms.
            license_id = SPACE_RE.sub("-", license_label.casefold())
        author = plain_text(str((meta.get("Artist") or {}).get("value") or ""))
        mime = str(info.get("mime") or "")
        thumb = info.get("thumburl") or info.get("url")
        require(license_id in allowed, f"{title}: licenza '{license_id or 'assente'}' non ammessa")
        require(bool(license_label), f"{title}: nome della licenza assente")
        require(bool(author), f"{title}: autore non dichiarato")
        require(mime in ALLOWED_MIME, f"{title}: tipo '{mime}' non ammesso")
        require(isinstance(thumb, str) and thumb.startswith("https://"), f"{title}: URL immagine assente")

        url = canonical_url(thumb)
        payload = fetch_bytes(url)
        require(len(payload) > 4096, f"{title}: immagine troppo piccola ({len(payload)} byte)")
        signature_ok = payload[:3] == b"\xff\xd8\xff" if mime == "image/jpeg" else payload[:8] == b"\x89PNG\r\n\x1a\n"
        require(signature_ok, f"{title}: contenuto non coerente con {mime}")

        portraits.append({
            "personaId": str(person["personaId"]),
            "displayName": str(person["name"]),
            "role": str(person["role"]),
            "wikidataId": qid,
            "wikidataLabel": labels[qid],
            "wikidataPage": f"https://www.wikidata.org/wiki/{qid}",
            "fileTitle": title,
            "filePage": f"https://commons.wikimedia.org/wiki/{urllib.parse.quote(title.replace(' ', '_'))}",
            "photoUrl": url,
            "mime": mime,
            "width": int(info.get("thumbwidth") or info.get("width") or 0),
            "height": int(info.get("thumbheight") or info.get("height") or 0),
            "bytes": len(payload),
            "sha256": hashlib.sha256(payload).hexdigest(),
            "author": author,
            "license": license_label,
            "licenseId": license_id,
            "licenseUrl": plain_text(str((meta.get("LicenseUrl") or {}).get("value") or "")) or None,
            "credit": f"{author} — {license_label} · Wikimedia Commons",
        })

    portraits.sort(key=lambda item: item["personaId"])
    snapshot = {
        "schemaVersion": 1,
        "coverage": {
            "portraits": len(portraits),
            "declaredPeople": len(source["people"]),
            "knownWithoutPortrait": len(source.get("knownWithoutPortrait") or []),
        },
        "source": {
            "owner": source["owner"],
            "title": spec["title"],
            "wikidataApiUrl": WIKIDATA_API,
            "commonsApiUrl": COMMONS_API,
            "landingUrl": COMMONS_LANDING,
            "license": source["license"],
            "licenseUrl": source["licenseUrl"],
            "thumbnailWidth": width,
            "observedDate": spec["period"]["observedDate"],
            "acquiredAt": datetime.now(timezone.utc).replace(microsecond=0).isoformat(),
            "responses": {
                "wikidata": {"bytes": len(wikidata_raw), "sha256": hashlib.sha256(wikidata_raw).hexdigest()},
                "commons": {"bytes": len(commons_raw), "sha256": hashlib.sha256(commons_raw).hexdigest()},
            },
            "cadence": "revisione manuale a ogni rimpasto di governo",
        },
        "provenance": dict(spec["semantics"]["provenance"]),
        "knownWithoutPortrait": [
            {
                "personaId": str(item["personaId"]),
                "displayName": str(item["name"]),
                "wikidataId": str(item["wikidataId"]),
                "note": str(item["note"]),
            }
            for item in source.get("knownWithoutPortrait") or []
        ],
        "portraits": portraits,
        "caveats": list(spec["caveats"]),
    }
    validate_snapshot(snapshot, floor=int(spec["coverageFloor"]["portraits"]))
    return snapshot


def validate_snapshot(payload: dict[str, Any], floor: int, locks: dict[str, Any] | None = None) -> None:
    require(payload.get("schemaVersion") == 1, "schemaVersion inattesa")
    portraits = payload.get("portraits") or []
    coverage = payload.get("coverage") or {}
    require(isinstance(portraits, list) and len(portraits) >= floor, f"meno di {floor} ritratti pubblicati")
    require(coverage.get("portraits") == len(portraits), "coverage.portraits non riconcilia")
    seen_persona: set[str] = set()
    seen_hash: set[str] = set()
    for portrait in portraits:
        persona = str(portrait.get("personaId") or "")
        require(persona.isdigit(), "personaId non numerico")
        require(persona not in seen_persona, f"persona duplicata: {persona}")
        seen_persona.add(persona)
        digest = str(portrait.get("sha256") or "")
        require(bool(SHA_RE.match(digest)), f"{persona}: sha256 non valido")
        # The same picture used for two people would mean a wrong identification.
        require(digest not in seen_hash, f"{persona}: immagine identica a un'altra persona")
        seen_hash.add(digest)
        for field in ("displayName", "role", "fileTitle", "filePage", "photoUrl", "author", "license", "credit"):
            require(bool(str(portrait.get(field) or "").strip()), f"{persona}.{field} assente")
        require(str(portrait["photoUrl"]).startswith("https://upload.wikimedia.org/"), f"{persona}: URL non canonico")
        require(bool(QID_RE.match(str(portrait.get("wikidataId") or ""))), f"{persona}: wikidataId non valido")
        require(str(portrait.get("mime")) in ALLOWED_MIME, f"{persona}: mime non ammesso")
        require(int(portrait.get("width") or 0) >= 200, f"{persona}: larghezza insufficiente")
        require(int(portrait.get("height") or 0) >= 200, f"{persona}: altezza insufficiente")
        require(int(portrait.get("bytes") or 0) > 4096, f"{persona}: file troppo piccolo")
    provenance = payload.get("provenance") or {}
    require(provenance.get("kind") == "free-licensed-third-party-media", "provenance.kind inatteso")
    require(bool(str(provenance.get("gap") or "").strip()), "il divario di provenance deve restare dichiarato")
    caveats = payload.get("caveats") or []
    require(isinstance(caveats, list) and len(caveats) >= 3, "caveats assenti")
    responses = (payload.get("source") or {}).get("responses") or {}
    require(set(responses) == {"wikidata", "commons"}, "response set inatteso")
    for key, response in responses.items():
        require(isinstance(response.get("bytes"), int) and response["bytes"] > 0, f"{key}.bytes")
        require(bool(SHA_RE.match(str(response.get("sha256") or ""))), f"{key}.sha256")
        if locks:
            require(response == locks.get(key), f"{key}: source lock diverge")


def check_committed(spec: dict[str, Any]) -> None:
    payload = json.loads(OUTPUT.read_text(encoding="utf-8"))
    validate_snapshot(payload, floor=int(spec["coverageFloor"]["portraits"]))
    declared = {str(person["personaId"]): person for person in spec["source"]["people"]}
    published = {str(portrait["personaId"]): portrait for portrait in payload["portraits"]}
    require(set(published) <= set(declared), "ritratti non dichiarati nella spec")
    for persona, portrait in published.items():
        require(portrait["displayName"] == declared[persona]["name"], f"{persona}: nome divergente dalla spec")
        require(portrait["wikidataId"] == declared[persona]["wikidataId"], f"{persona}: elemento Wikidata divergente")
    require(payload["source"]["observedDate"] == spec["period"]["observedDate"], "observedDate divergente")
    require(payload["source"]["thumbnailWidth"] == spec["source"]["thumbnailWidth"], "thumbnailWidth divergente")
    print(f"OK ritratti-liberi: {len(published)} ritratti liberi, {len(payload['knownWithoutPortrait'])} lacune dichiarate")


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

    wikidata_payload, wikidata_raw = fetch_wikidata(spec["source"]["people"])
    snapshot = build_snapshot(spec, wikidata_payload, wikidata_raw, None, b"")
    OUTPUT.write_text(json.dumps(snapshot, ensure_ascii=False, indent=2) + "\n", encoding="utf-8")
    responses = snapshot["source"]["responses"]
    print(f"written {OUTPUT.relative_to(ROOT)} ({snapshot['coverage']['portraits']} ritratti)")
    for key, value in responses.items():
        print(f"  {key}: bytes={value['bytes']} sha256={value['sha256']}")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
