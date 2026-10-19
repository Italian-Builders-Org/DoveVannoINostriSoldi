#!/usr/bin/env python3
"""Curated pilot of Italian declassified / desecretized government documents.

Secondary research catalog: official portals stay authoritative. The committed
input under data/documenti-declassificati is hashed in the spec; this script
projects it into the published snapshot and fails closed on drift or rule breaks.

Offline only: --check re-derives and compares; --write rewrites the artifact.
"""

from __future__ import annotations

import argparse
import hashlib
import json
import re
from pathlib import Path
from typing import Any
from urllib.parse import urlparse

ROOT = Path(__file__).resolve().parents[2]
SPEC = ROOT / "scripts/etl/specs/documenti-declassificati.source.json"
OUTPUT = ROOT / "src/data/generated/documenti-declassificati.json"
DATASET = "documenti-declassificati"
SCHEMA_VERSION = 1
ISO_DATE = re.compile(r"^\d{4}-\d{2}-\d{2}$")
YEAR_OR_DATE = re.compile(r"^\d{4}(-\d{2}(-\d{2})?)?$")
SHA_RE = re.compile(r"^[0-9a-f]{64}$")
DOC_ID = re.compile(r"^[a-z0-9]+(?:-[a-z0-9]+)*$")


class SnapshotError(ValueError):
    """Raised when the input or the committed artifact breaks the contract."""


def fail(message: str) -> None:
    raise SnapshotError(message)


def load_spec() -> dict[str, Any]:
    spec = json.loads(SPEC.read_text(encoding="utf-8"))
    if spec.get("datasetId") != DATASET:
        fail("spec: datasetId inatteso")
    committed = spec["source"]["committedInput"]
    if not SHA_RE.match(committed.get("sha256", "")):
        fail("spec: sha256 dell'input assente o malformato")
    if not isinstance(committed.get("bytes"), int) or committed["bytes"] <= 0:
        fail("spec: bytes dell'input assenti o non validi")
    return spec


def load_input(spec: dict[str, Any]) -> dict[str, Any]:
    committed = spec["source"]["committedInput"]
    path = ROOT / committed["path"]
    if not path.exists():
        fail(f"input assente: {committed['path']}")
    raw = path.read_bytes()
    if len(raw) != committed["bytes"]:
        fail(f"input: {len(raw)} byte, attesi {committed['bytes']}")
    digest = hashlib.sha256(raw).hexdigest()
    if digest != committed["sha256"]:
        fail(f"input: sha256 {digest}, atteso {committed['sha256']}")
    return json.loads(raw.decode("utf-8"))


def host_ok(url: str, allowed: list[str]) -> bool:
    host = (urlparse(url).hostname or "").lower()
    if host.startswith("www.") and host not in allowed:
        bare = host[4:]
        return bare in allowed or host in allowed
    return host in allowed


def optional_date(value: Any, label: str) -> str | None:
    if value is None:
        return None
    if not isinstance(value, str) or not YEAR_OR_DATE.match(value):
        fail(f"{label}: data non valida ({value!r})")
    return value


def require_iso(value: Any, label: str) -> str:
    if not isinstance(value, str) or not ISO_DATE.match(value):
        fail(f"{label}: serve YYYY-MM-DD")
    return value


