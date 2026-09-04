import assert from "node:assert/strict";
import test from "node:test";
import "./helpers/register-ts-alias.mjs";
const { getUniversityResearchView } = await import("../src/lib/university-research.ts");
const { getCommittedBudgetLawMissionSeries, selectBudgetLawMission } = await import("../src/lib/bdap-legge-bilancio.ts");
const { queryPublicDataset } = await import("../src/lib/mcp/datasets.ts");
const { datasetCatalog } = await import("../src/lib/mcp/catalog.ts");
const { PRIMARY_NAV, SITE_MAP_GROUPS, isNavChildActive } = await import("../src/lib/site-navigation.ts");
const { PUBLIC_INDEXABLE_PATHS } = await import("../src/lib/public-discovery.ts");

test("university and research preserve two complete, separate CP A1 series", () => {
  const view = getUniversityResearchView();
  assert.deepEqual(view.years, Array.from({ length: 10 }, (_, index) => 2017 + index));
  assert.deepEqual(view.missions.map((mission) => mission.code), ["023", "017"]);
  const expected = [[7_936_106_705, 11_432_211_698], [2_761_236_019, 4_254_614_396]];
  const source = getCommittedBudgetLawMissionSeries(10);
  for (const [index, mission] of view.missions.entries()) {
    assert.deepEqual(mission.allocations.map((point) => point.year), view.years);
    assert.deepEqual(mission.allocations, source.allocations.filter((point) => point.mission === mission.label));
    assert.equal(mission.allocations[0].amountEur, expected[index][0]);
    assert.equal(mission.allocations.at(-1).amountEur, expected[index][1]);
  }
  assert.deepEqual(view.dataset, source.dataset);
  assert.equal(view.observedAt, source.observedAt);
  assert.match(view.missions[1].note, /non universitari/);
});

test("MCP exact mission filter retains provenance and consistent deltas without changing defaults", async () => {
  const original = getCommittedBudgetLawMissionSeries();
  assert.deepEqual(await queryPublicDataset({ dataset: "openbdap_legge_bilancio_storico" }), original);
  const view = getUniversityResearchView();
  for (const mission of view.missions) {
    const filtered = await queryPublicDataset({
      dataset: "openbdap_legge_bilancio_storico", years: 10, mission: mission.label,
    });
    assert.deepEqual(filtered.missions, [mission.label]);
    assert.deepEqual(filtered.allocations, mission.allocations);
    assert.equal(filtered.yearOverYearDeltas.length, 9);
    assert.ok(filtered.yearOverYearDeltas.every((delta) => delta.mission === mission.label));
    assert.deepEqual(filtered.dataset, view.dataset);
    assert.equal(filtered.observedAt, view.observedAt);
    assert.equal(filtered.dataMode, "snapshot");
  }
  assert.deepEqual(getCommittedBudgetLawMissionSeries(), original);
  const catalog = datasetCatalog.find((item) => item.id === "openbdap_legge_bilancio_storico");
  assert.deepEqual(catalog.filters, ["years", "mission"]);
  assert.match(catalog.caveat, /non universitari/);
  assert.match(catalog.caveat, /non.*pagamento/);
});

test("unknown or partial mission names fail instead of returning all missions or zero", async () => {
  const series = getCommittedBudgetLawMissionSeries(10);
  for (const mission of ["Ricerca", "017", "", "ricerca e innovazione", "Istruzione scolastica e universitaria"]) {
    assert.throws(() => selectBudgetLawMission(series, mission), /Missione non disponibile/);
    await assert.rejects(queryPublicDataset({ dataset: "openbdap_legge_bilancio_storico", mission }), /Missione non disponibile/);
  }
  await assert.rejects(queryPublicDataset({ dataset: "siope_comuni", mission: "Ricerca e innovazione" }), /Filtri non supportati/);
});

test("education navigation, footer and sitemap expose the new page with one active child", () => {
  const route = "/istruzione/universita-ricerca";
  const nav = PRIMARY_NAV.find((section) => section.href === "/istruzione");
  assert.ok(nav.children.some((child) => child.href === route));
  assert.equal(isNavChildActive(route, route, nav.children), true);
  assert.equal(isNavChildActive(route, "/istruzione", nav.children), false);
  assert.ok(SITE_MAP_GROUPS.find((group) => group.title === "Istruzione").links.some((link) => link.href === route));
  assert.ok(PUBLIC_INDEXABLE_PATHS.includes(route));
});
