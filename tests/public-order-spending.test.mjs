import assert from "node:assert/strict";
import test from "node:test";
import "./helpers/register-ts-alias.mjs";

const { getPublicOrderSpendingView, parsePublicOrderYear } = await import("../src/lib/public-order-spending.ts");
const { queryEurostatCofog } = await import("../src/lib/eurostat-cofog-snapshot.ts");
const { buildHomeItalyFunnel } = await import("../src/lib/home-italy-funnel.ts");
const { searchSiteDocuments } = await import("../src/lib/global-search.ts");
const { PUBLIC_INDEXABLE_PATHS } = await import("../src/lib/public-discovery.ts");

test("public order view selects the complete Italian GF03 series without changing the source values", () => {
  const view = getPublicOrderSpendingView();
  assert.deepEqual(view.history.map((point) => point.year), Array.from({ length: 11 }, (_, i) => 2014 + i));
  assert.equal(view.selected.year, 2024);
  assert.equal(view.selected.amountEuro, 39_094_000_000);
  assert.equal(view.selected.gdpSharePercent, 1.8);
  assert.equal(view.history[0].amountEuro, 30_317_000_000);
  for (const point of view.history) {
    const source = queryEurostatCofog({ geo: "IT", year: point.year });
    const division = source.observations.find((row) => row.function === "GF03");
    const total = source.observations.find((row) => row.function === "TOTAL");
    assert.equal(point.amountEuro, division.amountCents / 100);
    assert.equal(point.publicSpendingSharePercent, division.amountCents / total.amountCents * 100);
    assert.equal(point.flag, division.flag);
    assert.equal(point.denominatorFlag, total.flag);
  }
});

test("public order view retains the three semantic axes and hashed official provenance", () => {
  const view = getPublicOrderSpendingView(2014);
  assert.equal(view.selected.year, 2014);
  assert.match(view.semantics.soldi.nature, /SEC 2010/);
  assert.equal(view.semantics.periodo.referencePeriod, "2014-2024");
  assert.equal(view.semantics.provenance.acquisitionDate, "2026-09-03");
  assert.equal(view.semantics.provenance.checkedAt, "2026-09-03");
  assert.match(view.semantics.provenance.publicationDate, /^2026-07-21/);
  assert.equal(view.source.licenseId, "CC-BY-4.0");
  for (const source of Object.values(view.source.assets)) {
    assert.ok(source.url.startsWith("https://ec.europa.eu/eurostat/"));
    assert.match(source.sha256, /^[a-f0-9]{64}$/);
  }
  assert.match(view.integrity.dataArtifact.sha256, /^[a-f0-9]{64}$/);
});

test("year selection rejects uncovered and ambiguous years without substituting a value", () => {
  assert.equal(parsePublicOrderYear(undefined), 2024);
  assert.equal(parsePublicOrderYear("2014"), 2014);
  assert.equal(parsePublicOrderYear("2024"), 2024);
  for (const value of ["", "2025", "2013", "2024x", "2024.0", " 2024", ["2014", "2024"], ["2024"]]) {
    assert.equal(parsePublicOrderYear(value), null);
  }
  for (const value of [2013, 2025, NaN, 2024.5]) {
    assert.throws(() => getPublicOrderSpendingView(value), /Anno non disponibile/);
  }
});

test("the home funnel preserves the selected year and the public page is discoverable", () => {
  const slice = buildHomeItalyFunnel(2014).pa.slices.find((row) => row.id === "GF03");
  assert.equal(slice.href, "/spese/sicurezza?anno=2014");
  assert.equal(slice.amountEuro, getPublicOrderSpendingView(2014).selected.amountEuro);
  assert.ok(PUBLIC_INDEXABLE_PATHS.includes("/spese/sicurezza"));
  assert.ok(searchSiteDocuments("ordine pubblico").some((result) => result.href === "/spese/sicurezza"));
});
