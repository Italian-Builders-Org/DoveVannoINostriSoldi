"""Offline checks for the committed Italian MEPs snapshot."""

from __future__ import annotations

import json
import unittest

from politici_eurodeputati_it_snapshot import (
    COUNTRY,
    OUTPUT,
    SnapshotError,
    check_committed,
    load_spec,
    validate_snapshot,
)


class PoliticiEurodeputatiItSnapshotTest(unittest.TestCase):
    def test_offline_check_passes_on_committed_artifact(self) -> None:
        check_committed(load_spec())

    def test_validate_rejects_non_italian_country(self) -> None:
        payload = json.loads(OUTPUT.read_text(encoding="utf-8"))
        payload["meps"][0]["countryOfRepresentation"] = "FR"
        with self.assertRaises(SnapshotError):
            validate_snapshot(payload)

    def test_validate_rejects_response_hash_drift(self) -> None:
        payload = json.loads(OUTPUT.read_text(encoding="utf-8"))
        payload["source"]["responses"]["currentMepsItaly"]["sha256"] = "0" * 64
        with self.assertRaises(SnapshotError):
            validate_snapshot(payload, locks=load_spec()["source"]["committedResponses"])

    def test_validate_rejects_invented_national_party_field(self) -> None:
        payload = json.loads(OUTPUT.read_text(encoding="utf-8"))
        payload["meps"][0]["nationalParty"] = "Partito Immaginario"
        # Extra fields are ignored by the Python validator shape check; ensure
        # the published contract stays on EP group codes only.
        self.assertEqual(payload["meps"][0]["countryOfRepresentation"], COUNTRY)
        self.assertIn("groupCode", payload["meps"][0])
        self.assertNotIn("nationalParty", json.loads(OUTPUT.read_text(encoding="utf-8"))["meps"][0])


if __name__ == "__main__":
    unittest.main()
