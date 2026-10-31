#!/usr/bin/env python3
"""Offline scheduled transit speeds. Standard library only; never called by a site visit."""
import argparse
import base64
import bisect
import csv
import gzip
import hashlib
import io
import json
import math
import re
import statistics
import zipfile
from collections import Counter, defaultdict
from datetime import date
from pathlib import Path

BANDS = {
    "morning": (7 * 3600, 10 * 3600),
    "day": (10 * 3600, 16 * 3600),
    "evening": (16 * 3600, 20 * 3600),
    "all": (0, 48 * 3600),
}
TRAM_TYPES = {"0", "900", "901", "902", "903", "904", "905", "906"}
REQUIRED = {"agency.txt", "routes.txt", "trips.txt", "stops.txt", "stop_times.txt"}


def safe_json(value):
    return (
        json.dumps(value, ensure_ascii=False, separators=(",", ":"), allow_nan=False)
        .replace("<", "\\u003c")
        .replace("\u2028", "\\u2028")
        .replace("\u2029", "\\u2029")
    )


class Archive:
    def __init__(self, path, max_bytes=2 * 1024**3):
        self.z = zipfile.ZipFile(path)
        self.members = {}
        try:
            if len(self.z.infolist()) > 100:
                raise ValueError("ZIP member budget exceeded")
            if sum(i.file_size for i in self.z.infolist()) > max_bytes:
                raise ValueError("ZIP expanded byte budget exceeded")
            for info in self.z.infolist():
                if info.is_dir():
                    continue
                name = Path(info.filename).name
                if name in self.members:
                    raise ValueError("ZIP: duplicate table " + name)
                self.members[name] = info.filename
            if not REQUIRED.issubset(self.members):
                raise ValueError(
                    "Missing GTFS tables: " + str(REQUIRED - self.members.keys())
                )
            if not {"calendar.txt", "calendar_dates.txt"} & self.members.keys():
                raise ValueError("Missing service calendar")
        except Exception:
            self.z.close()
            raise

    def rows(self, name, required=()):
        if name not in self.members:
            return
        with (
            self.z.open(self.members[name]) as raw,
            io.TextIOWrapper(raw, encoding="utf-8-sig", newline="") as f,
        ):
            reader = csv.DictReader(f)
            fields = reader.fieldnames or []
            if len(fields) != len(set(fields)) or not set(required).issubset(fields):
                raise ValueError("Unexpected columns in " + name)
            for row in reader:
                if None in row or any(v is None for v in row.values()):
                    raise ValueError("Malformed CSV row in " + name)
                yield row

    def __enter__(self):
        return self

    def __exit__(self, *args):
        self.z.close()


def gtfs_date(value):
    return (
        date.fromisoformat(value[:4] + "-" + value[4:6] + "-" + value[6:])
        if re.fullmatch(r"\d{8}", value)
        else None
    )


def active_services(calendar, exceptions, day):
    active = set()
    weekday = [
        "monday",
        "tuesday",
        "wednesday",
        "thursday",
        "friday",
        "saturday",
        "sunday",
    ][day.weekday()]
    for row in calendar:
        start, end = gtfs_date(row["start_date"]), gtfs_date(row["end_date"])
        if not start or not end or start > end or row[weekday] not in {"0", "1"}:
            raise ValueError("Invalid calendar")
        if start <= day <= end and row[weekday] == "1":
            active.add(row["service_id"])
    seen = set()
    for row in exceptions:
        if gtfs_date(row["date"]) != day:
            continue
        service = row["service_id"]
        if service in seen:
            raise ValueError("Duplicate calendar exception")
        seen.add(service)
        if row["exception_type"] == "1":
            active.add(service)
        elif row["exception_type"] == "2":
            active.discard(service)
        else:
            raise ValueError("Invalid calendar exception")
    return active


def seconds(value):
    if not re.fullmatch(r"\d{1,2}:[0-5]\d:[0-5]\d", value):
        return None
    h, m, s = map(int, value.split(":"))
    return h * 3600 + m * 60 + s if h < 48 else None


