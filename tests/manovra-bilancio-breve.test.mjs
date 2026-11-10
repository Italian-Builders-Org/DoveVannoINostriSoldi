import assert from "node:assert/strict";
import test from "node:test";
import "./helpers/register-ts-alias.mjs";

const {
  assertManovraSnapshot,
  buildProgrammaticPilPoints,
  formatBillions,
  formatSignedPct,
  getLatestComparison,
  getLatestEdition,
  manovraShareSorted,
  shouldShowProgrammaticPilChart,
} = await import("../src/lib/manovra-bilancio-breve.ts");

test("assertManovraSnapshot rejects empty or incoherent payloads", () => {
  assert.throws(() => assertManovraSnapshot(null));
  assert.throws(() => assertManovraSnapshot({ schemaVersion: 2, editions: [] }));
  assert.throws(() =>
    assertManovraSnapshot({
      schemaVersion: 1,
      latestEditionId: "missing",
      editions: [{ id: "lb-2026-2028" }],
      firstYearComparisons: [],
    }),
  );
});

test("formatters stay readable in mld without inventing cents on the page", () => {
  assert.match(formatBillions(923_116_684_581), /mld €$/);
  assert.match(formatSignedPct(1.5), /^\+1,5%$/);
  assert.equal(formatSignedPct(null), "n.d.");
});

test("manovra share excludes totals and sorts by absolute first-year impact", () => {
  const edition = {
    firstYear: 2026,
    manovraShareOfAppropriationsPct: [
      {
        aggregate: "Totale",
        byYear: { 2026: { legislazioneVigentePct: 100, manovraPct: 1, totalePct: 100 } },
      },
      {
        aggregate: "Missione A",
        byYear: { 2026: { legislazioneVigentePct: 10, manovraPct: -3, totalePct: 7 } },
      },
      {
        aggregate: "Missione B",
        byYear: { 2026: { legislazioneVigentePct: 20, manovraPct: 5, totalePct: 25 } },
      },
      {
        aggregate: "Missione C",
        byYear: { 2026: { legislazioneVigentePct: 5, manovraPct: null, totalePct: 5 } },
      },
    ],
  };
  const share = manovraShareSorted(edition, edition.firstYear);
  assert.deepEqual(
    share.map((row) => row.aggregate),
    ["Missione B", "Missione A"],
  );
  assert.ok(share.every((row) => !row.aggregate.toLowerCase().startsWith("totale")));
});

test("programmatic pil chart uses tav 1 debt series, not page year or crescita", () => {
  const edition = {
    firstYear: 2026,
    years: [2026, 2027, 2028],
    programmatic: {
      available: true,
      series: {
        indebitamentoNettoPilPct: {
          label: "Indebitamento netto (% Pil)",
          byYear: { 2024: -4.2, 2026: -3.1, 2027: -2.8, 2028: -2.5 },
        },
        saldoPrimarioPilPct: {
          label: "Saldo primario (% Pil)",
          byYear: { 2024: 1.5, 2026: 1.2, 2027: 1.0, 2028: 0.8 },
        },
        debitoPubblicoPilPct: {
          label: "Debito pubblico (% Pil)",
          byYear: { 2024: 134.9, 2026: 137.4, 2027: 137.3, 2028: 136.4 },
        },
        crescitaSpesaNettaPct: {
          label: "Crescita spesa",
          byYear: { 2029: 1.6 },
        },
      },
    },
  };
  const points = buildProgrammaticPilPoints(edition);
  assert.deepEqual(
    points.map((row) => row.year),
    [2024, 2026, 2027, 2028],
  );
  assert.ok(shouldShowProgrammaticPilChart(edition, points));
  assert.equal(points.find((row) => row.year === 2027)?.debito, 137.3);
});

test("latest helpers read from a validated snapshot object", () => {
  const snapshot = assertManovraSnapshot({
    schemaVersion: 1,
    title: "t",
    holder: "h",
    archiveUrl: "https://example.test",
    moneyNature: "n",
    unit: "euro",
    referenceNote: "n",
    coverage: {
      comparableXlsxFirstYears: [2026],
      pdfOnlyLandingYears: [],
      archiveCatalogUrl: "https://example.test",
      note: "n",
    },
    acquiredAt: "2026-01-01T00:00:00Z",
    checkedAt: "2026-01-01T00:00:00Z",
    latestEditionId: "lb-2026-2028",
    editions: [
      {
        id: "lb-2026-2028",
        label: "LB 2026-2028",
        firstYear: 2026,
        years: [2026, 2027, 2028],
        nature: "previsione",
        unit: "euro",
        landingUrl: "https://example.test",
        xlsx: { url: "https://www.rgs.mef.gov.it/x", fileName: "x.xlsx", bytes: 1, sha256: "a".repeat(64) },
        pdf: { url: "https://www.rgs.mef.gov.it/p", fileName: "p.pdf", bytes: 1, sha256: "b".repeat(64) },
        acquiredAt: "2026-01-01T00:00:00Z",
        headline: {
          entrateFinaliCompetenzaEur: 1,
          speseFinaliCompetenzaEur: 2,
          saldoNettoDaFinanziareCompetenzaEur: -1,
          ricorsoAlMercatoCompetenzaEur: -3,
        },
        summary: {},
        manovraShareOfAppropriationsPct: [],
        programmatic: { available: false, series: {} },
        revenueDetail: [],
        spendDetail: [],
        missionHistory: { available: false, unit: "euro", years: [], missions: [] },
        caveats: [],
      },
    ],
    firstYearComparisons: [
      {
        fromEditionId: "lb-2025-2027",
        toEditionId: "lb-2026-2028",
        fromYear: 2025,
        toYear: 2026,
        entrateFinali: { fromEur: 1, toEur: 2, deltaEur: 1, deltaPct: 100 },
        speseFinali: { fromEur: 1, toEur: 2, deltaEur: 1, deltaPct: 100 },
        saldoNettoDaFinanziare: { fromEur: -1, toEur: -2, deltaEur: -1, deltaPct: 100 },
        ricorsoAlMercato: { fromEur: -1, toEur: -2, deltaEur: -1, deltaPct: 100 },
      },
    ],
  });
  assert.equal(getLatestEdition(snapshot).id, "lb-2026-2028");
  assert.equal(getLatestComparison(snapshot)?.toEditionId, "lb-2026-2028");
});
