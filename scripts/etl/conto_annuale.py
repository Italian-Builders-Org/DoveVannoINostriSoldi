#!/usr/bin/env python3
"""Reproduce the licensed DFP/RGS Conto Annuale 2020 distributions offline."""
from __future__ import annotations

import argparse
from collections import Counter
import csv
import gzip
import hashlib
import io
import json
from pathlib import Path
import re

import integrated_curated_datasets as corpus

ROOT = Path(__file__).resolve().parents[2]
SPEC = ROOT / 'scripts/etl/specs/conto-annuale.source.json'


class SourceError(ValueError):
    """The source no longer matches the reviewed scope."""


def verified(payload: bytes, lock: dict) -> bytes:
    if len(payload) != lock['bytes'] or corpus.sha256_bytes(payload) != lock['sha256']:
        raise SourceError('byte sorgente divergenti dal lock')
    return payload


def fixture(lock: dict) -> bytes:
    return gzip.decompress(verified((ROOT / lock['path']).read_bytes(), lock))


def read_source(source: dict, year: str) -> bytes:
    response = json.loads(fixture(source['metadataFixture']))
    if response.get('success') is not True:
        raise SourceError('catalogo fonte incompleto')
    packages = [p for p in response['result']['results'] if p['name'] == source['packageName']]
    if len(packages) != 1:
        raise SourceError('dataset fonte mancante')
    metadata = packages[0]
    if metadata.get('license_id') != 'CC-BY-4.0' or metadata.get('license_url') != 'https://creativecommons.org/licenses/by/4.0/':
        raise SourceError('licenza della distribuzione divergente')
    resources = [r for r in metadata['resources'] if r['id'] == source['resourceId']]
    if len(resources) != 1:
        raise SourceError('risorsa annuale mancante')
    resource = resources[0]
    if (resource['name'] != source['resourceName'] or not resource['name'].endswith(f'_{year}.csv')
            or resource['url'] != source['url'] or resource['size'] != source['bytes']
            or resource['created'][:10] != source['publicationDate']):
        raise SourceError('periodo o metadati della risorsa divergenti')
    dictionary = json.loads(fixture(source['dictionaryFixture']).decode('utf-8-sig'))
    if [column['column_name'] for column in dictionary] != source['headers']:
        raise SourceError('dizionario colonne divergente')
    return verified(fixture(source['fixture']), source)


def projection(payload: bytes, source: dict, year: str) -> tuple[bytes, set[tuple[str, str]]]:
    text = payload.decode('utf-8-sig')
    reader = csv.DictReader(io.StringIO(text, newline=''), strict=True)
    if reader.fieldnames != source['headers']:
        raise SourceError('schema CSV divergente')
    output = io.StringIO(newline='')
    writer = csv.writer(output, delimiter='|', lineterminator='\n')
    writer.writerow(['Anno', 'Codice amministrazione RGS', *source['fields'].values(), 'URL fonte'])
    dimensions = Counter()
    identities = set()
    institutions: dict[tuple[str, str], str] = {}
    count = 0
    for row in reader:
        if set(row) != set(source['headers']) or any(not isinstance(v, str) or not v.strip() for v in row.values()):
            raise SourceError('cella mancante o riga malformata')
        identity = tuple(row.values())
        if identity in identities:
            raise SourceError('riga duplicata esatta')
        identities.add(identity)
        entity = (row['codi_tipo_istituzione'], row['codi_istituzione'])
        if not re.fullmatch(r'[A-Z]+', entity[0]) or not re.fullmatch(r'[0-9]+', entity[1]):
            raise SourceError('codice amministrazione invalido')
        if entity in institutions and institutions[entity] != row['desc_istituzione']:
            raise SourceError('denominazione amministrazione incoerente')
        institutions[entity] = row['desc_istituzione']
        key = (*entity, row['contratto'])
        if source['kind'] == 'costo':
            value = row['totale_spesa']
            if not re.fullmatch(r'-?[0-9]+', value) or row['flag_segno'] != ('-' if int(value) < 0 else '+'):
                raise SourceError('importo o segno divergente')
            key += (row['voce_spesa'],)
        else:
            for field in source['headers'][-6:]:
                if not re.fullmatch(r'[0-9]+', row[field]):
                    raise SourceError('numero di persone invalido')
            key += (row['categoria'], row['qualifica'])
        dimensions[key] += 1
        # Preserve original row order and signed values. No many-to-many join or sum.
        writer.writerow([year, ':'.join(entity), *[row[field] for field in source['fields']], source['url']])
        count += 1
    if (count != source['rows'] or len(institutions) != source['institutions']
            or sum(n - 1 for n in dimensions.values()) != source['repeatedDimensionKeys']
            or text.count('\ufffd') != source['replacementCharacters']):
        raise SourceError('copertura o anomalie note divergenti')
    return output.getvalue().encode('utf-8'), set(institutions)


