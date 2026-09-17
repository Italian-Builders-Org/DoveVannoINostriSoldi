import copy
import hashlib
import importlib.util
import json
import sys
import unittest
from pathlib import Path


ROOT = Path(__file__).resolve().parents[2]
MODULE_PATH = ROOT / "scripts/etl/ssn_cce_snapshot.py"
SPEC_PATH = ROOT / "scripts/etl/specs/ssn-cce-2024.source.json"
SPEC = importlib.util.spec_from_file_location("ssn_cce_snapshot", MODULE_PATH)
assert SPEC and SPEC.loader
ETL = importlib.util.module_from_spec(SPEC)
sys.modules[SPEC.name] = ETL
SPEC.loader.exec_module(ETL)


HEADER = [
    "Anno di Riferimento",
    "Codice Regione",
    "Descrizione Regione",
    "Tipo Rilevazione",
    "Codice Ente SSN",
    "Codice Ente BDAP",
    "Descrizione Ente",
    "Codice Voce Contabile",
    "Descrizione Voce Contabile",
    "Data Aggiornamento",
    "Importo Totale",
]


def synthetic_lock(payload: bytes, *, rows: int = 1, voices: int = 1) -> dict:
    lock = json.loads(SPEC_PATH.read_text(encoding="utf-8"))
    lock["integrity"]["artifact"] = {"bytes": 0, "sha256": ""}
    lock["integrity"]["lockSha256"] = ""
    lock["datasets"]["entities"]["sourceBytes"] = len(payload)
    lock["datasets"]["entities"]["sourceSha256"] = hashlib.sha256(payload).hexdigest()
    lock["datasets"]["entities"]["expectedRows"] = rows
    lock["datasets"]["entities"]["expectedVoices"] = voices
    lock["expected"].update({"entitySourceRows": rows, "entities": 1, "exposedEntities": 1, "aggregateEntities": 1, "regions": 1, "voices": voices})
    return lock


def csv_payload(*rows: list[str]) -> bytes:
    return (";".join(HEADER) + "\r\n" + "\r\n".join(";".join(row) for row in rows) + "\r\n").encode("utf-8")


def valid_row(code: str = "BZ9999", amount: str = "10.00") -> list[str]:
    labels = {
        "BZ9999": "Totale costi della produzione (B)",
        "BA2080": "Totale Costo del personale",
        "BA1350": "B.2.A.15) Consulenze, Collaborazioni, Interinale e altre prestazioni di lavoro sanitarie e sociosanitarie",
        "BA1750": "B.2.B.2) Consulenze, Collaborazioni, Interinale e altre prestazioni di lavoro non sanitarie",
        "BA0390": "B.2) Acquisti di servizi",
    }
    return [
        "2024",
        "180",
        "Calabria",
        "CONSUNTIVO",
        "001",
        "123456789",
        "ENTE TEST",
        code,
        labels[code],
        "30/04/2025",
        amount,
    ]


