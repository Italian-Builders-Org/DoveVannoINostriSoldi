from __future__ import annotations

import importlib.util
import io
import sys
import unittest
import urllib.error
from contextlib import redirect_stderr, redirect_stdout
from pathlib import Path
from unittest.mock import patch

ROOT = Path(__file__).resolve().parents[2]
MODULE_PATH = ROOT / "scripts/etl/parliament_sources.py"
SPEC = importlib.util.spec_from_file_location("parliament_sources", MODULE_PATH)
if SPEC is None or SPEC.loader is None:
    raise RuntimeError("Impossibile caricare parliament_sources.py")
MODULE = importlib.util.module_from_spec(SPEC)
sys.modules[SPEC.name] = MODULE
SPEC.loader.exec_module(MODULE)
FIXTURES = ROOT / "tests/fixtures/parliament"


class ParliamentSourceParserTests(unittest.TestCase):
    def run_main_with_online_error(self, error: Exception) -> int:
        with (
            patch.object(sys, "argv", ["parliament_sources.py"]),
            patch.object(MODULE, "online_check", side_effect=error),
            redirect_stdout(io.StringIO()),
            redirect_stderr(io.StringIO()),
        ):
            return MODULE.main()

    def test_camera_discovers_only_primary_documents(self) -> None:
        documents = MODULE.parse_camera_documents(
            (FIXTURES / "camera.html").read_text(encoding="utf-8")
        )
        self.assertEqual([item.kind for item in documents], ["account", "budget"])
        self.assertEqual([item.year for item in documents], [2025, 2026])

    def test_senate_filters_doc_viii_and_normalizes_official_https(self) -> None:
        documents = MODULE.parse_senate_documents(
            (FIXTURES / "senato.csv").read_text(encoding="utf-8")
        )
        self.assertEqual([item.document_number for item in documents], [5, 6])
        self.assertTrue(all(item.document_url.startswith("https://www.senato.it/") for item in documents))
        self.assertTrue(all(item.record_url.startswith("https://dati.senato.it/") for item in documents))

    def test_senate_preserves_four_doc_one_variants_and_suffix(self) -> None:
        documents = MODULE.parse_senate_documents(
            (FIXTURES / "senato-variants.csv").read_text(encoding="utf-8")
        )
        doc_one = [item for item in documents if item.document_number == 1]
        self.assertEqual(len(doc_one), 4)
        self.assertEqual(
            {(item.document_suffix, item.presented_at, item.document_url) for item in doc_one},
            {
                (None, "2023-10-25", "https://www.senato.it/service/PDF/PDFServer/BGT/1391468.pdf"),
                (None, "2023-10-25", "https://www.senato.it/service/PDF/PDFServer/BGT/1393041.pdf"),
                ("bis", "2023-10-25", "https://www.senato.it/service/PDF/PDFServer/BGT/1391468.pdf"),
                (None, "2023-10-26", "https://www.senato.it/service/PDF/PDFServer/BGT/1393041.pdf"),
            },
        )

    def test_senate_fails_closed_when_latest_doc_five_has_a_variant(self) -> None:
        snapshot = MODULE.load_json(MODULE.SNAPSHOT_PATH)
        manifest = MODULE.load_json(MODULE.MANIFEST_PATH)
        camera, senate, known_max = MODULE.validate_manifest(manifest, snapshot)
        actual_senate = MODULE.parse_senate_documents(
            (FIXTURES / "senato-variants.csv").read_text(encoding="utf-8")
        )
        with (
            patch.object(MODULE, "download_camera", return_value=camera),
            patch.object(MODULE, "verify_camera_asset"),
            patch.object(MODULE, "download_senate", return_value=actual_senate),
            self.assertRaisesRegex(MODULE.StructuralError, "registro ufficiale è cambiato"),
        ):
            MODULE.online_check(manifest, camera, senate, known_max, 1)

    def test_senate_rejects_a_non_printable_suffix(self) -> None:
        payload = (FIXTURES / "senato.csv").read_text(encoding="utf-8")
        payload = payload.replace(",6,,VIII,", ",6,\x1b,VIII,")
        with self.assertRaisesRegex(MODULE.StructuralError, "suffisso non valido"):
            MODULE.parse_senate_documents(payload)

    def test_senate_fails_closed_on_unknown_doc_viii_title(self) -> None:
        payload = (FIXTURES / "senato.csv").read_text(encoding="utf-8")
        payload += (
            "https://dati.senato.it/documento/60000,19,"
            "Rendiconto delle entrate e delle spese e progetto di bilancio interno del Senato,"
            "7,,VIII,Titolo inatteso,2026-08-20,https://www.senato.it/documento.pdf\n"
        )
        with self.assertRaisesRegex(MODULE.StructuralError, "titolo.*non riconosciuto"):
            MODULE.parse_senate_documents(payload)

    def test_senate_marks_a_blank_document_number_as_temporarily_incomplete(self) -> None:
        payload = (FIXTURES / "senato.csv").read_text(encoding="utf-8")
        payload = payload.replace(",6,,VIII,", ",,,VIII,")
        with self.assertRaisesRegex(MODULE.TemporarySourceError, "temporaneamente incompleta"):
            MODULE.parse_senate_documents(payload)

    def test_senate_marks_a_blank_document_url_as_temporarily_incomplete(self) -> None:
        payload = (FIXTURES / "senato.csv").read_text(encoding="utf-8")
        payload = payload.replace(
            "http://www.senato.it/service/PDF/PDFServer/BGT/1487095.pdf",
            "",
        )
        with self.assertRaisesRegex(MODULE.TemporarySourceError, "URLTesto"):
            MODULE.parse_senate_documents(payload)

    def test_senate_keeps_a_non_numeric_document_number_structural(self) -> None:
        payload = (FIXTURES / "senato.csv").read_text(encoding="utf-8")
        payload = payload.replace(",6,,VIII,", ",sei,,VIII,")
        with self.assertRaisesRegex(MODULE.StructuralError, "numero documento non valido"):
            MODULE.parse_senate_documents(payload)

    def test_online_check_keeps_an_omitted_known_document_structural(self) -> None:
        snapshot = MODULE.load_json(MODULE.SNAPSHOT_PATH)
        manifest = MODULE.load_json(MODULE.MANIFEST_PATH)
        camera, senate, known_max = MODULE.validate_manifest(manifest, snapshot)
        with (
            patch.object(MODULE, "download_camera", return_value=camera),
            patch.object(MODULE, "verify_camera_asset"),
            patch.object(MODULE, "download_senate", return_value=senate[1:]),
            self.assertRaisesRegex(MODULE.StructuralError, "mancanti_o_modificati"),
        ):
            MODULE.online_check(manifest, camera, senate, known_max, 1)

    def test_manifest_rejects_an_unbound_camera_pdf(self) -> None:
        snapshot = MODULE.load_json(MODULE.SNAPSHOT_PATH)
        manifest = MODULE.load_json(MODULE.MANIFEST_PATH)
        manifest["camera"]["documents"][0]["asset"]["sha256"] = "not-a-digest"
        with self.assertRaisesRegex(MODULE.StructuralError, "SHA-256"):
            MODULE.validate_manifest(manifest, snapshot)

    def test_manifest_rejects_an_unbound_public_snapshot(self) -> None:
        snapshot = MODULE.load_json(MODULE.SNAPSHOT_PATH)
        manifest = MODULE.load_json(MODULE.MANIFEST_PATH)
        manifest["snapshotArtifact"]["sha256"] = "0" * 64
        with self.assertRaisesRegex(MODULE.StructuralError, "snapshot pubblico non riconciliato"):
            MODULE.validate_manifest(manifest, snapshot)

    def test_snapshot_rejects_calling_the_whole_pension_title_vitalizi(self) -> None:
        snapshot = MODULE.load_json(MODULE.SNAPSHOT_PATH)
        pensions = next(
            category
            for category in snapshot["chambers"][0]["statements"][0]["categories"]
            if category["id"] == "pensions"
        )
        pensions["label"] = "Vitalizi"
        with self.assertRaisesRegex(MODULE.StructuralError, "non è la sola voce vitalizi"):
            MODULE.validate_public_snapshot(snapshot)

    def test_online_check_verifies_every_locked_camera_pdf(self) -> None:
        snapshot = MODULE.load_json(MODULE.SNAPSHOT_PATH)
        manifest = MODULE.load_json(MODULE.MANIFEST_PATH)
        camera, senate, known_max = MODULE.validate_manifest(manifest, snapshot)
        with (
            patch.object(MODULE, "download_camera", return_value=camera),
            patch.object(MODULE, "verify_camera_asset") as verify_camera_asset,
            patch.object(MODULE, "download_senate", return_value=senate),
        ):
            MODULE.online_check(manifest, camera, senate, known_max, 1)
        self.assertEqual(verify_camera_asset.call_count, len(camera))

    def test_main_marks_http_503_as_temporarily_unavailable(self) -> None:
        error = urllib.error.HTTPError(
            "https://example.invalid", 503, "unavailable", {}, io.BytesIO()
        )
        self.addCleanup(error.close)
        self.assertEqual(self.run_main_with_online_error(error), 2)

    def test_main_keeps_the_snapshot_when_a_runner_is_blocked(self) -> None:
        error = urllib.error.HTTPError(
            "https://example.invalid", 403, "forbidden", {}, io.BytesIO()
        )
        self.addCleanup(error.close)
        self.assertEqual(self.run_main_with_online_error(error), 2)

    def test_main_marks_network_errors_as_temporarily_unavailable(self) -> None:
        self.assertEqual(
            self.run_main_with_online_error(urllib.error.URLError("timeout")),
            2,
        )

    def test_main_marks_an_incomplete_official_response_as_temporary(self) -> None:
        self.assertEqual(
            self.run_main_with_online_error(MODULE.TemporarySourceError("campo mancante")),
            2,
        )

    def test_main_fails_on_http_404(self) -> None:
        error = urllib.error.HTTPError(
            "https://example.invalid", 404, "not found", {}, io.BytesIO()
        )
        self.addCleanup(error.close)
        self.assertEqual(self.run_main_with_online_error(error), 1)

    def test_main_fails_on_structural_drift(self) -> None:
        self.assertEqual(
            self.run_main_with_online_error(MODULE.StructuralError("nuovo documento")),
            1,
        )

    def test_check_mode_never_calls_the_network(self) -> None:
        with (
            patch.object(sys, "argv", ["parliament_sources.py", "--check"]),
            patch.object(MODULE, "online_check") as online_check,
            redirect_stdout(io.StringIO()),
            redirect_stderr(io.StringIO()),
        ):
            self.assertEqual(MODULE.main(), 0)
        online_check.assert_not_called()


if __name__ == "__main__":
    unittest.main()
