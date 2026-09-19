#!/usr/bin/env python3
"""Camera participation-to-vote table (presence / absence per deputy).

Official source: the public HTML table on camera.it that summarises electronic
votes, missions and absences from the start of the XIX legislature to a locked
month end. Rows are joined to the committed Camera roster by surname/name when
the match is unique; unmatched official rows stay in the artifact without a
persona link. Senato has no equivalent official presence-% product here.
"""

from __future__ import annotations

import argparse
import hashlib
import json
import re
import ssl
import unicodedata
import urllib.error
import urllib.request
from datetime import datetime, timezone
from html.parser import HTMLParser
from pathlib import Path
from typing import Any

ROOT = Path(__file__).resolve().parents[2]
SPEC = ROOT / "scripts/etl/specs/camera-partecipazione-voto.source.json"
CAMERA_ROSTER = ROOT / "src/data/generated/politici-camera-xix.json"
OUTPUT = ROOT / "src/data/generated/camera-partecipazione-voto.json"
DATASET = "camera-partecipazione-voto"
USER_AGENT = (
    "DoveVannoINostriSoldi-ETL/1.0 "
    "(+https://github.com/Italian-Builders-Org/DoveVannoINostriSoldi; partecipazione al voto)"
)
SHA_RE = re.compile(r"^[0-9a-f]{64}$")
PERCENT_RE = re.compile(r"^(\d+(?:\.\d+)?)%$")
INT_RE = re.compile(r"^\d+$")
PERIOD_RE = re.compile(
    r"Dati riepilogativi dall.?inizio della XIX Legislatura al mese di ([A-Za-zàèéìòù]+ \d{4})",
    re.I,
)


class SnapshotError(ValueError):
    """Official payload or committed artifact failed validation."""


def require(condition: bool, message: str) -> None:
    if not condition:
        raise SnapshotError(message)


def fold(value: str) -> str:
    stripped = unicodedata.normalize("NFKD", value)
    without_marks = "".join(char for char in stripped if not unicodedata.combining(char))
    without_marks = without_marks.replace("'", "").replace("’", "").replace("`", "")
    return re.sub(r"\s+", " ", without_marks).strip().casefold()


def tokens(value: str) -> list[str]:
    return [part for part in fold(value).split() if part]


def load_spec(path: Path = SPEC) -> dict[str, Any]:
    spec = json.loads(path.read_text(encoding="utf-8"))
    require(spec.get("datasetId") == DATASET, "dataset identity differs")
    source = spec.get("source") or {}
    require(str(source.get("pageUrl") or "").startswith("https://www.camera.it/"), "pageUrl non ufficiale")
    require(str(source.get("landingUrl") or "").startswith("https://www.camera.it/"), "landingUrl non ufficiale")
    locks = (source.get("committedResponses") or {}).get("vista") or {}
    require(isinstance(locks.get("bytes"), int) and locks["bytes"] > 10_000, "lock bytes assente")
    require(bool(SHA_RE.match(str(locks.get("sha256") or ""))), "lock sha256 assente")
    floor = spec.get("coverageFloor") or {}
    require(isinstance(floor.get("rows"), int) and floor["rows"] >= 300, "coverageFloor.rows assente")
    require(
        isinstance(floor.get("matchedDeputies"), int) and floor["matchedDeputies"] >= 300,
        "coverageFloor.matchedDeputies assente",
    )
    period = spec.get("period") or {}
    require(period.get("observedDate") == "2026-02-28", "periodo osservato non allineato alla vista pinnata")
    require(period.get("legislature") == 19, "legislatura non XIX")
    return spec


