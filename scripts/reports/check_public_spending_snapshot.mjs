#!/usr/bin/env node
// Full-repository release gate. Never fetches or alters data.
import { readFile } from 'node:fs/promises';
import { createHash } from 'node:crypto';
import { resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { compareReportSnapshot, validatePublicSpendingReport } from '../../src/lib/public-spending-report.ts';

export async function checkSnapshot(root) {
  const report = validatePublicSpendingReport(JSON.parse(await readFile(resolve(root, 'src/content/reports/public-spending-2026.json'), 'utf8')));
  const path = 'src/data/generated/eurostat-cofog-2014-2024.data.json';
  const bytes = await readFile(resolve(root, path));
  const metadata = JSON.parse(await readFile(resolve(root, 'src/data/generated/eurostat-cofog-2014-2024.meta.json'), 'utf8'));
  const observedHash = createHash('sha256').update(bytes).digest('hex');
  if (observedHash !== metadata.integrity.dataArtifact.sha256 || observedHash !== report.macro.sourceDataArtifactSha256Declared) {
    throw new Error('Lo snapshot non coincide con il rilascio congelato: revisione editoriale richiesta, nessun aggiornamento silenzioso.');
  }
  if (bytes.length !== metadata.integrity.dataArtifact.bytes) throw new Error('Dimensione artefatto non riconciliata');
  const data = JSON.parse(bytes.toString('utf8'));
  if (data.datasetId !== 'eurostat-cofog') throw new Error('Dataset non atteso');
  const differences = compareReportSnapshot(report, data.observations);
  if (differences.length) throw new Error(differences.join('\n'));
  const rows = data.observations.filter((r) => r.geo === 'IT' && r.year === 2024);
  const codes = new Set(['TOTAL', ...report.sections.map((s) => s.code)]);
  const primary = rows.filter((r) => codes.has(r.function));
  const sum = primary.filter((r) => r.function !== 'TOTAL').reduce((total, r) => total + BigInt(r.amountCents), 0n);
  const total = BigInt(primary.find((r) => r.function === 'TOTAL').amountCents);
  const gap = sum > total ? sum - total : total - sum;
  const tolerance = metadata.reconciliation.toleranceCents;
  if (!Number.isSafeInteger(tolerance) || tolerance < 0 || tolerance > 60_000_000 || gap > BigInt(tolerance)) {
    throw new Error('Le divisioni non riconciliano entro la tolleranza dichiarata della fonte');
  }
  return {ok: true, sha256: observedHash, rows: primary.length, period: 2024, gapCents: gap.toString()};
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const root = process.argv[2] ? resolve(process.argv[2]) : resolve(dirname(fileURLToPath(import.meta.url)), '../..');
  checkSnapshot(root).then((result) => console.log(JSON.stringify(result))).catch((error) => {
    console.error(`Snapshot non verificato: ${error.message}`);
    process.exitCode = 1;
  });
}
