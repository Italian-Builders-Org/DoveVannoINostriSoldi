#!/usr/bin/env python3
"""Build the static network asset used by /mappe/mobilita/roma.

Input: the official Roma Mobilità static GTFS ZIP (acquired offline, never at
request time). Output:

- public/mappe/mobilita/roma/network-<sha12>.json: routes, one pattern per
  distinct shape (headsign, ordered stops, simplified polyline) and stops;
- src/lib/mobilita/roma-network-asset.ts: path, hash, size and the receipt of
  the GTFS bytes it was derived from.

The live feed references trip_id/route_id/stop_id of the same publisher; the
client matches a vehicle to a pattern by route, direction and current stop, so
trip ids (171k rows) are not shipped.

Usage:
  python3 scripts/research/build_roma_live_network.py --gtfs PATH.zip \
      [--acquired-at ISO] [--last-modified HTTP-DATE]
  python3 scripts/research/build_roma_live_network.py --check
"""

from __future__ import annotations

import argparse
import csv
import datetime
import hashlib
import io
import json
import math
import re
import sys
import zipfile
from collections import Counter, defaultdict
from pathlib import Path

ROOT = Path(__file__).resolve().parents[2]
PUBLIC_DIR = ROOT / "public/mappe/mobilita/roma"
MANIFEST_TS = ROOT / "src/lib/mobilita/roma-network-asset.ts"
SOURCE_URL = "https://romamobilita.it/sites/default/files/rome_static_gtfs.zip"
LANDING_URL = "https://romamobilita.it/sistemi-e-tecnologie/open-data/"
SCHEMA = 1
SIMPLIFY_METRES = 5.0
MAX_ZIP_BYTES = 256 * 1024 * 1024
MAX_MEMBER_BYTES = 1024 * 1024 * 1024
REQUIRED = ("agency.txt", "routes.txt", "trips.txt", "stops.txt", "stop_times.txt", "shapes.txt")
COLOR = re.compile(r"^[0-9A-Fa-f]{6}$")


def fail(message: str) -> None:
    raise SystemExit(f"build_roma_live_network: {message}")


def rows(archive: zipfile.ZipFile, name: str):
    info = archive.getinfo(name)
    if info.file_size > MAX_MEMBER_BYTES:
        fail(f"{name} exceeds expanded budget")
    with archive.open(info) as raw:
        yield from csv.DictReader(io.TextIOWrapper(raw, encoding="utf-8-sig", newline=""))


def metres(a, b) -> float:
    lat = math.radians((a[1] + b[1]) / 2)
    dx = (b[0] - a[0]) * 111_320 * math.cos(lat)
    dy = (b[1] - a[1]) * 110_540
    return math.hypot(dx, dy)


def simplify(points, tolerance):
    """Iterative Douglas-Peucker on a local equirectangular plane (metres)."""
    if len(points) < 3:
        return points
    lat0 = math.radians(points[0][1])
    xy = [(p[0] * 111_320 * math.cos(lat0), p[1] * 110_540) for p in points]
    keep = [False] * len(points)
    keep[0] = keep[-1] = True
    stack = [(0, len(points) - 1)]
    while stack:
        start, end = stack.pop()
        ax, ay = xy[start]
        bx, by = xy[end]
        dx, dy = bx - ax, by - ay
        length = dx * dx + dy * dy
        best, index = -1.0, -1
        for i in range(start + 1, end):
            px, py = xy[i]
            if length == 0:
                d = math.hypot(px - ax, py - ay)
            else:
                t = max(0.0, min(1.0, ((px - ax) * dx + (py - ay) * dy) / length))
                d = math.hypot(px - (ax + t * dx), py - (ay + t * dy))
            if d > best:
                best, index = d, i
        if best > tolerance:
            keep[index] = True
            stack.append((start, index))
            stack.append((index, end))
    return [p for p, k in zip(points, keep) if k]


