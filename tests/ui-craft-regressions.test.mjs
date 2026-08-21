import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

async function source(path) {
  return readFile(new URL(path, import.meta.url), "utf8");
}

test("narrow responsive grids cannot exceed their container", async () => {
  const cases = [
    ["../src/app/enti/enti.module.css", "360px"],
    ["../src/app/partecipazioni/partecipazioni.module.css", "340px"],
    ["../src/app/controlli/controlli.module.css", "300px"],
    ["../src/app/metodologia/metodologia.module.css", "300px"],
  ];

  for (const [path, minimum] of cases) {
    assert.match(
      await source(path),
      new RegExp(`minmax\\(min\\(100%, ${minimum}\\), 1fr\\)`),
      `${path} deve restringersi fino alla larghezza del contenitore`,
    );
  }
});

test("the home has one semantic title without adding a visual hero", async () => {
  const [page, css] = await Promise.all([
    source("../src/app/page.tsx"),
    source("../src/app/home.module.css"),
  ]);

  assert.equal(page.match(/<h1\b/g)?.length, 1);
  assert.match(page, /<h1 className=\{styles\.pageTitle\}>Dove vanno i nostri soldi pubblici<\/h1>/);
  assert.match(css, /\.pageTitle \{[\s\S]*?clip-path: inset\(50%\);/);
});

test("information tooltips expose and dismiss their description", async () => {
  const tooltip = await source("../src/components/info-tooltip.tsx");

  assert.match(tooltip, /aria-describedby=\{open \? id : undefined\}/);
  assert.match(tooltip, /document\.addEventListener\("pointerdown", dismissOutside\)/);
  assert.match(tooltip, /setOpen\(\(current\) => !current\)/);
  assert.match(tooltip, /event\.key === "Escape"/);
});

test("the regional map has a deterministic fallback and roving keyboard focus", async () => {
  const map = await source("../src/components/italy-regions-map.tsx");

  assert.doesNotMatch(map, /randomRegionCode|scelta casualmente/);
  assert.match(map, /useState\("03"\)/);
  assert.match(map, /tabIndex=\{active \? 0 : -1\}/);
  assert.match(map, /"ArrowRight"|"ArrowDown"/);
  assert.match(map, /"ArrowLeft"|"ArrowUp"/);
  assert.match(map, /regionPathRefs\.current\.get\(nextCode\)\?\.focus\(\)/);
  assert.match(map, /<select value=\{selectedCode\}/);
});

test("reported chart styles stay within the registry design tokens", async () => {
  const [historyCss, historyChart, barCss, barChart, registryCss, registryChart, cohesionCss] =
    await Promise.all([
      source("../src/components/charts/spending-history-chart.module.css"),
      source("../src/components/charts/spending-history-chart.tsx"),
      source("../src/components/charts/spending-bar-chart.module.css"),
      source("../src/components/charts/spending-bar-chart.tsx"),
      source("../src/components/charts/registry-type-chart.module.css"),
      source("../src/components/charts/registry-type-chart.tsx"),
      source("../src/components/charts/cohesion-history-chart.module.css"),
    ]);

  assert.match(historyCss, /\.figureHeader h3 \{[\s\S]*?color: var\(--color-text\);/);
  for (const css of [historyCss, barCss, registryCss, cohesionCss]) {
    assert.doesNotMatch(css, /#ffffff/i);
  }
  for (const chart of [historyChart, barChart, registryChart]) {
    assert.doesNotMatch(chart, /radius=\{\[[^\]]*3/);
    assert.match(chart, /radius=\{0\}/);
  }
});

test("the fiscal layout uses only defined spacing tokens", async () => {
  const css = await source("../src/app/territori/fisco/fisco.module.css");
  assert.doesNotMatch(css, /var\(--space-5\)/);
  assert.match(css, /margin-bottom: var\(--space-6\)/);
});
