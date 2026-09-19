"""Offline checks for the current Senate XIX snapshot."""

from __future__ import annotations

import json
import unittest

from politici_senato_xix_snapshot import OUTPUT, SnapshotError, check_committed, load_spec, validate_snapshot


class PoliticiSenatoXixSnapshotTest(unittest.TestCase):
    def test_offline_check_passes_on_committed_artifact(self) -> None:
        check_committed(load_spec())

    def test_validate_rejects_membership_drift(self) -> None:
        payload = json.loads(OUTPUT.read_text(encoding="utf-8"))
        payload["groups"][0]["memberCount"] += 1
        with self.assertRaises(SnapshotError):
            validate_snapshot(payload)

    def test_validate_rejects_response_hash_drift(self) -> None:
        payload = json.loads(OUTPUT.read_text(encoding="utf-8"))
        payload["source"]["responses"]["currentRoster"]["sha256"] = "0" * 64
        with self.assertRaises(SnapshotError):
            validate_snapshot(payload, locks=load_spec()["source"]["committedResponses"])


if __name__ == "__main__":
    unittest.main()
