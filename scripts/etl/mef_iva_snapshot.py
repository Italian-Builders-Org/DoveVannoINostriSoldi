#!/usr/bin/env python3
"""Hash-locked IVA declarations: four independent official tables, never a cross-tab."""
from __future__ import annotations

import argparse
import csv
from decimal import Decimal
import hashlib
import html
import io
import json
from pathlib import Path
import re

from monetary import MoneyPolicy, decimal_to_cents

ROOT = Path(__file__).resolve().parents[2]
DEFAULT_SPEC = ROOT / 'scripts/etl/specs/mef-iva-2024-2025.source.json'
DEFAULT_DATA = ROOT / 'src/data/generated/mef-iva-2024-2025.data.json'
DEFAULT_META = ROOT / 'src/data/generated/mef-iva-2024-2025.meta.json'
INTEGER = re.compile(r'-?(?:0|[1-9]\d{0,2}(?:\.\d{3})*)')
MEAN = re.compile(r'-?(?:0|[1-9]\d{0,2}(?:\.\d{3})*),\d{2}')
MAX_SAFE = 9_007_199_254_740_991
CAVEATS = [
    "Sono dichiarazioni IVA: chi non dichiara non è rappresentato. Non misurano evasione, gap fiscale o gettito effettivamente riscosso.",
    "Il valore aggiunto fiscale non è il valore aggiunto della contabilità nazionale; può essere negativo.",
    "Regione e sezione di attività sono tabelle distinte: non esiste un incrocio regione × attività e i tagli non si sommano.",
    "Anno di presentazione 2024/2025 e anno d'imposta 2023/2024 sono distinti. La data ultimo aggiornamento della fonte è la data di pubblicazione.",
    "Numero contribuenti è autonomo; frequenza, ammontare e media sono misure distinte. Ammontare e media originari sono in migliaia di euro, convertiti esattamente in centesimi senza aumentare la precisione della fonte.",
    "Le celle *** sono soppresse e restano assenti; le celle vuote sono mancanti, non zeri. Non si ricostruiscono per differenza.",
    "Il codice territoriale 04 identifica due righe: P.A. Trento e P.A. Bolzano, con identificatori canonici distinti.",
    "I codici attività sono legati al dizionario dell'edizione: lo stesso numero può cambiare significato tra 2024 e 2025 e non costituisce una serie omogenea.",
    "I totali sono quelli pubblicati dalla fonte. Le somme degli ammontari arrotondati possono differire dai totali; le medie non sono additive.",
]


class SnapshotError(ValueError):
    """Schema, provenance or reconciliation drift blocks publication."""


def sha(payload: bytes) -> str:
    return hashlib.sha256(payload).hexdigest()


def canonical(value: object) -> bytes:
    return json.dumps(value, ensure_ascii=False, sort_keys=True, separators=(',', ':')).encode()


def lock_sha(spec: dict) -> str:
    copy = json.loads(json.dumps(spec))
    copy['integrity']['lockSha256'] = ''
    return sha(canonical(copy))


def load_spec(path: Path = DEFAULT_SPEC) -> dict:
    spec = json.loads(path.read_text())
    if spec['schemaVersion'] != 1 or spec['datasetId'] != 'mef-iva' or spec['integrity']['lockSha256'] != lock_sha(spec):
        raise SnapshotError('Invalid source lock')
    if spec['source']['licenseId'] != 'CC-BY-3.0-IT' or spec['source']['licenseUrl'] != 'http://creativecommons.org/licenses/by/3.0/it/':
        raise SnapshotError('Invalid license')
    if [(t['declarationYear'], t['breakdown']) for t in spec['tables']] != [(2024, 'regione'), (2024, 'attivita'), (2025, 'regione'), (2025, 'attivita')]:
        raise SnapshotError('Unexpected table perimeter')
    for t in spec['tables']:
        if t['taxYear'] != t['declarationYear'] - 1 or t['classificationEdition'] != f"mef-iva-{t['declarationYear']}":
            raise SnapshotError('Invalid fiscal period or edition')
        for receipt in t['receipts'].values():
            if not receipt['url'].startswith('https://www1.finanze.gov.it/finanze/analisi_stat/public/index.php?') or not re.fullmatch('[a-f0-9]{64}', receipt['sha256']) or type(receipt['bytes']) is not int or receipt['bytes'] <= 0:
                raise SnapshotError('Invalid official receipt')
    return spec


def parse_cell(raw: str, nature: str, allow_negative: bool = False) -> dict:
    value = raw.strip()
    if value in ('', '***'):
        return {'value': None, 'status': 'missing' if value == '' else 'suppressed'}
    if not (MEAN if nature == 'mean' else INTEGER).fullmatch(value):
        raise SnapshotError(f'Unexpected {nature} numeric format: {raw!r}')
    decimal = Decimal(value.replace('.', '').replace(',', '.'))
    if decimal < 0 and not allow_negative:
        raise SnapshotError('Unexpected negative value')
    if nature == 'count':
        result = int(decimal)
    else:
        # Decimal multiplication by an integer power of ten is exact here; no float.
        sign, digits, exponent = decimal.as_tuple()
        euros = Decimal((sign, digits, exponent + 3))
        policy = MoneyPolicy(re.compile('.*'), '.', 'euros', allow_negative, 'reject', True)
        result = decimal_to_cents(euros, policy)
    if abs(result) > MAX_SAFE:
        raise SnapshotError('Unsafe integer')
    return {'value': result, 'status': 'observed'}


