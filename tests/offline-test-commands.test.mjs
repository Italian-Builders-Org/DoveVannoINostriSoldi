import assert from "node:assert/strict";
import { readdirSync, readFileSync } from "node:fs";
import path from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";

// npm test passa da scripts/ci/node-test-setup.mjs, che forza la guardia offline su ogni
// shell. Un comando di test Node documentato senza quel setup gira senza guardia: una
// chiamata di rete da un test passa, e il test si comporta diversamente che in CI.
// tests/live resta fuori perche' la rete la deve usare.
const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const SETUP = "node-test-setup.mjs";
const SKIPPED_DIRS = new Set(["node_modules", ".git", ".next", "artifacts", ".lighthouseci", ".vercel", "coverage", "fixtures"]);
// node, eventuali flag, poi --test: la forma in cui i test Node vengono lanciati.
const NODE_TEST_COMMAND = /\bnode(?: --[a-z-]+(?:=\S+)?)* --test\b/;

function isUnguardedOfflineTestCommand(text) {
  return NODE_TEST_COMMAND.test(text)
    && text.includes("tests/")
    && !text.includes("tests/live")
    && !text.includes(SETUP);
}

function* markdownFiles(directory) {
  for (const entry of readdirSync(directory, { withFileTypes: true })) {
    if (SKIPPED_DIRS.has(entry.name)) continue;
    const full = path.join(directory, entry.name);
    if (entry.isDirectory()) yield* markdownFiles(full);
    else if (entry.name.endsWith(".md")) yield full;
  }
}

const relative = (file) => path.relative(ROOT, file).split(path.sep).join("/");

test("il riconoscitore distingue un comando senza setup da quelli ammessi", () => {
  // Una guardia che non riconosce il difetto passerebbe sempre: la provo prima sui casi veri.
  assert.ok(isUnguardedOfflineTestCommand("node --experimental-strip-types --test tests/x.test.mjs"));
  assert.ok(isUnguardedOfflineTestCommand("node --test tests/x.test.mjs"));
  assert.ok(isUnguardedOfflineTestCommand("node --experimental-strip-types --test --test-name-pattern='a' tests/x.test.mjs"));
  assert.ok(!isUnguardedOfflineTestCommand(`node --experimental-strip-types --import ./scripts/ci/${SETUP} --test tests/x.test.mjs`));
  assert.ok(!isUnguardedOfflineTestCommand("node --experimental-strip-types --test tests/live/*.test.mjs"));
  assert.ok(!isUnguardedOfflineTestCommand("node scripts/ci/check-agent-context.mjs"));
});

test("ogni comando di test Node offline documentato passa dal setup della guardia", () => {
  const colpevoli = [];
  for (const file of markdownFiles(ROOT)) {
    readFileSync(file, "utf8").split("\n").forEach((riga, indice) => {
      if (isUnguardedOfflineTestCommand(riga)) colpevoli.push(`${relative(file)}:${indice + 1}: ${riga.trim()}`);
    });
  }
  const scripts = JSON.parse(readFileSync(path.join(ROOT, "package.json"), "utf8")).scripts;
  for (const [nome, comando] of Object.entries(scripts)) {
    if (isUnguardedOfflineTestCommand(comando)) colpevoli.push(`package.json scripts.${nome}: ${comando}`);
  }
  assert.deepEqual(colpevoli, [], `aggiungere --import ./scripts/ci/${SETUP} prima di --test:\n${colpevoli.join("\n")}`);
});
