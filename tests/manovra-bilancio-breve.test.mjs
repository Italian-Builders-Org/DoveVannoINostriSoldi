import assert from "node:assert/strict";
import test from "node:test";
import "./helpers/register-ts-alias.mjs";

const {
  formatBillions,
  formatSignedPct,
  getLatestComparison,
  getLatestEdition,
  getManovraSnapshot,
  manovraShareSorted,
} = await import("../src/lib/manovra-bilancio-breve.ts");

test("snapshot pins four official Bilancio in Breve editions", () => {
  const snapshot = getManovraSnapshot();
  assert.equal(snapshot.schemaVersion, 1);
  assert.equal(snapshot.latestEditionId, "lb-2026-2028");
  assert.deepEqual(
    snapshot.editions.map((edition) => edition.id),
    ["lb-2023-2025", "lb-2024-2026", "lb-2025-2027", "lb-2026-2028"],
  );
  assert.deepEqual(snapshot.coverage.comparableXlsxFirstYears, [2023, 2024, 2025, 2026]);
  assert.deepEqual(snapshot.coverage.pdfOnlyLandingYears, [2018, 2019, 2020, 2021, 2022]);
  for (const edition of snapshot.editions) {
    assert.match(edition.xlsx.url, /^https:\/\/www\.rgs\.mef\.gov\.it\//);
    assert.equal(edition.xlsx.sha256.length, 64);
    assert.ok(edition.headline.speseFinaliCompetenzaEur > 0);
    assert.ok(edition.headline.entrateFinaliCompetenzaEur > 0);
    assert.equal(edition.years.length, 3);
    assert.equal(edition.years[0], edition.firstYear);
    assert.ok(edition.revenueDetail.length > 10);
    assert.ok(edition.spendDetail.length > 10);
    assert.equal(edition.missionHistory.available, true);
  }
});

test("every edition headline euros are exact to the cent against pinned XLSX values", () => {
  const snapshot = getManovraSnapshot();
  const expectedById = {
    "lb-2023-2025": {
      entrateFinaliCompetenzaEur: 672_250_788_315,
      speseFinaliCompetenzaEur: 872_903_962_855,
      saldoNettoDaFinanziareCompetenzaEur: -200_653_174_540,
      ricorsoAlMercatoCompetenzaEur: -511_473_175_779,
    },
    "lb-2024-2026": {
      entrateFinaliCompetenzaEur: 687_566_976_520,
      speseFinaliCompetenzaEur: 886_418_531_849,
      saldoNettoDaFinanziareCompetenzaEur: -198_851_555_329,
      ricorsoAlMercatoCompetenzaEur: -527_519_115_761,
    },
    "lb-2025-2027": {
      entrateFinaliCompetenzaEur: 728_832_687_509,
      speseFinaliCompetenzaEur: 915_769_270_589,
      saldoNettoDaFinanziareCompetenzaEur: -186_936_583_080,
      ricorsoAlMercatoCompetenzaEur: -470_712_034_296,
    },
    "lb-2026-2028": {
      entrateFinaliCompetenzaEur: 768_778_531_304,
      speseFinaliCompetenzaEur: 923_116_684_581,
      saldoNettoDaFinanziareCompetenzaEur: -154_338_153_277,
      ricorsoAlMercatoCompetenzaEur: -484_382_932_385,
    },
  };
  for (const edition of snapshot.editions) {
    assert.deepEqual(edition.headline, expectedById[edition.id], edition.id);
  }
  const latest = getLatestEdition();
  const irpef = latest.revenueDetail.find(
    (row) => row.label === "Imposta sul reddito delle persone fisiche",
  );
  assert.equal(irpef?.byYear["2026"]?.competenzaEur, 248_100_506_045);
});

test("latest comparison is first-year over first-year without inventing values", () => {
  const comparison = getLatestComparison();
  assert.ok(comparison);
  assert.equal(comparison.fromEditionId, "lb-2025-2027");
  assert.equal(comparison.toEditionId, "lb-2026-2028");
  assert.equal(comparison.fromYear, 2025);
  assert.equal(comparison.toYear, 2026);
  assert.ok(Number.isFinite(comparison.speseFinali.deltaPct));
  assert.ok(Math.abs(comparison.speseFinali.deltaPct - 0.8023215266083701) < 1e-9);
  assert.ok(Math.abs(comparison.entrateFinali.deltaPct - 5.480797510815091) < 1e-9);
});

test("manovra share excludes totals and sorts by absolute first-year impact", () => {
  const edition = getLatestEdition();
  const share = manovraShareSorted(edition, edition.firstYear);
  assert.ok(share.length >= 5);
  assert.ok(share.every((row) => !row.aggregate.toLowerCase().startsWith("totale")));
  for (let index = 1; index < share.length; index += 1) {
    assert.ok(Math.abs(share[index - 1].manovraPct) >= Math.abs(share[index].manovraPct));
  }
  assert.match(formatBillions(edition.headline.speseFinaliCompetenzaEur), /mld €$/);
  assert.match(formatSignedPct(1.5), /^\+1,5%$/);
});
