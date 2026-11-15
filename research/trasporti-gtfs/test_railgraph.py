"""Rail geometry derived from OSM tracks: routed, bounded, never a straight line."""

import json
import tempfile
import unittest
from collections import Counter
from pathlib import Path

from analyze import metres
from railgraph import RailRouter, load_tracks, parse_tracks

# ~0.009° latitude ≈ 1 km. Two stations 2 km apart on a straight main line,
# with a much longer loop alternative and an unconnected spur.
MAIN = [[9.0, 45.0], [9.0, 45.009], [9.0, 45.018]]
LOOP = [[9.0, 45.0], [9.02, 45.004], [9.02, 45.014], [9.0, 45.018]]
SPUR = [[9.1, 45.0], [9.1, 45.009]]


def way(i, coords, **tags):
    return {
        "type": "way",
        "id": i,
        "tags": {"railway": "rail", **tags},
        "geometry": [{"lon": x, "lat": y} for x, y in coords],
    }


class RouterTests(unittest.TestCase):
    def setUp(self):
        self.tracks = parse_tracks(
            {"elements": [way(1, MAIN), way(2, LOOP), way(3, SPUR)]}
        )

    def test_follows_shortest_track_between_snapped_stations(self):
        router = RailRouter(self.tracks)
        excluded = Counter()
        # Stations sit ~40 m beside the track, as platforms often do.
        result = router.route([9.0005, 45.0], [9.0005, 45.018], excluded)
        self.assertIsNotNone(result)
        coords, length = result
        self.assertTrue(all(abs(x - 9.0) < 1e-9 for x, _ in coords))
        self.assertAlmostEqual(length, metres(MAIN[0], MAIN[-1]), delta=5)
        self.assertEqual(excluded["osm_rail_routed"], 1)

    def test_far_station_is_not_snapped(self):
        router = RailRouter(self.tracks)
        excluded = Counter()
        self.assertIsNone(router.route([9.05, 45.0], [9.0, 45.018], excluded))
        self.assertEqual(excluded["osm_rail_station_off_track"], 1)

    def test_disconnected_tracks_give_no_geometry(self):
        router = RailRouter(self.tracks)
        excluded = Counter()
        self.assertIsNone(router.route([9.1, 45.0], [9.0, 45.018], excluded))
        self.assertEqual(excluded["osm_rail_no_path"], 1)

    def test_implausible_detour_is_rejected(self):
        # Only the loop exists: path ≈ 4.6 km for 2 km apart.
        router = RailRouter(parse_tracks({"elements": [way(2, LOOP)]}))
        excluded = Counter()
        self.assertIsNone(router.route(LOOP[0], LOOP[-1], excluded))
        self.assertEqual(excluded["osm_rail_detour"], 1)

    def test_sidings_are_avoided_when_main_line_exists(self):
        tracks = parse_tracks(
            {
                "elements": [
                    way(1, LOOP),
                    way(2, MAIN, service="siding"),
                ]
            }
        )
        coords, _ = RailRouter(tracks, max_detour=3).route(
            MAIN[0], MAIN[-1], Counter()
        )
        self.assertTrue(any(x > 9.01 for x, _ in coords))

    def test_parse_rejects_partial_or_non_rail_data(self):
        with self.assertRaises(ValueError):
            parse_tracks({"remark": "runtime error", "elements": []})
        with self.assertRaises(ValueError):
            parse_tracks({"elements": [way(1, [[9, 45]])]})
        tracks = parse_tracks(
            {
                "elements": [
                    way(1, MAIN),
                    {**way(2, SPUR), "tags": {"highway": "primary"}},
                ]
            }
        )
        self.assertEqual(len(tracks), 1)

    def test_load_verifies_receipt(self):
        raw = json.dumps({"elements": [way(1, MAIN)]}).encode()
        source = {"id": "x", "railId": "x", "railBounds": [8.9, 44.9, 9.2, 45.1]}
        with tempfile.TemporaryDirectory() as folder:
            cache = Path(folder)
            (cache / "x.rail.json").write_bytes(raw)
            import hashlib

            receipt = {
                "sha256": hashlib.sha256(raw).hexdigest(),
                "bytes": len(raw),
                "bounds": source["railBounds"],
                "endpoint": "https://overpass-api.de/api/interpreter",
            }
            (cache / "x.rail.receipt.json").write_text(json.dumps(receipt))
            self.assertEqual(len(load_tracks(source, cache)), 1)
            (cache / "x.rail.json").write_bytes(raw + b" ")
            with self.assertRaises(ValueError):
                load_tracks(source, cache)


if __name__ == "__main__":
    unittest.main()
