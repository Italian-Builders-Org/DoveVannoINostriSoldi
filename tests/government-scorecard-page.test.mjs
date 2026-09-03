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

test("every government receives the complete public page contract", () => {
  for (const id of GOVERNMENT_SCORECARD_V6_GOVERNMENT_IDS) {
    const view = getGovernmentScorecardV6View(id);
    assert.deepEqual(view.section_order, GOVERNMENT_SCORECARD_V6_SECTION_ORDER);
    assert.deepEqual(view.section_order, ["charts", "context", "compare", "methodology"]);
    assert.equal(view.causal_disclaimer, GOVERNMENT_SCORECARD_V6_CAUSAL_DISCLAIMER);
    assert.equal(view.charts.status, "ready");
    assert.equal(view.charts.slides.length, 9);
    assert.ok(view.charts.slides.every((slide) => slide.series.map((series) => series.id).join() === "IT,FR,DE,ES"));
    assert.equal(view.context.status, "ready");
    assert.deepEqual(view.context.slides.map((slide) => slide.id), ["overview", "inheritance", "geopolitics_crises", "ecb", "measures", "chronology"]);
    assert.equal(view.compare.options.length, 17);
    assert.ok(view.compare.options.every((option) => option.href === `/governi/${option.id}`));
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
