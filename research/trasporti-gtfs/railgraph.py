#!/usr/bin/env python3
"""Rail geometry for GTFS feeds without shapes, routed on OSM tracks offline.

A pair of consecutive stations gets a geometry only if both snap to a track
within SNAP_METRES and the shortest track path is plausible. Otherwise the
pair stays without geometry and is counted: no straight line is ever drawn.
"""
import argparse
import hashlib
import heapq
import json
import math
import tempfile
import time
from collections import defaultdict
from datetime import datetime, timezone
from pathlib import Path

from analyze import metres
from basemap import ENDPOINT, ENDPOINTS, MAX_BYTES, coordinate, curl_response, simplify
from source_ids import archive_id

SNAP_METRES = 300
SIDING_WEIGHT = 3
RAIL_KINDS = {"rail", "narrow_gauge", "light_rail"}


def query_for(bounds):
    west, south, east, north = bounds
    bbox = f"{south},{west},{north},{east}"
    return f"""[out:json][timeout:180][maxsize:268435456];(
way["railway"~"^(rail|narrow_gauge|light_rail)$"]({bbox});
);out body geom;"""


def parse_tracks(data):
    if data.get("remark"):
        raise ValueError("Overpass partial response / remark: " + str(data["remark"]))
    if not isinstance(data.get("elements"), list):
        raise ValueError("Missing OSM elements")
    tracks, seen = [], set()
    for item in data["elements"]:
        key = (item.get("type"), item.get("id"))
        if key in seen:
            raise ValueError("OSM duplicate element")
        seen.add(key)
        tags = item.get("tags", {})
        if item.get("type") != "way" or tags.get("railway") not in RAIL_KINDS:
            continue
        geometry = item.get("geometry")
        if not isinstance(geometry, list) or len(geometry) < 2:
            raise ValueError("Missing OSM geometry")
        tracks.append(
            {
                "coordinates": [coordinate(p) for p in geometry],
                # Yards and sidings connect platforms but are not running lines.
                "secondary": bool(tags.get("service")),
            }
        )
    if not tracks:
        raise ValueError("No railway tracks in extract")
    return tracks


class RailRouter:
    def __init__(self, tracks, max_detour=1.6, slack_metres=300):
        self.max_detour = max_detour
        self.slack = slack_metres
        self.nodes = {}
        self.points = []
        self.edges = defaultdict(list)
        for track in tracks:
            ids = [self._node(p) for p in track["coordinates"]]
            weight = SIDING_WEIGHT if track["secondary"] else 1
            for a, b in zip(ids, ids[1:]):
                if a == b:
                    continue
                length = metres(self.points[a], self.points[b])
                self.edges[a].append((b, length, weight))
                self.edges[b].append((a, length, weight))
        # ~1 km grid cells for snapping.
        self.grid = defaultdict(list)
        for i, (x, y) in enumerate(self.points):
            self.grid[(math.floor(x * 80), math.floor(y * 110))].append(i)

    def _node(self, point):
        key = (round(point[0], 6), round(point[1], 6))
        if key not in self.nodes:
            self.nodes[key] = len(self.points)
            self.points.append(key)
        return self.nodes[key]

    def _near(self, point):
        cx, cy = math.floor(point[0] * 80), math.floor(point[1] * 110)
        found = []
        for dx in (-1, 0, 1):
            for dy in (-1, 0, 1):
                for i in self.grid.get((cx + dx, cy + dy), ()):
                    d = metres(point, self.points[i])
                    if d <= SNAP_METRES:
                        found.append((d, i))
        return sorted(found)[:12]

    def route(self, a, b, excluded):
        starts, ends = self._near(a), self._near(b)
        if not starts or not ends:
            excluded["osm_rail_station_off_track"] += 1
            return None
        straight = metres(a, b)
        limit = straight * self.max_detour + self.slack
        goal = {i: d for d, i in ends}
        # Cost = weighted length; real length is tracked separately for output.
        queue = [(d, d, i) for d, i in starts]
        best = {i: d for d, i in starts}
        previous = {}
        found = None
        while queue:
            cost, length, node = heapq.heappop(queue)
            if cost > best.get(node, math.inf):
                continue
            if cost > limit * SIDING_WEIGHT:
                break
            if node in goal:
                found = (node, length + goal[node])
                break
            for nxt, step, weight in self.edges[node]:
                c = cost + step * weight
                if c < best.get(nxt, math.inf):
                    best[nxt] = c
                    previous[nxt] = node
                    heapq.heappush(queue, (c, length + step, nxt))
        if not found:
            excluded["osm_rail_no_path"] += 1
            return None
        node, length = found
        if length > limit:
            excluded["osm_rail_detour"] += 1
            return None
        path = [node]
        while path[-1] in previous:
            path.append(previous[path[-1]])
        coords = [list(self.points[i]) for i in reversed(path)]
        if len(coords) < 2:
            excluded["osm_rail_no_path"] += 1
            return None
        coords = simplify(coords, tolerance=4)
        track_length = sum(metres(p, q) for p, q in zip(coords, coords[1:]))
        excluded["osm_rail_routed"] += 1
        return coords, track_length


