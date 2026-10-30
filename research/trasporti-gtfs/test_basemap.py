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


if __name__ == "__main__":
    unittest.main()