def number(value):
    try:
        n = float(value)
        return n if math.isfinite(n) else None
    except (TypeError, ValueError):
        return None


def coordinate(row, lat, lon):
    a, b = number(row[lat]), number(row[lon])
    if a is None or b is None or not -90 <= a <= 90 or not -180 <= b <= 180:
        raise ValueError("Invalid geographic coordinate")
    return (b, a)


def metres(a, b):
    lon1, lat1, lon2, lat2 = map(math.radians, (*a, *b))
    h = (
        math.sin((lat2 - lat1) / 2) ** 2
        + math.cos(lat1) * math.cos(lat2) * math.sin((lon2 - lon1) / 2) ** 2
    )
    return 6371008.8 * 2 * math.asin(min(1, math.sqrt(max(0, h))))


def interpolate(points, pos):
    index = min(int(pos), len(points) - 2)
    part = pos - index
    a, b = points[index], points[index + 1]
    return (a[0] + (b[0] - a[0]) * part, a[1] + (b[1] - a[1]) * part)


def project(points, stop, minimum):
    best = (float("inf"), None)
    scale = math.cos(math.radians(stop[1]))
    for i in range(int(minimum), len(points) - 1):
        a, b = points[i], points[i + 1]
        dx, dy = (b[0] - a[0]) * scale, b[1] - a[1]
        denominator = dx * dx + dy * dy
        if denominator == 0:
            continue
        t = ((stop[0] - a[0]) * scale * dx + (stop[1] - a[1]) * dy) / denominator
        t = max(max(0, minimum - i), min(1, t))
        pos = i + t
        point = interpolate(points, pos)
        distance = metres(stop, point)
        if distance < best[0]:
            best = (distance, pos)
    return best[1] if best[0] <= 250 else None


def geometries(shape, rows, stops, excluded):
    points = [p[1] for p in shape]
    if len(points) < 2:
        return [None] * (len(rows) - 1)
    distances = [p[2] for p in shape]
    use_dist = all(d is not None for d in distances) and all(
        b > a for a, b in zip(distances, distances[1:])
    )
    positions = []
    cursor = 0
    for row in rows:
        stop = stops.get(row["stop_id"])
        if not stop:
            raise ValueError("Unknown stop_id " + row["stop_id"])
        distance = number(row.get("shape_dist_traveled", ""))
        if use_dist and distance is not None:
            if not distances[0] <= distance <= distances[-1]:
                pos = None
            else:
                i = min(
                    max(0, bisect.bisect_right(distances, distance) - 1),
                    len(points) - 2,
                )
                pos = i + (distance - distances[i]) / (distances[i + 1] - distances[i])
                if (
                    pos < cursor
                    or metres(interpolate(points, pos), stop["point"]) > 250
                ):
                    pos = None
        else:
            pos = project(points, stop["point"], cursor)
        positions.append(pos)
        if pos is not None:
            cursor = pos
    result = []
    for a, b in zip(positions, positions[1:]):
        if a is None or b is None or b <= a:
            result.append(None)
            excluded["unlocated_or_nonprogressing_pair"] += 1
            continue
        coords = (
            [interpolate(points, a)]
            + [points[i] for i in range(math.floor(a) + 1, math.ceil(b))]
            + [interpolate(points, b)]
        )
        length = sum(metres(x, y) for x, y in zip(coords, coords[1:]))
        if length < 25:
            result.append(None)
            excluded["short_geometry_pair"] += 1
            continue
        result.append((coords, length))
    return result


def unique(rows, key):
    result = {}
    for row in rows:
        if not row[key] or row[key] in result:
            raise ValueError("Missing/duplicate " + key)
        result[row[key]] = row
    return result


