import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

const [homePage, mapPanel, trendPanel] = await Promise.all([
  readFile(new URL("../src/app/page.tsx", import.meta.url), "utf8"),
  readFile(new URL("../src/components/home-map-panel.tsx", import.meta.url), "utf8"),
  readFile(new URL("../src/components/home-trend-panel.tsx", import.meta.url), "utf8"),
]);

test("home dashboard contains no decorative numeric series or invented severity", () => {
  assert.doesNotMatch(homePage, /<Sparkline values=\{\[/);
  assert.doesNotMatch(homePage, /index < 2|ALTO|MEDIO/);
  assert.match(homePage, /<Sparkline values=\{siope\.monthly\.map\(\(point\) => point\.flow\)\}/);
  assert.match(homePage, /VERIFICA/);
  assert.match(homePage, /Pagamenti comunali/);
  assert.match(homePage, /Comuni con pagamenti/);
  assert.doesNotMatch(homePage, /Spesa pubblica totale|Enti coinvolti|Persone coperte/);
});

test("home map toggles between two verified SIOPE measures", () => {
  assert.match(mapPanel, /aria-label="Metrica della mappa"/);
  assert.match(mapPanel, /aria-pressed=\{metric === "total"\}/);
  assert.match(mapPanel, /aria-pressed=\{metric === "per-capita"\}/);
  assert.match(mapPanel, /metric=\{metric\}/);
  assert.match(mapPanel, /region\.value/);
  assert.match(mapPanel, /region\.perCapita/);
});

test("home trend toggles using only the committed SIOPE monthly series", () => {
  assert.match(trendPanel, /monthly\.map/);
  assert.match(trendPanel, /point\.cumulative/);
  assert.match(trendPanel, /point\.flow/);
  assert.doesNotMatch(trendPanel, /populationCovered|per-capita/);
  assert.match(trendPanel, /aria-label="Metrica del trend"/);
  assert.match(trendPanel, /const maximum = Math\.max\(\.\.\.values, 0\)/);
  assert.match(trendPanel, /aria-live="polite"/);
  assert.doesNotMatch(trendPanel, /Math\.random|fetch\(|mock|fixture/i);
});

test("home source marks resolve against the public source registry", () => {
  assert.match(homePage, /publicSources\.find/);
  assert.match(homePage, /Fonte homepage non registrata/);
  assert.match(homePage, /sourceCounts\.total - homeSources\.length/);
  assert.doesNotMatch(homePage, /OpenCoesione<br\/>Progetti/);
});
