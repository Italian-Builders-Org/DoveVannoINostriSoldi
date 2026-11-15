"""OSM boundary tests, written before the basemap importer."""

import unittest
from basemap import parse_map, read_response


class BasemapTests(unittest.TestCase):
    def test_extract_real_roads_water_and_place_labels(self):
        data = {
            "elements": [
                {
                    "type": "way",
                    "id": 1,
                    "tags": {"highway": "residential", "name": "Via esempio"},
                    "geometry": [
                        {"lon": 7.67, "lat": 45.06},
                        {"lon": 7.68, "lat": 45.07},
                    ],
                },
                {
                    "type": "way",
                    "id": 2,
                    "tags": {"natural": "water"},
                    "geometry": [
                        {"lon": 7.67, "lat": 45.06},
                        {"lon": 7.68, "lat": 45.06},
                        {"lon": 7.67, "lat": 45.06},
                    ],
                },
                {
                    "type": "node",
                    "id": 3,
                    "lon": 7.67,
                    "lat": 45.06,
                    "tags": {"place": "suburb", "name": "Centro"},
                },
            ]
        }
        result = parse_map(data)
        self.assertEqual(result["features"][0]["kind"], "road")
        self.assertEqual(result["features"][1]["kind"], "water")
        self.assertEqual(result["labels"][0]["name"], "Centro")

    def test_partial_overpass_response_is_not_a_valid_empty_map(self):
        with self.assertRaisesRegex(ValueError, "partial|remark"):
            parse_map({"remark": "runtime error: Query timed out", "elements": []})

    def test_malformed_geometry_is_not_silently_projected(self):
        for point in [{"lon": 7.6, "lat": float("nan")}, {"lon": 190, "lat": 45}]:
            with self.assertRaisesRegex(ValueError, "coordinate"):
                parse_map(
                    {
                        "elements": [
                            {
                                "type": "way",
                                "id": 1,
                                "tags": {"highway": "primary"},
                                "geometry": [point, {"lon": 7.6, "lat": 45}],
                            }
                        ]
                    }
                )

    def test_absent_geometry_is_not_a_fake_street(self):
        with self.assertRaisesRegex(ValueError, "geometry"):
            parse_map(
                {"elements": [{"type": "way", "id": 1, "tags": {"highway": "primary"}}]}
            )

    def test_duplicate_osm_ids_cannot_double_count_features(self):
        element = {
            "type": "node",
            "id": 1,
            "lat": 45,
            "lon": 7,
            "tags": {"place": "suburb", "name": "Centro"},
        }
        with self.assertRaisesRegex(ValueError, "duplicate"):
            parse_map({"elements": [element, element]})


class CompressedResponseTests(unittest.TestCase):
    def test_compressed_response_uses_expanded_byte_budget(self):
        import gzip, io

        response = io.BytesIO(gzip.compress(b"x" * 1024))
        response.headers = {"Content-Encoding": "gzip"}
        with self.assertRaisesRegex(ValueError, "budget"):
            read_response(response, 100)

    def test_compressed_and_plain_responses_preserve_exact_json_bytes(self):
        import gzip, io

        expected = b'{"elements":[]}'
        for encoding, body in [("gzip", gzip.compress(expected)), ("", expected)]:
            response = io.BytesIO(body)
            response.headers = {"Content-Encoding": encoding}
            self.assertEqual(read_response(response, 100), expected)


class CachedReceiptTests(unittest.TestCase):
    def test_public_mirror_is_accepted_only_with_matching_receipt_and_perimeter(self):
        import hashlib, json, tempfile
        from pathlib import Path
        from basemap import load_map

        source = {"id": "fixture", "mapBounds": [9.28, 40.29, 9.37, 40.36]}
        raw = json.dumps(
            {
                "elements": [
                    {
                        "type": "way",
                        "id": 1,
                        "tags": {"highway": "primary"},
                        "geometry": [
                            {"lon": 9.32, "lat": 40.32},
                            {"lon": 9.33, "lat": 40.33},
                        ],
                    }
                ],
            }
        ).encode()
        receipt = {
            "endpoint": "https://maps.mail.ru/osm/tools/overpass/api/interpreter",
            "bounds": source["mapBounds"],
            "sha256": hashlib.sha256(raw).hexdigest(),
            "bytes": len(raw),
        }
        with tempfile.TemporaryDirectory() as tmp:
            root = Path(tmp)
            (root / "fixture.osm.json").write_bytes(raw)
            path = root / "fixture.osm.receipt.json"
            for changed in [
                {"endpoint": "https://untrusted.invalid/api/interpreter"},
                {"bounds": [9.0, 40.0, 9.1, 40.1]},
                {"bytes": len(raw) + 1},
                {"sha256": "0" * 64},
            ]:
                with self.subTest(changed=changed):
                    path.write_text(json.dumps({**receipt, **changed}))
                    with self.assertRaises(ValueError):
                        load_map(source, root)
            path.write_text(json.dumps(receipt))
            self.assertEqual(len(load_map(source, root)["features"]), 1)


class OverviewMapTests(unittest.TestCase):
    def test_overview_query_omits_dense_local_layers(self):
        from basemap import query_for

        bounds = [9, 39.3, 16.7, 46.8]
        overview = query_for(bounds, "overview")
        self.assertIn("motorway", overview)
        self.assertNotIn("residential", overview)
        self.assertNotIn("neighbourhood", overview)
        self.assertNotIn('"landuse"', overview)
        self.assertIn("residential", query_for(bounds))
        national = query_for(bounds, "national")
        self.assertIn('"motorway"', national)
        self.assertNotIn("trunk", national)
        self.assertNotIn("town", national)
        self.assertIn("timeout:180", national)
        with self.assertRaises(ValueError):
            query_for(bounds, "unknown")

    def test_a_coarse_map_cannot_reuse_an_urban_receipt(self):
        import hashlib, json, tempfile
        from pathlib import Path
        from basemap import load_map

        source = {
            "id": "fixture",
            "mapBounds": [9, 39.3, 16.7, 46.8],
            "mapDetail": "overview",
        }
        raw = json.dumps(
            {
                "elements": [
                    {
                        "type": "way",
                        "id": 1,
                        "tags": {"highway": "motorway"},
                        "geometry": [
                            {"lon": 11, "lat": 45},
                            {"lon": 11.01, "lat": 45.01},
                        ],
                    }
                ]
            }
        ).encode()
        receipt = {
            "endpoint": "https://overpass-api.de/api/interpreter",
            "bounds": source["mapBounds"],
            "sha256": hashlib.sha256(raw).hexdigest(),
            "bytes": len(raw),
        }
        with tempfile.TemporaryDirectory() as tmp:
            root = Path(tmp)
            (root / "fixture.osm.json").write_bytes(raw)
            path = root / "fixture.osm.receipt.json"
            path.write_text(json.dumps(receipt))
            with self.assertRaises(ValueError):
                load_map(source, root)
            path.write_text(json.dumps({**receipt, "profile": "overview"}))
            self.assertEqual(len(load_map(source, root)["features"]), 1)


if __name__ == "__main__":
    unittest.main()