class TableParser(HTMLParser):
    def __init__(self) -> None:
        super().__init__()
        self.rows: list[list[str]] = []
        self._cur: list[str] | None = None
        self._cell = ""
        self._in_cell = False

    def handle_starttag(self, tag: str, attrs: list[tuple[str, str | None]]) -> None:
        if tag == "tr":
            self._cur = []
            self._cell = ""
        elif tag in {"td", "th"} and self._cur is not None:
            self._in_cell = True
            self._cell = ""

    def handle_endtag(self, tag: str) -> None:
        if tag in {"td", "th"} and self._cur is not None and self._in_cell:
            self._cur.append(re.sub(r"\s+", " ", self._cell).strip())
            self._in_cell = False
        elif tag == "tr" and self._cur is not None:
            if self._cur:
                self.rows.append(self._cur)
            self._cur = None

    def handle_data(self, data: str) -> None:
        if self._in_cell:
            self._cell += data


def parse_percent(value: str) -> str:
    require(bool(PERCENT_RE.match(value)), f"percentuale non valida: {value!r}")
    return value


def parse_count(value: str) -> int:
    require(bool(INT_RE.match(value)), f"conteggio non valido: {value!r}")
    return int(value)


def fetch_bytes(url: str) -> bytes:
    request = urllib.request.Request(url, headers={"User-Agent": USER_AGENT, "Accept": "text/html"}, method="GET")
    try:
        with urllib.request.urlopen(request, context=ssl.create_default_context(), timeout=90) as response:
            return response.read()
    except urllib.error.URLError as error:
        raise SnapshotError(f"pagina partecipazione non raggiungibile: {error}") from error


def load_roster() -> list[dict[str, Any]]:
    require(CAMERA_ROSTER.is_file(), "snapshot Camera in carica assente")
    payload = json.loads(CAMERA_ROSTER.read_text(encoding="utf-8"))
    deputies = payload.get("deputies")
    require(isinstance(deputies, list) and len(deputies) >= 300, "roster Camera incompleto")
    return deputies


def build_indexes(deputies: list[dict[str, Any]]) -> tuple[dict[str, list[dict[str, Any]]], dict[str, list[dict[str, Any]]]]:
    by_exact: dict[str, list[dict[str, Any]]] = {}
    by_last: dict[str, list[dict[str, Any]]] = {}
    for deputy in deputies:
        exact = fold(f"{deputy['lastName']} {deputy['firstName']}")
        by_exact.setdefault(exact, []).append(deputy)
        by_last.setdefault(fold(deputy["lastName"]), []).append(deputy)
    return by_exact, by_last


def first_compatible(stats_first: str, official_first: str) -> bool:
    stats_tokens = tokens(stats_first)
    official_tokens = tokens(official_first)
    if not stats_tokens or not official_tokens:
        return False
    if fold(stats_first) == fold(official_first):
        return True
    if stats_tokens[0] in official_tokens or official_tokens[0] in stats_tokens:
        return True
    for left in stats_tokens:
        for right in official_tokens:
            if len(left) >= 3 and len(right) >= 3 and (left.startswith(right) or right.startswith(left)):
                return True
    return False


def match_deputy(
    source_name: str,
    by_exact: dict[str, list[dict[str, Any]]],
    by_last: dict[str, list[dict[str, Any]]],
) -> tuple[dict[str, Any] | None, str]:
    exact_hits = by_exact.get(fold(source_name), [])
    if len(exact_hits) == 1:
        return exact_hits[0], "exact"
    if len(exact_hits) > 1:
        return None, "ambiguous-exact"

    parts = tokens(source_name)
    if len(parts) < 2:
        return None, "short-name"

    for last_n in range(1, min(4, len(parts))):
        last = " ".join(parts[:last_n])
        first = " ".join(parts[last_n:])
        surname_hits = by_last.get(last, [])
        compatible = [deputy for deputy in surname_hits if first_compatible(first, deputy["firstName"])]
        uniq = {deputy["id"]: deputy for deputy in compatible}
        if len(uniq) == 1:
            return next(iter(uniq.values())), "fuzzy-name"
        # Camera often prints a public nickname; unique surname in the chamber is enough.
        if len(surname_hits) == 1:
            return surname_hits[0], "unique-surname"
    return None, "unmatched"


