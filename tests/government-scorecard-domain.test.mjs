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

test("short annual windows fail closed and rankings include scored governments only", () => {
  const notScored = view.governments.filter((government) => government.calculation.status === "not-scored");
  assert.ok(notScored.length > 0);
  assert.ok(notScored.every((government) => government.rank === null));
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

test("every scored government has at least one sourced economic measure", () => {
  const scored = view.governments.filter((government) => government.calculation.status === "scored");
  assert.ok(scored.length > 0);
  assert.ok(scored.every((government) => government.measures.length > 0));
  for (const government of scored) {
    assert.ok(government.measures.every((measure) => measure.sourceUrl.startsWith("https://")));
  }
});
