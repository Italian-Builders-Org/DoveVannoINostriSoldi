import assert from 'node:assert/strict';
import fs from 'node:fs';
import { syncBuiltinESMExports } from 'node:module';
import test from 'node:test';
import './helpers/register-ts-alias.mjs';

// Observe real artifact reads in a fresh test process: a cold list must not
// scan the national search corpus or unrelated operator detail shards.
const originalReadFile = fs.readFileSync;
const originalRead = fs.readSync;
let bytes = 0;
let readingFile = false;
fs.readFileSync = function (...args) {
  readingFile = true;
  try {
    const value = originalReadFile.apply(this, args);
    bytes += Buffer.byteLength(value);
    return value;
  } finally { readingFile = false; }
};
fs.readSync = function (...args) {
  const count = originalRead.apply(this, args);
  if (!readingFile) bytes += count;
  return count;
};
syncBuiltinESMExports();
const adapter = await import('../src/lib/data/anac-operator-awards-index.ts');

test('cold operator hub and arbitrary list pages read less than 2 MiB', () => {
  bytes = 0;
  try {
    adapter.loadAnacOperatorIndexMeta();
    adapter.loadAnacOperatorNationalSummaries();
    for (const by of ['awardCount', 'attributedValue']) {
      for (const page of [1, 2, 1234, 99999]) {
        const result = adapter.listAnacOperatorsPage({ by, page, pageSize: 99 });
        assert.ok(result.hits.length > 0);
        assert.ok(result.hits.length <= 99);
      }
    }
    assert.ok(bytes < 2 * 1024 * 1024, `cold list read ${bytes} bytes`);
    const first = adapter.listAnacOperatorsPage({ page: 1, pageSize: 1 }).hits[0];
    for (let block = 20; block < 40; block++) {
      adapter.listAnacOperatorsPage({ page: block * 1000 + 1, pageSize: 1 });
    }
    bytes = 0;
    const revisited = adapter.listAnacOperatorsPage({ page: 1, pageSize: 1 }).hits[0];
    assert.deepEqual(revisited, first);
    assert.ok(bytes > 0, "old blocks must be evicted rather than retaining the whole index");
  } finally {
    fs.readFileSync = originalReadFile;
    fs.readSync = originalRead;
    syncBuiltinESMExports();
  }
});