def encode_polyline(points) -> str:
    """Google encoded polyline, precision 1e5, (lat, lon) order."""
    out = []
    prev_lat = prev_lon = 0
    for lon, lat in points:
        ilat, ilon = round(lat * 1e5), round(lon * 1e5)
        for delta in (ilat - prev_lat, ilon - prev_lon):
            value = ~(delta << 1) if delta < 0 else delta << 1
            while value >= 0x20:
                out.append(chr((0x20 | (value & 0x1F)) + 63))
                value >>= 5
            out.append(chr(value + 63))
        prev_lat, prev_lon = ilat, ilon
    return "".join(out)


BIN_MINUTES = 10
BINS = 180  # 0..30h of the service day: trips after midnight stay on their date
BASE62 = "0123456789abcdefghijklmnopqrstuvwxyzABCDEFGHIJKLMNOPQRSTUVWXYZ"


def gtfs_seconds(value: str) -> int | None:
    """HH:MM:SS that may exceed 24:00; never reduced modulo 24."""
    parts = value.strip().split(":")
    if len(parts) != 3 or not all(p.isdigit() for p in parts):
        return None
    hours, minutes, seconds = (int(p) for p in parts)
    if minutes > 59 or seconds > 59:
        return None
    return hours * 3600 + minutes * 60 + seconds


def build_coverage(trip_service, spans, service_dates) -> dict:
    """Scheduled trips in progress per route, per 10-minute bin midpoint."""
    per_pair: dict[tuple[str, str], list[int]] = {}
    for trip_id, (route_id, service_id) in trip_service.items():
        span = spans.get(trip_id)
        if not span or span[1] <= span[0]:
            continue
        bins = per_pair.setdefault((route_id, service_id), [0] * BINS)
        for b in range(BINS):
            midpoint = (b * BIN_MINUTES + BIN_MINUTES / 2) * 60
            if span[0] <= midpoint < span[1]:
                bins[b] += 1
    by_service: dict[str, list[tuple[str, list[int]]]] = defaultdict(list)
    for (route_id, service_id), bins in per_pair.items():
        by_service[service_id].append((route_id, bins))
    profiles: list[dict[str, str]] = []
    profile_index: dict[str, int] = {}
    dates: dict[str, int] = {}
    for date in sorted(service_dates):
        totals: dict[str, list[int]] = {}
        for service_id in service_dates[date]:
            for route_id, bins in by_service.get(service_id, []):
                acc = totals.setdefault(route_id, [0] * BINS)
                for b in range(BINS):
                    acc[b] += bins[b]
        encoded = {}
        for route_id in sorted(totals):
            values = totals[route_id]
            if max(values) >= len(BASE62):
                fail(f"coverage overflow for route {route_id} on {date}")
            if any(values):
                encoded[route_id] = "".join(BASE62[v] for v in values)
        key = json.dumps(encoded, sort_keys=True)
        if key not in profile_index:
            profile_index[key] = len(profiles)
            profiles.append(encoded)
        dates[date] = profile_index[key]
    return {
        "schema": 1,
        "binMinutes": BIN_MINUTES,
        "bins": BINS,
        "timezone": "Europe/Rome",
        "dates": dates,
        "profiles": profiles,
    }