def validate_document(doc: dict[str, Any], spec: dict[str, Any], seen: set[str]) -> None:
    expected = spec["expected"]
    tag = doc.get("id", "?")
    if not isinstance(doc.get("id"), str) or not DOC_ID.match(doc["id"]):
        fail(f"{tag}: id non valido")
    if doc["id"] in seen:
        fail(f"{tag}: id duplicato")
    seen.add(doc["id"])
    for field in (
        "title",
        "issuingBodyLabel",
        "summary",
        "caveat",
        "eventPeriodLabel",
        "classificationBefore",
        "classificationAfter",
        "accessStatus",
        "readiness",
        "theme",
        "issuingBody",
    ):
        if not isinstance(doc.get(field), str) or not doc[field].strip():
            fail(f"{tag}: campo obbligatorio assente ({field})")
    if doc["issuingBody"] not in expected["issuingBodies"]:
        fail(f"{tag}: issuingBody fuori contratto")
    if doc["theme"] not in expected["themes"]:
        fail(f"{tag}: theme fuori contratto")
    if doc["classificationBefore"] not in expected["classificationBefore"]:
        fail(f"{tag}: classificationBefore fuori contratto")
    if doc["classificationAfter"] not in expected["classificationAfter"]:
        fail(f"{tag}: classificationAfter fuori contratto")
    if doc["accessStatus"] not in expected["accessStatuses"]:
        fail(f"{tag}: accessStatus fuori contratto")
    if doc["readiness"] not in expected["readiness"]:
        fail(f"{tag}: readiness fuori contratto")
    points = doc.get("keyPoints")
    if not isinstance(points, list) or not (3 <= len(points) <= 7):
        fail(f"{tag}: keyPoints deve avere da 3 a 7 voci")
    for point in points:
        if not isinstance(point, str) or len(point.strip()) < 12:
            fail(f"{tag}: punto chiave troppo corto")
    urls = doc.get("sourceUrls")
    if not isinstance(urls, list) or not urls:
        fail(f"{tag}: sourceUrls obbligatori")
    for url in urls:
        if not isinstance(url, str) or not url.startswith("https://"):
            fail(f"{tag}: URL non HTTPS")
        if not host_ok(url, expected["allowedSourceHosts"]):
            fail(f"{tag}: host non ammesso ({urlparse(url).hostname})")
    if "soldi" not in doc:
        fail(f"{tag}: soldi deve essere esplicito (null o oggetto)")
    if doc["soldi"] is not None:
        money = doc["soldi"]
        if not isinstance(money, dict):
            fail(f"{tag}: soldi malformato")
        cents = money.get("amountEuroCents")
        if not isinstance(cents, int) or cents < 0:
            fail(f"{tag}: amountEuroCents non valido")
    optional_date(doc.get("eventPeriodFrom"), f"{tag}.eventPeriodFrom")
    optional_date(doc.get("eventPeriodTo"), f"{tag}.eventPeriodTo")
    optional_date(doc.get("declassifiedAt"), f"{tag}.declassifiedAt")
    optional_date(doc.get("releasedAt"), f"{tag}.releasedAt")
    require_iso(doc.get("verifiedAt"), f"{tag}.verifiedAt")


