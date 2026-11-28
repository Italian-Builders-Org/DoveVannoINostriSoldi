import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { registerHooks } from "node:module";
import { fileURLToPath } from "node:url";
import test from "node:test";
import ts from "typescript";
import { renderToStaticMarkup } from "react-dom/server";
import { createElement } from "react";
import "./helpers/register-ts-alias.mjs";

// Node strips TS types but not JSX: transpile the components rendered here,
// and stand in for CSS modules with their class names.
const cssUrl = `data:text/javascript,${encodeURIComponent("export default new Proxy({}, {get: (_, key) => String(key)});")}`;
const owned = (url) => /\/src\/(?:components\/(?:charts\/)?[^/]+|app\/enti\/[^/]+)\.tsx$/.test(decodeURIComponent(url ?? ""));

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

const { RegistrySummary } = await import("../src/app/enti/registry-summary.tsx");

const text = (html) => html.replace(/<[^>]+>/g, " ").replace(/\s+/g, " ").trim();
const render = (props) => renderToStaticMarkup(createElement(RegistrySummary, props));
const distribution = [
  { label: "Pubbliche Amministrazioni", value: 23_000 },
  { label: "Gestori di Pubblici Servizi", value: 1_200 },
];

test("an unavailable IPA registry shows one status line, not a status word as the figure", () => {
  // Regression: /enti rendered "Non disponibile" as the 38px registry total
  // and "Controllato il Non disponibile." (the date slot got the status).
  const html = render({ total: null, observedAt: null, distribution: [] });
  const body = text(html);
  assert.doesNotMatch(body, /Controllato il/);
  assert.doesNotMatch(body, /Non disponibile/i);
  assert.doesNotMatch(html, /bigNumber/);
  // One status line, announced politely; it keeps the phrase the browser
  // gate (scripts/browser/recharts-interactions.mjs) waits for.
  assert.equal(html.match(/role="status"/g)?.length, 1);
  assert.match(body, /non è disponibile ora/);
});

test("an available total shows the exact figure and when it was checked", () => {
  const html = render({ total: 24_216, observedAt: "2026-11-27T08:30:00Z", distribution });
  const body = text(html);
  assert.match(html, /bigNumber[^>]*>24\.216</);
  assert.match(body, /Controllato il 27 nov 2026, 09:30\./);
  assert.doesNotMatch(html, /role="status"/);
});

test("zero is a figure, not a missing value", () => {
  const html = render({ total: 0, observedAt: "2026-11-27T08:30:00Z", distribution });
  assert.match(html, /bigNumber[^>]*>0</);
  assert.doesNotMatch(html, /role="status"/);
});

test("a total without a valid check date omits the date sentence instead of printing a placeholder", () => {
  for (const observedAt of [null, "not a date"]) {
    const body = text(render({ total: 24_216, observedAt, distribution }));
    assert.match(body, /Enti presenti nel registro\./);
    assert.doesNotMatch(body, /Controllato il|Non disponibile/);
  }
});

test("a partial outage names only the part that is missing", () => {
  const noDistribution = render({ total: 24_216, observedAt: null, distribution: [] });
  assert.match(text(noDistribution), /La distribuzione per tipologia non è disponibile ora\./);
  assert.match(noDistribution, /24\.216/);

  const noTotal = render({ total: null, observedAt: null, distribution });
  assert.match(text(noTotal), /Il totale del registro non è disponibile ora\./);
  assert.match(text(noTotal), /Gestori di pubblici servizi/);
  assert.doesNotMatch(noTotal, /bigNumber/);
});
