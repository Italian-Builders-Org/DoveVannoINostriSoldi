import assert from "node:assert/strict";
import test from "node:test";
import "./helpers/register-ts-alias.mjs";

const { assertExitTaxSnapshot, scenarioTable, emigrationShareHigh } = await import("../src/lib/exit-tax.ts");

function snapshot(overrides = {}) {
  return {
    schemaVersion: 1,
    datasetId: "exit-tax",
    version: "2026.1",
    observedAt: "2026-11-27",
    proposal: {
      act: "A.C. 3174-bis", actTitle: "Disegno di legge di bilancio 2027", actUrl: "https://www.camera.it/leg19/126?idDocumento=3174-bis",
      article: "Art. 17", newArticle: "Art. 307-bis", thresholdEuro: 800000, ratePct: 26, residence: "almeno 6 degli ultimi 10 periodi d'imposta",
      governmentBondsPct: 48.08, paymentDays: 180, advancePct: 50, deferralYearsEu: 5, deferralYearsOther: 10, effectiveFrom: "2027-01-01", status: "In esame",
    },
    governmentEstimate: { inputs: { substituteTax: 6581, shareAboveThreshold: 73.1, emigrationRate: 0.28, potential: 13.47 }, potential: 13.47, annual: 6.74, firstYear: 3.37, refunds: 3.37 },
    corteConti: "disincentivo",
    businessExitTax: { rule: "Art. 166 TUIR", minEuro: 10000, maxEuro: 100000 },
    amendments: { rows: [{ id: "17.1", title: null, outcome: "ammissibile", additionalArticle: false, groups: ["Forza Italia"] }], total: 1, admissible: 1 },
    emigration: {
      series: [{ year: 2024, low: 1, medium: 1, high: 1, total: 3 }, { year: 2025, low: 40000, medium: 30000, high: 39004, total: 109004 }],
      destinationsYear: 2025,
      destinations: [{ country: "Spagna", low: 1, medium: 1, high: 1, total: 3 }],
    },
    wealth: { quarter: "2026-Q2", groups: {}, assetsBn: 3553.5, topDecileAssetsBn: 3217, topDecileSharePct: 90.5, stockAboveThresholdBn: 2597.6 },
    scenarios: {
      ratePct: 26, emigrationPct: [0.02, 0.1], gainSharePct: [20, 50], note: "Ipotesi",
      grid: [
        { kind: "scenario", emigrationPct: 0.02, gainSharePct: 20, leavingStockBn: 0.52, gainsBn: 0.104, taxMn: 27, advanceMn: 13.5 },
        { kind: "scenario", emigrationPct: 0.02, gainSharePct: 50, leavingStockBn: 0.52, gainsBn: 0.26, taxMn: 67.5, advanceMn: 33.8 },
        { kind: "scenario", emigrationPct: 0.1, gainSharePct: 20, leavingStockBn: 2.598, gainsBn: 0.52, taxMn: 135.1, advanceMn: 67.5 },
        { kind: "scenario", emigrationPct: 0.1, gainSharePct: 50, leavingStockBn: 2.598, gainsBn: 1.299, taxMn: 337.7, advanceMn: 168.8 },
      ],
    },
    international: [{ country: "Francia", rule: "Art. 167 bis CGI", who: "x", rate: "30%", deferral: "x", revenue: "x", sourceUrls: ["https://www.senat.fr/x"] }],
    sources: [{ id: "camera", label: "Camera", owner: "Camera", url: "https://www.camera.it/", license: "Atto pubblico" }],
    ...overrides,
  };
}

test("accepts a coherent snapshot", () => {
  const parsed = assertExitTaxSnapshot(snapshot());
  assert.equal(parsed.proposal.thresholdEuro, 800000);
  assert.equal(parsed.governmentEstimate.annual, 6.74);
});

test("the government estimate must follow from its own inputs", () => {
  const bad = snapshot();
  bad.governmentEstimate.potential = 20;
  assert.throws(() => assertExitTaxSnapshot(bad), /stima del Governo/u);
});

test("every scenario is a hypothesis and its tax follows from its parameters", () => {
  const notScenario = snapshot();
  notScenario.scenarios.grid[0].kind = "forecast";
  assert.throws(() => assertExitTaxSnapshot(notScenario), /scenario/u);
  const wrongTax = snapshot();
  wrongTax.scenarios.grid[3].taxMn = 10;
  assert.throws(() => assertExitTaxSnapshot(wrongTax), /scenario/u);
});

test("emigration rows must add up and international rows must cite an https source", () => {
  const sums = snapshot();
  sums.emigration.series[1].total = 1;
  assert.throws(() => assertExitTaxSnapshot(sums), /espatri/u);
  const url = snapshot();
  url.international[0].sourceUrls = ["http://example.com"];
  assert.throws(() => assertExitTaxSnapshot(url), /fonte/u);
});

test("scenario table: one row per emigration rate, one column per gain share", () => {
  const table = scenarioTable(assertExitTaxSnapshot(snapshot()).scenarios);
  assert.deepEqual(table.columns, [20, 50]);
  assert.deepEqual(table.rows.map((row) => row.emigrationPct), [0.02, 0.1]);
  assert.deepEqual(table.rows[1].cells.map((cell) => cell.taxMn), [135.1, 337.7]);
});

test("share of graduates among the Italians who leave", () => {
  assert.equal(emigrationShareHigh({ year: 2025, low: 40000, medium: 30000, high: 39004, total: 109004 }), 35.8);
});
