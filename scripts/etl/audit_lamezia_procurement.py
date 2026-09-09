import collections
import datetime
import gzip
import hashlib
import json
import pathlib
import argparse
import tempfile
import sys

ROOT = pathlib.Path(__file__).resolve().parents[2]
parser = argparse.ArgumentParser(description='Audit offline dei CIG di Lamezia per issue #185; non modifica gli snapshot.')
parser.add_argument('--input-dir', type=pathlib.Path, required=True)
args = parser.parse_args()
CACHE = args.input_dir
sys.path.insert(0, str(ROOT / 'scripts/etl'))
import anac_entity_procurement_coverage as base

spec = json.loads((ROOT / 'scripts/etl/specs/anac-entity-procurement.source.json').read_text())
station = CACHE / 'stations.zip'
base.verify_locked_input(station, base.input_lock_from_spec(spec['inputs']['stations'], base.STATION_HEADERS))
temporary = tempfile.TemporaryDirectory()
connection = base.make_database(pathlib.Path(temporary.name) / 'audit.sqlite')
by_ausa, by_cf, registry_counts = base.load_registry(connection, station)
target_cf = '00301390795'
matched = []
months = []
for entry in spec['inputs']['cig']:
    path = CACHE / entry['fileName']
    base.verify_locked_input(path, base.input_lock_from_spec(entry, base.CIG_HEADERS))
    counts = collections.Counter()
    with base.csv_rows(path, base.CIG_HEADERS) as reader:
        for number, raw in enumerate(reader, start=2):
            if base.normalize_cf(raw['cf_amministrazione_appaltante']) != target_cf:
                continue
            row = base.checked_row(raw, path=path, row_number=number)
            counts['rawRows'] += 1
            if row['flag_prevalente'].strip() != '1':
                counts['nonPrimaryRows'] += 1
                continue
            date_status, published = base.parse_date_status(row['data_pubblicazione'], datetime.date.fromisoformat(spec['catalogObservedAt'][:10]))
            result = base.resolve_identity(row['codice_ausa'], row['cf_amministrazione_appaltante'], by_ausa, by_cf, publication_date=datetime.date.fromisoformat(published) if published else None, publication_date_status=date_status)
            counts['primaryRows'] += 1
            counts[result['reason']] += 1
            matched.append({'cig': base.normalize_cig(row['cig']), 'publishedAt': published, 'ausa': base.normalize_ausa(row['codice_ausa']), **result})
    months.append({'month': entry['month'], 'archiveSha256': entry['archiveSha256'], **dict(counts)})
assert len({r['cig'] for r in matched}) == len(matched)
profile = next(json.loads(line) for line in gzip.open(ROOT / 'src/data/generated/anac-entity-procurement-page/entities/20.jsonl.gz', 'rt') if json.loads(line)['codiceIpa'] == 'c_m208')
resolved = {r['cig'] for r in matched if r['status'] == 'resolved'}
assert resolved == {r['cig'] for r in profile['procedures']}
out = {'sourceSpecSha256': hashlib.sha256((ROOT / 'scripts/etl/specs/anac-entity-procurement.source.json').read_bytes()).hexdigest(), 'codiceIpa': 'c_m208', 'codiceFiscaleEnte': target_cf, 'registry': {key: {k: str(v) for k, v in by_ausa[key].items()} for key in by_cf[target_cf]}, 'months': months, 'rawPrimaryCigs': len(matched), 'resolvedCigs': len(resolved), 'publishedSummary': profile['summary'], 'reasons': dict(collections.Counter(row['reason'] for row in matched)), 'procedures': matched}
print(json.dumps({k:v for k,v in out.items() if k != 'procedures'}, indent=2), flush=True)

connection.close()
temporary.cleanup()
