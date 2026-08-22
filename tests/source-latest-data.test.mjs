import assert from "node:assert/strict";
import test from "node:test";
import "./helpers/register-ts-alias.mjs";

const { latestDataBySlug } = await import("../src/lib/source-latest-data.ts");
const { SOURCE_IDS } = await import("../src/lib/data/source-policy.ts");
const { publicSources } = await import("../src/lib/sources.ts");

test("annual CPT coverage remains a period instead of an invented date", () => {
  assert.deepEqual(latestDataBySlug.cpt, { kind: "period", label: "2023" });
  assert.notEqual(latestDataBySlug.cpt, null);
  assert.deepEqual(latestDataBySlug.anac, { kind: "period", label: "2025" });
  assert.deepEqual(latestDataBySlug.consulenti, { kind: "period", label: "2026 · parziale" });
  assert.deepEqual(latestDataBySlug.camera, { kind: "period", label: "2026" });
  assert.deepEqual(latestDataBySlug.senato, { kind: "period", label: "2025" });
  assert.deepEqual(latestDataBySlug.pcm, { kind: "period", label: "2024" });
  assert.deepEqual(latestDataBySlug.inps, {
    kind: "period",
    label: "spesa 2025 · territori 2024",
  });
  assert.deepEqual(latestDataBySlug.italiadomani, { kind: "date", value: "2026-06-13" });
});

test("latest-data registry is exhaustive and keeps MEF periods distinct", () => {
  assert.deepEqual(Object.keys(latestDataBySlug).sort(), [...SOURCE_IDS].sort());
  assert.deepEqual(
    publicSources.map((source) => source.slug).sort(),
    [...SOURCE_IDS].sort(),
  );
  assert.deepEqual(latestDataBySlug["mef-irpef"], {
    kind: "period",
    label: "anno d’imposta 2024 · pubblicato 23/04/2026",
  });
});
