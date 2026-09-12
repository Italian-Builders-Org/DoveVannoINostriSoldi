import assert from "node:assert/strict";
import test from "node:test";
import "./helpers/register-ts-alias.mjs";

const { eurostatGdpData, eurostatGdpMetadata } = await import("../src/lib/eurostat-gdp-snapshot.ts");
const {
  validateEurostatGdpData,
  validateEurostatGdpMetadata,
} = await import("../src/lib/data/eurostat-gdp-contract.ts");

test("eurostat GDP snapshot validates and keeps quarterly coverage complete", () => {
  assert.equal(eurostatGdpData.datasetId, "eurostat-gdp");
  assert.equal(eurostatGdpMetadata.datasetId, "eurostat-gdp");
  assert.equal(eurostatGdpData.coverage.expectedCells, eurostatGdpData.coverage.observedCells);
  assert.equal(eurostatGdpData.quarterlyObservations.at(-1)?.period, "2026-Q2");
  assert.equal(eurostatGdpData.annualObservations.at(-1)?.period, "2025");
  assert.doesNotThrow(() => validateEurostatGdpData(eurostatGdpData));
  assert.doesNotThrow(() => validateEurostatGdpMetadata(eurostatGdpMetadata));
});

test("eurostat GDP semantics keep national accounts distinct from public cash", () => {
  assert.equal(eurostatGdpMetadata.semantics.soldi.applicable, true);
  assert.match(eurostatGdpMetadata.semantics.soldi.nature, /SEC 2010/i);
  assert.match(eurostatGdpMetadata.semantics.soldi.note, /SIOPE|stanziamento/i);
  assert.ok(eurostatGdpData.caveats.some((caveat) => /governo/i.test(caveat)));
});
