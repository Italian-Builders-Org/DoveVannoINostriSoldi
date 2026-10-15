#!/usr/bin/env python3
"""Proietta offline i rendiconti ARERA: capitoli di entrata e titoli di spesa."""
from __future__ import annotations

import argparse
import csv
import gzip
import io
import json
import re
import tempfile
from decimal import Decimal, InvalidOperation, ROUND_HALF_UP
from pathlib import Path
from zipfile import ZipFile

import integrated_curated_datasets as corpus
from integrated_corpus_append import append_integrated_datasets

ROOT = Path(__file__).resolve().parents[2]
SPEC = ROOT / 'scripts/etl/specs/arera-bilanci.source.json'
CORPUS_SPEC = ROOT / 'scripts/etl/specs/integrated-curated-datasets.source.json'
CATALOG = ROOT / 'src/data/generated/integrated/catalog.json'
ROWS_DIR = ROOT / 'src/data/generated/integrated/rows'
RECEIPTS_DIR = ROOT / 'data/source-ledger/datasets'
INCOME_ID = 'arera-entrate-2024-2025'
SPENDING_ID = 'arera-spese-2024-2025'
LICENSE_URL = 'https://creativecommons.org/licenses/by-sa/4.0/'
NS = '{http://schemas.openxmlformats.org/spreadsheetml/2006/main}'
HEADERS = {
    INCOME_ID: ['Anno', 'Codice', 'Capitolo ARERA', 'Voce', 'Previsioni definitive (euro)', 'Riscosso in competenza (euro)', 'Da riscuotere in competenza (euro)', 'Accertamenti (euro)', 'Riscosso su residui (euro)', 'Incassi totali (euro)', 'Residui attivi finali (euro)', 'URL fonte'],
    SPENDING_ID: ['Anno', 'Codice', 'Voce', 'Previsioni definitive (euro)', 'Pagato in competenza (euro)', 'Da pagare in competenza (euro)', 'Impegni (euro)', 'Pagato su residui (euro)', 'Pagamenti totali (euro)', 'Residui passivi finali (euro)', 'URL fonte'],
}


class SourceError(ValueError):
    """La fonte non rispetta il contratto contabile o di riuso verificato."""


def verified_source(year: dict) -> bytes:
    payload = (ROOT / year['path']).read_bytes()
    if len(payload) != year['bytes'] or corpus.sha256_bytes(payload) != year['sha256']:
        raise SourceError('byte o hash del rendiconto divergenti')
    return payload


def workbook(payload: bytes) -> dict[str, dict[str, str | None]]:
    with ZipFile(io.BytesIO(payload)) as archive:
        strings = [''.join(node.text or '' for node in item.iter(NS + 't')) for item in corpus.safe_xml(archive.read('xl/sharedStrings.xml'), 'arera', 'sharedStrings')]
        book = corpus.safe_xml(archive.read('xl/workbook.xml'), 'arera', 'workbook')
        relationships = corpus.safe_xml(archive.read('xl/_rels/workbook.xml.rels'), 'arera', 'relationships')
        targets = {item.get('Id'): item.get('Target') for item in relationships}
        result = {}
        for sheet in book.iter(NS + 'sheet'):
            name = sheet.get('name')
            if name not in {'bilancio_riclassificato_5_liv_', 'Bilancio_riclassificato_2_liv_', 'bilancio riclassificato 5 liv.', 'Bilancio riclassificato 2 liv.'}:
                continue
            if name in result:
                raise SourceError('foglio duplicato')
            target = targets[sheet.get('{http://schemas.openxmlformats.org/officeDocument/2006/relationships}id')]
            if not target or '..' in target or not re.fullmatch(r'/?(?:xl/)?worksheets/sheet\d+\.xml', target):
                raise SourceError('percorso foglio inatteso')
            member = target.lstrip('/') if target.startswith('/') else 'xl/' + target
            tree = corpus.safe_xml(archive.read(member), 'arera', member)
            cells = {}
            for cell in tree.iter(NS + 'c'):
                reference = cell.get('r')
                if reference in cells:
                    raise SourceError('cella duplicata')
                value = cell.find(NS + 'v')
                if cell.find(NS + 'f') is not None and (value is None or value.text is None):
                    raise SourceError('formula senza valore memorizzato')
                if value is None or value.text is None:
                    cells[reference] = None
                elif cell.get('t') == 's':
                    cells[reference] = strings[int(value.text)]
                elif cell.get('t') in {None, 'n', 'e'}:
                    cells[reference] = value.text
                else:
                    raise SourceError('tipo cella inatteso')
            result[name] = cells
        return result


