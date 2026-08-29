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

test("one-year annual windows are indicative while zero-year windows fail closed", () => {
  const notScored = view.governments.filter((government) => government.calculation.status === "not-scored");
  assert.ok(notScored.length > 0);
  assert.ok(notScored.every((government) => government.rank === null));
  const oneYear = view.governments.filter((government) => government.calculation.status === "scored" && government.calculation.windowYears === 1);
  assert.ok(oneYear.length > 0);
  assert.ok(oneYear.every((government) => government.reliability.grade === "C"));
  const ranked = view.governments.filter((government) => government.rank != null);
  assert.deepEqual([...ranked.map((government) => government.rank)].sort((a, b) => a - b), Array.from({ length: ranked.length }, (_, index) => index + 1));
  assert.ok(ranked.every((government) => government.status === "ended" && government.calculation.status === "scored"));
  assert.equal(view.current.rank, undefined);
  assert.equal(view.governments.find((government) => government.status === "current")?.rank, null);
});

test("measures and shocks are contextual evidence and never score inputs", () => {
  assert.ok(view.current.measures.length >= 4);
  assert.ok(view.current.contexts.some((item) => item.id === "recovery-plan"));
  assert.equal(view.current.reliability.grade, "C");
  assert.match(view.current.reliability.reason, /non.*attribuzione|attribuzione/i);
  const indicatorKeys = Object.keys(view.current.calculation.indicators[0]);
  assert.ok(!indicatorKeys.includes("measures"));
  assert.ok(!indicatorKeys.includes("contexts"));
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
