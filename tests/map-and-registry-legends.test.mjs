import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { registerHooks } from "node:module";
import { fileURLToPath } from "node:url";
import test from "node:test";
import ts from "typescript";
import { renderToStaticMarkup } from "react-dom/server";
import { createElement } from "react";
import "./helpers/register-ts-alias.mjs";

const cssUrl = `data:text/javascript,${encodeURIComponent("export default new Proxy({}, {get: (_, key) => String(key)});")}`;
const owned = (url) => /\/src\/components\/(?:charts\/)?[^/]+\.tsx$/.test(decodeURIComponent(url ?? ""));

registerHooks({
  resolve(specifier, context, nextResolve) {
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

const { ItalyRegionsMap } = await import("../src/components/italy-regions-map.tsx");
const { siopeMunicipalSnapshot } = await import("../src/lib/siope-snapshot.ts");
const { RegistryTypeChart } = await import("../src/components/charts/registry-type-chart.tsx");

const text = (html) => html.replace(/<[^>]+>/g, " ").replace(/\s+/g, " ");

test("the regional map legend shows each class range as text and explains the outline", () => {
  // Regression: the five swatches carried their ranges only in a hover title,
  // hidden on touch, and the end labels vanished under 760px; the black or
  // white outline around the selected region was never explained.
  const html = renderToStaticMarkup(createElement(ItalyRegionsMap, {
    heading: "Pagamenti dei Comuni per regione",
    headingId: "map-title",
    periodSelector: null,
    regions: siopeMunicipalSnapshot.regions,
    period: "2026",
  }));
  const legend = html.match(/<figure[^>]*data-map-legend="true"[\s\S]*?<\/figure>/)?.[0];
  assert.ok(legend, "legend figure missing");
  const items = legend.match(/<li[\s\S]*?<\/li>/g) ?? [];
  assert.equal(items.length, 5);
  assert.match(text(items[0]), /fino a [\d.]+/);
  assert.match(text(items[4]), /oltre [\d.]+/);
  for (const item of items.slice(1, 4)) assert.match(text(item), /[\d.]+-[\d.]+/);
  assert.match(text(legend), /€ per abitante/);
  assert.match(text(legend), /più intenso/i);
  assert.match(text(legend), /contorno/i);
});

test("the IPA type list keeps full type names instead of truncating them", () => {
  // Regression: the Recharts axis cut labels at 28 characters, so
  // "Enti Nazionali di Previdenza…" lost the part that identifies it.
  const label = "Enti Nazionali di Previdenza ed Assistenza Sociale in Conto Economico Consolidato";
  const html = renderToStaticMarkup(createElement(RegistryTypeChart, {
    data: [
      { label: "Pubbliche Amministrazioni", value: 21707 },
      { label: "Societa' in Conto Economico Consolidato", value: 142 },
      { label, value: 22 },
    ],
  }));
  assert.doesNotMatch(html, /…/);
  assert.match(text(html), new RegExp(label));
  assert.match(text(html), /Società in Conto Economico Consolidato/);
  assert.match(text(html), /21\.707/);
  assert.match(text(html), /\b22\b/);
});
