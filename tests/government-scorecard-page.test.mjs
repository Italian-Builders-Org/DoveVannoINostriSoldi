import assert from "node:assert/strict";
import test from "node:test";

import "./helpers/register-ts-alias.mjs";

const {
  getCurrentGovernmentScorecardV6Id,
  getGovernmentScorecardV6View,
  GOVERNMENT_SCORECARD_V6_GOVERNMENT_IDS,
} = await import("../src/lib/government-scorecard-governments.ts");
const {
  GOVERNMENT_SCORECARD_V6_CAUSAL_DISCLAIMER,
  GOVERNMENT_SCORECARD_V6_METHOD_STEPS,
  GOVERNMENT_SCORECARD_V6_SECTION_ORDER,
  presentGovernmentScorecardV6View,
} = await import("../src/lib/government-scorecard-page.ts");
const {
  isGovernmentChartPointInWindow,
} = await import("../src/app/governi/_components/chart-utils.ts");

test("every government receives the complete public page contract", () => {
  for (const id of GOVERNMENT_SCORECARD_V6_GOVERNMENT_IDS) {
    const view = getGovernmentScorecardV6View(id);
    assert.deepEqual(view.section_order, GOVERNMENT_SCORECARD_V6_SECTION_ORDER);
    assert.deepEqual(view.section_order, ["charts", "context", "compare", "methodology"]);
    assert.equal(view.causal_disclaimer, GOVERNMENT_SCORECARD_V6_CAUSAL_DISCLAIMER);
    assert.equal(view.charts.status, "ready");
    assert.equal(view.charts.slides.length, 9);
    assert.ok(view.charts.slides.every((slide) => slide.series.map((series) => series.id).join() === "IT,FR,DE,ES"));
    assert.ok(view.charts.slides.flatMap((slide) => slide.series).flatMap((series) => series.points).every((point) => point.quality_notes === undefined || Array.isArray(point.quality_notes)));
    assert.equal(view.context.status, "ready");
    assert.deepEqual(view.context.slides.map((slide) => slide.id), ["overview", "inheritance", "geopolitics_crises", "ecb", "measures", "chronology"]);
    assert.equal(view.compare.options.length, 17);
    assert.ok(view.compare.options.every((option) => option.href === `/governi/${option.id}`));
    assert.ok(view.compare.options.every((option) => !Object.hasOwn(option, "context") && !Object.hasOwn(option, "chart_windows")));
    assert.ok(view.sources.every((source) => source.url.startsWith("https://")));
    assert.ok(presentGovernmentScorecardV6View(view).headline.length > 0);
  }
});

test("context is documented, source-linked and never changes the score", () => {
  for (const id of GOVERNMENT_SCORECARD_V6_GOVERNMENT_IDS) {
    const view = getGovernmentScorecardV6View(id);
    for (const slide of view.context.slides) {
      assert.equal(slide.score_impact, "none");
      assert.equal(slide.badge, "Contesto · non cambia il voto");
      if (slide.status === "ready") {
        assert.ok(slide.items.length > 0);
        assert.ok(slide.items.every((item) => item.score_impact === "none"));
        assert.ok(slide.items.every((item) => item.sources.every((source) => source.url.startsWith("https://"))));
      } else {
        assert.deepEqual(slide.items, []);
        assert.ok(slide.message.length > 0);
      }
    }
  }
});

test("the current government is discovered from chronology and remains provisional", () => {
  const currentId = getCurrentGovernmentScorecardV6Id();
  const view = getGovernmentScorecardV6View(currentId);
  assert.equal(currentId, "meloni-i");
  assert.equal(view.government.status, "current");
  assert.equal(view.score_state, "scored_provisional");
  assert.equal(view.score.display, 62);
  assert.equal(getGovernmentScorecardV6View("draghi-i").score_state, "scored_final");
  assert.equal(getGovernmentScorecardV6View("dalema-ii").score_state, "not_scored_short");
  assert.equal(getGovernmentScorecardV6View("dini-i").score_state, "not_scored_data");
});

