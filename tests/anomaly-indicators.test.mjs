import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import "./helpers/register-ts-alias.mjs";

const { computeSpendingOutliers, METHODOLOGY_WARNING } = await import("../src/lib/anomaly-indicators.ts");
const { assertOpenCivitasSnapshot } = await import("../src/lib/data/opencivitas-contract.ts");

function municipality(overrides = {}) {
  return {
    istatCode: "000000",
    name: "Comune",
    province: "PR",
    region: "Regione",
    historicalSpendingCents: 100_000,
    standardSpendingCents: 90_000,
    differenceCents: 10_000,
    historicalPerCapitaCents: 100,
    standardPerCapitaCents: 90,
    differencePerCapitaCents: 10,
    differenceBasisPoints: 0,
    serviceDifferenceBasisPoints: null,
    spendingLevel: null,
    serviceLevel: null,
    spendingAssessmentReason: null,
    servicesAssessmentReason: null,
    sourceWarnings: [],
    ...overrides,
  };
}

test("zero-IQR cohorts still flag values outside the collapsed fence", () => {
  const summary = computeSpendingOutliers([
    ...[0, 0, 0, 0].map((value, index) => municipality({
      istatCode: `Z${index}`,
      region: "Regione Zero",
      differencePerCapitaCents: value,
    })),
    municipality({ istatCode: "Z100", region: "Regione Zero", differencePerCapitaCents: 100 }),
  ]);

  assert.equal(summary.outliers.length, 1);
  assert.equal(summary.outliers[0].istatCode, "Z100");
  assert.equal(summary.outliers[0].excessMultiple, null);
  assert.equal(summary.outliers[0].distanceBeyondFenceCents, 100);
  assert.equal(summary.byRegion[0].iqrPerCapitaCents, 0);
});

test("cohorts below the minimum are visible but not counted as evaluated", () => {
  const summary = computeSpendingOutliers(
    [1, 2, 3].map((value, index) => municipality({
      istatCode: `S${index}`,
      region: "Regione Piccola",
      differencePerCapitaCents: value,
    })),
  );

  assert.equal(summary.evaluatedMunicipalities, 0);
  assert.equal(summary.notEvaluatedForSmallCohort, 3);
  assert.equal(summary.byRegion[0].cohortSize, 3);
  assert.equal(summary.byRegion[0].evaluated, 0);
  assert.equal(summary.byRegion[0].minimumReached, false);
});

test("outliers carry an explicitly derived population estimate and sensitivity bands", () => {
  const summary = computeSpendingOutliers([
    ...[100, 105, 95, 110].map((value, index) => municipality({
      istatCode: `P${index}`,
      region: "Regione Popolata",
      historicalSpendingCents: 100_000 * (index + 1),
      standardSpendingCents: 90_000 * (index + 1),
      historicalPerCapitaCents: 100,
      standardPerCapitaCents: 90,
      differenceCents: 10_000 * (index + 1),
      differencePerCapitaCents: value,
    })),
    municipality({
      istatCode: "P999",
      region: "Regione Popolata",
      historicalSpendingCents: 2_000_000,
      standardSpendingCents: 1_800_000,
      historicalPerCapitaCents: 100,
      standardPerCapitaCents: 90,
      differenceCents: 200_000,
      differencePerCapitaCents: 1_000,
    }),
  ]);

  assert.equal(summary.metricVersion, 2);
  assert.equal(summary.populationMethod, "implied-total-divided-by-per-capita");
  assert.ok(summary.outliers.length > 0);
  assert.equal(summary.outliers[0].impliedPopulation, 20_000);
  assert.equal(summary.outliers[0].populationBand, "20.000-o-piu");
  assert.match(summary.populationMethodWarning, /stima implicita/);
  assert.ok(summary.sensitivityByPopulationBand.every((band) => "evaluatedCohorts" in band));
});

test("source warnings exclude only records with unknown or monetary warnings", () => {
  const summary = computeSpendingOutliers([
    ...[100, 105, 95, 110].map((value, index) => municipality({
      istatCode: `W${index}`,
      region: "Regione Warning",
      differencePerCapitaCents: value,
      sourceWarnings: index === 0 ? ["SPESA_STORICA_PROAB: cod_anomalo"] : [],
    })),
  ]);
  assert.equal(summary.excludedForDataQuality, 1);
  assert.equal(summary.evaluatedMunicipalities, 0);
  assert.equal(summary.notEvaluatedForSmallCohort, 3);
  assert.equal(summary.byRegion[0].minimumReached, false);
});

test("committed OpenCivitas snapshot still runs through the derived screen", () => {
  const raw = JSON.parse(readFileSync(new URL("../src/data/generated/opencivitas-2022.json", import.meta.url), "utf8"));
  const snapshot = assertOpenCivitasSnapshot(raw);
  const summary = computeSpendingOutliers(snapshot.municipalities);
  assert.equal(summary.evaluatedMunicipalities + summary.excludedForDataQuality + summary.notEvaluatedForSmallCohort, snapshot.municipalities.length);
  assert.ok(summary.outliers.length > 0);
  assert.equal(summary.byRegion.length, snapshot.coverage.regions);
  assert.equal(summary.methodologyWarning, METHODOLOGY_WARNING);
});
