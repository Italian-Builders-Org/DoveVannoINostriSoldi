"""Independent Decimal and committed-PDF checks; no original-archive audit is implied."""
import copy
import csv
import hashlib
import importlib.util
import io
import json
import re
import unittest
import unicodedata
from pathlib import Path
from pypdf import PdfReader
ROOT=Path(__file__).resolve().parents[2]
spec=importlib.util.spec_from_file_location('reader_builder',ROOT/'scripts/reports/build_state_budget_reader.py')
builder=importlib.util.module_from_spec(spec);spec.loader.exec_module(builder)
REPORT=json.loads((ROOT/builder.CONTENT).read_text())
class ReaderTests(unittest.TestCase):
    def test_valid(self): builder.validate(REPORT)
    def test_25_decimal_calculations(self):
        self.assertEqual(len(REPORT['calculations']),25)
        for c in REPORT['calculations']:
            with self.subTest(id=c['id']):self.assertEqual(str(builder.number(REPORT,c['id'])),c['expected'])
    def test_changed_operand(self):
        r=copy.deepcopy(REPORT);r['metrics']['pinto-central']['value']='1'
        with self.assertRaises(ValueError):builder.validate(r)
    def test_changed_result(self):
        r=copy.deepcopy(REPORT);r['calculations'][0]['expected']='100'
        with self.assertRaises(ValueError):builder.validate(r)
    def test_wrong_total(self):
        r=copy.deepcopy(REPORT);r['macro']['totalCents']='110915400000001'
        with self.assertRaises(ValueError):builder.validate(r)
    def test_cycle(self):
        r=copy.deepcopy(REPORT);r['calculations'][0]['inputs'][0]=r['calculations'][0]['id']
        with self.assertRaises(ValueError):builder.validate(r)
    def test_missing_case(self):
        r=copy.deepcopy(REPORT);r['cases']=[c for c in r['cases'] if c['id']!='rti']
        with self.assertRaises(ValueError):builder.validate(r)
    def test_new_url_rejected(self):
        r=copy.deepcopy(REPORT);r['route']='/report/v2'
        with self.assertRaises(ValueError):builder.validate(r)
    def test_source_missing(self):
        r=copy.deepcopy(REPORT);r['cases'][0]['sourceIds']=['absent']
        with self.assertRaises(ValueError):builder.validate(r)
    def test_waste_total_rejected(self):
        r=copy.deepcopy(REPORT);r['noNationalWasteTotal']=False
        with self.assertRaises(ValueError):builder.validate(r)
    def test_rti_both_denominators(self):
        self.assertEqual(str(builder.number(REPORT,'rti-company-rest')),'11087847.72')
        self.assertEqual(str(builder.number(REPORT,'rti-total-rest')),'138086105.17')
        self.assertEqual(str(builder.number(REPORT,'rti-without')),'8.03')
    def test_pinto_rounding_is_explicit(self):
        self.assertIn('arrotondati',next(c for c in REPORT['cases'] if c['id']=='processi-lenti')['numberLabel'])
    def test_court_order_not_paid_amount(self):
        self.assertIn('non certifica',next(c for c in REPORT['cases'] if c['id']=='depurazione')['conclusion'])
    def test_pdf_all_editorial_claims(self):
        reader=PdfReader(ROOT/builder.PDF)
        normalize=lambda x:re.sub(r'\s+','',unicodedata.normalize('NFKC',x))
        text=normalize('\n'.join(p.extract_text() for p in reader.pages))
        self.assertNotIn('\u2014',text)
        expected=[REPORT['title'],REPORT['summary'],REPORT['lead'],*REPORT['method'],*REPORT['municipal']['paragraphs']]
        for c in REPORT['cases']:
            expected.extend(c[k] for k in ('title','number','numberLabel','period','lead','conclusion','improve'))
            expected.extend(c['paragraphs'])
            if c['math']:expected.append(c['math']['explanation'])
        for s in REPORT['sources']:expected.extend([s['title'],s['locator']])
        for value in expected:
            with self.subTest(value=value[:65]):self.assertIn(normalize(value),text)
    def test_pdf_source_links(self):
        reader=PdfReader(ROOT/builder.PDF)
        uris={str(a.get_object().get('/A',{}).get('/URI','')) for p in reader.pages for a in p.get('/Annots',[])}
        self.assertLessEqual({s['url'] for s in REPORT['sources']},uris)
        self.assertIn(REPORT['legacyEvidenceUrl'],uris)
    def test_pdf_brand_palette_and_real_logo(self):
        reader=PdfReader(ROOT/builder.PDF);colours=set();images=[]
        for p in reader.pages:
            for args,op in p.get_contents().operations:
                if op==b'rg':colours.add(tuple(round(float(v),3) for v in args))
            for obj in p['/Resources'].get('/XObject',{}).values():
                x=obj.get_object();self.assertEqual(x['/Subtype'],'/Image');images.append((int(x['/Width']),int(x['/Height'])))
        for rgb in ((24/255,43/255,58/255),(23/255,101/255,117/255),(180/255,35/255,50/255)):
            self.assertIn(tuple(round(v,3) for v in rgb),colours)
        self.assertTrue(images);self.assertEqual(set(images),{(48,48)})
        receipt=json.loads((ROOT/builder.RECEIPT).read_text())
        self.assertEqual(receipt['rendering']['logoSha256'],hashlib.sha256((ROOT/'public/brand/icon-48.png').read_bytes()).hexdigest())
    def test_receipt_binds_reader_and_pdf(self):
        receipt=json.loads((ROOT/builder.RECEIPT).read_text())
        self.assertEqual(receipt['readerManuscriptSha256'],hashlib.sha256((ROOT/builder.CONTENT).read_bytes()).hexdigest())
        self.assertEqual(receipt['pdfSha256'],hashlib.sha256((ROOT/builder.PDF).read_bytes()).hexdigest())
    def test_derivatives_identical(self):
        raw=(ROOT/builder.CONTENT).read_bytes()
        for name,expected in builder.derivatives(REPORT,raw).items():self.assertEqual((ROOT/name).read_bytes(),expected)
    def test_csv_contains_exactly_17_cases(self):
        rows=list(csv.DictReader(io.StringIO((ROOT/builder.CSV).read_text(encoding='utf-8-sig'))));self.assertEqual(len(rows),17)
    def test_csv_spreadsheet_formula_escape(self):
        r=copy.deepcopy(REPORT);r['cases'][0]['title']='=1+1'
        out=builder.derivatives(r,json.dumps(r).encode())[builder.CSV].decode('utf-8-sig')
        self.assertEqual(next(csv.DictReader(io.StringIO(out)))['titolo'],"'=1+1")
    def test_register_does_not_fabricate_original_hashes(self):
        register=json.loads((ROOT/'docs/research/state-budget-2025/reader-source-register.json').read_text())
        self.assertEqual(register['sources'],REPORT['sources'])
        self.assertTrue(all(s['originalBytesSha256'] is None for s in register['sources']))
    def test_raw_legacy_manuscript_not_in_new_content(self):
        self.assertEqual(REPORT['legacyEvidenceUrl'].split('/tree/')[1].split('/')[0],'62c70b65716c1e5b2ce784950e081b6bd41d52ad')
if __name__=='__main__':unittest.main()
