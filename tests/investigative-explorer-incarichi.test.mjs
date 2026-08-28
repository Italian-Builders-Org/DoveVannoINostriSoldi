// Contract test for the Investigative Explorer artifact (issue #105).
// Runnable under `node --test`. Reads the generated artifact; if it is not
// present (e.g. before `python scripts/etl/investigative_explorer_build.py`
// ran) the test skips instead of failing.
import { test } from "node:test";
import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";

const ARTIFACT = join(
  process.cwd(),
  "src/data/generated/investigative-explorer-incarichi.json",
);

// Aggregate fingerprint of the transform-v2 source_record_id -> id mapping.
// It proves that the privacy projection did not silently re-key the snapshot,
// without committing the removed source prose or listing any identifiers.
const LEGACY_IDENTITY_SHA256 = "e4fae05130a598294499bdb71a961d24c2c33d4b8a7d3707365bd704d6031b9e";

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
  "references",
];

test("artifact satisfies the published contract", () => {
  if (!existsSync(ARTIFACT)) {
    console.warn(`[skip] artifact assente: ${ARTIFACT}`);
    return;
  }
  const data = JSON.parse(readFileSync(ARTIFACT, "utf8"));
  assert.equal(data.schemaVersion, 1);
  assert.equal(data.transformVersion, 3);
  assert.equal(data.scope, "investigative-explorer-incarichi");
  assert.ok(Array.isArray(data.relations) && data.relations.length > 0);
  assert.equal(data.relationCount, data.relations.length);
  assert.equal(
    data.suspectDuplicates,
    data.relations.filter((rel) => rel.suspect_duplicate).length,
  );

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
    assert.ok(!("note_source" in rel), "non pubblicare testo sorgente libero");
    assert.deepEqual(Object.keys(rel.references).sort(), ["cig", "cup"]);
  }
});

test("ogni arco riporta provenance e caveat", () => {
  if (!existsSync(ARTIFACT)) return;
  const data = JSON.parse(readFileSync(ARTIFACT, "utf8"));
  assert.ok(data.source && typeof data.source === "object");
  assert.ok(data.methodology && typeof data.methodology.caveat === "string");
});

test("ogni arco ha id stabile e univoco (chiave React sicura)", () => {
  if (!existsSync(ARTIFACT)) return;
  const data = JSON.parse(readFileSync(ARTIFACT, "utf8"));
  const ids = new Set();
  for (const rel of data.relations) {
    assert.ok(typeof rel.id === "string" && rel.id.length > 0, "arco senza id");
    assert.ok(!ids.has(rel.id), `id duplicato: ${rel.id}`);
    ids.add(rel.id);
  }
  const identity = data.relations
    .map((rel) => [rel.source_record_id, rel.id])
    .sort((a, b) => a[0].localeCompare(b[0]) || a[1].localeCompare(b[1]));
  const fingerprint = createHash("sha256")
    .update(JSON.stringify(identity))
    .digest("hex");
  assert.equal(fingerprint, LEGACY_IDENTITY_SHA256, "la proiezione privacy non deve cambiare gli id");
});

test("il meta file leggero rispecchia il conteggio senza archi", () => {
  const META = join(
    process.cwd(),
    "src/data/generated/investigative-explorer-incarichi.meta.json",
  );
  if (!existsSync(ARTIFACT) || !existsSync(META)) return;
  const a = JSON.parse(readFileSync(ARTIFACT, "utf8"));
  const meta = JSON.parse(readFileSync(META, "utf8"));
  assert.equal(meta.relationCount, a.relationCount);
  assert.equal(meta.suspectDuplicates ?? 0, a.suspectDuplicates ?? 0);
  assert.ok(!("relations" in meta), "il meta non deve contenere gli archi");
  assert.ok(
    JSON.stringify(meta).length < JSON.stringify(a).length / 50,
    "il meta deve essere molto piu' leggero dell'artifact",
  );
});

test("la search index trova CIG/CUP strutturati (senza full scan)", async () => {
  const { buildSearchIndex, searchExplorer } = await import(
    "../src/lib/investigative-explorer.ts"
  );
  const fixture = [
    {
      id: "a",
      relation_type: "person_has_appointment",
      subject_type: "person",
      subject_key: "MARIO ROSSI",
      object_type: "public_entity",
      object_key: "Comune X",
      source_dataset: "incarichi-nominativi-shard",
      source_record_id: "r1",
      period: "2025",
      acquisition_date: "2026",
      confidence_note: "n",
      role: "dirigente",
      amount: null,
      ipa: "IPAX",
      source_url: null,
      references: { cig: ["A123456789"], cup: [] },
    },
    {
      id: "b",
      relation_type: "person_has_appointment",
      subject_type: "person",
      subject_key: "LUCA BIANCHI",
      object_type: "public_entity",
      object_key: "Comune Y",
      source_dataset: "incarichi-nominativi-shard",
      source_record_id: "r2",
      period: "2025",
      acquisition_date: "2026",
      confidence_note: "n",
      role: null,
      amount: null,
      ipa: null,
      source_url: null,
      references: { cig: [], cup: [] },
    },
  ];
  const idx = buildSearchIndex(fixture);
  const byCig = searchExplorer(idx, "CIG A123456789", 100);
  assert.equal(byCig.length, 1);
  assert.equal(byCig[0].id, "a");
  const byPerson = searchExplorer(idx, "rossi", 100);
  assert.equal(byPerson.length, 1);
  assert.equal(byPerson[0].id, "a");
  const none = searchExplorer(idx, "CIG 000000000", 100);
  assert.equal(none.length, 0);
});

test("la search index esclude i record gemelli di importo", async () => {
  const { buildSearchIndex, searchExplorer } = await import(
    "../src/lib/investigative-explorer.ts"
  );
  const fixture = [
    {
      id: "keep",
      relation_type: "person_has_appointment",
      subject_type: "person",
      subject_key: "D ANGELI DOMENICO",
      object_type: "public_entity",
      object_key: "INPS",
      source_dataset: "incarichi-nominativi-shard",
      source_record_id: "keep",
      period: "2025-06-30",
      acquisition_date: "2026-08-23",
      confidence_note: "n",
      role: "consulente",
      amount: 47040,
      ipa: null,
      source_url: null,
      references: { cig: [], cup: [] },
    },
    {
      id: "inflated",
      relation_type: "person_has_appointment",
      subject_type: "person",
      subject_key: "D ANGELI DOMENICO",
      object_type: "public_entity",
      object_key: "INPS",
      source_dataset: "incarichi-nominativi-shard",
      source_record_id: "inflated",
      period: "2025-06-30",
      acquisition_date: "2026-08-23",
      confidence_note: "n",
      role: "consulente",
      amount: 4704000,
      ipa: null,
      source_url: null,
      references: { cig: [], cup: [] },
      suspect_duplicate: true,
    },
  ];
  const idx = buildSearchIndex(fixture);
  const hits = searchExplorer(idx, "ANGELI", 100);
  assert.equal(hits.length, 1);
  assert.equal(hits[0].id, "keep");
  assert.equal(hits[0].amount, 47040);
});
