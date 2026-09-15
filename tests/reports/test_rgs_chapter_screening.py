"""Synthetic unit tests; these do not constitute an audit of the original RGS CSV."""
import copy
import importlib.util
import tempfile
import unittest
from pathlib import Path
ROOT=Path(__file__).resolve().parents[2]
spec=importlib.util.spec_from_file_location('chapters',ROOT/'scripts/reports/audit_rgs_chapters.py')
m=importlib.util.module_from_spec(spec);spec.loader.exec_module(m)

def fixture():
    r={key:'0' for key in m.HEADERS}
    r.update({'Esercizio Finanziario':'2025','Stato di Previsione':'02','Numero Capitolo di Spesa':'1000','Codice Titolo':'1','Capitolo di Spesa':'Esempio sintetico, non dato reale'})
    return r

class ChaptersTests(unittest.TestCase):
    def test_zero_row(self):
        result=m.analyse_rows([fixture()]);self.assertEqual(result['arithmeticChecks'],11);self.assertEqual(result['arithmeticMismatches'],[])
    def test_currency_formats(self):
        for raw,wanted in [('1.234,56',123456),('1234,56',123456),('1234.56',123456),('-0,01',-1),('0',0),('9007199254740993,99',900719925474099399)]:
            with self.subTest(raw=raw):self.assertEqual(m.cents(raw),wanted)
    def test_bad_numbers(self):
        for raw in ['', '1.234','12,345','NaN','Inf','=1+1','1e6','1,2,3']:
            with self.subTest(raw=raw),self.assertRaises(ValueError):m.cents(raw)
    def test_arithmetic_error(self):
        r=fixture();r['Totale CP']='1';a=m.analyse_rows([r]);self.assertTrue(any(x['rule']=='totale-CP' for x in a['arithmeticMismatches']))
    def test_unequal_sources_do_not_pass(self):
        with tempfile.TemporaryDirectory() as d:
            p=Path(d)/'fake.csv';p.write_text('synthetic')
            with self.assertRaises(ValueError):m.load_locked(p)
    def test_same_chapter_different_ministries(self):
        a=fixture();b=fixture();b['Stato di Previsione']='03'
        result=m.analyse_rows([a,b]);self.assertFalse(result['duplicateDimensions']);self.assertEqual(len(result['totalsByMinistryAndTitle']),2)
    def test_duplicate_dimensions(self):
        a=fixture();result=m.analyse_rows([a,copy.deepcopy(a)]);self.assertEqual(len(result['duplicateDimensions']),1)
    def test_duplicate_description_is_not_identity(self):
        a=fixture();b=fixture();b['Numero Capitolo di Spesa']='1001';self.assertFalse(m.analyse_rows([a,b])['duplicateDimensions'])
    def test_title_totals_stay_separate(self):
        a=fixture();b=fixture();b['Codice Titolo']='3';self.assertEqual(len(m.analyse_rows([a,b])['totalsByMinistryAndTitle']),2)
    def test_no_automatic_waste_label(self):
        result=m.analyse_rows([fixture()]);self.assertTrue(result['screening']['notFraudOrWasteClassifier']);self.assertFalse(result['screening']['deadlinesKnown'])
    def test_missing_column(self):
        a=fixture();del a['Pagato CS']
        with self.assertRaises(ValueError):m.analyse_rows([a])
    def test_wrong_year(self):
        a=fixture();a['Esercizio Finanziario']='2024'
        with self.assertRaises(ValueError):m.analyse_rows([a])
    def test_negative_economy_is_not_overrun(self):
        a=fixture();a['Previsioni Iniziali CP']=a['Previsioni Definitive CP']='10';a['Economie-Maggiori Spese CP']='-10'
        result=m.analyse_rows([a]);self.assertFalse(result['arithmeticMismatches']);self.assertFalse(result['signals'])
    def test_large_unpaid_is_screening(self):
        a=fixture()
        for key in ['Previsioni Iniziali CP','Previsioni Definitive CP','Totale CP','Rimasto da Pagare CP','RS al 31/12']:a[key]='2000000'
        result=m.analyse_rows([a]);self.assertFalse(result['arithmeticMismatches']);self.assertEqual(result['signals'][0]['rule'],'quota-impegni-non-pagata')
    def test_materiality_does_not_hide_arithmetic(self):
        a=fixture();a['Totale CP']='0,01'
        result=m.analyse_rows([a],10**16);self.assertTrue(result['arithmeticMismatches'])
    def test_none_value(self):
        a=fixture();a['Pagato CS']=None
        with self.assertRaises(ValueError):m.analyse_rows([a])
    def test_inputs_not_mutated(self):
        a=fixture();original=copy.deepcopy(a);m.analyse_rows([a]);self.assertEqual(a,original)
    def test_empty_input(self):
        with self.assertRaises(ValueError):m.analyse_rows([])
if __name__=='__main__':unittest.main()
