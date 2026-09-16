from __future__ import annotations

from unittest import TestCase

import medical_device_spending_index as index


class MedicalDeviceSpendingIndexTests(TestCase):
    def test_identity_search_and_money_helpers_preserve_contract(self):
        self.assertNotEqual(index.device_ref("1", "122392"), index.device_ref("2", "122392"))
        self.assertEqual(index.normalized_search("Pròfemur Preserve", "PR-0005"), "PROFEMURPRESERVEPR0005")
        self.assertEqual(index.euro_to_cents("-1.234,50"), -123450)
        self.assertEqual(index.cents_to_euro(-123450), "-1234.50")
        with self.assertRaises(index.source.SourceError):
            index.euro_to_cents("")