def parse_rows(html: str) -> list[list[str]]:
    parser = TableParser()
    parser.feed(html)
    rows = [
        row
        for row in parser.rows
        if len(row) >= 12 and row[0] and row[0] != "Deputato" and INT_RE.match(row[2] or "")
    ]
    require(len(rows) >= 300, f"righe deputati insufficienti: {len(rows)}")
    return rows


def build_snapshot(spec: dict[str, Any], html: bytes, acquired_at: str) -> dict[str, Any]:
    text = html.decode("utf-8", errors="replace")
    require("Dettaglio statistiche di voto" in text, "titolo pagina partecipazione assente")
    require("Totale" in text and "presenze" in text, "colonna totale presenze assente")
    plain = re.sub(r"<[^>]+>", " ", text)
    plain = plain.replace("&nbsp;", " ").replace("&#039;", "'").replace("&amp;", "&")
    plain = re.sub(r"\s+", " ", plain)
    period_match = PERIOD_RE.search(plain)
    require(period_match is not None, "etichetta di periodo assente nella pagina")
    require("Febbraio 2026" in period_match.group(0), "mese di chiusura diverso da febbraio 2026")

    deputies = load_roster()
    by_exact, by_last = build_indexes(deputies)
    rows = parse_rows(text)

    records: list[dict[str, Any]] = []
    seen_names: set[str] = set()
    matched_ids: set[str] = set()
    for row in rows:
        source_name = row[0]
        require(source_name not in seen_names, f"deputato duplicato nella tabella: {source_name}")
        seen_names.add(source_name)
        deputy, match_kind = match_deputy(source_name, by_exact, by_last)
        if deputy is not None:
            require(deputy["id"] not in matched_ids, f"persona collegata due volte: {deputy['id']}")
            matched_ids.add(deputy["id"])
        record = {
            "sourceName": source_name,
            "groupLabel": row[1],
            "deputyId": deputy["id"] if deputy else None,
            "numericId": deputy["numericId"] if deputy else None,
            "matchKind": match_kind if deputy else "unmatched",
            "votesCast": parse_count(row[2]),
            "votesCastPercent": parse_percent(row[3]),
            "missions": parse_count(row[4]),
            "missionsPercent": parse_percent(row[5]),
            "presenceTotal": parse_count(row[6]),
            "presencePercent": parse_percent(row[7]),
            "absences": parse_count(row[8]),
            "absencesPercent": parse_percent(row[9]),
            "justifiedAbsences": parse_count(row[10]),
            "justifiedAbsencesPercent": parse_percent(row[11]),
        }
        records.append(record)

    records.sort(key=lambda item: fold(item["sourceName"]))
    floor = spec["coverageFloor"]
    require(len(records) >= floor["rows"], f"righe sotto soglia: {len(records)} < {floor['rows']}")
    matched = sum(1 for item in records if item["deputyId"])
    require(matched >= floor["matchedDeputies"], f"match sotto soglia: {matched} < {floor['matchedDeputies']}")

    source = spec["source"]
    locks = source["committedResponses"]["vista"]
    digest = hashlib.sha256(html).hexdigest()
    require(len(html) == locks["bytes"], f"bytes vista drift: {len(html)} != {locks['bytes']}")
    require(digest == locks["sha256"], "sha256 vista drift")

    return {
        "schemaVersion": 1,
        "chamber": "camera",
        "legislature": {
            "number": 19,
            "label": "XIX legislatura",
        },
        "period": {
            "label": spec["period"]["label"],
            "observedDate": spec["period"]["observedDate"],
            "monthLabel": period_match.group(1),
        },
        "coverage": {
            "rows": len(records),
            "matchedDeputies": matched,
            "unmatchedRows": len(records) - matched,
            "rosterDeputiesWithoutRow": len(deputies) - matched,
        },
        "soldi": {
            "present": False,
            "note": spec["semantics"]["soldi"]["note"],
        },
        "source": {
            "owner": source["owner"],
            "title": spec["title"],
            "pageUrl": source["pageUrl"],
            "landingUrl": source["landingUrl"],
            "license": source["license"],
            "licenseUrl": source["licenseUrl"],
            "observedDate": spec["period"]["observedDate"],
            "acquiredAt": acquired_at,
            "responses": {"vista": {"bytes": len(html), "sha256": digest}},
            "cadence": "mensile (riepilogo cumulativo dalla Camera)",
        },
        "provenance": {
            "kind": "official-html-table",
            "page": source["pageUrl"],
            "gap": (
                "Il Senato non pubblica una tabella ufficiale di percentuale di presenza "
                "equivalente; non si ricostruisce da votazioni aperte."
            ),
        },
        "deputies": records,
        "caveats": list(spec["caveats"]),
    }