def build(gtfs: Path, acquired_at: str | None, last_modified: str | None) -> dict:
    raw = gtfs.read_bytes()
    if len(raw) > MAX_ZIP_BYTES:
        fail("ZIP exceeds compressed budget")
    digest = hashlib.sha256(raw).hexdigest()
    with zipfile.ZipFile(io.BytesIO(raw)) as archive:
        names = archive.namelist()
        if len(names) != len(set(names)):
            fail("duplicate ZIP members")
        missing = [name for name in REQUIRED if name not in names]
        if missing:
            fail(f"missing members: {missing}")

        agencies = {row["agency_id"]: row["agency_name"].strip() for row in rows(archive, "agency.txt")}
        routes = {}
        for row in rows(archive, "routes.txt"):
            color = row.get("route_color", "").strip()
            routes[row["route_id"]] = {
                "id": row["route_id"],
                "short": (row.get("route_short_name") or row["route_id"]).strip(),
                "long": (row.get("route_long_name") or "").strip(),
                "type": int(row["route_type"]) if row["route_type"].strip().isdigit() else 3,
                "color": color.upper() if COLOR.match(color) else "",
                "agency": row.get("agency_id", "").strip(),
            }

        # One representative trip per (route, direction, shape, headsign).
        patterns: dict[tuple, dict] = {}
        trip_pattern: dict[str, tuple] = {}
        trip_service: dict[str, tuple[str, str]] = {}
        for row in rows(archive, "trips.txt"):
            route_id = row["route_id"]
            if route_id in routes:
                trip_service[row["trip_id"]] = (route_id, row["service_id"])
            if route_id not in routes or not row.get("shape_id"):
                continue
            direction = row.get("direction_id", "").strip()
            key = (route_id, int(direction) if direction in ("0", "1") else -1, row["shape_id"], row.get("trip_headsign", "").strip())
            entry = patterns.get(key)
            if entry is None:
                patterns[key] = {"trip": row["trip_id"], "trips": 1}
                trip_pattern[row["trip_id"]] = key
            else:
                entry["trips"] += 1

        sequences: dict[str, list[tuple[int, str]]] = defaultdict(list)
        spans: dict[str, list[int]] = {}
        for row in rows(archive, "stop_times.txt"):
            trip_id = row["trip_id"]
            if trip_id in trip_service:
                for column in ("arrival_time", "departure_time"):
                    seconds = gtfs_seconds(row.get(column, ""))
                    if seconds is None:
                        continue
                    span = spans.get(trip_id)
                    if span is None:
                        spans[trip_id] = [seconds, seconds]
                    else:
                        span[0] = min(span[0], seconds)
                        span[1] = max(span[1], seconds)
            if row["trip_id"] in trip_pattern:
                try:
                    sequences[row["trip_id"]].append((int(row["stop_sequence"]), row["stop_id"]))
                except ValueError:
                    fail(f"invalid stop_sequence in trip {row['trip_id']}")

        wanted_shapes = {key[2] for key in patterns}
        shape_points: dict[str, list[tuple[int, float, float]]] = defaultdict(list)
        for row in rows(archive, "shapes.txt"):
            if row["shape_id"] in wanted_shapes:
                shape_points[row["shape_id"]].append(
                    (int(row["shape_pt_sequence"]), float(row["shape_pt_lon"]), float(row["shape_pt_lat"]))
                )

        service_dates: dict[str, set[str]] = defaultdict(set)
        if "calendar.txt" in names:
            fail("calendar.txt not supported: Roma publishes calendar_dates only")
        for row in rows(archive, "calendar_dates.txt"):
            if row["exception_type"].strip() == "1":
                date = row["date"].strip()
                service_dates[f"{date[:4]}-{date[4:6]}-{date[6:]}"].add(row["service_id"])

        stops_all = {}
        for row in rows(archive, "stops.txt"):
            try:
                stops_all[row["stop_id"]] = (row["stop_name"].strip(), float(row["stop_lon"]), float(row["stop_lat"]))
            except ValueError:
                continue

    route_ids = sorted(routes, key=lambda r: (routes[r]["type"], len(routes[r]["short"]), routes[r]["short"]))
    route_index = {route_id: i for i, route_id in enumerate(route_ids)}
    stop_ids: list[str] = []
    stop_index: dict[str, int] = {}
    out_patterns = []
    dropped = Counter()
    point_count = 0
    for key in sorted(patterns, key=lambda k: (route_index[k[0]], k[1], -patterns[k]["trips"], k[2])):
        route_id, direction, shape_id, headsign = key
        trip = patterns[key]["trip"]
        sequence = sorted(sequences.get(trip, []))
        if len({s for s, _ in sequence}) != len(sequence):
            dropped["duplicate_stop_sequence"] += 1
            continue
        stop_list = [stop_id for _, stop_id in sequence if stop_id in stops_all]
        points = [(lon, lat) for _, lon, lat in sorted(shape_points.get(shape_id, []))]
        if len(points) < 2 or len(stop_list) < 2:
            dropped["missing_geometry_or_stops"] += 1
            continue
        for stop_id in stop_list:
            if stop_id not in stop_index:
                stop_index[stop_id] = len(stop_ids)
                stop_ids.append(stop_id)
        simplified = simplify(points, SIMPLIFY_METRES)
        point_count += len(simplified)
        out_patterns.append(
            [
                route_index[route_id],
                direction,
                headsign,
                [stop_index[s] for s in stop_list],
                encode_polyline(simplified),
                patterns[key]["trips"],
            ]
        )

    used_agencies = sorted({routes[r]["agency"] for r in route_ids if routes[r]["agency"] in agencies})
    payload = {
        "schema": SCHEMA,
        "source": {
            "holder": "Roma Servizi per la Mobilità",
            "url": SOURCE_URL,
            "landingUrl": LANDING_URL,
            "sha256": digest,
            "bytes": len(raw),
            "acquiredAt": acquired_at,
            "lastModified": last_modified,
        },
        "agencies": {agency: agencies[agency] for agency in used_agencies},
        "routes": [
            [routes[r]["id"], routes[r]["short"], routes[r]["type"], routes[r]["color"], routes[r]["agency"], routes[r]["long"]]
            for r in route_ids
        ],
        "stops": [
            [stop_id, stops_all[stop_id][0], round(stops_all[stop_id][1], 6), round(stops_all[stop_id][2], 6)]
            for stop_id in stop_ids
        ],
        "patterns": out_patterns,
        "dropped": dict(dropped),
    }
    payload["_coverage"] = build_coverage(trip_service, spans, service_dates)
    print(
        f"routes={len(route_ids)} patterns={len(out_patterns)} stops={len(stop_ids)} "
        f"points={point_count} dropped={dict(dropped)}",
        file=sys.stderr,
    )
    return payload


