import assert from "node:assert/strict";
import test from "node:test";
import "./helpers/register-ts-alias.mjs";

const { assertPatrimonialeSnapshot, scenarioTable, variantTable, pctOfGdp } = await import("../src/lib/patrimoniale.ts");

function cell(thresholdK, ratePct, baseBn, erosionPct = 0, extra = {}) {
  return { kind: "scenario", thresholdK, ratePct, erosionPct, households: 1000, baseBn, revenueBn: Math.round(baseBn * (1 - erosionPct / 100) * ratePct) / 100, ...extra };
}

function band(group, householdsPct, wealthBn, thresholdK) {
  return { group, label: group, householdsPct, wealthBn, perHouseholdK: 1, thresholdK };
}

function snapshot() {
  return {
    schemaVersion: 1,
    datasetId: "patrimoniale",
    version: "2026.1",
    observedAt: "2026-11-28",
    gdp2025Mn: 2258048.7,
    distribution: {
      period: "2026-Q2", totalBn: 1000, households: 25.057, meanK: 462.57, medianK: 181.8, top10Pct: 60.63, top5Pct: 50.29, bottom50Pct: 7.22, gini: 72.24,
      bands: [band("Q1", 20, 10, null), band("Q2", 20, 40, 26), band("Q3", 20, 90, 131), band("Q4", 20, 160, 238), band("D9", 10, 100, 473), band("D10", 10, 600, 785)],
    },
    composition: {
      all: { group: "_Z", items: [{ id: "NUN", label: "Abitazioni", valueBn: 600 }, { id: "F2M", label: "Depositi", valueBn: 450 }], assetsBn: 1050, debtsBn: 50, netBn: 1000 },
      top10: { group: "D10", items: [{ id: "NUN", label: "Abitazioni", valueBn: 300 }, { id: "F2M", label: "Depositi", valueBn: 320 }], assetsBn: 620, debtsBn: 20, netBn: 600 },
    },
    shareSeries: [{ period: "2010-Q4", top10Pct: 52, top5Pct: 40, bottom50Pct: 8.5, gini: 66 }],
    euroArea: [{ area: "IT", name: "Italia", top10Pct: 60.6, top5Pct: 50.3, bottom50Pct: 7.2, gini: 72.2 }],
    tail: { alpha: 1.3891, thresholdK: 785.07, check: { thresholdK: 1293, modelPct: 49.9, publishedPct: 50.29, gapPts: -0.39 }, levels: [{ thresholdK: 1000, households: 1790378, wealthBn: 6391.5, extrapolated: false }] },
    existingTaxes: [{ id: "bollo", label: "Imposta di bollo", year: 2025, valueMn: 10998, basis: "Competenza", source: "mef", pctGdp: 0.487 }],
    existingContext: { ricottiTotalBn: 23, ricottiBolloBn: 4.5, immobiliTotaleBn: 6090, renditaCatastaleBn: 38.4, ratioVsmVip: 1.93 },
    territory: {
      areas: [{ area: "Nord", meanEuro: 396366, medianEuro: 181500 }, { area: "Totale", meanEuro: 294567, medianEuro: 152051 }],
      regions: [{ region: "Lazio", valueBn: 625.7, mainHomeEuro: 238599.5, ratioMain: 1.73, ratioOther: 1.78 }],
    },
    scenarios: {
      note: "Ipotesi, non previsioni.",
      thresholdsK: [1000, 5000], ratesPct: [0.5, 2], variantRatePct: 1,
      grid: [cell(1000, 0.5, 4601.2), cell(1000, 2, 4601.2), cell(5000, 0.5, 2459.7), cell(5000, 2, 2459.7)],
      variants: [{ id: "piena", label: "Piena", erosionPct: 0 }, { id: "catasto", label: "Catasto", erosionPct: 14.5 }],
      variantGrid: [
        cell(1000, 1, 4601.2, 0, { variant: "piena" }), cell(5000, 1, 2459.7, 0, { variant: "piena" }),
        cell(1000, 1, 4601.2, 14.5, { variant: "catasto" }), cell(5000, 1, 2459.7, 14.5, { variant: "catasto" }),
      ],
      housingSharePct: 30.1, businessSharePct: 33.8,
    },
    proposals: {
      avs: {
        act: "A.C. 3174-bis, emendamento 41.012", group: "AVS", status: "Ammissibile", exemptEuro: 5400000,
        schedule: [{ fromK: 5400, ratePct: 1.7 }, { fromK: 7500, ratePct: 2.1 }, { fromK: 10000, ratePct: 3.5 }],
        mainHomeExemptEuro: 500000, capPctIncome: 60, declarationAboveEuro: 4000000, households: 172015,
        revenue: [{ variant: "piena", kind: "scenario", revenueBn: 75.28 }, { variant: "catasto", kind: "scenario", revenueBn: 64.36 }],
      },
      s2102: { act: "S.2102", title: "Imposta grandi patrimoni", initiative: "Iniziativa popolare", presented: "2026-11-19", status: "Da assegnare" },
    },
    international: {
      ranking: [{ code: "CHE", name: "Svizzera", year: 2024, pctGdp: 1.345 }],
      series: [{ year: 2024, CHE: 1.141, NOR: 0.598, ESP: 0.201, FRA: 0.092, ITA: 0 }],
      local2024: { CHE: 9.41, NOR: 31.1, ESP: 3.2, FRA: 2.67 },
      spain: { revenue2024Euro: 2177649501, declarants2024: 227424, itsgf2023Mn: 623, itsgf2024Mn: 37, exemptEuro: 700000, mainHomeEuro: 300000, topRatePct: 3.5, itsgfAboveEuro: 3000000 },
      switzerland: { thresholdFromChf: 51000 },
      norway: { municipalThresholdNok: 1900000, stateThresholdNok: 21500000, taxpayers2024: 701482 },
      france: { ifi2025Mn: 2332, ifiTaxpayers2025: 193600 },
    },
    sources: [{ id: "bce", label: "DWA", owner: "BCE", url: "https://data.ecb.europa.eu/data/datasets/DWA", license: "Libero" }],
  };
}

