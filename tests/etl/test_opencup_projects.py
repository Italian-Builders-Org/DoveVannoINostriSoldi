from __future__ import annotations

import csv
import io
import json
import tempfile
import unittest
import zipfile
from pathlib import Path

import opencup_projects as etl


class OpenCupProjectsTests(unittest.TestCase):
    def setUp(self):
        self.temporary = tempfile.TemporaryDirectory()
        self.root = Path(self.temporary.name)
        self.archive = self.root / "OpendataProgetti.zip"

    def tearDown(self):
        self.temporary.cleanup()

    def write_archive(self, members: dict[str, list[dict[str, str]]]) -> None:
        with zipfile.ZipFile(self.archive, "w", compression=zipfile.ZIP_DEFLATED) as archive:
            for name, rows in members.items():
                output = io.StringIO(newline="")
                writer = csv.DictWriter(
                    output,
                    fieldnames=etl.SOURCE_HEADERS,
                    delimiter=";",
                    lineterminator="\n",
                )
                writer.writeheader()
                writer.writerows(rows)
                archive.writestr(name, output.getvalue().encode("utf-8-sig"))

    def row(self, **overrides: str) -> dict[str, str]:
        row = dict.fromkeys(etl.SOURCE_HEADERS, "")
        row.update(
            {
                "CUP": "A12B34567890001",
                "DESCRIZIONE_SINTETICA_CUP": "Scuola comunale",
                "ANNO_DECISIONE": "2024",
                "DATA_GENERAZIONE_CUP": "15/03/2024",
                "STATO_PROGETTO": "Attivo",
                "COSTO_PROGETTO": "0",
                "FINANZIAMENTO_PROGETTO": "12345678901234,01",
                "SOGGETTO_TITOLARE": "Comune sintetico",
                "PIVA_CODFISCALE_SOG_TITOLARE": "00000000000",
                "PIVA_CF_BENEFICIARIO": "RSSMRA80A01H501U",
                "CODICE_NATURA_INTERVENTO": "03",
                "NATURA_INTERVENTO": "Realizzazione di lavori pubblici",
                "CODICE_TIPO_INTERVENTO": "01",
                "TIPOLOGIA_INTERVENTO": "Nuova realizzazione",
                "CODICE_REGIONE": "05",
                "REGIONE": "VENETO",
                "CODICE_COMUNE": "023091",
                "COMUNE": "VERONA",
            }
        )
        row.update(overrides)
        return row

    def test_money_parser_keeps_missing_zero_and_large_values_exact(self):
        self.assertIsNone(etl.parse_euro_cents(""))
        self.assertEqual(etl.parse_euro_cents("0"), 0)
        self.assertEqual(etl.parse_euro_cents("10,5"), 1050)
        self.assertEqual(etl.parse_euro_cents("12345678901234,01"), 1234567890123401)
        with self.assertRaises(etl.SourceError):
            etl.parse_euro_cents("10.50")

    def test_streaming_projection_preserves_duplicate_cup_and_redacts_identifiers(self):
        self.write_archive(
            {
                "OpenCup_Progetti0.csv": [
                    self.row(DESCRIZIONE_SINTETICA_CUP="Scuola\ncomunale"),
                    self.row(
                        CUP="B12B34567890002",
                        DESCRIZIONE_SINTETICA_CUP="Scuola\ncomunale",
                        FINANZIAMENTO_PROGETTO="",
                        CODICE_COMUNE="027042",
                        COMUNE="VENEZIA",
                    ),
                ],
                "OpenCup_Progetti1.csv": [self.row(COSTO_PROGETTO="10,50")],
            }
        )

        projected = list(etl.project_archive(self.archive, etl.synthetic_contract()))

        self.assertEqual([row["sourceRow"] for row in projected], [1, 2, 3])
        self.assertEqual(
            [row["cells"]["CUP"] for row in projected],
            ["A12B34567890001", "B12B34567890002", "A12B34567890001"],
        )
        self.assertEqual(projected[0]["cells"]["DESCRIZIONE_SINTETICA_CUP"], "Scuola\ncomunale")
        self.assertEqual(projected[0]["cells"]["COSTO_PROGETTO"], "0")
        self.assertIsNone(projected[1]["cells"]["FINANZIAMENTO_PROGETTO"])
        self.assertEqual(projected[1]["cells"]["COMUNE"], "VENEZIA")
        self.assertEqual(projected[2]["cells"]["COSTO_PROGETTO"], "10,50")
        for row in projected:
            self.assertIsNone(row["cells"]["PIVA_CODFISCALE_SOG_TITOLARE"])
            self.assertIsNone(row["cells"]["PIVA_CF_BENEFICIARIO"])
            self.assertEqual(
                row["redactions"],
                [
                    {"field": "PIVA_CODFISCALE_SOG_TITOLARE", "reason": "personal-identifier"},
                    {"field": "PIVA_CF_BENEFICIARIO", "reason": "personal-identifier"},
                ],
            )

    def test_fixture_release_reconciles_members_rows_index_and_is_deterministic(self):
        self.write_archive(
            {
                "OpenCup_Progetti1.csv": [self.row(CUP="B12B34567890002")],
                "OpenCup_Progetti0.csv": [self.row(), self.row(COSTO_PROGETTO="10,50")],
            }
        )
        first = self.root / "first"
        second = self.root / "second"

        first_manifest = etl.build_fixture_release(self.archive, first, etl.synthetic_contract())
        second_manifest = etl.build_fixture_release(self.archive, second, etl.synthetic_contract())

        self.assertEqual(first_manifest, second_manifest)
        self.assertEqual(first_manifest["sourceRows"], 3)
        self.assertEqual(first_manifest["publicRows"], 3)
        self.assertEqual(first_manifest["indexedRows"], 3)
        self.assertEqual(first_manifest["distinctCups"], 2)
        self.assertEqual(first_manifest["canary"], {"cup": "A12B34567890001", "sourceRow": 1})
        self.assertTrue(first_manifest["fixtureOnly"])
        self.assertEqual(first_manifest["licenseStatus"], "unverified")
        self.assertIsNone(first_manifest["observedAt"])
        self.assertIsNone(first_manifest["publishedAt"])
        self.assertEqual(len(first_manifest["sourceSpecSha256"]), 64)
        receipt = json.loads((first / "receipt.json").read_text())
        self.assertEqual(
            [(member["name"], member["firstSourceRow"], member["rowCount"]) for member in receipt["members"]],
            [
                ("OpenCup_Progetti0.csv", 1, 2),
                ("OpenCup_Progetti1.csv", 3, 1),
            ],
        )
        self.assertEqual((first / "manifest.json").read_bytes(), (second / "manifest.json").read_bytes())
        first_objects = sorted(
            (path.relative_to(first), path.read_bytes())
            for path in (first / "sha256").iterdir()
        )
        second_objects = sorted(
            (path.relative_to(second), path.read_bytes())
            for path in (second / "sha256").iterdir()
        )
        self.assertEqual(first_objects, second_objects)

    def test_fixture_release_keeps_chunk_source_ranges_contiguous(self):
        self.write_archive(
            {
                "OpenCup_Progetti0.csv": [
                    self.row(DESCRIZIONE_SINTETICA_CUP=f"Progetto {index}")
                    for index in range(etl.MAX_CHUNK_ROWS + 1)
                ]
            }
        )

        manifest = etl.build_fixture_release(
            self.archive,
            self.root / "chunked",
            etl.synthetic_contract(),
        )

        self.assertEqual(len(manifest["chunks"]), 2)
        self.assertEqual(
            [
                (chunk["firstSourceRow"], chunk["rowCount"])
                for chunk in manifest["chunks"]
            ],
            [(1, etl.MAX_CHUNK_ROWS), (etl.MAX_CHUNK_ROWS + 1, 1)],
        )

    def test_source_contract_rejects_invalid_money_unexpected_members_and_corruption(self):
        self.write_archive(
            {"OpenCup_Progetti0.csv": [self.row(COSTO_PROGETTO="10.50")]}
        )
        with self.assertRaisesRegex(etl.SourceError, "Importo"):
            list(etl.project_archive(self.archive, etl.synthetic_contract()))

        self.write_archive({"OpenCup_Progetti0.csv": [self.row()]})
        with zipfile.ZipFile(self.archive, "a") as archive:
            archive.writestr("../unexpected.csv", b"not allowed")
        with self.assertRaisesRegex(etl.SourceError, "inatteso o non sicuro"):
            list(etl.project_archive(self.archive, etl.synthetic_contract()))

        self.archive.write_bytes(b"not a zip")
        with self.assertRaisesRegex(etl.SourceError, "corrotto"):
            list(etl.project_archive(self.archive, etl.synthetic_contract()))

    def test_full_fixture_proof_checks_every_referenced_object_and_preserves_manifest(self):
        self.write_archive(
            {
                "OpenCup_Progetti0.csv": [self.row(), self.row()],
                "OpenCup_Progetti1.csv": [self.row(CUP="B12B34567890002")],
            }
        )
        output = self.root / "proof"
        manifest = etl.build_fixture_release(
            self.archive,
            output,
            etl.synthetic_contract(),
        )
        manifest_before = (output / "manifest.json").read_bytes()

        proof = etl.verify_fixture_release(output / "manifest.json")

        self.assertEqual(proof["verifiedObjects"], len(list((output / "sha256").iterdir())))
        self.assertEqual(proof["verifiedRows"], 3)
        self.assertEqual(proof["verifiedPostingRefs"], 3)

        directory = json.loads((output / manifest["rootIndex"]["key"]).read_text())
        leaf_descriptor = directory["children"][0]["node"]
        leaf = json.loads((output / leaf_descriptor["key"]).read_text())
        posting_path = output / leaf["entries"][0]["firstPage"]["key"]
        posting_path.write_bytes(b"{}\n")
        with self.assertRaises(etl.SourceError):
            etl.verify_fixture_release(output / "manifest.json")
        self.assertEqual((output / "manifest.json").read_bytes(), manifest_before)


if __name__ == "__main__":
    unittest.main()
