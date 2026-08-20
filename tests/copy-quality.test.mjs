import assert from "node:assert/strict";
import { readdir, readFile } from "node:fs/promises";
import { extname, join } from "node:path";
import test from "node:test";

const root = new URL("..", import.meta.url);
const uiRoots = ["src/app", "src/components"];

async function filesBelow(relativePath) {
  const absolutePath = new URL(`${relativePath}/`, root);
  const entries = await readdir(absolutePath, { withFileTypes: true });
  const files = [];
  for (const entry of entries) {
    const child = join(relativePath, entry.name);
    if (entry.isDirectory()) files.push(...await filesBelow(child));
    if (entry.isFile() && extname(entry.name) === ".tsx") files.push(child);
  }
  return files;
}

test("public copy avoids old branding, dash separators and known filler phrases", async () => {
  const files = ["README.md", ...(await Promise.all(uiRoots.map(filesBelow))).flat()];
  const forbidden = [
    /Trasparenza ?Italia/i,
    /trasparenzaitalia/i,
    /—|–/,
    /Sei numeri, sei significati diversi/i,
    /La dashboard principale resta valida/i,
  ];

  for (const file of files) {
    const content = await readFile(new URL(file, root), "utf8");
    for (const pattern of forbidden) {
      assert.doesNotMatch(content, pattern, `${file} contiene ${pattern}`);
    }
  }
});
