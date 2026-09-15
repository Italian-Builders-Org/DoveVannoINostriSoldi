"""Public text, source labels and classification regressions for the archive."""
import copy
import csv
import importlib.util
import io
import json
import re
import unittest
from pathlib import Path
from pypdf import PdfReader
ROOT=Path(__file__).resolve().parents[2]
spec=importlib.util.spec_from_file_location('builder',ROOT/'scripts/reports/build_state_budget_reader.py')
b=importlib.util.module_from_spec(spec);spec.loader.exec_module(b)
r=json.loads((ROOT/b.CONTENT).read_text())
class ReviewTests(unittest.TestCase):
    def test_three_cases_added_not_replacement(self):
        self.assertEqual(len(r['cases']),25)
        self.assertEqual(len([c for c in r['cases'] if c['legacyId']]),11)
    def test_documents(self):
        self.assertEqual(len(r['spendingReview']['documents']),19)
        rows=list(csv.DictReader(io.StringIO(b.archive_csv(r).decode('utf-8-sig'))))
        self.assertEqual(len(rows),19);self.assertTrue(all(x['lettura'] for x in rows))
    def test_forecast_relabelling_rejected(self):
        x=copy.deepcopy(r);x['spendingReview']['series'][1]['rows'][-1]['status']='riportato'
        with self.assertRaises(ValueError):b.validate(x)
    def test_proposal_relabelling_rejected(self):
        x=copy.deepcopy(r);x['spendingReview']['series'][0]['rows'][0]['status']='risultato'
        with self.assertRaises(ValueError):b.validate(x)
    def test_missing_source_rejected(self):
        x=copy.deepcopy(r);x['spendingReview']['documents'][0]['sourceId']='absent'
        with self.assertRaises(ValueError):b.validate(x)
    def test_missing_case_rejected(self):
        x=copy.deepcopy(r);x['spendingReview']['tracker'][0]['caseId']='absent'
        with self.assertRaises(ValueError):b.validate(x)
    def test_positive_result_not_categorised_as_waste(self):
        self.assertEqual(next(c for c in r['cases'] if c['id']=='esercito-acquisti-efficienti')['kind'],'risparmio')
    def test_energy_not_quantified_as_five_million_loss(self):
        c=next(c for c in r['cases'] if c['id']=='energia-obiettivo-mancato')
        self.assertIsNone(c['math']);self.assertNotIn('milioni',c['number'])
    def test_no_claim_of_raw_coverage(self):
        self.assertEqual(r['audit']['upstream']['rowsReprocessed'],0)
        self.assertFalse(r['audit']['upstream']['declaredHashesVerified'])
    def test_original_bytes_not_faked(self):
        e=json.loads((ROOT/'docs/research/state-budget-2025/spending-review-evidence.json').read_text())
        self.assertFalse(e['originalPdfBytesAcquired']);self.assertIsNone(e['originalPdfSha256'])
    def test_pdf_new_archive_text(self):
        normalize=lambda s:re.sub(r'\s+','',s)
        pdf=PdfReader(ROOT/b.PDF);text=normalize('\n'.join(p.extract_text() for p in pdf.pages))
        sr=r['spendingReview'];pieces=[sr['title'],*sr['intro'],sr['scope'],sr['conclusion']]
        for era in sr['chronology']:pieces += [era['actor'],era['title'],era['text']]
        for t in sr['tracker']:pieces += [t['theme'],t['proposal'],t['result'],t['measure']]
        for d in sr['documents']:pieces += [d['title'],d['reading'],d['use']]
        for c in sr['corrections']:pieces += [c['claim'],c['finding']]
        for piece in pieces:
            with self.subTest(piece=piece[:60]):self.assertIn(normalize(piece),text)
    def test_pdf_original_document_links(self):
        pdf=PdfReader(ROOT/b.PDF)
        links={str(a.get_object().get('/A',{}).get('/URI','')) for p in pdf.pages for a in p.get('/Annots',[])}
        self.assertLessEqual({d['url'] for d in r['spendingReview']['documents']},links)
if __name__=='__main__':unittest.main()
