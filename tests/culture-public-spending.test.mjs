import assert from "node:assert/strict";
import test from "node:test";
import "./helpers/register-ts-alias.mjs";

const { buildCulturePublicSpendingView, CULTURE_BUDGET_MISSION, parseCultureYear } = await import("../src/lib/culture-public-spending.ts");
const { queryEurostatCofog, eurostatCofogMetadata } = await import("../src/lib/eurostat-cofog-snapshot.ts");
const { getCommittedBudgetLawMissionSeries } = await import("../src/lib/bdap-legge-bilancio.ts");
const { activeNavSection, flattenNavLinks, FOOTER_SITEMAP_GROUPS } = await import("../src/lib/site-navigation.ts");
const { PUBLIC_INDEXABLE_PATHS } = await import("../src/lib/public-discovery.ts");
const { searchSiteDocuments } = await import("../src/lib/global-search.ts");

test("culture uses the entire Italian GF08 series with original flags and provenance", () => {
  const view = buildCulturePublicSpendingView();
  assert.equal(view.year, 2024);
  assert.equal(view.selected.amountCents, 1_877_360_000_000);
  assert.equal(view.selected.shareOfGdpHundredths, 90);
  const expected = queryEurostatCofog({ geo: "IT", function: "GF08" }).observations;
  assert.deepEqual(view.history, [...expected].sort((a, b) => a.year - b.year));
  assert.equal(view.history.length, 11);
  assert.deepEqual(view.metadata.semantics, eurostatCofogMetadata.semantics);
  assert.notEqual(view.metadata.semantics.provenance.publicationDate, view.metadata.semantics.provenance.checkedAt);
});

test("each culture selection uses its own year and the published S13 total as denominator", () => {
  for (let year = 2014; year <= 2024; year += 1) {
    const view = buildCulturePublicSpendingView(year);
    const published = queryEurostatCofog({ geo: "IT", year }).observations;
    const total = published.find((row) => row.function === "TOTAL");
    const culture = published.find((row) => row.function === "GF08");
    assert.deepEqual(view.selected, culture);
    assert.equal(view.totalPublicSpendingCents, total.amountCents);
    assert.equal(view.shareOfPublicSpendingPercent, culture.amountCents / total.amountCents * 100);
  }
});

test("State appropriations remain separate and a missing year is not replaced by zero or another year", () => {
  const view = buildCulturePublicSpendingView(2024);
  const expected = getCommittedBudgetLawMissionSeries(10).allocations.filter((row) => row.mission === CULTURE_BUDGET_MISSION);
  assert.deepEqual(view.budget.allocations, expected);
  assert.deepEqual(view.budget.missions, [CULTURE_BUDGET_MISSION]);
  assert.equal(view.budget.selected.year, 2024);
  assert.equal(view.budget.selected.amountEur, 3_286_989_285);
  assert.equal(view.budget.allocations.at(-1).year, 2026);
  for (const year of [2014, 2015, 2016]) {
    const older = buildCulturePublicSpendingView(year);
    assert.equal(older.selected.year, year);
    assert.equal(older.budget.selected, null);
  }
});

test("culture filters reject ambiguous, malformed and uncovered years", () => {
  assert.equal(parseCultureYear(undefined), 2024);
  assert.equal(parseCultureYear("2014"), 2014);
  assert.equal(parseCultureYear("2024"), 2024);
  for (const raw of ["", "2013", "2025", "2026", "2024x", "2024.0", " 2024", ["2024"], ["2024", "2023"]]) {
    assert.equal(parseCultureYear(raw), null);
  }
  for (const year of [2013, 2025, NaN, 2024.5]) {
    assert.throws(() => buildCulturePublicSpendingView(year), /Anno fuori dal periodo/);
  }
});

test("culture is discoverable without replacing the existing Sport destination", () => {
  const links = flattenNavLinks(activeNavSection("/spese/cultura").children);
  for (const href of ["/spese/cultura", "/spese/sport"]) {
    assert.ok(links.some((entry) => entry.href === href));
    assert.ok(PUBLIC_INDEXABLE_PATHS.includes(href));
    assert.ok(FOOTER_SITEMAP_GROUPS.some((group) => group.links.some((entry) => entry.href === href)));
  }
  for (const query of ["cultura", "GF08", "culto", "spettacolo"]) {
    assert.ok(searchSiteDocuments(query).some((entry) => entry.href === "/spese/cultura"), query);
  }
});