def write_hashed(prefix: str, data: dict) -> tuple[str, str, int]:
    body = json.dumps(data, ensure_ascii=False, separators=(",", ":")).encode("utf-8")
    sha = hashlib.sha256(body).hexdigest()
    name = f"{prefix}-{sha[:12]}.json"
    PUBLIC_DIR.mkdir(parents=True, exist_ok=True)
    for old in PUBLIC_DIR.glob(f"{prefix}-*.json"):
        if old.name != name:
            old.unlink()
    (PUBLIC_DIR / name).write_bytes(body)
    print(f"wrote {PUBLIC_DIR / name} ({len(body)} bytes)", file=sys.stderr)
    return f"/mappe/mobilita/roma/{name}", sha, len(body)


def write(payload: dict) -> None:
    coverage = payload.pop("_coverage")
    path, sha, size = write_hashed("network", payload)
    source = payload["source"]
    # Dates before the acquisition are never "today" for a visitor.
    acquired = (source.get("acquiredAt") or "")[:10]
    first_kept = (
        (datetime.date.fromisoformat(acquired) - datetime.timedelta(days=1)).isoformat() if acquired else ""
    )
    profile_dir = PUBLIC_DIR / "coverage"
    profile_dir.mkdir(parents=True, exist_ok=True)
    written: dict[int, dict] = {}
    dates: dict[str, dict] = {}
    for date, index in sorted(coverage["dates"].items()):
        if date < first_kept:
            continue
        if index not in written:
            body = json.dumps(coverage["profiles"][index], separators=(",", ":"), sort_keys=True).encode("utf-8")
            psha = hashlib.sha256(body).hexdigest()
            (profile_dir / f"{psha[:12]}.json").write_bytes(body)
            written[index] = {"path": f"/mappe/mobilita/roma/coverage/{psha[:12]}.json", "sha256": psha, "bytes": len(body)}
        dates[date] = written[index]
    keep = {Path(entry["path"]).name for entry in written.values()}
    for old in profile_dir.glob("*.json"):
        if old.name not in keep:
            old.unlink()
    index_doc = {k: v for k, v in coverage.items() if k not in ("dates", "profiles")}
    index_doc["dates"] = dates
    cpath, csha, csize = write_hashed("coverage", index_doc)
    gtfs = {
        "url": source["url"],
        "sha256": source["sha256"],
        "bytes": source["bytes"],
        "acquiredAt": source["acquiredAt"],
        "lastModified": source["lastModified"],
    }
    manifest = {"path": path, "sha256": sha, "bytes": size, "schema": SCHEMA, "gtfs": gtfs}
    coverage_manifest = {
        "path": cpath,
        "sha256": csha,
        "bytes": csize,
        "schema": coverage["schema"],
        "firstDate": min(dates),
        "lastDate": max(dates),
        "gtfsSha256": source["sha256"],
    }
    print(f"coverage: {len(dates)} dates, {len(written)} profiles", file=sys.stderr)
    MANIFEST_TS.write_text(
        "// Generated by scripts/research/build_roma_live_network.py. Do not edit.\n"
        f"export const ROMA_NETWORK_ASSET = {json.dumps(manifest, indent=2, ensure_ascii=False)} as const;\n\n"
        f"export const ROMA_COVERAGE_ASSET = {json.dumps(coverage_manifest, indent=2, ensure_ascii=False)} as const;\n",
        encoding="utf-8",
    )


