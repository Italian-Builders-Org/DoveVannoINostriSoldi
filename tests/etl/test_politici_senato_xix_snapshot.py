"""Offline checks for the current Senate XIX snapshot."""

from __future__ import annotations

import json
import unittest

from politici_senato_xix_snapshot import (
    OUTPUT, SnapshotError, check_committed, load_spec, validate_group_history, validate_snapshot,
)


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

    def test_history_rejects_missing_group_at_vote_date(self) -> None:
        payload = json.loads(OUTPUT.read_text(encoding="utf-8"))
        payload["groupMemberships"] = [
            row for row in payload["groupMemberships"] if row["senatorId"] != "29293"
        ]
        with self.assertRaisesRegex(SnapshotError, "gruppo storico non determinabile"):
            validate_group_history(payload)

    def test_history_rejects_changed_source_lock(self) -> None:
        payload = json.loads(OUTPUT.read_text(encoding="utf-8"))
        payload["source"]["groupHistory"]["responses"]["names"]["sha256"] = "0" * 64
        with self.assertRaisesRegex(SnapshotError, "source lock diverge"):
            validate_group_history(payload, locks=load_spec()["source"]["groupHistoryResponses"])

    def test_history_rejects_ambiguous_name_on_vote_date(self) -> None:
        payload = json.loads(OUTPUT.read_text(encoding="utf-8"))
        duplicate = next(row for row in payload["groupNames"] if row["groupId"] == "g49").copy()
        duplicate["shortLabel"] = "altro"
        payload["groupNames"].append(duplicate)
        with self.assertRaisesRegex(SnapshotError, "denominazione storica non determinabile"):
            validate_group_history(payload)


if __name__ == "__main__":
    unittest.main()
