"""Offline analysis of public station observations, never called by a site visit."""

import csv
import hashlib
import io
import json
import re
from datetime import datetime, timedelta
from html.parser import HTMLParser
from pathlib import Path
from urllib.parse import parse_qs, urlparse
from zoneinfo import ZoneInfo

from artifact_io import write_artifact

ROME = ZoneInfo("Europe/Rome")
MAX_CAPTURE_BYTES = 2 * 1024**2


class _Blocks(HTMLParser):
    def __init__(self):
        super().__init__(convert_charrefs=True)
        self.active = None
        self.text = []
        self.blocks = []

    def handle_starttag(self, tag, attrs):
        if tag in ("h1", "h2", "p"):
            if self.active:
                raise ValueError("Nested source blocks")
            self.active, self.text = tag, []

    def handle_endtag(self, tag):
        if tag == self.active:
            self.blocks.append((tag, " ".join("".join(self.text).split())))
            self.active, self.text = None, []

    def handle_data(self, data):
        if self.active:
            self.text.append(data + " ")


def _clock(value, missing=False):
    match = re.match(r"^(\d{2}:\d{2}|--)(?:\s|$)", value.strip())
    if not match or match[1] == "--":
        if missing and (not value.strip() or value.strip().startswith("--")):
            return None
        raise ValueError("Missing or invalid source clock")
    hours, minutes = map(int, match[1].split(":"))
    if hours > 23 or minutes > 59:
        raise ValueError("Invalid source clock")
    return match[1]


def _minutes(clock):
    h, m = map(int, clock.split(":"))
    return h * 60 + m


