"""Real local Git evidence for binary SIOPE candidates and closed path ownership."""
import gzip
import subprocess
import tempfile
from pathlib import Path
from unittest import TestCase, mock

import test_publish_data_refresh as existing
from siope_publication_paths import FIXED

publisher = existing.publisher


class SiopePublisherTests(TestCase):
    def setUp(self):
        self.artifact = publisher.load_artifact("siope-nonmunicipal")
        self.temporary = tempfile.TemporaryDirectory()
        self.addCleanup(self.temporary.cleanup)
        self.root = Path(self.temporary.name).resolve()
        self.patch = mock.patch.object(publisher, "ROOT", self.root)
        self.patch.start()
        self.addCleanup(self.patch.stop)
        for name in FIXED:
            self.write(name, b"{}\n")
        self.old_chunk = "src/data/generated/integrated/rows/siope-uscite-asl.part-00000.jsonl.gz"
        self.new_chunk = "src/data/generated/integrated/rows/siope-uscite-asl.part-00001.jsonl.gz"
        self.municipal = "src/data/generated/siope-municipal.json"
        self.write(self.old_chunk, gzip.compress(b'old row\n', mtime=0))
        self.write(self.municipal, b"municipal baseline\n")
        self.git("init", "-q")
        self.git("add", ".")
        self.git("-c", "user.name=Fixture", "-c", "user.email=fixture@example.invalid", "commit", "-qm", "baseline")
        self.base = self.git("rev-parse", "HEAD")
        self.run = publisher.RunContext(
            token="fixture-not-a-credential", repository="fixture/repository", server_url="https://github.com",
            workflow_ref="fixture/repository/.github/workflows/siope-nonmunicipal-refresh.yml@refs/heads/main",
            event_name="schedule", ref_name="main", sha=self.base, run_id="1", run_attempt="1",
            run_url="https://github.com/fixture/repository/actions/runs/1",
        )

    def git(self, *args):
        return subprocess.run(["git", *args], cwd=self.root, check=True, capture_output=True, text=True).stdout.strip()

    def write(self, name, payload):
        path = self.root / name
        path.parent.mkdir(parents=True, exist_ok=True)
        path.write_bytes(payload)

    def test_binary_add_delete_candidate_has_the_exact_digest_and_preserves_municipal(self):
        (self.root / self.old_chunk).unlink()
        self.write(self.new_chunk, gzip.compress(b'new row with unicode \xc3\xa0\n', mtime=0))
        changed = publisher.status_paths(self.artifact)
        self.assertEqual(changed, {self.old_chunk, self.new_chunk})
        digest = publisher.file_digest(self.artifact)
        candidate = publisher.make_candidate(self.artifact, self.run, self.base, digest)
        self.assertEqual(publisher.ref_file_digest(candidate, self.artifact), digest)
        self.assertEqual(self.git("show", f"{candidate}:{self.municipal}"), "municipal baseline")
        self.assertEqual(self.git("rev-parse", "HEAD"), self.base)
        publisher.validate_existing_commit(publisher.parse_branch_commit(candidate), self.artifact, digest=digest)
        # A later candidate may have a different chunk set; the old tree stays verifiable.
        (self.root / self.new_chunk).unlink()
        self.write(self.old_chunk, gzip.compress(b'future row\n', mtime=0))
        self.assertEqual(publisher.ref_file_digest(candidate, self.artifact), digest)

    def test_unrelated_files_and_noncanonical_chunk_names_are_rejected(self):
        for name in (self.municipal, "data/source-ledger/datasets/other.receipt.json", "src/data/generated/integrated/rows/siope-uscite-asl.part-100000.jsonl.gz"):
            with self.subTest(name=name):
                original = (self.root / name).read_bytes() if (self.root / name).exists() else None
                self.write(name, b"unexpected\n")
                with self.assertRaisesRegex(publisher.PublishError, "unexpected"):
                    publisher.status_paths(self.artifact)
                if original is None:
                    (self.root / name).unlink()
                else:
                    self.write(name, original)

    def test_missing_receipt_and_symlink_cannot_form_a_candidate(self):
        receipt = self.root / "data/source-ledger/datasets/siope-uscite-asl.receipt.json"
        receipt.unlink()
        with self.assertRaisesRegex(publisher.PublishError, "missing"):
            publisher.status_paths(self.artifact)
        receipt.write_bytes(b"{}\n")
        (self.root / self.old_chunk).unlink()
        (self.root / self.old_chunk).symlink_to(self.root / self.municipal)
        with self.assertRaisesRegex(publisher.PublishError, "unsafe"):
            publisher.file_digest(self.artifact)
        self.git("add", ".")
        self.git("-c", "user.name=Fixture", "-c", "user.email=fixture@example.invalid", "commit", "-qm", "invalid symlink tree")
        with self.assertRaisesRegex(publisher.PublishError, "non-regular"):
            publisher.ref_file_digest(self.git("rev-parse", "HEAD"), self.artifact)
