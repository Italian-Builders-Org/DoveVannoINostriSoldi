import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import "./helpers/register-ts-alias.mjs";

const { publicSources } = await import("../src/lib/sources.ts");
const { DATASET_IDS } = await import("../src/lib/mcp/catalog.ts");
const readme = readFileSync(new URL("../README.md", import.meta.url), "utf8");
const catalog = JSON.parse(readFileSync(new URL("../src/data/generated/integrated/catalog.json", import.meta.url), "utf8"));

// The README repeats three counts that change with every new source or dataset.
test("the README counts match the source registry, the MCP catalog and the integrated catalog", () => {
  const count = (pattern) => {
    const match = pattern.exec(readme);
    assert.ok(match, `frase assente dal README: ${pattern}`);
    return Number(match[1]);
  };
  assert.equal(count(/elenca (\d+) collegamenti ufficiali/), publicSources.length);
  assert.equal(count(/espone (\d+) dataset interrogabili in sola lettura/), DATASET_IDS.length);
  assert.equal(count(/Catalogo integrato \((\d+) dataset/), catalog.datasets.length);
});