def build_snapshot(payload: dict[str, Any], spec: dict[str, Any]) -> dict[str, Any]:
    if payload.get("schemaVersion") != SCHEMA_VERSION:
        fail("catalogo: schemaVersion inattesa")
    if payload.get("dataset") != DATASET:
        fail("catalogo: dataset inatteso")
    source = payload.get("source")
    coverage = payload.get("coverage")
    documents = payload.get("documents")
    caveats = payload.get("caveats")
    if not isinstance(source, dict) or not isinstance(coverage, dict):
        fail("catalogo: source/coverage assenti")
    if not isinstance(documents, list) or not isinstance(caveats, list) or not caveats:
        fail("catalogo: documents/caveats assenti")
    expected = spec["expected"]
    if not (expected["minDocuments"] <= len(documents) <= expected["maxDocuments"]):
        fail(f"catalogo: {len(documents)} documenti fuori range")
    if coverage.get("documentsPublished") != len(documents):
        fail("coverage.documentsPublished non coincide con documents")
    require_iso(coverage.get("checkedAt"), "coverage.checkedAt")
    require_iso(source.get("acquisitionDate"), "source.acquisitionDate")
    require_iso(source.get("checkedAt"), "source.checkedAt")
    if source.get("authority") != "secondary" or source.get("license") != "not-declared":
        fail("source: authority/license fuori contratto")
    if source.get("holder") != spec["source"]["owner"]:
        fail("source.holder non allineato allo spec")
    seen: set[str] = set()
    for doc in documents:
        if not isinstance(doc, dict):
            fail("documento non oggetto")
        validate_document(doc, spec, seen)
    themes = sorted({doc["theme"] for doc in documents})
    bodies = sorted({doc["issuingBody"] for doc in documents})
    if set(themes) != set(coverage.get("themes") or []):
        fail("coverage.themes non riconciliato")
    if set(bodies) != set(coverage.get("issuingBodies") or []):
        fail("coverage.issuingBodies non riconciliato")
    # Stable projection: catalog fields + provenance envelope.
    return {
        "schemaVersion": SCHEMA_VERSION,
        "dataset": DATASET,
        "coverage": {
            "documentsPublished": len(documents),
            "documentsCataloguedOnly": int(coverage.get("documentsCataloguedOnly") or 0),
            "checkedAt": coverage["checkedAt"],
            "periodFrom": coverage.get("periodFrom"),
            "periodTo": coverage.get("periodTo"),
            "themes": themes,
            "issuingBodies": bodies,
            "byAccessStatus": {
                status: sum(1 for doc in documents if doc["accessStatus"] == status)
                for status in expected["accessStatuses"]
                if any(doc["accessStatus"] == status for doc in documents)
            },
            "byReadiness": {
                status: sum(1 for doc in documents if doc["readiness"] == status)
                for status in expected["readiness"]
                if any(doc["readiness"] == status for doc in documents)
            },
        },
        "source": {
            "holder": source["holder"],
            "authority": "secondary",
            "license": "not-declared",
            "licenseNote": source.get("licenseNote"),
            "referencePeriod": source["referencePeriod"],
            "publicationDate": source.get("publicationDate"),
            "acquisitionDate": source["acquisitionDate"],
            "checkedAt": source["checkedAt"],
            "updateFrequency": source["updateFrequency"],
            "canonicalUrls": source["canonicalUrls"],
            "evidenceRule": source["evidenceRule"],
            "issueUrl": spec["landingUrl"],
        },
        "semantics": {
            "soldi": "Assente su ogni scheda del pilota: non e un dataset di spesa. Un importo futuro resterebbe in centesimi interi attribuiti alla fonte.",
            "periodo": "eventPeriod* descrive il fatto documentato; declassifiedAt/releasedAt la declassifica o pubblicazione; acquisitionDate/checkedAt/verifiedAt i controlli del progetto.",
            "provenance": "authority secondary: link e metadati da portali ufficiali; riassunti curati DVNS.",
        },
        "caveats": caveats,
        "documents": documents,
    }


def dump(snapshot: dict[str, Any]) -> bytes:
    return (json.dumps(snapshot, ensure_ascii=False, indent=2) + "\n").encode("utf-8")


def check_committed(spec: dict[str, Any] | None = None) -> dict[str, Any]:
    spec = spec or load_spec()
    payload = load_input(spec)
    snapshot = build_snapshot(payload, spec)
    if not OUTPUT.exists():
        fail(f"snapshot assente: {OUTPUT}")
    committed = OUTPUT.read_bytes()
    expected = dump(snapshot)
    if committed != expected:
        fail("snapshot committato diverge dalla proiezione dell'input verificato")
    return snapshot


def write_snapshot(spec: dict[str, Any] | None = None) -> dict[str, Any]:
    spec = spec or load_spec()
    payload = load_input(spec)
    snapshot = build_snapshot(payload, spec)
    OUTPUT.parent.mkdir(parents=True, exist_ok=True)
    OUTPUT.write_bytes(dump(snapshot))
    return snapshot


def main(argv: list[str] | None = None) -> int:
    parser = argparse.ArgumentParser(description=__doc__)
    group = parser.add_mutually_exclusive_group(required=True)
    group.add_argument("--check", action="store_true")
    group.add_argument("--write", action="store_true")
    args = parser.parse_args(argv)
    if args.check:
        check_committed()
        print(f"OK {DATASET}: snapshot allineato all'input verificato")
        return 0
    write_snapshot()
    print(f"Wrote {OUTPUT.relative_to(ROOT)}")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
