"""IVA boundaries: source units, suppression, edition identity and offline integrity."""
import copy
import csv
import io
import json
from pathlib import Path
import tempfile
import unittest

import mef_iva_snapshot as iva


class IvaSnapshotTests(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        cls.spec = iva.load_spec()
        cls.data = json.loads(iva.DEFAULT_DATA.read_text())

    def test_committed_snapshot_is_hash_locked(self):
        iva.check()

    def test_exact_thousand_euro_conversion(self):
        self.assertEqual(iva.parse_cell('4.737.173.202', 'amount')['value'], 473717320200000)
        self.assertEqual(iva.parse_cell('1.305,94', 'mean')['value'], 130594000)
        self.assertEqual(iva.parse_cell(' -390,08', 'mean', True)['value'], -39008000)
        self.assertEqual(iva.parse_cell('4.174.782', 'count')['value'], 4174782)

    def test_zero_suppression_and_missing_remain_distinct(self):
        self.assertEqual(iva.parse_cell('0', 'count'), {'value': 0, 'status': 'observed'})
        self.assertEqual(iva.parse_cell('***', 'amount'), {'value': None, 'status': 'suppressed'})
        self.assertEqual(iva.parse_cell('', 'mean'), {'value': None, 'status': 'missing'})

    def test_unexpected_numeric_formats_fail_closed(self):
        for raw, nature in [('1e3', 'amount'), ('+1', 'count'), ('1.23', 'amount'), ('12,3', 'mean'), ('12,345', 'mean'), ('1,00', 'amount'), ('NaN', 'mean'), ('n.d.', 'count'), ('-1', 'count'), ('-1', 'amount'), ('90.071.992.548', 'amount')]:
            with self.subTest(raw=raw, nature=nature), self.assertRaises(ValueError):
                iva.parse_cell(raw, nature)

    def test_distinct_autonomous_provinces_share_source_code_only(self):
        rows = [r for r in self.data['tables'][0]['rows'] if r['sourceCode'] == '04']
        self.assertEqual([r['id'] for r in rows], ['regione:04-trento', 'regione:04-bolzano'])
        self.assertEqual(len({r['label'] for r in rows}), 2)

    def test_activity_dictionary_is_bound_to_edition(self):
        rows = [[r for r in self.data['tables'][i]['rows'] if r['sourceCode'] == '11'][0] for i in [1, 3]]
        self.assertNotEqual(rows[0]['id'], rows[1]['id'])
        self.assertIn('finanziarie', rows[0]['label'])
        self.assertIn('Telecomunicazioni', rows[1]['label'])
        self.assertEqual([len(t['rows']) for t in self.data['tables']], [23, 23, 23, 24])

    def test_rejects_year_dictionary_and_cell_drift(self):
        mutations = [
            lambda d: d['tables'][0].update(taxYear=2024),
            lambda d: d['tables'][0]['rows'][5].update(id='regione:04-trento'),
            lambda d: d['tables'][3]['rows'][10].update(label='Attività finanziarie e assicurative'),
            lambda d: d['tables'][0]['rows'][0]['taxpayers'].update(value=True),
            lambda d: d['tables'][0]['rows'][0]['values'][0]['amountCents'].update(value=1),
            lambda d: d['tables'][0]['rows'][0]['taxpayers'].update(status='suppressed'),
            lambda d: d['tables'][0]['rows'][0]['values'][0]['frequency'].update(value=999999999),
            lambda d: d['tables'][0]['rows'][0]['taxpayers'].update(value=1),
        ]
        for mutate in mutations:
            with self.subTest(mutation=mutate):
                data = copy.deepcopy(self.data)
                mutate(data)
                with self.assertRaises(iva.SnapshotError):
                    iva.validate_data(data, self.spec)

    def test_suppressed_source_cells_not_reconstructed(self):
        cells = [v[k] for t in self.data['tables'] for r in t['rows'] for v in r['values'] for k in ['frequency', 'amountCents', 'meanCents']]
        self.assertTrue(any(c['status'] == 'suppressed' for c in cells))
        self.assertTrue(all(c['value'] is None for c in cells if c['status'] == 'suppressed'))

    def test_independent_projection_pin_rejects_rehashed_mutation(self):
        data = copy.deepcopy(self.data)
        # Changing one published mean avoids additive checks; independent source
        # projection pin must still reject even when metadata was regenerated.
        data['tables'][0]['rows'][0]['values'][0]['meanCents']['value'] += 1000
        payload = (json.dumps(data, ensure_ascii=False, indent=2) + '\n').encode()
        with tempfile.TemporaryDirectory() as tmp:
            dp, mp = Path(tmp)/'data.json', Path(tmp)/'meta.json'
            dp.write_bytes(payload)
            mp.write_text(json.dumps(iva.metadata(self.spec, payload, data)))
            with self.assertRaisesRegex(iva.SnapshotError, 'pinned source projection'):
                iva.check(data_path=dp, meta_path=mp)

    def fixture_csv(self, table):
        stream = io.StringIO()
        writer = csv.writer(stream, delimiter=';', lineterminator='\n')
        writer.writerows(table['preamble'])
        writer.writerow(table['header'])
        # Synthetic source rows reproduce unquoted delimiters in official labels.
        for entry in table['dictionary']:
            writer.writerow(entry['sourceLabel'].split(';') + [entry['sourceCode'], '0'] + ['0', '0', '0,00']*10 + [''])
        writer.writerows([[], ['Ammontare e media in migliaia di euro']])
        return b'\xef\xbb\xbf' + stream.getvalue().encode()

    def test_csv_unquoted_label_delimiters_require_exact_dictionary(self):
        table = self.spec['tables'][1]
        payload = self.fixture_csv(table)
        parsed = iva.parse_table(payload, table)
        self.assertEqual(parsed['rows'][4]['label'], table['dictionary'][4]['label'])
        for mutated in [payload.replace(b'Fornitura di acqua;', b'Fornitura di acqua;extra;'), payload.replace(b'Numero contribuenti IVA', b'Contribuenti'), payload.replace(b'migliaia di euro', b'euro'), payload[3:], payload.replace(b'Anno presentazione:;2024', b'Anno presentazione:;2025')]:
            with self.assertRaises(iva.SnapshotError):
                iva.parse_table(mutated, table)

    def test_source_bytes_are_required_and_verified(self):
        with tempfile.TemporaryDirectory() as tmp:
            first = self.spec['tables'][0]['receipts']['csv']
            (Path(tmp)/first['filename']).write_bytes(b'not official source bytes')
            with self.assertRaisesRegex(iva.SnapshotError, 'bytes/hash drift'):
                iva.build(Path(tmp), self.spec)


if __name__ == '__main__':
    unittest.main()
