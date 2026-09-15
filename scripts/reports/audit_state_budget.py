#!/usr/bin/env python3
"""Reproducible audit of the explicitly acquired aggregates, never of unseen rows.

No network. All identities use integer cents. --require-upstream also binds the
15 transcribed aggregates to the full repository's frozen RGS snapshot and hash.
This is not a detector of fraud and does not turn balances into cash losses.
"""
from __future__ import annotations
import argparse
import csv
import hashlib
import io
import json
from decimal import Decimal
from pathlib import Path

ROOT = Path(__file__).resolve().parents[2]
CONTENT = Path('src/content/reports/state-budget-reader.json')
INPUTS = Path('docs/research/state-budget-2025/audit-inputs.json')
OUTPUT = Path('public/data/reports/state-budget-audit.json')
MINISTRIES_CSV = Path('public/data/reports/state-budget-ministries-2025.csv')
HISTORY_CSV = Path('public/data/reports/state-budget-residuals-2015-2024.csv')
SNAPSHOT = Path('src/data/generated/rgs-ministries-2025.data.json')
FIELDS = ('commitmentsCpCents', 'paymentsCompetenceCpCents', 'remainingCpCents',
          'paymentsResidualRsCents', 'paymentsCashCsCents', 'remainingRsCents', 'residualsEndCents')
IDENTITIES = ((FIELDS[0], FIELDS[1], FIELDS[2]), (FIELDS[4], FIELDS[1], FIELDS[3]), (FIELDS[6], FIELDS[2], FIELDS[5]))


def integer(value: object) -> int:
    if not isinstance(value, str) or not value.isascii() or not value.isdigit():
        raise ValueError('Expected non-negative integer cents encoded as a string')
    return int(value)


def verify_upstream(audit: dict, root: Path, required: bool = False) -> dict:
    path = root / SNAPSHOT
    if not path.is_file():
        if required:
            raise ValueError('Full RGS snapshot unavailable; cannot verify upstream bytes')
        return {'verified': False, 'reason': 'Full RGS snapshot not present in this working copy'}
    raw = path.read_bytes()
    digest = hashlib.sha256(raw).hexdigest()
    if digest != audit['upstream']['snapshotSha256Declared']:
        raise ValueError('RGS source snapshot hash changed: re-audit, do not silently update the hash')
    upstream = json.loads(raw)
    for row in audit['ministries']:
        matches = [x for x in upstream['ministries'] if x['code'] == row['code']]
        if len(matches) != 1:
            raise ValueError('Ministry missing or duplicated in upstream')
        for field in FIELDS:
            if str(matches[0][field]) != row[field]:
                raise ValueError(f'Transcription mismatch: {row["code"]}/{field}')
    if any(str(upstream['totals'][key]) != audit['totals'][key] for key in FIELDS):
        raise ValueError('Transcribed RGS totals differ from upstream')
    return {'verified': True, 'snapshotSha256': digest, 'ministriesCompared': 15,
            'originalCsvVerified': False, 'originalRowsReprocessed': 0}


