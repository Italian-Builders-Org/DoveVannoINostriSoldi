from __future__ import annotations

import csv
import hashlib
import json
import sys
import tempfile
import zipfile
from pathlib import Path
from unittest import TestCase

ROOT = Path(__file__).resolve().parents[2]
sys.path.insert(0, str(ROOT / "scripts" / "etl"))
import medical_device_spending_profile as etl


def write_zip(path: Path, member: str, headers: list[str], rows: list[list[str]], encoding: str) -> None:
    import io
    stream = io.StringIO(newline="")
    writer = csv.writer(stream, delimiter=";", lineterminator="\r\n")
    writer.writerow(headers); writer.writerows(rows)
    with zipfile.ZipFile(path, "w", zipfile.ZIP_DEFLATED) as archive:
        archive.writestr(member, stream.getvalue().encode(encoding))


class MedicalDeviceProfileTests(TestCase):
    def setUp(self):
        self.temp = tempfile.TemporaryDirectory(); self.root = Path(self.temp.name)
        self.spending = self.root / "spending.zip"; self.registry = self.root / "registry.zip"; self.cnd = self.root / "cnd.csv"
        write_zip(self.registry, etl.REGISTRY_MEMBER, etl.REGISTRY_HEADERS, [
            ["1", "42", "2020-01-01", "", "", "S", "2020-01-01", "9999-12-31", "Fab A", "", "", "A", "Device A", "A01", "Aghi", ""],
            ["2", "42", "2020-01-01", "", "", "S", "2020-01-01", "9999-12-31", "Ass B", "", "", "B", "Kit B", "", "", ""],
        ], "utf-8")
        write_zip(self.spending, "Appendice rapporto 2021.csv", etl.SPENDING_HEADERS, [
            ["2021", "10", "100", "ASL A", "1", "42", "A00", "1.000,00"],
            ["2021", "20", "100", "ASL B", "2", "42", "K01", "0,00"],
            ["2021", "20", "101", "ASL C", "1", "99", "A01", "-2,00"],
            ["2021", "20", "101", "ASL C", "", "", "A01", "3,00"],
        ], "ascii")
        with self.cnd.open("w", encoding="utf-8", newline="") as handle:
            writer = csv.writer(handle, delimiter=";", lineterminator="\n"); writer.writerow(etl.CND_HEADERS)
            writer.writerows([["A", "Old", "N", "", "2007-01-01", "2020-12-31"], ["A", "New", "N", "", "2021-01-01", ""], ["A01", "Aghi", "S", "", "2007-01-01", ""]])

    def tearDown(self): self.temp.cleanup()

    def test_composite_join_preserves_unresolved_zero_negative_and_versions(self):
        result = etl.profile(self.spending, self.registry, self.cnd)
        self.assertEqual(result["registry"]["duplicateBareNumbersAcrossTypes"], 1)
        self.assertEqual(result["join"], {"matchedRows": 2, "unresolvedRows": 2, "missingKeyRows": 1, "invalidKeyRows": 0, "notFoundRows": 1, "ambiguousRows": 0, "matchedEuroExact": "1000.00", "unresolvedEuroExact": "1.00", "sourceCurrentCndDifferentRows": 2})
        self.assertEqual(result["spending"]["totalEuroExact"], "1001.00")
        self.assertEqual(result["spending"]["zeroAmounts"], 1)
        self.assertEqual(result["spending"]["negativeAmounts"], 1)
        self.assertEqual(result["spending"]["repeatedBusinessGrains"], 0)
        self.assertEqual(result["registry"]["sentinelValidTo"], 2)
        self.assertEqual(result["cnd"]["codesWithMultipleVersions"], 1)

    def test_duplicate_composite_registry_key_fails_closed(self):
        row = ["1", "42", "2020-01-01", "", "", "S", "2020-01-01", "9999-12-31", "Fab", "", "", "A", "Device", "A01", "Aghi", ""]
        write_zip(self.registry, etl.REGISTRY_MEMBER, etl.REGISTRY_HEADERS, [row, row], "utf-8")
        with self.assertRaisesRegex(etl.SourceError, "duplicata"):
            etl.profile(self.spending, self.registry, self.cnd)

    def test_schema_and_money_drift_fail_closed(self):
        write_zip(self.spending, "Appendice rapporto 2021.csv", etl.SPENDING_HEADERS, [["2021", "10", "100", "ASL", "1", "42", "A01", "1.00"]], "ascii")
        with self.assertRaisesRegex(etl.SourceError, "Importo"):
            etl.profile(self.spending, self.registry, self.cnd)

    def test_empty_amount_is_not_observed_zero(self):
        write_zip(self.spending, "Appendice rapporto 2021.csv", etl.SPENDING_HEADERS, [["2021", "10", "100", "ASL", "1", "42", "A01", ""]], "ascii")
        with self.assertRaisesRegex(etl.SourceError, "Importo"):
            etl.profile(self.spending, self.registry, self.cnd)

    def test_extra_or_missing_row_cells_fail_closed(self):
        for row in (
            ["2021", "10", "100", "ASL", "1", "42", "A01", "1,00", "extra"],
            ["2021", "10", "100", "ASL", "1", "42", "A01"],
        ):
            with self.subTest(cells=len(row)):
                write_zip(self.spending, "Appendice rapporto 2021.csv", etl.SPENDING_HEADERS, [row], "ascii")
                with self.assertRaisesRegex(etl.SourceError, "Forma riga spesa"):
                    etl.profile(self.spending, self.registry, self.cnd)

    def test_observed_money_lexicon_preserves_up_to_five_decimals(self):
        self.assertEqual([str(etl.parse_source_euros(value)) for value in ("468", "655,2", "1.248,00", "8024,92164", "-2,00")], ["468", "655.2", "1248.00", "8024.92164", "-2.00"])
        for value in ("1,234567", "1.23,00", "+1,00", " 1,00"):
            with self.subTest(value=value), self.assertRaises(etl.SourceError):
                etl.parse_source_euros(value)

    def test_period_and_member_are_release_specific(self):
        with self.assertRaisesRegex(etl.SourceError, "Contenuto archivio"):
            etl.profile(self.spending, self.registry, self.cnd, 2022)

    def test_release_specific_member_is_accepted_only_when_explicit(self):
        rows = [["2020", "10", "100", "ASL", "1", "42", "A01", "1,00"]]
        write_zip(self.spending, "Appendice 2020.csv", etl.SPENDING_HEADERS, rows, "ascii")
        result = etl.profile(
            self.spending,
            self.registry,
            self.cnd,
            2020,
            spending_member="Appendice 2020.csv",
        )
        self.assertEqual(result["spending"]["years"], {"2020": 1})

    def test_same_health_company_code_in_different_regions_stays_distinct(self):
        rows = [
            ["2021", "10", "100", "ASL Nord", "1", "42", "A01", "1,00"],
            ["2021", "20", "100", "ASL Sud", "1", "42", "A01", "2,00"],
        ]
        write_zip(self.spending, "Appendice rapporto 2021.csv", etl.SPENDING_HEADERS, rows, "ascii")
        result = etl.profile(self.spending, self.registry, self.cnd)
        self.assertEqual(result["spending"]["rows"], 2)
        self.assertEqual(result["spending"]["repeatedBusinessGrains"], 0)

    def test_repeated_business_grain_is_reported_without_deduplication(self):
        rows = [
            ["2021", "20", "100", "Nome breve", "1", "42", "A01", "1,00"],
            ["2021", "20", "100", "Nome esteso", "1", "42", "A01", "2,00"],
        ]
        write_zip(self.spending, "Appendice rapporto 2021.csv", etl.SPENDING_HEADERS, rows, "ascii")
        result = etl.profile(self.spending, self.registry, self.cnd)
        self.assertEqual(result["spending"]["rows"], 2)
        self.assertEqual(result["spending"]["totalEuroExact"], "3.00")
        self.assertEqual(result["spending"]["repeatedBusinessGrains"], 1)
        self.assertEqual(result["spending"]["maxBusinessGrainOccurrences"], 2)

    def test_invalid_join_key_is_distinct_from_missing_and_not_found(self):
        write_zip(self.spending, "Appendice rapporto 2021.csv", etl.SPENDING_HEADERS, [
            ["2021", "20", "100", "ASL", "3", "42", "A01", "1,00"],
            ["2021", "20", "100", "ASL", "1", "42A", "A01", "2,00"],
        ], "ascii")
        result = etl.profile(self.spending, self.registry, self.cnd)
        self.assertEqual(result["join"]["invalidKeyRows"], 2)
        self.assertEqual(result["join"]["missingKeyRows"], 0)
        self.assertEqual(result["join"]["notFoundRows"], 0)
        self.assertEqual(result["join"]["unresolvedEuroExact"], "3.00")

    def test_committed_source_lock_is_self_consistent(self):
        spec = etl.load_spec()
        self.assertEqual(spec["integrity"]["lockSha256"], etl.canonical_lock_sha256(spec))
        self.assertEqual(set(spec["spendingReleases"]), {str(year) for year in range(2012, 2024)})
        self.assertTrue(all(spec["spendingReleases"][str(year)]["licenseStatus"] == "IODL-2.0" for year in range(2012, 2022)))
        self.assertTrue(all(spec["spendingReleases"][year]["licenseStatus"] == "not-declared" for year in ("2022", "2023")))
        self.assertTrue(all(spec["spendingReleases"][year]["siteTermsUrl"].endswith("/note-legali-2/") for year in ("2022", "2023")))
        self.assertTrue(all(spec["spendingReleases"][str(year)]["acquisitionStatus"] == "cataloged-not-acquired" for year in range(2012, 2020)))
        self.assertTrue(all("archive" not in spec["spendingReleases"][str(year)] for year in range(2012, 2020)))

    def test_source_lock_rejects_license_period_and_url_drift(self):
        original = json.loads(etl.DEFAULT_SPEC.read_text(encoding="utf-8"))
        for field, value, message in (
            ("licenseStatus", "CC-BY-4.0", "Licenza"),
            ("referencePeriod", "2021", "Periodo"),
            ("downloadUrl", "https://example.test/file.zip", "URL ufficiale"),
            ("publicationDisposition", "publish", "Selezione release"),
        ):
            with self.subTest(field=field):
                changed = json.loads(json.dumps(original))
                changed["spendingReleases"]["2022"][field] = value
                changed["integrity"]["lockSha256"] = etl.canonical_lock_sha256(changed)
                path = self.root / f"bad-{field}.json"
                path.write_text(json.dumps(changed), encoding="utf-8")
                with self.assertRaisesRegex(etl.SourceError, message):
                    etl.load_spec(path)

    def test_zip_member_bytes_and_hash_are_verified(self):
        member = "Appendice rapporto 2021.csv"
        with zipfile.ZipFile(self.spending) as archive:
            payload = archive.read(member)
        expected = {
            "member": member,
            "memberBytes": len(payload),
            "memberSha256": hashlib.sha256(payload).hexdigest(),
        }
        etl._verify_zip_member(self.spending, expected, "fixture")
        expected["memberSha256"] = "0" * 64
        with self.assertRaisesRegex(etl.SourceError, "Byte membro"):
            etl._verify_zip_member(self.spending, expected, "fixture")
