import '../../tests/helpers/register-ts-alias.mjs';
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import fs from 'node:fs';
import { syncBuiltinESMExports } from 'node:module';
import { performance } from 'node:perf_hooks';

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
const adapter = await import('../../src/lib/data/anac-operator-awards-index.ts');
function measure(label, run) {
  bytes = 0;
  const start = performance.now();
  const result = run();
  const report = { label, milliseconds: Math.round((performance.now() - start) * 100) / 100, bytesRead: bytes, rssMiB: Math.round(process.memoryUsage().rss / 1024 ** 2), digest: createHash('sha256').update(JSON.stringify(result)).digest('hex') };
  console.log(JSON.stringify(report));
  return { result, report };
}
try {
  console.log(JSON.stringify({ node: process.version, platform: process.platform, architecture: process.arch }));
  const first = measure('cold-list-page', () => {
    adapter.loadAnacOperatorIndexMeta();
    adapter.loadAnacOperatorNationalSummaries();
    return adapter.listAnacOperatorsPage({ page: 1 });
  });
  assert.ok(first.report.bytesRead < 2 * 1024 * 1024, 'cold list must not scan the national corpus');
  measure('warm-list-page', () => adapter.listAnacOperatorsPage({ page: 1 }));
  measure('deep-list-page', () => adapter.listAnacOperatorsPage({ page: 1234 }));
  measure('value-list-page', () => adapter.listAnacOperatorsPage({ by: 'valore' }));
  measure('operator-detail', () => adapter.getAnacOperatorByRef(first.result.hits[0].ref));
  measure('name-search', () => adapter.searchAnacOperators({ q: 'autostrade', limit: 50 }));
} finally {
  fs.readFileSync = originalReadFile;
  fs.readSync = originalRead;
  syncBuiltinESMExports();
}
