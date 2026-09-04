from __future__ import annotations

import copy
import hashlib
import importlib.util
import json
import sys
import tempfile
import unittest
import zipfile
from datetime import date
from pathlib import Path


ROOT = Path(__file__).resolve().parents[2]
MODULE_PATH = ROOT / "scripts" / "etl" / "anac_entity_procurement_coverage.py"
FIXTURE_DIR = ROOT / "tests" / "fixtures" / "anac-entity-procurement"
SPEC_PATH = ROOT / "scripts" / "etl" / "specs" / "anac-entity-procurement.source.json"
SPEC = importlib.util.spec_from_file_location("anac_entity_procurement_coverage", MODULE_PATH)
assert SPEC and SPEC.loader
MODULE = importlib.util.module_from_spec(SPEC)
sys.modules[SPEC.name] = MODULE
SPEC.loader.exec_module(MODULE)


def fixture_paths() -> tuple[list[Path], Path, Path, Path]:
    return (
        [FIXTURE_DIR / f"cig-{month:02}.csv" for month in range(1, 13)],
        FIXTURE_DIR / "stations.csv",
        FIXTURE_DIR / "awards.csv",
        FIXTURE_DIR / "awardees.csv",
    )


class AnacEntityProcurementCoverageTest(unittest.TestCase):
    @classmethod
    def setUpClass(cls) -> None:
        cig, stations, awards, awardees = fixture_paths()
        cls.manifest = MODULE.audit(
            cig,
            stations,
            awards,
            awardees,
            observed_at="2026-08-30T21:30:00Z",
        )

    def test_fixture_measures_dual_identity_and_raw_cig_partition(self) -> None:
        procedures = self.manifest["coverage"]["procedures"]
        identity = self.manifest["coverage"]["identity"]
        registry = self.manifest["coverage"]["registry"]

        self.assertEqual(procedures["rawRows"], 12)
        self.assertEqual(procedures["distinctRawCigs"], 12)
        self.assertEqual(procedures["cigsWithExactlyOnePrimary"], 12)
        self.assertEqual(procedures["cigsWithoutPrimary"], 0)
        self.assertEqual(procedures["cigsWithMultiplePrimary"], 0)
        self.assertEqual(procedures["distinctCigs"], 12)
        self.assertEqual(identity["resolved"], 4)
        self.assertEqual(identity["conflict"], 4)
        self.assertEqual(identity["unresolved"], 4)
        self.assertEqual(identity["via:cf-fallback"], 1)
        self.assertEqual(identity["via:ambiguous-cf"], 1)
        self.assertEqual(registry["distinctAusa"], 4)
        self.assertEqual(registry["rowsWithEntityCf"], 3)
        self.assertEqual(registry["rowsWithNonstandardCf"], 0)
        self.assertEqual(registry["cfWithMultipleAusa"], 1)

    def test_amount_policy_is_exact_and_never_multiplied_by_awardees(self) -> None:
        awards = self.manifest["coverage"]["awards"]
        contribution = self.manifest["amounts"]["awardContributionInCohort"]

        self.assertEqual(awards["distinctAwards"], 8)
        self.assertEqual(awards["exactDuplicateRows"], 1)
        self.assertEqual(awards["duplicateKeyGroups"], 1)
        self.assertEqual(contribution["statusRows"]["positive-exact-cent"], 3)
        self.assertEqual(contribution["statusRows"]["positive-subcent"], 1)
        self.assertEqual(contribution["positiveSum"], "140.101")
        self.assertFalse(self.manifest["amounts"]["awardeeMultiplication"])
        self.assertTrue(self.manifest["amounts"]["lotAndAwardAmountsAreDistinctFields"])

    def test_amount_classification_does_not_round_trailing_zero_subunits(self) -> None:
        self.assertEqual(MODULE.parse_amount("1.000")[0], "positive-exact-cent")
        self.assertEqual(MODULE.parse_amount("1.001")[0], "positive-subcent")
        self.assertEqual(MODULE.parse_amount("12,34")[0], "invalid")
        self.assertEqual(MODULE.parse_amount("")[0], "missing")
        self.assertEqual(MODULE.parse_amount("-0.50")[0], "negative")

    def test_entity_identifiers_fail_closed_on_placeholder_and_checksum(self) -> None:
        self.assertEqual(MODULE.classify_entity_cf(""), "missing")
        self.assertEqual(MODULE.classify_entity_cf("00000000000"), "placeholder")
        self.assertEqual(MODULE.classify_entity_cf("12345678904"), "invalid-checksum")
        self.assertEqual(MODULE.classify_entity_cf("12345678903"), "valid")
        self.assertEqual(MODULE.classify_entity_cf("RSSMRA85T10A562S"), "valid")
        self.assertEqual(MODULE.classify_entity_cf("RSSMRA85T10A562V"), "invalid-checksum")
        self.assertEqual(
            MODULE.resolve_identity("0000000000", "12345678903", {"0000000000": "12345678903"}, {})["status"],
            "conflict",
        )

    def test_identity_does_not_resolve_outside_station_interval(self) -> None:
        registry = {
            "0000000001": {
                "cf": "12345678903",
                "start_date": date(2025, 1, 1),
                "end_date": date(2025, 12, 31),
            }
        }
        result = MODULE.resolve_identity(
            "0000000001",
            "12345678903",
            registry,
            {"12345678903": ("0000000001",)},
            publication_date=date(2024, 12, 31),
            publication_date_status="valid",
        )
        self.assertEqual(result["status"], "unresolved")
        self.assertEqual(result["reason"], "ausa-outside-registry-interval")

    def test_check_artifact_compares_nested_source_contract_and_rejects_leak(self) -> None:
        specification, spec_hash = MODULE.load_source_spec(SPEC_PATH)
        parent, parent_hash = MODULE.verify_parent_spec(specification, SPEC_PATH)
        expected_inputs, expected_provenance = MODULE.expected_source_contract(
            specification,
            spec_path=SPEC_PATH,
            spec_hash=spec_hash,
            parent_spec=parent,
            parent_hash=parent_hash,
        )
        artifact = copy.deepcopy(self.manifest)
        artifact["inputs"] = expected_inputs
        artifact["provenance"] = expected_provenance
        artifact["sourceSpecSha256"] = spec_hash
        with tempfile.TemporaryDirectory() as temporary:
            path = Path(temporary) / "coverage.json"
            path.write_text(json.dumps(artifact), encoding="utf-8")
            MODULE.check_artifact(path, SPEC_PATH)
            drifted = copy.deepcopy(artifact)
            drifted["inputs"]["stations"]["sourceLastModified"] = "2099-01-01T00:00:00Z"
            path.write_text(json.dumps(drifted), encoding="utf-8")
            with self.assertRaisesRegex(MODULE.ContractError, "inputs non corrispondono"):
                MODULE.check_artifact(path, SPEC_PATH)
            leaked = copy.deepcopy(artifact)
            leaked["nested"] = {"rows": [{"raw": "12345678903"}]}
            path.write_text(json.dumps(leaked), encoding="utf-8")
            with self.assertRaisesRegex(MODULE.ContractError, "radice non chiusa"):
                MODULE.check_artifact(path, SPEC_PATH)

    def test_decimal_reconciliation_is_exact(self) -> None:
        broken = copy.deepcopy(self.manifest)
        broken["amounts"]["procedureLot"]["positiveSum"] = "135.58"
        with self.assertRaisesRegex(MODULE.ContractError, "riconciliazione decimale"):
            MODULE.validate_manifest(broken)

    def test_manifest_rejects_noncanonical_decimal_encodings(self) -> None:
        for invalid in (1, 1.0, "1e0", "+1", "01", "-0"):
            with self.subTest(invalid=invalid):
                broken = copy.deepcopy(self.manifest)
                broken["amounts"]["procedureLot"]["positive-exact-centSum"] = invalid
                with self.assertRaisesRegex(MODULE.ContractError, "decimale.*non canonico"):
                    MODULE.validate_manifest(broken)

    def test_manifest_schema_and_privacy_are_closed_world(self) -> None:
        mutations = (
            ("root extra", lambda item: item.__setitem__("rawTaxId", "12345678903")),
            ("scope value", lambda item: item["scope"].__setitem__("cohort", "all-time")),
            ("scope extra", lambda item: item["scope"].__setitem__("name", "SYNTH AUTH")),
            (
                "contract value",
                lambda item: item["contract"].__setitem__("amountRepresentation", "float"),
            ),
            ("contract extra", lambda item: item["contract"].__setitem__("entityCf", "12345678903")),
            ("privacy tax ids", lambda item: item["privacy"].__setitem__("containsRawTaxIds", True)),
            ("privacy names", lambda item: item["privacy"].__setitem__("containsNames", True)),
            ("privacy extra", lambda item: item["privacy"].__setitem__("rawName", "SYNTH AUTH")),
            ("inputs extra", lambda item: item["inputs"].__setitem__("entities", {})),
            ("provenance extra", lambda item: item["provenance"].__setitem__("rawSource", {})),
            ("coverage extra", lambda item: item["coverage"].__setitem__("entities", {})),
            ("amounts extra", lambda item: item["amounts"].__setitem__("roundedTotal", "0")),
            (
                "reconciliation extra",
                lambda item: item["reconciliation"].__setitem__("rawAwardRows", 0),
            ),
        )
        for label, mutate in mutations:
            with self.subTest(label=label):
                broken = copy.deepcopy(self.manifest)
                mutate(broken)
                with self.assertRaises(MODULE.ContractError):
                    MODULE.validate_manifest(broken)

    def test_conflicting_award_amount_is_excluded_instead_of_chosen(self) -> None:
        cig, stations, awards, awardees = fixture_paths()
        with tempfile.TemporaryDirectory() as temporary:
            conflicting_awards = Path(temporary) / "awards.csv"
            lines = awards.read_text(encoding="utf-8").splitlines()
            fields = lines[1].split(";")
            fields[7] = "200.00"
            lines.insert(2, ";".join(fields))
            conflicting_awards.write_text("\n".join(lines) + "\n", encoding="utf-8")
            manifest = MODULE.audit(
                cig,
                stations,
                conflicting_awards,
                awardees,
                observed_at="2026-08-30T21:30:00Z",
                generated_at="2026-08-30T22:03:55Z",
            )
        self.assertEqual(manifest["coverage"]["awards"]["amountConflictGroups"], 1)
        self.assertEqual(manifest["coverage"]["awards"]["criticalConflictGroups"], 1)
        contribution = manifest["amounts"]["awardContributionInCohort"]
        self.assertEqual(contribution["statusRows"]["conflicting"], 1)
        self.assertEqual(contribution["positiveSum"], "40.101")

    def test_identity_never_uses_denomination_and_handles_conflict(self) -> None:
        by_ausa = {"0000000001": "12345678903", "0000000002": "11111111115"}
        by_cf = {"12345678903": ("0000000001",), "11111111115": ("0000000002",)}
        resolved = MODULE.resolve_identity("", "11111111115", by_ausa, by_cf)
        self.assertEqual(resolved["stationKey"], "ausa:0000000002")
        self.assertEqual(resolved["entityKey"], "cf:11111111115")
        conflict = MODULE.resolve_identity("0000000001", "11111111115", by_ausa, by_cf)
        self.assertEqual(conflict["reason"], "ausa-cf-conflict")
        self.assertIsNone(conflict["entityKey"])
        unresolved = MODULE.resolve_identity("0000000001", "", {"0000000001": "CFAVCP-0001249"}, {})
        self.assertEqual(unresolved["reason"], "registry-cf-nonstandard")
        self.assertIsNone(unresolved["entityKey"])
        matching_nonstandard = MODULE.resolve_identity(
            "0000000001", "CFAVCP-0001249", {"0000000001": "CFAVCP-0001249"}, {}
        )
        self.assertEqual(matching_nonstandard["status"], "unresolved")
        self.assertEqual(matching_nonstandard["reason"], "registry-cf-nonstandard")

    def test_manifest_is_aggregate_only(self) -> None:
        serialized = json.dumps(self.manifest, ensure_ascii=False)
        for forbidden in (
            "12345678903",
            "11111111115",
            "SYNTH AUTH 1",
            "SYNTH PARTY ONE",
            "SYNTH CONFLICT",
        ):
            self.assertNotIn(forbidden, serialized)
        self.assertFalse(self.manifest["privacy"]["containsRawRows"])
        self.assertFalse(self.manifest["privacy"]["containsRawTaxIds"])
        self.assertFalse(self.manifest["privacy"]["containsNames"])

    def test_source_spec_and_station_archive_lock(self) -> None:
        specification, source_hash = MODULE.load_source_spec(SPEC_PATH)
        MODULE.validate_source_spec(specification)
        parent, parent_hash = MODULE.verify_parent_spec(specification, SPEC_PATH)
        self.assertEqual(parent_hash, specification["parentDependencies"]["parentSpecSha256"])
        self.assertEqual(parent["dataset"], "anac-awardees-coverage")
        with tempfile.TemporaryDirectory() as temporary:
            archive_path = Path(temporary) / "stations.zip"
            with zipfile.ZipFile(archive_path, "w", compression=zipfile.ZIP_DEFLATED) as archive:
                archive.writestr("stations.csv", (FIXTURE_DIR / "stations.csv").read_bytes())
            with zipfile.ZipFile(archive_path) as archive:
                member = archive.infolist()[0]
                member_hash = hashlib.sha256(archive.read(member)).hexdigest()
            station_lock = {
                "archiveBytes": archive_path.stat().st_size,
                "archiveSha256": hashlib.sha256(archive_path.read_bytes()).hexdigest(),
                "delimiter": ";",
                "encoding": "utf-8-sig",
                "headers": list(MODULE.STATION_HEADERS),
                "member": {
                    "name": "stations.csv",
                    "bytes": member.file_size,
                    "sha256": member_hash,
                    "crc32": f"{member.CRC:08x}",
                },
            }
            verified = MODULE.verify_locked_input(archive_path, station_lock)
            wrong_hash = copy.deepcopy(station_lock)
            wrong_hash["archiveSha256"] = "0" * 64
            with self.assertRaisesRegex(MODULE.ContractError, "SHA-256 archivio"):
                MODULE.verify_locked_input(archive_path, wrong_hash)
        self.assertEqual(verified["archiveSha256"], station_lock["archiveSha256"])
        self.assertEqual(len(source_hash), 64)
        self.assertEqual(specification["catalogObservedAt"], "2026-08-30T21:30:00Z")
        self.assertEqual(specification["inputs"]["stations"]["license"]["name"], "CC BY 4.0")

    def test_header_drift_fails_closed(self) -> None:
        cig, stations, awards, awardees = fixture_paths()
        with tempfile.TemporaryDirectory() as temporary:
            broken = Path(temporary) / "stations.csv"
            broken.write_text(
                stations.read_text(encoding="utf-8").replace(
                    "codice_fiscale;", "unexpected;", 1
                ),
                encoding="utf-8",
            )
            with self.assertRaisesRegex(MODULE.ContractError, "header inatteso"):
                MODULE.audit(cig, broken, awards, awardees, observed_at="2026-08-30T21:30:00Z")

    def test_station_datetime_and_inverted_interval(self) -> None:
        self.assertEqual(
            MODULE.parse_iso_date_or_datetime("2099-12-31 01:00:00.0").isoformat(),
            "2099-12-31",
        )
        cig, stations, awards, awardees = fixture_paths()
        with tempfile.TemporaryDirectory() as temporary:
            broken = Path(temporary) / "stations.csv"
            lines = stations.read_text(encoding="utf-8").splitlines()
            fields = lines[1].split(";")
            fields[-2:] = ["2025-01-01", "2024-12-31"]
            lines[1] = ";".join(fields)
            text = "\n".join(lines) + "\n"
            broken.write_text(text, encoding="utf-8")
            with self.assertRaisesRegex(MODULE.ContractError, "intervallo data stazione invertito"):
                MODULE.audit(cig, broken, awards, awardees, observed_at="2026-08-30T21:30:00Z")

    def test_manifest_partitions_fail_closed(self) -> None:
        broken = copy.deepcopy(self.manifest)
        broken["reconciliation"]["awardPairsOutOfCohort"] += 1
        with self.assertRaisesRegex(MODULE.ContractError, "in/out coorte"):
            MODULE.validate_manifest(broken)

    def test_manifest_counter_cardinalities_fail_closed(self) -> None:
        mutations = (
            ("registry", "registry", "distinctAusa", 1),
            ("identity reasons", "identity", "via:missing-both", 1),
            ("award groups", "awards", "duplicateKeyGroups", 20),
            ("awardee pairs", "awardees", "distinctJoinPairs", 20),
        )
        for label, section, key, increment in mutations:
            with self.subTest(label=label):
                broken = copy.deepcopy(self.manifest)
                broken["coverage"][section][key] += increment
                with self.assertRaises(MODULE.ContractError):
                    MODULE.validate_manifest(broken)

    def test_duplicate_primary_cig_fails_closed(self) -> None:
        cig, stations, awards, awardees = fixture_paths()
        with tempfile.TemporaryDirectory() as temporary:
            duplicate = Path(temporary) / "cig-02.csv"
            duplicate.write_text(
                cig[0].read_text(encoding="utf-8").replace(";2025;1;", ";2025;2;", 1),
                encoding="utf-8",
            )
            paths = [cig[0], duplicate, *cig[2:]]
            with self.assertRaisesRegex(MODULE.ContractError, "CIG con piu righe prevalenti"):
                MODULE.audit(paths, stations, awards, awardees, observed_at="2026-08-30T21:30:00Z")


if __name__ == "__main__":
    unittest.main()
