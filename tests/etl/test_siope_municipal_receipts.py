import copy
import hashlib
import json
import sys
import tempfile
import unittest
import zipfile
from pathlib import Path
from unittest.mock import patch

ROOT = Path(__file__).resolve().parents[2]
sys.path.insert(0, str(ROOT / "scripts" / "etl"))

import siope_municipal_core as core
import siope_municipal_receipts_snapshot as receipts
import siope_municipal_snapshot as expenditure
import siope_receipts_spec as spec
from siope_receipts_check import check_committed_snapshots, validate_snapshot


class MunicipalReceiptsTests(unittest.TestCase):
    def setUp(self):
        self.workspace = tempfile.TemporaryDirectory(prefix=".siope-test-", dir=ROOT)
        self.addCleanup(self.workspace.cleanup)
        self.root = Path(self.workspace.name)
        self.registry = self.root / "registry.zip"
        self.ipa = self.root / "amministrazioni.txt"
        self.movements = self.root / "movements.zip"
        self.registry_rows = (
            "A,2020-01-01,9999-12-31,00000000001,COMUNE A,001,001,100,COMUNE\n"
            "B,2020-01-01,9999-12-31,00000000002,COMUNE B,002,001,200,COMUNE\n"
            "C,2020-01-01,9999-12-31,00000000003,COMUNE C,003,001,300,COMUNE\n"
            "D,2020-01-01,9999-12-31,00000000004,COMUNE D,004,002,00000001,COMUNE\n"
            "E,2020-01-01,9999-12-31,00000000005,COMUNE E,005,001,500,COMUNE\n"
            "N,2020-01-01,9999-12-31,00000000009,OTHER ENTITY,009,001,900,REGIONE\n"
        )
        self.write_registry(self.registry_rows)
        self.ipa.write_text(
            "cf;regione;cod_amm\n"
            "00000000001;Piemonte;c_a\n"
            "00000000002;Piemonte;c_b\n00000000002;Piemonte;other_b\n"
            "00000000003;Piemonte;c_c\n00000000003;Lazio;c_c\n"
            "00000000004;Lazio;c_d\n00000000005;Piemonte;c_e\n",
            encoding="utf-8",
        )
        self.movement_rows = (
            "A,2026,01,1.01.01.01.001,1000\nA,2026,03,1.01.01.01.001,-100\n"
            "A,2026,01,2.01.01.01.001,0\nB,2026,01,9.01.01.01.001,0\n"
            "C,2026,03,3.01.01.01.001,700\nD,2026,01,1.01.01.01.001,100\n"
            "N,2026,01,1.01.01.01.001,99999\n"
        )
        self.write_movements(self.movement_rows)

    def write_registry(self, rows):
        with zipfile.ZipFile(self.registry, "w") as archive:
            archive.writestr("ANAG_REG_PROV.csv", "NORD,01,PIEMONTE,001,Torino\nCENTRO,12,LAZIO,002,Roma\n")
            archive.writestr("ANAG_ENTI_SIOPE.csv", rows)

    def write_movements(self, rows, member="ENTRATE_2026.csv"):
        with zipfile.ZipFile(self.movements, "w") as archive:
            archive.writestr(member, rows)

    def validators(self):
        return {
            key: {
                "sha256": hashlib.sha256(path.read_bytes()).hexdigest(),
                "lastModified": "Sat, 05 Sep 2026 00:00:00 GMT", "etag": '"test"',
                "acquisitionDate": "2026-09-05T00:00:00+00:00",
            }
            for key, path in (("movements", self.movements), ("registry", self.registry), ("ipa", self.ipa))
        }

    def build(self):
        with patch.object(core, "utc_now", return_value="2026-09-05T01:00:00+00:00"):
            summary = receipts.build_snapshot(
                year=2026, movements_zip=self.movements, registry_zip=self.registry,
                ipa_path=self.ipa, validators=self.validators(),
            )
        detail = summary.pop("_municipalityDetail")
        validate_snapshot(summary, detail)
        return summary, detail

    def test_exact_joins_population_absence_signed_cents_and_months(self):
        summary, detail = self.build()
        self.assertEqual(summary["totalCollected"], 17)
        self.assertEqual(summary["receiptsWithPopulation"], 16)
        self.assertEqual(summary["populationCovered"], 600)
        self.assertEqual(summary["coverage"]["receiptsWithoutRegion"], 7)
        self.assertEqual(summary["coverage"]["withoutRegion"], 1)
        self.assertEqual(summary["coverage"]["includedMovementRows"], 6)
        self.assertEqual(summary["coverage"]["movementRows"], 7)
        self.assertEqual([item["month"] for item in summary["monthly"]], [1, 3])
        self.assertEqual([item["flow"] for item in summary["monthly"]], [11, 6])
        rows = {row[0]: row for row in detail["municipalities"]}
        self.assertEqual(rows["00000000002"][6], 0)
        self.assertEqual(rows["00000000002"][7], [0] * 9)
        self.assertIsNone(rows["00000000002"][1])
        self.assertEqual(rows["00000000002"][4], "Piemonte")
        self.assertEqual(rows["00000000003"][1], "c_c")
        self.assertIsNone(rows["00000000003"][4])
        self.assertIsNone(rows["00000000004"][5])
        self.assertIsNone(rows["00000000005"][6])
        self.assertIsNone(rows["00000000005"][7])
        self.assertEqual(detail["generatedAt"], summary["source"]["observedAt"])
        self.assertIsNone(summary["source"]["publicationDate"])
        self.assertEqual(summary["source"]["license"], "not-declared")

    def test_amount_parser_is_strict_and_preserves_observed_zero(self):
        for value, expected in (("0", 0), ("000", 0), ("-101", -101), ("1234", 1234)):
            self.assertEqual(core.parse_amount(value), expected)
        for value in ("", " ", "1.2", "1,20", "+1", "NaN", "1e2", "１２", "9007199254740992"):
            with self.subTest(value=value), self.assertRaises(RuntimeError):
                core.parse_amount(value)

    def test_malformed_municipal_inputs_block_instead_of_skipping(self):
        malformed_rows = (
            "A,2026,1,1", "A,2025,1,1,1", "A,2026,0,1,1", "A,2026,13,1,1",
            "A,2026,1.0,1,1", "A,2026,1,1,", "A,2026,1,1,1.2",
            "A,2026,1,8.01.01.01.001,1", "A,2026,1,x1,1",
            "A,2026,1,1,9007199254740992",
        )
        for row in malformed_rows:
            with self.subTest(row=row), self.assertRaises(RuntimeError):
                self.write_movements(self.movement_rows + row + "\n")
                self.build()

    def test_duplicate_movement_and_unsafe_aggregate_fail(self):
        for rows in (
            self.movement_rows + "A,2026,1,1.01.01.01.001,1000\n",
            "A,2026,1,1,9007199254740991\nA,2026,2,1,1\n",
        ):
            with self.subTest(rows=rows), self.assertRaises(RuntimeError):
                self.write_movements(rows)
                self.build()

    def test_wrong_or_ambiguous_zip_member_fails(self):
        self.write_movements(self.movement_rows, "ENTRATE_2025.csv")
        with self.assertRaises(RuntimeError):
            self.build()
        self.write_movements(self.movement_rows)
        with zipfile.ZipFile(self.movements, "a") as archive:
            archive.writestr("ENTRATE_2026.other.csv", self.movement_rows)
        with self.assertRaises(RuntimeError):
            self.build()

    def test_bad_registry_and_ipa_schema_fail(self):
        for rows in (
            self.registry_rows + "A,broken,COMUNE\n",
            self.registry_rows + self.registry_rows.splitlines()[0] + "\n",
            self.registry_rows.replace("A,2020-01-01", "A,not-a-date"),
        ):
            with self.subTest(rows=rows), self.assertRaises(RuntimeError):
                self.write_registry(rows)
                self.build()
        self.write_registry(self.registry_rows)
        self.ipa.write_text("cf;regione;cod_amm\n00000000001;Piemonte\n")
        with self.assertRaises(RuntimeError):
            self.build()

    def test_hash_is_computed_from_actual_input_bytes(self):
        validators = self.validators()
        validators["movements"]["sha256"] = "a" * 64
        with self.assertRaisesRegex(RuntimeError, "SHA-256"):
            receipts.build_snapshot(year=2026, movements_zip=self.movements, registry_zip=self.registry, ipa_path=self.ipa, validators=validators)

    def test_offline_raw_receipts_reject_changed_bytes_and_missing_provenance(self):
        fixtures = {"movements": self.movements, "registry": self.registry, "ipa": self.ipa}
        names = {"movements": "SIOPE_ENTRATE.2026.zip", "registry": "SIOPE_ANAGRAFICHE.zip", "ipa": "amministrazioni.txt"}
        for key, fixture in fixtures.items():
            path = self.root / names[key]
            path.write_bytes(fixture.read_bytes())
            metadata = self.validators()[key] | {"url": receipts.source_urls(2026)[key], "byteSize": path.stat().st_size}
            path.with_name(path.name + ".metadata.json").write_text(json.dumps(metadata))
        paths, validators = receipts.acquired_inputs(self.root, 2026, offline=True)
        self.assertEqual(validators["movements"]["sha256"], hashlib.sha256(paths["movements"].read_bytes()).hexdigest())
        sidecar = paths["movements"].with_name(paths["movements"].name + ".metadata.json")
        original = json.loads(sidecar.read_text())
        for changes in ({"url": "https://example.com/other.zip"}, {"sha256": "a" * 64}, {"byteSize": 0}, {"acquisitionDate": None}, {"acquisitionDate": "2026-09-05"}):
            sidecar.write_text(json.dumps(original | changes))
            with self.subTest(changes=changes), self.assertRaises(RuntimeError):
                receipts.acquired_inputs(self.root, 2026, offline=True)

    def test_acquisition_uses_instants_not_lexicographic_timezone_order(self):
        validators = self.validators()
        validators["registry"]["acquisitionDate"] = "2026-09-05T01:00:00+02:00"
        with patch.object(core, "utc_now", return_value="2026-09-05T01:00:00+00:00"):
            summary = receipts.build_snapshot(year=2026, movements_zip=self.movements, registry_zip=self.registry, ipa_path=self.ipa, validators=validators)
        self.assertEqual(summary["source"]["acquisitionDate"], "2026-09-05T00:00:00+00:00")
        validators["registry"]["acquisitionDate"] = None
        with self.assertRaises(RuntimeError):
            receipts.build_snapshot(year=2026, movements_zip=self.movements, registry_zip=self.registry, ipa_path=self.ipa, validators=validators)

    def test_checker_rejects_period_after_acquisition(self):
        summary, detail = self.build()
        earlier = "2026-02-05T00:00:00+00:00"
        summary.update(generatedAt=earlier)
        detail.update(generatedAt=earlier)
        summary["source"].update(observedAt=earlier, acquisitionDate=earlier)
        with self.assertRaisesRegex(ValueError, "future movement period"):
            validate_snapshot(summary, detail)

    def test_duplicate_codes_for_one_tax_code_aggregate_once(self):
        self.write_registry(self.registry_rows + "A2,2020-01-01,9999-12-31,00000000001,COMUNE A,001,001,100,COMUNE\n")
        self.write_movements(self.movement_rows + "A2,2026,1,1,50\n")
        summary, detail = self.build()
        self.assertEqual(summary["totalCollected"], 17.5)
        self.assertEqual(detail["coverage"]["activeMunicipalities"], 5)
        self.assertEqual(detail["municipalities"][0][6], 950)

    def test_offline_checker_rejects_mutations(self):
        summary, detail = self.build()
        mutations = (
            lambda s, d: s.update(totalCollected=s["totalCollected"] + 0.01),
            lambda s, d: s.update(totalCollected=float("nan")),
            lambda s, d: s.update(unit="EUR-cent"),
            lambda s, d: s.update(year=2023),
            lambda s, d: s["source"].update(siopeMovementsSha256="bad"),
            lambda s, d: s["source"].update(siopeMovementsUrl="https://example.com/data.zip"),
            lambda s, d: s["source"].update(publicationDate=s["generatedAt"]),
            lambda s, d: s["coverage"].update(malformedRows=1),
            lambda s, d: s["monthly"][0].update(cumulative=99),
            lambda s, d: s["regions"][0].update(value=99),
            lambda s, d: s["regions"][0].update(population=float(s["regions"][0]["population"])),
            lambda s, d: d["municipalities"][1].__setitem__(1, d["municipalities"][0][1]),
            lambda s, d: s["titles"][0].update(value=99),
            lambda s, d: d["municipalities"].append(d["municipalities"][0]),
            lambda s, d: d["municipalities"][0][7].__setitem__(1, 999),
            lambda s, d: d["municipalities"][-1].__setitem__(6, 0),
            lambda s, d: d.update(generatedAt="2026-01-01T00:00:00+00:00"),
        )
        for mutation in mutations:
            s, d = copy.deepcopy(summary), copy.deepcopy(detail)
            mutation(s, d)
            with self.subTest(mutation=mutation), self.assertRaises((ValueError, RuntimeError)):
                validate_snapshot(s, d)

    def test_skip_requires_both_valid_contracts_and_http_validators(self):
        summary, detail = self.build()
        output, detail_output = self.root / "summary.json", self.root / "detail.json"
        output.write_text(json.dumps(summary))
        detail_output.write_text(json.dumps(detail))
        validators = self.validators()
        self.assertTrue(receipts.is_unchanged(output, detail_output, 2026, validators))
        validators["movements"]["etag"] = '"changed"'
        self.assertFalse(receipts.is_unchanged(output, detail_output, 2026, validators))
        validators = self.validators()
        detail["municipalities"][0][6] += 1
        detail_output.write_text(json.dumps(detail))
        self.assertFalse(receipts.is_unchanged(output, detail_output, 2026, validators))
        detail_output.unlink()
        self.assertFalse(receipts.is_unchanged(output, detail_output, 2026, validators))

    def test_expenditure_uses_same_shared_joins_and_keeps_distribution_rankings(self):
        self.assertIs(expenditure.load_municipalities, core.load_municipalities)
        self.assertIs(expenditure.parse_population, core.parse_population)
        self.write_movements(self.movement_rows.replace("9.01.01.01.001", "7.01.01.01.001"), "USCITE_2026.csv")
        result = expenditure.build_snapshot(year=2026, movements_zip=self.movements, registry_zip=self.registry, ipa_path=self.ipa, validators=self.validators())
        self.assertEqual(result["schemaVersion"], 3)
        self.assertEqual(result["totalPaid"], 17)
        self.assertEqual(result["coverage"]["paymentsWithoutRegion"], 7)
        self.assertEqual(result["topMunicipalities"], result["topMunicipalitiesByValue"])
        self.assertEqual(result["topMunicipalitiesByValue"][0]["name"], "COMUNE A")
        self.assertEqual(result["distribution"]["schemaVersion"], 2)
        self.assertEqual(result["distribution"]["coverage"]["municipalitiesWithMovements"], 4)
        self.assertEqual(result["_municipalityDetail"]["titleOrder"], ["0", "1", "2", "3", "4", "5", "7"])

    def test_committed_official_receipts_all_years_validate_offline(self):
        result = check_committed_snapshots()
        self.assertEqual([item["year"] for item in result], [2024, 2025, 2026])
        self.assertTrue(all(item["municipalities"] > 7000 for item in result))

    def test_joint_refresh_manifest_and_source_spec(self):
        manifest = json.loads((ROOT / "scripts/ci/generated-artifacts.json").read_text())
        artifact = next(item for item in manifest["artifacts"] if item["id"] == "siope-municipal")
        for year in (2024, 2025, 2026):
            for path in receipts.paths_for_year(year):
                self.assertIn(path.as_posix(), artifact["files"])
        self.assertEqual(artifact["publication"]["branch"], "automation/data/siope")
        self.assertIn("--include-expenditure", artifact["offlineCheck"]["command"])
        self.assertEqual(spec.SPEC["scope"], "COMUNE")
        self.assertEqual(spec.SPEC["license"], "not-declared")
        sources = spec.SPEC["sources"]
        for year in receipts.YEARS:
            urls = receipts.source_urls(year)
            self.assertEqual(sources["movements"]["urlTemplate"].format(year=year), urls["movements"])
            self.assertEqual(sources["registry"]["url"], urls["registry"])
            self.assertEqual(sources["ipa"]["url"], urls["ipa"])
        self.assertEqual(sources["movements"]["maximumAbsoluteCents"], core.MAX_SAFE_CENTS)
        self.assertEqual(spec.SPEC["refreshCronUtc"], "29 4 * * *")
        workflow = (ROOT / ".github/workflows/siope-refresh.yml").read_text()
        self.assertIn("npm ci --ignore-scripts", workflow)
        self.assertIn("tests/siope-receipts.test.mjs", workflow)


if __name__ == "__main__":
    unittest.main()
