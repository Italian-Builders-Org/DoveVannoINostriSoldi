"""Artifact boundaries defined before lazy static city delivery."""

import gzip
import hashlib
import json
import re
import tempfile
import unittest
from pathlib import Path
from analyze import write_viewer


class DeliveryTests(unittest.TestCase):
    def test_city_assets_are_content_addressed_verifiable_and_not_in_bootstrap(self):
        city = {
            "id": "fixture",
            "name": "Fixture",
            "mode": "tram",
            "status": "ready",
            "serviceDate": "2026-10-30",
            "segments": [{"from": "Distinct source stop"}],
        }
        payload = {
            "schemaVersion": 3,
            "metric": "scheduled-segment-travel-time",
            "cities": [city],
        }
        with tempfile.TemporaryDirectory() as root:
            target = Path(root)
            write_viewer(payload, target)
            html = (target / "index.html").read_text()
            manifest = json.loads(
                re.search(
                    r'<script id="data" type="application/json">([\s\S]*?)</script>',
                    html,
                ).group(1)
            )
            asset = manifest["cities"][0]["asset"]
            raw = (target / asset["path"]).read_bytes()
            self.assertEqual(hashlib.sha256(raw).hexdigest(), asset["sha256"])
            self.assertEqual(len(raw), asset["bytes"])
            self.assertEqual(json.loads(gzip.decompress(raw)), city)
            self.assertNotIn("Distinct source stop", html)
            write_viewer(payload, target)
            self.assertEqual((target / asset["path"]).read_bytes(), raw)

    def test_portable_html_keeps_inline_data_and_forbids_network_connections(self):
        payload = {"schemaVersion": 3, "cities": [{"id": "fixture", "name": "Fixture"}]}
        with tempfile.TemporaryDirectory() as root:
            target = Path(root)
            write_viewer(payload, target, standalone=True)
            html = (target / "index.html").read_text()
            self.assertIn('id="city-fixture"', html)
            self.assertIn("connect-src 'none'", html)
            self.assertFalse((target / "cities").exists())

    def test_city_identifier_cannot_escape_the_asset_directory(self):
        with tempfile.TemporaryDirectory() as root:
            with self.assertRaisesRegex(ValueError, "identifier"):
                write_viewer({"cities": [{"id": "../outside"}]}, Path(root))


if __name__ == "__main__":
    unittest.main()
