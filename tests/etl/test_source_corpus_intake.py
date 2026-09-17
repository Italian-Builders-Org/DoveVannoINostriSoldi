from __future__ import annotations

import gzip
import hashlib
import io
import json
import stat
import sys
import tarfile
import tempfile
import unittest
from contextlib import redirect_stdout
from pathlib import Path


ROOT = Path(__file__).resolve().parents[2]
ETL_ROOT = ROOT / "scripts/etl"
if str(ETL_ROOT) not in sys.path:
    sys.path.insert(0, str(ETL_ROOT))

from source_corpus.archive_receipt import (  # noqa: E402
    DEFAULT_POLICY,
    ReceiptError,
    build_receipt,
    canonical_json,
    check_receipt,
    verify_source,
)
from source_corpus.classification import ClassificationError, load_policy  # noqa: E402
from source_corpus_intake import main as intake_main  # noqa: E402


REGULAR_PATH = "private-root/affidamenti-work/rows.tsv"
HARDLINK_PATH = "private-root/affidamenti-work/rows-copy.tsv"
SYMLINK_PATH = "private-root/browser/latest"
SYMLINK_TEXT = "../affidamenti-work/rows.tsv"
DERIVED_PATH = "private-root/releases/card.json"
RESTRICTED_REGULAR_PATH = "private-root/session/cookies.json"
RESTRICTED_HARDLINK_PATH = "private-root/session/cookies-copy.json"
CROSS_CLASS_HARDLINK_PATH = "private-root/affidamenti-work/session-copy.json"
CROSS_CLASS_CHAIN_PATH = "private-root/affidamenti-work/session-copy-again.json"
REGULAR_PAYLOAD = b"id\tamount\n1\t\n"
DERIVED_PAYLOAD = b'{"count":1}\n'
RESTRICTED_PAYLOAD = b'{"session":"private"}\n'


def write_policy(
    path: Path,
    archive: Path,
    *,
    entries: int = 4,
    regular: int = 2,
    hardlink: int = 1,
    symlink: int = 1,
) -> None:
    policy = json.loads(DEFAULT_POLICY.read_text(encoding="utf-8"))
    archive_payload = archive.read_bytes()
    policy["expectedArchive"] = {
        "bytes": len(archive_payload),
        "sha256": hashlib.sha256(archive_payload).hexdigest(),
    }
    policy["expectedCorpus"] = {
        "entries": entries,
        "regular": regular,
        "hardlink": hardlink,
        "symlink": symlink,
    }
    policy["shardSize"] = 2
    path.write_text(json.dumps(policy, ensure_ascii=False, indent=2) + "\n", encoding="utf-8")


def add_regular(container: tarfile.TarFile, name: str, payload: bytes) -> None:
    member = tarfile.TarInfo(name)
    member.size = len(payload)
    member.mtime = 0
    member.mode = 0o644
    container.addfile(member, io.BytesIO(payload))


def add_hardlink(container: tarfile.TarFile, name: str, target: str) -> None:
    member = tarfile.TarInfo(name)
    member.type = tarfile.LNKTYPE
    member.linkname = target
    member.size = 0
    member.mtime = 0
    container.addfile(member)


def add_symlink(container: tarfile.TarFile, name: str, target_text: str) -> None:
    member = tarfile.TarInfo(name)
    member.type = tarfile.SYMTYPE
    member.linkname = target_text
    member.size = 0
    member.mtime = 0
    container.addfile(member)


