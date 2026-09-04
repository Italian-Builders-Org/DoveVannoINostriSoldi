import assert from "node:assert/strict";
import test from "node:test";
import "./helpers/register-ts-alias.mjs";

const {
  aggregateRecipientInsights,
  detectInsightRoles,
  isInsightCapable,
  loadDatasetInsights,
  parseInsightAmount,
  looksLikeAmountHeader,
  amountColumnKeys,
  formatIntegratedAmountCell,
} = await import("../src/lib/integrated-dataset-insights.ts");

test("detectInsightRoles finds recipient and amount columns", () => {
  const roles = detectInsightRoles([
    "cf_fornitore",
    "ragione_sociale",
    "settore_cpv",
    "n_aggiudicazioni",
    "importo_totale",
  ]);
  assert.deepEqual(roles, {
    recipient: "ragione_sociale",
    amount: "importo_totale",
    service: "settore_cpv",
    count: "n_aggiudicazioni",
  });
  assert.equal(isInsightCapable(["ragione_sociale", "importo_totale"], true), true);
  assert.equal(isInsightCapable(["ragione_sociale"], true), false);
  assert.equal(isInsightCapable(["ragione_sociale", "importo_totale"], false), false);
});

test("parseInsightAmount keeps null/empty distinct from zero", () => {
  assert.equal(parseInsightAmount(null), null);
  assert.equal(parseInsightAmount(""), null);
  assert.equal(parseInsightAmount("n.d."), null);
  assert.equal(parseInsightAmount("0"), 0);
  assert.equal(parseInsightAmount("1.234,56"), 1234.56);
  assert.equal(parseInsightAmount("1234.56"), 1234.56);
});

test("amount columns include canoni even when some cells are n.d.", () => {
  assert.equal(looksLikeAmountHeader("canone_annuo_eur"), true);
  assert.equal(looksLikeAmountHeader("canone_mq"), true);
  assert.equal(looksLikeAmountHeader("costo_lordo_eur"), true);
  assert.equal(looksLikeAmountHeader("euro_per_addetto"), true);
  assert.equal(looksLikeAmountHeader("mq"), false);
  assert.equal(looksLikeAmountHeader("anno"), false);
  assert.equal(looksLikeAmountHeader("immobile"), false);

  const keys = amountColumnKeys(
    ["ente", "mq", "canone_annuo_eur", "anno"],
    [
      { cells: { ente: "MIMIT", mq: "99.80", canone_annuo_eur: "n.d.", anno: "2025" } },
      { cells: { ente: "MIMIT", mq: "n.d.", canone_annuo_eur: "117361.93", anno: "2025" } },
      { cells: { ente: "MIMIT", mq: "71", canone_annuo_eur: "0.00", anno: "2025" } },
    ],
  );
  assert.equal(keys.has("canone_annuo_eur"), true);
  assert.equal(keys.has("mq"), false);
  assert.equal(keys.has("anno"), false);

  assert.equal(formatIntegratedAmountCell("117361.93"), "117.361,93\u00a0€");
  assert.equal(formatIntegratedAmountCell("0.00"), "0,00\u00a0€");
  assert.equal(formatIntegratedAmountCell("n.d."), null);
});

test("aggregateRecipientInsights ranks companies and multi-service recurrence", () => {
  const insights = aggregateRecipientInsights(
    "demo",
    ["contraente", "importo", "oggetto"],
    [
      {
        id: "1",
        sourceRow: 1,
        cells: { contraente: "Alpha Spa", importo: "1000", oggetto: "Pulizie" },
        sourceUrls: [],
      },
      {
        id: "2",
        sourceRow: 2,
        cells: { contraente: "Alpha Spa", importo: "2000", oggetto: "Manutenzione" },
        sourceUrls: [],
      },
      {
        id: "3",
        sourceRow: 3,
        cells: { contraente: "Beta Srl", importo: "500", oggetto: "Pulizie" },
        sourceUrls: [],
      },
      {
        id: "4",
        sourceRow: 4,
        cells: { contraente: "Gamma", importo: null, oggetto: "Altro" },
        sourceUrls: [],
      },
      {
        id: "5",
        sourceRow: 5,
        cells: { contraente: "", importo: "900", oggetto: "Altro" },
        sourceUrls: [],
      },
    ],
    { publicRows: 5, exhausted: true },
  );

  assert.equal(insights.capable, true);
  assert.equal(insights.rowsWithAmount, 4);
  assert.equal(insights.totalEuro, 4400);
  assert.equal(insights.topRecipients[0]?.name, "Alpha Spa");
  assert.equal(insights.topRecipients[0]?.totalEuro, 3000);
  assert.equal(insights.topRecipients[0]?.awards, 2);
  assert.deepEqual(insights.topRecipients[0]?.services, ["Manutenzione", "Pulizie"]);
  assert.equal(insights.multiService.length, 1);
  assert.match(insights.headline ?? "", /Alpha Spa/);
  assert.match(insights.headline ?? "", /settori o servizi/);
  assert.match(insights.coverageNote, /4 righe con importo leggibile/);
  assert.equal(insights.chartPoints[0]?.value, 3000);
});

test("loadDatasetInsights builds live totals for vincitori", async () => {
  const insights = await loadDatasetInsights("vincitori");
  assert.ok(insights);
  assert.equal(insights.capable, true);
  assert.ok(insights.topRecipients.length > 0);
  assert.ok(insights.topRecipients[0].totalEuro > 0);
  assert.ok(insights.headline);
  assert.match(insights.coverageNote, /importo leggibile/);
});

test("loadDatasetInsights stays empty for catalog-only benchmarks", async () => {
  const insights = await loadDatasetInsights("benchmark-consulenze");
  assert.ok(insights);
  assert.equal(insights.capable, false);
  assert.equal(insights.topRecipients.length, 0);
  assert.equal(insights.headline, null);
});

test("loadDatasetInsightTeaser returns a compact recipient line for vincitori", async () => {
  const { loadDatasetInsightTeaser } = await import("../src/lib/integrated-dataset-insights.ts");
  const teaser = await loadDatasetInsightTeaser("vincitori");
  assert.ok(teaser);
  assert.equal(teaser.complete, true);
  assert.match(teaser.line, /€|mln|mld/);
});
