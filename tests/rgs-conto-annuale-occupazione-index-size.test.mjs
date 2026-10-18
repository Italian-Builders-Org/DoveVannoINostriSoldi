import assert from "node:assert/strict";
import { readFileSync, statSync } from "node:fs";
import test from "node:test";

const ROOT = "src/data/generated/rgs-conto-annuale-occupazione-ente-index";

function bytes(path) {
  return statSync(`${ROOT}/${path}`).size;
}

test("occupazione index avoids monolithic index.json and respects byte budgets", () => {
  assert.throws(() => statSync(`${ROOT}/index.json`));
  const meta = JSON.parse(readFileSync(`${ROOT}/meta.json`, "utf8"));
  assert.equal(meta.schemaVersion, 2);
  assert.ok(bytes("summary.json") < 256 * 1024, "summary.json troppo grande per hub/enti");
  assert.ok(bytes("resolve.json") < 1024 * 1024, "resolve.json troppo grande per lookup nomi");
  assert.ok(bytes("search.json") < 2 * 1024 * 1024, "search.json troppo grande per hub");
  assert.ok(bytes("by-code.json") < 4 * 1024 * 1024, "by-code.json fuori budget enti");
  assert.ok(meta.seriesBytes > 20 * 1024 * 1024, "serie shard mancanti");
  assert.equal(meta.summaryBytes, bytes("summary.json"));
  assert.equal(meta.resolveBytes, bytes("resolve.json"));
  assert.equal(meta.byCodeBytes, bytes("by-code.json"));
});
