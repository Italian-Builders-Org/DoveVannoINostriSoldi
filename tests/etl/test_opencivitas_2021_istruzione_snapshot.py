"""Offline checks for the pinned OpenCivitas FC70ISTRUZ 2021 snapshot."""
from __future__ import annotations

import json
import unittest

from opencivitas_common import StructuralError
from opencivitas_2021_istruzione_snapshot import (
    OUTPUT,
    SEMANTIC_SHA256,
    SPEC,
    semantic_digest,
    validate_snapshot,
    verify_national_totals,
)


class OpenCivitas2021IstruzioneSnapshotTest(unittest.TestCase):
    def test_committed_snapshot_matches_semantic_pin(self) -> None:
        snapshot = json.loads(OUTPUT.read_text(encoding="utf-8"))
        validate_snapshot(snapshot)
        self.assertEqual(semantic_digest(snapshot), SEMANTIC_SHA256)
        self.assertEqual(snapshot["coverage"]["municipalities"], 6549)
        self.assertEqual(snapshot["coverage"]["function"], "ISTRUZIONE")
        self.assertEqual(snapshot["source"]["family"], "FC70ISTRUZ")
        self.assertIn("15 Comuni", snapshot["methodology"]["coverageWarning"])
        self.assertIn("riproporzionato", snapshot["methodology"]["nationalDifferenceWarning"])

    def test_national_totals_stay_pinned_to_the_source_reproportioning(self) -> None:
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
        self.assertEqual(sorted(row["istatCode"] for row in flagged), ["004159"])
        for row in flagged:
            self.assertEqual(row["sourceWarnings"], ["DIFF_OUT_PERC: cod_anomalo"])
            self.assertIsNone(row["serviceDifferenceBasisPoints"])


if __name__ == "__main__":
    unittest.main()
