"""Offline checks for the committed snapshot of the Head of State."""

from __future__ import annotations

import json
import unittest

from presidente_repubblica_snapshot import OUTPUT, SnapshotError, check_committed, load_spec, validate_snapshot


class PresidenteRepubblicaSnapshotTest(unittest.TestCase):
    def test_offline_check_passes_on_committed_artifact(self) -> None:
        check_committed(load_spec())

    def test_validate_requires_declared_gap(self) -> None:
        payload = json.loads(OUTPUT.read_text(encoding="utf-8"))
        payload["provenance"]["gap"] = ""
        with self.assertRaises(SnapshotError):
            validate_snapshot(payload)

    def test_validate_rejects_unofficial_portrait(self) -> None:
        payload = json.loads(OUTPUT.read_text(encoding="utf-8"))
        payload["holder"]["photoUrl"] = "https://example.test/ritratto.jpg"
        with self.assertRaises(SnapshotError):
            validate_snapshot(payload)

    def test_validate_rejects_response_hash_drift(self) -> None:
        payload = json.loads(OUTPUT.read_text(encoding="utf-8"))
        payload["source"]["responses"]["identity"]["sha256"] = "0" * 64
        with self.assertRaises(SnapshotError):
            validate_snapshot(payload, locks=load_spec()["source"]["committedResponses"])


if __name__ == "__main__":
    unittest.main()
