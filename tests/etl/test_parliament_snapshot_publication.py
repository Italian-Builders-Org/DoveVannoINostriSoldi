"""An interrupted refresh must leave the previously verified artifacts intact."""

from __future__ import annotations

import sys
import tempfile
import unittest
from pathlib import Path
from unittest.mock import patch

import camera_atti_voti_xix_snapshot as camera
import senato_atti_voti_xix_snapshot as senato


class ParliamentSnapshotPublicationTest(unittest.TestCase):
    def test_underfloor_refresh_preserves_each_existing_snapshot(self) -> None:
        for producer in (camera, senato):
            with self.subTest(producer=producer.DATASET), tempfile.TemporaryDirectory() as directory:
                output = Path(directory) / "snapshot.json"
                output.write_text("verified\n", encoding="utf-8")
                with (
                    patch.object(producer, "OUTPUT", output),
                    patch.object(producer, "ROOT", output.parent),
                    patch.object(producer, "load_spec", return_value={"coverageFloor": {"acts": 2}}),
                    patch.object(producer, "refresh", return_value={"coverage": {"acts": 1}}),
                    patch.object(sys, "argv", ["snapshot", "--write"]),
                    self.assertRaises(producer.SnapshotError),
                ):
                    producer.main()
                self.assertEqual(output.read_text(encoding="utf-8"), "verified\n")

    def test_failed_replace_preserves_each_existing_snapshot(self) -> None:
        for producer in (camera, senato):
            with self.subTest(producer=producer.DATASET), tempfile.TemporaryDirectory() as directory:
                output = Path(directory) / "snapshot.json"
                output.write_text("verified\n", encoding="utf-8")
                with (
                    patch.object(producer, "OUTPUT", output),
                    patch.object(producer, "ROOT", output.parent),
                    patch.object(producer, "load_spec", return_value={}),
                    patch.object(producer, "refresh", return_value={"coverage": {
                        "acts": 2900,
                        "finalVotes": 288,
                        "finalVotesObserved": 318,
                        "finalVotesOnOtherActs": 181,
                        "finalVotesOnGovernmentActs": 166,
                        "actsByInitiative": {"government": 336},
                        "deputiesAsFirstSigner": 341,
                        "senatorsAsFirstSigner": 174,
                    }}),
                    patch.object(sys, "argv", ["snapshot", "--write"]),
                    patch("os.replace", side_effect=OSError("simulated write interruption")),
                    self.assertRaises(OSError),
                ):
                    producer.main()
                self.assertEqual(output.read_text(encoding="utf-8"), "verified\n")
                self.assertEqual(list(output.parent.iterdir()), [output])


if __name__ == "__main__":
    unittest.main()
