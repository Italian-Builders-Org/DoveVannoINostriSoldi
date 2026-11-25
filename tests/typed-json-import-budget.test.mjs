import assert from "node:assert/strict";
import { existsSync, readFileSync, readdirSync, statSync } from "node:fs";
import { dirname, join, relative, resolve } from "node:path";
import test from "node:test";

/*
 * `tsc` infers a literal type for every row of a JSON module imported from
 * TypeScript. On 2026-11-25 such imports (67.6 MiB of JSON) pushed the full
 * typecheck to ~4.2 GB, at Node's default heap limit on GitHub runners, and a
 * PR adding ~32k types crashed `ci:static` and `next build`. Large snapshots are
 * read at runtime with `readJsonSnapshot` and a literal path instead.
 *
 * Raise a limit only with a fresh `tsc --extendedDiagnostics` measurement in
 * the PR: "Memory used" must stay well below 4096 MB.
 */
const MAX_FILE_BYTES = 768 * 1024;
const MAX_TOTAL_BYTES = 10 * 1024 * 1024;

const root = process.cwd();
const IMPORT_JSON = /^\s*import\s+(?!type\b)[^;]*?\bfrom\s+["']([^"']+\.json)["']/gm;

function sourceFiles(directory) {
  return readdirSync(directory, { withFileTypes: true }).flatMap((entry) => {
    const path = join(directory, entry.name);
    if (entry.isDirectory()) return sourceFiles(path);
    return /\.(?:ts|tsx|mts|cts)$/.test(entry.name) && !entry.name.endsWith(".d.ts") ? [path] : [];
  });
}

export function typedJsonImports(sourceRoot = join(root, "src")) {
  const imports = new Map();
  for (const file of sourceFiles(sourceRoot)) {
    for (const match of readFileSync(file, "utf8").matchAll(IMPORT_JSON)) {
      const specifier = match[1];
      const target = specifier.startsWith("@/")
        ? join(root, "src", specifier.slice(2))
        : specifier.startsWith(".") ? resolve(dirname(file), specifier) : null;
      if (!target) continue;
      assert.ok(existsSync(target), `${relative(root, file)} imports missing ${specifier}`);
      const key = relative(root, target);
      const entry = imports.get(key) ?? { bytes: statSync(target).size, importers: [] };
      entry.importers.push(relative(root, file));
      imports.set(key, entry);
    }
  }
  return imports;
}

test("TypeScript modules do not import large JSON snapshots as typed modules", () => {
  const imports = typedJsonImports();
  assert.ok(imports.size > 0, "the scan must find the small JSON imports that remain");
  const oversized = [...imports]
    .filter(([, { bytes }]) => bytes > MAX_FILE_BYTES)
    .map(([file, { bytes, importers }]) => `${file} (${Math.round(bytes / 1024)} KiB) <- ${importers.join(", ")}`);
  assert.deepEqual(oversized, [], "read these snapshots with readJsonSnapshot and a literal path");
  const total = [...imports.values()].reduce((sum, { bytes }) => sum + bytes, 0);
  assert.ok(
    total <= MAX_TOTAL_BYTES,
    `typed JSON imports total ${(total / 1048576).toFixed(1)} MiB, budget ${MAX_TOTAL_BYTES / 1048576} MiB`,
  );
});