def parse_table(payload: bytes, table: dict) -> dict:
    if not payload.startswith(b'\xef\xbb\xbf'):
        raise SnapshotError('Missing official UTF-8 BOM')
    rows = list(csv.reader(io.StringIO(payload.decode('utf-8-sig')), delimiter=';'))
    if rows[:9] != table['preamble'] or rows[9] != table['header'] or rows[-2:] != [[], ['Ammontare e media in migliaia di euro']]:
        raise SnapshotError('CSV metadata, header or units drift')
    raw_rows = rows[10:-2]
    if len(raw_rows) != len(table['dictionary']):
        raise SnapshotError('Unexpected row coverage')
    output = []
    for raw, entry in zip(raw_rows, table['dictionary'], strict=True):
        # The official CSV leaves semicolons in labels unquoted. Rejoin ONLY the
        # known exact edition label; never guess cells or accept unknown widths.
        label_parts = entry['sourceLabel'].split(';')
        if len(raw) != len(label_parts) + 33 or raw[:len(label_parts)] != label_parts or raw[-33] != entry['sourceCode'] or raw[-1] != '':
            raise SnapshotError('Row label/code/schema drift')
        cells = raw[-32:-1]
        row = {k: entry[k] for k in ('id', 'sourceCode', 'label', 'kind')}
        row['taxpayers'] = parse_cell(cells[0], 'count')
        row['values'] = []
        for i, measure in enumerate(table['measures']):
            row['values'].append({'measureId': measure['id'], 'frequency': parse_cell(cells[1+i*3], 'count'), 'amountCents': parse_cell(cells[2+i*3], 'amount', measure['allowNegative']), 'meanCents': parse_cell(cells[3+i*3], 'mean', measure['allowNegative'])})
        output.append(row)
    result = {k: table[k] for k in ('id', 'declarationYear', 'taxYear', 'breakdown', 'publicationDate', 'classificationEdition', 'sourceUrl', 'measures')}
    result['rows'] = output
    return result


def validate_data(data: dict, spec: dict) -> None:
    if set(data) != {'schemaVersion', 'datasetId', 'tables', 'caveats'} or data['schemaVersion'] != 1 or data['datasetId'] != 'mef-iva' or data['caveats'] != CAVEATS or len(data['tables']) != 4:
        raise SnapshotError('Data envelope drift')
    totals = {}
    for table, locked in zip(data['tables'], spec['tables'], strict=True):
        for key in ('id', 'declarationYear', 'taxYear', 'breakdown', 'publicationDate', 'classificationEdition', 'sourceUrl', 'measures'):
            if table.get(key) != locked[key]:
                raise SnapshotError(f'Table {key} drift')
        if len(table['rows']) != len(locked['dictionary']):
            raise SnapshotError('Row count drift')
        for row, entry in zip(table['rows'], locked['dictionary'], strict=True):
            if set(row) != {'id', 'sourceCode', 'label', 'kind', 'taxpayers', 'values'} or any(row[k] != entry[k] for k in ('id', 'sourceCode', 'label', 'kind')) or len(row['values']) != len(table['measures']):
                raise SnapshotError('Dictionary or row schema drift')
            pairs = [(row['taxpayers'], False, 1)]
            for value, measure in zip(row['values'], table['measures'], strict=True):
                if set(value) != {'measureId', 'frequency', 'amountCents', 'meanCents'} or value['measureId'] != measure['id']:
                    raise SnapshotError('Measure drift')
                pairs += [(value['frequency'], False, 1), (value['amountCents'], measure['allowNegative'], 100_000), (value['meanCents'], measure['allowNegative'], 1000)]
                if value['frequency']['status'] == 'observed' and row['taxpayers']['status'] == 'observed' and value['frequency']['value'] > row['taxpayers']['value']:
                    raise SnapshotError('Frequency exceeds taxpayers')
            for cell, negative, quantum in pairs:
                if set(cell) != {'value', 'status'} or cell['status'] not in ('observed', 'missing', 'suppressed'):
                    raise SnapshotError('Cell schema drift')
                v = cell['value']
                if cell['status'] != 'observed':
                    if v is not None:
                        raise SnapshotError('Missing or suppressed cell reconstructed')
                elif type(v) is not int or abs(v) > MAX_SAFE or (v < 0 and not negative) or v % quantum:
                    raise SnapshotError('Invalid cell value or source precision')
        total = table['rows'][-1]
        if total['kind'] != 'total' or sum(r['kind'] == 'total' for r in table['rows']) != 1:
            raise SnapshotError('Official total missing')
        # Count totals reconcile exactly when every cell is available. Amounts
        # are independently rounded to 1,000 EUR: at most (n+1)/2 source units.
        for metric in [-1] + list(range(len(table['measures']))):
            for field in (['taxpayers'] if metric == -1 else ['frequency', 'amountCents']):
                cells = [r['taxpayers'] if metric == -1 else r['values'][metric][field] for r in table['rows']]
                if all(c['status'] == 'observed' for c in cells):
                    tolerance = len(cells)*50_000 if field == 'amountCents' else 0
                    if abs(sum(c['value'] for c in cells[:-1])-cells[-1]['value']) > tolerance:
                        raise SnapshotError('Official total reconciliation failed')
        comparable = {'taxpayers': total['taxpayers'], 'values': total['values']}
        year = table['declarationYear']
        if year in totals and totals[year] != comparable:
            raise SnapshotError('Different official totals across breakdowns')
        totals[year] = comparable


