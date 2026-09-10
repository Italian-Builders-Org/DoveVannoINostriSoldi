import assert from "node:assert/strict";
import test from "node:test";
import "./helpers/register-ts-alias.mjs";

const {
  getGeneralPublicServicesView,
  parseGeneralPublicServicesYear,
} = await import("../src/lib/general-public-services-spending.ts");
const { buildHomeItalyFunnel } = await import("../src/lib/home-italy-funnel.ts");
const { PRIMARY_NAV, SITE_MAP_GROUPS } = await import("../src/lib/site-navigation.ts");
const { PUBLIC_INDEXABLE_PATHS } = await import("../src/lib/public-discovery.ts");
const { searchSiteDocuments } = await import("../src/lib/global-search.ts");

function flatten(entries) {
  return entries.flatMap((entry) => [entry, ...flatten(entry.children ?? [])]);
}

test("GF01 2024 exposes the official total and eight second-level functions", () => {
  const view = getGeneralPublicServicesView(2024);
  assert.equal(view.parent.amountCents, 17_041_400_000_000);
  assert.equal(view.detail.length, 8);
  assert.equal(view.detail.reduce((sum, row) => sum + row.amountCents, 0), view.parent.amountCents);
  assert.equal(view.debtTransactions.function, "GF0107");
  assert.equal(view.debtTransactions.amountCents, 8_778_900_000_000);
});

test("GF0107 stays distinct from the D.41 interest series", () => {
  const view = getGeneralPublicServicesView(2024);
  assert.ok(view.interestComparison);
  assert.equal(view.interestComparison.interestExpenseCents, 8_548_300_000_000);
  assert.equal(view.interestComparison.debtTransactionsCents, 8_778_900_000_000);
  assert.equal(view.interestComparison.differenceCents, 230_600_000_000);
  assert.notEqual(
    view.interestComparison.interestExpenseCents,
    view.interestComparison.debtTransactionsCents,
  );
  assert.match(view.caveats.join(" "), /FISIM/i);
});

test("the year parser is strict and never fills an unsupported year", () => {
  assert.equal(parseGeneralPublicServicesYear(undefined), 2024);
  assert.equal(parseGeneralPublicServicesYear("2014"), 2014);
  for (const value of ["", "2013", "2025", "2024x", "2024.0", " 2024", ["2024"]]) {
    assert.equal(parseGeneralPublicServicesYear(value), null, String(value));
  }
});

test("the home links GF01 to its full function instead of the debt page", () => {
  for (const year of [2014, 2020, 2024]) {
    const slice = buildHomeItalyFunnel(year).pa.slices.find((row) => row.id === "GF01");
    assert.equal(slice.href, `/spese/servizi-generali?anno=${year}`);
    assert.equal(slice.linkLabel, "Servizi generali");
  }
});

test("the GF01 page is reachable from navigation, sitemap, discovery and search", () => {
  const href = "/spese/servizi-generali";
  assert.ok(flatten(PRIMARY_NAV).some((entry) => entry.href === href));
  assert.ok(SITE_MAP_GROUPS.flatMap((group) => flatten(group.links)).some((entry) => entry.href === href));
  assert.ok(PUBLIC_INDEXABLE_PATHS.includes(href));
  for (const query of ["servizi generali", "GF01", "operazioni sul debito"]) {
    assert.ok(searchSiteDocuments(query).some((entry) => entry.href === href), query);
  }
});
