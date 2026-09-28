import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { registerHooks } from "node:module";
import { fileURLToPath } from "node:url";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import test from "node:test";
import ts from "typescript";
import "./helpers/register-ts-alias.mjs";

const cssUrl = `data:text/javascript,${encodeURIComponent("export default new Proxy({}, {get: (_, key) => String(key)});")}`;
registerHooks({
  resolve(specifier, context, nextResolve) {
    if (specifier.endsWith(".module.css")) return { url: cssUrl, shortCircuit: true };
    return nextResolve(specifier, context);
  },
  load(url, context, nextLoad) {
    if (!url.endsWith("/municipality-offices.tsx")) return nextLoad(url, context);
    return {
      format: "module", shortCircuit: true,
      source: ts.transpileModule(readFileSync(fileURLToPath(url), "utf8"), {
        compilerOptions: { module: ts.ModuleKind.ESNext, jsx: ts.JsxEmit.ReactJSX },
      }).outputText,
    };
  },
});

const [{ getMunicipalOfficesForEntity }, { MunicipalityOffices }] = await Promise.all([
  import("../src/lib/municipal-offices.ts"),
  import("../src/app/enti/[codice]/municipality-offices.tsx"),
]);

test("la scheda Mantova distingue copertura, organi, mandati e fonti", () => {
  const state = getMunicipalOfficesForEntity("c_e897", "00189800204");
  assert.equal(state.status, "available");
  const html = renderToStaticMarkup(createElement(MunicipalityOffices, { state }));
  assert.match(html, /Giunta comunale/);
  assert.match(html, /Consiglio comunale/);
  assert.match(html, /Andrea Murari/);
  assert.match(html, /8 giugno 2026/);
  assert.match(html, /10 giugno 2026/);
  assert.match(html, /26 settembre 2026/);
  assert.match(html, /CC BY 4\.0/);
  assert.match(html, /www\.comune\.mantova\.it/);
  assert.match(html, /storico non coperto/i);
  assert.match(html, /Indennità e compensi/);
  assert.match(html, /importi non verificati/i);
  assert.match(html, /non dimostra che i compensi siano zero/i);
  assert.match(html, /pubblicazioni\.comune\.mantova\.it/);
  assert.doesNotMatch(html, /(?:€|EUR|euro)\s*\d/u);
});

test("le altre schede dichiarano il perimetro senza elenchi vuoti", () => {
  const state = getMunicipalOfficesForEntity("c_f205", "01199250158");
  assert.equal(state.status, "out_of_scope");
  const html = renderToStaticMarkup(createElement(MunicipalityOffices, { state }));
  assert.match(html, /solo Mantova/i);
  assert.doesNotMatch(html, /<ul/);
});

test("un identificativo IPA coincidente con CF diverso non espone il pilota", () => {
  assert.equal(getMunicipalOfficesForEntity("c_e897", "00000000000").status, "out_of_scope");
});