def rail_paths(source, cache):
    stem = archive_id(source, "railId")
    return cache / (stem + ".rail.json"), cache / (stem + ".rail.receipt.json")


def load_tracks(source, cache):
    path, receipt_path = rail_paths(source, cache)
    raw = path.read_bytes()
    receipt = json.loads(receipt_path.read_text())
    if hashlib.sha256(raw).hexdigest() != receipt["sha256"] or len(raw) != receipt["bytes"]:
        raise ValueError("Rail extract SHA-256/bytes mismatch")
    if receipt["bounds"] != source["railBounds"] or receipt["endpoint"] not in ENDPOINTS:
        raise ValueError("Rail extract perimeter/source mismatch")
    return parse_tracks(json.loads(raw))


def acquire_tracks(source, cache, endpoint=ENDPOINT):
    path, receipt_path = rail_paths(source, cache)
    if path.exists() and receipt_path.exists():
        return {"city": source["id"], "cached": True, "tracks": len(load_tracks(source, cache))}
    query = query_for(source["railBounds"])
    raw = curl_response(endpoint, query)
    if len(raw) > MAX_BYTES:
        raise ValueError("OSM expanded byte budget exceeded")
    parsed = json.loads(raw)
    tracks = parse_tracks(parsed)
    receipt = {
        "endpoint": endpoint,
        "bounds": source["railBounds"],
        "acquiredAt": datetime.now(timezone.utc).isoformat(),
        "osmBaseAt": parsed.get("osm3s", {}).get("timestamp_osm_base"),
        "sha256": hashlib.sha256(raw).hexdigest(),
        "bytes": len(raw),
        "query": query,
    }
    with tempfile.NamedTemporaryFile(dir=cache, delete=False, suffix=".partial") as tmp:
        tmp.write(raw)
    Path(tmp.name).replace(path)
    receipt_path.write_text(json.dumps(receipt, indent=2))
    return {"city": source["id"], "cached": False, "tracks": len(tracks), "bytes": len(raw)}


def main():
    p = argparse.ArgumentParser(description=__doc__)
    p.add_argument("--cache", type=Path, required=True)
    p.add_argument("--city")
    p.add_argument("--endpoint", choices=ENDPOINTS, default=ENDPOINT)
    args = p.parse_args()
    sources = json.loads((Path(__file__).parent / "feeds.json").read_text())
    done = set()
    for source in sources:
        if "railBounds" not in source or (args.city and source["id"] != args.city):
            continue
        key = archive_id(source, "railId")
        if key in done:
            continue
        done.add(key)
        result = acquire_tracks(source, args.cache, args.endpoint)
        print(json.dumps(result), flush=True)
        if not result["cached"]:
            time.sleep(2)


if __name__ == "__main__":
    main()
