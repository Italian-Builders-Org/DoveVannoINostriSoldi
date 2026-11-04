"""Failure cases defined before the offline analyzer; synthetic ZIPs only."""

import csv
import hashlib
import io
import tempfile
import unittest
import zipfile
from datetime import date
from pathlib import Path

from analyze import (
    Archive,
    active_services,
    analyze_feed,
    seconds,
    safe_json,
    parse_city_dates,
)

SOURCE = {"id": "fixture", "name": "Fixture", "url": "https://example.invalid/gtfs.zip"}


def archive(root, changes=None):
    tables = {
        "agency.txt": [
            ["agency_id", "agency_name", "agency_url", "agency_timezone"],
            ["a", "Synthetic", "https://example.invalid", "Europe/Rome"],
        ],
        "routes.txt": [["route_id", "route_type", "route_short_name"], ["r", "0", "1"]],
        "trips.txt": [
            ["route_id", "service_id", "trip_id", "direction_id", "shape_id"],
            ["r", "s", "t", "0", "sh"],
        ],
        "stops.txt": [
            ["stop_id", "stop_name", "stop_lat", "stop_lon"],
            ["a", "A", "45", "9"],
            ["b", "B", "45", "9.001"],
            ["c", "C", "45", "9.002"],
        ],
        "shapes.txt": [
            [
                "shape_id",
                "shape_pt_lat",
                "shape_pt_lon",
                "shape_pt_sequence",
                "shape_dist_traveled",
            ],
            ["sh", "45", "9", "0", "0"],
            ["sh", "45", "9.001", "1", "1"],
            ["sh", "45", "9.002", "2", "2"],
        ],
        "stop_times.txt": [
            [
                "trip_id",
                "arrival_time",
                "departure_time",
                "stop_id",
                "stop_sequence",
                "shape_dist_traveled",
            ],
            ["t", "07:00:00", "07:00:00", "a", "1", "0"],
            ["t", "07:01:00", "07:01:00", "b", "2", "1"],
            ["t", "07:02:00", "07:02:00", "c", "3", "2"],
        ],
        "calendar.txt": [
            [
                "service_id",
                "monday",
                "tuesday",
                "wednesday",
                "thursday",
                "friday",
                "saturday",
                "sunday",
                "start_date",
                "end_date",
            ],
            ["s", "1", "1", "1", "1", "1", "1", "1", "20261001", "20261031"],
        ],
    }
    tables.update(changes or {})
    path = root / "test.zip"
    with zipfile.ZipFile(path, "w", zipfile.ZIP_DEFLATED) as z:
        for name, rows in tables.items():
            stream = io.StringIO()
            csv.writer(stream).writerows(rows)
            z.writestr(name, stream.getvalue())
    return path, {
        "sha256": hashlib.sha256(path.read_bytes()).hexdigest(),
        "bytes": path.stat().st_size,
        "url": SOURCE["url"],
        "acquiredAt": "2026-10-30T12:00:00Z",
    }


