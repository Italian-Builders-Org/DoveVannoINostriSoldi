"""Receipt pin for manovra payload stored in dvns_snapshots."""

from __future__ import annotations

import json
import re
import unittest
from pathlib import Path

ROOT = Path(__file__).resolve().parents[2]
RECEIPT = ROOT / "src" / "data" / "generated" / "rgs-bilancio-in-breve.receipt.json"
PAYLOAD = ROOT / "src" / "data" / "generated" / "rgs-bilancio-in-breve.json"


class RgsBilancioInBreveReceiptTests(unittest.TestCase):
    def test_receipt_pins_supabase_document_without_embedding_money(self) -> None:
        receipt = json.loads(RECEIPT.read_text(encoding="utf-8"))
        self.assertEqual(receipt["schemaVersion"], 1)
        self.assertEqual(
            receipt["documentPath"],
            "src/data/generated/rgs-bilancio-in-breve.json",
        )
        self.assertRegex(receipt["codeSha"], r"^[0-9a-f]{40}$")
        self.assertRegex(receipt["sourceSha256"], r"^[0-9a-f]{64}$")
        self.assertIsInstance(receipt["sourceBytes"], int)
        self.assertGreater(receipt["sourceBytes"], 0)
        self.assertEqual(receipt["latestEditionId"], "lb-2026-2028")
        self.assertEqual(receipt["editions"], 4)
        # Money facts must not leak into the committed receipt.
        blob = json.dumps(receipt)
        self.assertNotRegex(blob, re.compile(r"768778531304|923116684581|competenzaEur"))

    def test_full_payload_is_not_versioned_in_tree(self) -> None:
        # Local ETL may recreate it; Git must not require it.
        tracked = (ROOT / "scripts" / "ci" / "generated-artifacts.json").read_text(
            encoding="utf-8"
        )
        self.assertIn("rgs-bilancio-in-breve.receipt.json", tracked)
        self.assertIn("rgs-bilancio-in-breve.json", tracked)
        # Exclusion reason present for local ETL output.
        registry = json.loads(
            (ROOT / "scripts" / "ci" / "generated-artifacts.json").read_text(
                encoding="utf-8"
            )
        )
        paths = {item["path"] for item in registry["exclusions"]}
        self.assertIn(PAYLOAD.relative_to(ROOT).as_posix(), paths)
