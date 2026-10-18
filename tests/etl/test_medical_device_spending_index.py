from __future__ import annotations

import tempfile
from pathlib import Path
from unittest import TestCase

import medical_device_spending_index as index


def aggregate(code, label, labels, role, rows, spending, negative, zero, matched, unresolved):
    return {"code": code, "label": label, "labels": labels, "role": role, "rows": rows,
            "spending": spending, "negativeRows": negative, "zeroRows": zero,
            "matchedRows": matched, "unresolvedRows": unresolved}


class MedicalDeviceSpendingIndexTests(TestCase):
    def test_identity_search_and_money_helpers_preserve_contract(self):
        self.assertNotEqual(index.device_ref("1", "122392"), index.device_ref("2", "122392"))
        self.assertEqual(index.normalized_search("Pròfemur Preserve", "PR-0005"), "PROFEMURPRESERVEPR0005")
        self.assertEqual(index.euro_to_cents("-1.234,50"), -123450)
        self.assertEqual(index.cents_to_euro(-123450), "-1234.50")
        with self.assertRaises(index.source.SourceError):
            index.euro_to_cents("")

    def test_scope_payloads_roll_up_company_rows_to_region_and_year(self):
        with tempfile.TemporaryDirectory() as directory:
            connection = index.prepare_database(Path(directory) / "index.sqlite")
            try:
                connection.executemany("INSERT INTO devices VALUES (?,?,?,?,?,?,?,?,?,?,?)", [
                    ("dm-a", "a", "1", "1", "r1", None, None, "ACME", "fabbricante", None, None),
                    ("dm-b", "b", "2", "2", "r2", None, None, "ACME", "assemblatore", None, None),
                    ("dm-c", "c", "1", "3", "r3", None, None, "", "", None, None),
                    ("dm-d", "d", "1", "4", None, None, None, None, None, None, None),
                ])
                connection.executemany("INSERT INTO facts VALUES (?,?,?,?,?,?,?,?,?,?,?)", [
                    ("dm-a", "s", 1, 2019, "010", "101", "ASL Uno", "P01", 1000, 0, 0),
                    ("dm-b", "s", 2, 2019, "010", "101", "ASL 1", "P01", 1000, 0, 0),
                    ("dm-c", "s", 3, 2019, "010", "102", "ASL Due", "", 0, 0, 1),
                    ("dm-d", "s", 4, 2019, "010", "102", "ASL Due", "Z99", -250, 1, 0),
                    ("dm-a", "s", 5, 2019, "020", "201", "ASL Tre", "P01", 500, 0, 0),
                ])
                scopes = index.scope_rows(connection)
                payloads = {payload["scope"]["key"]: payload for payload in index.scope_payloads(connection, scopes)}
            finally:
                connection.close()

        self.assertEqual(list(payloads), ["2019", "2019:010", "2019:010:101", "2019:010:102",
                                          "2019:020", "2019:020:201"])
        year = payloads["2019"]
        self.assertEqual(year["coverage"], {
            "rows": 5, "spending": "22.50", "negativeRows": 1, "zeroRows": 1,
            "matchedRows": 4, "matchedSpending": "25.00", "unresolvedRows": 1, "unresolvedSpending": "-2.50"})
        self.assertEqual(year["territories"], [
            aggregate("010", None, [], None, 4, "17.50", 1, 1, 3, 1),
            aggregate("020", None, [], None, 1, "5.00", 0, 0, 1, 0)])
        # Il codice CND vuoto resta un gruppo senza codice, ordinato per spesa decrescente.
        self.assertEqual(year["classifications"], [
            aggregate("P01", None, [], None, 3, "25.00", 0, 0, 3, 0),
            aggregate(None, None, [], None, 1, "0.00", 0, 1, 1, 0),
            aggregate("Z99", None, [], None, 1, "-2.50", 1, 0, 0, 1)])
        # Produttore vuoto e non risolto confluiscono nello stesso gruppo nullo.
        self.assertEqual(year["manufacturers"], [
            aggregate(None, "ACME", [], "fabbricante", 2, "15.00", 0, 0, 2, 0),
            aggregate(None, "ACME", [], "assemblatore", 1, "10.00", 0, 0, 1, 0),
            aggregate(None, None, [], None, 2, "-2.50", 1, 1, 1, 1)])

        self.assertEqual(payloads["2019:010"]["territories"], [
            aggregate("101", None, ["ASL 1", "ASL Uno"], None, 2, "20.00", 0, 0, 2, 0),
            aggregate("102", "ASL Due", ["ASL Due"], None, 2, "-2.50", 1, 1, 1, 1)])

        company = payloads["2019:010:101"]
        self.assertEqual(company["scope"]["companyNames"], ["ASL 1", "ASL Uno"])
        self.assertEqual(company["territories"], [])
        self.assertEqual(company["coverage"]["spending"], "20.00")
        # A parità di spesa e nome conta il ruolo, in ordine crescente.
        self.assertEqual(company["manufacturers"], [
            aggregate(None, "ACME", [], "assemblatore", 1, "10.00", 0, 0, 1, 0),
            aggregate(None, "ACME", [], "fabbricante", 1, "10.00", 0, 0, 1, 0)])
        self.assertEqual(payloads["2019:020:201"]["coverage"]["unresolvedSpending"], "0.00")
