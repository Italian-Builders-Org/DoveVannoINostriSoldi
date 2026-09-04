import assert from "node:assert/strict";
import { execFileSync, spawnSync } from "node:child_process";
import { mkdtempSync, mkdirSync, renameSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import test from "node:test";

const script = fileURLToPath(new URL("../scripts/ci/vercel-ignore-build.mjs", import.meta.url));

test("Vercel skips only non-deployment changes since the last successful build", (t) => {
  const cwd = mkdtempSync(join(tmpdir(), "dvns-vercel-ignore-"));
  t.after(() => rmSync(cwd, { recursive: true, force: true }));
  const git = (...args) => execFileSync("git", args, { cwd, encoding: "utf8", stdio: ["ignore", "pipe", "pipe"] }).trim();
  git("init", "--quiet");
  git("config", "user.name", "Test");
  git("config", "user.email", "test@example.invalid");
  const commit = (file, content) => {
    mkdirSync(dirname(join(cwd, file)), { recursive: true });
    writeFileSync(join(cwd, file), content);
    git("add", "--all");
    git("-c", "core.hooksPath=/dev/null", "-c", "commit.gpgsign=false", "commit", "--quiet", "-m", "fixture");
    return git("rev-parse", "HEAD");
  };
  const run = (previous, current) => spawnSync(process.execPath, [script], {
    cwd, encoding: "utf8",
    env: { ...process.env, VERCEL_GIT_PREVIOUS_SHA: previous, VERCEL_GIT_COMMIT_SHA: current },
  });
  const expect = (previous, current, status) => {
    const result = run(previous, current);
    assert.equal(result.status, status, result.stderr || result.stdout);
    assert.match(result.stdout, status === 0 ? /^SKIP:/ : /^BUILD:/);
  };

  const initial = commit("src/app/page.tsx", "export default 1;");
  const docs = commit("docs/guide with spaces.md", "Instructions");
  const tests = commit("tests/route.test.mjs", "Assertions");
  expect(initial, docs, 0);
  expect(initial, tests, 0);
  expect("", tests, 1); // First deployment: a preview must exist.
  expect(tests, tests, 1); // Manual redeploy may contain new environment settings.
  expect("--help", tests, 1);
  expect("f".repeat(40), tests, 1); // Missing/shallow Git history.
  expect(initial, "", 1);

  const code = commit("src/app/page.tsx", "export default 2;");
  const laterDocs = commit("README.md", "Documentation after a failed code build");
  expect(tests, laterDocs, 1); // HEAD^ alone would incorrectly skip the code.
  expect(code, laterDocs, 0);

  let previous = laterDocs;
  for (const file of [
    "docs/research/data/anac.json", "docs/research/data/raw.md", "scripts/etl/specs/source.json",
    "src/data/generated/data.json", "data/source-ledger/receipt.json",
    "public/logo.svg", "package-lock.json", "next.config.ts", "vercel.json",
    ".github/workflows/ci.yml", "unknown-new-input.txt",
  ]) {
    const current = commit(file, "changed");
    expect(previous, current, 1);
    previous = current;
  }

  // A rename out of a runtime directory must include the deletion in the diff.
  renameSync(join(cwd, "src/app/page.tsx"), join(cwd, "docs/old-code.md"));
  const renamed = commit("docs/rename.md", "Moved source");
  expect(previous, renamed, 1);
});
