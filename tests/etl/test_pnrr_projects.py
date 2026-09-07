from __future__ import annotations
import copy
import csv
import io
import json
import tempfile
import unittest
from pathlib import Path

import pnrr_projects as etl
from pnrr_childcare_snapshot import OFFICIAL_CSV_HEADERS


class PnrrProjectsTests(unittest.TestCase):
    def setUp(self):
        self.temporary = tempfile.TemporaryDirectory()
        self.root = Path(self.temporary.name)
        self.spec = json.loads(etl.SPEC.read_bytes())
        project = dict.fromkeys(OFFICIAL_CSV_HEADERS['projects'], '')
        project.update({'CUP': 'A12B34567890001', 'Codice Locale Progetto': 'first',
                        'Codice Univoco Submisura': 'M1C1I1.01.00', 'Missione': 'M1',
                        'Componente': 'M1C1', 'Codice Univoco Misura': 'M1C1I1.01',
                        'Data di Estrazione': '13/06/2026', 'Finanziamento PNRR': '0',
                        'Finanziamento Totale': '12345678901234,01',
                        'Codice Fiscale Soggetto Attuatore': '*' * 16})
        second = dict(project, **{'Codice Locale Progetto': 'second', 'Finanziamento PNRR': '',
                                  'Codice Fiscale Soggetto Attuatore': '', 'Codice Univoco Misura': ''})
        self.projects = [project, second]
        location = dict.fromkeys(OFFICIAL_CSV_HEADERS['locations'], '')
        location.update({key: project[key] for key in ('CUP', 'Codice Locale Progetto', 'Codice Univoco Submisura', 'Data di Estrazione')})
        location.update({'Regione': '012', 'Descrizione Regione': 'LAZIO', 'Provincia': '058',
                         'Descrizione Provincia': 'ROMA', 'Comune': '091', 'Descrizione Comune': 'ROMA',
                         'Percentuale di Localizzazione': '50,00'})
        self.locations = [location, dict(location, Comune='001', **{'Descrizione Comune': 'AFFILE'})]
        self.spec['coverage'] = {'projectRows': 2, 'uniqueCups': 1, 'locationRows': 2,
                                 'withoutLocations': 1, 'maskedTaxCodes': 1, 'missingTaxCodes': 1,
                                 'missingMeasureCodes': 1}
        for name, asset in self.spec['assets'].items():
            if name.endswith('.zip'):
                payload = b'metadata fixture'
                (self.root / name).write_bytes(payload)
                asset.update(bytes=len(payload), sha256=etl.corpus.sha256_bytes(payload))
        self.write_sources()

    def tearDown(self): self.temporary.cleanup()

    def write_sources(self):
        for kind, name, rows in [('projects', 'PNRR_Progetti.csv', self.projects), ('locations', 'PNRR_Localizzazione.csv', self.locations)]:
            output = io.StringIO(newline='')
            writer = csv.DictWriter(output, fieldnames=OFFICIAL_CSV_HEADERS[kind], delimiter=';', lineterminator='\n')
            writer.writeheader(); writer.writerows(rows)
            payload = output.getvalue().encode('utf-8-sig')
            (self.root / name).write_bytes(payload)
            self.spec['assets'][name].update(bytes=len(payload), sha256=etl.corpus.sha256_bytes(payload))

    def test_same_cup_preserves_clp_and_all_locations_without_repeating_funding(self):
        payload = etl.project(self.root, self.spec)
        rows = list(csv.DictReader(io.StringIO(payload.decode()), delimiter='|'))
        self.assertEqual(len(rows), 2)
        self.assertEqual(rows[0]['Finanziamento PNRR'], '0')
        self.assertEqual(rows[1]['Finanziamento PNRR'], '')
        self.assertEqual(rows[0]['Finanziamento Totale'], '12345678901234,01')
        self.assertEqual(len(json.loads(rows[0]['Localizzazioni'])), 2)
        self.assertEqual(json.loads(rows[1]['Localizzazioni']), [])
        self.assertEqual(rows[0]['Codice Fiscale Soggetto Attuatore'], '*' * 16)

    def test_duplicate_composite_identity_blocks_projection(self):
        self.projects.append(copy.deepcopy(self.projects[0])); self.write_sources()
        with self.assertRaisesRegex(etl.SourceError, 'duplicata'): etl.project(self.root, self.spec)

    def test_orphan_location_blocks_projection(self):
        self.locations[0]['Codice Locale Progetto'] = 'orphan'; self.write_sources()
        with self.assertRaisesRegex(etl.SourceError, 'senza progetto'): etl.project(self.root, self.spec)

    def test_unknown_personal_identifier_is_not_published(self):
        self.projects[0]['Codice Fiscale Soggetto Attuatore'] = 'RSSMRA80A01H501U'; self.write_sources()
        with self.assertRaisesRegex(etl.SourceError, 'privacy'): etl.project(self.root, self.spec)

    def test_money_does_not_round_or_coerce_unknown_tokens(self):
        for amount in ['1,001', '-1', '1.000,00', 'n.d.', '1e6']:
            with self.subTest(amount=amount):
                self.projects[0]['Finanziamento PNRR'] = amount; self.write_sources()
                with self.assertRaisesRegex(etl.SourceError, 'decimale'): etl.project(self.root, self.spec)

    def test_source_hash_schema_and_period_fail_closed(self):
        path = self.root / 'PNRR_Progetti.csv'; path.write_bytes(path.read_bytes() + b'\n')
        with self.assertRaisesRegex(etl.SourceError, 'Hash'): etl.project(self.root, self.spec)
        self.write_sources()
        self.spec['assets']['PNRR_Progetti.csv']['headers'] = ['unexpected']
        with self.assertRaisesRegex(etl.SourceError, 'Schema'): etl.project(self.root, self.spec)
        self.spec['assets']['PNRR_Progetti.csv']['headers'] = list(OFFICIAL_CSV_HEADERS['projects'])
        self.projects[0]['Data di Estrazione'] = '14/06/2026'; self.write_sources()
        with self.assertRaisesRegex(etl.SourceError, 'Periodo'): etl.project(self.root, self.spec)

    def test_coverage_must_close(self):
        self.spec['coverage']['projectRows'] += 1
        with self.assertRaisesRegex(etl.SourceError, 'Copertura'): etl.project(self.root, self.spec)

if __name__ == '__main__': unittest.main()
