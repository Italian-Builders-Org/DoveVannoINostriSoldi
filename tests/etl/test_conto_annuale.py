"""Validate source identity, scope and every committed Conto Annuale row offline."""
import copy
import csv
import io
import json
import gzip
from pathlib import Path
import tempfile
import unittest
from unittest.mock import patch

import conto_annuale as etl


class ContoAnnualeTests(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        cls.spec = json.loads(etl.SPEC.read_text())

    def sample(self, index=0):
        source = copy.deepcopy(self.spec['sources'][index])
        reader = csv.DictReader(io.StringIO(etl.read_source(source, '2020').decode('utf-8-sig')))
        row = next(reader)
        source.update(rows=1, institutions=1, repeatedDimensionKeys=0)
        return row, source

    def encode(self, rows, source):
        output = io.StringIO(newline='')
        writer = csv.DictWriter(output, fieldnames=source['headers'], lineterminator='\n')
        writer.writeheader()
        writer.writerows(rows)
        payload = output.getvalue().encode()
        source['replacementCharacters'] = payload.decode().count('\ufffd')
        return payload

    def test_all_original_bytes_reproduce_public_rows_receipts_and_catalog(self):
        etl.check_committed(etl.projections(self.spec))

    def test_signed_cost_is_not_negated_twice_and_zero_is_preserved(self):
        for value, sign in [('-125', '-'), ('0', '+'), ('125', '+')]:
            with self.subTest(value=value):
                row, source = self.sample()
                row.update(totale_spesa=value, flag_segno=sign)
                payload, entities = etl.projection(self.encode([row], source), source, '2020')
                projected = next(csv.DictReader(io.StringIO(payload.decode()), delimiter='|'))
                self.assertEqual(projected['Importo euro'], value)
                self.assertEqual(projected['Segno fonte'], sign)
                self.assertEqual(projected['Anno'], '2020')
                self.assertEqual(projected['Codice amministrazione RGS'], 'U:11799')
                self.assertEqual(entities, {('U', '11799')})
                self.assertNotIn('codi_fiscale', projected)

    def test_person_counts_keep_zero_and_do_not_infer_fte(self):
        row, source = self.sample(1)
        row['part_time_inf50percento_uomini'] = '0'
        payload, _ = etl.projection(self.encode([row], source), source, '2020')
        projected = next(csv.DictReader(io.StringIO(payload.decode()), delimiter='|'))
        self.assertEqual(projected['Part time <50% uomini'], '0')
        self.assertNotIn('Totale', projected)

    def test_missing_invalid_sign_counts_and_duplicates_fail_closed(self):
        for index, field, value in [(0, 'totale_spesa', ''), (0, 'totale_spesa', '1.5'),
                                    (0, 'flag_segno', '-'), (1, 'personale_tempo_pieno_uomini', '-1'),
                                    (1, 'personale_tempo_pieno_uomini', 'n.d.')]:
            with self.subTest(field=field, value=value), self.assertRaises(etl.SourceError):
                row, source = self.sample(index)
                row[field] = value
                etl.projection(self.encode([row], source), source, '2020')
        row, source = self.sample()
        source['rows'] = 2
        with self.assertRaisesRegex(etl.SourceError, 'duplicata'):
            etl.projection(self.encode([row, row], source), source, '2020')

    def test_known_repeated_dimensions_preserve_both_rows_but_new_ones_fail(self):
        row, source = self.sample(1)
        second = dict(row, personale_tempo_pieno_uomini='0')
        source.update(rows=2, repeatedDimensionKeys=1)
        payload, _ = etl.projection(self.encode([row, second], source), source, '2020')
        self.assertEqual(len(list(csv.DictReader(io.StringIO(payload.decode()), delimiter='|'))), 2)
        source['repeatedDimensionKeys'] = 0
        with self.assertRaisesRegex(etl.SourceError, 'copertura'):
            etl.projection(self.encode([row, second], source), source, '2020')

    def test_missing_dataset_or_duplicate_distribution_fails_closed(self):
        with self.assertRaisesRegex(etl.SourceError, 'mancanti'):
            etl.check_committed({})
        spec = copy.deepcopy(self.spec)
        spec['sources'].append(copy.deepcopy(spec['sources'][0]))
        with self.assertRaisesRegex(etl.SourceError, 'perimetro'):
            etl.projections(spec)

    def test_streaming_reconciliation_rejects_changed_cells_envelopes_and_receipts(self):
        corpus_spec, all_items = etl.corpus.load_spec(etl.corpus.DEFAULT_SPEC)
        items, payloads, entries = [], {}, []
        with tempfile.TemporaryDirectory() as directory:
            root = Path(directory)
            rows_dir = root / 'src/data/generated/integrated/rows'
            receipts_dir = root / 'data/source-ledger/datasets'
            rows_dir.mkdir(parents=True)
            receipts_dir.mkdir(parents=True)
            for index in range(2):
                row, source = self.sample(index)
                payload, _ = etl.projection(self.encode([row], source), source, '2020')
                item = copy.deepcopy(next(d for d in all_items if d['id'] == source['datasetId']))
                item['expected'].update(bytes=len(payload), sha256=etl.corpus.sha256_bytes(payload), rows=1)
                items.append(item)
                payloads[item['id']] = payload
                (root / item['relativePath']).write_bytes(payload)
                entry, published, receipt, _ = etl.corpus.build_dataset(
                    item, etl.corpus.parse_dataset(root, item), etl.corpus.resolved_source_metadata(corpus_spec, item['id']))
                entries.append(entry)
                (rows_dir / etl.corpus.row_chunk_name(item['id'], 0)).write_bytes(etl.corpus.canonical_gzip(published))
                (receipts_dir / f"{item['id']}.receipt.json").write_bytes(etl.corpus.canonical_json(receipt))
            (rows_dir.parent / 'catalog.json').write_text(json.dumps({'datasets': entries}))
            with patch.object(etl, 'ROOT', root), patch.object(etl.corpus, 'load_spec', return_value=(corpus_spec, items)):
                etl.check_committed(payloads)
                chunk = rows_dir / etl.corpus.row_chunk_name(items[0]['id'], 0)
                original = chunk.read_bytes()
                for field, value in [('sourceRow', 2), ('sourceUrls', []), ('unexpected', True)]:
                    changed = json.loads(gzip.decompress(original))
                    changed[field] = value
                    chunk.write_bytes(etl.corpus.canonical_gzip(etl.corpus.canonical_json(changed)))
                    with self.subTest(field=field), self.assertRaises(etl.SourceError):
                        etl.check_committed(payloads)
                changed = json.loads(gzip.decompress(original))
                changed['cells']['Importo euro'] = '0'
                chunk.write_bytes(etl.corpus.canonical_gzip(etl.corpus.canonical_json(changed)))
                with self.assertRaises(etl.SourceError):
                    etl.check_committed(payloads)
                chunk.write_bytes(original)
                receipt_path = receipts_dir / f"{items[0]['id']}.receipt.json"
                receipt = json.loads(receipt_path.read_bytes())
                receipt['publication']['redactions'] = 1
                receipt_path.write_text(json.dumps(receipt))
                with self.assertRaisesRegex(etl.SourceError, 'ricevuta'):
                    etl.check_committed(payloads)

    def test_source_hash_schema_period_and_license_drift_fail_closed(self):
        source = copy.deepcopy(self.spec['sources'][0])
        for field in ['sha256', 'fixture']:
            changed = copy.deepcopy(source)
            if field == 'fixture':
                changed[field]['sha256'] = '0' * 64
            else:
                changed[field] = '0' * 64
            with self.subTest(field=field), self.assertRaises(etl.SourceError):
                etl.read_source(changed, '2020')
        with self.assertRaisesRegex(etl.SourceError, 'periodo'):
            etl.read_source(source, '2021')
        original = etl.fixture
        def changed_license(lock):
            payload = original(lock)
            if lock == source['metadataFixture']:
                metadata = json.loads(payload)
                next(p for p in metadata['result']['results'] if p['name'] == source['packageName'])['license_id'] = 'not-declared'
                return json.dumps(metadata).encode()
            return payload
        with patch.object(etl, 'fixture', side_effect=changed_license), self.assertRaisesRegex(etl.SourceError, 'licenza'):
            etl.read_source(source, '2020')
        row, source = self.sample()
        payload = self.encode([row], source).replace(b'codi_istituzione,', b'unknown,', 1)
        with self.assertRaisesRegex(etl.SourceError, 'schema'):
            etl.projection(payload, source, '2020')


if __name__ == '__main__':
    unittest.main()
