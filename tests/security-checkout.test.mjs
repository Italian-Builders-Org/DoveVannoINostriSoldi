import assert from 'node:assert/strict';
import { execFileSync, spawnSync } from 'node:child_process';
import { mkdtempSync, mkdirSync, readFileSync, rmSync, unlinkSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import test from 'node:test';
import { parse } from 'yaml';

const workflow = parse(readFileSync(new URL('../.github/workflows/ci.yml', import.meta.url), 'utf8'));
const guard = workflow.jobs.security.steps.find((step) => step.name === 'Verify security audit checkout');

function checkoutFixture(t) {
  const root = mkdtempSync(join(tmpdir(), 'dvns-security-checkout-'));
  t.after(() => rmSync(root, { recursive: true, force: true }));
  execFileSync('git', ['init', '-q', root]);
  const inputs = [
    '.github/workflows/ci.yml', '.github/actions/local/action.yml',
    'custom action/action.yaml', 'custom/.pre-commit-hooks.yaml',
    '.pre-commit-config.yaml', '.github/dependabot.yml', 'zizmor.yml',
  ];
  for (const path of [...inputs, 'data/unrelated.yaml']) {
    mkdirSync(dirname(join(root, path)), { recursive: true });
    writeFileSync(join(root, path), '{}\n');
  }
  execFileSync('git', ['-C', root, 'add', '.']);
  return { root, inputs };
}

function runGuard(root) {
  assert.ok(guard?.run, 'security job must verify the sparse audit inventory before Zizmor');
  return spawnSync('bash', ['-c', guard.run], { cwd: root, encoding: 'utf8' });
}

test('security checkout accepts every audit input without requiring unrelated data YAML', (t) => {
  const { root } = checkoutFixture(t);
  unlinkSync(join(root, 'data/unrelated.yaml'));
  const result = runGuard(root);
  assert.equal(result.status, 0, result.stderr);
});

test('security checkout rejects missing workflows, local actions and audit configuration', (t) => {
  const { root, inputs } = checkoutFixture(t);
  for (const path of inputs) {
    unlinkSync(join(root, path));
    const result = runGuard(root);
    assert.equal(result.status, 1, `missing audit input ${path} must fail`);
    assert.ok(result.stderr.includes(path), result.stderr);
    writeFileSync(join(root, path), '{}\n');
  }
});
