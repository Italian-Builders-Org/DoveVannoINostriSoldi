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
    ["../src/app/controlli/controlli.module.css", "280px"],
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

test("information tooltips clamp to the viewport and keep their heading trigger stable", async () => {
  const [tooltip, tooltipCss, home, globals] = await Promise.all([
    source("../src/components/info-tooltip.tsx"),
    source("../src/components/info-tooltip.module.css"),
    source("../src/app/home.module.css"),
    source("../src/app/globals.css"),
  ]);

  assert.match(tooltip, /getBoundingClientRect\(\)/);
  assert.match(tooltip, /window\.innerWidth/);
  assert.match(tooltip, /left: `\$\{tooltipLeft\}px`/);
  assert.match(tooltip, /data-positioned=\{tooltipLeft !== null\}/);
  assert.match(
    tooltipCss,
    /\.tooltip\[data-open="true"\]\[data-positioned="false"\][\s\S]*?visibility: hidden;/,
  );
  assert.match(home, /\.panelHead > h2 \{[\s\S]*?flex: 1 1 auto;[\s\S]*?min-width: 0;/);
  assert.match(globals, /@media \(min-width: 901px\) and \(max-width: 980px\)/);
  assert.match(globals, /\.header-search \{ order: 3; width: 100%; \}/);
});

test("CI verifies every main commit and uses the current artifact runtime", async () => {
  const [ci, mefRefresh, harness] = await Promise.all([
    source("../.github/workflows/ci.yml"),
    source("../.github/workflows/mef-irpef-refresh.yml"),
    source("../scripts/browser/harness.mjs"),
  ]);

  assert.match(ci, /github\.event\.pull_request\.number \|\| github\.sha/);
  assert.doesNotMatch(ci, /github\.event\.pull_request\.number \|\| github\.ref/);
  // upload-artifact must be SHA-pinned (no tag refs) and appear exactly 4
  // times across ci.yml and mef-irpef-refresh.yml.
  assert.doesNotMatch(`${ci}\n${mefRefresh}`, /actions\/upload-artifact@v\d/);
  assert.equal((`${ci}\n${mefRefresh}`.match(/actions\/upload-artifact@[0-9a-f]{40}/g) ?? []).length, 4);
  assert.match(harness, /const BROWSER_LAUNCH_TIMEOUT_MS = 60_000;/);
  assert.match(harness, /timeoutMs = BROWSER_LAUNCH_TIMEOUT_MS/);
});

test("Lighthouse budgets use a three-run median instead of a single noisy sample", async () => {
  const lighthouse = await source("../scripts/lighthouse_budget.mjs");

  assert.match(lighthouse, /const LIGHTHOUSE_RUN_COUNT = 3;/);
  assert.match(lighthouse, /function medianMetricValues\(runs\)/);
  assert.match(lighthouse, /medianMetricValues\(runs\.map\(\(run\) => run\.values\)\)/);
  assert.match(lighthouse, /irpef-lighthouse-summary\.json/);
});

test("the regional map has a deterministic fallback and roving keyboard focus", async () => {
  const map = await source("../src/components/italy-regions-map.tsx");

  assert.doesNotMatch(map, /randomRegionCode|scelta casualmente/);
  assert.match(map, /useState\("03"\)/);
  assert.match(map, /useState<string \| null>\(null\)/);
  assert.match(map, /const displayedCode = selectionLocked \? selectedCode : hoveredCode \?\? selectedCode/);
  assert.match(map, /onPointerEnter=\{\(\) => previewRegion\(geometry\.code\)\}/);
  assert.match(map, /onClick=\{\(\) => selectRegion\(geometry\.code\)\}/);
  assert.match(map, /styles\.outline/);
  assert.match(map, /pointerEvents="none"/);
  assert.match(map, /tabIndex=\{focusable \? 0 : -1\}/);
  assert.match(map, /"ArrowRight"|"ArrowDown"/);
  assert.match(map, /"ArrowLeft"|"ArrowUp"/);
  assert.match(map, /regionPathRefs\.current\.get\(nextCode\)\?\.focus\(\)/);
  assert.match(map, /<select[\s\S]*?value=\{selectedCode\}/);
});

test("the mobile region selector is sorted once with Italian collation", async () => {
  const map = await source("../src/components/italy-regions-map.tsx");

  assert.match(map, /const italianRegionCollator = new Intl\.Collator\("it"\);/);
  assert.match(map, /const regionOptions = Object\.entries\(REGION_NAME_BY_ISTAT_CODE\)\.sort/);
  assert.match(map, /\{regionOptions\.map\(\(\[code, name\]\) => \(/);
  assert.match(map, /data-region-selector="true"/);
});

test("the regional map redraws selected and hovered borders above all region fills", async () => {
  const css = await source("../src/components/italy-regions-map.module.css");

  assert.match(css, /\.outline \{[\s\S]*?fill: none;[\s\S]*?pointer-events: none;/);
  assert.match(css, /\.hoverOutline \{ stroke-width: 2; \}/);
  assert.match(css, /\.selectedOutline \{ stroke-width: 2\.5; \}/);
  assert.match(css, /\.selectedOutline\.hoverOutline \{ stroke-width: 3; \}/);
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

test("strong civic surfaces use defined foreground tokens", async () => {
  const [tokens, cohesionCss] = await Promise.all([
    source("../src/app/design-system.css"),
    source("../src/app/coesione/coesione.module.css"),
  ]);

  assert.match(tokens, /--color-on-strong:\s*#[0-9a-f]{6};/i);
  assert.match(tokens, /--color-on-strong-muted:\s*#[0-9a-f]{6};/i);
  assert.match(tokens, /--space-5:\s*20px;/);
  assert.match(cohesionCss, /color:\s*var\(--color-on-strong\);/);
  assert.match(cohesionCss, /color:\s*var\(--color-on-strong-muted\);/);
  assert.doesNotMatch(cohesionCss, /var\(--color-neutral-0\)/);
});

test("the fiscal layout uses only defined spacing tokens", async () => {
  const [fiscalCss, spendingCss] = await Promise.all([
    source("../src/app/territori/fisco/fisco.module.css"),
    source("../src/app/spese/spese.module.css"),
  ]);
  assert.doesNotMatch(`${fiscalCss}\n${spendingCss}`, /var\(--space-5\)/);
  assert.match(fiscalCss, /margin-bottom: var\(--space-6\)/);
});

test("municipality rankings expose province and region as visible context", async () => {
  const [page, contract] = await Promise.all([
    source("../src/app/territori/page.tsx"),
    source("../src/lib/siope-snapshot.ts"),
  ]);

  assert.match(contract, /province: string;/);
  assert.match(page, /data-municipality-ranking="per-capita"/);
  assert.match(page, /\{municipality\.province\} · \{municipality\.region\}/);
});

test("the narrow mobile header never collapses the wordmark into a text column", async () => {
  const [globalsCss, navigation] = await Promise.all([
    source("../src/app/globals.css"),
    source("../src/components/navigation.tsx"),
  ]);

  assert.match(
    globalsCss,
    /@media \(max-width: 460px\) \{[\s\S]*?\.brand-text \{ display: none; \}[\s\S]*?\}/,
  );
  assert.match(navigation, /className="brand" aria-label="Dove vanno i nostri soldi, home"/);
});
