from __future__ import annotations

import csv
import hashlib
import json
import sys
import tempfile
import zipfile
from datetime import date
from pathlib import Path
from unittest import TestCase, mock

ROOT = Path(__file__).resolve().parents[2]
if str(ROOT / "scripts" / "etl") not in sys.path:
    sys.path.insert(0, str(ROOT / "scripts" / "etl"))

import siope_nonmunicipal as etl


def zipped(path: Path, members: dict[str, list[list[str]]]) -> None:
    with zipfile.ZipFile(path, "w") as archive:
        for name, rows in members.items():
            text = "\n".join(",".join(f'"{value}"' for value in row) for row in rows) + "\n"
            archive.writestr(name, text.encode("latin-1"))


class SiopeNonMunicipalTests(TestCase):
    def setUp(self) -> None:
        self.temporary = tempfile.TemporaryDirectory()
        self.root = Path(self.temporary.name)
        self.input = self.root / "input"; self.input.mkdir()
        self.output = self.root / "output"
        registry = {
            "ANAG_ENTI_SIOPE.csv": [
                ["100", "2024-01-01", "9999-12-31", "00000000001", "Provincia Test", "01", "001", "N.A.", "PROVINCIA"],
                ["200", "2024-01-01", "9999-12-31", "00000000002", "Regione Test", "01", "001", "N.A.", "REGIONE"],
                ["300", "2024-01-01", "9999-12-31", "00000000003", "Città Test", "01", "001", "N.A.", "CITTA_METROP"],
                ["301", "2024-01-01", "9999-12-31", "00000000001", "Provincia Storica", "01", "001", "N.A.", "PROVINCIA"],
                ["400", "2024-01-01", "9999-12-31", "00000000004", "ASL Test", "01", "001", "N.A.", "ASL"],
                ["500", "2025-01-01", "9999-12-31", "00000000005", "Provincia Futura", "01", "001", "N.A.", "PROVINCIA"],
                ["600", "2025-01-01", "9999-12-31", "00000000006", "Università Futura", "01", "001", "N.A.", "UNIVERSITA"],
            ],
            "ANAG_REG_PROV.csv": [["AREA", "01", "Test", "001", "Test Provincia"]],
            "ANAG_CODGEST_USCITE.csv": [
                ["1.01", "PRO", "Personale PRO", "2024-01-01", "9999-12-31"],
                ["1.01", "REG", "Personale REG", "2024-01-01", "9999-12-31"],
            ],
        }
        zipped(self.input / "SIOPE_ANAGRAFICHE.zip", registry)
        (self.input / "amministrazioni.txt").write_text(
            "cf\tcod_amm\tregione\n00000000001\tprov_test\tTest\n00000000002\treg_test\tTest\n00000000003\tmetro_test\tTest\n00000000003\tmetro_alt\tTest\n",
            encoding="utf-8",
        )
        for year in etl.YEARS:
            rows = [["100", str(year), "01", "1.01", "100"], ["200", str(year), "01", "1.01", "-100"], ["300", str(year), "02", "1.01", "0"], ["400", str(year), "03", "1.01", "9"]]
            if year == 2025:
                rows.append(["500", "2025", "04", "1.01", "7"])
            zipped(self.input / f"SIOPE_USCITE.{year}.zip", {f"USCITE_{year}.csv": rows})
        self.receipt = self.root / "input-receipt.json"
        self.write_input_receipt()

    def tearDown(self) -> None:
        self.temporary.cleanup()

    def projection_rows(self, name: str) -> list[dict[str, str]]:
        with (self.output / name).open(encoding="utf-8", newline="") as handle:
            return list(csv.DictReader(handle, delimiter="|"))

    def write_input_receipt(self) -> None:
        files = {}
        urls = {
            "SIOPE_ANAGRAFICHE.zip": f"{etl.core.SIOPE_BASE}/{etl.core.SIOPE_REGISTRY_FILE}",
            "amministrazioni.txt": etl.core.IPA_ADMINISTRATIONS_URL,
            **{f"SIOPE_USCITE.{year}.zip": f"{etl.core.SIOPE_BASE}/SIOPE_USCITE.{year}.zip" for year in etl.YEARS},
        }
        for name, url in urls.items():
            payload = (self.input / name).read_bytes()
            files[name] = {
                "url": url,
                "bytes": len(payload),
                "sha256": hashlib.sha256(payload).hexdigest(),
                "acquisitionDate": "2026-09-06T08:00:00+00:00",
                "etag": None,
                "lastModified": None,
            }
        self.receipt.write_text(json.dumps({
            "schemaVersion": 1,
            "scope": "non-municipal-payments-inputs",
            "files": files,
        }, ensure_ascii=False, sort_keys=True, separators=(",", ":")) + "\n", encoding="utf-8")

    def build(self) -> dict:
        return etl.build_release(
            input_dir=self.input,
            input_receipt=self.receipt,
            output_dir=self.output,
            acquired_at="2026-09-06T08:00:00+00:00",
        )

    def test_build_keeps_scopes_separate_and_preserves_zero_absence_and_join_status(self) -> None:
        manifest = self.build()
        self.assertEqual(manifest["inventoryRows"], 15)
        inventory = self.projection_rows("siope-inventario-enti.psv")
        province_2024 = next(row for row in inventory if row["entityType"] == "PROVINCIA" and row["year"] == "2024")
        self.assertEqual(province_2024["withoutMovementsCodes"], "1")
        self.assertEqual(province_2024["ipaMatched"], "2")
        self.assertEqual(province_2024["productStatus"], "published-payments")
        asl = next(row for row in inventory if row["entityType"] == "ASL" and row["year"] == "2024")
        self.assertEqual(asl["productStatus"], "census-only")
        self.assertEqual(asl["knownAmountCents"], "9")
        metro = self.projection_rows("siope-uscite-citta-metropolitane.psv")
        self.assertEqual(metro[0]["amountCents"], "0")
        self.assertEqual(metro[0]["codiceIpa"], "")
        self.assertEqual(metro[0]["ipaJoinStatus"], "ambiguous")
        region = self.projection_rows("siope-uscite-regioni.psv")
        self.assertEqual(region[0]["managementLabel"], "Personale REG")
        province = self.projection_rows("siope-uscite-province.psv")
        self.assertTrue(all(row["compartment"] == "PRO" for row in province))
        self.assertTrue(any(row["entityCode"] == "500" and row["year"] == "2025" for row in province))
        detail = json.loads((self.output / "siope-nonmunicipal-detail.json").read_text())
        provincial = next(entity for entity in detail["entities"] if entity["codiceIpa"] == "prov_test")
        self.assertEqual(provincial["years"][0]["status"], "available")
        self.assertEqual(provincial["years"][0]["monthly"], [{"month": 1, "amountCents": 100}])
        self.assertEqual(sum(entity["codiceIpa"] == "prov_test" for entity in detail["entities"]), 1)

    def test_rejects_duplicate_key_unknown_compartment_and_ambiguous_month_identity(self) -> None:
        duplicate = self.input / "SIOPE_USCITE.2024.zip"
        zipped(duplicate, {"USCITE_2024.csv": [["100", "2024", "01", "1.01", "1"], ["100", "2024", "01", "1.01", "1"]]})
        self.write_input_receipt()
        with self.assertRaisesRegex(etl.SiopeNonMunicipalError, "duplicata"):
            self.build()
        zipped(duplicate, {"USCITE_2024.csv": [["100", "2024", "01", "9.99", "1"]]})
        self.write_input_receipt()
        with self.assertRaisesRegex(etl.SiopeNonMunicipalError, "codice gestionale"):
            self.build()
        zipped(self.input / "SIOPE_ANAGRAFICHE.zip", {
            "ANAG_ENTI_SIOPE.csv": [
                ["100", "2024-01-01", "2024-12-31", "00000000001", "A", "01", "001", "N.A.", "PROVINCIA"],
                ["100", "2024-01-01", "2024-12-31", "00000000009", "B", "01", "001", "N.A.", "PROVINCIA"],
            ], "ANAG_REG_PROV.csv": [["AREA", "01", "Test", "001", "Test Provincia"]],
            "ANAG_CODGEST_USCITE.csv": [["1.01", "PRO", "Personale", "2024-01-01", "9999-12-31"]],
        })
        zipped(duplicate, {"USCITE_2024.csv": [["100", "2024", "01", "1.01", "1"]]})
        self.write_input_receipt()
        with self.assertRaisesRegex(etl.SiopeNonMunicipalError, "identità mensile ambigua"):
            self.build()

    def test_input_receipt_is_verified_before_parsing_and_never_rewritten(self) -> None:
        first = self.build()
        self.assertRegex(first["sources"]["2024"]["siopeMovementsSha256"], r"^[a-f0-9]{64}$")
        self.assertEqual(json.loads((self.output / "siope-nonmunicipal-release.json").read_text())["releaseId"], first["releaseId"])
        original_receipt = self.receipt.read_bytes()
        zipped(self.input / "SIOPE_USCITE.2024.zip", {"USCITE_2024.csv": [["100", "2024", "01", "1.01", "999"]]})
        with mock.patch.object(etl, "load_identities", wraps=etl.load_identities) as parser:
            with self.assertRaisesRegex(etl.SiopeNonMunicipalError, "byte input divergenti"):
                self.build()
            parser.assert_not_called()
        self.assertEqual(self.receipt.read_bytes(), original_receipt)

    def test_detail_keeps_successive_temporal_identities_separate(self) -> None:
        zipped(self.input / "SIOPE_ANAGRAFICHE.zip", {
            "ANAG_ENTI_SIOPE.csv": [
                ["100", "2024-01-01", "2024-06-30", "00000000001", "Ente A", "01", "001", "N.A.", "PROVINCIA"],
                ["100", "2024-07-01", "9999-12-31", "00000000002", "Ente B", "01", "001", "N.A.", "PROVINCIA"],
            ],
            "ANAG_REG_PROV.csv": [["AREA", "01", "Test", "001", "Test Provincia"]],
            "ANAG_CODGEST_USCITE.csv": [["1.01", "PRO", "Personale", "2024-01-01", "9999-12-31"]],
        })
        (self.input / "amministrazioni.txt").write_text(
            "cf\tcod_amm\tregione\n00000000001\tprov_test\tTest\n00000000002\treg_test\tTest\n",
            encoding="utf-8",
        )
        for year in etl.YEARS:
            rows = [["100", str(year), "01", "1.01", "400"]]
            if year == 2024:
                rows = [["100", "2024", "01", "1.01", "100"], ["100", "2024", "07", "1.01", "200"]]
            zipped(self.input / f"SIOPE_USCITE.{year}.zip", {f"USCITE_{year}.csv": rows})
        self.write_input_receipt()
        self.build()
        detail = json.loads((self.output / "siope-nonmunicipal-detail.json").read_text())
        totals = {
            entity["codiceIpa"]: next(year["amountCents"] for year in entity["years"] if year["year"] == 2024)
            for entity in detail["entities"]
        }
        self.assertEqual(totals, {"prov_test": 100, "reg_test": 200})

    def test_detail_ignores_predecessors_outside_published_years(self) -> None:
        identities = [
            etl.EntityIdentity("100", date(2005, 1, 1), date(2023, 12, 31), "00000000001", "Provincia precedente", "01", "001", "PROVINCIA"),
            etl.EntityIdentity("200", date(2024, 1, 1), date(9999, 12, 31), "00000000001", "Città metropolitana", "01", "001", "CITTA_METROP"),
            etl.EntityIdentity("300", date(2027, 1, 1), date(9999, 12, 31), "00000000001", "Ente futuro", "01", "001", "REGIONE"),
        ]
        result = etl.build_entity_detail(
            identities=identities,
            joins={"00000000001": etl.IpaJoin("metro_test", "matched", "Test", "matched")},
            payments={policy.key: [] for policy in etl.POLICIES},
            sources={str(year): {} for year in etl.YEARS},
            release_id="a" * 64,
        )
        self.assertEqual(len(result["entities"]), 1)
        entity = result["entities"][0]
        self.assertEqual(entity["entityType"], "CITTA_METROP")
        self.assertEqual(entity["includedCodes"], ["200"])
        self.assertTrue(all(year["status"] == "no_movements" for year in entity["years"]))

    def test_detail_rejects_same_cf_and_ipa_crossing_entity_types(self) -> None:
        zipped(self.input / "SIOPE_ANAGRAFICHE.zip", {
            "ANAG_ENTI_SIOPE.csv": [
                ["100", "2024-01-01", "9999-12-31", "00000000001", "Ente A", "01", "001", "N.A.", "PROVINCIA"],
                ["200", "2024-01-01", "9999-12-31", "00000000001", "Ente A", "01", "001", "N.A.", "REGIONE"],
            ],
            "ANAG_REG_PROV.csv": [["AREA", "01", "Test", "001", "Test Provincia"]],
            "ANAG_CODGEST_USCITE.csv": [
                ["1.01", "PRO", "Personale", "2024-01-01", "9999-12-31"],
                ["1.01", "REG", "Personale", "2024-01-01", "9999-12-31"],
            ],
        })
        (self.input / "amministrazioni.txt").write_text("cf\tcod_amm\tregione\n00000000001\tprov_test\tTest\n", encoding="utf-8")
        self.write_input_receipt()
        with self.assertRaisesRegex(etl.SiopeNonMunicipalError, "tipi distinti"):
            self.build()

    def test_inventory_records_unknown_and_outside_validity_movements_without_assigning_a_type(self) -> None:
        zipped(self.input / "SIOPE_USCITE.2024.zip", {"USCITE_2024.csv": [
            ["100", "2024", "01", "1.01", "100"],
            ["999", "2024", "01", "1.01", "900"],
            ["500", "2024", "01", "1.01", "700"],
        ]})
        self.write_input_receipt()
        manifest = self.build()
        self.assertEqual(manifest["unresolvedMovements"]["2024"], {
            "unknownCode": {"rows": 1, "amountCents": 900},
            "outsideValidity": {"rows": 1, "amountCents": 700},
        })
        inventory = [row for row in self.projection_rows("siope-inventario-enti.psv") if row["year"] == "2024"]
        self.assertTrue(all(row["coverageStatus"] == "partial" for row in inventory))
        self.assertTrue(all("non attribuiti a un tipo" in row["coverageNote"] for row in inventory))

    def test_candidate_detail_rejects_balanced_amount_provenance_and_release_tampering(self) -> None:
        self.build()
        detail_path = self.output / "siope-nonmunicipal-detail.json"
        manifest_path = self.output / "siope-nonmunicipal-release.json"
        etl.validate_candidate_detail(detail_path=detail_path, projection_dir=self.output, manifest_path=manifest_path)
        original = json.loads(detail_path.read_text())

        tampered = json.loads(json.dumps(original))
        entity = next(item for item in tampered["entities"] if item["codiceIpa"] == "prov_test")
        period = entity["years"][0]
        period["amountCents"] += 100
        period["monthly"][0]["amountCents"] += 100
        period["titles"][0]["amountCents"] += 100
        detail_path.write_text(json.dumps(tampered), encoding="utf-8")
        with self.assertRaisesRegex(etl.SiopeNonMunicipalError, "corpus canonico"):
            etl.validate_candidate_detail(detail_path=detail_path, projection_dir=self.output, manifest_path=manifest_path)

        for field, value in (
            ("siopeMovementsUrl", "https://example.invalid/unverified"),
            ("siopeMovementsSha256", "0" * 64),
            ("acquisitionDate", "2099-01-01T00:00:00Z"),
        ):
            tampered = json.loads(json.dumps(original))
            tampered["entities"][0]["years"][0]["provenance"][field] = value
            detail_path.write_text(json.dumps(tampered), encoding="utf-8")
            with self.assertRaises(etl.SiopeNonMunicipalError):
                etl.validate_candidate_detail(detail_path=detail_path, projection_dir=self.output, manifest_path=manifest_path)

        tampered = json.loads(json.dumps(original))
        tampered["releaseId"] = "f" * 64
        detail_path.write_text(json.dumps(tampered), encoding="utf-8")
        with self.assertRaisesRegex(etl.SiopeNonMunicipalError, "release"):
            etl.validate_candidate_detail(detail_path=detail_path, projection_dir=self.output, manifest_path=manifest_path)

    def test_committed_provenance_cannot_be_resealed_after_valid_looking_mutation(self) -> None:
        original = json.loads(etl.DEFAULT_DETAIL_PATH.read_text())
        for field, value in (("siopeMovementsSha256", hashlib.sha256(b"fabricated").hexdigest()), ("acquisitionDate", "2026-09-05T08:00:00+00:00")):
            with self.subTest(field=field):
                changed = json.loads(json.dumps(original))
                changed["entities"][0]["years"][0]["provenance"][field] = value
                path = self.root / "detail.json"
                path.write_bytes(etl.canonical_json(changed) + b"\n")
                with self.assertRaisesRegex(etl.SiopeNonMunicipalError, "provenienza|storica"):
                    etl.build_committed_view_proof(detail_path=path, view_proof_path=self.root / "proof.json")

    def test_manifest_retains_the_verified_input_receipt(self) -> None:
        manifest = self.build()
        self.assertEqual(manifest["inputReceipt"], json.loads(self.receipt.read_text()))
        manifest["inputReceipt"]["files"]["SIOPE_USCITE.2026.zip"]["sha256"] = hashlib.sha256(b"fabricated").hexdigest()
        path = self.output / "siope-nonmunicipal-release.json"
        path.write_bytes(etl.canonical_json(manifest) + b"\n")
        with self.assertRaisesRegex(etl.SiopeNonMunicipalError, "ricevuta|Ricevuta"):
            etl.validate_candidate_detail(detail_path=self.output / "siope-nonmunicipal-detail.json", projection_dir=self.output, manifest_path=path)