test("accepts a coherent snapshot", () => {
  const parsed = assertPatrimonialeSnapshot(snapshot());
  assert.equal(parsed.distribution.top10Pct, 60.63);
  assert.equal(parsed.scenarios.grid.length, 4);
});

test("bands must cover every household once and add up to the total", () => {
  const shares = snapshot();
  shares.distribution.bands[0].householdsPct = 10;
  assert.throws(() => assertPatrimonialeSnapshot(shares), /fasce/u);
  const sums = snapshot();
  sums.distribution.bands[5].wealthBn = 900;
  assert.throws(() => assertPatrimonialeSnapshot(sums), /fasce/u);
});

test("every scenario is a hypothesis and its revenue follows from base, erosion and rate", () => {
  const kind = snapshot();
  kind.scenarios.grid[0].kind = "forecast";
  assert.throws(() => assertPatrimonialeSnapshot(kind), /ipotesi/u);
  const revenue = snapshot();
  revenue.scenarios.variantGrid[2].revenueBn = 46.01;
  assert.throws(() => assertPatrimonialeSnapshot(revenue), /gettito/u);
  const avs = snapshot();
  avs.proposals.avs.revenue[0].kind = "estimate";
  assert.throws(() => assertPatrimonialeSnapshot(avs), /ipotesi/u);
});

test("existing taxes: share of GDP follows from revenue and GDP; sources are https", () => {
  const gdp = snapshot();
  gdp.existingTaxes[0].pctGdp = 4.87;
  assert.throws(() => assertPatrimonialeSnapshot(gdp), /PIL/u);
  const url = snapshot();
  url.sources[0].url = "http://example.com";
  assert.throws(() => assertPatrimonialeSnapshot(url), /https/u);
});

test("the tail model is shown only when it matches the published top 5% share", () => {
  const bad = snapshot();
  bad.tail.check.gapPts = -3.5;
  assert.throws(() => assertPatrimonialeSnapshot(bad), /coda/u);
});

test("scenario and variant tables: one row per threshold", () => {
  const parsed = assertPatrimonialeSnapshot(snapshot());
  const table = scenarioTable(parsed.scenarios);
  assert.deepEqual(table.columns, [0.5, 2]);
  assert.deepEqual(table.rows.map((row) => row.thresholdK), [1000, 5000]);
  assert.deepEqual(table.rows[0].cells.map((c) => c.revenueBn), [23.01, 92.02]);
  const variants = variantTable(parsed.scenarios);
  assert.deepEqual(variants.columns.map((v) => v.id), ["piena", "catasto"]);
  assert.deepEqual(variants.rows[1].cells.map((c) => c.revenueBn), [24.6, 21.03]);
  assert.equal(pctOfGdp(46.01, parsed.gdp2025Mn), 2.04);
});
