import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

// One arrow vocabulary across the site: the icon module's chevrons for
// internal navigation and disclosures, arrow-up-right for external links.
// CSS-only glyphs (summary markers, list rows) reuse the same path data, so
// a redrawn icon cannot drift away from its CSS twin.
const { ICON_PATHS } = await import("../src/components/icon-paths.ts");
const read = (path) => readFileSync(new URL(`../${path}`, import.meta.url), "utf8");
const globals = read("src/app/globals.css");
const tokens = read("src/app/design-system.css");

function glyphPaths(name) {
  const declaration = globals.match(new RegExp(`--glyph-${name}: url\\("data:image/svg\\+xml,([^"]+)"\\);`));
  assert.ok(declaration, `--glyph-${name} missing from globals.css`);
  const svg = decodeURIComponent(declaration[1]);
  assert.match(svg, /viewBox='0 0 24 24'/, name);
  assert.match(svg, /stroke-width='1\.75'/, name);
  assert.match(svg, /stroke-linecap='round'/, name);
  return [...svg.matchAll(/ d='([^']+)'/g)].map((match) => match[1]);
}

test("CSS chevron glyphs draw exactly the icon-module chevrons", () => {
  for (const name of ["chevron-down", "chevron-right", "arrow-up-right"]) {
    assert.deepEqual(glyphPaths(name), ICON_PATHS[name], name);
  }
});

test("every <details> trades the native triangle for one rotating chevron", () => {
  // Regression: summaries showed the UA ▸ marker next to icon chevrons and
  // text arrows elsewhere on the same page.
  assert.match(globals, /:where\(details\) > summary \{[^}]*list-style: none;/);
  assert.match(globals, /:where\(details\) > summary::-webkit-details-marker \{ display: none; \}/);
  const marker = globals.match(/:where\(details\) > summary:not\(:has\(svg\)\)::after \{([^}]*)\}/)?.[1];
  assert.ok(marker, "shared summary chevron rule missing");
  assert.match(marker, /mask: var\(--glyph-chevron-down\)/);
  assert.match(marker, /transition: transform 200ms var\(--ease-out\)/);
  assert.match(globals, /:where\(details\[open\]\) > summary::after \{ transform: rotate\(180deg\); \}/);
  // Same selector as the rule it cancels, or the lower specificity loses.
  assert.match(globals, /@media \(prefers-reduced-motion: reduce\) \{\s*:where\(details\) > summary:not\(:has\(svg\)\)::after \{ transition: none; \}/);
});

test("summaries that draw their own indicator do not get a second one", () => {
  // A module that writes content into summary::after would be clipped to the
  // shared chevron mask: "+", "▾" and border chevrons must be gone.
  for (const file of [
    "src/app/comuni/comuni.module.css",
    "src/components/site-directory.module.css",
    "src/components/real-estate-map.module.css",
    "src/app/dvns-index/dvns-index.module.css",
  ]) {
    const css = read(file);
    assert.doesNotMatch(css, /summary::after \{ content: "[^"]+"/, file);
    assert.doesNotMatch(css, /[▾▴]/, file);
  }
  // /fonti keeps a text toggle ("Mostra tutto") in summary::after: it must
  // drop the shared mask and rotation, or the words render as a chevron.
  const coverage = read("src/app/fonti/fonti.module.css").match(/\n\.coverage summary::after \{([^}]*)\}/)?.[1] ?? "";
  assert.match(coverage, /mask: none;/);
  assert.match(coverage, /transform: none;/);
  assert.doesNotMatch(read("src/app/enti/enti.module.css"), /typeGroup[^{]*::after \{[^}]*border-right/);
  for (const file of ["src/components/integrated-domain-hub.module.css", "src/components/editorial-topic-page.module.css"]) {
    const css = read(file);
    assert.match(css, /summary::after \{ content: none; \}/, `${file}: left chevron plus shared chevron`);
    assert.match(css, /mask: var\(--glyph-chevron-right\)/, `${file}: border-drawn chevron`);
  }
});

test("shared components and the home use icons, not text arrows", () => {
  for (const file of [
    "src/components/home-data-previews.tsx",
    "src/components/home-pathways.tsx",
    "src/components/site-directory.tsx",
    "src/components/editorial-topic-page.tsx",
    "src/components/pagination.tsx",
    "src/app/page.tsx",
    "src/components/state-spending-history-section.tsx",
    "src/components/mef-irpef-swiss-border-note.tsx",
    "src/components/mop/mop-cost-panel.tsx",
  ]) {
    assert.doesNotMatch(read(file), /[→↗]/, file);
  }
  assert.doesNotMatch(read("src/components/home-pathways.module.css"), /border-right: 1\.5px solid currentColor/);
});

test("stat strip dividers stay visible on dark cards", () => {
  const darkBlock = tokens.match(/\[data-theme="dark"\]\s*\{([\s\S]*?)\n\}/)[1];
  const divider = darkBlock.match(/--color-divider: (#[\da-f]{6});/i)?.[1];
  const raised = darkBlock.match(/--color-raised: (#[\da-f]{6});/i)?.[1];
  assert.ok(divider && raised, "dark --color-divider missing");
  const luminance = (hex) => [1, 3, 5].map((o) => parseInt(hex.slice(o, o + 2), 16) / 255)
    .map((n) => n <= 0.04045 ? n / 12.92 : ((n + 0.055) / 1.055) ** 2.4)
    .reduce((sum, channel, index) => sum + channel * [0.2126, 0.7152, 0.0722][index], 0);
  const [a, b] = [luminance(divider), luminance(raised)];
  assert.ok((Math.max(a, b) + 0.05) / (Math.min(a, b) + 0.05) >= 1.5, `${divider} on ${raised}`);
  assert.match(globals, /\.stat-strip > div \{[^}]*border-right: 1px solid var\(--color-divider\);/);
  assert.doesNotMatch(globals.match(/@media \(max-width: 900px\) \{[\s\S]*?\n\}/)[0], /neutral-200/);
});
