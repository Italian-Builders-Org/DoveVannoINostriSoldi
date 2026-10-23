import assert from "node:assert/strict";
import test from "node:test";
import "./helpers/register-ts-alias.mjs";

const {
  ADE_IMMOBILI_OPEN_DATA_ZIP,
  ADE_IMMOBILI_TABELLE_DATASET,
  ADE_IMMOBILI_UTILIZZO_DATASET,
  buildPrelievoChartSeries,
  getAdeImmobiliAnalysis,
  prelievoMldFromSource,
} = await import("../src/lib/ade-immobili-italia-2026.ts");
const { getAdeImmobiliUtilizzoPage } = await import("../src/lib/ade-immobili-utilizzo-page.ts");
const { getAdeImmobiliTabellePage } = await import("../src/lib/ade-immobili-tabelle-page.ts");
const { getAdeImmobiliTabelleInsights } = await import("../src/lib/ade-immobili-tabelle-insights.ts");
const { getAdeImmobiliHousingInsights } = await import("../src/lib/ade-immobili-utilizzo-insights.ts");

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
  const tasi = series.find((voice) => voice.voice === "TASI di cui");
  assert.ok(tasi);
  assert.equal(tasi.points.find((point) => point.year === 2019)?.mld, 1.2);
  assert.equal(tasi.points.find((point) => point.year === 2024)?.mld, null);
  assert.equal(prelievoMldFromSource("TASI di cui", 2023, "0.0"), null);
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

test("housing insights expose national composition and province AG", async () => {
  const housing = await getAdeImmobiliHousingInsights("AG");
  assert.equal(housing.national.totalHomes, 35581285);
  assert.ok(housing.national.uses.some((use) => use.label === "Abitazione principale" && use.count === 20147097));
  assert.equal(housing.selectedProvince?.territory, "AG");
  assert.equal(housing.selectedProvince?.totalHomes, 332867);
});

test("tabelle insights cover macro areas, 20 regions and ownership", async () => {
  const insights = await getAdeImmobiliTabelleInsights();
  assert.deepEqual(insights.macroAreas.map((area) => area.area), ["Nord", "Centro", "Sud"]);
  assert.equal(insights.macroAreas[0].uses.length, 8);
  assert.deepEqual(
    insights.macroAreas[0].uses.map((use) => use.label),
    [
      "Abitazione principale",
      "Pertinenze",
      "A disposizione",
      "Locati",
      "Uso gratuito",
      "Altri utilizzi",
      "Non ricostruito",
      "Non in dichiarazione",
    ],
  );
  for (const area of insights.macroAreas) {
    const shareSum = area.uses.reduce((sum, use) => sum + use.share, 0);
    assert.ok(Math.abs(shareSum - 1) <= 0.005, `${area.area} share sum ${shareSum}`);
  }
  assert.equal(insights.macroAreas[0].uses.find((use) => use.label === "Pertinenze")?.share, 0.279);
  assert.equal(insights.regions.length, 20);
  assert.equal(insights.regions[0].region, "Lombardia");
  assert.equal(insights.regions[0].residentialMld, 1165.6);
  assert.ok(Math.abs(insights.regions[0].territorialShare - 1165.6 / 6088.5) < 1e-12);
  assert.equal(insights.italyResidentialMld, 6088.5);
  assert.equal(insights.italyResidentialOverGdp, 2.8);
  assert.equal(insights.incomeClasses.length, 5);
  assert.ok(insights.incomeClasses.at(-1).ownershipRate > insights.incomeClasses[0].ownershipRate);
  assert.equal(insights.incomeTypes.length, 4);
  assert.equal(insights.incomeTypes[0].label, "Dipendente");
  assert.equal(insights.incomeTypes.find((row) => row.label === "Fabbricati")?.meanVsm, 385049);
});
