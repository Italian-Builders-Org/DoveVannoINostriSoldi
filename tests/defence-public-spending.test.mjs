import assert from "node:assert/strict";
import test from "node:test";
import "./helpers/register-ts-alias.mjs";

const { buildDefenceSeries, getDefencePublicSpendingView, parseDefenceYear, DEFENCE_MISSION } = await import("../src/lib/defence-public-spending.ts");
const { queryEurostatCofog, eurostatCofogMetadata } = await import("../src/lib/eurostat-cofog-snapshot.ts");
const { getCommittedBudgetLawMissionSeries } = await import("../src/lib/bdap-legge-bilancio.ts");
const { buildHomeItalyFunnel } = await import("../src/lib/home-italy-funnel.ts");
const { PRIMARY_NAV, SITE_MAP_GROUPS, flattenNavLinks } = await import("../src/lib/site-navigation.ts");
const { PUBLIC_INDEXABLE_PATHS } = await import("../src/lib/public-discovery.ts");

function inputs() {
  return {
    cofog: structuredClone(queryEurostatCofog({ geo: "IT", function: "GF02" })),
    budget: structuredClone(getCommittedBudgetLawMissionSeries(10)),
  };
}

test("defence exposes the five official GF02 subfunctions without changing the parent total", () => {
  const view = getDefencePublicSpendingView(2024);
  assert.equal(view.detail.length, 5);
  assert.deepEqual(view.detail.map((row) => row.function), ["GF0201", "GF0202", "GF0203", "GF0204", "GF0205"]);
  assert.equal(view.detail.reduce((sum, row) => sum + row.amountCents, 0), view.selected.amountCents);
  assert.match(view.detailReconciliation.note, /GF0201/);
});

test("defence preserves every source observation, unit and independent period", () => {
  const view = getDefencePublicSpendingView();
  const { cofog, budget } = inputs();
  assert.deepEqual(view.history, cofog.observations);
  assert.deepEqual(view.allocations, budget.allocations.filter((point) => point.mission === DEFENCE_MISSION));
  assert.equal(view.latestCofog.year, 2024);
  assert.equal(view.latestBudget.year, 2026);
  assert.equal(view.comparison.year, 2024);
  assert.equal(view.comparison.budget.year, view.comparison.cofog.year);
  assert.deepEqual(view.annual.map((point) => point.year), Array.from({ length: 13 }, (_, index) => 2014 + index));
  assert.equal(view.annual.find((point) => point.year === 2014).budget, null);
  assert.equal(view.annual.find((point) => point.year === 2025).cofog, null);
  assert.deepEqual(view.cofog.semantics, eurostatCofogMetadata.semantics);
  assert.match(view.budget.semantics.soldi.nature, /Stanziamenti.*CP A1/);
  assert.equal(view.budget.semantics.soldi.unit, "euro");
  assert.equal(view.budget.semantics.provenance.publicationDate, null);
  assert.equal(view.budget.semantics.provenance.checkedAt, null);
  assert.notEqual(view.budget.semantics.provenance.metadataModified, view.budget.semantics.provenance.acquisitionDate);
  assert.match(view.budget.semantics.provenance.sha256, /^[a-f0-9]{64}$/);
});

test("defence retains published zero and Eurostat flags instead of filling absent years", () => {
  const { cofog, budget } = inputs();
  cofog.observations[0].amountCents = 0;
  cofog.observations[0].shareOfGdpHundredths = 0;
  cofog.observations[1].flag = "b";
  cofog.observations.at(-1).flag = "p";
  budget.allocations.find((point) => point.year === 2017 && point.mission === DEFENCE_MISSION).amountEur = 0;
  const view = buildDefenceSeries(cofog, budget);
  assert.equal(view.annual[0].cofog.amountCents, 0);
  assert.equal(view.annual[0].cofog.shareOfGdpHundredths, 0);
  assert.equal(view.annual[0].budget, null);
  assert.equal(view.annual[1].cofog.flag, "b");
  assert.equal(view.latestCofog.flag, "p");
  assert.equal(view.annual.find((row) => row.year === 2017).budget.amountEur, 0);
});

test("defence refuses wrong function, geography, incomplete and duplicate series", () => {
  for (const mutate of [
    ({ cofog }) => { cofog.observations[0].function = "GF03"; },
    ({ cofog }) => { cofog.observations[0].geo = "FR"; },
    ({ cofog }) => { cofog.observations.pop(); },
    ({ cofog }) => { cofog.observations[1] = { ...cofog.observations[0] }; },
    ({ budget }) => { budget.missions = budget.missions.filter((mission) => mission !== DEFENCE_MISSION); },
    ({ budget }) => { budget.allocations = budget.allocations.filter((row) => !(row.mission === DEFENCE_MISSION && row.year === 2024)); },
  ]) {
    const data = inputs();
    mutate(data);
    assert.throws(() => buildDefenceSeries(data.cofog, data.budget));
  }
});

test("defence compares only a common year and refuses entirely disjoint coverage", () => {
  const { cofog, budget } = inputs();
  const earlier = { ...budget, years: budget.years.filter((year) => year <= 2023), allocations: budget.allocations.filter((point) => point.year <= 2023) };
  assert.equal(buildDefenceSeries(cofog, earlier).comparison.year, 2023);
  const later = { ...budget, years: budget.years.filter((year) => year > 2024), allocations: budget.allocations.filter((point) => point.year > 2024) };
  assert.throws(() => buildDefenceSeries(cofog, later), /nessun anno comune/);
});

test("defence is reachable from the home COFOG reading, navigation and discovery", () => {
  const funnel = buildHomeItalyFunnel();
  assert.equal(funnel.pa.slices.find((row) => row.id === "GF02").href, "/spese/difesa?anno=2024");
  assert.ok(PRIMARY_NAV.flatMap((section) => flattenNavLinks(section.children ?? [])).some((link) => link.href === "/spese/difesa"));
  assert.ok(SITE_MAP_GROUPS.flatMap((section) => section.links).some((link) => link.href === "/spese/difesa"));
  assert.ok(PUBLIC_INDEXABLE_PATHS.includes("/spese/difesa"));
});

test("defence keeps the home year and refuses ambiguous or uncovered selections", () => {
  assert.equal(buildHomeItalyFunnel(2014).pa.slices.find((row) => row.id === "GF02").href, "/spese/difesa?anno=2014");
  assert.equal(parseDefenceYear(undefined), 2024);
  assert.equal(parseDefenceYear("2014"), 2014);
  for (const value of ["", "2013", "2025", "2024x", "2024.0", " 2024", ["2024"], ["2014", "2024"]]) {
    assert.equal(parseDefenceYear(value), null);
  }
  for (const value of [2013, 2025, NaN, 2024.5]) {
    assert.throws(() => getDefencePublicSpendingView(value), /anno COFOG non disponibile/);
  }
  const earliest = getDefencePublicSpendingView(2014);
  assert.equal(earliest.selected.year, 2014);
  assert.equal(earliest.comparison.year, 2014);
  assert.equal(earliest.comparison.budget, null);
});
