import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

const page = await readFile(new URL("../src/app/governi/page.tsx", import.meta.url), "utf8");
const styles = await readFile(new URL("../src/app/governi/governi.module.css", import.meta.url), "utf8");
const navigation = await readFile(new URL("../src/lib/site-navigation.ts", import.meta.url), "utf8");
const discovery = await readFile(new URL("../src/lib/public-discovery.ts", import.meta.url), "utf8");

test("government scorecard is server-first and leads with the current outcome and boundary", () => {
  assert.doesNotMatch(page, /^"use client"/);
  assert.match(page, /Pagella economica dei governi/);
  assert.match(page, /Governo in carica · risultato provvisorio/);
  assert.match(page, /non dimostra che il governo abbia causato il risultato/);
  assert.match(page, /prima pagella macro, non la classifica definitiva/);
  assert.match(page, /Core macroeconomico/);
});

test("page explains the score before rankings and separates the forecast", () => {
  const headings = ["Perché", "Da cosa è composto", "Come potrebbe andare", "Cosa ha fatto il governo Meloni", "Tutti i governi nella serie comparabile", "Come viene deciso il voto"];
  let cursor = -1;
  for (const heading of headings) {
    const next = page.indexOf(heading);
    assert.ok(next > cursor, heading);
    cursor = next;
  }
  assert.match(page, /Previsioni separate dai dati osservati/);
  assert.match(page, /Non è un voto anticipato/);
  assert.match(page, /Atti, meccanismo ed evidenza/);
  assert.match(page, /Le misure restano separate dal voto/);
  assert.match(page, /Manovre e riforme economiche principali/);
  assert.match(page, /government\.measures\.length > 0/);
});

test("page exposes raw values, peers, missing-score reasons and official sources", () => {
  assert.match(page, /Baseline/);
  assert.match(page, /Italia vs peer/);
  assert.match(page, /un valore positivo significa che l’Italia è migliorata più/);
  assert.match(page, /government\.calculation\.reason/);
  assert.match(page, /government\.rank \?\? "prov\."/);
  assert.match(page, /data\.sources\.ameco\.landingUrl/);
  assert.match(page, /data\.sources\.governmentChronology\.pageUrl/);
  assert.ok((page.match(/target="_blank"/g) ?? []).length >= 7);
  assert.match(page, /SHA-256/);
});

test("page is discoverable under Institutions and its wide tables are keyboard scrollable", () => {
  assert.match(navigation, /href: "\/governi", label: "Pagella dei governi"/);
  assert.match(discovery, /"\/governi"/);
  assert.ok((page.match(/role="region"/g) ?? []).length >= 2);
  assert.ok((page.match(/tabIndex=\{0\}/g) ?? []).length >= 2);
  assert.match(styles, /\.tableWrap:focus-visible/);
  assert.match(styles, /overflow-x:\s*auto/);
  assert.match(styles, /@media \(max-width: 760px\)/);
  assert.doesNotMatch(styles, /color-neutral-950/);
  assert.match(styles, /\.currentSection[\s\S]*background: var\(--color-text\)/);
});
