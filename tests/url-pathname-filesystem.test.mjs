import assert from "node:assert/strict";
import { readdirSync, readFileSync } from "node:fs";
import path from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";

// Il pathname di un URL costruito a partire dal modulo, usato come percorso di filesystem, vale
// /C:/Users/... su Windows: path.resolve lo attacca all'unita' corrente e produce
// C:\C:\Users\..., con un ENOENT che non somiglia alla causa. Su Linux funziona,
// quindi nessun test in CI se ne accorge. La forma giusta e' fileURLToPath(url).
// Il riconoscitore e' costruito a pezzi perche' questo file non trovi se stesso.
const PATHNAME_OF_MODULE_URL = new RegExp(["import", "meta", "url\\)"].join("\\.") + "\\.pathname");
// Stesso difetto quando l'URL di modulo arriva da una variabile e il pathname diventa un'opzione `path`.
const PATHNAME_AS_PATH_OPTION = new RegExp(["path:\\s*new URL\\([^)]*\\)", "pathname"].join("\\."));
const BROKEN = (line) => PATHNAME_OF_MODULE_URL.test(line) || PATHNAME_AS_PATH_OPTION.test(line);
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

test("il riconoscitore distingue la forma rotta da quella portabile", () => {
  // Una guardia che non riconosce il difetto passerebbe sempre: la provo prima sui casi veri.
  const rotta = ["const ROOT = path.resolve(new URL(\"../..\", import", "meta", "url).pathname);"];
  assert.ok(BROKEN(rotta[0] + "." + rotta[1] + "." + rotta[2]));
  assert.ok(BROKEN(["await page.screenshot({ path: new URL(`a.png`, evidence)", "pathname });"].join(".")));
  assert.ok(!BROKEN("const ROOT = fileURLToPath(new URL(\"../..\", import.meta.url));"));
  assert.ok(!BROKEN("await page.screenshot({ path: fileURLToPath(new URL(`a.png`, evidence)) });"));
  assert.ok(!BROKEN("assert.equal(endpoint.pathname, \"/api/mcp\");"));
  assert.ok(!BROKEN("if (new URL(requestUrl).pathname === \"/api/location\") return;"));
});

test("nessun modulo ricava un percorso di filesystem dal pathname di un URL di modulo", () => {
  const colpevoli = [];
  for (const cartella of SCANNED) {
    for (const file of sourceFiles(path.join(ROOT, cartella))) {
      readFileSync(file, "utf8").split("\n").forEach((riga, indice) => {
        if (BROKEN(riga)) {
          colpevoli.push(`${path.relative(ROOT, file).split(path.sep).join("/")}:${indice + 1}: ${riga.trim()}`);
        }
      });
    }
  }
  assert.deepEqual(colpevoli, [], `usare fileURLToPath(url) invece di url.pathname:\n${colpevoli.join("\n")}`);
});
