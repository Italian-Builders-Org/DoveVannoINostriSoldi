import hashlib
import io
import json
from pathlib import Path
import tempfile
import unittest
from unittest.mock import patch
from urllib.error import HTTPError

from supabase_snapshot_storage import (
    file_parts,
    verified_stream,
    NoRedirect,
    StorageClient,
)


class StorageIntegrityTests(unittest.TestCase):
    def test_part_boundaries_order_and_empty_files(self):
        with tempfile.TemporaryDirectory() as tmp:
            path = Path(tmp) / "data"
            payload = b"abcd" * 6 + b"z"
            path.write_bytes(payload)
            parts = list(
                file_parts(path, hashlib.sha256(payload).hexdigest(), part_bytes=8)
            )
            self.assertEqual([len(p) for p in parts], [8, 8, 8, 1])
            self.assertEqual(b"".join(parts), payload)
            path.write_bytes(b"")
            self.assertEqual(
                list(file_parts(path, hashlib.sha256(b"").hexdigest(), part_bytes=8)),
                [],
            )

    def test_altered_source_fails_before_first_part_is_returned(self):
        with tempfile.TemporaryDirectory() as tmp:
            path = Path(tmp) / "data"
            path.write_bytes(b"corrupt")
            with self.assertRaisesRegex(ValueError, "source hash"):
                next(file_parts(path, hashlib.sha256(b"original").hexdigest()))

    def test_truncated_or_changed_download_cannot_be_verified(self):
        digest = hashlib.sha256(b"original").hexdigest()
        for payload in [b"origin", b"changed!"]:
            with self.assertRaisesRegex(ValueError, "download"):
                verified_stream(io.BytesIO(payload), digest, 8)
        self.assertEqual(verified_stream(io.BytesIO(b"original"), digest, 8), digest)

    def test_redirect_does_not_forward_secret_headers(self):
        with self.assertRaises(HTTPError):
            NoRedirect().redirect_request(
                None, None, 302, "redirect", {}, "https://example.com"
            )

    def test_sequential_requests_reuse_one_tls_connection(self):
        connections = []

        class FakeConnection:
            def __init__(self, *args, **kwargs):
                connections.append(self)
                self.requests = []

            def request(self, *args, **kwargs):
                self.requests.append((args, kwargs))

            def getresponse(self):
                response = io.BytesIO(b"{}")
                response.status = 200
                response.reason = "OK"
                return response

            def close(self):
                pass

        with patch(
            "supabase_snapshot_storage.HTTPSConnection", FakeConnection, create=True
        ):
            client = StorageClient("https://project.supabase.co", "test-secret")
            with client.open("/bucket") as response:
                response.read()
            with client.open("/bucket") as response:
                response.read()
        self.assertEqual(len(connections), 1)
        self.assertEqual(len(connections[0].requests), 2)

    def test_storage_wraps_missing_bucket_404_inside_http_400(self):
        class FakeClient(StorageClient):
            def __init__(self):
                self.calls = []

            def open(self, path, method="GET", data=None, extra=None):
                self.calls.append((method, path, data))
                if len(self.calls) == 1:
                    raise HTTPError(
                        "https://project/bucket/test",
                        400,
                        "bad request",
                        {},
                        io.BytesIO(b'{"statusCode":"404","error":"Bucket not found"}'),
                    )
                return io.BytesIO(b'{"public":false}')

        client = FakeClient()
        client.ensure_bucket()
        self.assertEqual([c[0] for c in client.calls], ["GET", "POST", "GET"])
        self.assertIs(json.loads(client.calls[1][2])["public"], False)

    def test_unrelated_http_400_is_not_accepted_as_an_existing_object(self):
        class FakeClient(StorageClient):
            def __init__(self):
                super().__init__("https://project.supabase.co", "test")

            def open(self, *args, **kwargs):
                raise HTTPError(
                    "https://project/object",
                    400,
                    "bad request",
                    {},
                    io.BytesIO(b'{"error":"InvalidRequest"}'),
                )

        with tempfile.TemporaryDirectory() as tmp:
            path = Path(tmp) / "file"
            path.write_bytes(b"original")
            with self.assertRaisesRegex(ValueError, "HTTP 400"):
                FakeClient().archive(
                    path,
                    {
                        "source_sha256": hashlib.sha256(b"original").hexdigest(),
                        "source_bytes": 8,
                    },
                )


if __name__ == "__main__":
    unittest.main()
