import assert from "node:assert/strict";
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join, relative } from "node:path";
import test from "node:test";
import { checkTrace } from "../scripts/ci/check-runtime-traces.mjs";

function fixture(t, files) {
  const root = mkdtempSync(join(tmpdir(), "dvns-runtime-trace-"));
  t.after(() => rmSync(root, { recursive: true, force: true }));
  const manifest = join(root, ".next/server/app/enti/page.js.nft.json");
  mkdirSync(dirname(manifest), { recursive: true });
  for (const file of files) {
    mkdirSync(dirname(join(root, file)), { recursive: true });
    writeFileSync(join(root, file), "bytes");
  }
  writeFileSync(manifest, JSON.stringify({ version: 1, files: files.map((file) => relative(dirname(manifest), join(root, file))) }));
  return { root, manifest };
}

test("runtime package guard requires dynamically opened artifacts", (t) => {
  const artifact = "src/data/generated/anac-entity-procurement-page/entities/ab.jsonl.gz";
  const { root, manifest } = fixture(t, [artifact]);
  assert.deepEqual(checkTrace(root, manifest, [artifact]), { files: 1, bytes: 5 });
  assert.throws(() => checkTrace(root, manifest, [artifact.replace("ab", "cd")]), /omits runtime files/);
});

test("runtime package guard rejects accidental repository-wide and cross-domain tracing", (t) => {
  const { root, manifest } = fixture(t, ["tests/fixtures/private.json"]);
  assert.throws(() => checkTrace(root, manifest), /traces unrelated files/);
  const other = fixture(t, ["src/data/generated/unrelated/large.json"]);
  assert.throws(() => checkTrace(other.root, other.manifest, [], ["src/data/generated/unrelated"]), /traces unrelated files/);
});

test("runtime package guard fails on traced files missing from the deployment", (t) => {
  const { root, manifest } = fixture(t, ["required.json"]);
  rmSync(join(root, "required.json"));
  assert.throws(() => checkTrace(root, manifest), /ENOENT/);
});
