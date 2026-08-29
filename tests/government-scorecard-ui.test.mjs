import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

const page = await readFile(new URL("../src/app/governi/page.tsx", import.meta.url), "utf8");
const detail = await readFile(new URL("../src/app/governi/[id]/page.tsx", import.meta.url), "utf8");
const citizenModel = await readFile(new URL("../src/app/governi/citizen-score-model.tsx", import.meta.url), "utf8");
const indicatorChart = await readFile(new URL("../src/app/governi/government-indicator-chart.tsx", import.meta.url), "utf8");
const styles = await readFile(new URL("../src/app/governi/governi.module.css", import.meta.url), "utf8");
const navigation = await readFile(new URL("../src/lib/site-navigation.ts", import.meta.url), "utf8");
const discovery = await readFile(new URL("../src/lib/public-discovery.ts", import.meta.url), "utf8");

test("government scorecard is server-first and labels the current number as an incomplete macro core", () => {
  assert.doesNotMatch(page, /^"use client"/);
  assert.match(page, /Pagella economica dei governi/);
  assert.match(page, /Governo in carica · risultato provvisorio/);
  assert.match(page, /non è ancora il voto sul benessere degli italiani/);
  assert.match(page, /Core macro provvisorio/);
  assert.match(page, /Non contiene ancora risparmio/);
  assert.match(page, /<CitizenScoreModel \/>/);
});

test("page explains the score before rankings and separates the forecast", () => {
  const headings = ["Perché il Core", "Da cosa è composto il Core provvisorio", "Come potrebbe andare", "Cosa ha fatto il governo Meloni", "Tutti i governi nella serie comparabile", "Come viene deciso il voto"];
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
  assert.match(page, /Il confronto internazionale non è lo spread/);
});

test("citizen model exposes ten source-backed indicators and keeps long-lag diagnostics separate", () => {
  assert.match(citizenModel, /Dieci dati che parlano alla vita del cittadino/);
  assert.match(citizenModel, /Sette risultati possono entrare nel voto moderno/);
  assert.match(citizenModel, /indicator\.role === "score"/);
  assert.match(citizenModel, /indicator\.role === "diagnostic"/);
  assert.match(citizenModel, /non sono ancora nel numero mostrato sotto/);
  assert.match(citizenModel, /indicator\.sourceUrl/);
});

test("page exposes raw values, peers, missing-score reasons and official sources", () => {
  assert.match(page, /Baseline/);
  assert.match(page, /Italia vs peer/);
  assert.match(page, /Un valore positivo significa che l’Italia è migliorata più/);
  assert.match(page, /government\.calculation\.reason/);
  assert.match(page, /government\.rank \?\? "prov\."/);
  assert.match(page, /data\.sources\.ameco\.landingUrl/);
  assert.match(page, /data\.sources\.governmentChronology\.pageUrl/);
  assert.ok((page.match(/target="_blank"/g) ?? []).length >= 7);
  assert.match(page, /SHA-256/);
});

test("every government links to a dedicated five-part assessment", () => {
  assert.match(page, /href=\{`\/governi\/\$\{government\.id\}`\}/);
  for (const heading of ["Cosa ha ereditato", "In quale situazione ha governato", "Cosa ha fatto per intervenire", "Risultati osservati e situazione lasciata", "Cosa questa scheda non dimostra"]) {
    assert.match(detail, new RegExp(heading));
  }
  assert.match(detail, /Periodo economico e geopolitico/);
  assert.match(detail, /government\.inheritance\.trend/);
  assert.match(detail, /government\.measures\.map/);
  assert.match(detail, /government\.contexts\.map/);
  assert.match(detail, /<GovernmentIndicatorChart indicators=\{calculation\.indicators\} \/>/);
  assert.match(detail, /Come i sei indicatori formano il numero/);
  assert.match(detail, /dynamicParams = false/);
  assert.match(detail, /generateStaticParams/);
});

test("government comparison chart is an isolated client component with accessible raw data", () => {
  assert.match(indicatorChart, /^"use client"/);
  assert.match(indicatorChart, /miglioramento annuale dalla baseline/);
  assert.match(indicatorChart, /Italia/);
  assert.match(indicatorChart, /Francia/);
  assert.match(indicatorChart, /Germania/);
  assert.match(indicatorChart, /Spagna/);
  assert.match(indicatorChart, /<ChartDataTable/);
  assert.match(indicatorChart, /accessibilityLayer/);
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
