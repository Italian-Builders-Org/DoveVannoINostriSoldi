import assert from "node:assert/strict";
import { readdirSync, readFileSync, statSync } from "node:fs";
import { registerHooks } from "node:module";
import { join, relative, sep } from "node:path";
import { fileURLToPath } from "node:url";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import test from "node:test";
import ts from "typescript";
import "./helpers/register-ts-alias.mjs";

// Node strips TS types but not JSX: transpile the icon component only.
registerHooks({
  load(url, context, nextLoad) {
    if (!url.endsWith("/src/components/icons.tsx")) return nextLoad(url, context);
    return {
      format: "module", shortCircuit: true,
      source: ts.transpileModule(readFileSync(fileURLToPath(url), "utf8"), {
        compilerOptions: { module: ts.ModuleKind.ESNext, jsx: ts.JsxEmit.ReactJSX },
      }).outputText,
    };
  },
});

const [{ Icon, ICON_NAMES }, { ICON_PATHS, BUS_PATHS }, { PRIMARY_NAV }] = await Promise.all([
  import("../src/components/icons.tsx"),
  import("../src/components/icon-paths.ts"),
  import("../src/lib/site-navigation.ts"),
]);

const srcRoot = fileURLToPath(new URL("../src/", import.meta.url));

function sourceFiles(dir) {
  return readdirSync(dir).flatMap((name) => {
    const path = join(dir, name);
    if (statSync(path).isDirectory()) return sourceFiles(path);
    return /\.(tsx?|mjs|js)$/.test(name) ? [path] : [];
  });
}

// The assistant UI is owned by a separate change and keeps @hugeicons; the
// only other importer allowed is the brand-mark wrapper (GitHub and social
// logos must stay recognisable, so they are not redrawn).
function hugeiconsAllowed(file) {
  const rel = relative(srcRoot, file).split(sep).join("/");
  return rel.startsWith("app/assistente/")
    || /^components\/assistant-/.test(rel)
    || rel === "components/brand-icons.tsx";
}

test("site UI no longer imports @hugeicons outside the assistant and brand marks", () => {
  const offenders = sourceFiles(srcRoot)
    .filter((file) => !hugeiconsAllowed(file))
    .filter((file) => /from\s+["']@hugeicons\//.test(readFileSync(file, "utf8")))
    .map((file) => relative(srcRoot, file));
  assert.deepEqual(offenders, []);
});

test("every icon renders a decorative 24×24 currentColor stroke svg by default", () => {
  assert.ok(ICON_NAMES.length >= 30, `only ${ICON_NAMES.length} icons`);
  for (const name of ICON_NAMES) {
    const html = renderToStaticMarkup(createElement(Icon, { name, size: 20 }));
    assert.match(html, /^<svg[^>]*\sviewBox="0 0 24 24"/, name);
    assert.match(html, /\sstroke="currentColor"/, name);
    assert.match(html, /\sfill="none"/, name);
    assert.match(html, /\saria-hidden="true"/, name);
    assert.match(html, /\sfocusable="false"/, name);
    assert.match(html, /\swidth="20"[^>]*\sheight="20"/, name);
    assert.doesNotMatch(html, /\srole=/, name);
    assert.match(html, /<path d="M[^"]+"/, `${name} draws nothing`);
  }
});

test("labelled icons are exposed as images instead of hidden", () => {
  const html = renderToStaticMarkup(createElement(Icon, { name: "search", label: "Cerca" }));
  assert.match(html, /\srole="img"/);
  assert.match(html, /\saria-label="Cerca"/);
  assert.doesNotMatch(html, /aria-hidden/);
});

test("icons are distinct drawings, not copy-pasted placeholders", () => {
  const seen = new Map();
  for (const name of ICON_NAMES) {
    const key = ICON_PATHS[name].join(" ");
    assert.equal(seen.get(key), undefined, `${name} duplicates ${seen.get(key)}`);
    seen.set(key, name);
  }
});

test("every primary navigation icon exists in the set", () => {
  for (const item of PRIMARY_NAV) assert.ok(ICON_NAMES.includes(item.icon), item.icon);
});

test("bus glyph for the live map canvas is plain stroked path data", () => {
  assert.ok(BUS_PATHS.length > 0);
  for (const d of BUS_PATHS) assert.match(d, /^M[\d.\s,MmLlHhVvCcSsQqTtAaZz-]+$/);
  const layer = readFileSync(new URL("../src/app/mappe/mobilita/_live/vehicle-layer.ts", import.meta.url), "utf8");
  assert.match(layer, /BUS_PATHS/);
});

test("Boards has its own dashboard icon instead of reusing the projects clipboard", () => {
  const boards = PRIMARY_NAV.find((item) => item.href === "/accedi");
  assert.equal(boards?.icon, "boards");
  assert.ok(ICON_NAMES.includes("boards"));
});

test("share-view button draws the share icon, decoratively, instead of a text arrow", () => {
  assert.ok(ICON_NAMES.includes("share"));
  const source = readFileSync(new URL("../src/components/share-view-button.tsx", import.meta.url), "utf8");
  assert.doesNotMatch(source, /↗/);
  assert.match(source, /<Icon name="share"/);
  // Icon is aria-hidden unless labelled; the visible text stays the button name.
  assert.doesNotMatch(source, /<Icon name="share"[^>]*label=/);
});
