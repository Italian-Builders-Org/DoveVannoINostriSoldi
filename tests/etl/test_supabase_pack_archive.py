import hashlib
from pathlib import Path
import tempfile
import unittest
from supabase_pack_archive import archive_packs


class PackArchiveTests(unittest.TestCase):
    def test_files_share_bounded_objects_and_reconstruct_exact_bytes(self):
        with tempfile.TemporaryDirectory() as tmp:
            root = Path(tmp)
            inventory = []
            originals = {
                "a": b"ab",
                "b": b"12345678901234567",
                "empty": b"",
                "z": b"last",
            }
            for name, payload in originals.items():
                (root / name).write_bytes(payload)
                inventory.append(
                    {
                        "path": name,
                        "source_sha256": hashlib.sha256(payload).hexdigest(),
                        "source_bytes": len(payload),
                    }
                )
            packs = list(archive_packs(root, inventory, part_bytes=8))
            objects = {
                hashlib.sha256(p["payload"]).hexdigest(): p["payload"]
                for p in packs
                if p["payload"]
            }
            self.assertTrue(all(len(v) <= 8 for v in objects.values()))
            receipts = [r for p in packs for r in p["completed"]]
            self.assertEqual(len(receipts), 4)
            for receipt in receipts:
                actual = b"".join(
                    objects[p["key"].split("/")[-1]][
                        p["offset"] : p["offset"] + p["bytes"]
                    ]
                    for p in receipt["parts"]
                )
                self.assertEqual(
                    hashlib.sha256(actual).hexdigest(), receipt["source_sha256"]
                )
                self.assertEqual(len(actual), receipt["source_bytes"])
            self.assertEqual(
                len(next(r for r in receipts if r["source_bytes"] == 0)["parts"]), 0
            )
            self.assertLess(len(objects), len(originals))


if __name__ == "__main__":
    unittest.main()
