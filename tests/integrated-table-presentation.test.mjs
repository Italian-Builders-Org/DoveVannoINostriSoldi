import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';
import { splitTableColumns, tableColumnLabel } from '../src/lib/integrated-table-presentation.ts';

const catalog = JSON.parse(readFileSync(new URL('../src/data/generated/integrated/catalog.json', import.meta.url)));

test('every catalog field remains available exactly once across visible columns and row details', () => {
  for (const dataset of catalog.datasets) {
    const { primary, technical } = splitTableColumns(dataset.headers, dataset.id);
    assert.deepEqual([...primary, ...technical].sort(), [...dataset.headers].sort(), dataset.id);
    assert.ok(primary.every((field) => !technical.includes(field)), dataset.id);
  }
});

test('presentation keeps project identifiers, accounting layers, amounts and unknown fields visible', () => {
  const fields = ['id', 'codiceIpa', 'cf_ente', 'CUP', 'cig', 'strato', 'amountCents', 'new_source_field'];
  assert.deepEqual(splitTableColumns(fields), {
    primary: ['strato', 'CUP', 'cig', 'amountCents', 'new_source_field'],
    technical: ['id', 'codiceIpa', 'cf_ente'],
  });
  assert.equal(tableColumnLabel('amountCents'), 'Importo (centesimi di euro)');
  assert.equal(tableColumnLabel('canone_annuo_eur'), 'Canone annuo (€)');
});

test('Conto Annuale keeps measures and classifications visible with institution identifiers in row details', () => {
  for (const kind of ['costo', 'personale']) {
    const dataset = catalog.datasets.find((item) => item.id === `rgs-conto-annuale-${kind}-2020`);
    assert.ok(dataset);
    const { primary, technical } = splitTableColumns(dataset.headers, dataset.id);
    assert.ok(technical.includes('Codice amministrazione RGS'));
    assert.ok(technical.includes('Codice istituzione'));
    assert.equal(primary[0], 'Amministrazione');
    for (const key of ['Anno', 'Contratto', 'Tipo istituzione', 'Descrizione tipo',
      ...(kind === 'costo' ? ['Voce spesa', 'Descrizione voce', 'Segno fonte', 'Importo euro']
        : ['Qualifica', 'Descrizione qualifica', 'Tempo pieno uomini', 'Tempo pieno donne'])]) {
      assert.ok(primary.includes(key), `${dataset.id}: ${key}`);
    }
  }
});
