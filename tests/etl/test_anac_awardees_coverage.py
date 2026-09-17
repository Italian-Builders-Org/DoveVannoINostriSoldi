from __future__ import annotations

import copy
import csv
import importlib.util
import io
import json
import sys
import tempfile
import unittest
import zipfile
from pathlib import Path


ROOT = Path(__file__).resolve().parents[2]
MODULE_PATH = ROOT / "scripts" / "etl" / "anac_awardees_coverage.py"
FIXTURE_DIR = ROOT / "tests" / "fixtures" / "anac-awardees"
SPEC = importlib.util.spec_from_file_location("anac_awardees_coverage", MODULE_PATH)
assert SPEC and SPEC.loader
MODULE = importlib.util.module_from_spec(SPEC)
sys.modules[SPEC.name] = MODULE
SPEC.loader.exec_module(MODULE)


class AnacAwardeesCoverageTest(unittest.TestCase):
    @classmethod
    def setUpClass(cls) -> None:
        cls.manifest = MODULE.audit(
            FIXTURE_DIR / "awardees.csv",
            FIXTURE_DIR / "awards.csv",
            observed_at="2026-08-30T00:00:00Z",
            source_spec=None,
            source_spec_sha256=None,
        )

    def write_csv(
        self,
        path: Path,
        headers: tuple[str, ...],
        rows: list[list[str]],
    ) -> None:
        with path.open("w", encoding="utf-8", newline="") as stream:
            writer = csv.writer(stream, delimiter=";")
            writer.writerow(headers)
            writer.writerows(rows)

    def test_fixture_measures_duplicates_multi_awardees_and_pair_join(self) -> None:
        awardees = self.manifest["coverage"]["awardees"]
        awards = self.manifest["coverage"]["awards"]
        reconciliation = self.manifest["reconciliation"]

        self.assertEqual(awardees["rowsTotal"], 8)
        self.assertEqual(awardees["exactDuplicateRows"], 1)
        self.assertEqual(awardees["awardPairsWithMultipleTaxIds"], 1)
        self.assertEqual(awardees["groupedRelationshipRows"], 5)
        self.assertEqual(awardees["maxTaxIdsPerAwardPair"], 2)
        self.assertEqual(awardees["roleRows"]["MANDANTE"], 3)
        self.assertEqual(awardees["normalizationChangedRows"], 1)
        self.assertEqual(awardees["missingAwardIdSentinelRows"], 1)
        self.assertEqual(awards["awardIdsWithMultipleCigs"], 1)
        self.assertEqual(reconciliation["matchedAwardeeRows"], 6)
        self.assertEqual(reconciliation["neitherKeyMatchesRows"], 1)
        self.assertEqual(reconciliation["ineligibleAwardeeRows"], 1)

    def test_fixture_reports_matched_rows_by_award_year(self) -> None:
        by_year = {item["year"]: item for item in self.manifest["byAwardYear"]}
        self.assertEqual(by_year["2024"]["matchedAwardeeRows"], 4)
        self.assertEqual(by_year["2024"]["exactDuplicateRows"], 1)
        self.assertEqual(by_year["2025"]["matchedAwardeeRows"], 1)
        self.assertEqual(by_year["unknown"]["redactedOrPlaceholderRows"], 1)

    def test_raw_values_are_preserved_and_normalization_is_derived(self) -> None:
        record = MODULE.parse_awardee(
            {
                "cig": " a000000001 ",
                "ruolo": "mandante",
                "codice_fiscale": " che-152434145 ",
                "denominazione": "=Synthetic; name",
                "tipo_soggetto": "raggruppamento temporaneo",
                "id_aggiudicazione": "00042",
            },
            2,
        )
        self.assertEqual(record.cig_original, " a000000001 ")
        self.assertEqual(record.cig, "A000000001")
        self.assertEqual(record.award_id_original, "00042")
        self.assertEqual(record.award_id, "00042")
        self.assertEqual(record.tax_id.original, " che-152434145 ")
        self.assertEqual(record.tax_id.normalized, "CHE-152434145")
        self.assertEqual(record.tax_id.classification, "foreign-or-anomalous")
        self.assertTrue(record.grouped_relationship)

    def test_tax_id_shapes_checksums_placeholders_and_punctuation_are_distinct(self) -> None:
        self.assertEqual(MODULE.classify_tax_id("").classification, "missing")
        self.assertEqual(
            MODULE.classify_tax_id("***********").classification,
            "redacted-or-placeholder",
        )
        self.assertEqual(
            MODULE.classify_tax_id("12345678903").classification,
            "italian-shape-11-checksum-valid",
        )
        self.assertEqual(
            MODULE.classify_tax_id("123.456.789-03").classification,
            "foreign-or-anomalous",
        )
        self.assertEqual(
            MODULE.classify_tax_id("12345678904").classification,
            "italian-shape-11-checksum-invalid",
        )
        self.assertEqual(
            MODULE.classify_tax_id("RSSMRA85T10A562S").classification,
            "italian-shape-16-checksum-valid",
        )
        self.assertEqual(
            MODULE.classify_tax_id("RSSMRA85T10A562A").classification,
            "italian-shape-16-checksum-invalid",
        )
        self.assertTrue(
            MODULE.classify_tax_id("DE12345678901234").classification.startswith(
                "italian-shape-16-checksum-"
            )
        )
        for placeholder in ("N/A", "00000000000", "XXXXXXXXXXXXXXXX"):
            self.assertEqual(
                MODULE.classify_tax_id(placeholder).classification,
                "redacted-or-placeholder",
            )

    def test_sentinel_and_non_positive_ids_are_not_joinable(self) -> None:
        self.assertEqual(MODULE.parse_award_id("-1"), (None, "missing-sentinel"))
        self.assertEqual(MODULE.parse_award_id("0"), (None, "invalid"))
        self.assertEqual(MODULE.parse_award_id("-2"), (None, "invalid"))
        self.assertEqual(MODULE.parse_award_id("12.0"), (None, "invalid"))
        self.assertEqual(MODULE.parse_award_id("00012"), ("00012", "known"))

    def test_header_drift_fails_closed(self) -> None:
        with tempfile.TemporaryDirectory() as temporary:
            path = Path(temporary) / "awardees.csv"
            self.write_csv(path, MODULE.AWARDEE_HEADERS[:-1], [])
            with self.assertRaisesRegex(MODULE.ContractError, "header inatteso"):
                with MODULE.csv_rows(path, MODULE.AWARDEE_HEADERS):
                    pass

    def test_extra_column_fails_closed(self) -> None:
        with tempfile.TemporaryDirectory() as temporary:
            path = Path(temporary) / "awardees.csv"
            self.write_csv(
                path,
                MODULE.AWARDEE_HEADERS,
                [["A000000001", "", "12345678903", "ALFA", "IMPRESA", "1", "EXTRA"]],
            )
            with MODULE.csv_rows(path, MODULE.AWARDEE_HEADERS) as reader:
                with self.assertRaisesRegex(MODULE.ContractError, "numero di colonne"):
                    MODULE.checked_row(next(reader), path=path, row_number=2)

    def test_zip_with_multiple_csv_members_is_rejected(self) -> None:
        with tempfile.TemporaryDirectory() as temporary:
            path = Path(temporary) / "input.zip"
            with zipfile.ZipFile(path, "w") as archive:
                archive.writestr("one.csv", "a\n")
                archive.writestr("two.csv", "a\n")
            with self.assertRaisesRegex(MODULE.ContractError, "un solo membro CSV"):
                with MODULE.csv_rows(path, ("a",)):
                    pass

    def test_source_lock_rejects_hash_and_member_drift(self) -> None:
        with tempfile.TemporaryDirectory() as temporary:
            path = Path(temporary) / "input.zip"
            with zipfile.ZipFile(path, "w", compression=zipfile.ZIP_DEFLATED) as archive:
                archive.writestr("awardees.csv", "cig\nA000000001\n")
            with zipfile.ZipFile(path) as archive:
                member = archive.infolist()[0]
                member_hash = MODULE.sha256_zip_member(archive, member)
            specification = {
                "archiveBytes": path.stat().st_size,
                "archiveSha256": MODULE.sha256_path(path),
                "delimiter": ";",
                "encoding": "utf-8-sig",
                "headers": ["cig"],
                "member": {
                    "name": member.filename,
                    "bytes": member.file_size,
                    "sha256": member_hash,
                    "crc32": f"{member.CRC:08x}",
                },
                "datasetPageUrl": "https://dati.anticorruzione.it/opendata/dataset/x",
                "resourcePageUrl": "https://dati.anticorruzione.it/opendata/dataset/x/resource/y",
                "resourceUrl": "https://dati.anticorruzione.it/opendata/download/x.zip",
                "resourceId": "y",
                "sourceLastModified": "2026-01-01",
            }
            verified = MODULE.verify_locked_input(path, specification)
            self.assertEqual(verified["archiveSha256"], specification["archiveSha256"])
            wrong = copy.deepcopy(specification)
            wrong["archiveSha256"] = "0" * 64
            with self.assertRaisesRegex(MODULE.ContractError, "SHA-256 archivio"):
                MODULE.verify_locked_input(path, wrong)

    def test_manifest_never_contains_fixture_tax_ids_or_names(self) -> None:
        serialized = json.dumps(self.manifest, ensure_ascii=False)
        for forbidden in (
            "12345678903",
            "11111111115",
            "CHE-152434145",
            "IMPRESA DUE",
            "CONSORZIO SINTETICO",
        ):
            self.assertNotIn(forbidden, serialized)

    def test_manifest_mutations_fail_closed(self) -> None:
        broken_join = copy.deepcopy(self.manifest)
        broken_join["contract"]["joinKey"] = ["id_aggiudicazione"]
        with self.assertRaisesRegex(MODULE.ContractError, "chiave di join"):
            MODULE.validate_manifest(broken_join, source_spec=None)

        broken_partition = copy.deepcopy(self.manifest)
        broken_partition["reconciliation"]["matchedAwardeeRows"] += 1
        with self.assertRaisesRegex(MODULE.ContractError, "riconciliazione"):
            MODULE.validate_manifest(broken_partition, source_spec=None)

        privacy_leak = copy.deepcopy(self.manifest)
        privacy_leak["privacy"]["containsRawTaxIds"] = True
        with self.assertRaisesRegex(MODULE.ContractError, "privacy"):
            MODULE.validate_manifest(privacy_leak, source_spec=None)

        negative_count = copy.deepcopy(self.manifest)
        negative_count["reconciliation"]["matchedAwardeeRows"] = -1
        with self.assertRaisesRegex(MODULE.ContractError, "non valido"):
            MODULE.validate_manifest(negative_count, source_spec=None)

        string_count = copy.deepcopy(self.manifest)
        string_count["reconciliation"]["matchedAwardeeRows"] = "6"
        with self.assertRaisesRegex(MODULE.ContractError, "non valido"):
            MODULE.validate_manifest(string_count, source_spec=None)

        bad_scope = copy.deepcopy(self.manifest)
        bad_scope["scope"]["nationalPopulationClaim"] = "measured"
        with self.assertRaisesRegex(MODULE.ContractError, "perimetro"):
            MODULE.validate_manifest(bad_scope, source_spec=None)

        bad_roles = copy.deepcopy(self.manifest)
        bad_roles["coverage"]["awardees"]["roleRows"]["MANDANTE"] = "3"
        with self.assertRaisesRegex(MODULE.ContractError, "ruoli"):
            MODULE.validate_manifest(bad_roles, source_spec=None)

        bad_dates = copy.deepcopy(self.manifest)
        bad_dates["coverage"]["awards"]["dateStatusRows"]["valid"] = -1
        with self.assertRaisesRegex(MODULE.ContractError, "stati data"):
            MODULE.validate_manifest(bad_dates, source_spec=None)

        bad_distinct = copy.deepcopy(self.manifest)
        bad_distinct["coverage"]["awardees"]["distinctJoinPairs"] = "3"
        with self.assertRaisesRegex(MODULE.ContractError, "distinctJoinPairs"):
            MODULE.validate_manifest(bad_distinct, source_spec=None)

    def test_official_manifest_locks_source_spec_bytes_and_license(self) -> None:
        specification, specification_sha = MODULE.load_source_spec(MODULE.DEFAULT_SPEC)
        manifest = json.loads(MODULE.DEFAULT_OUTPUT.read_text(encoding="utf-8"))
        MODULE.validate_manifest(
            manifest,
            source_spec=specification,
            source_spec_sha256=specification_sha,
        )

        with self.assertRaisesRegex(MODULE.ContractError, "source spec drift"):
            MODULE.validate_manifest(
                manifest,
                source_spec=specification,
                source_spec_sha256="0" * 64,
            )

        wrong_license = copy.deepcopy(manifest)
        wrong_license["license"]["url"] = "https://example.com/license"
        with self.assertRaisesRegex(MODULE.ContractError, "licenza inattesa"):
            MODULE.validate_manifest(
                wrong_license,
                source_spec=specification,
                source_spec_sha256=specification_sha,
            )

        wrong_input_hash = copy.deepcopy(manifest)
        wrong_input_hash["inputs"]["awardees"]["archiveSha256"] = "0" * 64
        with self.assertRaisesRegex(MODULE.ContractError, "source lock input drift"):
            MODULE.validate_manifest(
                wrong_input_hash,
                source_spec=specification,
                source_spec_sha256=specification_sha,
            )

        wrong_headers = copy.deepcopy(manifest)
        wrong_headers["inputs"]["awardees"]["headers"] = ["cig"]
        with self.assertRaisesRegex(MODULE.ContractError, "source lock input drift"):
            MODULE.validate_manifest(
                wrong_headers,
                source_spec=specification,
                source_spec_sha256=specification_sha,
            )


if __name__ == "__main__":
    unittest.main()
