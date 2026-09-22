#!/usr/bin/env python3
"""Judicial proceedings of the XIX-legislature members of parliament.

The dataset is a curated research record, not an official table: in Italy the
criminal record register is not public and most merits judgments are never
published, so each case is held up by the act of the competent authority when one
exists and otherwise by at least two independent publishers. The committed input
under data/parlamento-giudiziario is hashed in the spec; this script projects it
into the published snapshot, recomputing every aggregate instead of trusting it.

Both actions are offline: --check re-derives the snapshot from the committed input
and fails closed on any divergence, --write rewrites it. Neither touches the
network, and --check never writes to the working tree.
"""

from __future__ import annotations

import argparse
import hashlib
import json
import re
from collections import Counter
from datetime import date, timedelta
from pathlib import Path
from typing import Any
from urllib.parse import urlparse

ROOT = Path(__file__).resolve().parents[2]
SPEC = ROOT / "scripts/etl/specs/parlamento-giudiziario-xix.source.json"
OUTPUT = ROOT / "src/data/generated/parlamento-giudiziario-xix.json"
DATASET = "parlamento-giudiziario-xix"
SCHEMA_VERSION = 1
ISO_DATE = re.compile(r"^\d{4}-\d{2}-\d{2}$")
LOOSE_DATE = re.compile(r"^\d{4}(-\d{2}(-\d{2})?)?$")
SHA_RE = re.compile(r"^[0-9a-f]{64}$")
STALE_YEARS = 7
# A non definitive proceeding says nothing about today unless somebody checked it
# recently: past this window the record keeps its last known status but is marked
# as needing a re-check, so a stale row cannot present itself as fresh.
RECHECK_MONTHS = 12
NON_DEFINITIVE = {"condanna_non_definitiva", "contabile_non_definitiva"}
CONVICTED = {"condanna_definitiva", "condanna_non_definitiva", "patteggiamento"}
CONTABILE = {"contabile_definitiva", "contabile_non_definitiva"}
NOT_CONVICTED = {"riformata_assoluzione", "prescrizione", "altra_estinzione"}
# I campi che finiscono sotto il nome di una persona si leggono in italiano: la
# ricerca a monte e stata condotta in inglese e una riga non tradotta e arrivata
# fino in pagina. Parole che in italiano non esistono, escluse dalle citazioni.
ENGLISH_MARKERS = re.compile(
    r"\b(was|were|been|acquitted|charges|misuse|lawyer|according to|sentenced|time-barred|his|her)\b", re.I)
VISIBLE_TEXT_FIELDS = ("title", "offence", "statusLabel")


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
    return json.loads(raw)


def publisher_key(url: str, groups: dict[str, list[str]]) -> str:
    host = (urlparse(url).hostname or "").lower()
    if host.startswith("www."):
        host = host[4:]
    if host == "web.archive.org":
        # An archived copy keeps the identity of the publisher it archived.
        inner = re.search(r"https?://(?:www\.)?([^/]+)", url[url.find("http", 5):] if url.find("http", 5) > 0 else "")
        host = inner.group(1).lower() if inner else host
    for group, hosts in groups.items():
        if any(host == candidate or host.endswith("." + candidate) for candidate in hosts):
            return group
    return host


def evidence_of(case: dict[str, Any], groups: dict[str, list[str]]) -> tuple[str, int]:
    sources = case["sources"]
    publishers = {publisher_key(source["url"], groups) for source in sources}
    tier = "atto-ufficiale" if any(source["kind"] == "primary" for source in sources) else "stampa-concordante"
    return tier, len(publishers)


def bucket_of(status: str, status_as_of: str, checked_at: str) -> str:
    if status in CONTABILE or status in CONVICTED:
        if status in {"condanna_non_definitiva", "contabile_non_definitiva"}:
            limit = (date.fromisoformat(checked_at) - timedelta(days=365 * STALE_YEARS)).isoformat()
            if status_as_of[:10] < limit:
                return "esito_ignoto"
        return "condannato" if status in CONVICTED else "contabile"
    if status in NOT_CONVICTED:
        return "non_condannato"
    fail(f"stato fuori contratto: {status}")
    return ""


def months_between(earlier: str, later: str) -> int:
    """Whole months between two dates, tolerating year or month only precision."""
    def parts(value: str) -> tuple[int, int]:
        pieces = (value or "")[:7].split("-")
        year = int(pieces[0])
        month = int(pieces[1]) if len(pieces) > 1 else 1
        return year, month

    year_a, month_a = parts(earlier)
    year_b, month_b = parts(later)
    return (year_b - year_a) * 12 + (month_b - month_a)