def analyze_feed(path, service_date, receipt, source):
    with open(path, "rb") as f:
        digest = hashlib.file_digest(f, "sha256").hexdigest()
    if digest != receipt["sha256"] or Path(path).stat().st_size != receipt["bytes"]:
        raise ValueError("SHA-256/byte receipt mismatch")
    if receipt.get("url") != source["url"]:
        raise ValueError("Source URL receipt mismatch")
    excluded = Counter()
    segments = {}
    geometry_cache = {}
    accepted_trips = set()
    accepted_routes = set()
    bounds = source.get("studyBounds")

    def in_area(point):
        return (
            not bounds
            or bounds[0] <= point[0] <= bounds[2]
            and bounds[1] <= point[1] <= bounds[3]
        )

    result = {
        **source,
        "serviceDate": service_date.isoformat(),
        "receipt": receipt,
        "status": "no-service",
        "segments": [],
        "stops": [],
        "exclusions": {},
        "coverage": {},
    }
    with Archive(path) as a:
        services = active_services(
            a.rows("calendar.txt", ("service_id", "start_date", "end_date")),
            a.rows("calendar_dates.txt", ("service_id", "date", "exception_type")),
            service_date,
        )
        agencies = list(a.rows("agency.txt", ("agency_name", "agency_timezone")))
        if {r["agency_timezone"] for r in agencies} != {"Europe/Rome"}:
            raise ValueError("Unsupported agency timezone")
        routes = unique(a.rows("routes.txt", ("route_id", "route_type")), "route_id")
        trips = unique(
            a.rows("trips.txt", ("trip_id", "route_id", "service_id")), "trip_id"
        )
        route_types = set(source.get("routeTypes", TRAM_TYPES))
        eligible_trips = {
            key: r
            for key, r in trips.items()
            if routes[r["route_id"]]["route_type"] in route_types
        }
        selected = {
            key: r for key, r in eligible_trips.items() if r["service_id"] in services
        }
        had_active_trips = bool(selected)
        frequency = {r["trip_id"] for r in a.rows("frequencies.txt", ("trip_id",))}
        excluded["frequency_trip"] = len(frequency & selected.keys())
        selected = {key: r for key, r in selected.items() if key not in frequency}
        result["coverage"] = {
            "routesInFeed": sum(
                r["route_type"] in route_types for r in routes.values()
            ),
            "activeRoutes": len({r["route_id"] for r in selected.values()}),
            "activeScheduledTrips": len(selected),
            "activeServices": len(services),
        }
        if not services or not selected:
            result["status"] = (
                "no-comparable-segments" if had_active_trips else "no-service"
            )
            result["exclusions"] = dict(excluded)
            return result
        stops = unique(
            a.rows("stops.txt", ("stop_id", "stop_name", "stop_lon", "stop_lat")),
            "stop_id",
        )
        for stop in stops.values():
            stop["point"] = coordinate(stop, "stop_lat", "stop_lon")
        wanted = {trip.get("shape_id") for trip in selected.values()}
        shapes = defaultdict(list)
        for row in a.rows(
            "shapes.txt",
            ("shape_id", "shape_pt_sequence", "shape_pt_lat", "shape_pt_lon"),
        ):
            if row["shape_id"] in wanted:
                shapes[row["shape_id"]].append(
                    (
                        int(row["shape_pt_sequence"]),
                        coordinate(row, "shape_pt_lat", "shape_pt_lon"),
                        number(row.get("shape_dist_traveled", "")),
                    )
                )
        for shape in shapes.values():
            shape.sort()
            if len(shape) != len({p[0] for p in shape}):
                raise ValueError("Duplicate shape_pt_sequence")
        times = defaultdict(list)
        for row in a.rows(
            "stop_times.txt",
            ("trip_id", "stop_id", "stop_sequence", "arrival_time", "departure_time"),
        ):
            if row["trip_id"] in selected:
                times[row["trip_id"]].append(row)
        for trip_id, trip in selected.items():
            rows = sorted(times[trip_id], key=lambda r: int(r["stop_sequence"]))
            if len(rows) != len({int(r["stop_sequence"]) for r in rows}):
                raise ValueError("Duplicate stop_sequence")
            if len(rows) < 2:
                excluded["trip_without_stop_pairs"] += 1
                continue
            shape = shapes.get(trip.get("shape_id"))
            if not shape:
                excluded["missing_shape"] += 1
                continue
            key = (
                trip.get("shape_id"),
                tuple((r["stop_id"], r.get("shape_dist_traveled")) for r in rows),
            )
            if key not in geometry_cache:
                geometry_cache[key] = geometries(shape, rows, stops, excluded)
            for left, right, geometry in zip(rows, rows[1:], geometry_cache[key]):
                excluded["candidate_pairs"] += 1
                if not in_area(stops[left["stop_id"]]["point"]) or not in_area(
                    stops[right["stop_id"]]["point"]
                ):
                    excluded["outside_study_area"] += 1
                    continue
                if not geometry:
                    excluded["missing_geometry_pair"] += 1
                    continue
                start, end = seconds(left["departure_time"]), seconds(
                    right["arrival_time"]
                )
                if start is None or end is None:
                    excluded["missing_time"] += 1
                    continue
                duration = end - start
                if duration <= 0:
                    excluded["nonpositive_time"] += 1
                    continue
                coords, length = geometry
                if length / duration * 3.6 > 150:
                    excluded["implausible_speed_above_150_kmh"] += 1
                    continue
                geometry_id = hashlib.sha256(safe_json(coords).encode()).hexdigest()[
                    :12
                ]
                key = (
                    trip["route_id"],
                    trip.get("direction_id", ""),
                    left["stop_id"],
                    right["stop_id"],
                    geometry_id,
                )
                if key not in segments:
                    route = routes[trip["route_id"]]
                    segments[key] = {
                        "id": hashlib.sha256(safe_json(key).encode()).hexdigest()[:16],
                        "route": route.get("route_short_name") or trip["route_id"],
                        "routeName": route.get("route_long_name", ""),
                        "direction": trip.get("direction_id", ""),
                        "fromId": left["stop_id"],
                        "toId": right["stop_id"],
                        "from": stops[left["stop_id"]]["stop_name"],
                        "to": stops[right["stop_id"]]["stop_name"],
                        "metres": round(length, 2),
                        "coordinates": [[round(x, 6), round(y, 6)] for x, y in coords],
                        "bands": defaultdict(list),
                        "estimated": 0,
                    }
                segment = segments[key]
                for band, (lo, hi) in BANDS.items():
                    if lo <= start < hi:
                        segment["bands"][band].append(duration)
                if left.get("timepoint") == "0" or right.get("timepoint") == "0":
                    segment["estimated"] += 1
                excluded["accepted_pairs"] += 1
                accepted_trips.add(trip_id)
                accepted_routes.add(trip["route_id"])
    for segment in segments.values():
        segment["bands"] = {
            band: {
                "samples": len(values),
                "seconds": statistics.median(values),
                "kmh": round(segment["metres"] / statistics.median(values) * 3.6, 3),
            }
            for band, values in segment["bands"].items()
        }
    result["segments"] = sorted(segments.values(), key=lambda s: s["id"])
    used_stops = {
        sid
        for segment in segments.values()
        for sid in (segment["fromId"], segment["toId"])
    }
    result["stops"] = [
        {"id": sid, "name": stops[sid]["stop_name"], "point": list(stops[sid]["point"])}
        for sid in sorted(used_stops)
    ]
    result["exclusions"] = dict(excluded)
    result["coverage"]["geometryPatterns"] = len(geometry_cache)
    result["coverage"]["segments"] = len(segments)
    result["coverage"]["analyzedScheduledTrips"] = len(accepted_trips)
    result["coverage"]["analyzedRoutes"] = len(accepted_routes)
    result["status"] = "ready" if segments else "no-comparable-segments"
    return result