def money(value: str | None) -> str | None:
    if value is None:
        return None
    try:
        number = Decimal(value)
        # Elimina soltanto la coda binaria Excel, senza cambiare il centesimo mostrato.
        rounded = number.quantize(Decimal('.01'), rounding=ROUND_HALF_UP)
    except (InvalidOperation, TypeError) as error:
        raise SourceError('importo non numerico') from error
    if not number.is_finite() or abs(number - rounded) > Decimal('.000001'):
        raise SourceError('precisione monetaria inattesa')
    return format(rounded, '.2f')


def project_year(year: dict, sheets: dict) -> dict[str, list[list[str | None]]]:
    result = {}
    for dataset_id, sheet_key, side, level, columns, count in [
        (INCOME_ID, 'incomeSheet', 'E', 'V', 'FGHILPQ', 27),
        (SPENDING_ID, 'spendingSheet', 'U', 'I', 'EFGHKOP', 3),
    ]:
        cells = sheets[year[sheet_key]]
        title = cells.get('A2') or ''
        if f"1 GENNAIO {year['year']} - 31 DICEMBRE {year['year']}" not in title:
            raise SourceError('periodo del rendiconto divergente')
        if cells.get('A1') != "AUTORITA' DI REGOLAZIONE PER ENERGIA RETI E AMBIENTE":
            raise SourceError('titolare del rendiconto divergente')
        if cells.get(columns[0] + '1') != 'PREVISIONI DEFINITIVE':
            raise SourceError('intestazione monetaria divergente')
        rows = []
        seen = set()
        totals = []
        indices = sorted({int(re.search(r'\d+$', key)[0]) for key in cells})
        for index in indices:
            def get(column: str) -> str | None:
                return cells.get(f'{column}{index}')
            if get('C') == ('TOTALE ENTRATE' if side == 'E' else 'TOTALE USCITE'):
                totals.append([money(get(col)) for col in columns])
            if get('A') != side or get('B') != level or (side == 'E' and not get('E')):
                continue
            identity = (get('D'), get('E') if side == 'E' else None)
            if identity in seen:
                raise SourceError('capitolo o titolo duplicato')
            seen.add(identity)
            if not re.fullmatch(side + r'\.\d\.\d{2}\.\d{2}\.\d{2}\.\d{3}', get('D') or '') or not get('C'):
                raise SourceError('codice o descrizione mancanti')
            values = [money(get(col)) for col in columns]
            # Le celle vuote restano mancanti. Le identità si verificano solo se osservate.
            for left, right, total in [(1, 2, 3), (1, 4, 5)]:
                if all(values[i] is not None for i in [left, right, total]):
                    if Decimal(values[left]) + Decimal(values[right]) != Decimal(values[total]):
                        raise SourceError('riconciliazione competenza o cassa divergente')
            prefix = [str(year['year']), get('D')]
            if side == 'E':
                prefix.append(get('E'))
            rows.append([*prefix, get('C').strip(), *values, year['url']])
        if len(rows) != count or len(totals) != 1:
            raise SourceError('numero di capitoli o totale divergente')
        # Non sommare l'avanzo di amministrazione alle entrate: esclusa la previsione.
        start = 4 if side == 'E' else 3
        for offset in range(1, 7):
            observed = [Decimal(row[start + offset]) for row in rows if row[start + offset] is not None]
            if totals[0][offset] is None or sum(observed, Decimal(0)) != Decimal(totals[0][offset]):
                raise SourceError('riconciliazione al totale del rendiconto divergente')
        result[dataset_id] = rows
    return result


