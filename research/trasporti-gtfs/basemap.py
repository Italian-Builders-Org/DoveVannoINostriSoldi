#!/usr/bin/env python3
"""Bounded offline OSM extracts. No visitor request contacts Overpass or a tile service."""
import argparse
import gzip
import hashlib
import json
import math
import subprocess
import tempfile
import time
import urllib.parse
import urllib.request
from datetime import datetime, timezone
from pathlib import Path

from source_ids import archive_id

ENDPOINT = "https://overpass-api.de/api/interpreter"
ENDPOINTS = (
    ENDPOINT,
    "https://overpass.private.coffee/api/interpreter",
    "https://maps.mail.ru/osm/tools/overpass/api/interpreter",
)
MAX_BYTES = 64 * 1024 * 1024


def read_response(response, limit=MAX_BYTES):
    stream = (
        gzip.GzipFile(fileobj=response)
        if response.headers.get("Content-Encoding") == "gzip"
        else response
    )
    raw = stream.read(limit + 1)
    if len(raw) > limit:
        raise ValueError("OSM expanded byte budget exceeded")
    return raw


def curl_response(url, data=None):
    # HTTP/2 transport is useful where HTTP/1.1 chunked responses are interrupted.
    command = [
        "curl",
        "--fail",
        "--silent",
        "--show-error",
        "--compressed",
        "--proto",
        "=https",
        "--connect-timeout",
        "15",
        "--max-time",
        "200",
        "--header",
        "User-Agent: DVNS-GTFS-research/1.0",
        url,
    ]
    if data is not None:
        command[-1:-1] = ["--data-urlencode", "data=" + data]
    with subprocess.Popen(
        command, stdout=subprocess.PIPE, stderr=subprocess.PIPE
    ) as process:
        raw = process.stdout.read(MAX_BYTES + 1)
        if len(raw) > MAX_BYTES:
            process.kill()
            process.communicate()
            raise ValueError("OSM expanded byte budget exceeded")
        _, error = process.communicate()
        if process.returncode:
            raise ValueError(
                "OSM curl transport failed: " + error.decode(errors="replace").strip()
            )
        return raw


def coordinate(point):
    try:
        lon, lat = float(point["lon"]), float(point["lat"])
    except (KeyError, TypeError, ValueError) as error:
        raise ValueError("Invalid map coordinate") from error
    if (
        not math.isfinite(lon)
        or not math.isfinite(lat)
        or not -180 <= lon <= 180
        or not -85 <= lat <= 85
    ):
        raise ValueError("Invalid map coordinate")
    return [round(lon, 6), round(lat, 6)]


def simplify(points, tolerance=3):
    if len(points) < 3:
        return points
    scale = 111320 * math.cos(math.radians(points[0][1]))
    projected = [(p[0] * scale, p[1] * 111320) for p in points]
    keep = {0, len(points) - 1}
    stack = [(0, len(points) - 1)]
    while stack:
        start, end = stack.pop()
        a, b = projected[start], projected[end]
        dx, dy = b[0] - a[0], b[1] - a[1]
        den = dx * dx + dy * dy
        best = 0
        index = None
        for i in range(start + 1, end):
            p = projected[i]
            t = (
                max(0, min(1, ((p[0] - a[0]) * dx + (p[1] - a[1]) * dy) / den))
                if den
                else 0
            )
            dist = (p[0] - a[0] - t * dx) ** 2 + (p[1] - a[1] - t * dy) ** 2
            if dist > best:
                best, index = dist, i
        if best > tolerance * tolerance:
            keep.add(index)
            stack.extend([(start, index), (index, end)])
    return [points[i] for i in sorted(keep)]


def parse_map(data):
    if data.get("remark"):
        raise ValueError("Overpass partial response / remark: " + str(data["remark"]))
    if not isinstance(data.get("elements"), list):
        raise ValueError("Missing OSM elements")
    features = []
    labels = []
    seen = set()
    for item in data["elements"]:
        key = (item.get("type"), item.get("id"))
        if key in seen:
            raise ValueError("OSM duplicate element")
        seen.add(key)
        tags = item.get("tags", {})
        if item["type"] == "node" and tags.get("place") and tags.get("name"):
            labels.append(
                {
                    "name": tags["name"],
                    "class": tags["place"],
                    "point": coordinate(item),
                }
            )
            continue
        if item["type"] != "way":
            continue
        if tags.get("highway"):
            kind = "road"
        elif tags.get("natural") == "water" or tags.get("waterway"):
            kind = "water"
        elif tags.get("leisure") in {
            "park",
            "garden",
            "pitch",
            "nature_reserve",
        } or tags.get("landuse") in {"forest", "grass", "meadow", "recreation_ground"}:
            kind = "green"
        elif tags.get("landuse"):
            kind = "land"
        else:
            continue
        geometry = item.get("geometry")
        if not isinstance(geometry, list) or len(geometry) < 2:
            raise ValueError("Missing OSM geometry")
        points = [coordinate(p) for p in geometry]
        closed = points[0] == points[-1]
        reduced = simplify(points)
        if closed and len(reduced) < 4:
            reduced = points
        features.append(
            {
                "id": item["id"],
                "kind": kind,
                "class": tags.get(
                    "highway", tags.get("landuse", tags.get("waterway", ""))
                ),
                "name": tags.get("name", ""),
                "closed": closed,
                "coordinates": reduced,
            }
        )
    return {"features": features, "labels": labels}


PROFILES = ("urban", "overview", "national")


