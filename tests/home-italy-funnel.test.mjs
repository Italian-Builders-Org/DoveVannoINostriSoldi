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
  assert.ok(funnel.pa.slices.length >= 6);
  assert.equal(funnel.pa.slices[0]?.label, COFOG_EVERYDAY_LABELS.GF10);
  assert.match(funnel.pa.slices[0]?.label ?? "", /Pensioni/);
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

test("home page is an Italy-first funnel without the municipal dashboard hero", async () => {
  const [page, css] = await Promise.all([
    readFile(new URL("../src/app/page.tsx", import.meta.url), "utf8"),
    readFile(new URL("../src/app/home.module.css", import.meta.url), "utf8"),
  ]);
  assert.match(page, /buildHomeItalyFunnel/);
  assert.match(page, /Spesa pubblica totale/);
  assert.match(page, /Di cui bilancio dello Stato/);
  assert.match(page, /Dove va, in grandi voci/);
  assert.doesNotMatch(page, /Pagamenti effettuati dai Comuni/);
  assert.doesNotMatch(page, /ItalyRegionsMap|RegionCrest|SpendingComposition/);
  assert.match(page, /<aside className=\{styles\.readingPanel\} aria-labelledby="reading-title">/);
  assert.match(page, /Come leggere questi numeri/);
  assert.match(css, /\.funnel \{/);
  assert.match(css, /\.barTrack \{/);
  assert.doesNotMatch(page, /—|–/);
  assert.doesNotMatch(css, /—|–/);
});
