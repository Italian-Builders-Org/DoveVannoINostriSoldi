#!/usr/bin/env python3
"""Project a pinned Italia Domani release and derive exact lookup indexes offline."""
from __future__ import annotations

import argparse
import csv
import gzip
import io
import hashlib
import json
import re
from collections import Counter, defaultdict
from datetime import datetime
from pathlib import Path

import integrated_curated_datasets as corpus
from pnrr_childcare_snapshot import OFFICIAL_CSV_HEADERS

ROOT = Path(__file__).resolve().parents[2]
SPEC = ROOT / 'scripts/etl/specs/pnrr-projects.source.json'
INDEX_DIR = ROOT / 'src/data/generated/pnrr-projects-index'
DATASET = 'pnrr-progetti'
FIELDS = {'cup': 'CUP', 'mission': 'Missione', 'component': 'Componente',
          'measure': 'Codice Univoco Misura', 'submeasure': 'Codice Univoco Submisura',
          'code': 'Codice Fiscale Soggetto Attuatore'}
LOCATION_FIELDS = ['Regione', 'Descrizione Regione', 'Provincia', 'Descrizione Provincia',
                   'Comune', 'Descrizione Comune', 'Percentuale di Localizzazione']

class SourceError(ValueError):
    pass


def identity(row: dict) -> tuple[str, str, str]:
    return row['CUP'], row['Codice Locale Progetto'], row['Codice Univoco Submisura']


def source_rows(input_dir: Path, spec: dict, kind: str):
    name = 'PNRR_Progetti.csv' if kind == 'projects' else 'PNRR_Localizzazione.csv'
    path = input_dir / name
    digest = hashlib.sha256()
    with path.open('rb') as handle:
        for block in iter(lambda: handle.read(1024 * 1024), b''): digest.update(block)
    asset = spec['assets'][name]
    if path.stat().st_size != asset['bytes'] or digest.hexdigest() != asset['sha256']:
        raise SourceError(f'Hash/byte sorgente divergenti: {name}')
    with path.open(encoding='utf-8-sig', newline='') as handle:
        reader = csv.DictReader(handle, delimiter=';')
        if reader.fieldnames != list(OFFICIAL_CSV_HEADERS[kind]) or reader.fieldnames != asset['headers']:
            raise SourceError('Schema ufficiale divergente')
        for row in reader:
            if None in row or any(value is None for value in row.values()):
                raise SourceError('Riga troncata o colonne in eccesso')
            if row['Data di Estrazione'] != datetime.fromisoformat(spec['referenceDate']).strftime('%d/%m/%Y'):
                raise SourceError('Periodo inatteso')
            if (not re.fullmatch(r'[A-Z0-9]{15}', row['CUP']) and identity(row) not in {('N/A', 'N/A', 'M1C2I1.01.00'), ('N/A2', 'N/A2', 'M2C3I2.01.00')}) or not all(identity(row)):
                raise SourceError('Identità progetto mancante o invalida')
            yield row


