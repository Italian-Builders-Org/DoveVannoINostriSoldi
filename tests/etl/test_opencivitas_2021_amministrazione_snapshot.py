"""Offline checks for the pinned OpenCivitas FC70AMMIN 2021 snapshot."""
from __future__ import annotations

import json
import unittest
from pathlib import Path

from opencivitas_common import StructuralError
from opencivitas_2021_amministrazione_snapshot import (
    OUTPUT,
    SEMANTIC_SHA256,
    SPEC,
    semantic_digest,
    validate_snapshot,
    verify_national_totals,
)


class OpenCivitas2021AmministrazioneSnapshotTest(unittest.TestCase):
    def test_committed_snapshot_matches_semantic_pin(self) -> None:
        snapshot = json.loads(OUTPUT.read_text(encoding="utf-8"))
        validate_snapshot(snapshot)
        self.assertEqual(semantic_digest(snapshot), SEMANTIC_SHA256)
        self.assertEqual(snapshot["coverage"]["municipalities"], 6550)
        self.assertEqual(snapshot["coverage"]["function"], "AMMINISTRAZIONE")
        self.assertEqual(snapshot["source"]["family"], "FC70AMMIN")
        self.assertEqual(Path("scripts/etl/specs/opencivitas-2021-amministrazione.source.json").exists(), True)
        self.assertIn("15 Comuni", snapshot["methodology"]["coverageWarning"])
        self.assertIn("riproporzionato", snapshot["methodology"]["nationalDifferenceWarning"])
        snapshot["generatedAt"] = snapshot["source"]["observedAt"] = "2024-05-30T00:00:00Z"
        validate_snapshot(snapshot)
        snapshot["generatedAt"] = snapshot["source"]["observedAt"] = "2024-05-29T23:59:59Z"
        with self.assertRaisesRegex(StructuralError, "timestamp ISO"):
            validate_snapshot(snapshot)

    def test_national_totals_stay_pinned_to_the_source_reproportioning(self) -> None:
        """Storica e fabbisogno coincidono sull insieme joinato, non su quello pubblicato."""
        snapshot = json.loads(OUTPUT.read_text(encoding="utf-8"))
        columns = snapshot["municipalityColumns"]
        rows = [dict(zip(columns, row)) for row in snapshot["municipalityRows"]]
        totals = SPEC["nationalTotals"]
        historical = sum(row["historicalSpendingCents"] for row in rows)
        standard = sum(row["standardSpendingCents"] for row in rows)
        self.assertEqual(historical, totals["historicalSpendingCents"])
        self.assertEqual(standard, totals["standardSpendingCentsPublished"])
        self.assertEqual(
            totals["standardSpendingCentsJoined"] - totals["standardSpendingCentsExcluded"],
            totals["standardSpendingCentsPublished"],
        )
        self.assertLessEqual(
            abs(totals["historicalSpendingCents"] - totals["standardSpendingCentsJoined"]),
            totals["roundingToleranceCents"],
        )
        drifted = [dict(row) for row in rows]
        drifted[0]["standardSpendingCents"] += 10 ** 6
        with self.assertRaises(StructuralError):
            verify_national_totals(drifted)

    def test_source_anomaly_flags_stay_visible_without_inventing_values(self) -> None:
        snapshot = json.loads(OUTPUT.read_text(encoding="utf-8"))
        columns = snapshot["municipalityColumns"]
        rows = [dict(zip(columns, row)) for row in snapshot["municipalityRows"]]
        flagged = [row for row in rows if row["sourceWarnings"]]
        self.assertEqual([row["istatCode"] for row in flagged], [])


if __name__ == "__main__":
    unittest.main()
