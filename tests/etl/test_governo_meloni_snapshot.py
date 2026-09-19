"""Offline checks for the committed snapshot of the government in office."""

from __future__ import annotations

import json
import unittest

from governo_meloni_snapshot import OUTPUT, SnapshotError, check_committed, load_spec, validate_snapshot


class GovernoMeloniSnapshotTest(unittest.TestCase):
    def test_offline_check_passes_on_committed_artifact(self) -> None:
        check_committed(load_spec())

    def test_validate_rejects_two_prime_ministers(self) -> None:
        payload = json.loads(OUTPUT.read_text(encoding="utf-8"))
        premier = next(item for item in payload["appointments"] if item["roleKind"] == "presidente-del-consiglio")
        clone = dict(premier)
        clone["id"] = f"{premier['id']}-clone"
        payload["appointments"].append(clone)
        payload["coverage"]["appointments"] += 1
        with self.assertRaises(SnapshotError):
            validate_snapshot(payload)

    def test_validate_rejects_portrait_of_another_person(self) -> None:
        payload = json.loads(OUTPUT.read_text(encoding="utf-8"))
        person = next(item for item in payload["people"] if item["photoUrl"])
        person["photoUrl"] = person["photoUrl"].replace(f"d{person['personaId']}.jpg", "d1.jpg")
        with self.assertRaises(SnapshotError):
            validate_snapshot(payload)

    def test_validate_rejects_response_hash_drift(self) -> None:
        payload = json.loads(OUTPUT.read_text(encoding="utf-8"))
        payload["source"]["responses"]["members"]["sha256"] = "0" * 64
        with self.assertRaises(SnapshotError):
            validate_snapshot(payload, locks=load_spec()["source"]["committedResponses"])


if __name__ == "__main__":
    unittest.main()