def write_fixture(path: Path, *, variant: str = "valid") -> None:
    with path.open("wb") as raw:
        with gzip.GzipFile(filename="", mode="wb", fileobj=raw, mtime=0) as compressed:
            with tarfile.open(fileobj=compressed, mode="w") as container:
                if variant == "restricted-hardlink":
                    add_regular(container, RESTRICTED_REGULAR_PATH, RESTRICTED_PAYLOAD)
                    add_hardlink(container, RESTRICTED_HARDLINK_PATH, RESTRICTED_REGULAR_PATH)
                    add_symlink(container, SYMLINK_PATH, SYMLINK_TEXT)
                    add_regular(container, DERIVED_PATH, DERIVED_PAYLOAD)
                    return
                if variant == "cross-class-hardlink":
                    add_regular(container, RESTRICTED_REGULAR_PATH, RESTRICTED_PAYLOAD)
                    add_hardlink(container, CROSS_CLASS_HARDLINK_PATH, RESTRICTED_REGULAR_PATH)
                    add_hardlink(container, CROSS_CLASS_CHAIN_PATH, CROSS_CLASS_HARDLINK_PATH)
                    add_regular(container, DERIVED_PATH, DERIVED_PAYLOAD)
                    return
                if variant == "broken-hardlink":
                    add_hardlink(container, HARDLINK_PATH, REGULAR_PATH)
                    add_regular(container, REGULAR_PATH, REGULAR_PAYLOAD)
                    add_symlink(container, SYMLINK_PATH, SYMLINK_TEXT)
                    add_regular(container, DERIVED_PATH, DERIVED_PAYLOAD)
                    return
                if variant == "unsupported":
                    directory = tarfile.TarInfo("private-root/directory")
                    directory.type = tarfile.DIRTYPE
                    directory.mtime = 0
                    container.addfile(directory)
                    return
                add_regular(container, REGULAR_PATH, REGULAR_PAYLOAD)
                add_hardlink(container, HARDLINK_PATH, REGULAR_PATH)
                add_symlink(container, SYMLINK_PATH, SYMLINK_TEXT)
                add_regular(container, DERIVED_PATH, DERIVED_PAYLOAD)


def read_records(output: Path) -> list[dict[str, object]]:
    records: list[dict[str, object]] = []
    for path in sorted((output / "elements").iterdir()):
        records.extend(json.loads(line) for line in path.read_text(encoding="utf-8").splitlines())
    return records


def public_bytes(output: Path) -> bytes:
    payload = (output / "receipt.json").read_bytes()
    for path in sorted((output / "elements").iterdir()):
        payload += path.read_bytes()
    return payload


def refresh_receipt_digests(output: Path) -> None:
    receipt_path = output / "receipt.json"
    receipt = json.loads(receipt_path.read_text(encoding="utf-8"))
    all_payload = b""
    for shard in receipt["sharding"]["shards"]:
        payload = (output / "elements" / shard["file"]).read_bytes()
        shard["bytes"] = len(payload)
        shard["sha256"] = hashlib.sha256(payload).hexdigest()
        all_payload += payload
    receipt["sharding"]["elementSetSha256"] = hashlib.sha256(all_payload).hexdigest()
    receipt_path.write_bytes(canonical_json(receipt) + b"\n")