def project(input_dir: Path, spec: dict) -> bytes:
    if spec['license'] != 'CC-BY-4.0' or spec['locationFields'] != LOCATION_FIELDS:
        raise SourceError('Licenza o contratto localizzazione divergente')
    for name, asset in spec['assets'].items():
        if asset['url'] != 'https://www.italiadomani.gov.it/content/dam/sogei-ng/opendata/' + name:
            raise SourceError('URL ufficiale divergente')
        if name.endswith('.zip'):
            payload = (input_dir / name).read_bytes()
            if len(payload) != asset['bytes'] or corpus.sha256_bytes(payload) != asset['sha256']:
                raise SourceError('Metadati divergenti dal lock')
    locations = defaultdict(list)
    location_count = 0
    for row in source_rows(input_dir, spec, 'locations'):
        if any(not re.fullmatch(r'\d{3}', row[key]) for key in ('Regione', 'Provincia', 'Comune')):
            raise SourceError('Codici territoriali invalidi')
        value = row['Percentuale di Localizzazione']
        if not re.fullmatch(r'\d+(?:,\d{1,2})?', value) or float(value.replace(',', '.')) > 100:
            raise SourceError('Percentuale territoriale invalida')
        locations[identity(row)].append([row[field] or None for field in LOCATION_FIELDS])
        location_count += 1
    records = []
    keys = set()
    cups = set()
    counts = Counter()
    for row in source_rows(input_dir, spec, 'projects'):
        key = identity(row)
        if key in keys: raise SourceError('Identità CUP/CLP/submisura duplicata')
        keys.add(key)
        if re.fullmatch(r'[A-Z0-9]{15}', row['CUP']): cups.add(row['CUP'])
        else: counts['missingCups'] += 1
        if not re.fullmatch(r'M[1-7]', row['Missione']) or not row['Componente'].startswith(row['Missione']):
            raise SourceError('Missione/componente incoerente')
        for field in ('Finanziamento PNRR', 'Finanziamento Totale'):
            if row[field] and not re.fullmatch(r'\d+(?:,\d{1,2})?', row[field]):
                raise SourceError('Importo non decimale esatto')
        cf = row['Codice Fiscale Soggetto Attuatore']
        if cf and cf != '*' * 16 and not re.fullmatch(r'\d{11}|FR\d{11}', cf):
            raise SourceError('Codice fiscale inatteso: revisionare la proiezione privacy')
        counts['maskedTaxCodes'] += cf == '*' * 16
        counts['missingTaxCodes'] += not cf
        counts['missingMeasureCodes'] += not row['Codice Univoco Misura']
        loc = locations.get(key, [])
        counts['withoutLocations'] += not loc
        row['Localizzazioni'] = json.dumps(loc, ensure_ascii=False, separators=(',', ':'))
        row['URL progetti'] = spec['assets']['PNRR_Progetti.csv']['url']
        row['URL localizzazioni'] = spec['assets']['PNRR_Localizzazione.csv']['url']
        records.append([row[field] for field in spec['publicHeaders']])
    if locations.keys() - keys: raise SourceError('Localizzazioni senza progetto')
    actual = dict(counts, projectRows=len(records), uniqueCups=len(cups), locationRows=location_count)
    if actual != spec['coverage']: raise SourceError(f'Copertura divergente: {actual}')
    output = io.StringIO(newline='')
    writer = csv.writer(output, delimiter='|', lineterminator='\n')
    writer.writerow(spec['publicHeaders'])
    writer.writerows(sorted(records, key=lambda row: (row[0], row[1], row[8])))
    return output.getvalue().encode('utf-8')


def public_rows(digest):
    for path in sorted((ROOT / 'src/data/generated/integrated/rows').glob(f'{DATASET}.part-*.jsonl.gz')):
        payload = gzip.decompress(path.read_bytes())
        digest.update(payload)
        for line in payload.splitlines(): yield json.loads(line)


