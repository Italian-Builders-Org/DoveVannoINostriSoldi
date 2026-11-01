"""Immutable snapshot and failed-publication cases, defined before writer changes."""

import os
import tempfile
import unittest
from pathlib import Path
from unittest.mock import patch
from artifact_io import write_artifact


class ArtifactWriteTests(unittest.TestCase):
    def test_unchanged_artifact_keeps_its_inode_and_timestamp(self):
        with tempfile.TemporaryDirectory() as tmp:
            path = Path(tmp) / "data.gz"
            path.write_bytes(b"same")
            os.utime(path, ns=(1000000000, 1000000000))
            before = path.stat()
            self.assertFalse(write_artifact(path, b"same"))
            self.assertEqual(path.stat().st_ino, before.st_ino)
            self.assertEqual(path.stat().st_mtime_ns, before.st_mtime_ns)

    def test_replacing_a_linked_artifact_preserves_previous_snapshot(self):
        with tempfile.TemporaryDirectory() as tmp:
            previous, current = Path(tmp) / "previous.gz", Path(tmp) / "current.gz"
            previous.write_bytes(b"old")
            os.link(previous, current)
            self.assertTrue(write_artifact(current, b"new"))
            self.assertEqual(current.read_bytes(), b"new")
            self.assertEqual(previous.read_bytes(), b"old")
            self.assertNotEqual(current.stat().st_ino, previous.stat().st_ino)

    def test_failed_replace_keeps_old_artifact_and_removes_partial(self):
        with tempfile.TemporaryDirectory() as tmp:
            path = Path(tmp) / "data.gz"
            path.write_bytes(b"old")
            with patch(
                "artifact_io.os.replace", side_effect=OSError("publication failed")
            ):
                with self.assertRaisesRegex(OSError, "publication failed"):
                    write_artifact(path, b"new")
            self.assertEqual(path.read_bytes(), b"old")
            self.assertEqual(sorted(p.name for p in Path(tmp).iterdir()), ["data.gz"])
