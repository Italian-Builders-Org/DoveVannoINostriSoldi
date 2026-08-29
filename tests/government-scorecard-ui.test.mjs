import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

const page = await readFile(new URL("../src/app/governi/page.tsx", import.meta.url), "utf8");
const detail = await readFile(new URL("../src/app/governi/[id]/page.tsx", import.meta.url), "utf8");
const comparison = await readFile(new URL("../src/app/governi/confronta/page.tsx", import.meta.url), "utf8");
const citizenModel = await readFile(new URL("../src/app/governi/citizen-score-model.tsx", import.meta.url), "utf8");
const currentOverview = await readFile(new URL("../src/app/governi/current-government-overview.tsx", import.meta.url), "utf8");
const indicatorChart = await readFile(new URL("../src/app/governi/government-indicator-chart.tsx", import.meta.url), "utf8");
const styles = await readFile(new URL("../src/app/governi/governi.module.css", import.meta.url), "utf8");
const overviewStyles = await readFile(new URL("../src/app/governi/current-government-overview.module.css", import.meta.url), "utf8");
const navigation = await readFile(new URL("../src/lib/site-navigation.ts", import.meta.url), "utf8");
const discovery = await readFile(new URL("../src/lib/public-discovery.ts", import.meta.url), "utf8");

test("government scorecard is server-first and opens on the current government", () => {
  assert.doesNotMatch(page, /^"use client"/);
  assert.match(page, /Economia italiana: cosa sta migliorando e cosa no/);
  assert.match(page, /<CurrentGovernmentOverview governmentName=\{current\.name\} calculation=\{currentScore\} \/>/);
  assert.match(page, /Dati osservati fino al/);
  assert.match(page, /Risparmio, casa, natalità e migrazione dei laureati non sono ancora nel voto/);
  assert.match(page, /<CitizenScoreModel \/>/);
  assert.ok(page.indexOf("<CurrentGovernmentOverview") < page.indexOf("<CitizenScoreModel"));
});

test("page keeps current actions first and makes forecasts, history and method progressive", () => {
  const headings = ["Cosa ha fatto e cosa possiamo verificare", "Se le previsioni si realizzano", "Confronta il governo attuale con tutti i governi", "Quali dati mancano e come viene calcolato il voto"];
  let cursor = -1;
  for (const heading of headings) {
    const next = page.indexOf(heading);
    assert.ok(next > cursor, heading);
    cursor = next;
  }
  assert.match(page, /<details className=\{styles\.explorer\} id="confronto-governi">/);
  assert.match(page, /<details className=\{styles\.explorer\} id="metodo-dati">/);
  assert.match(page, /non un dato osservato e non un voto anticipato/);
  assert.match(page, /Il confronto con i peer non è lo spread/);
  assert.match(page, /current\.measures\.map/);
});

test("current overview turns all six indicators into readable trends and peer comparisons", () => {
  assert.doesNotMatch(currentOverview, /^"use client"/);
  assert.match(currentOverview, /Come sta andando con \{governmentName\}/);
  assert.match(currentOverview, /Indicatori migliorati/);
  assert.match(currentOverview, /Meglio dei peer/);
  assert.match(currentOverview, /calculation\.indicators\.map/);
  assert.match(currentOverview, /<TrendSparkline indicator=\{indicator\} \/>/);
  assert.match(currentOverview, /Periodo del grafico/);
  assert.match(currentOverview, /Variazione nel mandato/);
  assert.match(currentOverview, /Valore attuale/);
  assert.match(currentOverview, /2020 = 100/);
  assert.match(currentOverview, /Mediana peer/);
  assert.match(currentOverview, /comparisonLabel\(indicator\)/);
  assert.match(currentOverview, /<GovernmentIndicatorChart indicators=\{calculation\.indicators\} \/>/);
  assert.match(currentOverview, /role="img"/);
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
  assert.match(currentOverview, /baselineValue/);
  assert.match(currentOverview, /endValue/);
  assert.match(currentOverview, /relativeChange/);
  assert.match(page, /government\.calculation\.reason/);
  assert.match(page, /data\.sources\.ameco\.landingUrl/);
  assert.match(page, /data\.sources\.governmentChronology\.pageUrl/);
  assert.ok((page.match(/target="_blank"/g) ?? []).length >= 5);
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

test("users can compare any two scored governments and open either detail", () => {
  assert.match(page, /Miglior risultato tra i governi conclusi e valutabili/);
  assert.match(page, /href="\/governi\/confronta"/);
  assert.match(comparison, /name="x"/);
  assert.match(comparison, /name="y"/);
  assert.match(comparison, /Perché è davanti/);
  assert.match(comparison, /Dove nasce la differenza/);
  assert.match(comparison, /I dati, uno per uno/);
  assert.match(comparison, /href=\{`\/governi\/\$\{government\.id\}`\}/);
  assert.match(comparison, /“Migliore” significa punteggio Core macro più alto/);
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

test("page is discoverable, progressive and responsive", () => {
  assert.match(navigation, /href: "\/governi", label: "Pagella dei governi"/);
  assert.match(discovery, /"\/governi"/);
  assert.match(styles, /\.explorer/);
  assert.match(styles, /\.governmentBars/);
  assert.match(styles, /\.pageJumps[\s\S]*overflow-x:\s*auto/);
  assert.match(styles, /@media \(max-width: 760px\)/);
  assert.match(overviewStyles, /\.indicatorGrid/);
  assert.match(overviewStyles, /@media \(max-width: 700px\)/);
  assert.doesNotMatch(styles, /color-neutral-950/);
  assert.match(overviewStyles, /\.summary[\s\S]*background: var\(--color-text\)/);
});
