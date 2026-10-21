"""Offline gates for the curated declassified-documents pilot."""

from __future__ import annotations

import copy
import json
import unittest

from documenti_declassificati_snapshot import (
    OUTPUT,
    SnapshotError,
    build_snapshot,
    check_committed,
    load_input,
    load_spec,
)


class DocumentiDeclassificatiSnapshotTest(unittest.TestCase):
    def setUp(self) -> None:
        self.spec = load_spec()
        self.payload = load_input(self.spec)

    def rebuild(self, mutate) -> None:
        payload = copy.deepcopy(self.payload)
        mutate(payload)
        build_snapshot(payload, self.spec)

    def test_offline_check_passes_on_committed_artifact(self) -> None:
        check_committed(self.spec)

    def test_committed_snapshot_matches_input_projection(self) -> None:
        committed = json.loads(OUTPUT.read_text(encoding="utf-8"))
        rebuilt = build_snapshot(copy.deepcopy(self.payload), self.spec)
        self.assertEqual(committed["coverage"]["documentsPublished"], rebuilt["coverage"]["documentsPublished"])
        self.assertEqual([doc["id"] for doc in committed["documents"]], [doc["id"] for doc in rebuilt["documents"]])

    def test_rejects_non_official_host(self) -> None:
        def mutate(payload):
            payload["documents"][0]["sourceUrls"] = ["https://example.com/leak"]

        with self.assertRaisesRegex(SnapshotError, "host non ammesso"):
            self.rebuild(mutate)

    def test_rejects_duplicate_ids(self) -> None:
        def mutate(payload):
            payload["documents"].append(copy.deepcopy(payload["documents"][0]))
            payload["coverage"]["documentsPublished"] = len(payload["documents"])

        with self.assertRaisesRegex(SnapshotError, "duplicato"):
            self.rebuild(mutate)

    def test_rejects_too_few_key_points(self) -> None:
        def mutate(payload):
            payload["documents"][0]["keyPoints"] = ["punto uno abbastanza lungo", "punto due abbastanza lungo"]

        with self.assertRaisesRegex(SnapshotError, "keyPoints"):
            self.rebuild(mutate)

    def test_rejects_missing_explicit_soldi(self) -> None:
        def mutate(payload):
            del payload["documents"][0]["soldi"]

        with self.assertRaisesRegex(SnapshotError, "soldi"):
            self.rebuild(mutate)

    def test_rejects_coverage_theme_drift(self) -> None:
        def mutate(payload):
            payload["coverage"]["themes"] = ["moro"]

        with self.assertRaisesRegex(SnapshotError, "coverage.themes"):
            self.rebuild(mutate)

    def test_rejects_unknown_access_status(self) -> None:
        def mutate(payload):
            payload["documents"][0]["accessStatus"] = "cia-reading-room"

        with self.assertRaisesRegex(SnapshotError, "accessStatus"):
            self.rebuild(mutate)

    def test_rejects_related_document_to_missing_id(self) -> None:
        def mutate(payload):
            payload["documents"][0]["relatedDocuments"] = [
                {"id": "scheda-inesistente", "relation": "collegamento di prova"}
            ]

        with self.assertRaisesRegex(SnapshotError, "assente"):
            self.rebuild(mutate)

    def test_pinned_pdf_url_must_match_document_source(self) -> None:
        spec = load_spec()
        pins = spec.get("pinnedPublicPdfs") or []
        self.assertGreaterEqual(len(pins), 5)
        payload = load_input(spec)
        by_id = {doc["id"]: doc for doc in payload["documents"]}
        for pin in pins:
            doc_id = pin["documentId"]
            self.assertIn(doc_id, by_id)
            self.assertIn(pin["url"], by_id[doc_id]["sourceUrls"])


if __name__ == "__main__":
    unittest.main()
