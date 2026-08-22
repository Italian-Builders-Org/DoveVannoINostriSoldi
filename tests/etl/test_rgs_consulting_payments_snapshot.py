import copy
import hashlib
import importlib.util
import json
import sys
import unittest
from pathlib import Path


ROOT = Path(__file__).resolve().parents[2]
MODULE_PATH = ROOT / "scripts/etl/rgs_consulting_payments_snapshot.py"
SPEC_PATH = ROOT / "scripts/etl/specs/rgs-consulting-payments-2024-2025.source.json"
SNAPSHOT_PATH = ROOT / "src/data/generated/rgs-consulting-payments-2024-2025.json"
SPEC = importlib.util.spec_from_file_location("rgs_consulting_payments_snapshot", MODULE_PATH)
assert SPEC and SPEC.loader
ETL = importlib.util.module_from_spec(SPEC)
sys.modules[SPEC.name] = ETL
SPEC.loader.exec_module(ETL)


INDEX = {name: position for position, name in enumerate(ETL.HEADERS)}


def valid_row(
    *,
    year: int = 2024,
    chapter: str = "100",
    plan: str = "1",
    code: str = "2",
    label: str = "Consulenze, analisi e studi",
    paid_rs: str = "1.10",
    paid_cp: str = "2.20",
    paid_cs: str = "3.30",
) -> list[str]:
    row = [""] * len(ETL.HEADERS)
    values = {
        "Esercizio Finanziario": str(year),
        "Stato di Previsione": "99",
        "Amministrazione": "AMMINISTRAZIONE DI PROVA",
        "Numero Capitolo di Spesa": chapter,
        "Capitolo di Spesa": "CAPITOLO SINTETICO",
        "Numero Piano di Gestione": plan,
        "Piano di Gestione": "PIANO SINTETICO",
        "Codice CE 2° Livello": "2",
        "CE 2° Livello": "Spese per acquisto di servizi",
        "Codice CE 3° Livello": code,
        "CE 3° Livello": label,
        "Codice Missione": "001",
        "Missione": "MISSIONE SINTETICA",
        "Codice Programma": "002",
        "Programma": "PROGRAMMA SINTETICO",
        "Codice Centro Responsabilità": "3",
        "Centro Responsabilità": "CENTRO SINTETICO",
        "Codice Azione": "4",
        "Azione": "AZIONE SINTETICA",
        "Pagato RS": paid_rs,
        "Pagato CP": paid_cp,
        "Pagato CS": paid_cs,
    }
    for key, value in values.items():
        row[INDEX[key]] = value
    return row


def csv_payload(*rows: list[str], trailing: bool = False, trailing_value: str = "") -> bytes:
    header = ETL.HEADERS + ([""] if trailing else [])
    materialized = [row + ([trailing_value] if trailing else []) for row in rows]
    return (";".join(f'"{value}"' for value in header) + "\r\n" + "\r\n".join(
        ";".join(f'"{value}"' for value in row) for row in materialized
    ) + "\r\n").encode("cp1252")


def annual_contract(
    payload: bytes,
    *,
    year: int = 2024,
    trailing: bool = False,
    source_rows: int = 1,
    selected_rows: int = 1,
    paid_cents: int = 330,
) -> dict[str, object]:
    return {
        "year": year,
        "sourceBytes": len(payload),
        "sourceSha256": hashlib.sha256(payload).hexdigest(),
        "trailingEmptyField": trailing,
        "expectedSourceRows": source_rows,
        "expectedSelectedRows": selected_rows,
        "expectedPaidCents": paid_cents,
    }


