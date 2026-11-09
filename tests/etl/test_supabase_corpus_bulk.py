"""Offline source/credential boundaries before any database writes."""

import gzip
import json
from pathlib import Path
import shutil
import tempfile
import unittest

from supabase_corpus_bulk import BulkManifest, load_database_url

ROOT = Path(__file__).resolve().parents[2]
PILOT = "ade-cinque-per-mille-territori-2024"


class BulkBoundaryTests(unittest.TestCase):
    def setUp(self):
        self.temp = tempfile.TemporaryDirectory()
        self.addCleanup(self.temp.cleanup)
        self.root = Path(self.temp.name)
        for name in [
            "src/data/generated/integrated/catalog.json",
            "data/source-ledger/release-proof.json",
            "data/source-ledger/dataset-proof.json",
        ]:
            target = self.root / name
            target.parent.mkdir(parents=True, exist_ok=True)
            shutil.copyfile(ROOT / name, target)
        shutil.copytree(
            ROOT / "data/source-ledger/datasets",
            self.root / "data/source-ledger/datasets",
        )
        self.chunk = (
            self.root
            / f"src/data/generated/integrated/rows/{PILOT}.part-00000.jsonl.gz"
        )
        self.chunk.parent.mkdir(parents=True)
        shutil.copyfile(ROOT / self.chunk.relative_to(self.root), self.chunk)

    def test_pinned_chunk_keeps_order_evidence_and_string_cells(self):
        manifest = BulkManifest(self.root)
        chunks = list(manifest.chunks(PILOT))
        expected = [
            json.loads(line)
            for line in gzip.decompress(self.chunk.read_bytes()).splitlines()
        ]
        self.assertEqual([r for c in chunks for r in c["rows"]], expected)
        self.assertEqual(chunks[0]["first_ordinal"], 1)
        self.assertEqual(chunks[0]["rows"][0]["cells"]["Territorio"], "")
        self.assertEqual(manifest.verify(PILOT)["rows"], 22)

    def test_changed_missing_and_extra_chunks_are_not_imported(self):
        manifest = BulkManifest(self.root)
        self.chunk.write_bytes(gzip.compress(b"{}\n"))
        with self.assertRaisesRegex(ValueError, "hash"):
            manifest.verify(PILOT)
        self.chunk.unlink()
        with self.assertRaisesRegex(ValueError, "chunk"):
            manifest.verify(PILOT)
        self.chunk.write_bytes(b"invalid")
        self.chunk.with_name(f"{PILOT}.part-00001.jsonl.gz").write_bytes(b"extra")
        with self.assertRaisesRegex(ValueError, "chunk"):
            manifest.verify(PILOT)

    def test_unavailable_detail_is_rejected(self):
        with self.assertRaisesRegex(ValueError, "publication"):
            BulkManifest(self.root).verify("opencup-progetti-bulk")

    def test_wrong_project_missing_tls_and_missing_password_are_rejected_without_secret(
        self,
    ):
        path = self.root / ".env.local"
        secret = "DO_NOT_LOG_THIS_SECRET"
        for uri in [
            f"postgresql://postgres:{secret}@example.com:5432/postgres?sslmode=require",
            f"postgresql://postgres:{secret}@db.zvqhikeylxynsljwgosc.supabase.co/postgres",
            "postgresql://postgres@db.zvqhikeylxynsljwgosc.supabase.co/postgres?sslmode=require",
        ]:
            path.write_text("DVNS_DATABASE_URL=" + uri + "\n", encoding="utf-8")
            with self.assertRaises(ValueError) as error:
                load_database_url(path)
            self.assertNotIn(secret, str(error.exception))

    def test_quoted_password_uri_is_read_without_interpolating_dollar(self):
        path = self.root / ".env.local"
        uri = "postgresql://postgres.zvqhikeylxynsljwgosc:p%24x@aws-0-eu-west-1.pooler.supabase.com:5432/postgres?sslmode=require"
        path.write_text('DVNS_DATABASE_URL="' + uri + '"\n', encoding="utf-8")
        self.assertEqual(load_database_url(path), uri)


if __name__ == "__main__":
    unittest.main()
