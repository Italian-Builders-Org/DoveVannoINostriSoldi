import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";
import "./helpers/register-ts-alias.mjs";

const { companyAtlasSourceList, companyAtlasSources } = await import("../src/lib/company-atlas-metadata.ts");
const { createCompanyAtlasObservationIndex } = await import("../src/lib/company-atlas-index.ts");
const snapshot = (await import("../src/data/generated/company-atlas-snapshot.json", { with: { type: "json" } })).default;

test("fonti uses the lightweight company atlas metadata entry point", async () => {
  const pageSource = await readFile(new URL("../src/app/fonti/page.tsx", import.meta.url), "utf8");

  assert.match(pageSource, /@\/lib\/company-atlas-metadata/);
  assert.doesNotMatch(pageSource, /@\/lib\/company-atlas["']/);
  assert.match(pageSource, /@\/lib\/istat-turnover-metadata/);
  assert.doesNotMatch(pageSource, /@\/lib\/istat-turnover["']/);
  assert.deepEqual(companyAtlasSourceList, Object.values(snapshot.sources));
  assert.equal(Object.keys(companyAtlasSources).length, 3);
});

test("observation index matches the generated snapshot across filter shapes", () => {
  const index = createCompanyAtlasObservationIndex(snapshot.observations);
  const cases = [
    ["active_enterprises", "2026-07-31", "all", "all", "all"],
    ["active_enterprises", "2026-07-31", "03", "G", "all"],
    ["employees", "2026-Q2", "03", "all", "all"],
    ["active_local_units", "2026-Q2", "all", "C", "all"],
    ["production_value_band_count", "2025-12-31", "all", "all", "50M_OVER"],
    ["production_value_band_count", "2025-12-31", "03", "C", "NEG"],
  ];

  for (const [metric, period, region, sector, band] of cases) {
    const expected = snapshot.observations.filter((observation) =>
      observation.metric === metric
      && observation.period === period
      && (region === "all" || observation.geographyCode === region)
      && (sector === "all" || observation.sectorCode === sector)
      && (band === "all" || observation.bandCode === band),
    );
    const actual = index.select(metric, period, region, sector, band);
    assert.deepEqual(actual, expected, `${metric}/${period}/${region}/${sector}/${band}`);
    assert.strictEqual(index.select(metric, period, region, sector, band), actual);
    assert.ok(Object.isFrozen(actual));
  }
});

test("multi-metric index selection preserves the dataset contract", () => {
  const index = createCompanyAtlasObservationIndex(snapshot.observations);
  const metrics = ["employees", "active_local_units"];
  const expected = snapshot.observations.filter((observation) =>
    metrics.includes(observation.metric)
    && observation.period === "2026-Q2"
    && observation.geographyCode === "03"
    && observation.sectorCode === "C",
  );

  assert.deepEqual(
    index.selectMany(metrics, "2026-Q2", "03", "C", "all"),
    expected,
  );
});
