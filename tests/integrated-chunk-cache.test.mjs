import assert from 'node:assert/strict';
import test from 'node:test';
import { execFile } from 'node:child_process';
import { cp, mkdir, mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { promisify } from 'node:util';
import './helpers/register-ts-alias.mjs';
const loader = await import('../src/lib/integrated-sources.ts');

test('validated chunk rows are reused while every read still checks the committed bytes', async () => {
  const bundle = await loader.loadIntegratedSourceBundle();
  const dataset = bundle.datasetsById.get('mef-patrimonio-beni-2023');
  const first = await loader.loadIntegratedDatasetChunk(bundle, dataset, 0);
  const second = await loader.loadIntegratedDatasetChunk(bundle, dataset, 0);
  assert.ok(first.rows === second.rows, 'repeated requests must not decode the same national chunk again');
  assert.ok(first.rows.length > 0);
  assert.throws(() => loader.loadIntegratedDatasetChunk(bundle, { ...dataset }, 0), /allowlist/);
  const controller = new AbortController();
  controller.abort();
  assert.throws(() => loader.loadIntegratedDatasetChunk(bundle, dataset, 0, controller.signal), { name: 'AbortError' });
});

test('corruption after a cache fill is rejected in an isolated snapshot directory', async t => {
  const directory = await mkdtemp(join(tmpdir(), 'dvns-chunk-cache-'));
  t.after(() => rm(directory, { recursive: true, force: true }));
  const bundle = await loader.loadIntegratedSourceBundle();
  const chunk = 'src/data/generated/integrated/rows/mef-patrimonio-beni-2023.part-00000.jsonl.gz';
  assert.ok(bundle.datasetProof.artifactSha256[chunk]);
  for (const file of [chunk, 'src/data/generated/integrated/catalog.json', ...['release-proof.json', 'receipt.json', 'sources.jsonl', 'dataset-proof.json'].map(name => `data/source-ledger/${name}`)]) {
    const target = join(directory, file);
    await mkdir(dirname(target), { recursive: true });
    await cp(resolve(file), target);
  }
  const script = `
    import assert from 'node:assert/strict';
    import {readFile,writeFile} from 'node:fs/promises';
    const loader=await import(${JSON.stringify(new URL('../src/lib/integrated-sources.ts', import.meta.url).href)});
    const bundle=await loader.loadIntegratedSourceBundle();
    const dataset=bundle.datasetsById.get('mef-patrimonio-beni-2023');
    await loader.loadIntegratedDatasetChunk(bundle,dataset,0);
    const path=${JSON.stringify(chunk)};
    const bytes=await readFile(path);bytes[bytes.length-1]^=1;await writeFile(path,bytes);
    await assert.rejects(loader.loadIntegratedDatasetChunk(bundle,dataset,0),/divergono/);
  `;
  await promisify(execFile)(process.execPath, ['--experimental-strip-types', '--import', new URL('../scripts/ci/node-test-setup.mjs', import.meta.url).href, '--import', new URL('./helpers/register-ts-alias.mjs', import.meta.url).href, '--input-type=module', '-e', script], { cwd: directory, timeout: 30_000 });
});