def analyse_capture(capture):
    if not isinstance(capture, dict) or set(capture) != {"url", "acquiredAt", "html"}:
        raise ValueError("Invalid capture contract")
    if not all(isinstance(v, str) for v in capture.values()):
        raise ValueError("Invalid capture values")
    raw = capture["html"].encode()
    if len(raw) > MAX_CAPTURE_BYTES:
        raise ValueError("Capture byte budget exceeded")
    url = urlparse(capture["url"])
    allowed = {
        "dettaglio",
        "numeroTreno",
        "codLocOrig",
        "dataPartenza",
        "tipoRicerca",
        "lang",
    }
    query = parse_qs(url.query, keep_blank_values=True)
    if (
        url.scheme not in ("http", "https")
        or url.netloc != "www.viaggiatreno.it"
        or url.path != "/vt_pax_internet/mobile/scheda"
        or url.fragment
        or set(query) - allowed
        or any(len(v) != 1 for v in query.values())
    ):
        raise ValueError("Unsupported public source")
    number = query.get("numeroTreno", [""])[0]
    stamp = query.get("dataPartenza", [""])[0]
    if (
        not re.fullmatch(r"\d{1,6}", number)
        or not re.fullmatch(r"\d{13}", stamp)
        or not re.fullmatch(r"S\d{3,8}", query.get("codLocOrig", [""])[0])
    ):
        raise ValueError("Missing source train/date identity")
    acquired = datetime.fromisoformat(capture["acquiredAt"].replace("Z", "+00:00"))
    if acquired.tzinfo is None:
        raise ValueError("Capture date needs timezone")
    day = datetime.fromtimestamp(int(stamp) / 1000, ROME)
    if (
        day.hour
        or day.minute
        or day.second
        or day.date() > acquired.astimezone(ROME).date()
    ):
        raise ValueError("Invalid source service date")
    parser = _Blocks()
    parser.feed(capture["html"])
    headers = [text for tag, text in parser.blocks if tag == "h1"]
    title = re.fullmatch(
        r"([A-Z][A-Z ]{0,29})\s+(\d{1,6})", headers[0] if len(headers) == 1 else ""
    )
    if not title or int(title[2]) != int(number):
        raise ValueError("Source train heading mismatch")
    rows, current = [], None
    for tag, text in parser.blocks:
        if tag == "h2":
            if not text or len(text) > 160:
                raise ValueError("Invalid station name")
            current = {"station": text}
            rows.append(current)
        elif tag == "p" and current is not None:
            match = re.match(
                r"^(Arrivo|Partenza) (programmat[oa]|effettiv[oa]):\s*(.*)$", text, re.I
            )
            if not match:
                continue  # A forecast is not a recorded event.
            kind = "departure" if match[1].lower() == "partenza" else "arrival"
            field = (
                "scheduled" if match[2].lower().startswith("programmat") else "observed"
            )
            if field in current or ("kind" in current and current["kind"] != kind):
                raise ValueError("Duplicate or inconsistent source event")
            current["kind"] = kind
            current[field] = _clock(match[3], missing=field == "observed")
    if not 2 <= len(rows) <= 200:
        raise ValueError("Unsupported station count")
    previous_plan = previous_actual = None
    for i, row in enumerate(rows):
        if "scheduled" not in row or row.get("kind") != (
            "departure" if i == 0 else "arrival"
        ):
            raise ValueError("Missing scheduled source event")
        row.setdefault("observed", None)
        planned = _minutes(row["scheduled"])
        if previous_plan is not None and planned < previous_plan:
            raise ValueError(
                "Clock-only journey crosses midnight; dated events required"
            )
        previous_plan = planned
        actual = _minutes(row["observed"]) if row["observed"] is not None else None
        if actual is not None:
            if abs(actual - planned) >= 12 * 60:
                raise ValueError("Ambiguous clock-only delay; dated events required")
            if previous_actual is not None and actual < previous_actual:
                raise ValueError("Ambiguous actual chronology")
            event_time = day + timedelta(minutes=actual)
            if event_time > acquired + timedelta(minutes=5):
                raise ValueError("Actual event is in the future")
            previous_actual = actual
        row["delayMinutes"] = actual - planned if actual is not None else None
        before = rows[i - 1]["delayMinutes"] if i else None
        row["deltaMinutes"] = (
            row["delayMinutes"] - before
            if before is not None and actual is not None
            else None
        )
    observed = [r["delayMinutes"] for r in rows if r["delayMinutes"] is not None]
    if not observed:
        raise ValueError("No recorded events")
    increases = [
        (r["deltaMinutes"], i)
        for i, r in enumerate(rows)
        if r["deltaMinutes"] is not None and r["deltaMinutes"] > 0
    ]
    peak = max(increases, default=None)
    return {
        "id": day.date().isoformat() + "-" + str(int(number)),
        "number": str(int(number)),
        "category": title[1].strip(),
        "serviceDate": day.date().isoformat(),
        "origin": rows[0]["station"],
        "destination": rows[-1]["station"],
        "observations": rows,
        "coverage": {
            "stops": len(rows),
            "observedStops": len(observed),
            "complete": len(observed) == len(rows),
        },
        "arrivalDelayMinutes": rows[-1]["delayMinutes"],
        "peakDelayMinutes": max(observed),
        "largestIncrease": (
            {"fromIndex": peak[1] - 1, "toIndex": peak[1], "minutes": peak[0]}
            if peak
            else None
        ),
        "source": {
            "url": capture["url"],
            "acquiredAt": capture["acquiredAt"],
            # A full page vs. only the h1/h2/p blocks the parser reads, saved
            # when the browser could not hand over the whole document.
            "kind": (
                "public-browser-dom"
                if re.search(r"<html[\s>]", capture["html"], re.I)
                else "public-browser-dom-extract"
            ),
            "sha256": hashlib.sha256(raw).hexdigest(),
            "bytes": len(raw),
        },
    }


def read_capture(path, max_bytes=MAX_CAPTURE_BYTES):
    with path.open("rb") as stream:
        raw = stream.read(max_bytes + 1)
    if len(raw) > max_bytes:
        raise ValueError("Capture byte budget exceeded")
    return analyse_capture(json.loads(raw))


