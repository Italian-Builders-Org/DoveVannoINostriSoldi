from __future__ import annotations

import copy
import csv
import gzip
import importlib.util
import json
import sys
import tempfile
import unittest
from datetime import date
from pathlib import Path
from unittest.mock import patch


ROOT = Path(__file__).resolve().parents[2]
MODULE_PATH = ROOT / "scripts" / "etl" / "anac_entity_procurement_page.py"
FIXTURE = ROOT / "tests" / "fixtures" / "anac-entity-procurement"
SPEC = importlib.util.spec_from_file_location("anac_entity_procurement_page", MODULE_PATH)
assert SPEC and SPEC.loader
MODULE = importlib.util.module_from_spec(SPEC)
sys.modules[SPEC.name] = MODULE
SPEC.loader.exec_module(MODULE)


def fixture_cig() -> list[Path]:
    return [FIXTURE / f"cig-{month:02}.csv" for month in range(1, 13)]


class AnacEntityProcurementPageTest(unittest.TestCase):
    def profile(self, cf: str = "12345678903", codice_ipa: str = "synth-one") -> dict[str, object]:
        with tempfile.TemporaryDirectory() as temporary:
            connection = MODULE.base.make_database(Path(temporary) / "fixture.sqlite")
            try:
                registry_by_ausa, registry_by_cf, _ = MODULE.base.load_registry(connection, FIXTURE / "stations.csv")
                MODULE.base.load_cig_inputs(
                    connection,
                    fixture_cig(),
                    list(range(1, 13)),
                    registry_by_ausa,
                    registry_by_cf,
                    date(2026, 8, 31),
                )
                MODULE.prepare_slim_awards(connection)
                MODULE.load_cohort_awards(connection, FIXTURE / "awards.csv", date(2026, 8, 31))
                MODULE.prepare_detail_tables(connection)
                awardees = Path(temporary) / "awardees.csv"
                text = (FIXTURE / "awardees.csv").read_text(encoding="utf-8")
                text += "A000000006;;11111111115;SINGLE VENDOR;IMPRESA;1\n"
                awardees.write_text(text, encoding="utf-8")
                MODULE.load_awardee_details(connection, awardees)
                return MODULE.profile_record(connection, cf, codice_ipa)
            finally:
                connection.close()

    def test_value_is_never_multiplied_and_only_single_operator_awards_are_attributed(self) -> None:
        profile = self.profile()
        summary = profile["summary"]
        self.assertEqual(summary["procedureCount"], 2)
        self.assertEqual(summary["awardCount"], 3)
        self.assertEqual(summary["awardValue"], "130.101")
        self.assertEqual(summary["attributedAwardValue"], "10.1")
        self.assertEqual(summary["unattributedAwardValue"], "120.001")
        self.assertEqual(summary["singleOperatorAwards"], 1)
        self.assertEqual(summary["multipartOrAmbiguousAwards"], 2)
        self.assertEqual(summary["awardsWithStableAwardees"], 2)
        self.assertEqual(summary["awardsWithoutStableAwardees"], 1)
        self.assertEqual(summary["singleOperatorAwards"] + summary["multipartOrAmbiguousAwards"], 3)
        self.assertEqual(summary["awardeeCount"], 2)
        self.assertEqual(sum(item["awardCount"] for item in profile["operators"]), 3)
        self.assertNotIn("ORPHAN VENDOR", {item["name"] for item in profile["operators"]})
        single = next(item for item in profile["awards"] if item["cig"] == "A000000006")
        self.assertEqual(single["attribution"], "single-operator")
        self.assertEqual(len(single["operatorRefs"]), 1)
        multipart = next(item for item in profile["awards"] if item["awardId"] == "1" and item["cig"] == "A000000001")
        self.assertEqual(multipart["attribution"], "multipart")
        self.assertEqual(len(multipart["operatorRefs"]), 2)
        ambiguous = next(item for item in profile["awards"] if item["awardId"] == "2")
        self.assertEqual(ambiguous["attribution"], "ambiguous")

    def test_no_awardee_is_separate_unstable_class(self) -> None:
        profile = self.profile("11111111115", "synth-two")
        self.assertEqual(profile["summary"]["awardsWithStableAwardees"], 0)
        self.assertEqual(profile["summary"]["awardsWithoutStableAwardees"], 2)
        self.assertEqual(profile["summary"]["multipartOrAmbiguousAwards"], 1)
        self.assertEqual(profile["awards"][0]["attribution"], "ambiguous")
        self.assertEqual(profile["awards"][1]["attribution"], "no-awardee")
        MODULE.validate_record(profile, "fixture-no-awardee")

    def test_public_record_contains_no_operator_identity_key(self) -> None:
        profile = self.profile()
        serialized = json.dumps(profile, ensure_ascii=False)
        self.assertNotIn("operator_cf", serialized)
        self.assertNotIn("operatorCf", serialized)
        self.assertNotIn("codiceAusa", serialized)
        self.assertNotIn("row_count", serialized)
        MODULE.validate_record(profile, "fixture")

    def test_operator_name_variants_are_public_values_not_keys(self) -> None:
        profile = self.profile()
        self.assertTrue(all(isinstance(item["nameVariants"], int) for item in profile["operators"]))
        self.assertEqual(profile["operators"][0]["nameVariants"], 2)

    def test_validator_rejects_float_extra_key_and_broken_reconciliation(self) -> None:
        profile = self.profile()
        floating = copy.deepcopy(profile)
        floating["summary"]["awardValue"] = 130.101
        with self.assertRaisesRegex(MODULE.ContractError, "decimale"):
            MODULE.validate_record(floating, "fixture")
        leaked = copy.deepcopy(profile)
        leaked["operators"][0]["operatorCf"] = "11111111115"
        with self.assertRaisesRegex(MODULE.ContractError, "chiavi inattese"):
            MODULE.validate_record(leaked, "fixture")
        broken = copy.deepcopy(profile)
        broken["summary"]["awardCount"] += 1
        with self.assertRaisesRegex(MODULE.ContractError, "cardinalita"):
            MODULE.validate_record(broken, "fixture")

    def test_validator_rejects_noncanonical_amount_spellings(self) -> None:
        for spelling in ("0.00", "-0", "+1", "01", "1e3"):
            profile = self.profile()
            profile["awards"][0]["amount"] = spelling
            with self.subTest(spelling=spelling), self.assertRaisesRegex(MODULE.ContractError, "decimale"):
                MODULE.validate_record(profile, "fixture")

        nonpositive = self.profile("11111111115", "synth-two")
        for spelling in ("0.00", "-0", "-0.00"):
            mutated = copy.deepcopy(nonpositive)
            mutated["awards"][0]["amount"] = spelling
            with self.subTest(zero_spelling=spelling), self.assertRaises(MODULE.ContractError):
                MODULE.validate_record(mutated, "fixture-zero")
        mutated = copy.deepcopy(nonpositive)
        mutated["awards"][1]["amount"] = "-0"
        with self.assertRaises(MODULE.ContractError):
            MODULE.validate_record(mutated, "fixture-negative")

        for status in ("missing", "invalid", "conflicting"):
            mutated = self.profile()
            mutated["awards"][0]["amountStatus"] = status
            mutated["awards"][0]["amount"] = "1"
            with self.subTest(nonpositive_status=status), self.assertRaises(MODULE.ContractError):
                MODULE.validate_record(mutated, "fixture-nonpositive")

    def test_award_amount_and_date_conflicts_are_fail_closed(self) -> None:
        with tempfile.TemporaryDirectory() as temporary:
            connection = MODULE.base.make_database(Path(temporary) / "conflict.sqlite")
            try:
                registry_by_ausa, registry_by_cf, _ = MODULE.base.load_registry(
                    connection, FIXTURE / "stations.csv"
                )
                MODULE.base.load_cig_inputs(
                    connection,
                    fixture_cig(),
                    list(range(1, 13)),
                    registry_by_ausa,
                    registry_by_cf,
                    date(2026, 8, 31),
                )
                MODULE.prepare_slim_awards(connection)
                conflict_path = Path(temporary) / "awards-conflict.csv"
                rows = list(csv.reader((FIXTURE / "awards.csv").read_text(encoding="utf-8").splitlines(), delimiter=";"))
                rows.append(list(rows[1]))
                # The duplicate key has both a different amount and a different
                # definitive date; neither value may survive the fail-closed merge.
                rows[-1][1] = "2025-01-22"
                rows[-1][7] = "999.00"
                conflict_path.write_text(
                    "\n".join(";".join(row) for row in rows) + "\n", encoding="utf-8"
                )
                MODULE.load_cohort_awards(connection, conflict_path, date(2026, 8, 31))
                amount_status, amount, date_status, award_date = connection.execute(
                    "SELECT amount_status, amount, award_date_status, award_date "
                    "FROM awards WHERE cig = 'A000000001' AND award_id = '1'"
                ).fetchone()
                self.assertEqual((amount_status, amount), ("conflicting", None))
                self.assertEqual((date_status, award_date), ("conflicting", None))
            finally:
                connection.close()

    def test_validator_rejects_mutated_operator_metrics_and_ranks(self) -> None:
        profile = self.profile()
        profile["operators"][0]["awardCount"] += 1
        with self.assertRaisesRegex(MODULE.ContractError, "metriche operatore"):
            MODULE.validate_record(profile, "fixture")

        profile = self.profile()
        profile["operators"].append({
            "ref": "op-000003", "name": "EXTRA", "nameVariants": 0,
            "awardCount": 0, "attributedAwardCount": 0, "attributedValue": "0",
            "rankByCount": 3, "rankByValue": None,
        })
        profile["summary"]["awardeeCount"] += 1
        with self.assertRaisesRegex(MODULE.ContractError, "senza relazioni"):
            MODULE.validate_record(profile, "fixture-extra-operator")

    def test_validator_rejects_non_iso_public_dates(self) -> None:
        profile = self.profile()
        profile["procedures"][0]["publishedAt"] = "2025-1-15"
        with self.assertRaisesRegex(MODULE.ContractError, "data non valida"):
            MODULE.validate_record(profile, "fixture-date")
        profile = self.profile()
        profile["awards"][0]["awardedAt"] = "2025-02-30"
        with self.assertRaisesRegex(MODULE.ContractError, "data non valida"):
            MODULE.validate_record(profile, "fixture-date")
        profile = self.profile()
        profile["operators"][0]["rankByCount"] = 2
        with self.assertRaisesRegex(MODULE.ContractError, "metriche operatore"):
            MODULE.validate_record(profile, "fixture")

    def test_ipa_crosswalk_fails_closed_on_ambiguous_tax_code(self) -> None:
        headers = ["Codice_IPA", "Codice_fiscale_ente"]
        with tempfile.TemporaryDirectory() as temporary:
            path = Path(temporary) / "ipa.csv"
            path.write_text(
                "Codice_IPA,Codice_fiscale_ente\none,12345678903\ntwo,12345678903\n",
                encoding="utf-8",
            )
            specification = {
                "ipa": {
                    "bytes": path.stat().st_size,
                    "sha256": MODULE.sha256_path(path),
                    "headers": headers,
                    "rows": 2,
                }
            }
            with self.assertRaisesRegex(MODULE.ContractError, "ambiguo"):
                MODULE.verify_ipa(path, specification)

    def test_ipa_crosswalk_rejects_conflicting_duplicate_code(self) -> None:
        headers = ["Codice_IPA", "Codice_fiscale_ente"]
        with tempfile.TemporaryDirectory() as temporary:
            path = Path(temporary) / "ipa.csv"
            path.write_text(
                "Codice_IPA,Codice_fiscale_ente\none,12345678903\none,11111111115\n",
                encoding="utf-8",
            )
            specification = {
                "ipa": {
                    "bytes": path.stat().st_size,
                    "sha256": MODULE.sha256_path(path),
                    "headers": headers,
                    "rows": 2,
                }
            }
            with self.assertRaisesRegex(MODULE.ContractError, "confliggenti"):
                MODULE.verify_ipa(path, specification)

    def test_check_artifact_reads_isolated_output_directory(self) -> None:
        specification, spec_hash = MODULE.load_spec(MODULE.DEFAULT_SPEC)
        parent_spec, _ = MODULE.base.load_source_spec(MODULE.PARENT_SPEC)
        meta = {
            "schemaVersion": 1,
            "dataset": "anac-entity-procurement-page",
            "distributionKind": "sharded-public-profile",
            "observedAt": specification["observedAt"],
            "generatedAt": "2026-08-31T15:30:00Z",
            "scope": specification["scope"],
            "contract": specification["contract"],
            "privacy": specification["privacy"],
            "provenance": MODULE.expected_provenance(specification, spec_hash, parent_spec),
            "coverage": {
                "ipaRows": 0,
                "ipaRowsWithUniqueValidTaxCode": 0,
                "ipaAmbiguousTaxCodes": 0,
                "ipaCodes": 0,
                "ipaRowsWithMissingOrInvalidTaxCode": 0,
                "resolvedAnacEntityTaxCodes": 0,
                "linkedEntityProfiles": 0,
                "resolvedAnacEntityTaxCodesWithoutIpa": 0,
                "awardeeRows": {
                    "rawRows": 0,
                    "ineligibleKeyRows": 0,
                    "knownKeyRows": 0,
                    "eligibleKeyRows": 0,
                    "outOfCohortRows": 0,
                    "resolvedRows": 0,
                    "unresolvedRows": 0,
                },
            },
            "totals": {
                "entities": 0, "procedures": 0, "awards": 0, "operators": 0,
                "awardeeRelations": 0, "positiveAwards": 0,
                "awardValue": "0", "attributedAwardValue": "0", "unattributedAwardValue": "0",
            },
            "shards": [],
            "sourceSpecSha256": spec_hash,
            "limitations": list(MODULE.LIMITATIONS),
        }
        with tempfile.TemporaryDirectory() as temporary:
            output = Path(temporary) / "isolated-artifact"
            shard_dir = output / "entities"
            shard_dir.mkdir(parents=True)
            for value in range(256):
                shard = shard_dir / f"{value:02x}.jsonl.gz"
                with shard.open("wb") as raw, gzip.GzipFile(fileobj=raw, mode="wb", mtime=0):
                    pass
                meta["shards"].append({
                    "id": f"{value:02x}",
                    "path": f"src/data/generated/anac-entity-procurement-page/entities/{value:02x}.jsonl.gz",
                    "bytes": shard.stat().st_size,
                    "sha256": MODULE.sha256_path(shard),
                    "entities": 0,
                })
            (output / "meta.json").write_text(json.dumps(meta), encoding="utf-8")
            MODULE.check_artifact(output)

    def test_coverage_rejects_partition_or_profile_drift(self) -> None:
        coverage = {
            "ipaRows": 3,
            "ipaRowsWithUniqueValidTaxCode": 2,
            "ipaAmbiguousTaxCodes": 0,
            "ipaCodes": 3,
            "ipaRowsWithMissingOrInvalidTaxCode": 1,
            "resolvedAnacEntityTaxCodes": 2,
            "linkedEntityProfiles": 2,
            "resolvedAnacEntityTaxCodesWithoutIpa": 0,
            "awardeeRows": {
                "rawRows": 4,
                "ineligibleKeyRows": 1,
                "knownKeyRows": 3,
                "eligibleKeyRows": 2,
                "outOfCohortRows": 1,
                "resolvedRows": 1,
                "unresolvedRows": 1,
            },
        }
        for key, value in (("ipaCodes", 2), ("linkedEntityProfiles", 1)):
            mutated = copy.deepcopy(coverage)
            mutated[key] = value
            with self.subTest(key=key), self.assertRaises(MODULE.ContractError):
                MODULE.validate_coverage(mutated)

    def test_atomic_publish_restores_previous_artifact_on_replace_failure(self) -> None:
        with tempfile.TemporaryDirectory() as temporary:
            root = Path(temporary)
            output = root / "artifact"
            staging = root / "staging"
            output.mkdir()
            staging.mkdir()
            (output / "marker").write_text("old", encoding="utf-8")
            (staging / "marker").write_text("new", encoding="utf-8")
            real_replace = MODULE.os.replace

            def fail_staging_publish(source: str | bytes | Path, destination: str | bytes | Path) -> None:
                if Path(source) == staging and Path(destination) == output:
                    raise OSError("synthetic publish failure")
                real_replace(source, destination)

            with patch.object(MODULE.os, "replace", side_effect=fail_staging_publish):
                with self.assertRaises(OSError):
                    MODULE.atomic_publish(staging, output)
            self.assertEqual((output / "marker").read_text(encoding="utf-8"), "old")
            self.assertTrue(staging.exists())

    def test_staging_database_has_explicit_size_bound(self) -> None:
        with tempfile.TemporaryDirectory() as temporary:
            connection = MODULE.base.make_database(Path(temporary) / "bounded.sqlite")
            try:
                MODULE.configure_bounded_database(connection, Path(temporary))
                page_size = int(connection.execute("PRAGMA page_size").fetchone()[0])
                max_pages = int(connection.execute("PRAGMA max_page_count").fetchone()[0])
                self.assertLessEqual(page_size * max_pages, MODULE.MAX_TEMP_DB_BYTES)
            finally:
                connection.close()

    def test_concentration_withholds_small_fixture_and_matches_equal_operator_hhi(self) -> None:
        profile = self.profile()
        withheld = MODULE.derive_concentration(profile)
        self.assertEqual(withheld["count"]["status"], "withheld")
        self.assertEqual(withheld["count"]["reason"], "below-minimum-observations")
        self.assertEqual(withheld["value"]["status"], "withheld")
        operators = [
            {
                "ref": f"op-{index:06d}",
                "name": f"Operatore {index:02d}",
                "nameVariants": 0,
                "awardCount": 1,
                "attributedAwardCount": 1,
                "attributedValue": "1",
                "rankByCount": index,
                "rankByValue": index,
            }
            for index in range(1, 31)
        ]
        equal = MODULE.derive_concentration({
            "summary": {
                "awardCount": 30,
                "attributedAwardValue": "30",
            },
            "operators": operators,
        })
        self.assertEqual(equal["count"]["status"], "published")
        self.assertEqual(equal["count"]["top1Share"], {"numerator": "1", "denominator": "30"})
        self.assertEqual(equal["count"]["top10Share"], {"numerator": "1", "denominator": "3"})
        self.assertEqual(equal["count"]["hhi10000"], {"numerator": "1000", "denominator": "3"})
        self.assertEqual(equal["value"]["hhi10000"], equal["count"]["hhi10000"])
        monopoly = MODULE.derive_concentration({
            "summary": {"awardCount": 30, "attributedAwardValue": "30"},
            "operators": [{
                "ref": "op-000001",
                "name": "Solo",
                "nameVariants": 0,
                "awardCount": 30,
                "attributedAwardCount": 30,
                "attributedValue": "30",
                "rankByCount": 1,
                "rankByValue": 1,
            }],
        })
        self.assertEqual(monopoly["count"]["hhi10000"], {"numerator": "10000", "denominator": "1"})
        self.assertEqual(monopoly["count"]["includedTop"], 1)


if __name__ == "__main__":
    unittest.main()
