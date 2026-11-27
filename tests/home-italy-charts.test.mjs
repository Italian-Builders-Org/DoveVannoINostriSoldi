import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { registerHooks } from "node:module";
import { fileURLToPath } from "node:url";
import test from "node:test";
import ts from "typescript";
import { renderToStaticMarkup } from "react-dom/server";
import { createElement } from "react";
import "./helpers/register-ts-alias.mjs";

const reactUrl = new URL("../node_modules/react/index.js", import.meta.url).href;
const linkUrl = `data:text/javascript,${encodeURIComponent(`import { createElement } from ${JSON.stringify(reactUrl)}; export default function Link(props) { return createElement('a', props); }`)}`;
const cssUrl = `data:text/javascript,${encodeURIComponent("export default new Proxy({}, {get: (_, key) => String(key)});")}`;
const owned = (url) => /\/src\/components\/[^/]+\.tsx$/.test(decodeURIComponent(url ?? ""));

registerHooks({
  resolve(specifier, context, nextResolve) {
    if (specifier === "next/link") return { url: linkUrl, shortCircuit: true };
    if (specifier.endsWith(".module.css")) return { url: cssUrl, shortCircuit: true };
    return nextResolve(specifier, context);
  },
  load(url, context, nextLoad) {
    if (!owned(url)) return nextLoad(url, context);
    return {
      format: "module",
      shortCircuit: true,
      source: ts.transpileModule(readFileSync(fileURLToPath(url), "utf8"), {
        compilerOptions: { module: ts.ModuleKind.ESNext, jsx: ts.JsxEmit.ReactJSX },
      }).outputText,
    };
  },
});

const { HomeItalyCompositionChart } = await import("../src/components/home-italy-charts.tsx");

const barWidths = (html) => [...html.matchAll(/<b style="width:([\d.]+)%"/g)].map((match) => Number(match[1]));

test("PA composition bars are a share of the total, the same rule as the home card", () => {
  // Regression: bars were scaled to the largest slice, so a 42.2% share filled the
  // whole track on /spese/panoramica while the home card showed it at 42%.
  const slices = [
    { id: "GF10", label: "Pensioni e assistenza", amountEuro: 420e9, sharePercent: 42.2, href: null, note: null },
    { id: "GF07", label: "Sanità", amountEuro: 130e9, sharePercent: 13.1, href: null, note: null },
    { id: "GF00", label: "Voce vuota", amountEuro: 0, sharePercent: 0, href: null, note: null },
  ];
  const html = renderToStaticMarkup(createElement(HomeItalyCompositionChart, { slices, ariaLabel: "Composizione" }));
  assert.deepEqual(barWidths(html), [42.2, 13.1, 0]);
});

test("PA composition bars stay inside the track for out-of-range shares", () => {
  const slices = [
    { id: "A", label: "Oltre il totale", amountEuro: 1, sharePercent: 104, href: null, note: null },
    { id: "B", label: "Negativa", amountEuro: -1, sharePercent: -3, href: null, note: null },
  ];
  const html = renderToStaticMarkup(createElement(HomeItalyCompositionChart, { slices, ariaLabel: "Composizione" }));
  assert.deepEqual(barWidths(html), [100, 0]);
});

const { HomeItalyTrendChart } = await import("../src/components/home-italy-charts.tsx");

test("trend axis labels are HTML text, so the viewBox scale cannot shrink them on mobile", async () => {
  // Regression: tick and year labels were SVG <text> inside a 720-unit viewBox;
  // at 390px the browser scaled them to about 5px.
  const points = Array.from({ length: 11 }, (_, index) => ({
    year: 2014 + index,
    totalEuro: (820 + index * 30) * 1e9,
    gdpSharePercent: 50,
  }));
  const html = renderToStaticMarkup(createElement(HomeItalyTrendChart, { points, selectedYear: 2024 }));
  const svg = html.match(/<svg[\s\S]*?<\/svg>/)?.[0] ?? "";
  assert.doesNotMatch(svg, /<text/);
  assert.match(svg, /preserveAspectRatio="none"/);
  const years = [...html.matchAll(/class="trendYear"[^>]*>(\d{4})</g)].map((match) => match[1]);
  assert.deepEqual(years, points.map((point) => String(point.year)));
  // Mobile thins every other year but always keeps the latest one.
  const minor = [...html.matchAll(/class="trendYear"[^>]*data-minor="true"[^>]*>(\d{4})</g)].map((match) => match[1]);
  assert.ok(!minor.includes("2024"));
  assert.equal(minor.length, 5);
  assert.equal([...html.matchAll(/class="trendTick"/g)].length, 3);
  const css = readFileSync(new URL("../src/components/home-italy-charts.module.css", import.meta.url), "utf8");
  for (const rule of css.matchAll(/\.trend(?:Tick|Year)[^{]*\{[^}]*font-size:\s*(\d+(?:\.\d+)?)px/g)) {
    assert.ok(Number(rule[1]) >= 11, `axis label font-size ${rule[1]}px is below 11px`);
  }
});

test("a trend whose axis does not start at zero is a line without a filled area", () => {
  // Regression: the y axis started at 820 billion and the area under the line
  // was filled, so the fill height exaggerated growth since 2014.
  const points = Array.from({ length: 11 }, (_, index) => ({
    year: 2014 + index,
    totalEuro: (820 + index * 30) * 1e9,
    gdpSharePercent: 50,
  }));
  const html = renderToStaticMarkup(createElement(HomeItalyTrendChart, { points, selectedYear: 2024 }));
  const svg = html.match(/<svg[\s\S]*?<\/svg>/)?.[0] ?? "";
  assert.doesNotMatch(svg, /class="trendArea"/);
  assert.match(svg, /class="trendLine"/);
  // The caption says the axis is cut instead of repeating the headline total
  // and the source already named once at the end of the section.
  const caption = html.match(/<figcaption[\s\S]*?<\/figcaption>/)?.[0] ?? "";
  assert.match(caption, /non da zero/);
  assert.doesNotMatch(caption, /Eurostat|1\.120,00 mld/);
});

test("a trend drawn from a zero baseline keeps its area fill", () => {
  const points = [
    { year: 2023, totalEuro: 0, gdpSharePercent: 0 },
    { year: 2024, totalEuro: 5e9, gdpSharePercent: 1 },
  ];
  const html = renderToStaticMarkup(createElement(HomeItalyTrendChart, { points, selectedYear: 2024 }));
  assert.match(html, /class="trendArea"/);
  assert.doesNotMatch(html, /non da zero/);
});

test("every composition row reserves the same info column, with a trigger only where a note exists", () => {
  // Regression: the "?" sat inside the label, so it moved with the text and
  // only three rows had one; the bar and share columns started at different x.
  const slices = [
    { id: "GF10", label: "Pensioni e protezione sociale", amountEuro: 468e9, sharePercent: 42.2, href: "/a", note: "Perimetro" },
    { id: "GF07", label: "Sanità", amountEuro: 146e9, sharePercent: 13.2, href: "/b", note: null },
  ];
  const html = renderToStaticMarkup(createElement(HomeItalyCompositionChart, { slices, ariaLabel: "Composizione" }));
  const rows = html.match(/<li[\s\S]*?<\/li>/g) ?? [];
  assert.equal(rows.length, 2);
  for (const row of rows) assert.match(row, /class="barInfo"/);
  assert.match(rows[0], /class="barInfo"[^>]*>[\s\S]*data-info-tooltip/);
  assert.doesNotMatch(rows[1], /data-info-tooltip/);
});