def csv_for(journey):
    def cell(value):
        if value is None:
            return ""
        if isinstance(value, str) and value.startswith(("=", "+", "-", "@")):
            return "'" + value
        return value

    stream = io.StringIO(newline="")
    writer = csv.writer(stream)
    writer.writerow(
        [
            "numero_treno",
            "data_servizio",
            "fermata",
            "tipo_passaggio",
            "programmato",
            "rilevato",
            "ritardo_min",
            "variazione_min",
            "url_fonte",
            "sha256_fonte",
        ]
    )
    for row in journey["observations"]:
        writer.writerow(
            map(
                cell,
                [
                    journey["number"],
                    journey["serviceDate"],
                    row["station"],
                    row["kind"],
                    row["scheduled"],
                    row["observed"],
                    row["delayMinutes"],
                    row["deltaMinutes"],
                    journey["source"]["url"],
                    journey["source"]["sha256"],
                ],
            )
        )
    return stream.getvalue()


def rail_history(journeys):
    """Group saved journeys by train number: one row per day, one column per station.

    Only observed passes enter the means; forecasts and gaps stay None. A
    handful of days shows what was recorded, not how often delays recur.
    """
    if len({j["id"] for j in journeys}) != len(journeys):
        raise ValueError("Duplicate train/day capture")
    by_number = {}
    for j in sorted(journeys, key=lambda j: (j["serviceDate"], j["number"])):
        by_number.setdefault(j["number"], []).append(j)
    trains = []
    for number, days in sorted(by_number.items(), key=lambda x: int(x[0])):
        order = []
        for j in days:
            for row in j["observations"]:
                if row["station"] not in order:
                    order.append(row["station"])
        stations = []
        for name in order:
            delays = [
                next(
                    (r["delayMinutes"] for r in j["observations"] if r["station"] == name),
                    None,
                )
                for j in days
            ]
            seen = [d for d in delays if d is not None]
            stations.append(
                {
                    "station": name,
                    "delays": delays,
                    "observedDays": len(seen),
                    "meanDelayMinutes": (
                        round(sum(seen) / len(seen), 1) if seen else None
                    ),
                    "maxDelayMinutes": max(seen) if seen else None,
                }
            )
        trains.append(
            {
                "number": number,
                "category": days[-1]["category"],
                "origin": days[-1]["origin"],
                "destination": days[-1]["destination"],
                "days": [
                    {
                        "id": j["id"],
                        "serviceDate": j["serviceDate"],
                        "arrivalDelayMinutes": j["arrivalDelayMinutes"],
                        "peakDelayMinutes": j["peakDelayMinutes"],
                        "observedStops": j["coverage"]["observedStops"],
                        "stops": j["coverage"]["stops"],
                    }
                    for j in days
                ],
                "stations": stations,
            }
        )
    return {"trains": trains}


def write_rail_viewer(journeys, output, standalone=False):
    if (
        not journeys
        or len(journeys) > 100
        or len({j["id"] for j in journeys}) != len(journeys)
    ):
        raise ValueError("Invalid or duplicate railway captures")
    here = Path(__file__).parent
    payload = {
        "schemaVersion": 1,
        "metric": "observed-station-delay",
        "journeys": [{**j, "csv": csv_for(j)} for j in journeys],
        "history": rail_history(journeys),
        "context": json.loads((here / "rail-context.json").read_text()),
    }
    embedded = (
        json.dumps(payload, ensure_ascii=False, separators=(",", ":"), allow_nan=False)
        .replace("<", "\\u003c")
        .replace("\u2028", "\\u2028")
        .replace("\u2029", "\\u2029")
    )
    page = (here / "rail-viewer.html").read_text()
    page = page.replace(
        "<!--__MAP_LINK__-->", "" if standalone else '<a href="index.html">Mappa</a>'
    )
    page = page.replace("/*__RAIL_DATA__*/", embedded)
    page = page.replace("/*__RAIL_STYLE__*/", (here / "rail-viewer.css").read_text())
    modules = []
    for name in ["explorer.mjs", "select-menu.mjs", "disclosure.mjs", "rail-viewer.js"]:
        code = (here / name).read_text()
        code = re.sub(r"^import\s[\s\S]*?;\n", "", code, flags=re.MULTILINE)
        code = re.sub(r"^export\s+", "", code, flags=re.MULTILINE)
        modules.append(code)
    page = page.replace("/*__RAIL_SCRIPT__*/", "\n".join(modules))
    output.mkdir(parents=True, exist_ok=True)
    write_artifact(output / "treni.html", page.encode())