def index_artifacts(spec: dict) -> dict[Path, bytes]:
    indexes = {field: defaultdict(list) for field in (*FIELDS, 'region', 'province', 'territory', 'regionProvince', 'regionTerritory')}
    labels = {field: {} for field in ('mission', 'component', 'measure', 'submeasure', 'region')}
    label_headers = {'mission': 'Descrizione Missione', 'component': 'Descrizione Componente',
                     'measure': 'Descrizione Misura', 'submeasure': 'Descrizione Submisura'}
    row_count = 0
    locations_count = 0
    rows_digest = hashlib.sha256()
    for row in public_rows(rows_digest):
        row_count += 1
        if row['sourceRow'] != row_count: raise SourceError('Ordine pubblico divergente')
        cells = row['cells']
        for field, header in FIELDS.items():
            value = cells[header]
            if value and value != '*' * 16 and (field != 'cup' or re.fullmatch(r'[A-Z0-9]{15}', value)):
                indexes[field][value].append(row_count)
                if field in label_headers: labels[field][value] = cells[label_headers[field]]
        locations = json.loads(cells['Localizzazioni'])
        locations_count += len(locations)
        seen = {field: set() for field in ('region', 'province', 'territory', 'regionProvince', 'regionTerritory')}
        for region, name, province, _province_name, municipality, _name, _share in locations:
            seen['region'].add(region)
            labels['region'][region] = name
            if province != '000':
                seen['province'].add(province)
                seen['regionProvince'].add(region + ':' + province)
            if province != '000' and municipality != '000':
                seen['territory'].add(province + municipality)
                seen['regionTerritory'].add(region + ':' + province + municipality)
        for field, values in seen.items():
            for value in values: indexes[field][value].append(row_count)
    if row_count != spec['coverage']['projectRows'] or locations_count != spec['coverage']['locationRows']:
        raise SourceError('Copertura indice divergente')
    artifacts = {}
    files = {}
    for field, values in indexes.items():
        raw = corpus.canonical_json(dict(values))
        payload = corpus.canonical_gzip(raw)
        artifacts[INDEX_DIR / f'{field}.json.gz'] = payload
        files[field] = {'bytes': len(payload), 'rawBytes': len(raw), 'sha256': corpus.sha256_bytes(payload)}
    receipt = (ROOT / f'data/source-ledger/datasets/{DATASET}.receipt.json').read_bytes()
    receipt_data = json.loads(receipt)
    if receipt_data['datasetId'] != DATASET or rows_digest.hexdigest() != receipt_data['rowsSha256'] or receipt_data['publication']['publicRows'] != row_count:
        raise SourceError('Righe pubbliche divergenti dalla ricevuta')
    meta = {'schemaVersion': 1, 'datasetId': DATASET, 'referenceDate': spec['referenceDate'],
            'acquisitionDate': spec['acquisitionDate'], 'sourceSpecSha256': corpus.sha256_bytes(SPEC.read_bytes()),
            'receiptSha256': corpus.sha256_bytes(receipt), 'coverage': spec['coverage'], 'files': files,
            'options': {field: [{'code': key, 'label': labels[field][key], 'rows': len(indexes[field][key])}
                                for key in sorted(labels[field])] for field in labels}}
    artifacts[INDEX_DIR / 'meta.json'] = corpus.canonical_json(meta)
    return artifacts


def main() -> int:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--input-dir', type=Path)
    parser.add_argument('--output-dir', type=Path)
    parser.add_argument('--build-index', action='store_true')
    parser.add_argument('--promote', action='store_true', help='Append verified projection, indexes and release proof in an isolated checkout')
    parser.add_argument('--check', action='store_true')
    args = parser.parse_args()
    if args.promote and (not args.input_dir or not args.output_dir or args.check or args.build_index):
        parser.error('--promote richiede input-dir e output-dir, senza check/build-index')
    spec = json.loads(SPEC.read_bytes())
    if spec['license'] != 'CC-BY-4.0' or spec['locationFields'] != LOCATION_FIELDS:
        raise SourceError('Licenza o contratto localizzazione divergente')
    if args.input_dir:
        payload = project(args.input_dir, spec)
        if args.output_dir:
            corpus.write_bytes(args.output_dir / f'{DATASET}.psv', payload)
        if args.check:
            _, items = corpus.load_spec(corpus.DEFAULT_SPEC)
            item = next(item for item in items if item['id'] == DATASET)
            if len(payload) != item['expected']['bytes'] or corpus.sha256_bytes(payload) != item['expected']['sha256']:
                raise SourceError('Proiezione divergente dal corpus')
    if args.promote:
        from siope_nonmunicipal_corpus import append
        append(spec_path=corpus.DEFAULT_SPEC, source_root=args.output_dir, dataset_ids={DATASET},
               catalog_path=ROOT / 'src/data/generated/integrated/catalog.json',
               rows_dir=ROOT / 'src/data/generated/integrated/rows',
               receipts_dir=ROOT / 'data/source-ledger/datasets',
               proof_path=ROOT / 'data/source-ledger/dataset-proof.json')
    if args.build_index or args.check or args.promote:
        for path, payload in index_artifacts(spec).items():
            if args.check:
                if path.read_bytes() != payload: raise SourceError(f'Indice divergente: {path.name}')
            else: corpus.write_bytes(path, payload)
    if args.promote:
        from integrated_source_release import build_release, ReleasePaths
        build_release(ReleasePaths())
        from siope_nonmunicipal import build_committed_view_proof
        build_committed_view_proof()
    if not (args.input_dir or args.build_index or args.check): parser.error('specificare input-dir, build-index o check')
    return 0

if __name__ == '__main__':
    raise SystemExit(main())
