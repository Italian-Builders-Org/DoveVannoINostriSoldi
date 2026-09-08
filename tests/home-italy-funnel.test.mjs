import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";
import "./helpers/register-ts-alias.mjs";

const {
  BUDGET_LAW_DEBT_MISSION,
  buildHomeItalyFunnel,
  COFOG_EVERYDAY_LABELS,
} = await import("../src/lib/home-italy-funnel.ts");

test("home Italy funnel exposes PA composition with everyday labels", () => {
  const funnel = buildHomeItalyFunnel(2024);
  assert.equal(funnel.pa.year, 2024);
  assert.ok(funnel.pa.totalEuro > 1_000_000_000_000);
  assert.ok(funnel.pa.gdpSharePercent > 40);
  assert.equal(funnel.pa.slices.length, 10);
  assert.equal(funnel.pa.slices[0]?.label, COFOG_EVERYDAY_LABELS.GF10);
  assert.match(funnel.pa.slices[0]?.label ?? "", /Pensioni/);
  assert.ok(funnel.pa.slices.some((slice) => slice.id === "GF07" && slice.href === "/spese/sanita"));
  assert.ok(funnel.pa.slices.some((slice) => slice.id === "GF02" && slice.href === null));
  assert.ok(funnel.pa.slices.some((slice) => slice.id === "GF03" && slice.href === null));
  assert.match(funnel.pa.moneyNature, /SEC 2010/);
  assert.match(funnel.pa.source.href, /^https:\/\//);
  const shareSum = funnel.pa.slices.reduce((sum, slice) => sum + slice.sharePercent, 0);
  assert.ok(shareSum > 99 && shareSum < 101, `quote PA fuori tolleranza: ${shareSum}`);
});

test("home Italy funnel keeps State budget separate and excludes debt from bars", () => {
  const funnel = buildHomeItalyFunnel(2024);
  assert.equal(funnel.state.year, 2024);
  assert.ok(funnel.state.debtEuro > 100_000_000_000);
  assert.ok(funnel.state.totalWithoutDebtEuro > 0);
  assert.ok(
    Math.abs(funnel.state.totalWithDebtEuro - funnel.state.totalWithoutDebtEuro - funnel.state.debtEuro) < 1,
  );
  assert.ok(!funnel.state.slices.some((slice) => slice.id === BUDGET_LAW_DEBT_MISSION));
  assert.match(funnel.state.caveat, /Debito pubblico/);
  assert.match(funnel.state.moneyNature, /stanziamenti/i);
  assert.ok(funnel.state.slices.some((slice) => /Pensioni/i.test(slice.label)));
});

test("home Italy funnel points to Comuni cash without leading the story", () => {
  const funnel = buildHomeItalyFunnel();
  assert.ok(funnel.comuni.totalEuro > 0);
  assert.match(funnel.comuni.moneyNature, /SIOPE/);
  assert.match(funnel.comuni.href, /^\/spese\?anno=/);
});

test("period selector can compress long year series behind Altri", async () => {
  const source = await readFile(new URL("../src/components/period-selector.tsx", import.meta.url), "utf8");
  const css = await readFile(new URL("../src/components/period-selector.module.css", import.meta.url), "utf8");
  assert.match(source, /recentLimit/);
  assert.match(source, /Altri/);
  assert.match(source, /olderMenu/);
  assert.match(source, /aria-expanded/);
  assert.match(source, /"use client"/);
  assert.doesNotMatch(source, /<details/);
  assert.match(css, /\.yearList \{/);
  assert.match(css, /\.years \{[\s\S]*?overflow: visible;/);
});

test("home page leads with Italy charts then keeps the municipal map", async () => {
  const [page, css, charts, chartCss] = await Promise.all([
    readFile(new URL("../src/app/page.tsx", import.meta.url), "utf8"),
    readFile(new URL("../src/app/home.module.css", import.meta.url), "utf8"),
    readFile(new URL("../src/components/home-italy-charts.tsx", import.meta.url), "utf8"),
    readFile(new URL("../src/components/home-italy-charts.module.css", import.meta.url), "utf8"),
  ]);
  assert.match(page, /buildHomeItalyFunnel/);
  assert.match(page, /HomeItalyCompositionChart/);
  assert.match(page, /Spesa pubblica totale/);
  assert.match(page, /Bilancio dello Stato/);
  assert.doesNotMatch(page, /Di cui bilancio dello Stato/);
  assert.match(page, /Dove va, in grandi voci/);
  assert.match(page, /Pagamenti effettuati dai Comuni/);
  assert.match(page, /ItalyRegionsMap/);
  assert.match(page, /SpendingComposition/);
  assert.match(page, /recentLimit=\{4\}/);
  assert.match(page, /snapshot fino al/);
  assert.match(page, /<aside className=\{styles\.readingPanel\} aria-labelledby="reading-title">/);
  assert.match(page, /Come leggere questi numeri/);
  assert.match(css, /\.italyBand \{/);
  assert.match(css, /\.italySummary \{/);
  assert.match(css, /\.italySplit \{/);
  assert.match(css, /grid-area: italy;/);
  assert.match(css, /\.leftRail \{/);
  assert.match(css, /\.rightRail \{/);
  assert.match(css, /align-content: start;/);
  assert.match(css, /align-items: start;/);
  assert.match(css, /"leftRail rightRail"/);
  assert.match(page, /styles\.leftRail/);
  assert.match(page, /styles\.rightRail/);
  assert.match(page, /styles\.rankPanel[\s\S]*styles\.mapPanel/);
  assert.match(css, /\.mapStage/);
  assert.match(chartCss, /--chart-data-primary/);
  assert.doesNotMatch(charts, /HomeShareStrip|SpendingBarChart|chartColor/);
  assert.doesNotMatch(page, /striscia/);
  assert.doesNotMatch(page, /—|–/);
  assert.doesNotMatch(css, /—|–/);
});
