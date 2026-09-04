import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

const [homePage, mapPanel, trendPanel, trendStyles, sourceIdentityMark, siopeRefreshWorkflow] = await Promise.all([
  readFile(new URL("../src/app/page.tsx", import.meta.url), "utf8"),
  readFile(new URL("../src/components/home-map-panel.tsx", import.meta.url), "utf8"),
  readFile(new URL("../src/components/home-trend-panel.tsx", import.meta.url), "utf8"),
  readFile(new URL("../src/components/home-trend-panel.module.css", import.meta.url), "utf8"),
  readFile(new URL("../src/components/source-identity-mark.tsx", import.meta.url), "utf8"),
  readFile(new URL("../.github/workflows/siope-refresh.yml", import.meta.url), "utf8"),
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
  assert.match(trendPanel, /role="button"/);
  assert.match(trendPanel, /tabIndex=\{isFocusable \? 0 : -1\}/);
  assert.match(trendPanel, /ArrowRight/);
  assert.match(trendPanel, /onPointerDown/);
  assert.match(trendPanel, /aria-describedby=\{displayedIndex === index \? tooltipId/);
  assert.match(trendPanel, /role="tooltip"/);
  assert.match(trendStyles, /prefers-reduced-motion: reduce/);
  assert.doesNotMatch(trendPanel, /Math\.random|fetch\(|mock|fixture/i);
});

test("home source marks resolve against the public source registry", () => {
  assert.match(homePage, /publicSources\.find/);
  assert.match(homePage, /Fonte homepage non registrata/);
  assert.match(homePage, /sourceCounts\.total - homeSources\.length/);
  assert.match(homePage, /SourceIdentityMark/);
  assert.match(sourceIdentityMark, /data-source-identity=\{source\}/);
  assert.match(sourceIdentityMark, /"rgs" \| "ipa" \| "anac" \| "istat"/);
  assert.match(sourceIdentityMark, /viewBox="0 0 52 26"/);
  assert.match(sourceIdentityMark, /strokeLinecap="round"/);
  assert.doesNotMatch(sourceIdentityMark, /https?:\/\/|<img\b/);
  assert.match(homePage, /SIOPE\\nPagamenti\\ncomunali/);
  assert.match(homePage, /aria-label=\{`\$\{source\.name\}, pubblicata da \$\{source\.owner\}`\}/);
  assert.doesNotMatch(homePage, /OpenCoesione<br\/>Progetti/);
});

test("home regional benchmark follows the same managed SIOPE snapshot as the map", () => {
  assert.match(homePage, /const siope = getSiopeMunicipalSnapshot\(year\)/);
  assert.match(homePage, /const rankedRegions = regionsByPerCapita\(siope\)/);
  assert.match(homePage, /rankedRegions\.slice\(0, 5\)/);
  assert.match(homePage, /rankedRegions\.slice\(-2\)/);
  assert.match(homePage, /siope\.nationalPerCapita/);
  assert.match(siopeRefreshWorkflow, /schedule:[\s\S]*?cron: "29 4 \* \* \*"/);
  assert.match(siopeRefreshWorkflow, /scripts\/etl\/siope_municipal_snapshot\.py/);
  assert.match(siopeRefreshWorkflow, /scripts\/etl\/siope_snapshot_check\.py/);
  assert.match(siopeRefreshWorkflow, /artifact-id: siope-municipal/);
});
