// Full-repository gate: intentionally requires the REAL committed Eurostat bundle.
import assert from 'node:assert/strict';
import test from 'node:test';
import { readFile } from 'node:fs/promises';
import { createHash } from 'node:crypto';
import { validateReader, validateReaderSnapshot } from '../src/lib/reports/state-budget-reader.ts';

test('current reader uses the pinned, complete COFOG artifact and its exact cells', async () => {
  const report = validateReader(JSON.parse(await readFile(new URL('../src/content/reports/state-budget-reader.json', import.meta.url), 'utf8')));
  const raw = await readFile(new URL('../src/data/generated/eurostat-cofog-2014-2024.data.json', import.meta.url));
  const metadata = JSON.parse(await readFile(new URL('../src/data/generated/eurostat-cofog-2014-2024.meta.json', import.meta.url), 'utf8'));
  const hash = createHash('sha256').update(raw).digest('hex');
  assert.equal(hash, metadata.integrity.dataArtifact.sha256);
  assert.equal(hash, report.macro.snapshotSha256);
  assert.equal(raw.length, metadata.integrity.dataArtifact.bytes);
  const snapshot = JSON.parse(raw.toString('utf8'));
  assert.equal(snapshot.datasetId, 'eurostat-cofog');
  validateReaderSnapshot(report, snapshot.observations);
});