class RgsConsultingPaymentsSnapshotTests(unittest.TestCase):
    def test_official_snapshot_discloses_scope_coverage_and_zero_rows(self):
        ETL.load_spec(SPEC_PATH)
        snapshot = json.loads(SNAPSHOT_PATH.read_text(encoding="utf-8"))
        ETL.validate_snapshot(snapshot, ETL.load_spec(SPEC_PATH))
        self.assertEqual(snapshot["years"], [2024, 2025])
        self.assertEqual(snapshot["amountUnit"], "euro_cents")
        self.assertIn("piano di gestione", snapshot["accountingGrain"].lower())
        self.assertEqual(snapshot["coverage"]["sourceRows"], 26226)
        self.assertEqual(snapshot["coverage"]["selectedRows"], 268)
        self.assertEqual(snapshot["coverage"]["zeroPaidRows"], 153)
        self.assertEqual(snapshot["coverage"]["paidCashCents"], 11357039641)
        self.assertEqual(
            [(item["year"], item["selectedRows"], item["paidCashCents"]) for item in snapshot["coverage"]["annual"]],
            [(2024, 132, 5057491173), (2025, 136, 6299548468)],
        )
        self.assertEqual(len(snapshot["rows"]), 268)
        self.assertEqual(len({row["id"] for row in snapshot["rows"]}), 268)
        self.assertEqual(sum(row["paidCashCents"] == 0 for row in snapshot["rows"]), 153)
        self.assertTrue(all(row["paidCashCents"] == row["paidResidualCents"] + row["paidCurrentCents"] for row in snapshot["rows"]))
        self.assertIn("non transazioni", " ".join(snapshot["caveats"]))
        self.assertIn("non è una classifica", " ".join(snapshot["caveats"]))
        self.assertIn("2026", " ".join(snapshot["caveats"]))
        self.assertEqual(snapshot["source"]["licenseVersion"], "3.0")
        self.assertEqual(snapshot["source"]["licenseEvidence"]["kind"], "record_landing_page_link")
        self.assertTrue(all("schemaUrl" in resource for resource in snapshot["source"]["resources"]))

    def test_snapshot_validator_rejects_semantic_row_and_coverage_mutations(self):
        spec = ETL.load_spec(SPEC_PATH)
        snapshot = json.loads(SNAPSHOT_PATH.read_text(encoding="utf-8"))
        bad_label = copy.deepcopy(snapshot)
        bad_label["rows"][0]["ce3Label"] = "Etichetta corrotta"
        with self.assertRaisesRegex(ETL.SnapshotError, "coppia CE3"):
            ETL.validate_snapshot(bad_label, spec)

        bad_coverage = copy.deepcopy(snapshot)
        bad_coverage["coverage"]["annual"][0]["byCe3"]["2"] += 1
        with self.assertRaisesRegex(ETL.SnapshotError, "byCe3"):
            ETL.validate_snapshot(bad_coverage, spec)

        bad_amount = copy.deepcopy(snapshot)
        bad_amount["rows"][0]["paidCashCents"] = 9_007_199_254_740_992
        with self.assertRaisesRegex(ETL.SnapshotError, "intero sicuro"):
            ETL.validate_snapshot(bad_amount, spec)

    def test_snapshot_validator_rejects_numeric_type_coercion(self):
        spec = ETL.load_spec(SPEC_PATH)
        snapshot = json.loads(SNAPSHOT_PATH.read_text(encoding="utf-8"))
        mutations = (
            ("schemaVersion", lambda value: value.__setitem__("schemaVersion", True)),
            ("years", lambda value: value.__setitem__("years", [2024.0, 2025.0])),
            ("coverage.paidCashCents", lambda value: value["coverage"].__setitem__("paidCashCents", 11357039641.0)),
            ("source.resources.sourceBytes", lambda value: value["source"]["resources"][0].__setitem__("sourceBytes", 12478207.0)),
        )
        for label, mutate in mutations:
            with self.subTest(field=label):
                mutated = copy.deepcopy(snapshot)
                mutate(mutated)
                with self.assertRaisesRegex(ETL.SnapshotError, "intero sicuro"):
                    ETL.validate_snapshot(mutated, spec)

    def test_builder_rejects_missing_or_extra_annual_inputs(self):
        spec = ETL.load_spec(SPEC_PATH)
        for inputs in ({2024: b""}, {2024: b"", 2025: b"", 2026: b""}):
            with self.subTest(years=sorted(inputs)):
                with self.assertRaisesRegex(ETL.SnapshotError, "input annuali inattesi"):
                    ETL.build_snapshot(spec, inputs)

    def test_spec_rejects_classification_or_license_drift(self):
        spec = json.loads(SPEC_PATH.read_text(encoding="utf-8"))
        bad_ce2 = copy.deepcopy(spec)
        bad_ce2["selectedCe2"]["label"] = "Etichetta mutata"
        with self.assertRaisesRegex(ETL.SnapshotError, "CE2 divergente"):
            ETL.validate_spec(bad_ce2)

        bad_license = copy.deepcopy(spec)
        bad_license["source"]["licenseVersion"] = "non dichiarata"
        with self.assertRaisesRegex(ETL.SnapshotError, "licenza sorgente inattesa"):
            ETL.validate_spec(bad_license)

        bad_evidence = copy.deepcopy(spec)
        bad_evidence["source"]["licenseEvidence"]["observedHref"] = "https://example.test/license"
        with self.assertRaisesRegex(ETL.SnapshotError, "prova record-specifica"):
            ETL.validate_spec(bad_evidence)

        bad_selector = copy.deepcopy(spec)
        bad_selector["source"]["licenseEvidence"]["cssSelector"] = ".license a"
        with self.assertRaisesRegex(ETL.SnapshotError, "prova record-specifica"):
            ETL.validate_spec(bad_selector)

    def test_spec_rejects_every_annual_source_identity_mutation(self):
        spec = json.loads(SPEC_PATH.read_text(encoding="utf-8"))
        for source_index, source in enumerate(spec["sources"]):
            for field in ("datasetId", "landingUrl", "catalogUrl", "csvUrl", "schemaUrl"):
                with self.subTest(year=source["year"], field=field):
                    mutated = copy.deepcopy(spec)
                    mutated["sources"][source_index][field] += "-mutated"
                    with self.assertRaisesRegex(ETL.SnapshotError, "identità sorgente"):
                        ETL.validate_spec(mutated)

    def test_parser_accepts_exact_rows_and_preserves_zero(self):
        payload = csv_payload(valid_row(paid_rs="0.00", paid_cp="0.00", paid_cs="0.00"))
        rows, source_rows = ETL.parse_csv(payload, annual_contract(payload, paid_cents=0))
        self.assertEqual(source_rows, 1)
        self.assertEqual(rows[0].paidCashCents, 0)
        self.assertEqual(rows[0].id, "2024:99:100:1")

    def test_rejects_source_hash_and_schema_drift(self):
        payload = csv_payload(valid_row())
        altered = payload.replace(b"PIANO SINTETICO", b"PIANO MODIFICATO")
        with self.assertRaisesRegex(ETL.SnapshotError, "bytes/hash"):
            ETL.parse_csv(altered, annual_contract(payload))

        bad_headers = copy.copy(ETL.HEADERS)
        bad_headers[0] = "Anno"
        bad_schema = (";".join(f'"{value}"' for value in bad_headers) + "\r\n" + ";".join(
            f'"{value}"' for value in valid_row()
        ) + "\r\n").encode("cp1252")
        with self.assertRaisesRegex(ETL.SnapshotError, "header"):
            ETL.parse_csv(bad_schema, annual_contract(bad_schema))

    def test_rejects_ce3_label_or_code_drift(self):
        wrong_label = csv_payload(valid_row(label="Etichetta mutata"))
        with self.assertRaisesRegex(ETL.SnapshotError, "etichetta CE3"):
            ETL.parse_csv(wrong_label, annual_contract(wrong_label))
        wrong_code = csv_payload(valid_row(code="8"))
        with self.assertRaisesRegex(ETL.SnapshotError, "codice CE3"):
            ETL.parse_csv(wrong_code, annual_contract(wrong_code))

    def test_rejects_malformed_or_overprecision_amount(self):
        for amount in ("3,30", "3.300"):
            with self.subTest(amount=amount):
                payload = csv_payload(valid_row(paid_cs=amount))
                with self.assertRaisesRegex(ETL.SnapshotError, "importo non valido"):
                    ETL.parse_csv(payload, annual_contract(payload))

    def test_rejects_duplicate_or_incomplete_identity_and_year_mismatch(self):
        duplicate = csv_payload(valid_row(), valid_row())
        with self.assertRaisesRegex(ETL.SnapshotError, "duplicata"):
            ETL.parse_csv(duplicate, annual_contract(duplicate, source_rows=2, selected_rows=2, paid_cents=660))
        missing = csv_payload(valid_row(plan=""))
        with self.assertRaisesRegex(ETL.SnapshotError, "identità.*incompleta"):
            ETL.parse_csv(missing, annual_contract(missing))
        wrong_year = csv_payload(valid_row(year=2025))
        with self.assertRaisesRegex(ETL.SnapshotError, "anno divergente"):
            ETL.parse_csv(wrong_year, annual_contract(wrong_year))

    def test_rejects_nonempty_trailing_field_and_arithmetic_mismatch(self):
        extra = csv_payload(valid_row(year=2025), trailing=True, trailing_value="inatteso")
        with self.assertRaisesRegex(ETL.SnapshotError, "campo terminale non vuoto"):
            ETL.parse_csv(extra, annual_contract(extra, year=2025, trailing=True))
        mismatch = csv_payload(valid_row(paid_cs="9.99"))
        with self.assertRaisesRegex(ETL.SnapshotError, "non riconciliato"):
            ETL.parse_csv(mismatch, annual_contract(mismatch, paid_cents=999))

    def test_rejects_expected_source_selected_and_total_drift(self):
        payload = csv_payload(valid_row())
        cases = [
            (annual_contract(payload, source_rows=2), "righe sorgente"),
            (annual_contract(payload, selected_rows=2), "righe selezionate"),
            (annual_contract(payload, paid_cents=331), "totale Pagato CS"),
        ]
        for contract, message in cases:
            with self.subTest(message=message):
                with self.assertRaisesRegex(ETL.SnapshotError, message):
                    ETL.parse_csv(payload, contract)


if __name__ == "__main__":
    unittest.main()
