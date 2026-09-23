import assert from "node:assert/strict";
import fs from "node:fs";
import { mkdtempSync, mkdirSync, rmSync, readdirSync, readFileSync, statSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join, relative } from "node:path";
import { fileURLToPath } from "node:url";
import test from "node:test";
import path from "node:path";
import { checkAgentContext, relativePosix } from "../scripts/ci/check-agent-context.mjs";

const repoRoot = fileURLToPath(new URL("..", import.meta.url));
const fixturesRoot = join(repoRoot, "tests", "fixtures", "agent-context");

function walk(root) {
  const entries = [];
  for (const name of readdirSync(root)) {
    const absolute = join(root, name);
    const stats = statSync(absolute);
    if (stats.isDirectory()) {
      entries.push(...walk(absolute));
    } else {
      entries.push(absolute);
    }
  }
  return entries;
}

function readFixture(fixtureName) {
  const root = join(fixturesRoot, fixtureName);
  const files = {};
  for (const absolute of walk(root)) {
    const rel = relative(root, absolute);
    files[rel] = readFileSync(absolute, "utf8");
  }
  return files;
}

function writeFixture(root, files) {
  for (const [relative, content] of Object.entries(files)) {
    const absolute = join(root, relative);
    mkdirSync(dirname(absolute), { recursive: true });
    writeFileSync(absolute, content);
  }
}

function baseFixture() {
  return readFixture("base");
}

function variantFixture(variantName) {
  const files = baseFixture();
  const overrides = readFixture(variantName);
  return { ...files, ...overrides };
}

test("context reads the validated file when its pathname is replaced", (t) => {
  const root = mkdtempSync(join(tmpdir(), "dvns-agent-context-race-"));
  t.after(() => rmSync(root, { recursive: true, force: true }));
  writeFixture(root, baseFixture());
  const stat = fs.fstatSync;
  let replaced = false;
  t.mock.method(fs, "fstatSync", (descriptor) => {
    const result = stat(descriptor);
    if (!replaced) {
      replaced = true;
      fs.renameSync(join(root, "AGENTS.md"), join(root, "AGENTS.previous.md"));
      writeFileSync(join(root, "AGENTS.md"), "invalid replacement");
    }
    return result;
  });
  assert.deepEqual(checkAgentContext({ root }), []);
  assert.equal(replaced, true);
});

test("repository context passes", () => {
  const violations = checkAgentContext({ root: repoRoot });
  assert.deepEqual(violations, []);
});

test("politicians context tracks the current legislative and judicial surfaces", () => {
  const map = readFileSync(join(repoRoot, "docs", "AGENT_CONTEXT.md"), "utf8");
  const guide = readFileSync(join(repoRoot, "docs", "POLITICI.md"), "utf8");
  const judicialModule = readFileSync(join(repoRoot, "src", "lib", "parlamento-giudiziario.ts"), "utf8");
  for (const document of [map, guide]) {
    assert.match(document, /senato-atti-voti-contract\.ts/);
    assert.match(document, /parlamento-giudiziario-contract\.ts/);
    assert.match(document, /api\/politici\/giudiziario/);
    assert.doesNotMatch(document, /CAMERA_ATTI_VOTI\.md/);
  }
  assert.match(guide, /bundle completo dei profili/u);
  assert.match(guide, /non è esposto come dataset MCP/u);
  assert.doesNotMatch(judicialModule, /MCP dataset/u);
});

test("fixture with valid context passes", (t) => {
  const root = mkdtempSync(join(tmpdir(), "dvns-agent-context-ok-"));
  t.after(() => rmSync(root, { recursive: true, force: true }));
  writeFixture(root, baseFixture());
  const violations = checkAgentContext({ root });
  assert.deepEqual(violations, []);
});

test("fixture detects renamed or removed reference", (t) => {
  const root = mkdtempSync(join(tmpdir(), "dvns-agent-context-missing-ref-"));
  t.after(() => rmSync(root, { recursive: true, force: true }));
  writeFixture(root, variantFixture("missing-ref"));
  const violations = checkAgentContext({ root });
  const messages = violations.map((v) => v.message);
  assert.ok(messages.some((m) => m.includes("target assente") && m.includes("POLITICI_OLD.md")), messages.join("; "));
});

test("fixture detects a missing percent-encoded dynamic route reference", (t) => {
  const root = mkdtempSync(join(tmpdir(), "dvns-agent-context-dynamic-ref-"));
  t.after(() => rmSync(root, { recursive: true, force: true }));
  const files = baseFixture();
  files["docs/AGENT_CONTEXT.md"] +=
    "\nVedi [src/app/example/[id]/route.ts](../src/app/example/%5Bid%5D/route.ts).\n";
  writeFixture(root, files);

  const violations = checkAgentContext({ root });
  const messages = violations.map((v) => v.message);
  assert.ok(
    messages.some((m) => m.includes("target assente") && m.includes("%5Bid%5D")),
    messages.join("; "),
  );
});

test("fixture detects missing required section", (t) => {
  const root = mkdtempSync(join(tmpdir(), "dvns-agent-context-missing-section-"));
  t.after(() => rmSync(root, { recursive: true, force: true }));
  writeFixture(root, variantFixture("missing-section"));
  const violations = checkAgentContext({ root });
  const messages = violations.map((v) => v.message);
  assert.ok(
    messages.some((m) => m.includes("manca la sezione obbligatoria") && m.includes("Politici")),
    messages.join("; "),
  );
});

test("fixture with irrelevant change still passes", (t) => {
  const root = mkdtempSync(join(tmpdir(), "dvns-agent-context-irrelevant-"));
  t.after(() => rmSync(root, { recursive: true, force: true }));
  writeFixture(root, variantFixture("irrelevant"));
  const violations = checkAgentContext({ root });
  assert.deepEqual(violations, []);
});

test("i percorsi relativi si confrontano in forma POSIX su qualunque sistema", () => {
  // Il comportamento che su Windows rendeva mancante ogni link obbligatorio,
  // riprodotto con path.win32 così la prova gira anche sulla CI Linux.
  const root = "C:\\repo";
  const target = "C:\\repo\\docs\\ARCHITECTURE.md";
  assert.equal(path.win32.relative(root, target), "docs\\ARCHITECTURE.md");
  assert.notEqual(path.win32.relative(root, target), "docs/ARCHITECTURE.md");
  assert.equal(relativePosix(root, target, path.win32), "docs/ARCHITECTURE.md");
  assert.equal(relativePosix("/repo", "/repo/docs/ARCHITECTURE.md", path.posix), "docs/ARCHITECTURE.md");
  // Un file alla radice non ha separatori, ed è il motivo per cui AGENTS.md veniva trovato.
  assert.equal(relativePosix(root, "C:\\repo\\AGENTS.md", path.win32), "AGENTS.md");
});
