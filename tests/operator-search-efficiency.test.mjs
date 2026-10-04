import assert from 'node:assert/strict';
import test from 'node:test';
import {
  copyFileSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync,
} from 'node:fs';
import { dirname, join } from 'node:path';
import { tmpdir } from 'node:os';
import { gzipSync } from 'node:zlib';
import { createHash } from 'node:crypto';
import './helpers/register-ts-alias.mjs';

const cwd = process.cwd();
const artifact = 'src/data/generated/anac-operator-awards-index';
const modulePath = process.env.OPERATOR_SEARCH_MODULE ?? '../src/lib/data/anac-operator-awards-index.ts';

function row(i, name, awardCount = i % 11) {
  return {
    schemaVersion: 1,
    ref: `op-${String(i).padStart(8, '0')}`,
    name,
    searchKey: name.normalize('NFKC').toUpperCase().replace(/[^0-9A-Z]+/g, ''),
    awardCount,
    attributedAwardCount: awardCount,
    attributedValue: '9007199254740993.123',
    yearMin: 2007,
    yearMax: 2025,
  };
}

async function fixture(rows, run) {
  const root = mkdtempSync(join(tmpdir(), 'dvns-operator-search-'));
  const meta = JSON.parse(readFileSync(join(cwd, artifact, 'meta.json')));
  const compressed = gzipSync(rows.map(value => JSON.stringify(value)).join('\n'));
  meta.totals.operators = rows.length;
  meta.search.bytes = compressed.length;
  meta.search.sha256 = createHash('sha256').update(compressed).digest('hex');
  for (const path of [`${artifact}/meta.json`, 'scripts/etl/specs/anac-operator-awards-index.source.json']) {
    mkdirSync(dirname(join(root, path)), { recursive: true });
    copyFileSync(join(cwd, path), join(root, path));
  }
  writeFileSync(join(root, artifact, 'meta.json'), JSON.stringify(meta));
  writeFileSync(join(root, artifact, 'search.jsonl.gz'), compressed);
  try {
    process.chdir(root);
    const adapter = await import(`${modulePath}?search-ranking-fixture`);
    await run(adapter);
  } finally {
    process.chdir(cwd);
    rmSync(root, { recursive: true, force: true });
  }
}

function reference(rows, q, limit) {
  const query = (Array.isArray(q) ? q[0] ?? '' : q ?? '').trim().slice(0, 120);
  const normalizedQuery = query.normalize('NFKC').toUpperCase().replace(/[^0-9A-Z]+/g, '');
  limit = Math.min(50, Math.max(1, Number.isFinite(limit) ? limit : 25));
  const all = normalizedQuery.length < 3 ? [] : rows
    .filter(hit => hit.searchKey.includes(normalizedQuery))
    .sort((a, b) =>
      Number(!a.searchKey.startsWith(normalizedQuery)) - Number(!b.searchKey.startsWith(normalizedQuery)) ||
      b.awardCount - a.awardCount || a.name.localeCompare(b.name, 'it')
    );
  return { query, normalizedQuery, limit, matched: all.length, hits: all.slice(0, limit) };
}

test('operator search preserves stable ranked responses across broad/narrow/Unicode queries and limits', async () => {
  const rows = Array.from({ length: 180 }, (_, i) => row(i,
    i % 3 === 0 ? 'Srl Ácqua' : i % 3 === 1 ? 'Industria Srl' : `Srl Édile ${180 - i}`
  ));
  rows.push(
    row(180, 'Srl Ácqua', 0), row(181, 'Srl Ácqua', 0), row(182, 'Autostrade', 999),
    row(183, 'Stable Zeta', 5), row(184, 'Stable Alfa', 5), row(185, 'Stable Alfa', 5),
    row(186, 'Impresa Stable', 10000), row(187, 'Stable Gamma', 4),
  );
  await fixture(rows, adapter => {
    const stable = adapter.searchAnacOperators({ q: 'stable', limit: 50 });
    // Prefix wins even against a higher count; count then Italian name order
    // resolve ranking, while identical names/counts preserve source order.
    assert.deepEqual(stable.hits.map(hit => hit.ref), [
      'op-00000184', 'op-00000185', 'op-00000183', 'op-00000187', 'op-00000186',
    ]);
    assert.equal(stable.matched, 5);
    assert.deepEqual(adapter.searchAnacOperators({ q: 'stable', limit: 2 }).hits.map(hit => hit.ref), [
      'op-00000184', 'op-00000185',
    ]);
    const queries = [
      'srl', 'ＳＲＬ', ' acqua ', ['srl', 'autostrade'], 'autostrade',
      'éDile', 'stable', 'zzzz', '!!!', 'ab', 'x'.repeat(130),
    ];
    for (const q of queries) {
      for (const limit of [0, 1, 1.9, 10.75, 25, 50, 500, NaN, Infinity]) {
        const { meta, ...response } = adapter.searchAnacOperators({ q, limit });
        assert.deepEqual(response, reference(rows, q, limit));
        assert.equal(meta.totals.operators, rows.length);
      }
    }
  });
});
