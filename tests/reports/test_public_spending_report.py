"""Offline tests of the authored report and derivatives, not an upstream data audit."""
import copy
import csv
import importlib.util
import io
import json
import unittest
from pathlib import Path

ROOT=Path(__file__).resolve().parents[2]
spec=importlib.util.spec_from_file_location('builder',ROOT/'scripts/reports/build_public_spending_report.py')
builder=importlib.util.module_from_spec(spec)
spec.loader.exec_module(builder)
REPORT=json.loads((ROOT/builder.CANONICAL).read_text())

class ReportTests(unittest.TestCase):
    def test_valid(self): builder.validate(REPORT)
    def test_12_independent_decimal_calculations(self):
        for c in REPORT['calculations']:
            with self.subTest(calculation=c['id']):
                self.assertEqual(builder.rounded_calculation(c),c['roundedResult'])
    def test_changed_source_metric_rejected(self):
        r=copy.deepcopy(REPORT); r['facts'][2]['metrics'][0]['value']='99999'
        with self.assertRaisesRegex(ValueError,'scollegati'):builder.validate(r)
    def test_changed_operand_even_with_matching_result_rejected(self):
        r=copy.deepcopy(REPORT);c=r['calculations'][0];c['inputs'][0]='10000';c['roundedResult']=builder.rounded_calculation(c)
        with self.assertRaisesRegex(ValueError,'scollegati'):builder.validate(r)
    def test_duplicate_sum_component_rejected(self):
        r=copy.deepcopy(REPORT);r['calculations'][6]['inputRefs'][0].append('GF10')
        with self.assertRaisesRegex(ValueError,'Duplicato'):builder.validate(r)
    def test_future_source_rejected(self):
        r=copy.deepcopy(REPORT);r['sources'][0]['publicationDate']='2027-01-01'
        with self.assertRaisesRegex(ValueError,'cutoff'):builder.validate(r)
    def test_absent_function_rejected(self):
        r=copy.deepcopy(REPORT);r['sections'].pop()
        with self.assertRaisesRegex(ValueError,'COFOG'):builder.validate(r)
    def test_extra_function_rejected(self):
        r=copy.deepcopy(REPORT);r['sections'].append(r['sections'][0])
        with self.assertRaisesRegex(ValueError,'COFOG'):builder.validate(r)
    def test_unknown_fact_rejected(self):
        r=copy.deepcopy(REPORT);r['sections'][0]['factIds']=['F999']
        with self.assertRaisesRegex(ValueError,'Fatto'):builder.validate(r)
    def test_csv_has_23_rows(self):
        self.assertEqual(len(list(csv.DictReader(io.StringIO(builder.claims_csv(REPORT))))),23)
    def test_csv_formula_escape(self):
        r=copy.deepcopy(REPORT);r['facts'][0]['title']='=1+1'
        first=next(csv.DictReader(io.StringIO(builder.claims_csv(r))))
        self.assertEqual(first['titolo'],"'=1+1")
    def test_derivative_hashes_and_parity(self): builder.build(ROOT,check=True)
    def test_markdown_contains_all_functions_sources_facts(self):
        text=builder.markdown(REPORT)
        for collection,key in [('sections','code'),('sources','id'),('facts','id')]:
            for entry in REPORT[collection]:self.assertIn(entry[key],text)
    def test_no_emdash(self): self.assertNotIn('\u2014',builder.markdown(REPORT))
    def test_money_unit(self): self.assertEqual(builder.it('1109.15'),'1.109,15')
    def test_previous_report_not_replaced(self):self.assertEqual(REPORT['predecessor']['href'],'/report/bilancio-stato-2025')
    def test_no_publication_attestation(self):self.assertIsNone(REPORT['scope']['reviewerSignoff'])
    def test_no_savings_total(self):self.assertTrue(REPORT['noSavingsTotal'])
    def test_all_operands_bound(self):
        for c in REPORT['calculations']:self.assertEqual(len(c['inputRefs']),2)

if __name__=='__main__':unittest.main()
