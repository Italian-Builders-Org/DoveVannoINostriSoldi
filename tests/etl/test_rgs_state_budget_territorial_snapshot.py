import copy
import csv
import hashlib
import importlib.util
import io
import json
import sys
import tempfile
import unittest
from unittest import mock
from pathlib import Path


ROOT = Path(__file__).resolve().parents[2]
SCRIPT_PATH = ROOT / "scripts/etl/rgs_state_budget_territorial_snapshot.py"
SPEC_PATH = ROOT / "scripts/etl/specs/rgs-state-budget-territorial-2023.source.json"
SNAPSHOT_PATH = ROOT / "src/data/generated/rgs-state-budget-territorial-2023.json"

MODULE_SPEC = importlib.util.spec_from_file_location("rgs_state_budget_territorial_snapshot", SCRIPT_PATH)
ETL = importlib.util.module_from_spec(MODULE_SPEC)
sys.modules[MODULE_SPEC.name] = ETL
MODULE_SPEC.loader.exec_module(ETL)


def csv_payload(amounts=None):
    amounts = amounts or ["0.00", "1.23", "2.34", "3.45"]
    output = io.StringIO(newline="")
    writer = csv.writer(output, delimiter=";", quotechar='"', quoting=csv.QUOTE_ALL, lineterminator="\r\n")
    writer.writerow(ETL.HEADERS)
    for measure, amount in zip(ETL.MEASURES, amounts, strict=True):
        writer.writerow([
            "2023",
            "ABRUZZO",
            "TITOLO I - SPESE CORRENTI",
            "02-CONSUMI INTERMEDI",
            "001-Organi costituzionali, a rilevanza costituzionale e Presidenza del Consiglio dei ministri",
            measure["label"],
            amount,
        ])
    return output.getvalue().encode("cp1252")


def source_contract(payload):
    return {
        "sourceBytes": len(payload),
        "sourceSha256": hashlib.sha256(payload).hexdigest(),
        "encoding": "cp1252",
        "delimiter": ";",
        "quoteChar": '"',
    }


