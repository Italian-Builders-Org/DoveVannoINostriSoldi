import assert from "node:assert/strict";
import test from "node:test";
import { mkdtempSync, writeFileSync, renameSync, rmSync, symlinkSync, utimesSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { ArtifactCache, artifactFingerprint } from "../src/lib/data/artifact-cache.ts";

test("cache bounds bytes and entries, refreshes recency and accounts for replacements", () => {
  const cache = new ArtifactCache(2, 10);
  cache.set("a", 1, 4); cache.set("b", 2, 4);
  assert.equal(cache.get("a"), 1);
  cache.set("c", 3, 4);
  assert.equal(cache.get("b"), undefined);
  cache.set("a", 4, 8);
  assert.equal(cache.get("c"), undefined);
  cache.set("a", 5, 11);
  assert.equal(cache.get("a"), undefined);
  cache.set("b", 6, 10);
  assert.equal(cache.get("b"), 6);
});

test("artifact identity detects equal-size edits, replacements, deletion and symlinks", () => {
  const root = mkdtempSync(join(tmpdir(), "dvns-artifact-cache-"));
  const file = join(root, "data");
  try {
    writeFileSync(file, "abc");
    const before = artifactFingerprint([file]);
    writeFileSync(file, "xyz");
    utimesSync(file, 1, 1);
    assert.notEqual(artifactFingerprint([file]), before);
    const edited = artifactFingerprint([file]);
    writeFileSync(join(root, "new"), "xyz");
    renameSync(join(root, "new"), file);
    assert.notEqual(artifactFingerprint([file]), edited);
    rmSync(file);
    assert.throws(() => artifactFingerprint([file]));
    symlinkSync(join(root, "new"), file);
    assert.throws(() => artifactFingerprint([file]), /non regolare/);
  } finally { rmSync(root, { recursive: true, force: true }); }
});
