// Contract test for the Investigative Explorer artifact (issue #105).
// Runnable under `node --test`. Reads the generated artifact; if it is not
// present (e.g. before `python scripts/etl/investigative_explorer_build.py`
// ran) the test skips instead of failing.
import { test } from "node:test";
import assert from "node:assert/strict";
import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";

const ARTIFACT = join(
  process.cwd(),
  "src/data/generated/investigative-explorer-incarichi.json",
);

const REQUIRED = [
  "relation_type",
  "subject_type",
  "subject_key",
  "object_type",
  "object_key",
  "source_dataset",
  "source_record_id",
  "acquisition_date",
  "confidence_note",
];

const EDGE_FIELDS = [
  ...REQUIRED,
  "role",
  "amount",
  "ipa",
  "source_url",
  "note_source",
];

test("artifact satisfies the published contract", () => {
  if (!existsSync(ARTIFACT)) {
    console.warn(`[skip] artifact assente: ${ARTIFACT}`);
    return;
  }
  const data = JSON.parse(readFileSync(ARTIFACT, "utf8"));
  assert.equal(data.schemaVersion, 1);
  assert.equal(data.scope, "investigative-explorer-incarichi");
  assert.ok(Array.isArray(data.relations) && data.relations.length > 0);
  assert.equal(data.relationCount, data.relations.length);

  const seen = new Set();
  for (const rel of data.relations) {
    for (const field of REQUIRED) {
      assert.ok(
        typeof rel[field] === "string" && rel[field].trim().length > 0,
        `relazione senza ${field}`,
      );
    }
    if (rel.amount !== null && rel.amount !== undefined) {
      assert.ok(rel.amount >= 0, "importo negativo non ammesso");
    }
    const key = JSON.stringify(EDGE_FIELDS.map((f) => rel[f]));
    assert.ok(!seen.has(key), "arco duplicato (merge non consentito)");
    seen.add(key);
  }
});

test("ogni arco riporta provenance e caveat", () => {
  if (!existsSync(ARTIFACT)) return;
  const data = JSON.parse(readFileSync(ARTIFACT, "utf8"));
  assert.ok(data.source && typeof data.source === "object");
  assert.ok(data.methodology && typeof data.methodology.caveat === "string");
});