class RgsStateBudgetTerritorialSnapshotTests(unittest.TestCase):
    def test_committed_snapshot_is_compact_reconciled_and_fail_honest(self):
        spec = ETL.load_spec(SPEC_PATH)
        snapshot = json.loads(SNAPSHOT_PATH.read_text(encoding="utf-8"))
        ETL.validate_snapshot(snapshot, spec)

        self.assertEqual(snapshot["year"], 2023)
        self.assertEqual(snapshot["coverage"]["sourceRows"], 20268)
        self.assertEqual(snapshot["coverage"]["dimensionRows"], 5067)
        self.assertEqual(snapshot["coverage"]["zeroValues"], 3880)
        self.assertEqual(len(snapshot["rows"]), 5067)
        self.assertEqual(len(snapshot["dimensions"]["territories"]), 26)
        self.assertEqual({item["level"] for item in snapshot["dimensions"]["territories"]}, {"region", "macroarea", "national"})
        self.assertEqual(snapshot["source"]["licenseStatus"], "not_declared")
        self.assertNotIn("licenseUrl", snapshot["source"])
        self.assertNotIn("subject", snapshot["rows"][0])
        self.assertEqual(snapshot["reconciliation"], ETL.EXPECTED_RECONCILIATION)
        self.assertTrue(snapshot["methodology"]["scope"].startswith("La landing ufficiale descrive"))
        self.assertIn("non applica filtri", snapshot["methodology"]["scope"])
        self.assertFalse(snapshot["methodology"]["scope"].startswith("Spesa territorializzata"))
        self.assertIn("8.057,70 milioni", " ".join(snapshot["caveats"]))
        self.assertIn("non prova", " ".join(snapshot["caveats"]))
        self.assertLess(SNAPSHOT_PATH.stat().st_size, 500_000)
        self.assertEqual(
            SNAPSHOT_PATH.read_bytes(),
            ETL.canonical_json(snapshot) + b"\n",
        )

    def test_parser_preserves_observed_zero_and_all_measure_frames(self):
        payload = csv_payload()
        records = ETL.parse_csv(payload, source_contract(payload))

        self.assertEqual(len(records), 4)
        self.assertEqual([record["measure"] for record in records], [item["label"] for item in ETL.MEASURES])
        self.assertEqual([record["value"] for record in records], [0, 123, 234, 345])

    def test_parser_rejects_wire_and_decimal_drift(self):
        valid = csv_payload()
        bad_line_endings = valid.replace(b"\r\n", b"\n")
        with self.assertRaisesRegex(ETL.SnapshotError, "line ending"):
            ETL.parse_csv(bad_line_endings, source_contract(bad_line_endings))

        unquoted = valid.replace(b'";"', b";")
        with self.assertRaisesRegex(ETL.SnapshotError, "quoting"):
            ETL.parse_csv(unquoted, source_contract(unquoted))

        bad_amount = csv_payload(["0.0", "1.23", "2.34", "3.45"])
        with self.assertRaisesRegex(ETL.SnapshotError, "importo non canonico"):
            ETL.parse_csv(bad_amount, source_contract(bad_amount))

        wrong_hash = source_contract(valid)
        wrong_hash["sourceSha256"] = "0" * 64
        with self.assertRaisesRegex(ETL.SnapshotError, "hash"):
            ETL.parse_csv(valid, wrong_hash)

    def test_spec_rejects_identity_domain_license_and_numeric_drift(self):
        spec = json.loads(SPEC_PATH.read_text(encoding="utf-8"))
        for field in ("recordId", "recordNumber", "reportNumber", "uuid", "landingUrl", "schemaUrl", "csvUrl", "sourceSha256"):
            with self.subTest(field=field):
                mutated = copy.deepcopy(spec)
                value = mutated["source"][field]
                mutated["source"][field] = value + 1 if isinstance(value, int) else value + "-mutated"
                with self.assertRaisesRegex(ETL.SnapshotError, "fonte divergenti"):
                    ETL.validate_spec(mutated)

        bad_bytes = copy.deepcopy(spec)
        bad_bytes["source"]["sourceBytes"] = 3933609.0
        with self.assertRaises(ETL.SnapshotError):
            ETL.validate_spec(bad_bytes)

        bad_license = copy.deepcopy(spec)
        bad_license["source"]["licenseStatus"] = "cc-by"
        with self.assertRaisesRegex(ETL.SnapshotError, "fonte divergenti"):
            ETL.validate_spec(bad_license)

        bad_territory = copy.deepcopy(spec)
        bad_territory["territories"]["region"][0] = "CENTRO"
        with self.assertRaisesRegex(ETL.SnapshotError, "territoriali"):
            ETL.validate_spec(bad_territory)

    def test_snapshot_rejects_numeric_type_coercion(self):
        spec = ETL.load_spec(SPEC_PATH)
        snapshot = json.loads(SNAPSHOT_PATH.read_text(encoding="utf-8"))
        mutations = (
            lambda value: value.__setitem__("schemaVersion", True),
            lambda value: value.__setitem__("year", 2023.0),
            lambda value: value["source"].__setitem__("sourceBytes", 3933609.0),
            lambda value: value["coverage"].__setitem__("sourceRows", 20268.0),
            lambda value: value["rows"][0].__setitem__("territory", 0.0),
            lambda value: value["rows"][0]["values"].__setitem__(0, 0.0),
        )
        for mutate in mutations:
            mutated = copy.deepcopy(snapshot)
            mutate(mutated)
            with self.assertRaisesRegex(ETL.SnapshotError, "intero sicuro"):
                ETL.validate_snapshot(mutated, spec)

        bad_bool = copy.deepcopy(snapshot)
        bad_bool["dimensions"]["measures"][0]["additiveWithinOneTerritoryLevel"] = 1
        with self.assertRaisesRegex(ETL.SnapshotError, "booleano"):
            ETL.validate_snapshot(bad_bool, spec)

    def test_snapshot_rejects_semantic_and_ordering_mutations(self):
        spec = ETL.load_spec(SPEC_PATH)
        snapshot = json.loads(SNAPSHOT_PATH.read_text(encoding="utf-8"))

        bad_source = copy.deepcopy(snapshot)
        bad_source["source"]["csvUrl"] += "-mutated"
        with self.assertRaisesRegex(ETL.SnapshotError, "fonte snapshot"):
            ETL.validate_snapshot(bad_source, spec)

        bad_level = copy.deepcopy(snapshot)
        bad_level["dimensions"]["territories"][0]["level"] = "national"
        with self.assertRaisesRegex(ETL.SnapshotError, "territori"):
            ETL.validate_snapshot(bad_level, spec)

        bad_order = copy.deepcopy(snapshot)
        bad_order["rows"][0], bad_order["rows"][1] = bad_order["rows"][1], bad_order["rows"][0]
        with self.assertRaisesRegex(ETL.SnapshotError, "ordinamento"):
            ETL.validate_snapshot(bad_order, spec)

        bad_duplicate = copy.deepcopy(snapshot)
        bad_duplicate["rows"][1] = copy.deepcopy(bad_duplicate["rows"][0])
        with self.assertRaisesRegex(ETL.SnapshotError, "duplicata"):
            ETL.validate_snapshot(bad_duplicate, spec)

        bad_coverage = copy.deepcopy(snapshot)
        bad_coverage["coverage"]["zeroValues"] += 1
        with self.assertRaisesRegex(ETL.SnapshotError, "copertura"):
            ETL.validate_snapshot(bad_coverage, spec)

        bad_reconciliation = copy.deepcopy(snapshot)
        bad_reconciliation["reconciliation"]["regionDeltaHundredthsMillionEur"] += 1
        with self.assertRaisesRegex(ETL.SnapshotError, "riconciliazione"):
            ETL.validate_snapshot(bad_reconciliation, spec)

        bad_title = copy.deepcopy(snapshot)
        bad_title["title"] = "cash payments"
        with self.assertRaisesRegex(ETL.SnapshotError, "titolo o grana"):
            ETL.validate_snapshot(bad_title, spec)

        bad_scope = copy.deepcopy(snapshot)
        bad_scope["methodology"]["scope"] += " drift"
        with self.assertRaisesRegex(ETL.SnapshotError, "metodologia"):
            ETL.validate_snapshot(bad_scope, spec)

        missing_caveat = copy.deepcopy(snapshot)
        missing_caveat["caveats"].pop()
        with self.assertRaisesRegex(ETL.SnapshotError, "limiti"):
            ETL.validate_snapshot(missing_caveat, spec)

    def test_snapshot_rejects_missing_measure_and_out_of_range_index(self):
        spec = ETL.load_spec(SPEC_PATH)
        snapshot = json.loads(SNAPSHOT_PATH.read_text(encoding="utf-8"))

        missing_measure = copy.deepcopy(snapshot)
        missing_measure["rows"][0]["values"].pop()
        with self.assertRaisesRegex(ETL.SnapshotError, "numero misure"):
            ETL.validate_snapshot(missing_measure, spec)

        bad_index = copy.deepcopy(snapshot)
        bad_index["rows"][0]["territory"] = len(snapshot["dimensions"]["territories"])
        with self.assertRaisesRegex(ETL.SnapshotError, "fuori dominio"):
            ETL.validate_snapshot(bad_index, spec)

    def test_check_rejects_semantically_valid_value_swap(self):
        spec = ETL.load_spec(SPEC_PATH)
        snapshot = json.loads(SNAPSHOT_PATH.read_text(encoding="utf-8"))
        mutated = copy.deepcopy(snapshot)
        left = next(
            index for index, row in enumerate(mutated["rows"])
            if row["values"][1] != mutated["rows"][0]["values"][1]
        )
        mutated["rows"][0]["values"][1], mutated["rows"][left]["values"][1] = (
            mutated["rows"][left]["values"][1],
            mutated["rows"][0]["values"][1],
        )

        ETL.validate_snapshot(mutated, spec)
        with tempfile.TemporaryDirectory() as directory:
            output = Path(directory) / "snapshot.json"
            output.write_bytes(ETL.canonical_json(mutated) + b"\n")
            with mock.patch.object(ETL, "build_snapshot", return_value=snapshot):
                with self.assertRaisesRegex(ETL.SnapshotError, "snapshot committed divergente"):
                    ETL.check_snapshot(spec, b"pinned source payload", output)


if __name__ == "__main__":
    unittest.main()
