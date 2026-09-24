import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { existsSync, mkdtempSync, mkdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import test from "node:test";

const script = fileURLToPath(new URL("../scripts/ci/clean-next-build-cache.mjs", import.meta.url));

function fixture(t, worktree = false) {
  const cwd = mkdtempSync(join(tmpdir(), "dvns-build-cleanup-"));
  t.after(() => rmSync(cwd, { recursive: true, force: true }));
  const files = [".next/cache/turbopack/cache.sst", ".next/server/app/page.js", "src/data/snapshot.json"];
  files.push(worktree ? ".git" : ".git/objects/pack/fixture.pack");
  for (const file of files) {
    mkdirSync(dirname(join(cwd, file)), { recursive: true });
    writeFileSync(join(cwd, file), "fixture");
  }
  return cwd;
}

function run(cwd, vercel) {
  const result = spawnSync(process.execPath, [script], {
    cwd, encoding: "utf8", env: { ...process.env, VERCEL: vercel },
  });
  assert.equal(result.status, 0, result.stderr || result.stdout);
  return result.stdout;
}

test("local and GitHub builds retain the compiler cache and checkout", (t) => {
  const cwd = fixture(t);
  for (const vercel of ["", "0"]) {
    run(cwd, vercel);
    assert.equal(readFileSync(join(cwd, ".next/cache/turbopack/cache.sst"), "utf8"), "fixture");
    assert.equal(readFileSync(join(cwd, ".git/objects/pack/fixture.pack"), "utf8"), "fixture");
  }
});

test("Vercel cleanup frees disposable files, preserves output and data, and is repeatable", (t) => {
  const cwd = fixture(t);
  const output = run(cwd, "1");
  assert.match(output, /Build disk before cleanup: \d+\.\d+ GiB available/);
  assert.match(output, /Build disk after cleanup: \d+\.\d+ GiB available/);
  assert.equal(existsSync(join(cwd, ".next/cache")), false);
  assert.equal(existsSync(join(cwd, ".git")), false);
  for (const file of [".next/server/app/page.js", "src/data/snapshot.json"]) {
    assert.equal(readFileSync(join(cwd, file), "utf8"), "fixture");
  }
  assert.match(run(cwd, "1"), /No post-build disk cleanup was needed/);
});

test("Vercel cleanup leaves a Git worktree pointer intact", (t) => {
  const cwd = fixture(t, true);
  run(cwd, "1");
  assert.equal(readFileSync(join(cwd, ".git"), "utf8"), "fixture");
});
