import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import "./helpers/register-ts-alias.mjs";

const pagePath = new URL("../src/app/confronti/page.tsx", import.meta.url);
const stylePath = new URL("../src/app/confronti/confronti.module.css", import.meta.url);
const loaderPath = new URL("../src/lib/vive-restoration-snapshot.ts", import.meta.url);

const { restorationBenchmarkReference, restorationPublishableAnomalies } = await import(
  "../src/lib/vive-restoration-snapshot.ts"
);

test("the verified comparison page exposes only the two publishable anomaly cards", () => {
  assert.equal(restorationPublishableAnomalies.length, 2);
  assert.ok(restorationPublishableAnomalies.every((item) => item.classification === "anomaly"));
  assert.ok(restorationPublishableAnomalies.every((item) => item.publicationStatus === "publishable"));
  assert.equal(restorationBenchmarkReference.classification, "benchmark_reference");
  assert.equal(restorationBenchmarkReference.publicationStatus, "blocked");
});

test("the page states the comparison, denominator and evidence boundary in plain Italian", () => {
  const page = readFileSync(pagePath, "utf8");

  assert.match(page, /Tre restauri, importi da 280 € a 6\.270 €/);
  assert.match(page, /Stesso ente, stessa mostra e stesso tipo di affidamento/);
  assert.match(page, /importi netti IVA/i);
  assert.match(page, /non possiamo\s+dire[\s\S]*spreco/i);
  assert.match(page, /quali elementi tecnici giustificano/);
  assert.match(page, /Mediana e percentili calcolati su tre soli affidamenti/);
});

test("sources are last and every wide exact value remains available as a table", () => {
  const page = readFileSync(pagePath, "utf8");
  const tableIndex = page.indexOf("Tabella esatta");
  const methodIndex = page.indexOf("Metodo e limiti");
  const sourceIndex = page.indexOf("Fonti ufficiali");

  assert.ok(tableIndex > 0);
  assert.ok(methodIndex > tableIndex);
  assert.ok(sourceIndex > methodIndex);
  assert.match(page, /role="region"/);
  assert.match(page, /tabIndex=\{0\}/);
  assert.match(page, /<caption>/);
  assert.match(page, /Scorri la tabella verso destra/);
  assert.match(page, /styles\.exactTable/);
});

test("the comparison layout remains inside the viewport", () => {
  const styles = readFileSync(stylePath, "utf8");

  assert.match(styles, /minmax\(0, 1fr\)/);
  assert.match(styles, /@media \(max-width: 620px\)/);
});

test("the new public surface contains no local archive provenance", () => {
  const text = [pagePath, stylePath, loaderPath]
    .map((path) => readFileSync(path, "utf8"))
    .join("\n");

  assert.doesNotMatch(text, /\/Users\//);
  assert.doesNotMatch(text, /Downloads/);
  assert.doesNotMatch(text, /\.tar\.gz/i);
  assert.doesNotMatch(text, /private (archive|document|source)/i);
});
