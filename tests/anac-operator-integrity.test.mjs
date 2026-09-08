import assert from 'node:assert/strict';
import { copyFileSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { spawnSync } from 'node:child_process';
import test from 'node:test';
import { gunzipSync } from 'node:zlib';

const root = resolve(import.meta.dirname, '..');
const artifact = 'src/data/generated/anac-operator-awards-index';
const browse = 'src/data/generated/anac-operator-browse';

function fixture(run) {
  const cwd = mkdtempSync(join(tmpdir(), 'dvns-operator-integrity-'));
  const copy = path => {
    mkdirSync(dirname(join(cwd, path)), { recursive: true });
    copyFileSync(join(root, path), join(cwd, path));
  };
  copy(`${artifact}/meta.json`);
  copy('scripts/etl/specs/anac-operator-awards-index.source.json');
  try { run({ cwd, copy }); } finally { rmSync(cwd, { recursive: true, force: true }); }
}
function invoke(cwd, expression, expected) {
  const script = `import ${JSON.stringify(join(root, 'tests/helpers/register-ts-alias.mjs'))};\nconst adapter = await import(${JSON.stringify(join(root, 'src/lib/data/anac-operator-awards-index.ts'))});\n${expression};`;
  const result = spawnSync(process.execPath, ['--experimental-strip-types', '--input-type=module', '-e', script], { cwd, encoding: 'utf8' });
  if (expected) {
    assert.notEqual(result.status, 0, 'corrupt data must fail closed');
    assert.match(result.stderr, expected);
  } else assert.equal(result.status, 0, result.stderr);
}

test('metadata reads do not require unrelated detail shards', () => fixture(({ cwd }) => {
  invoke(cwd, 'adapter.loadAnacOperatorIndexMeta()');
}));

test('changed summaries, search and requested detail shards fail their own integrity check', () => {
  for (const [path, expression] of [
    [`${artifact}/summaries.json`, 'adapter.loadAnacOperatorNationalSummaries()'],
    [`${artifact}/search.jsonl.gz`, 'adapter.searchAnacOperators({q:"autostrade"})'],
    [`${artifact}/operators/00.jsonl.gz`, null],
  ]) fixture(({ cwd, copy }) => {
    copy(path);
    const bytes = readFileSync(join(cwd, path));
    let operation = expression;
    if (!operation) {
      // Pick a real ref from this shard before corrupting its compressed bytes.
      const ref = JSON.parse(gunzipSync(bytes).toString('utf8').split('\n')[0]).ref;
      operation = `adapter.getAnacOperatorByRef(${JSON.stringify(ref)})`;
    }
    bytes[bytes.length - 1] ^= 1;
    writeFileSync(join(cwd, path), bytes);
    invoke(cwd, operation, /SHA-256 o dimensione non allineati/);
  });
});

test('browse rejects stale source hashes, noncontiguous offsets and changed block bytes', () => {
  for (const scenario of ['source', 'offset', 'block']) fixture(({ cwd, copy }) => {
    copy(`${browse}/manifest.json`);
    const manifestPath = join(cwd, browse, 'manifest.json');
    const manifest = JSON.parse(readFileSync(manifestPath));
    if (scenario === 'source') manifest.sourceSearchSha256 = '0'.repeat(64);
    if (scenario === 'offset') manifest.orders.awardCount.blocks[1].offset++;
    if (scenario === 'block') {
      copy(`${browse}/awardCount.jsonl.gz`);
      const path = join(cwd, browse, 'awardCount.jsonl.gz');
      const bytes = readFileSync(path);
      bytes[manifest.orders.awardCount.blocks[0].bytes - 1] ^= 1;
      writeFileSync(path, bytes);
    }
    writeFileSync(manifestPath, JSON.stringify(manifest));
    invoke(cwd, 'adapter.listAnacOperatorsPage()', scenario === 'source' ? /non allineata alla fonte/ : scenario === 'offset' ? /non contigui/ : /SHA-256 blocco/);
  });
});

test('every browse gzip member has a platform-neutral header', () => {
  const manifest = JSON.parse(readFileSync(join(root, browse, 'manifest.json')));
  for (const [order, details] of Object.entries(manifest.orders)) {
    const bytes = readFileSync(join(root, browse, `${order}.jsonl.gz`));
    for (const block of details.blocks) {
      assert.deepEqual([...bytes.subarray(block.offset, block.offset + 10)], [31, 139, 8, 0, 0, 0, 0, 0, 2, 255]);
    }
  }
});
