import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { registerHooks } from "node:module";
import { fileURLToPath } from "node:url";
import test from "node:test";
import ts from "typescript";
import { renderToString } from "react-dom/server";
import "./helpers/register-ts-alias.mjs";

const reactUrl = new URL("../node_modules/react/index.js", import.meta.url).href;
const linkUrl = `data:text/javascript,${encodeURIComponent(`import { createElement } from ${JSON.stringify(reactUrl)}; export default function Link(props) { return createElement('a', props); }`)}`;
const cssUrl = `data:text/javascript,${encodeURIComponent("export default new Proxy({}, {get: (_, key) => String(key)});")}`;
const componentUrls = new Set([
  new URL("../src/app/spese/sicurezza/page.tsx", import.meta.url).href,
  new URL("../src/components/charts/chart-data-table.tsx", import.meta.url).href,
]);
registerHooks({
  resolve(specifier, context, nextResolve) {
    if (specifier === "next/link") return { url: linkUrl, shortCircuit: true };
    if (specifier === "next/navigation") return nextResolve("next/navigation.js", context);
    if (specifier.endsWith(".module.css")) return { url: cssUrl, shortCircuit: true };
    return nextResolve(specifier, context);
  },
  load(url, context, nextLoad) {
    if (!componentUrls.has(url)) return nextLoad(url, context);
    return {
      format: "module", shortCircuit: true,
      source: ts.transpileModule(readFileSync(fileURLToPath(url), "utf8"), {
        compilerOptions: { module: ts.ModuleKind.ESNext, jsx: ts.JsxEmit.ReactJSX },
      }).outputText,
    };
  },
});
const { default: Page } = await import("../src/app/spese/sicurezza/page.tsx");

test("public order chart preserves its complete accessible title during server rendering", async (t) => {
  const warnings = [];
  t.mock.method(console, "error", (...args) => warnings.push(args));
  for (const anno of ["2024", "2014"]) {
    const tree = await Page({ searchParams: Promise.resolve({ anno }) });
    const html = renderToString(tree);
    assert.match(html, /<title id="sicurezza-chart-title">Spesa italiana per ordine pubblico e sicurezza, 2014-2024<\/title>/);
    assert.match(html, /aria-labelledby="sicurezza-chart-title sicurezza-chart-description"/);
    assert.match(html, /<desc id="sicurezza-chart-description">Serie annuale in miliardi di euro correnti\./);
  }
  assert.deepEqual(warnings, [], "Il markup della pagina non deve emettere warning SSR React");
});
