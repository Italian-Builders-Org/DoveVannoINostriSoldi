import assert from "node:assert/strict";
import { readdir, readFile } from "node:fs/promises";
import { extname, join } from "node:path";
import test from "node:test";
import ts from "typescript";

const root = new URL("..", import.meta.url);
const uiRoots = ["src/app", "src/components"];

async function filesBelow(relativePath) {
  const entries = await readdir(new URL(`${relativePath}/`, root), { withFileTypes: true });
  const files = [];
  for (const entry of entries) {
    const child = join(relativePath, entry.name);
    if (entry.isDirectory()) files.push(...await filesBelow(child));
    if (entry.isFile() && extname(entry.name) === ".tsx") files.push(child);
  }
  return files;
}

async function uiSources() {
  const paths = (await Promise.all(uiRoots.map(filesBelow))).flat();
  return Promise.all(paths.map(async (path) => [path, await readFile(new URL(path, root), "utf8")]));
}

function jsxElements(path, source) {
  const sourceFile = ts.createSourceFile(
    path,
    source,
    ts.ScriptTarget.Latest,
    true,
    ts.ScriptKind.TSX,
  );
  const elements = [];
  const visit = (node) => {
    if (ts.isJsxOpeningElement(node) || ts.isJsxSelfClosingElement(node)) {
      elements.push(node);
    }
    ts.forEachChild(node, visit);
  };
  visit(sourceFile);
  return { elements, sourceFile };
}

function jsxAttribute(element, sourceFile, name) {
  return element.attributes.properties.find(
    (attribute) => ts.isJsxAttribute(attribute) && attribute.name.getText(sourceFile) === name,
  );
}

// Un'intestazione senza scope lascia allo screen reader il compito di indovinare
// se descrive una colonna o una riga.
test("every table header declares its scope", async () => {
  const offenders = [];
  for (const [path, source] of await uiSources()) {
    for (const match of source.matchAll(/<th(\s[^>]*)?>/g)) {
      if (!/\sscope=/.test(match[0])) {
        offenders.push(`${path}: ${match[0]}`);
      }
    }
  }
  assert.deepEqual(offenders, [], `intestazioni senza scope:\n${offenders.join("\n")}`);
});

// Un contenitore scorrevole con tabIndex={0} riceve il focus da tastiera: senza
// ruolo e senza nome accessibile chi usa uno screen reader entra in un elemento
// anonimo e non sa che cosa contiene.
test("focusable containers expose a role and an accessible name", async () => {
  const containerNames = new Set(["div", "section", "table", "pre", "figure", "ul", "ol"]);
  const offenders = [];
  for (const [path, source] of await uiSources()) {
    const { elements, sourceFile } = jsxElements(path, source);
    for (const element of elements) {
      if (!containerNames.has(element.tagName.getText(sourceFile))) continue;
      if (jsxAttribute(element, sourceFile, "tabIndex")?.initializer?.getText(sourceFile) !== "{0}") continue;
      const hasRole = Boolean(jsxAttribute(element, sourceFile, "role"));
      const hasAccessibleName = Boolean(
        jsxAttribute(element, sourceFile, "aria-label")
        || jsxAttribute(element, sourceFile, "aria-labelledby"),
      );
      if (hasRole && hasAccessibleName) continue;
      const tag = element.getText(sourceFile);
      offenders.push(`${path}: ${tag.replace(/\s+/g, " ").slice(0, 120)}`);
    }
  }
  assert.deepEqual(offenders, [], `contenitori focalizzabili senza nome accessibile:\n${offenders.join("\n")}`);
});

// layout.tsx applica gia' il template "%s · DoveVannoINostriSoldi": una pagina
// che ripete il marchio lo stampa due volte nel <title>.
test("no page title repeats the site brand already added by the layout", async () => {
  const layout = await readFile(new URL("src/app/layout.tsx", root), "utf8");
  assert.match(layout, /template:\s*"%s · DoveVannoINostriSoldi"/);

  const offenders = [];
  for (const [path, source] of await uiSources()) {
    if (!path.endsWith("page.tsx")) continue;
    for (const match of source.matchAll(/title:\s*"([^"]*)"/g)) {
      if (/dove\s*vanno\s*i\s*nostri\s*soldi/i.test(match[1])) {
        offenders.push(`${path}: ${match[1]}`);
      }
    }
  }
  assert.deepEqual(offenders, [], `titoli che ripetono il marchio:\n${offenders.join("\n")}`);
});
