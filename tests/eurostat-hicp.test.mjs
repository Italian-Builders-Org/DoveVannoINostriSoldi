import assert from "node:assert/strict";
import test from "node:test";
import "./helpers/register-ts-alias.mjs";

const { eurostatHicpData, eurostatHicpMetadata } = await import("../src/lib/eurostat-hicp-snapshot.ts");
const { validateEurostatHicpData, validateEurostatHicpMetadata } = await import("../src/lib/data/eurostat-hicp-contract.ts");

const DIVISIONS = Array.from({ length: 13 }, (_, index) => `CP${String(index + 1).padStart(2, "0")}`);

test("HICP snapshot keeps complete Italy totals and distinct common periods", () => {
  assert.equal(eurostatHicpData.coverage.expectedCells, 210);
  assert.equal(eurostatHicpData.coverage.observedCells, 210);
  assert.equal(eurostatHicpData.totalObservations.length, 56);
  assert.deepEqual(eurostatHicpData.totalObservations.at(-1), {
    annualRateTenths: 32,
    flags: { annualRateTenths: "e", indexHundredths: "e", monthlyRateTenths: "e" },
    indexHundredths: 10_270,
    monthlyRateTenths: 1,
    period: "2026-08",
  });
  assert.equal(eurostatHicpData.period.comparison, "2026-07");
  assert.equal(eurostatHicpData.period.divisions, "2026-07");
});

test("HICP divisions and weights are complete without invented additive contributions", () => {
  assert.deepEqual(eurostatHicpData.divisions.map((row) => row.code), DIVISIONS);
  assert.deepEqual(eurostatHicpData.divisionObservations.map((row) => row.code), DIVISIONS);
  const housing = eurostatHicpData.divisionObservations.find((row) => row.code === "CP04");
  assert.equal(housing?.annualRateTenths, 72);
  for (const year of [2025, 2026]) {
    const rows = eurostatHicpData.weights.filter((row) => row.year === year);
    assert.equal(rows.length, 13);
    assert.equal(rows.reduce((sum, row) => sum + row.weightHundredthsPerThousand, 0), 100_001);
  }
  assert.match(eurostatHicpData.caveats.join(" "), /non vengono sommate come 'contributi' italiani/i);
});

test("HICP metadata publishes non-monetary semantics and official provenance", () => {
  assert.equal(eurostatHicpMetadata.semantics.soldi.applicable, false);
  assert.equal(eurostatHicpMetadata.semantics.soldi.unit, "non applicabile");
  assert.match(eurostatHicpMetadata.semantics.soldi.nature, /prezzi/i);
  assert.equal(eurostatHicpMetadata.semantics.provenance.license, "CC-BY-4.0");
  assert.equal(eurostatHicpMetadata.source.acquisition.checkedAt, "2026-09-10");
  assert.equal(eurostatHicpMetadata.referencePeriod, "2022-01/2026-08 (totale Italia); 2026-07 (confronto e divisioni); pesi 2025-2026");
  assert.ok(Object.values(eurostatHicpMetadata.source.assets).every((asset) => asset.url.startsWith("https://ec.europa.eu/eurostat/")));
});

test("HICP contract fails closed on missing months, broken weights and fake provenance", () => {
  const missing = structuredClone(eurostatHicpData);
  missing.totalObservations.pop();
  assert.throws(() => validateEurostatHicpData(missing));

  const brokenWeight = structuredClone(eurostatHicpData);
  brokenWeight.weights.at(-1).weightHundredthsPerThousand += 100;
  assert.throws(() => validateEurostatHicpData(brokenWeight), /pesi 2026 non riconciliati/i);

  const fakeSource = structuredClone(eurostatHicpMetadata);
  fakeSource.source.landingUrl = "https://ec.europa.eu/eurostat.example.org/table";
  assert.throws(() => validateEurostatHicpMetadata(fakeSource));
});
