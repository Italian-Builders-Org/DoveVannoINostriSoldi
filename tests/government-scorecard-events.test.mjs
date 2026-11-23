import assert from "node:assert/strict";
import test from "node:test";

import "./helpers/register-ts-alias.mjs";

const { getGovernmentScorecardV6SupplementalSnapshot } = await import("../src/lib/data/government-scorecard-page-contract.ts");
const {
  GOVERNMENT_SCORECARD_CHART_EVENT_REFS,
  resolveGovernmentScorecardChartEvents,
} = await import("../src/lib/government-scorecard-events.ts");
const { getGovernmentChartEventSpans } = await import("../src/app/governi/_components/chart-utils.ts");
const { getGovernmentScorecardV6View, GOVERNMENT_SCORECARD_V6_GOVERNMENT_IDS } = await import("../src/lib/government-scorecard-governments.ts");

const snapshot = getGovernmentScorecardV6SupplementalSnapshot();

test("chart events come verbatim from the frozen, sourced context items", () => {
  const events = resolveGovernmentScorecardChartEvents(snapshot);
  assert.equal(events.length, GOVERNMENT_SCORECARD_CHART_EVENT_REFS.length);
  const items = new Map(snapshot.contexts.flatMap((context) => context.slides.flatMap((slide) => slide.items))
    .map((item) => [item.id, item]));
  events.forEach((event, index) => {
    const ref = GOVERNMENT_SCORECARD_CHART_EVENT_REFS[index];
    const item = items.get(ref.item_id);
    assert.ok(item, `${ref.item_id} assente`);
    assert.equal(event.number, index + 1);
    assert.equal(event.title, item.title);
    assert.equal(event.summary, item.summary);
    assert.equal(event.start_date, item.start_date);
    assert.equal(event.end_date, item.end_date_or_null);
    assert.deepEqual(event.sources, item.sources.map((source) => ({ owner: source.owner, url: source.url })));
    assert.ok(event.sources.length > 0 && event.sources.every((source) => source.url.startsWith("https://")));
  });
  const starts = events.map((event) => event.start_date);
  assert.deepEqual(starts, starts.toSorted(), "eventi non in ordine cronologico");
  assert.equal(new Set(events.map((event) => event.id)).size, events.length);
});

test("chart events fail closed when an item is missing or its copies disagree", () => {
  const withoutCrisis = structuredClone(snapshot);
  for (const context of withoutCrisis.contexts) {
    for (const slide of context.slides) {
      slide.items = slide.items.filter((item) => !item.id.endsWith(":global-financial-crisis"));
    }
  }
  assert.throws(() => resolveGovernmentScorecardChartEvents(withoutCrisis), /global-financial-crisis/);

  const divergent = structuredClone(snapshot);
  const copy = divergent.contexts.flatMap((context) => context.slides.flatMap((slide) => slide.items))
    .find((item) => item.id === "prodi-ii:global-financial-crisis");
  assert.ok(copy);
  copy.end_date_or_null = "2010-12-31";
  assert.throws(() => resolveGovernmentScorecardChartEvents(divergent), /divergent/);
});

const monthly = ["2007-11", "2007-12", "2008-01", "2008-02", "2008-03"].map((period) => ({ period, period_start: `${period}-01` }));

test("event spans map dates to the periods that contain them", () => {
  const spans = getGovernmentChartEventSpans([
    { id: "a", start_date: "2008-01-15", end_date: "2008-02-10" },
  ], monthly, "Mensile");
  assert.deepEqual(spans, [{ id: "a", fromIndex: 2, toIndex: 3, clippedStart: false, clippedEnd: false, lane: 0 }]);
});

test("event spans clip at the window, keep open-ended events and drop events outside", () => {
  const spans = getGovernmentChartEventSpans([
    { id: "before", start_date: "2001-01-01", end_date: "2002-12-31" },
    { id: "clipped", start_date: "2006-01-01", end_date: "2007-12-15" },
    { id: "open", start_date: "2008-03-20", end_date: null },
    { id: "after", start_date: "2008-04-01", end_date: null },
  ], monthly, "Mensile");
  assert.deepEqual(spans.map((span) => span.id), ["clipped", "open"]);
  assert.deepEqual(spans[0], { id: "clipped", fromIndex: 0, toIndex: 1, clippedStart: true, clippedEnd: false, lane: 0 });
  assert.deepEqual(spans[1], { id: "open", fromIndex: 4, toIndex: 4, clippedStart: false, clippedEnd: true, lane: 0 });
});

test("annual periods contain the whole year and overlapping events take separate lanes", () => {
  const annual = ["2019", "2020", "2021", "2022", "2023"].map((period) => ({ period, period_start: `${period}-01-01` }));
  const spans = getGovernmentChartEventSpans([
    { id: "pandemic", start_date: "2020-01-01", end_date: "2021-12-31" },
    { id: "energy", start_date: "2021-01-01", end_date: "2023-12-31" },
  ], annual, "Annuale");
  assert.deepEqual(spans.map(({ id, fromIndex, toIndex, lane }) => ({ id, fromIndex, toIndex, lane })), [
    { id: "pandemic", fromIndex: 1, toIndex: 2, lane: 0 },
    { id: "energy", fromIndex: 2, toIndex: 4, lane: 1 },
  ]);
  assert.deepEqual(getGovernmentChartEventSpans([{ id: "x", start_date: "2020-01-01", end_date: null }], [], "Annuale"), []);
});

test("every government chart collection carries the same resolved events", () => {
  const expected = resolveGovernmentScorecardChartEvents(snapshot);
  for (const id of GOVERNMENT_SCORECARD_V6_GOVERNMENT_IDS) {
    const charts = getGovernmentScorecardV6View(id).charts;
    if (charts.status !== "ready") continue;
    assert.deepEqual(charts.events, expected, id);
  }
});
