import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

// Round 6 screenshot review of /fonti, /enti and /spese/panoramica: each case
// below is a defect two critics saw, pinned at the rule that caused it.
const read = (path) => readFile(new URL(path, import.meta.url), "utf8");
const rule = (css, selector) => {
  const escaped = selector.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  return css.match(new RegExp(`(?:^|\\n)${escaped} \\{[^}]*\\}`))?.[0] ?? "";
};

test("/fonti: a theme sub-heading outranks the source names under it", async () => {
  const css = await read("../src/app/fonti/fonti.module.css");
  const heading = rule(css, ".sources .clusterRow th");
  assert.match(heading, /color: var\(--color-text\);/, "grey sub-heading read weaker than its rows");
  assert.match(heading, /font-size: 14px;/, "one pixel above the 13px source names");
  assert.match(heading, /font-weight: 600;/);
});

test("/fonti: external links carry the shared arrow glued to their last word", async () => {
  const page = await read("../src/app/fonti/page.tsx");
  assert.doesNotMatch(page, /↗/, "a text arrow wraps alone onto its own line");
  // An inline <svg> is display:block site-wide (globals.css), so it always
  // dropped onto its own line. The shared .link-external glyph is a mask
  // joined to the last word by U+2060 and cannot wrap alone.
  assert.doesNotMatch(page, /<Icon name="arrow-up-right"/);
  assert.match(page, /function External\(\{ label \}: \{ label: string \}\) \{\s*return <span className="link-external">\{label\}<\/span>;/);
});

test("/fonti: a sub-group count never splits '11' from 'fonti'", async () => {
  const css = await read("../src/app/fonti/fonti.module.css");
  assert.match(rule(css, ".groupCount"), /white-space: nowrap;/);
});

test("/fonti: a shared cadence shows as a value in the table, as a note on phone cards", async () => {
  const [css, page] = await Promise.all([read("../src/app/fonti/fonti.module.css"), read("../src/app/fonti/page.tsx")]);
  // A lone muted dot in eleven rows read as missing data.
  assert.doesNotMatch(page, /<span aria-hidden="true">·<\/span>\s*<span className=\{styles\.visuallyHidden\}>come indicato nel gruppo/);
  assert.doesNotMatch(page, /cadenceShared/);
  // The heading note repeats the column on wide screens: phones only.
  assert.match(css, /\n\.clusterNote \{[^}]*display: none;/);
  assert.match(css, /@media \(max-width: 639px\) \{[\s\S]*\.clusterNote \{ display: block; \}/);
});

test("/enti: grouped lists end without a stray divider and figures share one weight", async () => {
  const css = await read("../src/app/enti/enti.module.css");
  assert.match(css, /\.typeGroup:last-child \{ border-bottom: 0; \}/);
  assert.match(rule(css, ".edgeTable td.num"), /font-weight: 600;[^}]*font-variant-numeric: tabular-nums;/);
});

test("/spese/panoramica: the reading guide does not stack a second rule on the section divider", async () => {
  const css = await read("../src/components/spending-reading-guide.module.css");
  assert.doesNotMatch(css, /border-block:/);
  assert.match(rule(css, ".guide"), /border-top: 1px solid/);
});

test("footer: on phones the service links sit in an even grid, never one word alone on a row", async () => {
  const css = await read("../src/app/globals.css");
  assert.match(css, /@media \(max-width: 620px\) \{\s*\.footer-actions \{ display: grid; grid-template-columns: repeat\(4, max-content\);/);
});

test("dark theme: card row dividers use the divider token, never the near-invisible neutral-200", async () => {
  const { readdir } = await import("node:fs/promises");
  const offenders = [];
  for (const entry of await readdir(new URL("../src", import.meta.url), { recursive: true })) {
    if (!entry.endsWith(".css") || /assistant/.test(entry)) continue;
    const css = await read(`../src/${entry}`);
    if (/border[a-z-]*:\s*1px solid var\(--color-neutral-200\)/.test(css)) offenders.push(entry);
  }
  assert.deepEqual(offenders, []);
});

test("disclosures use the shared summary style; list expanders are marked disclosure-more", async () => {
  const [entiCss, entiPage, fontiCss, fontiPage] = await Promise.all([
    read("../src/app/enti/enti.module.css"),
    read("../src/app/enti/page.tsx"),
    read("../src/app/fonti/fonti.module.css"),
    read("../src/app/fonti/page.tsx"),
  ]);
  assert.doesNotMatch(entiCss, /\.details summary \{/, "letter-spaced caps summary on 'Cosa sono le partecipate'");
  const index = fontiCss.match(/\.publisherIndex > summary \{[^}]*\}/)?.[0] ?? "";
  assert.doesNotMatch(index, /font-|text-transform|letter-spacing|color/, "type comes from the shared summary style");
  // The class sits on the <summary> (globals.css styles it there).
  assert.match(entiPage, /<details className=\{styles\.moreEntities\}>\s*<summary className="disclosure-more">/);
  assert.match(fontiPage, /<details className=\{styles\.coverage\}>\s*<summary className="disclosure-more">/);
});

test("/enti: KPI values share a row line even when a label wraps", async () => {
  const css = await read("../src/app/enti/enti.module.css");
  assert.match(rule(css, ".fiveUp > div"), /grid-template-rows: subgrid;/);
  assert.match(rule(css, ".fiveUp > div"), /grid-row: span 3;/);
});

test("/enti: section meta lines sit close to their title and clear the divider", async () => {
  const css = await read("../src/app/enti/enti.module.css");
  const head = rule(css, ".resultsHead");
  assert.match(head, /row-gap: 8px;/);
  assert.match(head, /margin-bottom: 12px;/);
  assert.match(css, /\.resultsHead > h2 \{ margin: 0; \}/);
});

test("/enti: 'Tutte le partecipazioni' is a semibold link, at the card end on phones", async () => {
  const [page, css] = await Promise.all([read("../src/app/enti/page.tsx"), read("../src/app/enti/enti.module.css")]);
  const links = page.match(/href="\/partecipazioni"/g) ?? [];
  assert.equal(links.length, 2, "one in the head on wide screens, one after the table on phones");
  assert.match(rule(css, ".allLink"), /font-weight: 600;/);
  assert.match(css, /@media \(max-width: 620px\) \{[\s\S]*\.headLink \{ display: none; \}/);
});

test("/spese/panoramica: every card action is a text link with a chevron", async () => {
  const page = await read("../src/app/spese/panoramica/page.tsx");
  assert.doesNotMatch(page, /btn btn-secondary/);
  assert.doesNotMatch(page, /Apri Territori/);
  assert.match(page, /Dettaglio delle spese\s*<Icon name="chevron-right"/);
  assert.match(page, /Apri i territori\s*<Icon name="chevron-right"/);
});

test("/spese/panoramica: the '?' stays right after the last word of a wrapped title", async () => {
  const css = await read("../src/app/spese/panoramica/panoramica.module.css");
  const wrapper = rule(css, ".headingWithTooltip");
  // The break between the title and the button belongs to their common
  // parent: nowrap there, normal wrapping inside the title.
  assert.match(wrapper, /display: block;/);
  assert.match(wrapper, /white-space: nowrap;/);
  assert.match(css, /\.headingWithTooltip > h2 \{[^}]*display: inline;[^}]*white-space: normal;/);
});

test("/spese/panoramica: year labels clear the lowest axis value; the map box fits one line", async () => {
  const [charts, map] = await Promise.all([
    read("../src/components/home-italy-charts.module.css"),
    read("../src/components/italy-regions-map.module.css"),
  ]);
  assert.match(rule(charts, ".trendPlot"), /row-gap: 12px;/, "'820' overlapped '2014' with a 6px gap");
  assert.match(rule(charts, ".trendTick,\n.trendYear"), /font-size: 11px;/);
  assert.match(rule(map, ".layout"), /grid-template-columns: minmax\(0, 1fr\) 260px;/);
});
