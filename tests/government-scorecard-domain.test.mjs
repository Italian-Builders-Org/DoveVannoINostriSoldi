import assert from "node:assert/strict";
import test from "node:test";
import "./helpers/register-ts-alias.mjs";

const { getGovernmentScorecardView } = await import("../src/lib/government-scorecard.ts");
const view = getGovernmentScorecardView();

function close(actual, expected, tolerance = 0.11) {
  assert.ok(Math.abs(actual - expected) <= tolerance, `${actual} differs from ${expected}`);
}

test("current score reconciles six indicators, five categories and the 50/50 split", () => {
  const calculation = view.current.calculation;
  assert.equal(calculation.status, "scored");
  assert.equal(calculation.baselineYear, 2022);
  assert.equal(calculation.endYear, view.sources.ameco.observedThrough);
  assert.equal(calculation.indicators.length, 6);
  assert.equal(calculation.categories.length, 5);
  const weighted = calculation.indicators.reduce((sum, item) => sum + item.score * item.weightBasisPoints / 10_000, 0);
  close(calculation.score, weighted);
  close(calculation.score, (calculation.observedScore + calculation.relativeScore) / 2);
  close(calculation.score - 50, calculation.indicators.reduce((sum, item) => sum + item.contributionPoints, 0), 0.2);
  for (const indicator of calculation.indicators) {
    assert.ok(indicator.score >= 0 && indicator.score <= 100);
    close(indicator.score, (indicator.historicalScore + indicator.relativeScore) / 2);
    const eligibleWindows = [];
    for (let start = view.method.firstScoreYear; start + calculation.windowYears <= view.sources.ameco.observedThrough; start += 1) {
      const finish = start + calculation.windowYears;
      if (!(start < calculation.endYear && finish > calculation.baselineYear)) eligibleWindows.push(start);
    }
    assert.equal(indicator.historicalWindowCount, eligibleWindows.length, "overlapping target years must not score themselves");
    assert.equal(indicator.series.length, calculation.windowYears + 1);
    assert.equal(indicator.series[0].year, calculation.baselineYear);
    assert.equal(indicator.series.at(-1).year, calculation.endYear);
  }
});

test("forecast is a separate AMECO scenario through 2027", () => {
  const observed = view.current.calculation;
  const forecast = view.current.forecast;
  assert.equal(observed.status, "scored");
  assert.equal(forecast.status, "scored");
  assert.equal(observed.endYear, 2024);
  assert.equal(forecast.endYear, 2027);
  assert.equal(forecast.baselineYear, observed.baselineYear);
  assert.ok(forecast.windowYears > observed.windowYears);
  assert.equal(view.sources.ameco.forecastFrom, observed.endYear + 1);
  assert.deepEqual(view.forecastCoverage, {
    status: "complete",
    fromYear: 2025,
    throughYear: 2027,
    availableCells: 72,
    requiredCells: 72,
  });
});

test("pre-2005 governments are included when the same Core is complete", () => {
  const prodi = view.governments.find((government) => government.id === "prodi-i");
  const berlusconi = view.governments.find((government) => government.id === "berlusconi-ii");
  const dini = view.governments.find((government) => government.id === "dini-i");
  assert.equal(prodi.calculation.status, "scored");
  assert.equal(berlusconi.calculation.status, "scored");
  assert.equal(dini.calculation.status, "not-scored");
  assert.match(dini.calculation.reason, /1995/);
  assert.ok(view.historicalContexts.some((item) => item.id === "first-oil-shock"));
});

test("annual endpoint approximation is explicit at the January-June and July-December boundaries", () => {
  const expected = {
    "dini-i": [1994, 1995],
    "prodi-i": [1995, 1998],
    "dalema-ii": [1999, 1999],
    "amato-ii": [1999, 2000],
    "berlusconi-ii": [2000, 2004],
    "meloni-i": [2022, 2024],
  };
  for (const [governmentId, [baselineYear, endYear]] of Object.entries(expected)) {
    const government = view.governments.find((item) => item.id === governmentId);
    assert.equal(government.calculation.baselineYear, baselineYear, `${governmentId} baseline`);
    assert.equal(government.calculation.endYear, endYear, `${governmentId} endpoint`);
  }
  assert.match(view.method.endpointRule, /Semestral approximation/);
  assert.match(view.method.endpointRule, /does not provide daily precision/);
});