def check() -> None:
    text = MANIFEST_TS.read_text(encoding="utf-8")
    for prefix in ("network", "coverage"):
        block = text[text.index(f'"path": "/mappe/mobilita/roma/{prefix}-'):]
        match = re.search(r'"path": "(/mappe/mobilita/roma/' + prefix + r'-[0-9a-f]{12}\.json)"', block)
        sha = re.search(r'"sha256": "([0-9a-f]{64})"', block)
        size = re.search(r'"bytes": (\d+)', block)
        if not (match and sha and size):
            fail(f"{prefix} manifest unreadable")
        asset = (ROOT / "public" / match.group(1).lstrip("/")).read_bytes()
        if hashlib.sha256(asset).hexdigest() != sha.group(1) or len(asset) != int(size.group(1)):
            fail(f"{prefix} asset hash/size mismatch")
    cmatch = re.search(r'"path": "(/mappe/mobilita/roma/coverage-[0-9a-f]{12}\.json)"', text)
    index_doc = json.loads((ROOT / "public" / cmatch.group(1).lstrip("/")).read_bytes())
    for date, entry in index_doc["dates"].items():
        profile = (ROOT / "public" / entry["path"].lstrip("/")).read_bytes()
        if hashlib.sha256(profile).hexdigest() != entry["sha256"] or len(profile) != entry["bytes"]:
            fail(f"coverage profile mismatch for {date}")
    match = re.search(r'"path": "(/mappe/mobilita/roma/network-[0-9a-f]{12}\.json)"', text)
    body = (ROOT / "public" / match.group(1).lstrip("/")).read_bytes()
    payload = json.loads(body)
    if payload.get("schema") != SCHEMA:
        fail("schema mismatch")
    stops, routes = len(payload["stops"]), len(payload["routes"])
    for pattern in payload["patterns"]:
        if not (0 <= pattern[0] < routes) or any(not (0 <= s < stops) for s in pattern[3]):
            fail("pattern index out of range")
    print("ok", file=sys.stderr)


def main() -> None:
    parser = argparse.ArgumentParser()
    parser.add_argument("--gtfs", type=Path)
    parser.add_argument("--acquired-at")
    parser.add_argument("--last-modified")
    parser.add_argument("--check", action="store_true")
    args = parser.parse_args()
    if args.check:
        check()
        return
    if not args.gtfs:
        parser.error("--gtfs is required")
    write(build(args.gtfs, args.acquired_at, args.last_modified))


if __name__ == "__main__":
    main()
