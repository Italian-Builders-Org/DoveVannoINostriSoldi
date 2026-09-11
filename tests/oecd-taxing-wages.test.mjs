import assert from "node:assert/strict";
import test from "node:test";
import "./helpers/register-ts-alias.mjs";

const { oecdTaxingWagesData, oecdTaxingWagesMetadata } = await import("../src/lib/oecd-taxing-wages-snapshot.ts");
const { getTaxWedgeView } = await import("../src/lib/tax-wedge.ts");

test("OECD Taxing Wages snapshot keeps Italy AW100 coverage and peer comparison", () => {
  assert.equal(oecdTaxingWagesData.italyObservations.length, 26);
  assert.equal(oecdTaxingWagesData.peerObservations.length, 55);
  assert.equal(oecdTaxingWagesData.profile.incomePrincipal, "AW100");
  assert.equal(oecdTaxingWagesMetadata.source.licenseId, "CC-BY-4.0");
  assert.match(oecdTaxingWagesMetadata.source.publication.doi, /10\.1787\/b3a95829-en/);
});

test("tax wedge view exposes the canonical 2025 Italy rate and distinct denominators", () => {
  const view = getTaxWedgeView();
  assert.equal(view.latest.year, 2025);
  assert.ok(Math.abs(view.latest.taxWedge - 45.75739) < 1e-9);
  assert.equal(view.components.length, 3);
  assert.ok(view.components.every((row) => row.sourceCode.startsWith("AV_")));
  assert.equal(view.comparison.length, 5);
  assert.ok(view.comparison.some((row) => row.geo === "ITA"));
  assert.match(view.reconciliationNote, /costo del lavoro/);
});