def validate_snapshot(payload: dict[str, Any], *, floor: dict[str, int], locks: dict[str, Any]) -> None:
    require(payload.get("schemaVersion") == 1, "schemaVersion")
    require(payload.get("chamber") == "camera", "chamber")
    require(payload.get("soldi", {}).get("present") is False, "soldi.present deve essere false")
    deputies = payload.get("deputies")
    require(isinstance(deputies, list), "deputies assente")
    require(len(deputies) >= floor["rows"], "rows sotto soglia")
    matched = sum(1 for item in deputies if item.get("deputyId"))
    require(matched >= floor["matchedDeputies"], "matched sotto soglia")
    require(payload["coverage"]["rows"] == len(deputies), "coverage.rows")
    require(payload["coverage"]["matchedDeputies"] == matched, "coverage.matchedDeputies")
    response = payload["source"]["responses"]["vista"]
    require(response["bytes"] == locks["bytes"], "bytes lock")
    require(response["sha256"] == locks["sha256"], "sha lock")
    seen_ids: set[str] = set()
    for item in deputies:
        require(item["presenceTotal"] == item["votesCast"] + item["missions"], "presenze != voti+missioni")
        require(0 <= item["votesCast"] <= item["presenceTotal"], "voti fuori range")
        if item.get("deputyId"):
            require(item["deputyId"] not in seen_ids, f"deputyId duplicato {item['deputyId']}")
            seen_ids.add(item["deputyId"])
            require(isinstance(item.get("numericId"), str) and item["numericId"].isdigit(), "numericId")


def check_committed(spec: dict[str, Any] | None = None) -> dict[str, Any]:
    spec = spec or load_spec()
    require(OUTPUT.is_file(), "artefatto partecipazione assente")
    payload = json.loads(OUTPUT.read_text(encoding="utf-8"))
    validate_snapshot(payload, floor=spec["coverageFloor"], locks=spec["source"]["committedResponses"]["vista"])
    return payload


def write_snapshot(spec: dict[str, Any] | None = None) -> dict[str, Any]:
    spec = spec or load_spec()
    html = fetch_bytes(spec["source"]["pageUrl"])
    acquired_at = datetime.now(timezone.utc).strftime("%Y-%m-%dT%H:%M:%SZ")
    payload = build_snapshot(spec, html, acquired_at)
    validate_snapshot(payload, floor=spec["coverageFloor"], locks=spec["source"]["committedResponses"]["vista"])
    OUTPUT.write_text(json.dumps(payload, ensure_ascii=False, indent=2) + "\n", encoding="utf-8")
    return payload


def main() -> None:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--check", action="store_true", help="valida l'artefatto committato offline")
    parser.add_argument("--write", action="store_true", help="scarica la vista ufficiale e riscrive lo snapshot")
    args = parser.parse_args()
    require(args.check ^ args.write, "specificare --check oppure --write")
    if args.check:
        payload = check_committed()
        print(f"OK camera-partecipazione-voto rows={payload['coverage']['rows']} matched={payload['coverage']['matchedDeputies']}")
        return
    payload = write_snapshot()
    print(f"WROTE {OUTPUT} rows={payload['coverage']['rows']} matched={payload['coverage']['matchedDeputies']}")


if __name__ == "__main__":
    main()