test("one-year annual windows are indicative while zero-year windows fail closed", () => {
  const notScored = view.governments.filter((government) => government.calculation.status === "not-scored");
  assert.ok(notScored.length > 0);
  const oneYear = view.governments.filter((government) => government.calculation.status === "scored" && government.calculation.windowYears === 1);
  assert.ok(oneYear.length > 0);
  assert.ok(oneYear.every((government) => government.comparability.grade === "C"));
  assert.ok(view.governments.every((government) => !("rank" in government)));
});

test("measures and shocks are contextual evidence and never score inputs", () => {
  assert.ok(view.current.measures.length >= 4);
  assert.ok(view.current.contexts.some((item) => item.id === "recovery-plan"));
  assert.equal(view.current.comparability.grade, "C");
  assert.equal(view.current.attribution.status, "not-estimated");
  assert.match(view.current.attribution.reason, /non identifica.*causale/i);
  const indicatorKeys = Object.keys(view.current.calculation.indicators[0]);
  assert.ok(!indicatorKeys.includes("measures"));
  assert.ok(!indicatorKeys.includes("contexts"));
});

test("every published result exposes deterministic stress tests", () => {
  const scored = view.governments.filter((government) => government.calculation.status === "scored");
  assert.ok(scored.length > 0);
  for (const government of scored) {
    const { calculation } = government;
    assert.equal(calculation.robustness.checks.length, 10);
    assert.ok(calculation.robustness.minimumScore <= calculation.score);
    assert.ok(calculation.robustness.maximumScore >= calculation.score);
    assert.ok(calculation.robustness.maximumDeviation >= 0);
    assert.ok(["stabile", "sensibile", "molto sensibile"].includes(calculation.robustness.label));
    assert.ok(calculation.robustness.checks.every((check) => Number.isFinite(check.score) && check.score >= 0 && check.score <= 100));
    assert.ok(calculation.robustness.checks.some((check) => check.id === "equal-weights"));
    assert.equal(calculation.robustness.checks.filter((check) => check.id.startsWith("without-indicator-")).length, 6);
    assert.equal(calculation.robustness.checks.filter((check) => check.id.startsWith("without-peer-")).length, 3);
  }

  const current = view.current.calculation;
  assert.equal(current.status, "scored");
  const equalWeights = current.robustness.checks.find((check) => check.id === "equal-weights");
  close(equalWeights.score, current.indicators.reduce((sum, indicator) => sum + indicator.score, 0) / current.indicators.length);
  const excluded = current.indicators[0];
  const withoutExcluded = current.robustness.checks.find((check) => check.id === `without-indicator-${excluded.id}`);
  const remaining = current.indicators.filter((indicator) => indicator.id !== excluded.id);
  close(withoutExcluded.score, remaining.reduce((sum, indicator) => sum + indicator.score * indicator.weightBasisPoints, 0) / remaining.reduce((sum, indicator) => sum + indicator.weightBasisPoints, 0));
});

test("every government has a sourced dossier of inheritance, context and measures", () => {
  assert.ok(view.governments.every((government) => government.measures.length > 0));
  assert.ok(view.governments.every((government) => government.contexts.length > 0));
  assert.ok(view.governments.every((government) => government.inheritance.indicators.length > 0));
  assert.equal(view.governments[0].inheritance.previousGovernment, null);
  assert.equal(view.governments.at(-1).inheritance.previousGovernment.id, "draghi-i");
  assert.equal(view.governments.at(-2).successorGovernment.id, "meloni-i");
  for (const government of view.governments) {
    assert.ok(government.measures.every((measure) => measure.sourceUrl.startsWith("https://")));
  }
});