class SsnCceSnapshotTests(unittest.TestCase):
    def test_locked_snapshot_passes_and_national_values_are_exact(self):
        lock = ETL.load_lock(SPEC_PATH)
        ETL.check(lock, ROOT / "src/data/generated/ssn-cce-2024.json")

        snapshot = json.loads((ROOT / "src/data/generated/ssn-cce-2024.json").read_text(encoding="utf-8"))
        self.assertEqual(snapshot["national"]["values"]["personnelCost"], 4037827491649)
        self.assertEqual(snapshot["national"]["values"]["healthcareWorkServices"], 184360514664)
        self.assertEqual(snapshot["coverage"]["entities"], 232)
        self.assertEqual(snapshot["coverage"]["aggregateEntities"], 21)
        self.assertNotIn("999", {entity["codeSsn"] for entity in snapshot["entities"]})

    def test_parser_rejects_bom_and_duplicate_composite_voice(self):
        payload = csv_payload(valid_row())
        lock = synthetic_lock(payload)
        with self.assertRaisesRegex(ETL.SnapshotError, "BOM"):
            ETL.parse_csv(b"\xef\xbb\xbf" + payload, synthetic_lock(b"\xef\xbb\xbf" + payload))

        duplicate = csv_payload(valid_row(), valid_row())
        with self.assertRaisesRegex(ETL.SnapshotError, "duplicata"):
            ETL.parse_csv(duplicate, synthetic_lock(duplicate, rows=2))

    def test_parser_rejects_semantic_label_and_amount_drift(self):
        bad_label = valid_row("BA1350")
        bad_label[8] = "gettonisti"
        payload = csv_payload(bad_label)
        with self.assertRaisesRegex(ETL.SnapshotError, "descrizione voce divergente"):
            ETL.parse_csv(payload, synthetic_lock(payload))

        lock_drift = json.loads(SPEC_PATH.read_text(encoding="utf-8"))
        lock_drift["metrics"][2]["label"] = "gettonisti"
        with self.assertRaisesRegex(ETL.SnapshotError, "definizione voce non autorizzata"):
            ETL.validate_lock(lock_drift, allow_unbound_artifact=True)

        bad_amount = valid_row()
        bad_amount[10] = "10,00"
        payload = csv_payload(bad_amount)
        with self.assertRaisesRegex(ETL.SnapshotError, "Importo non valido"):
            ETL.parse_csv(payload, synthetic_lock(payload))

    def test_required_amount_is_not_replaced_with_zero(self):
        for raw in ("", " ", "n.d.", "*", "NaN"):
            with self.subTest(raw=raw):
                payload = csv_payload(valid_row(amount=raw))
                with self.assertRaisesRegex(ETL.SnapshotError, "Importo Totale riga 2"):
                    ETL.parse_csv(payload, synthetic_lock(payload))

    def test_existing_snapshot_values_round_trip_through_the_source_parser(self):
        snapshot = json.loads((ROOT / "src/data/generated/ssn-cce-2024.json").read_text())
        for group in [snapshot["national"], *snapshot["regions"], *snapshot["entities"]]:
            for metric, cents in group["values"].items():
                sign = "-" if cents < 0 else ""
                euros, remainder = divmod(abs(cents), 100)
                raw = f"{sign}{euros}.{remainder:02d}"
                self.assertEqual(ETL.parse_amount_cents(raw, metric), cents)

    def test_build_snapshot_uses_official_national_and_regional_inputs(self):
        lock = copy.deepcopy(ETL.load_lock(SPEC_PATH))
        metric_rows = [
            (metric["code"], metric["label"], index + 1)
            for index, metric in enumerate(lock["metrics"])
        ]
        entity_rows = []
        regional_rows = []
        national_by_code = {code: 0 for code, _label, _amount in metric_rows}

        for region_index in range(21):
            region_code = f"{region_index + 1:03d}"
            region_name = f"Territorio {region_index + 1}"
            for code, label, base_amount in metric_rows:
                regional_amount = (region_index + 1) * base_amount * 100
                national_by_code[code] += regional_amount
                regional_rows.append(
                    ETL.ParsedAggregateRow(
                        2024,
                        region_code,
                        region_name,
                        code,
                        label,
                        "2025-04-30",
                        regional_amount,
                    )
                )
                entity_rows.extend(
                    [
                        ETL.ParsedRow(
                            2024,
                            region_code,
                            region_name,
                            "CONSUNTIVO",
                            f"{region_index + 1:03d}",
                            f"{region_index + 1:09d}",
                            f"Ente {region_index + 1}",
                            code,
                            label,
                            "2025-04-30",
                            regional_amount // 2,
                        ),
                        ETL.ParsedRow(
                            2024,
                            region_code,
                            region_name,
                            "CONSUNTIVO",
                            "999",
                            f"{region_index + 1:09d}",
                            f"Aggregato {region_index + 1}",
                            code,
                            label,
                            "2025-04-30",
                            regional_amount,
                        ),
                    ]
                )

        national_rows = [
            ETL.ParsedAggregateRow(
                2024,
                None,
                None,
                code,
                label,
                "2025-04-30",
                national_by_code[code],
            )
            for code, label, _base_amount in metric_rows
        ]
        lock["expected"].update(
            {
                "entitySourceRows": len(entity_rows),
                "entities": 42,
                "exposedEntities": 21,
                "aggregateEntities": 21,
                "regions": 21,
                "voices": 5,
            }
        )
        lock["integrity"]["lockSha256"] = ""
        snapshot = ETL.build_snapshot(lock, entity_rows, national_rows, regional_rows, "2026-08-22T00:00:00Z")
        ETL.validate_snapshot(snapshot, lock)
        self.assertEqual(
            snapshot["national"]["values"]["productionCosts"],
            sum(region["values"]["productionCosts"] for region in snapshot["regions"]),
        )
        self.assertEqual(snapshot["detailCoverage"]["missing"]["personnelCost"], 0)
        self.assertEqual(snapshot["regions"][0]["code"], "001")
        self.assertTrue(snapshot["reconciliation"]["nationalEqualsRegions"])
        self.assertTrue(snapshot["reconciliation"]["regionalMatchesEntityAggregateRows"])

        divergent_regional_rows = list(regional_rows)
        original = divergent_regional_rows[1]
        divergent_regional_rows[1] = ETL.ParsedAggregateRow(
            original.year,
            original.region_code,
            "Nome Regione divergente",
            original.voice_code,
            original.voice_label,
            original.updated_at,
            original.amount_cents,
        )
        with self.assertRaisesRegex(ETL.SnapshotError, "nome Regione dataset regionale incoerente"):
            ETL.build_snapshot(lock, entity_rows, national_rows, divergent_regional_rows, "2026-08-22T00:00:00Z")

    def test_snapshot_validation_rejects_missing_count_out_of_range(self):
        lock = ETL.load_lock(SPEC_PATH)
        snapshot = json.loads((ROOT / "src/data/generated/ssn-cce-2024.json").read_text(encoding="utf-8"))
        broken = copy.deepcopy(snapshot)
        broken["entities"][0]["missing"]["productionCosts"] = 2
        with self.assertRaisesRegex(ETL.SnapshotError, "missing productionCosts"):
            ETL.validate_snapshot(broken, lock)


if __name__ == "__main__":
    unittest.main()
