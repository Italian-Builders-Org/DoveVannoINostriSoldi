#!/usr/bin/env node
// Deterministic offline derivative of the committed, source-locked public index.
// Run with Node 22 --experimental-strip-types. Uses the same TS loader as runtime benchmarks.
import "../../tests/helpers/register-ts-alias.mjs";
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { gunzipSync, gzipSync } from 'node:zlib';
const { assertAnacOperatorSearchHit, loadAnacOperatorIndexMeta } = await import('../../src/lib/data/anac-operator-awards-index.ts');
const { compareAnacOperators, OPERATOR_BROWSE_DIR, OPERATOR_BROWSE_BLOCK_SIZE, OPERATOR_BROWSE_ORDERS } = await import('../../src/lib/data/anac-operator-browse.ts');

const check = process.argv.includes('--check');
assert.ok(process.argv.slice(2).every(arg => arg === '--check'), 'Only --check is supported');
const digest = value => createHash('sha256').update(value).digest('hex');
const meta = loadAnacOperatorIndexMeta();
const compressed = readFileSync('src/data/generated/anac-operator-awards-index/search.jsonl.gz');
assert.equal(compressed.length, meta.search.bytes);
assert.equal(digest(compressed), meta.search.sha256);
const rows = gunzipSync(compressed, { maxOutputLength: 512 * 1024 * 1024 }).toString('utf8').trimEnd().split('\n').map(line => assertAnacOperatorSearchHit(JSON.parse(line)));
assert.equal(rows.length, meta.totals.operators);
const manifest = { schemaVersion: 1, sourceSearchSha256: meta.search.sha256, sourceSpecSha256: meta.sourceSpecSha256, total: rows.length, blockSize: OPERATOR_BROWSE_BLOCK_SIZE, orders: {} };
if (!check) mkdirSync(OPERATOR_BROWSE_DIR, { recursive: true });
function publish(name, bytes) {
  const path = join(OPERATOR_BROWSE_DIR, name);
  if (check) assert.ok(readFileSync(path).equals(bytes), `${path} differs from the source-locked derivative; regenerate it`);
  else writeFileSync(path, bytes);
}
for (const by of OPERATOR_BROWSE_ORDERS) {
  const sorted = [...rows].sort((a, b) => compareAnacOperators(by, a, b));
  const chunks = [];
  const blocks = [];
  let offset = 0;
  for (let start = 0; start < sorted.length; start += OPERATOR_BROWSE_BLOCK_SIZE) {
    const slice = sorted.slice(start, start + OPERATOR_BROWSE_BLOCK_SIZE);
    const chunk = gzipSync(slice.map(row => JSON.stringify(row)).join('\n') + '\n', { level: 9 });
    // RFC 1952 OS=255 (unknown): zlib otherwise writes macOS=19 or Unix=3.
    // The platform marker does not affect the content or trailer checksum.
    chunk[9] = 255;
    blocks.push({ offset, bytes: chunk.length, rows: slice.length, sha256: digest(chunk) });
    chunks.push(chunk);
    offset += chunk.length;
  }
  manifest.orders[by] = { bytes: offset, blocks };
  publish(`${by}.jsonl.gz`, Buffer.concat(chunks));
}
publish('manifest.json', Buffer.from(JSON.stringify(manifest, null, 2) + '\n'));
console.log(`${check ? 'Verified' : 'Generated'} ${rows.length} operators in both complete rankings`);
