import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";
import "./helpers/register-ts-alias.mjs";

const page = await readFile(new URL("../src/app/inflazione/page.tsx", import.meta.url), "utf8");
const chart = await readFile(new URL("../src/app/inflazione/inflation-trend-chart.tsx", import.meta.url), "utf8");
const css = await readFile(new URL("../src/app/inflazione/inflazione.module.css", import.meta.url), "utf8");
const docs = await readFile(new URL("../docs/DATA_SOURCES.md", import.meta.url), "utf8");
const { searchSiteDocuments } = await import("../src/lib/global-search.ts");
const { PUBLIC_INDEXABLE_PATHS } = await import("../src/lib/public-discovery.ts");
const { PRIMARY_NAV, SITE_MAP_GROUPS } = await import("../src/lib/site-navigation.ts");

test("inflation page leads with prices and keeps public spending outside the frame", () => {
  assert.match(page, /<h1>Inflazione IPCA<\/h1>/);
  assert.match(page, /prezzi al consumo, non di spesa pubblica/i);
  assert.match(page, /data-testid="hicp-annual-rate"/);
  assert.match(page, /base 2025=100/);
  assert.match(page, /Non sono contributi additivi/);
  assert.match(page, /non moltiplichiamo i due numeri per inventare un contributo italiano/i);
  assert.match(page, /ISTAT_CONSUMER_PRICE_2026_URL/);
  assert.match(page, /href="\/governi"/);
});

test("inflation chart is accessible, tokenized and has an exact table equivalent", () => {
  assert.match(chart, /role="img" aria-label="IPCA Italia:/);
  assert.match(chart, /stroke="var\(--chart-primary\)"/);
  assert.match(chart, /stroke="var\(--chart-secondary\)"/);
  assert.match(chart, /strokeDasharray="5 4"/);
  assert.match(chart, /<ChartDataTable/);
  assert.match(chart, /shortLabelByPeriod\.get\(period\) \?\? period/);
  assert.match(chart, /Indice 2025=100/);
  assert.doesNotMatch(chart, /#[0-9a-f]{3,8}/i);
  assert.match(css, /\.divisionTrack > span \{[\s\S]*?background: var\(--chart-data-primary\);/);
  assert.doesNotMatch(css, /#[0-9a-f]{3,8}/i);
});

test("inflation is discoverable from navigation, search, sitemap and source docs", () => {
  const money = PRIMARY_NAV.find((section) => section.href === "/spese");
  assert.ok(money?.children?.some((entry) => entry.href === "/inflazione" && /prezzi/i.test(entry.label)));
  assert.ok(SITE_MAP_GROUPS.some((group) => group.links.some((entry) => entry.href === "/inflazione")));
  assert.ok(PUBLIC_INDEXABLE_PATHS.includes("/inflazione"));
  for (const query of ["inflazione", "IPCA", "HICP", "paniere"]) {
    assert.ok(searchSiteDocuments(query).some((result) => result.href === "/inflazione"), query);
  }
  assert.match(docs, /## Inflazione IPCA \/ HICP/);
  assert.match(docs, /non spesa pubblica/i);
});

test("inflation layout collapses wide grids instead of overflowing phones", () => {
  assert.match(css, /@media \(max-width: 700px\)[\s\S]*?\.heroMetrics, \.comparisonGrid, \.glossary, \.metadata \{ grid-template-columns: minmax\(0, 1fr\); \}/);
  assert.match(page, /className="table-scroll"/);
  assert.doesNotMatch(css, /min-width:\s*[4-9]\d{2,}px/);
  assert.match(css, /\.provenance p code \{ overflow-wrap: anywhere; word-break: break-all; \}/);
});