def recheck_state(case: dict[str, Any], checked_at: str) -> str:
    """fresco: qualcuno ha cercato sviluppi di recente. da-riverificare: nessuno lo
    controlla da oltre RECHECK_MONTHS. esito-ignoto: fermo da anni, gia fuori dai
    conteggi. Si misura da verifiedAt, cioe dall'ultimo controllo nostro, non da
    statusAsOf: un procedimento puo restare fermo per anni senza che il dato
    invecchi, mentre e il nostro silenzio a renderlo inaffidabile."""
    if case["outcomeBucket"] == "esito_ignoto":
        return "esito-ignoto"
    if case["status"] not in NON_DEFINITIVE:
        return "fresco"
    return "da-riverificare" if months_between(case["verifiedAt"], checked_at) > RECHECK_MONTHS else "fresco"


def validate_case(case: dict[str, Any], spec: dict[str, Any], checked_at: str, seen: set[str]) -> None:
    expected = spec["expected"]
    rules = spec["rules"]
    tag = case.get("caseId", "?")
    if case["caseId"] in seen:
        fail(f"{tag}: caseId duplicato")
    seen.add(case["caseId"])

    if not any(re.match(pattern, case["memberId"]) for pattern in expected["memberIdPatterns"]):
        fail(f"{tag}: memberId {case['memberId']} non e un id di Camera o Senato")
    for field, allowed in (("status", "statuses"), ("outcomeBucket", "outcomeBuckets"),
                           ("evidenceTier", "evidenceTiers"), ("evidenceLabel", "evidenceLabels"),
                           ("offenceCategory", "offenceCategories")):
        if case[field] not in expected[allowed]:
            fail(f"{tag}: {field} fuori contratto: {case[field]}")
    if not LOOSE_DATE.match(case["statusAsOf"] or ""):
        fail(f"{tag}: statusAsOf assente o malformata")
    if case["statusAsOf"][:4] > checked_at[:4]:
        fail(f"{tag}: statusAsOf nel futuro rispetto alla data di controllo")
    if not ISO_DATE.match(case.get("verifiedAt") or ""):
        fail(f"{tag}: verifiedAt assente o malformata")
    if case["verifiedAt"] > checked_at:
        fail(f"{tag}: verifiedAt nel futuro rispetto alla data di controllo")
    if case["verifiedAt"] < case["statusAsOf"]:
        fail(f"{tag}: verifiedAt precedente all'ultimo atto documentato")

    tier, publishers = evidence_of(case, spec["rules"]["publisherGroups"])
    if tier != case["evidenceTier"]:
        fail(f"{tag}: evidenceTier dichiarato {case['evidenceTier']}, ricalcolato {tier}")
    if tier != "atto-ufficiale" and publishers < 2:
        fail(f"{tag}: {publishers} editore indipendente senza atto ufficiale, ne servono due ({rules['evidence']})")
    if case["evidenceLabel"] == "official-finding" and not (
        tier == "atto-ufficiale" and case["status"] in {"condanna_definitiva", "contabile_definitiva"}
    ):
        fail(f"{tag}: official-finding senza condanna definitiva sostenuta da un atto")

    bucket = bucket_of(case["status"], case["statusAsOf"], checked_at)
    if bucket != case["outcomeBucket"]:
        fail(f"{tag}: outcomeBucket dichiarato {case['outcomeBucket']}, ricalcolato {bucket}")

    state = recheck_state(case, checked_at)
    if case.get("recheck") not in (None, state):
        fail(f"{tag}: recheck dichiarato {case['recheck']}, ricalcolato {state}")

    if not case["events"]:
        fail(f"{tag}: nessun grado di giudizio")
    for event in case["events"]:
        if event["instance"] not in expected["instances"]:
            fail(f"{tag}: grado fuori contratto: {event['instance']}")
        if event["outcome"] not in expected["outcomes"]:
            fail(f"{tag}: esito fuori contratto: {event['outcome']}")
        if event["sentenceType"] not in expected["sentenceTypes"]:
            fail(f"{tag}: tipo di pena fuori contratto: {event['sentenceType']}")
        if event["date"] and not LOOSE_DATE.match(event["date"]) and event["date"] != "n.d.":
            fail(f"{tag}: data del grado malformata: {event['date']}")
        for field in ("sentenceMonths", "fineEuroCents", "damagesEuroCents"):
            value = event.get(field)
            if value is None:
                continue  # absent stays absent: it must never be read as a zero
            if isinstance(value, bool) or not isinstance(value, (int, float)) or value < 0:
                fail(f"{tag}: {field} non e un numero non negativo")
            if field.endswith("Cents") and int(value) != value:
                fail(f"{tag}: {field} deve essere in centesimi interi")

    for field in VISIBLE_TEXT_FIELDS:
        found = ENGLISH_MARKERS.search(case[field] or "")
        if found:
            fail(f"{tag}: {field} contiene testo inglese ('{found.group(0)}'): la pagina e in italiano")

    # statusAsOf e la data dell'ultimo atto documentato, non la data dell'articolo
    # che lo racconta ne quella del nostro controllo: se le si lascia scivolare in
    # avanti, un procedimento fermo dal 2017 si presenta come recente.
    dated = [event["date"] for event in case["events"] if LOOSE_DATE.match(event["date"] or "")]
    if dated and case["statusAsOf"] != max(dated):
        fail(f"{tag}: statusAsOf {case['statusAsOf']} non e la data dell'ultimo atto documentato ({max(dated)})")

    for source in case["sources"]:
        if source["kind"] not in expected["sourceKinds"]:
            fail(f"{tag}: tipo di fonte fuori contratto: {source['kind']}")
        if not source["url"].startswith("https://") and not source["url"].startswith("http://"):
            fail(f"{tag}: url non valido: {source['url']}")
        if not source["publisher"]:
            fail(f"{tag}: fonte senza editore")
        if not source["confirms"]:
            fail(f"{tag}: fonte senza indicazione di cosa conferma")