test("chart windows include the latest available point without including a successor's mandate", () => {
  const current = getGovernmentScorecardV6View("meloni-i");
  const historical = getGovernmentScorecardV6View("draghi-i");
  const missing = getGovernmentScorecardV6View("dini-i");
  assert.ok(current.charts.status === "ready");
  assert.ok(historical.charts.status === "ready");
  assert.ok(missing.charts.status === "ready");
  assert.ok(current.charts.slides.every((slide) => slide.mandate_window.end_exclusive === false));
  assert.ok(current.charts.slides.every((slide) => slide.complete_window.end_exclusive === false));
  assert.ok(historical.charts.slides.every((slide) => slide.mandate_window.end_exclusive === true));
  assert.ok(missing.charts.slides.every((slide) => slide.mandate_window.start_date === "1995-01-17"));
  assert.ok(missing.charts.slides.every((slide) => slide.mandate_window.end_date === "1996-05-18"));
  assert.ok(missing.charts.slides.every((slide) => slide.mandate_window.end_exclusive === true));
  const unavailableInflation = missing.charts.slides.find((slide) => slide.indicator_id === "inflation");
  assert.ok(unavailableInflation);
  assert.ok(unavailableInflation.series.every((series) => series.points.every((point) => !isGovernmentChartPointInWindow(
    point.period_start,
    unavailableInflation.mandate_window.start_date,
    unavailableInflation.mandate_window.end_date,
    unavailableInflation.mandate_window.end_exclusive,
    unavailableInflation.frequency,
  ))));
});

test("the current-government charts expose the latest reliable display data without flat one-point plots", () => {
  const current = getGovernmentScorecardV6View("meloni-i");
  assert.ok(current.charts.status === "ready");
  const firstByIndicator = new Map([
    ["inflation", "2022-10"],
    ["real_compensation", "2022"],
    ["unemployment", "2022-10"],
    ["employment_rate", "2022-Q4"],
    ["real_gdp_per_capita", "2022-Q4"],
    ["debt_ratio", "2022-Q4"],
    ["debt_per_capita", "2022"],
    ["primary_balance", "2022-Q4"],
    ["investment_share", "2022-Q4"],
  ]);
  const latestByIndicator = new Map([
    ["inflation", "2026-08"],
    ["unemployment", "2026-07"],
    ["employment_rate", "2026-Q1"],
    ["real_gdp_per_capita", "2026-Q2"],
    ["debt_ratio", "2026-Q1"],
    ["debt_per_capita", "2025"],
    ["primary_balance", "2026-Q1"],
    ["investment_share", "2026-Q2"],
  ]);
  for (const slide of current.charts.slides) {
    const window = slide.mandate_window;
    const visibleCounts = slide.series.map((series) => series.points.filter((point) => isGovernmentChartPointInWindow(
      point.period_start,
      window.start_date,
      window.end_date,
      window.end_exclusive,
      slide.frequency,
    )).length);
    assert.ok(visibleCounts.every((count) => count >= 2), `${slide.indicator_id} should have at least two visible points`);
    const latest = slide.series[0].points.filter((point) => isGovernmentChartPointInWindow(
      point.period_start,
      window.start_date,
      window.end_date,
      window.end_exclusive,
      slide.frequency,
    )).at(-1)?.period;
    const first = slide.series[0].points.find((point) => isGovernmentChartPointInWindow(
      point.period_start,
      window.start_date,
      window.end_date,
      window.end_exclusive,
      slide.frequency,
    ))?.period;
    assert.equal(first, firstByIndicator.get(slide.indicator_id));
    assert.equal(latestByIndicator.get(slide.indicator_id) ?? latest, latest);
  }
});

test("the public explanation is short, progressive and free of verdict language", () => {
  assert.equal(GOVERNMENT_SCORECARD_V6_METHOD_STEPS.length, 5);
  assert.ok(GOVERNMENT_SCORECARD_V6_METHOD_STEPS.every((step) => step.length < 150));
  assert.match(GOVERNMENT_SCORECARD_V6_METHOD_STEPS.at(-1), /50/);
  const publicCopy = JSON.stringify({
    steps: GOVERNMENT_SCORECARD_V6_METHOD_STEPS,
    disclaimer: GOVERNMENT_SCORECARD_V6_CAUSAL_DISCLAIMER,
    compare: getGovernmentScorecardV6View("meloni-i").compare.message,
  });
  assert.doesNotMatch(publicCopy, /ranking|vincitore|classifica/i);
});
