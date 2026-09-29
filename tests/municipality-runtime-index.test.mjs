import assert from 'node:assert/strict';
import test from 'node:test';
import './helpers/register-ts-alias.mjs';
const { getSiopeMunicipalityPeerObservations } = await import('../src/lib/siope-municipality-detail.ts');
const { getSiopeMunicipalityReceipts, querySiopeMunicipalReceipts } = await import('../src/lib/siope-receipts.ts');

test('receipt lookups preserve the public selection across years, whitespace and missing identifiers', () => {
  for (const year of [2024, 2025, 2026]) {
    const selected = querySiopeMunicipalReceipts({ year, limit: 100 }).municipalities;
    for (const row of selected) assert.deepEqual(getSiopeMunicipalityReceipts(` ${row.taxCode} `, year), row);
    assert.equal(getSiopeMunicipalityReceipts('00000000000', year), null);
  }
  assert.throws(() => getSiopeMunicipalityReceipts('00000000000', 1999), /Anno SIOPE/);
});

test('national peer observations are reused across requests instead of rebuilding the national corpus', () => {
  const first = getSiopeMunicipalityPeerObservations(2026);
  assert.ok(first.length > 1000);
  assert.strictEqual(getSiopeMunicipalityPeerObservations(2026), first);
  assert.notStrictEqual(getSiopeMunicipalityPeerObservations(2025), first);
  assert.deepEqual(getSiopeMunicipalityPeerObservations(1999), []);
});
