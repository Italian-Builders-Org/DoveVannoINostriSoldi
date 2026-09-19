"""Offline check for the Camera XIX politici snapshot."""

from __future__ import annotations

import unittest

from politici_camera_xix_snapshot import OUTPUT, SnapshotError, check_committed, load_spec, validate_snapshot
import json


class PoliticiCameraXixSnapshotTest(unittest.TestCase):
    def test_offline_check_passes_on_committed_artifact(self) -> None:
        check_committed(load_spec())

    def test_validate_rejects_member_count_drift(self) -> None:
        payload = json.loads(OUTPUT.read_text(encoding="utf-8"))
        payload["groups"][0]["memberCount"] += 1
        with self.assertRaises(SnapshotError):
            validate_snapshot(payload)


if __name__ == "__main__":
    unittest.main()
