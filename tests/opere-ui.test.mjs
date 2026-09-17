import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

const source = (path) => readFile(new URL(path, import.meta.url), "utf8");

test("opere section is discoverable from Fondi e progetti navigation", async () => {
  const navigation = await source("../src/lib/site-navigation.ts");
  assert.match(navigation, /href: "\/opere", label: "Opere pubbliche"/);
  assert.match(navigation, /aliases: \[[^\]]*\/opere/);
});

test("opere page shows charts then browsable list with progress and search below", async () => {
  const [page, css, loader, etl, charts] = await Promise.all([
    source("../src/app/opere/page.tsx"),
    source("../src/app/opere/opere.module.css"),
    source("../src/lib/data/mop-comparable-browse.ts"),
    source("../scripts/etl/mop_comparable_browse.py"),
    source("../src/components/charts/mop-browse-summary-charts.tsx"),
  ]);
  assert.doesNotMatch(page, /^["']use client["'];/m);
  assert.doesNotMatch(page, /—|–/);
  assert.match(page, /Monitoraggio Opere Pubbliche/);
  assert.match(page, /MopBrowseSummaryCharts/);
  assert.match(page, /ComparableBrowse/);
  assert.match(page, /avanzamento/);
  assert.match(page, /Esecuzione prevista/);
  assert.match(page, /Esecuzione effettiva/);
  assert.match(page, /Cerca un CUP live/);
  assert.match(page, /settore|categoria/);
  assert.match(page, /queryMopComparableBrowse/);
  assert.match(page, /regione/i);
  assert.doesNotMatch(page, /vista=elenco|vista" value="elenco"|vista === "elenco"/);
  assert.match(loader, /geography: z\.literal\("absent-in-mop-columns"\)/);
  assert.match(loader, /plannedTotalCents/);
  assert.match(loader, /actualTotalCents/);
  assert.match(loader, /progress/);
  assert.match(loader, /getMopComparableSummaries/);
  assert.match(loader, /readSync/);
  assert.doesNotMatch(loader, /readFileSync\(/);
  assert.match(etl, /comparableRule/);
  assert.match(etl, /ccosto_lavori_previsto/);
  assert.match(etl, /cinizio_esecuzione_prevista/);
  assert.match(etl, /derive_progress|progress/);
  assert.match(page, /Applica filtri/);
  assert.match(page, /tag tag-accent/);
  assert.match(charts, /Scala logaritmica|scale="log"/);
  assert.match(charts, /className=\{styles\.stack\}/);
  assert.match(charts, /Opere per avanzamento/);
  assert.match(charts, /sectorName|styles\.sectorName/);
  assert.match(charts, /logPercent|Scala logaritmica/);
  assert.equal(page.match(/<h1\b/g)?.length, 1);
  assert.doesNotMatch(css, /#[0-9a-f]{3,8}/i);
  assert.match(css, /browseActions/);
  assert.match(css, /@media \(max-width: 640px\)/);
  assert.match(
    await source("../src/components/charts/mop-browse-summary-charts.module.css"),
    /@media \(max-width: 640px\)/,
  );
});
