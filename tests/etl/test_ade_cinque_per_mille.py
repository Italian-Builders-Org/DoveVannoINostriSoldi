from __future__ import annotations

import csv
import io
import json
from copy import deepcopy
from decimal import Decimal
from unittest import TestCase

import ade_cinque_per_mille as ade


class CinquePerMilleTests(TestCase):
    @classmethod
    def setUpClass(cls):
        cls.spec = json.loads(ade.SPEC.read_text(encoding="utf-8"))
        cls.rows = ade.load_rows(cls.spec)

    def test_original_parts_reproduce_all_entities_without_inventing_payments_or_zero(self):
        payload = ade.project_rows(self.rows, self.spec)
        rows = list(csv.DictReader(io.StringIO(payload.decode("utf-8")), delimiter="|"))
        self.assertEqual(len(self.rows), 90627)
        self.assertEqual(self.rows[0][1], "'80051890152'")
        self.assertEqual(self.rows[0][17], "71.799.594,47")
        self.assertTrue(any(row[1].startswith("'0") for row in self.rows))
        self.assertEqual(len(rows), 22)
        self.assertEqual(sum(int(row["Enti ammessi"]) for row in rows), 90627)
        self.assertEqual(sum(int(row["Enti senza importo erogabile pubblicato"]) for row in rows), 17820)
        self.assertEqual(sum(Decimal(row["Totale erogabile pubblicato (euro)"]) for row in rows), Decimal("522950166.12"))
        self.assertEqual(next(row["Enti ammessi"] for row in rows if row["Territorio"] == ""), "323")
        self.assertEqual(next(row["Enti ammessi"] for row in rows if row["Territorio"] == "LOMBARDIA"), "15016")
        self.assertIn("TRENTINO ALTO ADIGE (BOLZANO)", {row["Territorio"] for row in rows})
        self.assertIn("TRENTINO ALTO ADIGE (TRENTO)", {row["Territorio"] for row in rows})
        self.assertEqual({row["Anno finanziario"] for row in rows}, {"2024"})
        ade.check_committed(payload)

    def test_rejects_changed_part_missing_part_and_unverified_legal_basis(self):
        changed = deepcopy(self.spec)
        changed["parts"][0]["sha256"] = "0" * 64
        with self.assertRaisesRegex(ade.SourceError, "hash|byte"):
            ade.load_rows(changed)
        changed = deepcopy(self.spec)
        changed["parts"].pop()
        with self.assertRaisesRegex(ade.SourceError, "part"):
            ade.load_rows(changed)
        changed = deepcopy(self.spec)
        changed["license"]["evidence"].pop()
        with self.assertRaisesRegex(ade.SourceError, "riuso|evidenz"):
            ade.load_rows(changed)
        changed = deepcopy(self.spec)
        changed["license"]["status"] = "not-declared"
        with self.assertRaisesRegex(ade.SourceError, "riuso|licenza"):
            ade.load_rows(changed)

    def test_rejects_duplicate_entity_or_non_entity_identifier(self):
        changed = list(self.rows)
        changed[1] = list(changed[1])
        changed[1][1] = changed[0][1]
        with self.assertRaisesRegex(ade.SourceError, "duplicat"):
            ade.project_rows(changed, self.spec)
        changed[1][1] = "'RSSMRA80A01H501U'"
        with self.assertRaisesRegex(ade.SourceError, "codice|ente"):
            ade.project_rows(changed, self.spec)

    def test_rejects_changed_money_and_does_not_count_categories_twice(self):
        changed = list(self.rows)
        changed[0] = list(changed[0])
        changed[0][17] = "71.799.594,48"
        with self.assertRaisesRegex(ade.SourceError, "riconcilia|somma"):
            ade.project_rows(changed, self.spec)
        changed[0][17] = self.rows[0][17]
        changed[0][6] = "YES"
        with self.assertRaisesRegex(ade.SourceError, "categoria"):
            ade.project_rows(changed, self.spec)
