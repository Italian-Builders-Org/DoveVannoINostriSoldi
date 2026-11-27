import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { registerHooks } from "node:module";
import { fileURLToPath } from "node:url";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import test from "node:test";
import ts from "typescript";
import "./helpers/register-ts-alias.mjs";

// Node strips TS types but not JSX: transpile the two components rendered here,
// and stand in for next/link with a plain anchor.
const reactUrl = new URL("../node_modules/react/index.js", import.meta.url).href;
const linkUrl = `data:text/javascript,${encodeURIComponent(`import { createElement } from ${JSON.stringify(reactUrl)}; export default function Link({ prefetch, ...props }) { return createElement('a', props); }`)}`;
registerHooks({
  resolve(specifier, context, nextResolve) {
    if (specifier === "next/link") return { url: linkUrl, shortCircuit: true };
    return nextResolve(specifier, context);
  },
  load(url, context, nextLoad) {
    if (!/\/src\/components\/(icons|data-unavailable-notice)\.tsx$/.test(url)) return nextLoad(url, context);
    return {
      format: "module", shortCircuit: true,
      source: ts.transpileModule(readFileSync(fileURLToPath(url), "utf8"), {
        compilerOptions: { module: ts.ModuleKind.ESNext, jsx: ts.JsxEmit.ReactJSX },
      }).outputText,
    };
  },
});

const { DataUnavailableNotice } = await import("../src/components/data-unavailable-notice.tsx");

test("an unavailable dataset is a status notice with an icon, a primary way out and nothing to share", () => {
  const html = renderToStaticMarkup(createElement(DataUnavailableNotice, {
    title: "Classifica non disponibile",
    action: { href: "/comuni", label: "Vai alla mappa dei Comuni" },
  }, "Mostriamo i punteggi solo quando i dati sono verificati."));
  // Announced as a status, not as an error alert.
  assert.match(html, /^<div[^>]*role="status"/);
  // Tells the section chrome to drop "Condividi questa vista".
  assert.match(html, /data-share-hidden="true"/);
  assert.match(html, /<svg[^>]*aria-hidden="true"/);
  assert.match(html, /<strong[^>]*>Classifica non disponibile<\/strong>/);
  assert.match(html, /Mostriamo i punteggi solo quando i dati sono verificati\./);
  assert.match(html, /<a[^>]*class="btn btn-primary"[^>]*href="\/comuni"|<a[^>]*href="\/comuni"[^>]*class="btn btn-primary"/);
  assert.match(html, />Vai alla mappa dei Comuni</);
});

test("both DVNS Index pages use the shared notice when the snapshot is missing", () => {
  for (const file of ["../src/app/dvns-index/page.tsx", "../src/app/dvns-index/metodo/page.tsx"]) {
    const source = readFileSync(new URL(file, import.meta.url), "utf8");
    assert.match(source, /<DataUnavailableNotice/, file);
    assert.match(source, /href: "\/comuni"/, file);
  }
});

test("a retry action is a secondary link to the same page, after the primary way out", () => {
  const html = renderToStaticMarkup(createElement(DataUnavailableNotice, {
    title: "Classifica non disponibile",
    action: { href: "/comuni", label: "Vai alla mappa dei Comuni" },
    retry: { href: "/dvns-index", label: "Riprova" },
  }, "Riprova più tardi."));
  const primary = html.indexOf('href="/comuni"');
  const retry = html.search(/<a[^>]*href="\/dvns-index"[^>]*>Riprova<\/a>|<a[^>]*>Riprova<\/a>/);
  assert.ok(primary > -1 && retry > primary, "Riprova follows the primary action");
  assert.match(html, /<a[^>]*class="btn btn-secondary"[^>]*href="\/dvns-index"|<a[^>]*href="\/dvns-index"[^>]*class="btn btn-secondary"/);
  // No client JS: a plain link, never a button that needs a handler.
  assert.doesNotMatch(html, /<button/);
});

test("the DVNS Index notice says what the Index is and offers a retry on the same URL", () => {
  const source = readFileSync(new URL("../src/app/dvns-index/page.tsx", import.meta.url), "utf8");
  const unavailable = source.slice(source.indexOf("function Unavailable"), source.indexOf("function BandBadge"));
  assert.match(unavailable, /<p>Confronta oltre 6\.000 Comuni su sei aspetti della spesa/);
  assert.match(unavailable, /retry=\{\{ href: PAGE_PATH, label: "Riprova" \}\}/);
});