def query_for(bounds, profile="urban"):
    west, south, east, north = bounds
    bbox = f"{south},{west},{north},{east}"
    if profile not in PROFILES:
        raise ValueError("Invalid basemap profile")
    if profile == "national":
        # Country-wide context: motorways and cities only, or Overpass times out.
        return f"""[out:json][timeout:180][maxsize:134217728];(
way["highway"="motorway"]({bbox});
node["place"="city"]["name"]({bbox});
);out body geom;"""
    if profile == "overview":
        return f"""[out:json][timeout:35][maxsize:134217728];(
way["highway"~"^(motorway|trunk)(_link)?$"]({bbox});
node["place"~"^(city|town)$"]["name"]({bbox});
);out body geom;"""
    return f"""[out:json][timeout:35][maxsize:134217728];(
way["highway"~"^(motorway|trunk|primary|secondary|tertiary|residential|unclassified|living_street|pedestrian)(_link)?$"]({bbox});
way["natural"="water"]({bbox});way["waterway"~"^(river|canal)$"]({bbox});
way["leisure"~"^(park|garden|pitch|nature_reserve)$"]({bbox});
way["landuse"~"^(residential|industrial|commercial|retail|railway|forest|grass|meadow|recreation_ground)$"]({bbox});
node["place"~"^(city|town|suburb|quarter|neighbourhood)$"]["name"]({bbox});
);out body geom;"""


def load_map(source, cache):
    path = cache / (archive_id(source, "mapId") + ".osm.json")
    receipt_path = cache / (archive_id(source, "mapId") + ".osm.receipt.json")
    raw = path.read_bytes()
    receipt = json.loads(receipt_path.read_text())
    if (
        hashlib.sha256(raw).hexdigest() != receipt["sha256"]
        or len(raw) != receipt["bytes"]
    ):
        raise ValueError("Basemap SHA-256/bytes mismatch")
    if receipt["bounds"] != source["mapBounds"] or receipt["endpoint"] not in ENDPOINTS:
        raise ValueError("Basemap perimeter/source mismatch")
    profile = source.get("mapDetail", "urban")
    if (
        profile not in PROFILES
        or receipt.get("profile", "urban") != profile
    ):
        raise ValueError("Basemap profile mismatch")
    data = parse_map(json.loads(raw))
    if not any(f["kind"] == "road" for f in data["features"]):
        raise ValueError("No streets in basemap extract")
    return {
        **data,
        "receipt": receipt,
        "attribution": "© OpenStreetMap contributors",
        "license": "ODbL 1.0",
        "licenseUrl": "https://www.openstreetmap.org/copyright",
    }


def acquire_map(source, cache, endpoint=ENDPOINT, transport="urllib", method="POST"):
    path = cache / (archive_id(source, "mapId") + ".osm.json")
    receipt_path = cache / (archive_id(source, "mapId") + ".osm.receipt.json")
    if path.exists() and receipt_path.exists():
        data = load_map(source, cache)
        return {"city": source["id"], "cached": True, "features": len(data["features"])}
    query = query_for(source["mapBounds"], source.get("mapDetail", "urban"))
    request = urllib.request.Request(
        endpoint
        + ("?" + urllib.parse.urlencode({"data": query}) if method == "GET" else ""),
        data=(
            urllib.parse.urlencode({"data": query}).encode()
            if method == "POST"
            else None
        ),
        headers={"User-Agent": "DVNS-GTFS-research/1.0", "Accept-Encoding": "gzip"},
    )
    if transport == "curl":
        raw = curl_response(request.full_url, query if method == "POST" else None)
    else:
        with urllib.request.urlopen(request, timeout=200) as response:
            raw = read_response(response)
    parsed = json.loads(raw)
    data = parse_map(parsed)
    if not any(f["kind"] == "road" for f in data["features"]):
        raise ValueError("No streets in basemap extract")
    receipt = {
        "endpoint": endpoint,
        "transport": transport,
        "method": method,
        "bounds": source["mapBounds"],
        "acquiredAt": datetime.now(timezone.utc).isoformat(),
        "osmBaseAt": parsed.get("osm3s", {}).get("timestamp_osm_base"),
        "sha256": hashlib.sha256(raw).hexdigest(),
        "bytes": len(raw),
        "query": query,
        "profile": source.get("mapDetail", "urban"),
    }
    with tempfile.NamedTemporaryFile(
        dir=cache, delete=False, suffix=".partial"
    ) as temporary:
        temporary.write(raw)
        tmp = Path(temporary.name)
    tmp.replace(path)
    receipt_path.write_text(json.dumps(receipt, indent=2))
    return {
        "city": source["id"],
        "cached": False,
        "features": len(data["features"]),
        "labels": len(data["labels"]),
        "bytes": len(raw),
    }


def main():
    p = argparse.ArgumentParser(description=__doc__)
    p.add_argument("--cache", type=Path, required=True)
    p.add_argument("--city")
    p.add_argument("--endpoint", choices=ENDPOINTS, default=ENDPOINT)
    p.add_argument("--transport", choices=["urllib", "curl"], default="urllib")
    p.add_argument("--method", choices=["GET", "POST"], default="POST")
    args = p.parse_args()
    args.cache.mkdir(parents=True, exist_ok=True)
    sources = json.loads((Path(__file__).parent / "feeds.json").read_text())
    for source in sources:
        if args.city and source["id"] != args.city:
            continue
        result = acquire_map(
            source, args.cache, args.endpoint, args.transport, args.method
        )
        print(json.dumps(result), flush=True)
        if not result["cached"]:
            time.sleep(2)


if __name__ == "__main__":
    main()
