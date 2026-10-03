import assert from "node:assert/strict";
import { readdirSync, readFileSync } from "node:fs";
import path from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";

// `node --import` vuole uno specifier: un percorso assoluto Windows (`C:\…`) viene rifiutato con
// ERR_UNSUPPORTED_ESM_URL_SCHEME, e la CI su Linux non se ne accorge. Il riconoscitore è costruito
// a pezzi perché questo file non trovi se stesso.
const ABSOLUTE_IMPORT = new RegExp(["[\"']--", "import[\"']\\s*,\\s*(?:path\\.)?(?:resolve|join)\\("].join(""));
const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const SCANNED = ["scripts", "src", "tests"];
const EXTENSIONS = new Set([".mjs", ".js", ".ts", ".tsx"]);

function* sourceFiles(directory) {
  for (const entry of readdirSync(directory, { withFileTypes: true })) {
    if (entry.name === "node_modules" || entry.name.startsWith(".")) continue;
    const full = path.join(directory, entry.name);
    if (entry.isDirectory()) yield* sourceFiles(full);
    else if (EXTENSIONS.has(path.extname(entry.name))) yield full;
  }
}

test("il riconoscitore distingue percorsi assoluti da URL file", () => {
  const flag = ["--", "import"].join("");
  assert.ok(ABSOLUTE_IMPORT.test(`['${flag}', resolve('scripts/ci/node-test-setup.mjs')]`));
  assert.ok(ABSOLUTE_IMPORT.test(`["${flag}", path.join(ROOT, "x.mjs")]`));
  assert.ok(!ABSOLUTE_IMPORT.test(`["${flag}", new URL("./x.mjs", import.meta.url).href]`));
  assert.ok(!ABSOLUTE_IMPORT.test(`["${flag}", "./scripts/ci/node-offline-guard.mjs"]`));
});

test("nessun processo node riceve un percorso assoluto in --import", () => {
  const colpevoli = [];
  for (const cartella of SCANNED) {
    for (const file of sourceFiles(path.join(ROOT, cartella))) {
      readFileSync(file, "utf8").split("\n").forEach((riga, indice) => {
        if (ABSOLUTE_IMPORT.test(riga)) colpevoli.push(`${path.relative(ROOT, file).split(path.sep).join("/")}:${indice + 1}`);
      });
    }
  }
  assert.deepEqual(colpevoli, [], `usare new URL(..., import.meta.url).href:\n${colpevoli.join("\n")}`);
});
