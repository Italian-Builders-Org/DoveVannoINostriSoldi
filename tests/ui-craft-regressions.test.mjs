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

test("the home has one visible semantic title and keeps data exploration accessible", async () => {
  const [page, css] = await Promise.all([
    source("../src/app/page.tsx"),
    source("../src/app/home.module.css"),
  ]);

  assert.equal(page.match(/<h1\b/g)?.length, 1);
  assert.match(page, /<h1 className=\{styles\.pageTitle\}>Dove vanno[\s\S]*?i nostri soldi\?[\s\S]*?<\/h1>/);
  assert.match(css, /\.pageTitle \{[\s\S]*?font-family: var\(--font-heading\);/);
  assert.doesNotMatch(css, /\.pageTitle \{[\s\S]*?clip-path: inset\(50%\);/);
  assert.match(css, /\.hub \{/);
});

test("home anomaly panels keep their content inside the available width", async () => {
  const [page, css] = await Promise.all([
    source("../src/app/page.tsx"),
    source("../src/app/home.module.css"),
  ]);
  const anomalyRule = css.match(/\.anomalyItem \{([^}]*)\}/)?.[1] ?? "";
  assert.match(anomalyRule, /min-width: 0/);
  assert.match(css, /\.anomaliesPanel \{[^}]*?min-width: 0;/);
  assert.doesNotMatch(page, /ContractsIcon|ShieldCheck|CalendarClockIcon/);
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
    source("../src/app/spese/panoramica/panoramica.module.css"),
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
  assert.match(globals, /@media \(max-width: 1099px\)/);
  assert.match(globals, /\.header-search-root\[data-expanded="true"\] \.header-search \{ display: block; \}/);
});

test("CI verifies every main commit and uses the current artifact runtime", async () => {
  const [ci, mefRefresh, harness] = await Promise.all([
    source("../.github/workflows/ci.yml"),
    source("../.github/workflows/mef-irpef-refresh.yml"),
    source("../scripts/browser/harness.mjs"),
  ]);

  assert.match(ci, /github\.event\.pull_request\.number \|\| github\.sha/);
  assert.doesNotMatch(ci, /github\.event\.pull_request\.number \|\| github\.ref/);
  // upload-artifact must be SHA-pinned (supply-chain security).
  assert.doesNotMatch(`${ci}\n${mefRefresh}`, /actions\/upload-artifact@v\d/);
  assert.equal((`${ci}\n${mefRefresh}`.match(/actions\/upload-artifact@[0-9a-f]{40}/g) ?? []).length, 9);
  assert.match(ci, /name: health-spending-history\s+path: artifacts\/browser\/health-history\//);
  assert.match(ci, /name: home-composition-layout\n\s+path: artifacts\/browser\/home-composition\//);
  assert.match(ci, /name: Upload procurement award-year screenshots\n\s+if: always\(\)\n\s+uses: actions\/upload-artifact@[0-9a-f]{40}[^\n]*\n\s+with:\n\s+name: procurement-award-year-screenshots\n\s+path: artifacts\/browser\/procurement-award-year\//);
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
  for (const chart of [historyChart, barChart]) {
    assert.doesNotMatch(chart, /radius=\{\[[^\]]*3/);
    assert.match(chart, /radius=\{0\}/);
  }
  // The IPA type list is plain HTML bars: same square-ended data roles.
  assert.doesNotMatch(registryChart, /recharts/);
  assert.doesNotMatch(registryCss, /border-radius/);
  assert.match(registryCss, /background: var\(--chart-data-primary\)/);
});

test("quantitative bars reserve red for alerts and actions", async () => {
  const [tokens, spending, cohesion, companies] = await Promise.all([
    source("../src/app/design-system.css"),
    source("../src/app/spese/spese.module.css"),
    source("../src/app/coesione/coesione.module.css"),
    source("../src/app/imprese/imprese.module.css"),
  ]);

  assert.match(tokens, /--chart-primary: var\(--chart-data-primary\);/);
  assert.match(spending, /\.titleTrack i \{[\s\S]*?background: var\(--chart-data-primary\);/);
  assert.match(spending, /\.monthList li > i > b \{[\s\S]*?background: var\(--chart-data-primary\);/);
  assert.match(cohesion, /\.statusList li > i > b,[\s\S]*?background: var\(--chart-progress\);/);
  assert.match(companies, /\.sectorList i b \{[\s\S]*?background: var\(--chart-data-primary\);/);
});

test("strong civic surfaces use defined foreground tokens", async () => {
  const [tokens, cohesionCss] = await Promise.all([
    source("../src/app/design-system.css"),
    source("../src/app/coesione/coesione.module.css"),
  ]);

  assert.match(tokens, /--color-on-strong:\s*#[0-9a-f]{6};/i);
  assert.match(tokens, /--color-on-strong-muted:\s*#[0-9a-f]{6};/i);
  assert.match(tokens, /--space-5:\s*20px;/);
  // The trace panel's component-specific foreground contrast is owned by
  // tests/coesione-ui.test.mjs, including the mutation-sensitive WCAG check.
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
  assert.match(page, /data-municipality-ranking=\{metric\}/);
  assert.match(page, /"per-abitante", "per-km2", "totale"/);
  assert.match(page, /\{municipality\.province\} · \{municipality\.region\}/);
  assert.match(page, /const isPartialYear = partialMonth\(data\) !== null/);
  assert.doesNotMatch(page, /latestMonth < 12/);
});

test("territorial comparisons disclose denominator coverage and population reference", async () => {
  const [territories, economics] = await Promise.all([
    source("../src/app/territori/page.tsx"),
    source("../src/app/enti/[codice]/municipality-economics.tsx"),
  ]);

  assert.match(territories, /Comuni trovati nel perimetro/);
  assert.match(territories, /Comuni con movimenti SIOPE e superficie ISTAT valida/);
  assert.match(territories, /valori per abitante, per km², totali/);
  assert.match(economics, /peer\.populationYear/);
  assert.match(economics, /Popolazione ISTAT/);
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

test("secondary pages keep route identity and a restrained mobile heading", async () => {
  const [entities, stateCss] = await Promise.all([
    source("../src/app/enti/page.tsx"),
    source("../src/app/stato/stato.module.css"),
  ]);

  assert.match(
    entities,
    /export async function generateMetadata\([\s\S]*?Promise<Metadata>[\s\S]*?title: "Registro degli enti pubblici"/,
  );
  assert.match(stateCss, /@media \(max-width: 720px\) \{[\s\S]*?\.title \{[\s\S]*?font-size: clamp\(32px, 9vw, 42px\);/);
});

test("the relationship explorer uses its module styles and keeps result context", async () => {
  const explorer = await source("../src/app/esplora/EsploraSearch.tsx");

  assert.match(explorer, /import styles from "\.\/esplora\.module\.css";/);
  assert.match(explorer, /className=\{styles\.searchInput\}/);
  assert.match(explorer, /className=\{styles\.relationList\}/);
  assert.match(explorer, /r\.period/);
  assert.match(explorer, /euro\.format\(r\.amount\)/);
  assert.match(explorer, /r\.confidence_note/);
  assert.doesNotMatch(explorer, /className="(?:search-input|relation-list|relation-item)"/);
});

test("the home links each destination once per section and styles sources like the rest of the site", async () => {
  const [page, pathways, previews, pathwaysCss] = await Promise.all([
    source("../src/app/page.tsx"),
    source("../src/components/home-pathways.tsx"),
    source("../src/components/home-data-previews.tsx"),
    source("../src/components/home-pathways.module.css"),
  ]);
  // The header already offers "Esplora i dati"; the hero does not repeat it.
  assert.doesNotMatch(page, /href="#esplora"/);
  const politics = pathways.slice(pathways.indexOf('id="politica-istituzioni"'), pathways.indexOf('id="economia-societa"'));
  const institutions = previews.slice(previews.indexOf("export function InstitutionsPreview"), previews.indexOf("export function EconomyPreviews"));
  assert.equal((politics + institutions).match(/href="\/governi"/g)?.length, 1);
  assert.equal((politics + institutions).match(/href="\/parlamento"/g)?.length, 1);
  // Source links take the site link colour, as on /spese.
  assert.doesNotMatch(pathwaysCss, /\.source a \{[^}]*color: inherit/);
});

test("dark row dividers stay visible on raised cards and /cerca rows use the divider token", async () => {
  const [tokens, cerca] = await Promise.all([source("../src/app/design-system.css"), source("../src/app/cerca/cerca.module.css")]);
  const dark = tokens.match(/\[data-theme="dark"\]\s*\{([\s\S]*?)\n\}/)[1];
  const hex = (name) => [...dark.matchAll(new RegExp(`${name}: (#[\\da-f]{6});`, "gi"))].at(-1)?.[1];
  const luminance = (value) => [1, 3, 5].map((o) => parseInt(value.slice(o, o + 2), 16) / 255)
    .map((n) => n <= 0.04045 ? n / 12.92 : ((n + 0.055) / 1.055) ** 2.4)
    .reduce((sum, channel, index) => sum + channel * [0.2126, 0.7152, 0.0722][index], 0);
  const ratio = (a, b) => { const [x, y] = [luminance(a), luminance(b)]; return (Math.max(x, y) + 0.05) / (Math.min(x, y) + 0.05); };
  // neutral-300 is the row/table divider of /fonti and /enti: at 1.27:1 it vanished in dark.
  assert.ok(ratio(hex("--color-neutral-300"), hex("--color-raised")) >= 1.5, "dark neutral-300 on raised");
  assert.ok(luminance(hex("--color-neutral-300")) > luminance(hex("--color-neutral-200")), "neutral scale order");
  assert.doesNotMatch(dark, /--color-divider: color-mix/, "one dark divider declaration");
  assert.match(cerca, /\.suggestions li \{ border-top: 1px solid var\(--color-divider\); \}/);
  // Shared primitives (.table rows, search options, notices) draw row lines
  // with the divider token: neutral-200 is a fill, 1.03:1 on dark cards.
  const globals = await source("../src/app/globals.css");
  for (const css of [tokens, globals]) assert.doesNotMatch(css, /border[a-z-]*: 1px solid var\(--color-neutral-200\)/);
});

test("panoramica: the mobile '?' column sits before the share, not after the label", async () => {
  const css = await source("../src/components/home-italy-charts.module.css");
  const mobile = css.match(/@media \(max-width: 640px\) \{[\s\S]*?\n\}/)[0];
  assert.doesNotMatch(mobile, /max-content/, "a content-sized copy column moves the '?' with the label");
  assert.match(mobile, /"copy info share chevron"/);
});

test("panoramica: period selectors end at the card edge and the map box uses plain links", async () => {
  const css = await source("../src/app/spese/panoramica/panoramica.module.css");
  assert.match(css, /\.sectionHeading \.periodSelector \{[^}]*margin-inline-start: auto;/);
  assert.match(css, /\.sectionHeading \.periodSelector \{[^}]*width: auto;/);
  const span = css.match(/\.mapStats span \{[^}]*\}/)[0];
  assert.doesNotMatch(span, /uppercase/, "letter-spaced caps orphan the year on wrap");
  assert.match(css, /\.mapStats a \{[^}]*color: var\(--color-accent-700\);/);
});

test("footer: touch targets reach 44px and social glyphs align with the text edge", async () => {
  const css = await source("../src/app/globals.css");
  const coarse = css.match(/@media \(pointer: coarse\), \(max-width: 620px\) \{[\s\S]*?\n\}/)[0];
  assert.match(coarse, /\.footer-actions a::after[^{]*\{[^}]*inset: 0 -9px;/);
  assert.match(css, /\.footer-social ul \{[^}]*margin-inline-end: -12\.5px;/);
  assert.match(css, /@media \(max-width: 900px\) \{[^@]*\.footer-social ul \{ margin-inline: -12\.5px 0; \}/);
});

test("home cards share one label style and one footer link style", async () => {
  const [pathways, home] = await Promise.all([source("../src/components/home-pathways.module.css"), source("../src/app/home.module.css")]);
  assert.match(pathways, /\.previewHeader h3 \{ margin: 0; font: inherit; color: inherit; \}/);
  assert.match(home, /\.anomaliesHeader h3 \{[^}]*font-size: 13px; font-weight: 500;[^}]*color: var\(--color-neutral-600\);/);
  const link = /font-size: 14px; font-weight: 600; color: var\(--color-accent-700\);/;
  assert.match(pathways.match(/\.previewLink \{[^}]*\}/)[0], link);
  assert.match(home.match(/\.anomaliesLink \{[^}]*\}/)[0], link);
  assert.match(pathways.match(/\.institutionLinks a \{[^}]*\}/)[0], /font-weight: 600;/);
});

test("disclosures share one label style and list expanders alone take the accent", async () => {
  // Regression (round 5): the same <summary> read regular, bold, accent or
  // letter-spaced caps depending on the page.
  const css = await source("../src/app/globals.css");
  const base = css.match(/:where\(details\) > summary \{[^}]*\}/)[0];
  for (const rule of [/font-weight: 600;/, /color: var\(--color-text\);/, /text-transform: none;/, /letter-spacing: normal;/]) assert.match(base, rule);
  const chevron = css.match(/:where\(details\) > summary:not\(:has\(svg\)\)::after \{[^}]*\}/)[0];
  assert.match(chevron, /width: 16px;[\s\S]*height: 16px;[\s\S]*margin-left: 8px;/);
  assert.match(css, /summary\.disclosure-more \{ color: var\(--color-accent-700\); \}/);
  // Shared disclosures must not restyle the label back.
  assert.doesNotMatch(css.match(/\.chart-data summary \{[^}]*\}/)[0], /color|font-weight/);
  assert.doesNotMatch(await source("../src/components/spending-reading-guide.module.css"), /summary \{[^}]*font-weight/);
});

test("an external or internal link arrow never wraps alone onto the next line", async () => {
  // Regression (/fonti): "... (EPEA)" then "↗" alone on the next line. An
  // inline-block glyph leaves a break opportunity before it; an inline box
  // that starts with a word joiner (U+2060) does not.
  const css = await source("../src/app/globals.css");
  const glyph = css.match(/\.link-arrow::after,\s*\.link-external::after \{[^}]*\}/)[0];
  assert.match(glyph, /content: "\\2060";/);
  assert.match(glyph, /display: inline;/);
  assert.doesNotMatch(glyph, /inline-block/);
});

test("the current breadcrumb reads the same on every page and page intros share one rhythm", async () => {
  const [nav, css] = await Promise.all([source("../src/components/section-nav.module.css"), source("../src/app/globals.css")]);
  // /cerca and /dvns-index print the current crumb as a span: it must match
  // the section picker (body colour, 600), not the grey links before it.
  assert.match(nav, /\.breadcrumb \[aria-current="page"\] \{[^}]*color: var\(--color-text\);[^}]*font-weight: 600;/);
  assert.match(css, /\.page-intro p \{[^}]*margin: 12px 0 0;[^}]*font-size: 16px;/);
  assert.match(css, /\.page > \.page-intro \{[^}]*margin-bottom: var\(--space-2\);/);
});