def write_viewer(payload, output, standalone=False):
    here = Path(__file__).parent
    manifest = {k: v for k, v in payload.items() if k != "cities"}
    manifest["cities"] = []
    blocks = []
    for city in payload["cities"]:
        if not re.fullmatch(r"[a-z][a-z0-9-]{0,31}", city["id"]):
            raise ValueError("Invalid city identifier")
        raw = safe_json(city).encode()
        if len(raw) > 64 * 1024**2:
            raise ValueError("Expanded city byte budget exceeded")
        compressed = gzip.compress(raw, mtime=0)
        if len(compressed) > 16 * 1024**2:
            raise ValueError("Compressed city byte budget exceeded")
        entry = {
            k: city.get(k) for k in ["id", "name", "mode", "status", "serviceDate"]
        }
        if standalone:
            encoded = base64.b64encode(compressed).decode()
            blocks.append(
                '<script type="application/octet-stream" id="city-'
                + city["id"]
                + '">'
                + encoded
                + "</script>"
            )
        else:
            digest = hashlib.sha256(compressed).hexdigest()
            relative = "cities/" + city["id"] + "-" + digest + ".json.gz"
            (output / "cities").mkdir(parents=True, exist_ok=True)
            (output / relative).write_bytes(compressed)
            entry["asset"] = {
                "path": relative,
                "sha256": digest,
                "bytes": len(compressed),
            }
        manifest["cities"].append(entry)
    html = (here / "viewer.html").read_text()
    if not standalone:
        html = html.replace("connect-src 'none'", "connect-src 'self'")
    html = html.replace("/*__GTFS_MANIFEST__*/", safe_json(manifest)).replace(
        "<!--__GTFS_CITIES__-->", "\n".join(blocks)
    )
    modules = []
    for name in [
        "camera.mjs",
        "explorer.mjs",
        "view-state.mjs",
        "renderer.mjs",
        "viewer.js",
    ]:
        code = (here / name).read_text()
        code = re.sub(r"^import\s[\s\S]*?;\n", "", code, flags=re.MULTILINE)
        code = re.sub(r"^export\s+", "", code, flags=re.MULTILINE)
        modules.append(code)
    html = html.replace(
        "/*__GTFS_STYLE__*/", (here / "viewer.css").read_text()
    ).replace("/*__GTFS_VIEWER__*/", "\n".join(modules))
    (output / "index.html").write_text(html)


