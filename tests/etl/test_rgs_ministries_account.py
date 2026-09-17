import importlib.util
import unittest
from pathlib import Path


SCRIPT = Path(__file__).resolve().parents[2] / "scripts/etl/rgs_ministries_account.py"
SPEC = importlib.util.spec_from_file_location("rgs_ministries_account", SCRIPT)
MODULE = importlib.util.module_from_spec(SPEC)
assert SPEC.loader
SPEC.loader.exec_module(MODULE)


class RgsMinistriesAccountTests(unittest.TestCase):
    def test_parser_rejects_an_unlocked_asset(self):
        with self.assertRaisesRegex(ValueError, "diverso dal file validato"):
            MODULE.parse(b"not-the-official-csv")

    def test_row_reconciliation_rejects_mixed_frames(self):
        row = {field: "0.00" for field in MODULE.EXPECTED_HEADERS}
        row["Esercizio Finanziario"] = "2025"
        row["Pagato CS"] = "1.00"
        with self.assertRaisesRegex(ValueError, "Pagato CS"):
            MODULE.validate_row(row)

    def test_row_reconciliation_rejects_one_cent_of_drift(self):
        row = {field: "0.00" for field in MODULE.EXPECTED_HEADERS}
        row["Totale CP"] = "0.01"
        with self.assertRaisesRegex(ValueError, "Totale CP"):
            MODULE.validate_row(row)

    def test_row_reconciliation_rejects_subcent_values(self):
        row = {field: "0.00" for field in MODULE.EXPECTED_HEADERS}
        row["Pagato CP"] = "0.001"
        with self.assertRaisesRegex(ValueError, "frazioni di centesimo"):
            MODULE.validate_row(row)

    def test_ministry_identity_requires_the_locked_official_label(self):
        row = {"Stato di Previsione": "02", "Amministrazione": "MINISTERO RINOMINATO"}
        with self.assertRaisesRegex(ValueError, "Amministrazione RGS inattesa"):
            MODULE.validate_ministry(row)

    def test_mission_code_rejects_a_conflicting_label(self):
        labels = {}
        first = {"Stato di Previsione": "02", "Codice Missione": "001", "Missione": "Prima etichetta"}
        second = {**first, "Missione": "Seconda etichetta"}
        MODULE.register_mission_label(labels, first)
        with self.assertRaisesRegex(ValueError, "Etichetta missione RGS in conflitto"):
            MODULE.register_mission_label(labels, second)

    def test_coverage_rejects_an_excluded_row(self):
        with self.assertRaisesRegex(ValueError, "5394/5395"):
            MODULE.validate_coverage(5395, 5394)

    def test_source_manifest_rejects_hash_drift(self):
        meta = {
            "source": {
                "owner": "Ragioneria Generale dello Stato",
                "sourceRecordId": MODULE.SOURCE_RECORD_ID,
                "referencePeriod": "2025",
                "landingUrl": MODULE.LANDING_URL,
                "resourceUrl": MODULE.RESOURCE_URL,
            },
            "asset": {
                "bytes": MODULE.EXPECTED_BYTES,
                "sha256": "0" * 64,
                "encoding": "cp1252",
                "delimiter": ";",
            },
        }
        with self.assertRaisesRegex(ValueError, "fonte validata"):
            MODULE.validate_source_manifest(meta)

    def test_committed_snapshot_is_byte_bound(self):
        MODULE.validate_committed()

    def test_semantic_definitions_reject_debt_shortcuts(self):
        self.assertIn("non misura un debito da pagare", MODULE.EXPECTED_DEFINITIONS["remainingCp"])
        self.assertNotIn("quota non pagata", " ".join(MODULE.EXPECTED_DEFINITIONS.values()).lower())


if __name__ == "__main__":
    unittest.main()
