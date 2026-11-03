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
            self.assertNotRegex(html, r"(?m)[ \t]+$", "trailing whitespace in viewer HTML")
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

    def test_inlined_modules_share_one_scope_without_collisions(self):
        # Modules are concatenated after stripping import/export: aliases
        # vanish and two top-level declarations with one name break the page.
        here = Path(__file__).parent
        with tempfile.TemporaryDirectory() as root:
            target = Path(root)
            write_viewer({"schemaVersion": 3, "cities": []}, target)
            html = (target / "index.html").read_text()
        script = html[html.rindex('<script type="module">') :]
        names = re.findall(
            r"^(?:async\s+)?function\s+(\w+)|^(?:const|let|class)\s+(\w+)",
            script,
            re.M,
        )
        flat = [a or b for a, b in names]
        self.assertEqual(
            sorted({n for n in flat if flat.count(n) > 1}), [], "duplicate names"
        )
        for module in here.glob("*.mjs"):
            if module.name.startswith("test_"):
                continue
            imports = re.findall(
                r"^import\s*\{([^}]*)\}", module.read_text(), re.M
            )
            self.assertFalse(
                any(" as " in block for block in imports), module.name + " aliases"
            )
        self.assertFalse(
            re.search(r"^import\s*\{[^}]*\sas\s", (here / "viewer.js").read_text(), re.M)
        )

    def test_city_identifier_cannot_escape_the_asset_directory(self):
        with tempfile.TemporaryDirectory() as root:
            with self.assertRaisesRegex(ValueError, "identifier"):
                write_viewer({"cities": [{"id": "../outside"}]}, Path(root))


if __name__ == "__main__":
    unittest.main()
