import assert from "node:assert/strict";
import { mkdtempSync, rmSync, symlinkSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, relative } from "node:path";
import test from "node:test";
import { readJsonSnapshot } from "../src/lib/data/read-json-snapshot.ts";

test("snapshot reads preserve values and reject missing, malformed, oversized and linked artifacts", (t) => {
  const directory = mkdtempSync(join(tmpdir(), "dvns-json-snapshot-"));
  t.after(() => rmSync(directory, { recursive: true, force: true }));
  const file = join(directory, "snapshot.json");
  const relativeFile = relative(process.cwd(), file);
  assert.throws(() => readJsonSnapshot(relativeFile, 100), { code: "ENOENT" });
  writeFileSync(file, '{"zero":0,"missing":null,"text":"città"}');
  assert.deepEqual(readJsonSnapshot(relativeFile, 100), { zero: 0, missing: null, text: "città" });
  assert.throws(() => readJsonSnapshot(relativeFile, 4), /troppo grande/);
  const link = join(directory, "link.json");
  symlinkSync(file, link);
  assert.throws(() => readJsonSnapshot(relative(process.cwd(), link), 100));
  writeFileSync(file, "{");
  assert.throws(() => readJsonSnapshot(relativeFile, 100), SyntaxError);
  writeFileSync(file, "");
  assert.throws(() => readJsonSnapshot(relativeFile, 100), /assente/);
});
