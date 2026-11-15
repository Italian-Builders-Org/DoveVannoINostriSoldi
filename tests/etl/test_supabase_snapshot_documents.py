import json
from decimal import Decimal
from pathlib import Path
import tempfile
import unittest

from supabase_snapshot_documents import document_inventory, parse_document


class SnapshotDocumentTests(unittest.TestCase):
    def test_numbers_and_missing_null_string_zero_remain_distinct(self):
        payload = b'{"value":1234567890123456789.123456789,"cells":{"s":"0","n":0,"empty":"","null":null}}'
        document = parse_document(payload)
        self.assertEqual(document["value"], Decimal("1234567890123456789.123456789"))
        self.assertNotEqual(document["cells"]["s"], document["cells"]["n"])
        self.assertNotIn("missing", document["cells"])
        self.assertIsNone(document["cells"]["null"])

    def test_invalid_json_and_non_finite_numbers_are_rejected(self):
        for payload in [b"{", b'{"x":NaN}', b'{"x":Infinity}']:
            with self.assertRaises(ValueError):
                parse_document(payload)

    def test_duplicate_object_keys_fail_closed(self):
        with self.assertRaisesRegex(ValueError, "duplicate"):
            parse_document(b'{"value":1,"value":2}')

    def test_inventory_groups_and_hashes_only_generated_documents(self):
        with tempfile.TemporaryDirectory() as tmp:
            root = Path(tmp)
            (root / "generated").mkdir()
            (root / "generated/data.json").write_text('{"zero":"0"}', encoding="utf-8")
            (root / "generated/derived.pack").write_bytes(b"opaque")
            (root / "outside.json").write_text('{"private":true}', encoding="utf-8")
            registry = {
                "generatedDataRoots": ["generated"],
                "exclusions": [],
                "artifacts": [
                    {"id": "one", "files": ["generated"]},
                    {"id": "two", "files": ["generated/data.json", "outside.json"]},
                ],
            }
            inventory = document_inventory(root, registry)
            self.assertEqual([d["path"] for d in inventory], ["generated/data.json"])
            self.assertEqual(inventory[0]["groups"], ["one", "two"])
            self.assertEqual(inventory[0]["source_bytes"], 12)
            (root / "generated/escape.json").symlink_to(root / "outside.json")
            with self.assertRaisesRegex(ValueError, "symlink"):
                document_inventory(root, registry)


if __name__ == "__main__":
    unittest.main()
