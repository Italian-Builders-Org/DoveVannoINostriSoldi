from __future__ import annotations

import csv
import hashlib
import io
import copy
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

    def write_archive(
        self,
        members: dict[str, list[dict[str, str]]],
        *,
        headers: list[str] | None = None,
        encoding: str = "utf-8-sig",
        delimiter: str = ";",
    ) -> None:
        headers = headers or etl.SOURCE_HEADERS
        with zipfile.ZipFile(self.archive, "w", compression=zipfile.ZIP_DEFLATED) as archive:
            for name, rows in members.items():
                output = io.StringIO(newline="")
                writer = csv.DictWriter(
                    output,
                    fieldnames=headers,
                    delimiter=delimiter,
                    lineterminator="\n",
                )
                writer.writeheader()
                writer.writerows(rows)
                archive.writestr(name, output.getvalue().encode(encoding))

    def row(self, **overrides: str) -> dict[str, str]:
        row = dict.fromkeys(etl.SOURCE_HEADERS, "")
        row.update(
            {
                "CUP": "A12B34567890001",
                "DESCRIZIONE_SINTETICA_CUP": "Scuola comunale",
                "ANNO_DECISIONE": "2024",
                "DATA_GENERAZIONE_CUP": "15/03/2024",
                "STATO_PROGETTO": "ATTIVO",
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

    def unique_cup(self, index: int) -> str:
        return f"A12{index:012d}"

    def official_row(self, **overrides: str) -> dict[str, str]:
        row = dict.fromkeys(etl.official_contract()["csv"]["headers"], "")
        row.update(
            {
                "CUP": "a12b34567890001",
                "DESCRIZIONE_SINTETICA_CUP": "  Progetto\nufficiale\t\x02 api_key=abc  ",
                "ANNO_DECISIONE": "2024",
                "STATO_PROGETTO": "ATTIVO",
                "COSTO_PROGETTO": "100",
                "FINANZIAMENTO_PROGETTO": "0",
                "SOGGETTO_TITOLARE": "  Comune\tufficiale  ",
                "PIVA_CODFISCALE_SOG_TITOLARE": "00000000000",
                "PIVA_CF_BENEFICIARIO": "RSSMRA80A01H501U",
                "CODICE_NATURA_INTERVENTO": "03",
                "NATURA_INTERVENTO": "Lavori pubblici",
                "COD_NATURA_DIPE": "03",
                "NATURA_DIPE": "Lavori",
                "CODICE_TIPO_INTERVENTO": "01",
                "TIPOLOGIA_INTERVENTO": "Nuova",
                "CODICE_AREA_INTERVENTO": "02",
                "AREA_INTERVENTO": "Area",
                "CODICE_SETTORE_INTERVENTO": "03",
                "SETTORE_INTERVENTO": "Settore",
                "CODICE_SOTTOSETTORE_INTERVENTO": "04",
                "SOTTOSETTORE_INTERVENTO": "Sottosettore",
                "CODICE_CATEGORIA_INTERVENTO": "05",
                "CATEGORIA_INTERVENTO": "Categoria",
                "DATA_GENERAZIONE_CUP": "15-MAR-2024",
                "INDIRIZZO_INTERVENTO": "Mai pubblicare",
                "DESCRIZIONE_INTERVENTO": "Excluded free text",
            }
        )
        row.update(overrides)
        return row

    def official_contract_for_archive(self) -> dict[str, object]:
        contract = copy.deepcopy(etl.official_contract())
        archive_bytes = self.archive.read_bytes()
        contract["sourceBytes"] = len(archive_bytes)
        contract["sourceSha256"] = hashlib.sha256(archive_bytes).hexdigest()
        members = []
        total_raw = 0
        with zipfile.ZipFile(self.archive) as archive:
            for info in sorted(archive.infolist(), key=lambda item: item.filename):
                members.append(
                    {
                        "name": info.filename,
                        "compressedBytes": info.compress_size,
                        "rawBytes": info.file_size,
                        "crc32": f"{info.CRC:08x}",
                        "flagBits": info.flag_bits,
                        "rows": 1,
                        "physicalLines": 2,
                        "quotedNewlineDelta": 0,
                    }
                )
                total_raw += info.file_size
        contract["archive"]["members"] = members
        contract["archive"]["totalRawBytes"] = total_raw
        contract["archive"]["expectedRows"] = 1
        contract["archive"]["expectedDistinctCups"] = 1
        profile = contract["observedProfile"]
        profile["totalRows"] = 1
        profile["distinctCups"] = 1
        profile["duplicateCups"] = 0
        profile["emptyCups"] = 0
        profile["invalidCups"] = 0
        profile["maxCupOccurrences"] = 1
        profile["states"] = {state: int(state == "ATTIVO") for state in profile["states"]}
        profile["publicSanitization"] = {
            "field": "DESCRIZIONE_SINTETICA_CUP",
            "affectedRows": 1,
            "changedRows": 1,
            "reasons": {"credential": 1},
        }
        return contract

    def chunk_descriptors(self, output: Path, manifest: dict[str, object]) -> list[dict[str, object]]:
        chunks: list[dict[str, object]] = []
        for group in manifest["chunkGroups"]:
            assert isinstance(group, dict)
            group_payload = json.loads((output / group["object"]["key"]).read_text())
            chunks.extend(group_payload["chunks"])
        return chunks

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
        self.assertEqual(first_manifest["schemaVersion"], 2)
        self.assertTrue(first_manifest["fixtureOnly"])
        self.assertEqual(first_manifest["licenseStatus"], "unverified")
        for field in (
            "referenceDate", "publicationDate", "lastModified", "observedAt",
            "acquiredAt", "landingUrl", "licenseUrl",
        ):
            self.assertIsNone(first_manifest[field])
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

        chunks = self.chunk_descriptors(self.root / "chunked", manifest)
        self.assertEqual(len(chunks), 2)
        self.assertEqual(
            [
                (chunk["firstSourceRow"], chunk["rowCount"])
                for chunk in chunks
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

    def test_build_rejects_nonempty_output(self):
        self.write_archive({"OpenCup_Progetti0.csv": [self.row()]})
        output = self.root / "already-used"
        output.mkdir()
        (output / "marker").write_text("keep", encoding="utf-8")
        with self.assertRaisesRegex(etl.SourceError, "non vuoto"):
            etl.build_fixture_release(self.archive, output, etl.synthetic_contract())

    def test_official_lock_projects_only_public_projection_and_redacts_identifiers(self):
        headers = etl.official_contract()["csv"]["headers"]
        self.write_archive(
            {"OpenCup_Progetti0.csv": [self.official_row()]},
            headers=headers,
            encoding="utf-8",
        )
        contract = self.official_contract_for_archive()

        projected = list(etl.project_archive(self.archive, contract))

        self.assertEqual(len(projected), 1)
        row = projected[0]
        cells = row["cells"]
        self.assertEqual(set(cells), set(contract["publicHeaders"]))
        self.assertEqual(cells["CUP"], "A12B34567890001")
        self.assertEqual(
            cells["DESCRIZIONE_SINTETICA_CUP"],
            "  Progetto\nufficiale\t\ufffd [credenziale rimossa]  ",
        )
        self.assertEqual(cells["SOGGETTO_TITOLARE"], "  Comune\tufficiale  ")
        self.assertEqual(cells["COSTO_PROGETTO"], "100")
        self.assertEqual(cells["DATA_GENERAZIONE_CUP"], "15-MAR-2024")
        self.assertIsNone(cells["PIVA_CODFISCALE_SOG_TITOLARE"])
        self.assertIsNone(cells["PIVA_CF_BENEFICIARIO"])
        self.assertEqual(
            row["redactions"],
            [
                {"field": "DESCRIZIONE_SINTETICA_CUP", "reason": "credential"},
                {"field": "PIVA_CODFISCALE_SOG_TITOLARE", "reason": "personal-identifier"},
                {"field": "PIVA_CF_BENEFICIARIO", "reason": "personal-identifier"},
            ],
        )
        self.assertNotIn("INDIRIZZO_INTERVENTO", cells)
        self.assertNotIn("DESCRIZIONE_INTERVENTO", cells)
        self.assertEqual(row["evidenceLabel"], "documented-fact")
        self.assertEqual(row["sourceUrls"], [contract["finalUrl"]])

        self.write_archive(
            {
                "OpenCup_Progetti0.csv": [
                    self.official_row(
                        PIVA_CODFISCALE_SOG_TITOLARE="",
                        PIVA_CF_BENEFICIARIO="",
                    )
                ]
            },
            headers=headers,
            encoding="utf-8",
        )
        empty_private_contract = self.official_contract_for_archive()
        empty_private = list(etl.project_archive(self.archive, empty_private_contract))[0]
        self.assertIsNone(empty_private["cells"]["PIVA_CODFISCALE_SOG_TITOLARE"])
        self.assertIsNone(empty_private["cells"]["PIVA_CF_BENEFICIARIO"])
        self.assertEqual(len(empty_private["redactions"]), 3)
        contract = empty_private_contract

        sample_output = self.root / "official-sample"
        sample_manifest = etl.build_release(
            self.archive,
            sample_output,
            contract,
            sample_rows=1,
        )
        self.assertTrue(sample_manifest["sampleOnly"])
        self.assertEqual(
            sample_manifest["sampleDefinition"],
            {"kind": "global-prefix", "rows": 1},
        )
        self.assertNotIn("fixtureOnly", sample_manifest)
        self.assertNotIn("publishedAt", sample_manifest)
        self.assertEqual(
            etl.verify_fixture_release(sample_output / "manifest.json")["verifiedRows"],
            1,
        )
        with self.assertRaisesRegex(etl.SourceError, "oltre le righe"):
            etl.build_release(
                self.archive,
                self.root / "official-sample-too-large",
                contract,
                sample_rows=2,
            )

        forged_manifest = copy.deepcopy(sample_manifest)
        forged_manifest.pop("sampleOnly")
        forged_manifest.pop("sampleDefinition")
        (sample_output / "manifest.json").write_bytes(etl.corpus.canonical_json(forged_manifest))
        with self.assertRaisesRegex(etl.SourceError, "Release ufficiale.*source lock"):
            etl.verify_fixture_release(sample_output / "manifest.json")

        output = self.root / "official-release"
        with self.assertRaisesRegex(etl.SourceError, "Contratto build ufficiale.*source lock"):
            etl.build_release(self.archive, output, contract)

    def test_official_lock_rejects_dialect_hash_member_and_projection_corruption(self):
        headers = etl.official_contract()["csv"]["headers"]
        self.write_archive(
            {"OpenCup_Progetti0.csv": [self.official_row()]},
            headers=headers,
            encoding="utf-8",
        )
        contract = self.official_contract_for_archive()
        for key in ("landingUrl", "initialUrl", "finalUrl", "licenseUrl"):
            with self.subTest(url=key):
                broken = copy.deepcopy(contract)
                broken[key] = "https://example.invalid/opencup"
                with self.assertRaisesRegex(etl.SourceError, "URL source lock"):
                    etl._validate_contract(broken)
        with self.subTest(url="metadata"):
            broken = copy.deepcopy(contract)
            broken["metadata"]["url"] = "https://example.invalid/Metadati.xlsx"
            with self.assertRaisesRegex(etl.SourceError, "URL metadati"):
                etl._validate_contract(broken)
        with self.subTest("hash"):
            broken = copy.deepcopy(contract)
            broken["sourceSha256"] = "0" * 64
            with self.assertRaisesRegex(etl.SourceError, "Hash o byte"):
                list(etl.project_archive(self.archive, broken))
        with self.subTest("member"):
            broken = copy.deepcopy(contract)
            broken["archive"]["members"][0]["crc32"] = "ffffffff"
            with self.assertRaisesRegex(etl.SourceError, "source lock"):
                list(etl.project_archive(self.archive, broken))
        with self.subTest("dialect"):
            broken = copy.deepcopy(contract)
            broken["csv"]["delimiter"] = ","
            with self.assertRaisesRegex(etl.SourceError, "Dialetto"):
                list(etl.project_archive(self.archive, broken))
        with self.subTest("money"):
            invalid = self.official_row(COSTO_PROGETTO="1,00")
            self.write_archive(
                {"OpenCup_Progetti0.csv": [invalid]},
                headers=headers,
                encoding="utf-8",
            )
            invalid_contract = self.official_contract_for_archive()
            with self.assertRaisesRegex(etl.SourceError, "Importo"):
                list(etl.project_archive(self.archive, invalid_contract))
        with self.subTest("state"):
            invalid = self.official_row(STATO_PROGETTO="Attivo")
            self.write_archive(
                {"OpenCup_Progetti0.csv": [invalid]},
                headers=headers,
                encoding="utf-8",
            )
            invalid_contract = self.official_contract_for_archive()
            with self.assertRaisesRegex(etl.SourceError, "Stato"):
                list(etl.project_archive(self.archive, invalid_contract))
        with self.subTest("required CUP"):
            invalid = self.official_row(CUP="")
            self.write_archive(
                {"OpenCup_Progetti0.csv": [invalid]},
                headers=headers,
                encoding="utf-8",
            )
            invalid_contract = self.official_contract_for_archive()
            with self.assertRaisesRegex(etl.SourceError, "obbligatorio"):
                list(etl.project_archive(self.archive, invalid_contract))
        with self.subTest("header"):
            altered_headers = [*headers[:-1], "HEADER_ALTERATO"]
            altered_row = dict(self.official_row())
            altered_row["HEADER_ALTERATO"] = altered_row.pop(headers[-1])
            self.write_archive(
                {"OpenCup_Progetti0.csv": [altered_row]},
                headers=altered_headers,
                encoding="utf-8",
            )
            altered_contract = self.official_contract_for_archive()
            with self.assertRaisesRegex(etl.SourceError, "Header"):
                list(etl.project_archive(self.archive, altered_contract))

    def test_full_fixture_proof_checks_every_referenced_object_and_preserves_manifest(self):
        self.write_archive(
            {
                "OpenCup_Progetti0.csv": [self.row() for _ in range(etl.INLINE_POSTING_REFS + 1)],
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
        self.assertEqual(proof["verifiedRows"], etl.INLINE_POSTING_REFS + 2)
        self.assertEqual(proof["verifiedPostingRefs"], etl.INLINE_POSTING_REFS + 2)

        directory = json.loads((output / manifest["rootIndex"]["key"]).read_text())
        leaf_descriptor = directory["children"][0]["node"]
        leaf = json.loads((output / leaf_descriptor["key"]).read_text())
        posting_root = json.loads((output / leaf["entries"][0]["postingRoot"]["key"]).read_text())
        posting_path = output / posting_root["children"][0]["node"]["key"]
        posting_path.write_bytes(b"{}\n")
        with self.assertRaises(etl.SourceError):
            etl.verify_fixture_release(output / "manifest.json")
        self.assertEqual((output / "manifest.json").read_bytes(), manifest_before)

    def test_scale_release_groups_chunks_and_inlines_small_cups_without_posting_objects(self):
        rows = [
            self.row(
                CUP=self.unique_cup(index),
                DESCRIZIONE_SINTETICA_CUP=f"Progetto {index}",
            )
            for index in range(5_000)
        ]
        self.write_archive({"OpenCup_Progetti0.csv": rows})
        output = self.root / "scale"
        traced_sql: list[str] = []

        manifest = etl.build_fixture_release(
            self.archive,
            output,
            etl.synthetic_contract(),
            sqlite_trace_callback=traced_sql.append,
        )

        manifest_bytes = (output / "manifest.json").stat().st_size
        object_paths = list((output / "sha256").iterdir())
        postings = []
        for path in object_paths:
            payload = path.read_bytes()
            try:
                value = json.loads(payload.decode("utf-8"))
            except (UnicodeDecodeError, json.JSONDecodeError):
                continue
            if isinstance(value, dict) and value.get("kind") == "postings":
                postings.append(path)

        self.assertEqual(manifest["distinctCups"], 5_000)
        self.assertEqual(
            [statement for statement in traced_sql if "FROM REFS WHERE CUP =" in statement.upper()],
            [],
        )
        self.assertEqual(
            [statement for statement in traced_sql if "GROUP BY CUP" in statement.upper()],
            [],
        )
        self.assertLess(manifest_bytes, 2 * 1024 * 1024)
        self.assertLess(len(object_paths), manifest["distinctCups"] // 10)
        self.assertEqual(postings, [])
        self.assertGreater(len(manifest["chunkGroups"]), 0)
        proof = etl.verify_fixture_release(output / "manifest.json")
        self.assertEqual(proof["verifiedRows"], 5_000)
        self.assertEqual(proof["verifiedPostingRefs"], 5_000)

    def test_large_posting_tree_locates_later_page_without_scanning_prior_pages(self):
        rows = [
            self.row(DESCRIZIONE_SINTETICA_CUP=f"Progetto {index}")
            for index in range(2 * etl.MAX_POSTING_REFS + 1)
        ]
        self.write_archive({"OpenCup_Progetti0.csv": rows})
        output = self.root / "posting-tree"
        manifest = etl.build_fixture_release(
            self.archive,
            output,
            etl.synthetic_contract(),
        )
        directory = json.loads((output / manifest["rootIndex"]["key"]).read_text())
        leaf = json.loads((output / directory["children"][0]["node"]["key"]).read_text())
        posting_root = leaf["entries"][0]["postingRoot"]

        reads: list[str] = []
        descriptor = posting_root
        position = etl.MAX_POSTING_REFS + 1
        while True:
            reads.append(descriptor["key"])
            node = json.loads((output / descriptor["key"]).read_text())
            if node["kind"] == "posting-directory":
                child = next(
                    child
                    for child in node["children"]
                    if child["start"] <= position < child["end"]
                )
                descriptor = child["node"]
                continue
            self.assertEqual(node["kind"], "postings")
            self.assertEqual(node["start"], etl.MAX_POSTING_REFS)
            self.assertEqual(len(node["refs"]), etl.MAX_POSTING_REFS)
            break

        self.assertEqual(len(reads), 2)
        self.assertEqual(
            etl.verify_fixture_release(output / "manifest.json"),
            {
                "verifiedObjects": len(list((output / "sha256").iterdir())),
                "verifiedPostingRefs": 2 * etl.MAX_POSTING_REFS + 1,
                "verifiedRows": 2 * etl.MAX_POSTING_REFS + 1,
            },
        )


if __name__ == "__main__":
    unittest.main()