class AnalysisTests(unittest.TestCase):
    def run_feed(self, changes=None, day=date(2026, 10, 30)):
        with tempfile.TemporaryDirectory() as root:
            p, receipt = archive(Path(root), changes)
            return analyze_feed(p, day, receipt, SOURCE)

    def test_service_exceptions_and_no_invented_calendar(self):
        rows = [
            {
                "service_id": "s",
                "monday": "0",
                "tuesday": "0",
                "wednesday": "0",
                "thursday": "0",
                "friday": "1",
                "saturday": "0",
                "sunday": "0",
                "start_date": "20261001",
                "end_date": "20261031",
            }
        ]
        self.assertEqual(active_services(rows, [], date(2026, 10, 30)), {"s"})
        exceptions = [
            {"service_id": "s", "date": "20261030", "exception_type": "2"},
            {"service_id": "extra", "date": "20261030", "exception_type": "1"},
        ]
        self.assertEqual(
            active_services(rows, exceptions, date(2026, 10, 30)), {"extra"}
        )
        self.assertEqual(active_services(rows, [], date(2026, 11, 2)), set())

    def test_gtfs_day_does_not_wrap_at_midnight(self):
        self.assertEqual(seconds("25:10:00"), 90600)
        self.assertIsNone(seconds("07:60:00"))
        self.assertIsNone(seconds(""))
        self.assertIsNone(seconds("-1:00:00"))

    def test_zip_to_real_distance_not_assumed_shape_units(self):
        data = self.run_feed()
        self.assertEqual(data["status"], "ready")
        self.assertEqual(len(data["segments"]), 2)
        segment = data["segments"][0]
        self.assertGreater(segment["metres"], 75)
        self.assertLess(segment["metres"], 85)
        self.assertEqual(segment["bands"]["morning"]["samples"], 1)
        self.assertEqual(segment["bands"]["morning"]["seconds"], 60)
        self.assertLess(segment["bands"]["morning"]["kmh"], 5)

    def test_inactive_day_is_unavailable_not_zero_speed(self):
        data = self.run_feed(day=date(2026, 11, 2))
        self.assertEqual(data["status"], "no-service")
        self.assertEqual(data["segments"], [])

    def test_missing_and_zero_time_do_not_create_infinite_speed_or_bridge(self):
        times = [
            ["trip_id", "arrival_time", "departure_time", "stop_id", "stop_sequence"],
            ["t", "07:00:00", "07:00:00", "a", "1"],
            ["t", "", "", "b", "2"],
            ["t", "07:02:00", "07:02:00", "c", "3"],
        ]
        data = self.run_feed({"stop_times.txt": times})
        self.assertEqual(data["segments"], [])
        self.assertEqual(data["exclusions"]["missing_time"], 2)
        times[2] = ["t", "07:00:00", "07:00:00", "b", "2"]
        data = self.run_feed({"stop_times.txt": times})
        self.assertEqual(data["exclusions"]["nonpositive_time"], 1)
        self.assertEqual(len(data["segments"]), 1)

    def test_duplicate_stop_sequence_blocks_ambiguous_trip(self):
        times = [
            ["trip_id", "arrival_time", "departure_time", "stop_id", "stop_sequence"],
            ["t", "07:00:00", "07:00:00", "a", "1"],
            ["t", "07:01:00", "07:01:00", "b", "01"],
        ]
        with self.assertRaisesRegex(ValueError, "stop_sequence"):
            self.run_feed({"stop_times.txt": times})

    def test_frequency_trips_excluded_without_fake_sampling(self):
        freq = [
            ["trip_id", "start_time", "end_time", "headway_secs"],
            ["t", "07:00:00", "10:00:00", "600"],
        ]
        data = self.run_feed({"frequencies.txt": freq})
        self.assertEqual(data["segments"], [])
        self.assertEqual(data["exclusions"]["frequency_trip"], 1)
        self.assertEqual(data["status"], "no-comparable-segments")

    def test_missing_shape_is_reported_not_drawn_as_a_fake_road(self):
        data = self.run_feed(
            {
                "shapes.txt": [
                    ["shape_id", "shape_pt_lat", "shape_pt_lon", "shape_pt_sequence"]
                ]
            }
        )
        self.assertEqual(data["segments"], [])
        self.assertEqual(data["exclusions"]["missing_shape"], 1)

    def test_missing_shape_uses_declared_osm_rail_router_and_marks_it(self):
        empty = {
            "shapes.txt": [
                ["shape_id", "shape_pt_lat", "shape_pt_lon", "shape_pt_sequence"]
            ]
        }
        calls = []

        class Router:
            def route(self, a, b, excluded):
                calls.append((tuple(a), tuple(b)))
                if b[0] > 9.0015:  # second pair: tracks not found
                    excluded["osm_rail_no_path"] += 1
                    return None
                excluded["osm_rail_routed"] += 1
                return [list(a), [a[0] + 0.0005, 45.0001], list(b)], 90.0

        source = {**SOURCE, "derivedGeometry": "osm-rail"}
        with tempfile.TemporaryDirectory() as root:
            p, receipt = archive(Path(root), empty)
            data = analyze_feed(p, date(2026, 10, 30), receipt, source, Router())
            # Without the registry opt-in the router is never consulted.
            plain = analyze_feed(p, date(2026, 10, 30), receipt, SOURCE, Router())
        self.assertEqual(len(data["segments"]), 1)
        segment = data["segments"][0]
        self.assertEqual(segment["geometrySource"], "osm-rail")
        self.assertEqual(segment["metres"], 90.0)
        self.assertEqual(data["exclusions"]["osm_rail_no_path"], 1)
        self.assertEqual(data["exclusions"]["missing_geometry_pair"], 1)
        self.assertEqual(len(calls), 2)
        self.assertEqual(plain["segments"], [])
        self.assertEqual(plain["exclusions"]["missing_shape"], 1)

    def test_search_stops_preserve_source_coordinates_not_projected_shape_points(self):
        data = self.run_feed(
            {
                "stops.txt": [
                    ["stop_id", "stop_name", "stop_lat", "stop_lon"],
                    ["a", "A", "45.0001", "9"],
                    ["b", "B", "45", "9.001"],
                    ["c", "C", "45", "9.002"],
                ]
            }
        )
        self.assertEqual(
            data["stops"][0], {"id": "a", "name": "A", "point": [9.0, 45.0001]}
        )
        self.assertNotEqual(
            data["stops"][0]["point"], data["segments"][0]["coordinates"][0]
        )

    def test_distant_stop_is_not_a_short_slow_segment_with_or_without_shape_distances(
        self,
    ):
        for with_distances in [True, False]:
            changes = {
                "stops.txt": [
                    ["stop_id", "stop_name", "stop_lat", "stop_lon"],
                    ["a", "A", "45.00135", "9"],
                    ["b", "B", "45", "9.001"],
                    ["c", "C", "45", "9.002"],
                ]
            }
            if not with_distances:
                changes["stop_times.txt"] = [
                    [
                        "trip_id",
                        "arrival_time",
                        "departure_time",
                        "stop_id",
                        "stop_sequence",
                    ],
                    ["t", "07:00:00", "07:00:00", "a", "1"],
                    ["t", "07:01:00", "07:01:00", "b", "2"],
                    ["t", "07:02:00", "07:02:00", "c", "3"],
                ]
            with self.subTest(with_distances=with_distances):
                data = self.run_feed(changes)
                self.assertEqual(
                    [(s["fromId"], s["toId"]) for s in data["segments"]], [("b", "c")]
                )
                self.assertEqual(data["exclusions"]["stop_shape_offset_above_100_m"], 1)

    def test_bad_hash_blocks_analysis(self):
        with tempfile.TemporaryDirectory() as root:
            path, receipt = archive(Path(root))
            receipt["sha256"] = "0" * 64
            with self.assertRaisesRegex(ValueError, "SHA-256"):
                analyze_feed(path, date(2026, 10, 30), receipt, SOURCE)

    def test_duplicate_zip_members_and_byte_budget_block_input(self):
        with tempfile.TemporaryDirectory() as root:
            path, _ = archive(Path(root))
            with self.assertRaisesRegex(ValueError, "budget"):
                Archive(path, max_bytes=1)
            with zipfile.ZipFile(path, "a") as z:
                z.writestr("nested/routes.txt", "route_id\nr\n")
            with self.assertRaisesRegex(ValueError, "duplicat"):
                Archive(path)

    def test_json_cannot_close_the_script_element(self):
        encoded = safe_json({"name": "</script><script>alert(1)</script>"})
        self.assertNotIn("</script>", encoded)
        import json

        self.assertEqual(
            json.loads(encoded)["name"], "</script><script>alert(1)</script>"
        )


