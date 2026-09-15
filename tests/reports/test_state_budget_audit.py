"""Mutation checks for the acquired aggregates; fixtures are not original RGS bytes."""
import copy
import csv
import hashlib
import io
import json
import runpy
import tempfile
import unittest
from pathlib import Path

ROOT = Path(__file__).resolve().parents[2]
AUDIT = runpy.run_path(str(ROOT / 'scripts/reports/audit_state_budget.py'))
REPORT = json.loads((ROOT / AUDIT['CONTENT']).read_text())


class AuditTests(unittest.TestCase):
    def test_measured_coverage_and_62_checks(self):
        out = AUDIT['analyse'](REPORT)
        self.assertEqual(len(out['checks']), 62)
        self.assertTrue(all(c['passed'] for c in out['checks']))
        self.assertEqual(out['coverage']['acquiredAmountCells'], 105)
        self.assertEqual(out['coverage']['chapterRowsReprocessed'], 0)

    def test_csv_units_and_exact_values(self):
        out = AUDIT['derivatives'](REPORT)
        rows = list(csv.DictReader(io.StringIO(out[AUDIT['MINISTRIES_CSV']].decode('utf-8-sig'))))
        self.assertEqual(len(rows), 15)
        self.assertTrue(all(r['unit'] == 'EUR_cent' for r in rows))
        self.assertEqual(rows[0]['commitmentsCpCents'], REPORT['audit']['ministries'][0]['commitmentsCpCents'])

    def test_history_is_ten_stocks_not_a_cumulative_sum(self):
        rows = REPORT['audit']['history']
        self.assertEqual([r['year'] for r in rows], list(range(2015, 2025)))
        self.assertEqual((rows[0]['totalMillion'], rows[-1]['totalMillion']), (109691, 187959))

    def test_rounded_components_are_preserved(self):
        checks = [c for c in AUDIT['analyse'](REPORT)['checks'] if c['id'].startswith('history-')]
        self.assertEqual(sum(c['difference'] != '0' for c in checks), 2)
        self.assertTrue(all(abs(int(c['difference'])) <= 1 for c in checks))

    def test_missing_upstream_is_not_passed(self):
        with tempfile.TemporaryDirectory() as temp:
            result = AUDIT['verify_upstream'](REPORT['audit'], Path(temp))
            self.assertFalse(result['verified'])
            with self.assertRaises(ValueError):
                AUDIT['verify_upstream'](REPORT['audit'], Path(temp), required=True)

    def test_upstream_synthetic_fixture_and_transcription_mutation(self):
        with tempfile.TemporaryDirectory() as temp:
            root = Path(temp)
            a = copy.deepcopy(REPORT['audit'])
            payload = {'ministries': a['ministries'], 'totals': a['totals']}
            raw = json.dumps(payload).encode()
            p = root / AUDIT['SNAPSHOT']; p.parent.mkdir(parents=True); p.write_bytes(raw)
            a['upstream']['snapshotSha256Declared'] = hashlib.sha256(raw).hexdigest()
            self.assertTrue(AUDIT['verify_upstream'](a, root, required=True)['verified'])
            a['ministries'][0]['remainingCpCents'] = '1'
            with self.assertRaises(ValueError):
                AUDIT['verify_upstream'](a, root, required=True)

    def test_upstream_changed_hash_rejected(self):
        with tempfile.TemporaryDirectory() as temp:
            root = Path(temp); p = root / AUDIT['SNAPSHOT']; p.parent.mkdir(parents=True); p.write_text('{}')
            with self.assertRaises(ValueError):
                AUDIT['verify_upstream'](REPORT['audit'], root, required=True)


def mutation_test(mutate):
    def test(self):
        r = copy.deepcopy(REPORT)
        mutate(r)
        with self.assertRaises((ValueError, KeyError)):
            AUDIT['analyse'](r)
    return test


MUTATIONS = {
    'one_cent': lambda r: r['audit']['ministries'][0].__setitem__('remainingCpCents', str(int(r['audit']['ministries'][0]['remainingCpCents']) + 1)),
    'total': lambda r: r['audit']['totals'].__setitem__('paymentsCashCsCents', '1'),
    'missing_ministry': lambda r: r['audit']['ministries'].pop(),
    'duplicate_ministry': lambda r: r['audit']['ministries'][0].__setitem__('code', r['audit']['ministries'][1]['code']),
    'negative_cents': lambda r: r['audit']['ministries'][0].__setitem__('remainingRsCents', '-1'),
    'fractional_cents': lambda r: r['audit']['ministries'][0].__setitem__('remainingRsCents', '1.1'),
    'missing_year': lambda r: r['audit']['history'].pop(),
    'wrong_history_component': lambda r: r['audit']['history'][0].__setitem__('capitalMillion', 1),
    'fractional_year_amount': lambda r: r['audit']['history'][0].__setitem__('newMillion', 1.5),
    'chart_disconnected': lambda r: r['metrics']['residual-2015'].__setitem__('value', '1'),
    'foreign_disconnected': lambda r: r['audit']['foreignRows'][0].__setitem__('million', '1'),
    'portfolio_disconnected': lambda r: r['audit']['portfolios'][0].__setitem__('billion', '1'),
    'fake_full_coverage': lambda r: r['audit']['upstream'].__setitem__('rowsReprocessed', 5395),
    'fake_verified_hash': lambda r: r['audit']['upstream'].__setitem__('declaredHashesVerified', True),
    'missing_chapter_case': lambda r: r['chapters'][0]['caseIds'].pop(),
    'missing_source': lambda r: r['audit'].__setitem__('sourceId', 'unseen'),
}
for name, mutate in MUTATIONS.items():
    setattr(AuditTests, 'test_rejects_' + name, mutation_test(mutate))

if __name__ == '__main__':
    unittest.main()