def projections(spec: dict) -> dict[str, bytes]:
    if spec.get('license', {}).get('url') != LICENSE_URL or spec['license'].get('status') != 'verified-open-cc-by-sa-4.0':
        raise SourceError('licenza ARERA divergente')
    if [year['year'] for year in spec['years']] != [2024, 2025]:
        raise SourceError('periodo della serie divergente')
    terms = gzip.decompress((ROOT / spec['license']['path']).read_bytes())
    if corpus.sha256_bytes(terms) != spec['license']['sha256'] or b'CondividiAlloStessoModo' not in terms:
        raise SourceError('prova della licenza divergente')
    rows = {dataset_id: [] for dataset_id in HEADERS}
    for year in spec['years']:
        for dataset_id, values in project_year(year, workbook(verified_source(year))).items():
            rows[dataset_id].extend(values)
    result = {}
    for dataset_id, values in rows.items():
        output = io.StringIO(newline='')
        writer = csv.writer(output, delimiter='|', lineterminator='\n')
        writer.writerow(HEADERS[dataset_id])
        writer.writerows(values)
        result[dataset_id] = output.getvalue().encode()
    return result


def check_committed(payloads: dict[str, bytes]) -> None:
    spec, datasets = corpus.load_spec(CORPUS_SPEC)
    catalog = json.loads(CATALOG.read_bytes())
    with tempfile.TemporaryDirectory() as directory:
        source_root = Path(directory)
        for dataset_id, payload in payloads.items():
            item = next(item for item in datasets if item['id'] == dataset_id)
            (source_root / item['relativePath']).write_bytes(payload)
            parsed = corpus.parse_dataset(source_root, item)
            entry, expected_rows, receipt, _ = corpus.build_dataset(item, parsed, corpus.resolved_source_metadata(spec, dataset_id))
            actual_rows = b''.join(gzip.decompress(path.read_bytes()) for path in sorted(ROWS_DIR.glob(f'{dataset_id}.part-*.jsonl.gz')))
            if expected_rows != actual_rows or receipt != json.loads((RECEIPTS_DIR / f'{dataset_id}.receipt.json').read_bytes()) or entry != next(row for row in catalog['datasets'] if row['id'] == dataset_id):
                raise SourceError('righe, ricevuta o catalogo divergenti dalla fonte ARERA')


def publish(payloads: dict[str, bytes]) -> None:
    with tempfile.TemporaryDirectory() as directory:
        source_root = Path(directory)
        for dataset_id, payload in payloads.items():
            (source_root / f'{dataset_id}.psv').write_bytes(payload)
        append_integrated_datasets(
            spec_path=CORPUS_SPEC, source_root=source_root, dataset_ids=set(payloads),
            catalog_path=CATALOG, rows_dir=ROWS_DIR, receipts_dir=RECEIPTS_DIR,
            proof_path=ROOT / 'data/source-ledger/dataset-proof.json',
            release_proof_path=ROOT / 'data/source-ledger/release-proof.json',
        )


def main() -> int:
    parser = argparse.ArgumentParser(description=__doc__)
    action = parser.add_mutually_exclusive_group(required=True)
    action.add_argument('--publish', action='store_true')
    action.add_argument('--check', action='store_true')
    args = parser.parse_args()
    payloads = projections(json.loads(SPEC.read_text()))
    if args.publish:
        publish(payloads)
    else:
        check_committed(payloads)
    print('PASS: ARERA 2024-2025, byte ufficiali, capitoli, titoli e totali riconciliati')
    return 0


if __name__ == '__main__':
    raise SystemExit(main())