class ExplicitDateTests(unittest.TestCase):
    def test_city_dates_are_explicit_and_reject_unknown_duplicate_or_invalid_values(
        self,
    ):
        self.assertEqual(
            parse_city_dates(["cagliari=2026-10-31"], {"cagliari"}),
            {"cagliari": date(2026, 10, 31)},
        )
        for values in [
            ["roma=2026-10-31"],
            ["cagliari=bad"],
            ["cagliari=2026-10-31", "cagliari=2026-10-30"],
        ]:
            with self.assertRaises(ValueError):
                parse_city_dates(values, {"cagliari"})


class ExtendedCoverageTests(unittest.TestCase):
    def test_bus_perimeter_is_explicit_not_mislabeled_as_trams(self):
        with tempfile.TemporaryDirectory() as root:
            path, receipt = archive(
                Path(root),
                {
                    "routes.txt": [
                        ["route_id", "route_type", "route_short_name"],
                        ["r", "3", "25"],
                    ]
                },
            )
            data = analyze_feed(
                path,
                date(2026, 10, 30),
                receipt,
                {**SOURCE, "mode": "bus", "routeTypes": ["3"]},
            )
            self.assertEqual(data["status"], "ready")
            self.assertEqual(len(data["segments"]), 2)
            self.assertEqual(data["coverage"]["routesInFeed"], 1)

    def test_study_area_does_not_keep_pairs_outside_the_declared_perimeter(self):
        with tempfile.TemporaryDirectory() as root:
            path, receipt = archive(Path(root))
            source = {**SOURCE, "studyBounds": [9.1, 45.1, 9.2, 45.2]}
            data = analyze_feed(path, date(2026, 10, 30), receipt, source)
            self.assertEqual(data["segments"], [])
            self.assertEqual(data["exclusions"]["outside_study_area"], 2)
            self.assertEqual(data["status"], "no-comparable-segments")