def build(input_dir: Path, spec: dict) -> dict:
    tables = []
    for table in spec['tables']:
        payloads = {}
        for kind, receipt in table['receipts'].items():
            payload = (input_dir / receipt['filename']).read_bytes()
            if len(payload) != receipt['bytes'] or sha(payload) != receipt['sha256']:
                raise SnapshotError('Official source bytes/hash drift')
            payloads[kind] = payload
        page = payloads['html'].decode('utf-8')
        labels = [html.unescape(re.sub('<[^>]*>', '', x)).strip() for x in re.findall(r'<td\s+[^>]*headers="top_header0"[^>]*>(.*?)</td>', page, re.S)]
        if labels != [d['label'] for d in table['dictionary']] or f'href="{spec["source"]["licenseUrl"]}"' not in page or f"Anno d'imposta {table['taxYear']}" not in page or 'Ammontare e media in migliaia di euro' not in page:
            raise SnapshotError('Official HTML dictionary/license/period/units drift')
        tables.append(parse_table(payloads['csv'], table))
    data = {'schemaVersion': 1, 'datasetId': 'mef-iva', 'tables': tables, 'caveats': CAVEATS}
    validate_data(data, spec)
    return data


def metadata(spec: dict, payload: bytes, data: dict) -> dict:
    return {'schemaVersion': 1, 'datasetId': 'mef-iva', 'period': spec['period'], 'taxPeriod': spec['taxPeriod'], 'observedAt': spec['source']['acquiredAt'], 'source': {**spec['source'], 'files': {t['id']: t['receipts'] for t in spec['tables']}}, 'coverage': {'tables': len(data['tables']), 'rows': sum(len(t['rows']) for t in data['tables'])}, 'integrity': {'sourceLockSha256': spec['integrity']['lockSha256'], 'dataSha256': sha(payload), 'dataBytes': len(payload)}, 'semantics': {'soldi': {'unit': 'euro-cents', 'sourceUnit': 'thousand-euros', 'nature': 'dichiarazioni IVA, non gettito riscosso; frequenza e contribuenti sono conteggi'}, 'periodo': {'referencePeriod': '2023-2024', 'declarationPeriod': '2024-2025'}, 'provenance': {'holder': spec['source']['owner'], 'publicationDates': {t['id']: t['publicationDate'] for t in spec['tables']}, 'acquiredAt': spec['source']['acquiredAt'], 'checkedAt': spec['source']['checkedAt']}}}


def check(spec_path: Path = DEFAULT_SPEC, data_path: Path = DEFAULT_DATA, meta_path: Path = DEFAULT_META) -> None:
    spec = load_spec(spec_path)
    payload = data_path.read_bytes()
    data = json.loads(payload)
    validate_data(data, spec)
    if json.loads(meta_path.read_text()) != metadata(spec, payload, data):
        raise SnapshotError('Metadata or artifact hash drift')
    if spec.get('dataCanonicalSha256') != sha(canonical(data)):
        raise SnapshotError('Data differs from pinned source projection')


def main() -> None:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--input-dir', type=Path)
    mode = parser.add_mutually_exclusive_group(required=True)
    mode.add_argument('--check', action='store_true')
    mode.add_argument('--write', action='store_true')
    args = parser.parse_args()
    if args.check:
        check()
        print('MEF IVA snapshot: OK (offline)')
        return
    if args.input_dir is None:
        parser.error('--input-dir is required for generation')
    spec = load_spec()
    data = build(args.input_dir, spec)
    if spec.get('dataCanonicalSha256') != sha(canonical(data)):
        raise SnapshotError('Data differs from pinned source projection')
    payload = (json.dumps(data, ensure_ascii=False, indent=2) + '\n').encode()
    DEFAULT_DATA.write_bytes(payload)
    DEFAULT_META.write_text(json.dumps(metadata(spec, payload, data), ensure_ascii=False, indent=2) + '\n')
    check()


if __name__ == '__main__':
    main()