def projections(spec: dict) -> dict[str, bytes]:
    result = {}
    entities = {}
    if (spec['year'] != '2020' or len(spec['sources']) != 2
            or {s['kind'] for s in spec['sources']} != {'costo', 'occupazione'}):
        raise SourceError('perimetro annuale divergente')
    for source in spec['sources']:
        payload, institutions = projection(read_source(source, spec['year']), source, spec['year'])
        result[source['datasetId']] = payload
        entities[source['kind']] = institutions
    cost, personnel = entities['costo'], entities['occupazione']
    if spec['coverage'] != {'commonInstitutions': len(cost & personnel),
                            'costOnlyInstitutions': len(cost - personnel),
                            'personnelOnlyInstitutions': len(personnel - cost)}:
        raise SourceError('raccordo amministrazioni divergente')
    return result


def check_committed(payloads: dict[str, bytes]) -> None:
    spec, datasets = corpus.load_spec(corpus.DEFAULT_SPEC)
    known_ids = {item['id'] for item in datasets}
    if set(payloads) != {'rgs-conto-annuale-costo-2020', 'rgs-conto-annuale-personale-2020'} or not set(payloads) <= known_ids:
        raise SourceError('dataset Conto Annuale mancanti o inattesi')
    catalog = json.loads((ROOT / 'src/data/generated/integrated/catalog.json').read_bytes())
    for item in datasets:
        if item['id'] not in payloads:
            continue
        payload = verified(payloads[item['id']], item['expected'])
        reader = csv.DictReader(io.StringIO(payload.decode()), delimiter='|')
        if reader.fieldnames != item['expected']['headers']:
            raise SourceError('intestazioni pubbliche divergenti')
        digest = hashlib.sha256()
        count = 0
        # Reconcile one published chunk at a time: never retain a second full corpus.
        chunks = sorted((ROOT / 'src/data/generated/integrated/rows').glob(f"{item['id']}.part-*.jsonl.gz"))
        for chunk in chunks:
            for line in gzip.decompress(chunk.read_bytes()).splitlines(keepends=True):
                cells = next(reader, None)
                count += 1
                if cells is None:
                    raise SourceError('righe pubbliche eccedenti la fonte')
                row = json.loads(line)
                cell_hash = corpus.sha256_bytes(corpus.canonical_json(cells))
                row_id = 'row-' + corpus.sha256_bytes(f"{item['id']}:{count}:{cell_hash}".encode())[:24]
                if (set(row) != {'id', 'sourceRow', 'sourceRowSha256', 'evidenceLabel', 'cells', 'sourceUrls', 'redactions'}
                        or row.get('cells') != cells or row.get('sourceRow') != count
                        or row.get('sourceRowSha256') != cell_hash or row.get('id') != row_id
                        or row.get('sourceUrls') != [cells['URL fonte']]
                        or row.get('redactions') != [] or row.get('evidenceLabel') != item['evidenceLabel']
                        or corpus.canonical_json(row) != line):
                    raise SourceError('riga pubblica divergente dal CSV Conto Annuale')
                digest.update(line)
        if next(reader, None) is not None or count != item['expected']['rows']:
            raise SourceError('righe pubbliche mancanti')
        expected_receipt = {
            'schemaVersion': 1, 'datasetId': item['id'],
            'source': {key: item['expected'][key] for key in ['bytes', 'sha256', 'rows', 'columns', 'headers']},
            'publication': {'status': 'rows', 'publicRows': count, 'catalogOnlyRows': 0,
                            'derivedOnlyRows': 0, 'redactions': 0, 'rowsWithPublicSource': count},
            'rowEquationClosed': True, 'rowsSha256': digest.hexdigest(),
        }
        receipt = json.loads((ROOT / f"data/source-ledger/datasets/{item['id']}.receipt.json").read_bytes())
        entry = next(d for d in catalog['datasets'] if d['id'] == item['id'])
        if (receipt != expected_receipt or entry['receiptSha256'] != corpus.sha256_bytes(corpus.canonical_json(receipt))
                or entry['sourceMetadata'] != corpus.resolved_source_metadata(spec, item['id'])
                or entry['headers'] != reader.fieldnames or entry['rows'] != count or entry['publicRows'] != count
                or entry['rowsWithPublicSource'] != count or entry['privateFields'] != []
                or any(entry[key] != item[key] for key in ['title', 'domain', 'authority', 'licenseStatus',
                                                         'publication', 'evidenceLabel', 'caveats'])):
            raise SourceError('ricevuta o catalogo divergenti dal Conto Annuale')


def main() -> int:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--output-dir', type=Path)
    parser.add_argument('--check', action='store_true')
    args = parser.parse_args()
    if not args.output_dir and not args.check:
        parser.error('specificare --output-dir o --check')
    payloads = projections(json.loads(SPEC.read_text()))
    if args.output_dir:
        args.output_dir.mkdir(parents=True, exist_ok=True)
        for dataset_id, payload in payloads.items():
            (args.output_dir / f'{dataset_id}.psv').write_bytes(payload)
    if args.check:
        check_committed(payloads)
    print('PASS: Conto Annuale 2020, licenza, copertura e proiezioni verificate')
    return 0


if __name__ == '__main__':
    raise SystemExit(main())
