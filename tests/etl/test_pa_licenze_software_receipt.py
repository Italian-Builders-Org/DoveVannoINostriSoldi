"""Receipt pin for the software licences payload stored in dvns_snapshots."""

from __future__ import annotations

import json
import subprocess
import unittest
from pathlib import Path

ROOT = Path(__file__).resolve().parents[2]
RECEIPT = ROOT / "src" / "data" / "generated" / "pa-licenze-software.receipt.json"
PAYLOAD = "src/data/generated/pa-licenze-software.json"
SPEC = ROOT / "scripts" / "etl" / "specs" / "pa-licenze-software.source.json"


class PaLicenzeSoftwareReceiptTests(unittest.TestCase):
    def test_receipt_pins_the_document_and_matches_the_source_lock(self) -> None:
        receipt = json.loads(RECEIPT.read_text(encoding="utf-8"))
        spec = json.loads(SPEC.read_text(encoding="utf-8"))
        self.assertEqual(receipt["schemaVersion"], 1)
        self.assertEqual(receipt["documentPath"], PAYLOAD)
        self.assertRegex(receipt["codeSha"], r"^[0-9a-f]{40}$")
        self.assertRegex(receipt["sourceSha256"], r"^[0-9a-f]{64}$")
        self.assertIsInstance(receipt["sourceBytes"], int)
        self.assertGreater(receipt["sourceBytes"], 0)
        # The receipt describes the same acquisition the source lock pins.
        self.assertEqual(receipt["consipYears"], spec["consip"]["years"])
        self.assertEqual(receipt["anacCohort"], spec["anac"]["cohort"])
        # Only the pin is versioned: no amendment data in the receipt.
        self.assertEqual(
            set(receipt),
            {"schemaVersion", "documentPath", "codeSha", "sourceSha256", "sourceBytes", "consipYears", "anacCohort"},
        )

    def test_full_payload_is_excluded_from_git_and_registered(self) -> None:
        registry = json.loads((ROOT / "scripts" / "ci" / "generated-artifacts.json").read_text(encoding="utf-8"))
        self.assertIn(PAYLOAD, {item["path"] for item in registry["exclusions"]})
        files = {path for artifact in registry["artifacts"] for path in artifact["files"]}
        self.assertIn(RECEIPT.relative_to(ROOT).as_posix(), files)
        self.assertNotIn(PAYLOAD, files)
        ignored = subprocess.run(["git", "check-ignore", "-q", PAYLOAD], cwd=ROOT, check=False)
        self.assertEqual(ignored.returncode, 0, "il payload deve restare fuori da Git")


if __name__ == "__main__":
    unittest.main()