def build_snapshot(payload: dict[str, Any], spec: dict[str, Any]) -> dict[str, Any]:
    expected = spec["expected"]
    coverage = payload["coverage"]
    checked_at = coverage["checkedAt"]
    if not ISO_DATE.match(checked_at or ""):
        fail("coverage: checkedAt assente o malformata")
    if coverage["membersExamined"] != expected["membersExamined"]:
        fail(f"coverage: {coverage['membersExamined']} parlamentari esaminati, attesi {expected['membersExamined']}")
    searched = coverage.get("membersSearched") or 0
    if searched > coverage["membersExamined"]:
        fail("coverage: cercati piu dei parlamentari esaminati")
    not_searched = coverage.get("membersNotSearched") or []
    if searched + len(not_searched) != coverage["membersExamined"]:
        fail("coverage: cercati e non cercati non tornano al totale esaminato")

    cases = payload["cases"]
    if not expected["minCases"] <= len(cases) <= expected["maxCases"]:
        fail(f"casi fuori intervallo atteso: {len(cases)}")
    seen: set[str] = set()
    for case in cases:
        validate_case(case, spec, checked_at, seen)

    if not payload.get("caveats"):
        fail("caveats assenti: il dataset deve dichiarare cosa non misura")

    by_outcome = Counter(case["outcomeBucket"] for case in cases)
    members_by_outcome = {
        bucket: len({case["memberId"] for case in cases if case["outcomeBucket"] == bucket})
        for bucket in expected["outcomeBuckets"]
    }
    # Months of custody are never added to euros of accounting damage: two scales,
    # reported separately, as the import standard requires.
    definitive_months = sum(
        case["latestSentenceMonths"] or 0
        for case in cases
        if case["outcomeBucket"] == "condannato" and case["status"] == "condanna_definitiva"
    )
    other_months = sum(
        case["latestSentenceMonths"] or 0
        for case in cases
        if case["outcomeBucket"] == "condannato" and case["status"] != "condanna_definitiva"
    )
    damages_cents = 0
    for case in cases:
        if case["outcomeBucket"] != "contabile":
            continue
        with_damage = [event for event in case["events"] if event.get("damagesEuroCents") is not None]
        if with_damage:
            damages_cents += with_damage[-1]["damagesEuroCents"]

    for case in cases:
        case["recheck"] = recheck_state(case, checked_at)
    overdue = sum(1 for case in cases if case["recheck"] == "da-riverificare")

    snapshot = {
        "schemaVersion": SCHEMA_VERSION,
        "dataset": DATASET,
        "legislature": payload["legislature"],
        "coverage": {
            **coverage,
            "cases": len(cases),
            "casesByOutcome": dict(sorted(by_outcome.items())),
            "membersByOutcome": members_by_outcome,
            "casesBackedByOfficialAct": sum(1 for case in cases if case["evidenceTier"] == "atto-ufficiale"),
            "casesBackedByPressOnly": sum(1 for case in cases if case["evidenceTier"] == "stampa-concordante"),
            "recheckAfterMonths": RECHECK_MONTHS,
            "casesToRecheck": overdue,
            "casesWithoutSentenceLength": sum(
                1 for case in cases
                if case["outcomeBucket"] == "condannato" and case["latestSentenceMonths"] is None
            ),
        },
        "totals": {
            # I mesi ammettono frazioni (15 giorni = 0.5): si arrotonda la somma,
            # altrimenti l'aritmetica in virgola mobile pubblica 243.67000000000002.
            "definitiveSentenceMonths": round(definitive_months, 2),
            "nonDefinitiveSentenceMonths": round(other_months, 2),
            "accountingDamageEuroCents": damages_cents,
            "note": "Mesi di pena e danno erariale sono grandezze diverse e non vanno sommati.",
        },
        "source": payload["source"],
        "caveats": payload["caveats"],
        "cases": sorted(cases, key=lambda case: (case["displayName"], case["caseId"])),
    }
    return snapshot


