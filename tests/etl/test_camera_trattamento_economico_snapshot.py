"""Offline checks for Camera institutional economic treatment snapshot."""

from __future__ import annotations

import json
import unittest

from camera_trattamento_economico_snapshot import (
    OUTPUT,
    SnapshotError,
    check_committed,
    load_spec,
    validate_snapshot,
)


def committed() -> dict:
    return json.loads(OUTPUT.read_text(encoding="utf-8"))


class CameraTrattamentoEconomicoSnapshotTest(unittest.TestCase):
    def test_offline_check_passes_on_committed_artifact(self) -> None:
        check_committed(load_spec())

    def test_summary_matches_components(self) -> None:
        payload = committed()
        by_id = {item["id"]: item for item in payload["components"]}
        self.assertEqual(
            payload["summary"]["indemnityGrossMonthlyCents"],
            by_id["indennita-parlamentare-lordo"]["amountCents"],
        )
        self.assertEqual(by_id["indennita-parlamentare-lordo"]["amountCents"], 1_043_500)

    def test_validate_rejects_hash_drift(self) -> None:
        payload = committed()
        payload["source"]["responses"]["page"]["sha256"] = "0" * 64
        with self.assertRaises(SnapshotError):
            validate_snapshot(
                payload,
                floor=load_spec()["coverageFloor"]["components"],
                locks=load_spec()["source"]["committedResponses"]["page"],
            )

    def test_senato_gap_is_declared(self) -> None:
        payload = committed()
        self.assertIn("Senato", payload["provenance"]["gap"])


if __name__ == "__main__":
    unittest.main()
