import assert from "node:assert/strict";
import { readdir, readFile } from "node:fs/promises";
import path from "node:path";
import test from "node:test";

const sourceRoot = new URL("../src/", import.meta.url);

async function tsxFiles(directory) {
  const entries = await readdir(directory, { withFileTypes: true });
  const nested = await Promise.all(entries.map(async (entry) => {
    const target = new URL(`${entry.name}${entry.isDirectory() ? "/" : ""}`, directory);
    if (entry.isDirectory()) return tsxFiles(target);
    return entry.name.endsWith(".tsx") ? [target] : [];
  }));
  return nested.flat();
}

test("every native data table has a caption", async () => {
  const missing = [];
  for (const file of await tsxFiles(sourceRoot)) {
    const source = await readFile(file, "utf8");
    const tables = source.match(/<table\b[\s\S]*?<\/table>/g) ?? [];
    tables.forEach((tableMarkup, index) => {
      if (!/<caption\b/.test(tableMarkup)) {
        missing.push(`${path.relative(sourceRoot.pathname, file.pathname)}#${index + 1}`);
      }
    });
  }
  assert.deepEqual(missing, [], `tabelle senza caption: ${missing.join(", ")}`);
});
