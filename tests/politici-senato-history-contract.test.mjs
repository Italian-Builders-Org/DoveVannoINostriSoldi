import assert from "node:assert/strict";
import test from "node:test";
import "./helpers/register-ts-alias.mjs";

const { parsePoliticiSenatoSnapshot } = await import("../src/lib/data/politici-senato-contract.ts");
const snapshot = (await import("../src/data/generated/politici-senato-xix.json", { with: { type: "json" } })).default;

test("Senate group history has official provenance and dated memberships", () => {
  const parsed = parsePoliticiSenatoSnapshot(snapshot);
  assert.equal(parsed.source.groupHistory.endpointUrl, "https://dati.senato.it/sparql");
  assert.ok(parsed.groupMemberships.length > 0);
  assert.ok(parsed.groupNames.length > 0);
});

test("Senate group history rejects forged source and invalid intervals", () => {
  const forged = structuredClone(snapshot);
  forged.source.groupHistory.endpointUrl = "https://example.com/sparql";
  assert.throws(() => parsePoliticiSenatoSnapshot(forged));

  const invalid = structuredClone(snapshot);
  invalid.groupMemberships[0].endDate = "2022-01-01";
  assert.throws(() => parsePoliticiSenatoSnapshot(invalid), /intervallo storico invalido/u);
});
