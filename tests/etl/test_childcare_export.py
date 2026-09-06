"""Versioned public research assets must remain immutable."""
import hashlib
import importlib.util
from pathlib import Path
import tempfile
import unittest

SCRIPT = Path(__file__).resolve().parents[2] / "research/pnrr-childcare-delivery/scripts/export_web.py"
SPEC = importlib.util.spec_from_file_location("childcare_export", SCRIPT)
exporter = importlib.util.module_from_spec(SPEC)
SPEC.loader.exec_module(exporter)


class VersionedResearchExportTests(unittest.TestCase):
    def test_identical_repeat_export_preserves_asset_and_metadata(self):
        with tempfile.TemporaryDirectory() as directory:
            source = Path(directory) / "source.pdf"
            target = Path(directory) / "published.pdf"
            source.write_bytes(b"research document")
            first = exporter.publish_asset(source, target)
            modified_at = target.stat().st_mtime_ns
            self.assertEqual(exporter.publish_asset(source, target), first)
            self.assertEqual(target.stat().st_mtime_ns, modified_at)
            self.assertEqual(first, {"sha256": hashlib.sha256(source.read_bytes()).hexdigest(), "bytes": 17})

    def test_changed_asset_requires_a_new_version(self):
        with tempfile.TemporaryDirectory() as directory:
            source = Path(directory) / "source.pdf"
            target = Path(directory) / "published.pdf"
            source.write_bytes(b"original version")
            exporter.publish_asset(source, target)
            source.write_bytes(b"revised version")
            with self.assertRaisesRegex(ValueError, "creare una nuova versione"):
                exporter.publish_asset(source, target)
            self.assertEqual(target.read_bytes(), b"original version")
