import hashlib
import io
from pathlib import Path
import tempfile
import unittest
from supabase_runtime_restore import (
    restore_file,
    safe_target,
    validate_document,
    validate_cache_root,
)


class Client:
    def __init__(self, payload):
        self.payload = payload

    def open(self, _):
        return io.BytesIO(self.payload)


class RestoreTest(unittest.TestCase):
    def fixture(self, payload=b'{"amount":0,"empty":"","missing":null}\n'):
        sha = hashlib.sha256(payload).hexdigest()
        item = {
            "path": "src/data/generated/example.json",
            "source_sha256": sha,
            "source_bytes": len(payload),
        }
        receipt = {
            **item,
            "bucket": "dvns-snapshots",
            "parts": [
                {
                    "key": "sha256/" + sha,
                    "sha256": sha,
                    "offset": 0,
                    "bytes": len(payload),
                }
            ],
        }
        return payload, item, receipt

    def test_restores_exact_bytes_and_rejects_corrupt_remote(self):
        payload, item, receipt = self.fixture()
        with tempfile.TemporaryDirectory() as temp:
            target = restore_file(Client(payload), item, receipt, Path(temp), {})
            self.assertEqual(target.read_bytes(), payload)
            target.chmod(0o600)
            target.write_bytes(b"corrupt")
            with self.assertRaises(ValueError):
                restore_file(Client(b"corrupt"), item, receipt, Path(temp), {})

    def test_rejects_traversal_and_symlink(self):
        with tempfile.TemporaryDirectory() as temp:
            root = Path(temp).resolve()
            for path in (
                "../secret",
                "/etc/passwd",
                "src/data/generated/../../secret",
                "src/data/other.json",
            ):
                with self.assertRaises(ValueError):
                    safe_target(root, path)
            (root / "src").symlink_to("/tmp", target_is_directory=True)
            with self.assertRaises(ValueError):
                safe_target(root, "src/data/generated/x.json")

    def test_rejects_wrong_segment_or_file_receipt(self):
        payload, item, receipt = self.fixture()
        receipt["parts"][0]["offset"] = 1
        with tempfile.TemporaryDirectory() as temp:
            with self.assertRaises(ValueError):
                restore_file(Client(payload), item, receipt, Path(temp), {})

    def test_cache_cannot_overwrite_repository_or_follow_external_symlinks(self):
        with tempfile.TemporaryDirectory() as temp:
            root = Path(temp).resolve()
            (root / "artifacts").mkdir()
            self.assertEqual(
                validate_cache_root(root, root / "artifacts/release"),
                root / "artifacts/release",
            )
            for target in (root, root / "src", root.parent):
                with self.assertRaises(ValueError):
                    validate_cache_root(root, target)
            (root / "artifacts/escape").symlink_to(
                root.parent, target_is_directory=True
            )
            with self.assertRaises(ValueError):
                validate_cache_root(root, root / "artifacts/escape/release")

    def test_db_document_precision_and_divergence(self):
        from supabase_snapshot_documents import parse_document

        raw = b'{"amount":9007199254740993,"empty":"","zero":0,"null":null}'
        validate_document(raw, parse_document(raw))
        with self.assertRaises(ValueError):
            validate_document(raw, {"amount": 9007199254740992})


if __name__ == "__main__":
    unittest.main()
