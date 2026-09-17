import assert from "node:assert/strict";
import test from "node:test";
import "./helpers/register-ts-alias.mjs";

const {
  formatRegionNotFoundError,
  regionComparisonKey,
  resolveCanonicalRegionName,
  resolveOpenCivitasRegionName,
} = await import("../src/lib/region-query.ts");

test("regionComparisonKey treats spaces and hyphens as equivalent", () => {
  assert.equal(regionComparisonKey("Emilia Romagna"), regionComparisonKey("Emilia-Romagna"));
  assert.equal(regionComparisonKey("Friuli Venezia Giulia"), regionComparisonKey("Friuli-Venezia Giulia"));
});

test("resolveCanonicalRegionName accepts official names, aliases and ISTAT codes", () => {
  assert.equal(resolveCanonicalRegionName("Emilia-Romagna"), "Emilia-Romagna");
  assert.equal(resolveCanonicalRegionName("Emilia Romagna"), "Emilia-Romagna");
  assert.equal(resolveCanonicalRegionName("emilia romagna"), "Emilia-Romagna");
  assert.equal(resolveCanonicalRegionName("08"), "Emilia-Romagna");
  assert.equal(resolveCanonicalRegionName("Trentino Alto Adige"), "Trentino-Alto Adige/Südtirol");
  assert.equal(resolveCanonicalRegionName("Valle d’Aosta"), "Valle d'Aosta/Vallée d'Aoste");
  assert.equal(resolveCanonicalRegionName("Atlantide"), null);
});

test("resolveOpenCivitasRegionName maps to uppercase OpenCivitas labels", () => {
  assert.equal(resolveOpenCivitasRegionName("Emilia Romagna"), "EMILIA-ROMAGNA");
  assert.equal(resolveOpenCivitasRegionName("calabria"), "CALABRIA");
});

test("formatRegionNotFoundError suggests the official region name", () => {
  assert.match(formatRegionNotFoundError("Emilia Romagna"), /Emilia-Romagna/);
  assert.match(formatRegionNotFoundError("Atlantide"), /non trovata/i);
});
