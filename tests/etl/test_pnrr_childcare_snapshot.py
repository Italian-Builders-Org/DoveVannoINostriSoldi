import csv
import hashlib
import importlib.util
import json
import tempfile
import unittest
from copy import deepcopy
from unittest import mock
from pathlib import Path

MODULE_PATH = Path(__file__).parents[2] / "scripts/etl/pnrr_childcare_snapshot.py"
SPEC = importlib.util.spec_from_file_location("pnrr_childcare_snapshot", MODULE_PATH)
assert SPEC and SPEC.loader
etl = importlib.util.module_from_spec(SPEC)
SPEC.loader.exec_module(etl)
HEADER_FIXTURE = json.loads(
    (Path(__file__).parents[1] / "fixtures/pnrr-childcare/official-headers.json").read_text(
        encoding="utf-8"
    )
)


class PnrrChildcareSnapshotTests(unittest.TestCase):
    def setUp(self):
        self.temp = tempfile.TemporaryDirectory()
        self.root = Path(self.temp.name)
        self.paths = {key: self.root / f"{key}.csv" for key in ("projects", "locations", "tenders", "awardees")}
        cup = "A12345678901234"
        submeasure = "M4C1I1.01.00"

        project = {key: "" for key in etl.PROJECT_HEADERS}
        project.update({
            "Codice Univoco Submisura": submeasure,
            "CUP": cup,
            "Codice Locale Progetto": "LOCAL-1",
            "Titolo Progetto": "Nuovo asilo comunale",
            "Finanziamento PNRR": "1000,50",
            "Finanziamento Totale": "1250,50",
            "Finanziamento Totale Pubblico Netto": "1250,50",
            "Soggetto Attuatore": "Comune prova",
            "Data Inizio Progetto Prevista": "01/01/2025",
            "Data Fine Progetto Prevista": "31/12/2026",
            "Data di Estrazione": "13/06/2026",
            "Data Ultima Validazione": "12/06/2026",
            "Esito Ultima Validazione": "Validato",
        })
        location = {key: "" for key in etl.LOCATION_HEADERS}
        location.update({
            "Codice Univoco Submisura": submeasure,
            "CUP": cup,
            "Regione": "12",
            "Descrizione Regione": "Lazio",
            "Provincia": "058",
            "Descrizione Provincia": "Roma",
            "Comune": "058091",
            "Descrizione Comune": "Roma",
            "Percentuale di Localizzazione": "100,00",
            "Data di Estrazione": "13/06/2026",
        })
        tender = {key: "" for key in etl.TENDER_HEADERS}
        tender.update({
            "Codice Univoco Submisura": submeasure,
            "CUP": cup,
            "CIG": "123456789A",
            "Codice Interno PDA": "PDA-1",
            "Codice Procedura Utente": "PROC-1",
            "Oggetto Gara": "Lavori asilo",
            "Importo Complessivo Gara": "900,00",
            "Importo Aggiudicazione": "800,00",
            "Data Pubblicazione del CIG": "00/01/1900",
            "Data Aggiudicazione Definitiva": "################################################################",
            "Data di Estrazione": "13/06/2026",
        })
        awardee = {key: "" for key in etl.AWARDEE_HEADERS}
        awardee.update({
            "Codice Univoco Submisura": submeasure,
            "CUP": cup,
            "CIG": "123456789A",
            "Codice interno PDA": "PDA-1",
            "Codice Procedura Utente": "PROC-1",
            "Codice Fiscale/P.IVA": "01234567890",
            "Denominazione Aggiudicatario": "Impresa prova",
            "Data di Estrazione": "13/06/2026",
        })
        for key, row in (
            ("projects", project),
            ("locations", location),
            ("tenders", tender),
            ("awardees", awardee),
        ):
            with self.paths[key].open("w", encoding="utf-8-sig", newline="") as stream:
                writer = csv.DictWriter(
                    stream,
                    fieldnames=list(etl.OFFICIAL_CSV_HEADERS[key]),
                    delimiter=";",
                )
                writer.writeheader()
                writer.writerow(row)

        assets = {}
        official_file_names = {
            "projects": "PNRR_Progetti.csv",
            "locations": "PNRR_Localizzazione.csv",
            "tenders": "PNRR_Gare.csv",
            "awardees": "PNRR_Aggiudicatari_Gare.csv",
        }
        for key, path in self.paths.items():
            payload = path.read_bytes()
            assets[key] = {
                "fileName": official_file_names[key],
                "url": f"https://www.italiadomani.gov.it/{path.name}",
                "bytes": len(payload),
                "sha256": hashlib.sha256(payload).hexdigest(),
            }
        self.spec = {
            "schemaVersion": 1,
            "datasetId": "pnrr_asili",
            "submeasure": {"code": submeasure, "label": "Asili"},
            "observedAt": "2026-08-21T00:00:00Z",
            "source": {
                "owner": "Italia Domani",
                "landingUrl": "https://www.italiadomani.gov.it/catalogo",
                "license": "CC BY 4.0",
                "licenseUrl": "https://creativecommons.org/licenses/by/4.0/",
                "attribution": "Italia Domani",
                "assets": assets,
            },
            "csv": {
                "encoding": "utf-8-sig",
                "delimiter": ";",
                "submeasureHeader": "Codice Univoco Submisura",
                "extractionDateHeader": "Data di Estrazione",
                "headers": HEADER_FIXTURE,
            },
            "expected": {
                "referenceDate": "2026-06-13",
                "projectRows": 1,
                "uniqueProjects": 1,
                "locationRows": 1,
                "tenderRows": 1,
                "awardeeRows": 1,
                "projectsWithLocations": 1,
                "projectsWithTenders": 1,
                "projectsWithAwardees": 1,
                "municipalities": 1,
                "unmatchedAwardeeRows": 0,
            },
            "artifactBudgetBytes": 100_000,
        }

    def tearDown(self):
        self.temp.cleanup()

    def test_builds_exact_cup_cig_procedure_trace_and_preserves_missing_dates(self):
        data, meta = etl.build_snapshot(self.spec, self.paths, self.spec["observedAt"])
        project = data["projects"][0]
        self.assertEqual(project["funding"]["pnrrCents"], 100_050)
        self.assertEqual(project["tenders"][0]["publishedAt"], None)
        self.assertEqual(project["tenders"][0]["awardedAt"], None)
        self.assertEqual(project["awardees"][0]["cig"], project["tenders"][0]["cig"])
        self.assertEqual(meta["coverage"]["unmatchedAwardeeRows"], 0)
        self.assertEqual(meta["totals"]["awardAmountCents"], 80_000)

    def test_rejects_any_drift_from_the_locked_official_asset(self):
        self.paths["projects"].write_text("tampered", encoding="utf-8")
        with self.assertRaisesRegex(etl.StructuralError, "source lock non corrisponde"):
            etl.build_snapshot(self.spec, self.paths, self.spec["observedAt"])

    def test_generated_data_and_metadata_are_hash_bound(self):
        data, meta = etl.build_snapshot(self.spec, self.paths, self.spec["observedAt"])
        data_payload = etl.encoded_json(data, pretty=False)
        meta["integrity"]["dataArtifact"] = {
            "bytes": len(data_payload),
            "sha256": hashlib.sha256(data_payload).hexdigest(),
        }
        data_path = self.root / "data.json"
        meta_path = self.root / "meta.json"
        data_path.write_bytes(data_payload)
        meta_path.write_bytes(etl.encoded_json(meta, pretty=True))
        checked_data, checked_meta = etl.validate_artifacts(self.spec, data_path, meta_path)
        self.assertEqual(len(checked_data["projects"]), 1)
        self.assertEqual(checked_meta["integrity"]["dataArtifact"]["bytes"], len(data_payload))

    def test_atomic_pair_write_rolls_back_if_the_second_replace_fails(self):
        data_path = self.root / "pair.data.json"
        meta_path = self.root / "pair.meta.json"
        data_path.write_bytes(b"old-data")
        meta_path.write_bytes(b"old-meta")
        real_replace = etl.os.replace
        calls = 0

        def failing_replace(source, destination):
            nonlocal calls
            calls += 1
            if calls == 2:
                raise OSError("second replace failed")
            return real_replace(source, destination)

        with mock.patch.object(etl.os, "replace", side_effect=failing_replace):
            with self.assertRaisesRegex(OSError, "second replace failed"):
                etl.write_artifacts_atomically(data_path, meta_path, b"new-data", b"new-meta")
        self.assertEqual(data_path.read_bytes(), b"old-data")
        self.assertEqual(meta_path.read_bytes(), b"old-meta")

    def test_numeric_parsers_accept_decimal_dot_and_reject_malformed_values(self):
        self.assertEqual(etl.money_cents("1000.50", "amount"), 100_050)
        self.assertEqual(etl.share_basis_points("100.00", "share"), 10_000)
        with self.assertRaises(etl.StructuralError):
            etl.money_cents("1,2,3", "amount")

    def test_complete_official_headers_are_locked_as_a_strict_contract(self):
        self.assertEqual(
            {key: list(value) for key, value in etl.OFFICIAL_CSV_HEADERS.items()},
            HEADER_FIXTURE,
        )
        self.assertEqual(self.spec["csv"]["headers"], HEADER_FIXTURE)
        self.assertEqual(len(HEADER_FIXTURE["projects"]), 63)
        self.assertEqual(len(HEADER_FIXTURE["locations"]), 14)
        self.assertEqual(len(HEADER_FIXTURE["tenders"]), 19)
        self.assertEqual(len(HEADER_FIXTURE["awardees"]), 15)

    def test_source_spec_rejects_a_renamed_official_column(self):
        drifted = deepcopy(self.spec)
        drifted["csv"]["headers"]["projects"][-1] = "Stato Fase Iter Progetto"
        with self.assertRaisesRegex(etl.StructuralError, "contratto CSV inatteso"):
            etl.build_snapshot(drifted, self.paths, drifted["observedAt"])

    def test_source_spec_rejects_an_unexpected_asset_filename(self):
        drifted = deepcopy(self.spec)
        drifted["source"]["assets"]["projects"]["fileName"] = "renamed.csv"
        with self.assertRaisesRegex(etl.StructuralError, "fileName inatteso"):
            etl.build_snapshot(drifted, self.paths, drifted["observedAt"])

    def test_source_rejects_reordered_official_columns(self):
        original = self.paths["projects"].read_bytes()
        lines = original.splitlines(keepends=True)
        header = lines[0].decode("utf-8-sig").rstrip("\r\n").split(";")
        header[0], header[1] = header[1], header[0]
        lines[0] = (";".join(header) + "\r\n").encode("utf-8-sig")
        self.paths["projects"].write_bytes(b"".join(lines))
        asset = self.spec["source"]["assets"]["projects"]
        payload = self.paths["projects"].read_bytes()
        asset["bytes"] = len(payload)
        asset["sha256"] = hashlib.sha256(payload).hexdigest()
        with self.assertRaisesRegex(etl.StructuralError, "ordine o nomi"):
            etl.build_snapshot(self.spec, self.paths, self.spec["observedAt"])

    def test_source_rejects_invalid_framework_cig(self):
        original = self.paths["tenders"].read_bytes()
        text = original.decode("utf-8-sig").replace("123456789A", "INVALID", 1)
        self.paths["tenders"].write_text(text, encoding="utf-8-sig", newline="")
        asset = self.spec["source"]["assets"]["tenders"]
        payload = self.paths["tenders"].read_bytes()
        asset["bytes"] = len(payload)
        asset["sha256"] = hashlib.sha256(payload).hexdigest()
        # The fixture has an empty framework-CIG column. Put the malformed
        # value in that specific column without changing the header contract.
        with self.paths["tenders"].open(encoding="utf-8-sig", newline="") as stream:
            rows = list(csv.DictReader(stream, delimiter=";"))
        rows[0]["CIG"] = "123456789A"
        rows[0]["CIG Accordo Quadro"] = "INVALID"
        with self.paths["tenders"].open("w", encoding="utf-8-sig", newline="") as stream:
            writer = csv.DictWriter(stream, fieldnames=list(etl.OFFICIAL_CSV_HEADERS["tenders"]), delimiter=";")
            writer.writeheader()
            writer.writerows(rows)
        payload = self.paths["tenders"].read_bytes()
        asset["bytes"] = len(payload)
        asset["sha256"] = hashlib.sha256(payload).hexdigest()
        with self.assertRaisesRegex(etl.StructuralError, "CIG Accordo Quadro.*codice non valido"):
            etl.build_snapshot(self.spec, self.paths, self.spec["observedAt"])

    def test_source_lock_rejects_schema_additions_and_invalid_observation_time(self):
        original = self.paths["projects"].read_bytes()
        self.paths["projects"].write_bytes(original.replace(b"\r\n", b";Unexpected\r\n", 1))
        asset = self.spec["source"]["assets"]["projects"]
        payload = self.paths["projects"].read_bytes()
        asset["bytes"] = len(payload)
        asset["sha256"] = hashlib.sha256(payload).hexdigest()
        with self.assertRaisesRegex(etl.StructuralError, "ordine o nomi"):
            etl.build_snapshot(self.spec, self.paths, self.spec["observedAt"])

        invalid = deepcopy(self.spec)
        invalid["observedAt"] = "21/08/2026 12:00"
        with self.assertRaisesRegex(etl.StructuralError, "timestamp UTC"):
            etl.build_snapshot(invalid, self.paths, invalid["observedAt"])


if __name__ == "__main__":
    unittest.main()
