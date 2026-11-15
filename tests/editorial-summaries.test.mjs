import assert from "node:assert/strict";
import test from "node:test";
import { execFileSync } from "node:child_process";
import "../scripts/ci/register-source-alias.mjs";

test("cold editorial pages have their summaries even with the SQL corpus unreachable", async () => {
  const previous = process.env.DVNS_DATA_BACKEND;
  process.env.DVNS_DATA_BACKEND = "supabase";
  try {
    const { getAdeImmobiliHousingInsights } = await import("../src/lib/ade-immobili-utilizzo-insights.ts");
    const { getAdeImmobiliTabelleInsights } = await import("../src/lib/ade-immobili-tabelle-insights.ts");
    const { getHospitalBeds } = await import("../src/lib/salute-hospital-beds.ts");
    const [housing, tables, beds] = await Promise.all([
      getAdeImmobiliHousingInsights(" ag "),
      getAdeImmobiliTabelleInsights(),
      getHospitalBeds(),
    ]);
    assert.equal(housing.selectedProvince?.territory, "AG");
    assert.equal((await getAdeImmobiliHousingInsights("ZZ")).selectedProvince, null);
    assert.equal(tables.regions.length, 20);
    assert.equal(beds.regions.reduce((sum, region) => sum + region.total, 0), 212_768);
  } finally {
    if (previous === undefined) delete process.env.DVNS_DATA_BACKEND;
    else process.env.DVNS_DATA_BACKEND = previous;
  }
});

test("editorial snapshots reproduce the complete released aggregates and source metadata", () => {
  execFileSync(process.execPath, ["--experimental-strip-types", "scripts/ci/editorial-summaries.mjs"]);
});

test("the medical-device chart has all four totals even with the archive unreachable", async () => {
  const previous = process.env.DVNS_HEAVY_DATA_BACKEND;
  process.env.DVNS_HEAVY_DATA_BACKEND = "supabase";
  try {
    const { getMedicalDeviceSpendingHistory } = await import("../src/lib/medical-device-editorial.ts");
    const history = getMedicalDeviceSpendingHistory();
    assert.deepEqual(history.map(({ year }) => year), [2018, 2019, 2020, 2021]);
    assert.equal(history.find(({ year }) => year === 2020)?.spending, "5054732845.13");
  } finally {
    if (previous === undefined) delete process.env.DVNS_HEAVY_DATA_BACKEND;
    else process.env.DVNS_HEAVY_DATA_BACKEND = previous;
  }
});

test("the initial medical-device table is available without reading the archive", async () => {
  const { getDefaultMedicalDeviceAggregate } = await import("../src/lib/medical-device-editorial.ts");
  const initial = getDefaultMedicalDeviceAggregate();
  assert.equal(initial.scope.year, 2021);
  assert.equal(initial.scope.region, null);
  assert.equal(initial.scope.company, null);
  assert.equal(initial.dimension, "territory");
  assert.equal(initial.coverage.spending, "5785471036.54");
  assert.ok(initial.rows.length > 0);
});