def parse_city_dates(values, known):
    result = {}
    for value in values:
        city, separator, day = value.partition("=")
        if not separator or city not in known or city in result:
            raise ValueError("Unknown or duplicate explicit city date: " + city)
        result[city] = date.fromisoformat(day)
    return result


def main():
    p = argparse.ArgumentParser(description=__doc__)
    p.add_argument("--cache", type=Path, required=True)
    p.add_argument("--date", type=date.fromisoformat, required=True)
    p.add_argument("--output", type=Path, required=True)
    p.add_argument("--basemap-cache", type=Path)
    p.add_argument(
        "--standalone",
        action="store_true",
        help="Embed all city bundles for offline file use",
    )
    p.add_argument(
        "--city-date",
        action="append",
        default=[],
        help="Explicit reference date override, CITY=YYYY-MM-DD; never inferred",
    )
    args = p.parse_args()
    here = Path(__file__).parent
    sources = json.loads((here / "feeds.json").read_text())
    city_dates = parse_city_dates(args.city_date, {s["id"] for s in sources})
    cities = []
    for source in sources:
        archive = args.cache / (source["id"] + ".zip")
        receipt = args.cache / (source["id"] + ".receipt.json")
        if not archive.exists() or not receipt.exists():
            raise ValueError("Missing acquired feed/receipt: " + source["id"])
        city = analyze_feed(
            archive,
            city_dates.get(source["id"], args.date),
            json.loads(receipt.read_text()),
            source,
        )
        if args.basemap_cache:
            from basemap import load_map

            city["basemap"] = load_map(source, args.basemap_cache)
        cities.append(city)
        print(
            source["id"],
            city["status"],
            city["coverage"],
            city["exclusions"],
            flush=True,
        )
    payload = {
        "schemaVersion": 3,
        "metric": "scheduled-segment-travel-time",
        "method": "median of scheduled adjacent-stop arrival minus departure; distance along GTFS shape; no dwell; no realtime",
        "cities": cities,
    }
    args.output.mkdir(parents=True, exist_ok=True)
    (args.output / "analysis.json").write_text(safe_json(payload))
    write_viewer(payload, args.output, standalone=args.standalone)
    print("Wrote", args.output / "index.html", flush=True)


if __name__ == "__main__":
    main()
