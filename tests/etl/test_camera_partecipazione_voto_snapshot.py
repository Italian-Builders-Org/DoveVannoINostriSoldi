"""Offline checks for Camera participation-to-vote snapshot."""

from __future__ import annotations

import json
import unittest

from camera_partecipazione_voto_snapshot import (
    OUTPUT,
    SnapshotError,
    check_committed,
    load_spec,
    validate_snapshot,
)


def committed() -> dict:
    return json.loads(OUTPUT.read_text(encoding="utf-8"))


class CameraPartecipazioneVotoSnapshotTest(unittest.TestCase):
    def test_offline_check_passes_on_committed_artifact(self) -> None:
        check_committed(load_spec())

    def test_presence_equals_votes_plus_missions(self) -> None:
        for row in committed()["deputies"]:
            self.assertEqual(row["presenceTotal"], row["votesCast"] + row["missions"], row["sourceName"])

    def test_matched_rows_carry_numeric_id(self) -> None:
        for row in committed()["deputies"]:
            if row["deputyId"]:
                self.assertTrue(str(row["numericId"]).isdigit(), row["sourceName"])
                self.assertNotEqual(row["matchKind"], "unmatched")

    def test_validate_rejects_hash_drift(self) -> None:
        payload = committed()
        payload["source"]["responses"]["vista"]["sha256"] = "0" * 64
        with self.assertRaises(SnapshotError):
            validate_snapshot(
                payload,
                floor=load_spec()["coverageFloor"],
                locks=load_spec()["source"]["committedResponses"]["vista"],
            )

    def test_validate_rejects_broken_presence_identity(self) -> None:
        payload = committed()
        payload["deputies"][0]["presenceTotal"] = 1
        with self.assertRaises(SnapshotError):
            validate_snapshot(
                payload,
                floor=load_spec()["coverageFloor"],
                locks=load_spec()["source"]["committedResponses"]["vista"],
            )


if __name__ == "__main__":
    unittest.main()
