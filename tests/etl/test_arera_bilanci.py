from __future__ import annotations

import csv
import io
import json
from copy import deepcopy
from unittest import TestCase

import arera_bilanci as arera


class AreraBilanciTests(TestCase):
    @classmethod
    def setUpClass(cls):
        cls.spec = json.loads(arera.SPEC.read_text(encoding="utf-8"))

    def test_official_rows_preserve_period_money_natures_and_reconcile(self):
        projected = arera.projections(self.spec)
        income = list(csv.DictReader(io.StringIO(projected[arera.INCOME_ID].decode()), delimiter='|'))
        spending = list(csv.DictReader(io.StringIO(projected[arera.SPENDING_ID].decode()), delimiter='|'))
        self.assertEqual(len(income), 54)
        self.assertEqual(len(spending), 6)
        row = next(r for r in income if r['Anno'] == '2025' and r['Capitolo ARERA'] == '101.1')
        self.assertEqual(row['Accertamenti (euro)'], '81062274.92')
        self.assertEqual(row['Incassi totali (euro)'], '80480947.85')
        self.assertEqual(row['Riscosso su residui (euro)'], '594171.53')
        self.assertTrue(any(r['Previsioni definitive (euro)'] == '0.00' for r in income))
        self.assertTrue(any(r['Accertamenti (euro)'] == '' for r in income))
        self.assertEqual({r['Anno'] for r in income}, {'2024', '2025'})
        arera.check_committed(projected)

    def test_rejects_changed_source_and_license(self):
        changed = deepcopy(self.spec)
        changed['years'][0]['sha256'] = '0' * 64
        with self.assertRaisesRegex(arera.SourceError, 'hash|byte'):
            arera.projections(changed)
        changed = deepcopy(self.spec)
        changed['license']['url'] = 'https://creativecommons.org/licenses/by/4.0/'
        with self.assertRaisesRegex(arera.SourceError, 'licenza'):
            arera.projections(changed)

    def test_rejects_wrong_period_duplicate_identity_and_missing_money(self):
        year = self.spec['years'][0]
        sheets = arera.workbook(arera.verified_source(year))
        bad = deepcopy(sheets)
        bad[year['incomeSheet']]['A2'] = 'ESERCIZIO 2023'
        with self.assertRaisesRegex(arera.SourceError, 'periodo'):
            arera.project_year(year, bad)
        bad = deepcopy(sheets)
        bad[year['incomeSheet']]['E14'] = '101.1'
        bad[year['incomeSheet']]['D14'] = bad[year['incomeSheet']]['D13']
        with self.assertRaisesRegex(arera.SourceError, 'duplicat'):
            arera.project_year(year, bad)
        bad = deepcopy(sheets)
        bad[year['incomeSheet']]['I13'] = None
        with self.assertRaisesRegex(arera.SourceError, 'totale|riconcilia|celle'):
            arera.project_year(year, bad)

    def test_rejects_unbalanced_cash_without_changing_source_totals(self):
        year = self.spec['years'][0]
        sheets = arera.workbook(arera.verified_source(year))
        sheets[year['incomeSheet']]['P13'] = '79208746.82'
        with self.assertRaisesRegex(arera.SourceError, 'riconcilia'):
            arera.project_year(year, sheets)
