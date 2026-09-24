import assert from "node:assert/strict";
import test from "node:test";
import { copyFileSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { join, dirname } from "node:path";
import { tmpdir } from "node:os";
import "./helpers/register-ts-alias.mjs";
const { getOperatorHistory } = await import("../src/lib/data/anac-operator-history.ts");

test("operator cache retains validation after warm reads, file corruption and source changes", () => {
  const cwd = process.cwd();
  const root = mkdtempSync(join(tmpdir(), "dvns-operator-cache-"));
  const files = [
    "src/data/generated/anac-operator-history/manifest.json",
    "src/data/generated/anac-operator-history/00.jsonl.gz",
    "src/data/generated/anac-operator-awards-index/meta.json",
    "scripts/etl/specs/anac-cig-2007-2025.source.json",
  ];
  try {
    for (const file of files) {
      mkdirSync(dirname(join(root, file)), { recursive: true });
      copyFileSync(join(cwd, file), join(root, file));
    }
    process.chdir(root);
    const ref = "op-00000250";
    const original = getOperatorHistory(ref);
    assert.ok(original);
    assert.strictEqual(getOperatorHistory(ref), original);
    const shard = join(root, files[1]);
    const bytes = readFileSync(shard);
    bytes[bytes.length - 1] ^= 1;
    writeFileSync(shard, bytes);
    assert.throws(() => getOperatorHistory(ref), /Hash/);
    copyFileSync(join(cwd, files[1]), shard);
    assert.deepEqual(getOperatorHistory(ref), original);
    writeFileSync(join(root, files[2]), "{}");
    assert.throws(() => getOperatorHistory(ref), /non allineato/);
  } finally {
    process.chdir(cwd);
    rmSync(root, { recursive: true, force: true });
  }
});