class SourceCorpusIntakeTests(unittest.TestCase):
    def setUp(self) -> None:
        self.temporary = tempfile.TemporaryDirectory()
        self.root = Path(self.temporary.name)
        self.archive = self.root / "fixture.tar.gz"
        self.policy = self.root / "policy.json"
        self.output = self.root / "ledger"
        self.private_map = self.root / "private-map.json"
        write_fixture(self.archive)
        write_policy(self.policy, self.archive)

    def tearDown(self) -> None:
        self.temporary.cleanup()

    def build(self) -> dict[str, object]:
        return build_receipt(
            archive_path=self.archive,
            private_map_out=self.private_map,
            output_dir=self.output,
            policy_path=self.policy,
        )

    def test_build_is_deterministic_complete_and_path_redacted(self) -> None:
        receipt = self.build()
        records = read_records(self.output)

        self.assertEqual(receipt["status"], "complete")
        self.assertEqual(receipt["observed"]["entries"], 4)
        self.assertEqual([record["id"] for record in records], [f"ae-{index:06d}" for index in range(1, 5)])
        self.assertEqual([record["kind"] for record in records], ["regular", "hardlink", "symlink", "regular"])
        self.assertEqual(records[1]["hardlinkTargetId"], records[0]["id"])
        self.assertEqual(records[1]["payloadSha256"], records[0]["payloadSha256"])
        self.assertEqual(records[1]["logicalBytes"], records[0]["logicalBytes"])
        self.assertEqual(records[2]["storedBytes"], 0)
        self.assertEqual(records[2]["logicalBytes"], len(SYMLINK_TEXT.encode("utf-8")))
        self.assertNotIn("payloadSha256", records[2])
        self.assertEqual(records[0]["family"], "procurement")
        self.assertEqual(records[2]["contentClass"], "browser-or-session-state")
        self.assertEqual(records[2]["disposition"], "private-quarantine")
        self.assertTrue(all("pathSha256" not in record for record in records))

        exposed = public_bytes(self.output)
        private_texts = (REGULAR_PATH, HARDLINK_PATH, SYMLINK_PATH, SYMLINK_TEXT, DERIVED_PATH)
        for private_text in private_texts:
            self.assertNotIn(private_text.encode("utf-8"), exposed)
        for private_path_text in private_texts:
            path_digest = hashlib.sha256(private_path_text.encode("utf-8")).hexdigest().encode("ascii")
            self.assertNotIn(path_digest, exposed)
        self.assertNotIn(b'"path"', exposed)
        self.assertNotIn(b'"pathSha256"', exposed)
        private = json.loads(self.private_map.read_text(encoding="utf-8"))
        self.assertEqual(
            [item["path"] for item in private["elements"]],
            [REGULAR_PATH, HARDLINK_PATH, SYMLINK_PATH, DERIVED_PATH],
        )
        self.assertEqual(private["elements"][2]["linkText"], SYMLINK_TEXT)
        self.assertEqual(stat.S_IMODE(self.private_map.stat().st_mode), 0o600)

        first_public = public_bytes(self.output)
        first_private = self.private_map.read_bytes()
        self.build()
        self.assertEqual(public_bytes(self.output), first_public)
        self.assertEqual(self.private_map.read_bytes(), first_private)
        self.assertEqual(check_receipt(output_dir=self.output, policy_path=self.policy), receipt)
        self.assertEqual(verify_source(archive_path=self.archive, output_dir=self.output, policy_path=self.policy), receipt)

    def test_restricted_regular_and_hardlink_digests_stay_in_private_map(self) -> None:
        write_fixture(self.archive, variant="restricted-hardlink")
        write_policy(self.policy, self.archive)

        receipt = self.build()
        records = read_records(self.output)
        expected_digest = hashlib.sha256(RESTRICTED_PAYLOAD).hexdigest()

        self.assertEqual(records[0]["privacy"], "restricted")
        self.assertEqual(records[0]["disposition"], "private-quarantine")
        self.assertEqual(records[1]["privacy"], "restricted")
        self.assertEqual(records[1]["disposition"], "private-quarantine")
        self.assertNotIn("payloadSha256", records[0])
        self.assertNotIn("payloadSha256", records[1])
        self.assertNotIn(expected_digest.encode("ascii"), public_bytes(self.output))

        private = json.loads(self.private_map.read_text(encoding="utf-8"))
        self.assertEqual(private["elements"][0]["payloadSha256"], expected_digest)
        self.assertEqual(private["elements"][1]["payloadSha256"], expected_digest)
        self.assertEqual(private["elements"][1]["hardlinkTargetId"], records[0]["id"])
        self.assertEqual(stat.S_IMODE(self.private_map.stat().st_mode), 0o600)
        self.assertEqual(check_receipt(output_dir=self.output, policy_path=self.policy), receipt)
        self.assertEqual(
            verify_source(
                archive_path=self.archive,
                output_dir=self.output,
                policy_path=self.policy,
            ),
            receipt,
        )

    def test_cross_class_hardlink_chain_inherits_private_payload_digest(self) -> None:
        write_fixture(self.archive, variant="cross-class-hardlink")
        write_policy(self.policy, self.archive, hardlink=2, symlink=0)

        receipt = self.build()
        records = read_records(self.output)
        expected_digest = hashlib.sha256(RESTRICTED_PAYLOAD).hexdigest()

        self.assertEqual(
            [record["kind"] for record in records],
            ["regular", "hardlink", "hardlink", "regular"],
        )
        self.assertEqual(records[0]["contentClass"], "browser-or-session-state")
        self.assertEqual(records[1]["contentClass"], "curated-dataset")
        self.assertEqual(records[2]["contentClass"], "curated-dataset")
        for record in records[:3]:
            self.assertEqual(record["privacy"], "restricted")
            self.assertEqual(record["disposition"], "private-quarantine")
            self.assertNotIn("payloadSha256", record)
        self.assertEqual(records[1]["hardlinkTargetId"], records[0]["id"])
        self.assertEqual(records[2]["hardlinkTargetId"], records[1]["id"])
        self.assertNotIn(expected_digest.encode("ascii"), public_bytes(self.output))

        private = json.loads(self.private_map.read_text(encoding="utf-8"))
        for element in private["elements"][:3]:
            self.assertEqual(element["payloadSha256"], expected_digest)
        self.assertEqual(private["elements"][1]["hardlinkTargetId"], records[0]["id"])
        self.assertEqual(private["elements"][2]["hardlinkTargetId"], records[1]["id"])
        self.assertEqual(check_receipt(output_dir=self.output, policy_path=self.policy), receipt)
        self.assertEqual(
            verify_source(
                archive_path=self.archive,
                output_dir=self.output,
                policy_path=self.policy,
            ),
            receipt,
        )

    def test_check_rejects_public_digest_on_a_restricted_record(self) -> None:
        write_fixture(self.archive, variant="restricted-hardlink")
        write_policy(self.policy, self.archive)
        self.build()

        first = self.output / "elements/part-00001.jsonl"
        records = [json.loads(line) for line in first.read_text(encoding="utf-8").splitlines()]
        records[0]["payloadSha256"] = hashlib.sha256(RESTRICTED_PAYLOAD).hexdigest()
        first.write_bytes(b"".join(canonical_json(record) + b"\n" for record in records))
        refresh_receipt_digests(self.output)

        with self.assertRaisesRegex(ReceiptError, "closed schema"):
            check_receipt(output_dir=self.output, policy_path=self.policy)

    def test_either_private_marker_suppresses_public_payload_digests(self) -> None:
        write_fixture(self.archive, variant="restricted-hardlink")
        expected_digest = hashlib.sha256(RESTRICTED_PAYLOAD).hexdigest()

        for privacy, disposition in (
            ("restricted", "non-product"),
            ("review-required", "private-quarantine"),
        ):
            with self.subTest(privacy=privacy, disposition=disposition):
                write_policy(self.policy, self.archive)
                policy = json.loads(self.policy.read_text(encoding="utf-8"))
                defaults = policy["contentClassDefaults"]["browser-or-session-state"]
                defaults["privacy"] = privacy
                defaults["disposition"] = disposition
                self.policy.write_text(json.dumps(policy), encoding="utf-8")

                self.build()
                records = read_records(self.output)
                private = json.loads(self.private_map.read_text(encoding="utf-8"))
                self.assertNotIn("payloadSha256", records[0])
                self.assertNotIn("payloadSha256", records[1])
                self.assertEqual(private["elements"][0]["payloadSha256"], expected_digest)
                self.assertEqual(private["elements"][1]["payloadSha256"], expected_digest)

    def test_check_rejects_restricted_hardlink_length_divergence(self) -> None:
        write_fixture(self.archive, variant="restricted-hardlink")
        write_policy(self.policy, self.archive)
        self.build()

        first = self.output / "elements/part-00001.jsonl"
        records = [json.loads(line) for line in first.read_text(encoding="utf-8").splitlines()]
        records[1]["logicalBytes"] = int(records[1]["logicalBytes"]) + 1
        first.write_bytes(b"".join(canonical_json(record) + b"\n" for record in records))
        refresh_receipt_digests(self.output)

        with self.assertRaisesRegex(ReceiptError, "payload identity diverges"):
            check_receipt(output_dir=self.output, policy_path=self.policy)

    def test_check_still_requires_nonrestricted_payload_digests(self) -> None:
        self.build()
        first = self.output / "elements/part-00001.jsonl"
        records = [json.loads(line) for line in first.read_text(encoding="utf-8").splitlines()]
        del records[0]["payloadSha256"]
        first.write_bytes(b"".join(canonical_json(record) + b"\n" for record in records))
        refresh_receipt_digests(self.output)

        with self.assertRaisesRegex(ReceiptError, "closed schema"):
            check_receipt(output_dir=self.output, policy_path=self.policy)

    def test_default_policy_pins_the_exact_corpus_and_blocks_unproved_git_publication(self) -> None:
        default = load_policy(DEFAULT_POLICY)
        self.assertEqual(
            default.expected_counts,
            {"entries": 51303, "regular": 46438, "hardlink": 4860, "symlink": 5},
        )
        self.assertEqual(default.expected_archive["bytes"], 10139244307)
        self.assertRegex(str(default.expected_archive["sha256"]), r"^[0-9a-f]{64}$")

        policy = json.loads(self.policy.read_text(encoding="utf-8"))
        policy["contentClassDefaults"]["curated-dataset"]["disposition"] = "git-raw"
        self.policy.write_text(json.dumps(policy), encoding="utf-8")
        with self.assertRaisesRegex(ClassificationError, "lacks authority"):
            load_policy(self.policy)

    def test_classifier_handles_top_level_paths_without_an_artificial_root(self) -> None:
        policy = load_policy(self.policy)
        from source_corpus.classification import classify_path

        self.assertEqual(classify_path("buchi/result.html", policy)["family"], "collection-gaps")
        self.assertEqual(
            classify_path("releases/previous/card.json", policy)["family"],
            "prototypes-releases",
        )

    def test_offline_check_rejects_byte_change_extra_shard_and_reordering(self) -> None:
        self.build()
        first = self.output / "elements/part-00001.jsonl"
        original = first.read_bytes()
        first.write_bytes(original.replace(b'"payloadSha256":"', b'"payloadSha256":"f', 1)[0 : len(original)])
        with self.assertRaisesRegex(ReceiptError, "shard bytes"):
            check_receipt(output_dir=self.output, policy_path=self.policy)

        self.build()
        extra = self.output / "elements/part-99999.jsonl"
        extra.write_bytes(b"{}\n")
        with self.assertRaisesRegex(ReceiptError, "missing or extra"):
            check_receipt(output_dir=self.output, policy_path=self.policy)

        self.build()
        lines = first.read_bytes().splitlines(keepends=True)
        first.write_bytes(lines[1] + lines[0])
        refresh_receipt_digests(self.output)
        with self.assertRaisesRegex(ReceiptError, "ordinals"):
            check_receipt(output_dir=self.output, policy_path=self.policy)

    def test_build_rejects_source_byte_substitution_before_container_parsing(self) -> None:
        payload = bytearray(self.archive.read_bytes())
        payload[-1] ^= 1
        self.archive.write_bytes(payload)
        with self.assertRaisesRegex(ReceiptError, "fingerprint diverges"):
            self.build()
        self.assertFalse(self.output.exists())
        self.assertFalse(self.private_map.exists())

    def test_check_rejects_missing_classification_even_after_digests_are_refreshed(self) -> None:
        self.build()
        first = self.output / "elements/part-00001.jsonl"
        records = [json.loads(line) for line in first.read_text(encoding="utf-8").splitlines()]
        del records[0]["contentClass"]
        first.write_bytes(b"".join(canonical_json(record) + b"\n" for record in records))
        refresh_receipt_digests(self.output)
        with self.assertRaisesRegex(ReceiptError, "closed schema"):
            check_receipt(output_dir=self.output, policy_path=self.policy)

    def test_check_rejects_a_legacy_unkeyed_path_digest(self) -> None:
        self.build()
        first = self.output / "elements/part-00001.jsonl"
        records = [json.loads(line) for line in first.read_text(encoding="utf-8").splitlines()]
        records[0]["pathSha256"] = hashlib.sha256(REGULAR_PATH.encode("utf-8")).hexdigest()
        first.write_bytes(b"".join(canonical_json(record) + b"\n" for record in records))
        refresh_receipt_digests(self.output)
        with self.assertRaisesRegex(ReceiptError, "closed schema"):
            check_receipt(output_dir=self.output, policy_path=self.policy)

    def test_check_rejects_a_symlink_text_digest(self) -> None:
        self.build()
        second = self.output / "elements/part-00002.jsonl"
        records = [json.loads(line) for line in second.read_text(encoding="utf-8").splitlines()]
        records[0]["payloadSha256"] = hashlib.sha256(SYMLINK_TEXT.encode("utf-8")).hexdigest()
        second.write_bytes(b"".join(canonical_json(record) + b"\n" for record in records))
        refresh_receipt_digests(self.output)
        with self.assertRaisesRegex(ReceiptError, "closed schema"):
            check_receipt(output_dir=self.output, policy_path=self.policy)

    def test_verify_source_rejects_a_self_consistent_payload_identity_rewrite(self) -> None:
        self.build()
        first = self.output / "elements/part-00001.jsonl"
        records = [json.loads(line) for line in first.read_text(encoding="utf-8").splitlines()]
        replacement = "f" * 64
        records[0]["payloadSha256"] = replacement
        records[1]["payloadSha256"] = replacement
        first.write_bytes(b"".join(canonical_json(record) + b"\n" for record in records))
        refresh_receipt_digests(self.output)

        check_receipt(output_dir=self.output, policy_path=self.policy)
        with self.assertRaisesRegex(ReceiptError, "rebuild diverges"):
            verify_source(archive_path=self.archive, output_dir=self.output, policy_path=self.policy)

    def test_build_fails_closed_for_broken_links_counts_and_unsupported_types(self) -> None:
        write_fixture(self.archive, variant="broken-hardlink")
        write_policy(self.policy, self.archive)
        with self.assertRaisesRegex(ReceiptError, "no prior target"):
            self.build()
        self.assertFalse(self.output.exists())
        self.assertFalse(self.private_map.exists())

        write_fixture(self.archive)
        write_policy(self.policy, self.archive, entries=5, regular=3, hardlink=1, symlink=1)
        with self.assertRaisesRegex(ReceiptError, "counts diverge"):
            self.build()
        self.assertFalse(self.output.exists())

        write_fixture(self.archive, variant="unsupported")
        write_policy(self.policy, self.archive, entries=1, regular=1, hardlink=0, symlink=0)
        with self.assertRaisesRegex(ReceiptError, "unsupported element kind"):
            self.build()

    def test_private_mapping_is_refused_inside_repository(self) -> None:
        with self.assertRaisesRegex(ReceiptError, "outside the repository"):
            build_receipt(
                archive_path=self.archive,
                private_map_out=ROOT / "data/private-map.json",
                output_dir=self.output,
                policy_path=self.policy,
            )

        with self.assertRaisesRegex(ReceiptError, "cannot replace"):
            build_receipt(
                archive_path=self.archive,
                private_map_out=self.archive,
                output_dir=self.output,
                policy_path=self.policy,
            )
        self.assertTrue(self.archive.is_file())

    def test_private_mapping_rejects_a_preexisting_symbolic_link(self) -> None:
        redirected = self.root / "redirected-private-map.json"
        self.private_map.symlink_to(redirected)

        with self.assertRaisesRegex(ReceiptError, "cannot be a symbolic link"):
            self.build()

        self.assertTrue(self.private_map.is_symlink())
        self.assertFalse(redirected.exists())
        self.assertFalse(self.output.exists())

    def test_cli_supports_the_documented_check_flag(self) -> None:
        self.build()
        with redirect_stdout(io.StringIO()) as output:
            exit_code = intake_main(
                ["--check", "--output-dir", str(self.output), "--policy", str(self.policy)]
            )
        self.assertEqual(exit_code, 0)
        self.assertIn('"status":"complete"', output.getvalue())


if __name__ == "__main__":
    unittest.main()