def analyse(report: dict) -> dict:
    a = report['audit']
    if a['year'] != 2025 or a['version'] != 1 or len(a['ministries']) != 15:
        raise ValueError('Unexpected audit perimeter')
    if len({r['code'] for r in a['ministries']}) != 15:
        raise ValueError('Duplicate ministry')
    if a['upstream']['rowsReprocessed'] != 0 or a['upstream']['aggregatesProcessed'] != 15:
        raise ValueError('Coverage must not claim inspection of unavailable chapter rows')
    if a['upstream']['declaredHashesVerified'] is not False:
        raise ValueError('An acquired-byte check must not be inferred from declared hashes')
    sources = {s['id'] for s in report['sources']}
    if a['sourceId'] not in sources:
        raise ValueError('Audit source missing')
    checks = []
    for row in a['ministries']:
        values = {f: integer(row[f]) for f in FIELDS}
        for total, left, right in IDENTITIES:
            delta = values[total] - values[left] - values[right]
            checks.append({'id': f'ministry-{row["code"]}-{total}', 'unit': 'EUR_cent', 'difference': str(delta), 'passed': delta == 0})
        for field in FIELDS[:3]:
            metric = report['metrics'][f'min-{row["code"]}-{field.lower()}']
            if Decimal(metric['value']) * 100 != values[field]:
                raise ValueError('Chart input disconnected from the acquired ministry values')
    for field in FIELDS:
        delta = sum(integer(row[field]) for row in a['ministries']) - integer(a['totals'][field])
        checks.append({'id': 'total-' + field, 'unit': 'EUR_cent', 'difference': str(delta), 'passed': delta == 0})
    if any(not x['passed'] for x in checks):
        raise ValueError('Accounting identity failed')
    if [x['year'] for x in a['history']] != list(range(2015, 2025)):
        raise ValueError('Historical perimeter changed')
    for row in a['history']:
        if any(type(row[k]) is not int or row[k] < 0 for k in ('totalMillion', 'currentMillion', 'capitalMillion', 'newMillion')):
            raise ValueError('Invalid historical input')
        delta = row['currentMillion'] + row['capitalMillion'] - row['totalMillion']
        if abs(delta) > 1:
            raise ValueError('Historical components exceed the source rounding tolerance')
        if Decimal(report['metrics'][f'residual-{row["year"]}']['value']) != row['totalMillion']:
            raise ValueError('Historical chart detached from inputs')
        checks.append({'id': f'history-{row["year"]}', 'unit': 'EUR_million', 'difference': str(delta), 'tolerance': '1', 'passed': True})
    for table, field, prefix in [('portfolios', 'billion', 'inps-port-'), ('foreignRows', 'million', 'aps-')]:
        for i, row in enumerate(a[table]):
            if Decimal(row[field]) != Decimal(report['metrics'][prefix + str(i)]['value']):
                raise ValueError('Context chart detached from source metrics')
    chapter_ids = [key for ch in report['chapters'] for key in ch['caseIds']]
    if chapter_ids != [c['id'] for c in report['cases']]:
        raise ValueError('Chapters lose, duplicate or reorder a case')
    ranking = sorted(a['ministries'], key=lambda r: Decimal(r['remainingCpCents']) / Decimal(r['commitmentsCpCents']), reverse=True)
    return {'schemaVersion': 1, 'cutoff': report['modifiedOn'], 'canonicalPath': str(CONTENT),
            'classification': 'Reconciliation and execution indicators, not a national waste estimate',
            'coverage': {'ministryAggregates': 15, 'acquiredAmountCells': 105,
                         'accountingIdentities': 45, 'columnReconciliations': 7,
                         'historicalObservations': 10, 'historicalComponentChecks': 10,
                         'chapterRowsReprocessed': 0, 'chapterRowsDeclaredByUpstream': 5395},
            'checks': checks, 'executionOrder': [r['code'] for r in ranking],
            'hypothesesRejectedOrNotUsed': a['exclusions']}


def csv_bytes(headers: list[str], rows: list[list]) -> bytes:
    out = io.StringIO(newline='')
    writer = csv.writer(out, lineterminator='\n')
    writer.writerow(headers)
    for row in rows:
        writer.writerow(["'" + v if isinstance(v, str) and v.startswith(('=', '+', '-', '@', '\t', '\r')) else v for v in row])
    return out.getvalue().encode('utf-8-sig')


def derivatives(report: dict) -> dict[Path, bytes]:
    a = report['audit']
    result = analyse(report)
    result['canonicalSha256'] = hashlib.sha256(json.dumps(report, ensure_ascii=False, sort_keys=True, separators=(',', ':')).encode()).hexdigest()
    return {
        INPUTS: (json.dumps(a, ensure_ascii=False, indent=2) + '\n').encode(),
        OUTPUT: (json.dumps(result, ensure_ascii=False, indent=2) + '\n').encode(),
        MINISTRIES_CSV: csv_bytes(['year', 'code', 'ministry', *FIELDS, 'unit', 'source'], [[2025, r['code'], r['label'], *[r[f] for f in FIELDS], 'EUR_cent', a['sourceId']] for r in a['ministries']]),
        HISTORY_CSV: csv_bytes(['year', 'totalMillion', 'currentMillion', 'capitalMillion', 'newMillion', 'unit', 'perimeter', 'source'], [[r[k] for k in ('year','totalMillion','currentMillion','capitalMillion','newMillion')] + ['EUR_million_nominal', 'Stock final expenditure residuals; excludes debt redemption', 'camera-residui'] for r in a['history']]),
    }


def main() -> None:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--check', action='store_true')
    parser.add_argument('--require-upstream', action='store_true')
    args = parser.parse_args()
    report = json.loads((ROOT / CONTENT).read_text())
    results = derivatives(report)
    upstream = verify_upstream(report['audit'], ROOT, args.require_upstream)
    for path, raw in results.items():
        target = ROOT / path
        if args.check:
            if not target.is_file() or target.read_bytes() != raw:
                raise ValueError('Stale audit artifact: ' + str(path))
        else:
            target.parent.mkdir(parents=True, exist_ok=True)
            target.write_bytes(raw)
    print(json.dumps({'ok': True, 'checks': 62, 'chapterRowsReprocessed': 0, 'upstream': upstream}))

if __name__ == '__main__':
    main()
