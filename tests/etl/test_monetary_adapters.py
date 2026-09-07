"""Characterize the source-specific monetary contracts before sharing primitives."""

import json
import unittest
from decimal import Decimal
from pathlib import Path
from unittest.mock import patch

import opencivitas_snapshot as opencivitas
import ssn_cce_snapshot as ssn


ROOT = Path(__file__).resolve().parents[2]


class MonetaryAdapterTests(unittest.TestCase):
    def test_opencivitas_comma_decimals_and_half_up_rounding(self):
        for raw, expected in (
            ("0", 0), ("-0,000", 0), ("123", 12300),
            (" 123,45\n", 12345), ("-123,45", -12345),
            ("1,004", 100), ("1,005", 101), ("-1,005", -101),
            ("90071992547409,91", opencivitas.MAX_SAFE_INTEGER),
            ("-90071992547409,91", -opencivitas.MAX_SAFE_INTEGER),
        ):
            with self.subTest(raw=raw):
                value = opencivitas.decimal_value(raw, "SPESA_STORICA")
                self.assertIsInstance(value, Decimal)
                self.assertEqual(opencivitas.cents(value, "SPESA_STORICA"), expected)

    def test_opencivitas_rejects_other_formats_and_missing_required_values(self):
        for raw in ("", " ", "1.00", "1.000,00", "1,000,00", "1 000,00",
                    "+1", "1e2", "NaN", "Infinity", "--1", ",5", "1,", "n.d."):
            with self.subTest(raw=raw):
                with self.assertRaisesRegex(opencivitas.StructuralError, "SPESA_STORICA"):
                    opencivitas.decimal_value(raw, "SPESA_STORICA")
        for raw in ("90071992547409,92", "-90071992547409,92"):
            with self.subTest(raw=raw):
                with self.assertRaisesRegex(opencivitas.StructuralError, "SPESA_STORICA.*limite sicuro"):
                    opencivitas.cents(opencivitas.decimal_value(raw, "SPESA_STORICA"), "SPESA_STORICA")

    def test_opencivitas_missing_and_flagged_cells_remain_distinct_from_zero(self):
        code = "SPESA_STORICA"
        self.assertIsNone(opencivitas.decimal_value(" ", code, required=False))
        self.assertIsNone(opencivitas.clean_metric({}, code, [], required=False))
        with self.assertRaisesRegex(opencivitas.StructuralError, "Indicatore SPESA_STORICA mancante"):
            opencivitas.clean_metric({}, code, [])
        for flag in ("privacy", "anomaly"):
            with self.subTest(flag=flag):
                row = {"value": "non numerico", "privacy": "", "anomaly": ""}
                row[flag] = "oscurato"
                warnings = []
                self.assertIsNone(opencivitas.clean_metric({code: row}, code, warnings))
                self.assertEqual(warnings, ["SPESA_STORICA: oscurato"])
        self.assertEqual(opencivitas.clean_metric(
            {code: {"value": "0", "privacy": "", "anomaly": ""}}, code, []), Decimal(0))

    def test_opencivitas_normalization_preserves_rounding_and_reconciliation(self):
        values = {
            "SPESA_STORICA": "100,005", "FST_RIPROPORZIONATO_BI": "200,005",
            "SPESA_STORICA_PROAB": "100,005", "FST_RIPROPORZIONATO_BI_PROAB": "200,005",
        }
        rows = {key: {"value": value, "privacy": "", "anomaly": ""} for key, value in values.items()}
        entity = {"istatCode": "001001", "name": "Comune test", "province": "Torino", "region": "Piemonte"}
        with patch.object(opencivitas, "load_entities", return_value={"test": entity}), \
                patch.object(opencivitas, "verify_indicators"), \
                patch.object(opencivitas, "load_raw_data", return_value={"test": rows}), \
                patch.object(opencivitas, "EXPECTED_MUNICIPALITIES", 1):
            snapshot = opencivitas.normalize(b"", b"", b"", "2026-09-06T00:00:00Z")
            record = dict(zip(snapshot["municipalityColumns"], snapshot["municipalityRows"][0], strict=True))
            self.assertEqual([record[key] for key in (
                "historicalSpendingCents", "standardSpendingCents", "differenceCents",
                "historicalPerCapitaCents", "standardPerCapitaCents", "differencePerCapitaCents",
                "differenceBasisPoints", "serviceDifferenceBasisPoints",
            )], [10001, 20001, -10000, 10001, 20001, -10000, -5000, None])
            for raw, privacy in (("", ""), ("0", "oscurato"), ("-1", "")):
                with self.subTest(raw=raw, privacy=privacy):
                    rows["SPESA_STORICA"] = {"value": raw, "privacy": privacy, "anomaly": ""}
                    with self.assertRaises(opencivitas.StructuralError):
                        opencivitas.normalize(b"", b"", b"", "2026-09-06T00:00:00Z")

    def test_ssn_requires_two_decimal_places_in_euros(self):
        for raw, expected in (("0.00", 0), ("-0.00", 0), ("123.45", 12345),
                              (" -123.45\n", -12345), ("90071992547409.91", ssn.MAX_SAFE_INTEGER)):
            with self.subTest(raw=raw):
                self.assertEqual(ssn.parse_amount_cents(raw, "Importo riga 7"), expected)
        for raw in ("", " ", "n.d.", "123", "1.2", "1.234", "1,00", "1,000.00",
                    "1.000,00", "1 000.00", "+1.00", "1e2", "NaN", "Infinity", ".50", "1."):
            with self.subTest(raw=raw):
                with self.assertRaisesRegex(ssn.SnapshotError, "Importo non valido in Importo riga 7"):
                    ssn.parse_amount_cents(raw, "Importo riga 7")
        for raw in ("90071992547409.92", "-90071992547409.92"):
            with self.subTest(raw=raw):
                with self.assertRaisesRegex(ssn.SnapshotError, "fuori intervallo sicuro in Importo riga 7"):
                    ssn.parse_amount_cents(raw, "Importo riga 7")

    def test_existing_opencivitas_monetary_cells_retain_exact_cents(self):
        snapshot = json.loads((ROOT / "src/data/generated/opencivitas-2022.json").read_text())
        columns = [index for index, name in enumerate(snapshot["municipalityColumns"]) if name.endswith("Cents")]
        for row in snapshot["municipalityRows"]:
            for index in columns:
                expected = row[index]
                decimal = Decimal(expected).scaleb(-2)
                self.assertEqual(opencivitas.cents(decimal, snapshot["municipalityColumns"][index]), expected)


if __name__ == "__main__":
    unittest.main()
