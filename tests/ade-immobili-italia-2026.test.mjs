import assert from "node:assert/strict";
import test from "node:test";
import "./helpers/register-ts-alias.mjs";

const {
  ADE_IMMOBILI_OPEN_DATA_ZIP,
  ADE_IMMOBILI_TABELLE_DATASET,
  ADE_IMMOBILI_UTILIZZO_DATASET,
  buildPrelievoChartSeries,
  getAdeImmobiliAnalysis,
  getAdeImmobiliTabellePage,
  getAdeImmobiliUtilizzoPage,
} = await import("../src/lib/ade-immobili-italia-2026.ts");

test("analysis snapshot pins IMU 2024 and open data URL", () => {
  const analysis = getAdeImmobiliAnalysis();
  assert.equal(analysis.hero.imuGettito2024Mld, "20.98");
  assert.equal(analysis.coverage.taxYear, 2023);
  assert.equal(analysis.coverage.utilizzoProvinciaRows, 16632);
  assert.equal(analysis.sources.openDataZipUrl, ADE_IMMOBILI_OPEN_DATA_ZIP);
  assert.equal(analysis.coverage.tablesMissingViaApi.length, 14);
  const series = buildPrelievoChartSeries(analysis);
  const imu = series.find((voice) => voice.voice === "IMU di cui");
  assert.ok(imu);
  assert.equal(imu.points.at(-1)?.year, 2024);
  assert.equal(imu.points.at(-1)?.mld, 20.98);
});

test("utilizzo pagination covers filtered AG rows end to end", async () => {
  let cursor;
  let seen = 0;
  let matched;
  for (;;) {
    const page = await getAdeImmobiliUtilizzoPage({ provincia: "AG", cursor });
    matched = page.matchedRows;
    seen += page.rows.length;
    assert.ok(page.rows.every((row) => row.provincia === "AG"));
    assert.ok(page.rows.every((row) => row.sourceUrl === ADE_IMMOBILI_OPEN_DATA_ZIP));
    cursor = page.pagination.nextCursor;
    if (!cursor) break;
  }
  assert.equal(seen, matched);
  assert.ok(matched > 25);
});

test("tabelle pagination exhausts prelievo table filter", async () => {
  let cursor;
  let seen = 0;
  let matched;
  for (;;) {
    const page = await getAdeImmobiliTabellePage({ tabella: "2026_04_01_05", cursor });
    matched = page.matchedRows;
    seen += page.rows.length;
    assert.ok(page.rows.every((row) => row.tableId === "2026_04_01_05"));
    cursor = page.pagination.nextCursor;
    if (!cursor) break;
  }
  assert.equal(seen, matched);
  assert.ok(matched > 0);
});

test("integrated datasets remain queryable with expected row counts", async () => {
  const utilizzo = await getAdeImmobiliUtilizzoPage({});
  assert.equal(utilizzo.dataset.publicRows, 16632);
  assert.equal(utilizzo.dataset.id, ADE_IMMOBILI_UTILIZZO_DATASET);
  const tabelle = await getAdeImmobiliTabellePage({});
  assert.equal(tabelle.dataset.publicRows, 3033);
  assert.equal(tabelle.dataset.id, ADE_IMMOBILI_TABELLE_DATASET);
});