def serialise(snapshot: dict[str, Any]) -> str:
    return json.dumps(snapshot, ensure_ascii=False, indent=2) + "\n"


def check_committed(spec: dict[str, Any]) -> None:
    if not OUTPUT.exists():
        fail("snapshot committato assente")
    committed = json.loads(OUTPUT.read_text(encoding="utf-8"))
    rebuilt = build_snapshot(load_input(spec), spec)
    if serialise(rebuilt) != OUTPUT.read_text(encoding="utf-8"):
        fail("lo snapshot committato non coincide con la proiezione dell'input verificato")
    if committed["schemaVersion"] != SCHEMA_VERSION:
        fail("schemaVersion inatteso nello snapshot committato")


def recheck_report(today: str | None = None) -> int:
    """Name the proceedings nobody has re-checked, and fail when one has been left
    for twice the declared window: silence must not look like a fresh datum.

    Il confronto e con la data odierna, non con la checkedAt congelata nello
    snapshot: e il passare del tempo dopo il commit a rendere il dato vecchio."""
    snapshot = json.loads(OUTPUT.read_text(encoding="utf-8"))
    checked_at = today or date.today().isoformat()
    window = snapshot["coverage"]["recheckAfterMonths"]
    overdue = [case for case in snapshot["cases"]
               if case["recheck"] != "esito-ignoto"
               and case["status"] in NON_DEFINITIVE
               and months_between(case["verifiedAt"], checked_at) > window]
    breached = [case for case in overdue if months_between(case["verifiedAt"], checked_at) > window * 2]
    print(f"{DATASET}: valutato al {checked_at}, finestra {window} mesi")
    print(f"{len(overdue)} procedimenti da riverificare, {len(breached)} oltre il doppio della finestra")
    for case in sorted(overdue, key=lambda item: item["verifiedAt"]):
        months = months_between(case["verifiedAt"], checked_at)
        mark = "OLTRE" if case in breached else "atteso"
        print(f"  [{mark}] verificato {case['verifiedAt']} ({months} mesi fa), stato al "
              f"{case['statusAsOf']} - {case['displayName']}: {case['title']}")
    if breached:
        print("\nAggiornare lo stato di questi procedimenti oppure ritirarli dalla pubblicazione.")
        return 1
    return 0


def main() -> int:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--check", action="store_true", help="valida lo snapshot committato senza rete")
    parser.add_argument("--write", action="store_true", help="riproietta lo snapshot dall'input verificato")
    parser.add_argument("--recheck-report", action="store_true",
                        help="elenca i procedimenti da riverificare e fallisce oltre il doppio della finestra")
    parser.add_argument("--as-of", help="data da cui misurare la riverifica (default: oggi)")
    args = parser.parse_args()
    if sum((args.check, args.write, args.recheck_report)) != 1:
        raise SystemExit("specificare esattamente una azione: --check, --write oppure --recheck-report")

    spec = load_spec()
    if args.check:
        check_committed(spec)
        print(f"ok {DATASET}: snapshot coerente con l'input verificato")
        return 0

    if args.recheck_report:
        if args.as_of and not ISO_DATE.match(args.as_of):
            raise SystemExit("--as-of vuole una data YYYY-MM-DD")
        return recheck_report(args.as_of)

    snapshot = build_snapshot(load_input(spec), spec)
    OUTPUT.parent.mkdir(parents=True, exist_ok=True)
    OUTPUT.write_text(serialise(snapshot), encoding="utf-8")
    coverage = snapshot["coverage"]
    print(f"written {OUTPUT.relative_to(ROOT)} ({coverage['cases']} casi, "
          f"{coverage['membersByOutcome']['condannato']} parlamentari con condanna penale)")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
