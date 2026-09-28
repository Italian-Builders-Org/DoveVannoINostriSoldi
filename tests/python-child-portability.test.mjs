import assert from "node:assert/strict";
import { readdirSync, readFileSync } from "node:fs";
import path from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";

// I processi Python lanciati da Node devono girare anche su Windows, ma la CI gira su Linux e non
// se ne accorge. Due forme rompono Windows: un PYTHONPATH scritto con ":" (Windows separa con ";",
// quindi i moduli ETL non si trovano) e un interprete fisso "python3" che ignora PYTHON.
// I riconoscitori sono costruiti a pezzi perché questo file non trovi se stesso.
const POSIX_PYTHONPATH = new RegExp(["PYTHON", "PATH[\"']?\\s*:\\s*[\"'][^\"']*:[^\"']*[\"']"].join(""));
const FIXED_PYTHON3 = new RegExp(["\\b(?:execFileSync|execFile|spawnSync|spawn)\\(\\s*[\"']python", "3[\"']"].join(""));
const BROKEN = (line) => POSIX_PYTHONPATH.test(line) || FIXED_PYTHON3.test(line);
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

test("il riconoscitore distingue le forme rotte da quelle portabili", () => {
  const variable = ["PYTHON", "PATH"].join("");
  assert.ok(BROKEN(`env: { ...process.env, ${variable}: "scripts/etl:scripts/ci" },`));
  assert.ok(BROKEN(["execFileSync(\"python", "3\", [\"scripts/ci/x.py\"]);"].join("")));
  assert.ok(!BROKEN(`env: { ...process.env, ${variable}: ["scripts/etl", "scripts/ci"].join(path.delimiter) },`));
  assert.ok(!BROKEN("execFileSync(process.env.PYTHON || \"python3\", [\"scripts/ci/x.py\"]);"));
  assert.ok(!BROKEN("command: \"python3 scripts/etl/istat_pensions_snapshot.py --check\","));
});

test("nessun processo Python lanciato da Node dipende dalla sintassi POSIX", () => {
  const colpevoli = [];
  for (const cartella of SCANNED) {
    for (const file of sourceFiles(path.join(ROOT, cartella))) {
      readFileSync(file, "utf8").split("\n").forEach((riga, indice) => {
        if (BROKEN(riga)) colpevoli.push(`${path.relative(ROOT, file).split(path.sep).join("/")}:${indice + 1}: ${riga.trim()}`);
      });
    }
  }
  assert.deepEqual(colpevoli, [], `usare path.delimiter e process.env.PYTHON:\n${colpevoli.join("\n")}`);
});