class TrainNumberSelectionTests(unittest.TestCase):
    def test_named_trains_are_filtered_and_never_merged_by_route_geometry(self):
        changes = {
            "trips.txt": [
                [
                    "route_id",
                    "service_id",
                    "trip_id",
                    "direction_id",
                    "shape_id",
                    "trip_short_name",
                ],
                ["r", "s", "t1", "0", "sh", "8509"],
                ["r", "s", "t2", "0", "sh", "8519"],
            ],
            "stop_times.txt": [
                [
                    "trip_id",
                    "arrival_time",
                    "departure_time",
                    "stop_id",
                    "stop_sequence",
                    "shape_dist_traveled",
                ]
            ]
            + [
                [t, clock, clock, stop, seq, dist]
                for t in ["t1", "t2"]
                for clock, stop, seq, dist in [
                    ("07:00:00", "a", "1", "0"),
                    ("07:01:00", "b", "2", "1"),
                    ("07:02:00", "c", "3", "2"),
                ]
            ],
        }
        with tempfile.TemporaryDirectory() as tmp:
            path, receipt = archive(Path(tmp), changes)
            source = {**SOURCE, "tripNumbers": ["8509", "8519"], "routeLabel": "trip"}
            both = analyze_feed(path, date(2026, 10, 30), receipt, source)
            self.assertEqual(len(both["segments"]), 4)
            self.assertEqual({s["route"] for s in both["segments"]}, {"8509", "8519"})
            self.assertTrue(
                all(s["bands"]["morning"]["samples"] == 1 for s in both["segments"])
            )
            one = analyze_feed(
                path, date(2026, 10, 30), receipt, {**source, "tripNumbers": ["8509"]}
            )
            self.assertEqual(len(one["segments"]), 2)
            self.assertEqual({s["route"] for s in one["segments"]}, {"8509"})
            missing = analyze_feed(
                path, date(2026, 10, 30), receipt, {**source, "tripNumbers": ["9999"]}
            )
            self.assertEqual(missing["segments"], [])
            legacy = analyze_feed(path, date(2026, 10, 30), receipt, SOURCE)
            self.assertEqual(len(legacy["segments"]), 2)
            self.assertTrue(
                all(s["bands"]["morning"]["samples"] == 2 for s in legacy["segments"])
            )

    def test_invalid_or_absent_train_identity_has_no_silent_fallback(self):
        with tempfile.TemporaryDirectory() as tmp:
            path, receipt = archive(Path(tmp))
            for policy in [
                {"tripNumbers": []},
                {"tripNumbers": ["8509", "8509"]},
                {"tripNumbers": [1]},
                {"tripNumbers": ["../8509"]},
                {"routeLabel": "trip"},
                {"routeLabel": "unknown"},
            ]:
                with self.subTest(policy=policy):
                    with self.assertRaises(ValueError):
                        analyze_feed(
                            path, date(2026, 10, 30), receipt, {**SOURCE, **policy}
                        )


if __name__ == "__main__":
    unittest.main()
