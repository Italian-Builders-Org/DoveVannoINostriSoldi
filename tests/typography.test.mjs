import assert from "node:assert/strict";
import { readFile, readdir } from "node:fs/promises";
import { join } from "node:path";
import test from "node:test";

const sourceRoot = new URL("../src/", import.meta.url);
const sourceExtensions = new Set([".css", ".module.css", ".svg", ".ts", ".tsx", ".js", ".jsx"]);

async function listSourceFiles(directory) {
  const entries = await readdir(directory, { withFileTypes: true });
  const files = [];

  for (const entry of entries) {
    const path = join(directory, entry.name);
    if (entry.isDirectory()) {
      files.push(...await listSourceFiles(path));
      continue;
    }

    if (sourceExtensions.has(entry.name.slice(entry.name.indexOf(".")))) files.push(path);
  }

  return files;
}

test("the frontend uses Geist tokens and reserves mono for technical code", async () => {
  const files = await listSourceFiles(sourceRoot.pathname);
  const source = (await Promise.all(files.map((file) => readFile(file, "utf8")))).join("\n");
  const layout = await readFile(new URL("../src/app/layout.tsx", import.meta.url), "utf8");
  const tokens = await readFile(new URL("../src/app/design-system.css", import.meta.url), "utf8");
  const charts = await Promise.all([
    readFile(new URL("../src/components/charts/spending-bar-chart.module.css", import.meta.url), "utf8"),
    readFile(new URL("../src/components/charts/spending-history-chart.module.css", import.meta.url), "utf8"),
  ]);

  assert.match(layout, /import \{ Geist \} from "next\/font\/google"/);
  assert.match(layout, /variable: "--font-geist"/);
  assert.match(tokens, /--font-heading: var\(--font-geist\)/);
  assert.match(tokens, /--font-body: var\(--font-geist\)/);
  assert.doesNotMatch(source, /\b(?:Archivo|Roboto|Helvetica|Arial)\b|fontFamily\s*:/i);
  assert.doesNotMatch(source, /(?:font-family|font)\s*:[^;{}]*(?:ui-monospace|SFMono-Regular|Menlo|monospace)/i);
  assert.match(charts[0], /\.tooltip \.code[\s\S]*font: 650 11px var\(--font-mono\)/);
  assert.match(charts[1], /\.figureHeader b[\s\S]*font-family: var\(--font-body\)/);
});
