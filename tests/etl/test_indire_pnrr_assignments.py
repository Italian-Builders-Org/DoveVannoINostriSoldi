import copy
import importlib.util
import json
import unittest
from decimal import Decimal
from pathlib import Path


SCRIPT = Path(__file__).resolve().parents[2] / "scripts/etl/indire_pnrr_assignments.py"
SPEC = importlib.util.spec_from_file_location("indire_pnrr_assignments", SCRIPT)
MODULE = importlib.util.module_from_spec(SPEC)
assert SPEC.loader
SPEC.loader.exec_module(MODULE)


class IndirePnrrAssignmentsTests(unittest.TestCase):
    def setUp(self):
        self.snapshot = json.loads(MODULE.OUTPUT_PATH.read_text(encoding="utf-8"))

    def test_compensation_parser_requires_contract_total_wording(self):
        self.assertEqual(
            MODULE.compensation_cents("€ 83.875,50 per l'intera durata contrattuale"),
            8_387_550,
        )
        for invalid in (Decimal("83875.50"), "€ 83.875,50 annui", "83.875,50"):
            with self.subTest(invalid=invalid):
                with self.assertRaisesRegex(ValueError, "[Cc]ompenso PNRR|Base del compenso"):
                    MODULE.compensation_cents(invalid)

    def test_program_classifier_accepts_only_the_two_verified_programs(self):
        self.assertEqual(MODULE.program_for("PNRR ERASMUS+"), (
            "m4c1-i3-1",
            "M4C1 · Investimento 3.1 · Nuove competenze e nuovi linguaggi",
        ))
        self.assertEqual(MODULE.program_for("PNRR Riforma 2.1"), (
            "m4c1-r2-1",
            "M4C1 · Riforma 2.1 · Formazione alla transizione digitale",
        ))
        with self.assertRaisesRegex(ValueError, "fuori dai due programmi"):
            MODULE.program_for("PNRR programma non classificato")

    def test_committed_snapshot_reconciles(self):
        MODULE.validate_snapshot(self.snapshot)

    def test_snapshot_rejects_source_and_total_drift(self):
        source_drift = copy.deepcopy(self.snapshot)
        source_drift["source"]["asset"]["sha256"] = "0" * 64
        with self.assertRaisesRegex(ValueError, "Provenienza"):
            MODULE.validate_snapshot(source_drift)

        total_drift = copy.deepcopy(self.snapshot)
        total_drift["assignments"][0]["compensation"]["valueCents"] += 1
        with self.assertRaisesRegex(ValueError, "Totale compensi"):
            MODULE.validate_snapshot(total_drift)

    def test_committed_snapshot_command_path_is_valid(self):
        MODULE.validate_snapshot(json.loads(MODULE.OUTPUT_PATH.read_text(encoding="utf-8")))


if __name__ == "__main__":
    unittest.main()
