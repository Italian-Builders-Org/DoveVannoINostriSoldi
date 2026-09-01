import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

const currentSignals = await readFile(new URL("../src/app/governi/current-government-signals.tsx", import.meta.url), "utf8");
const currentOverview = await readFile(new URL("../src/app/governi/current-government-overview.tsx", import.meta.url), "utf8");
const indicatorChart = await readFile(new URL("../src/app/governi/government-indicator-chart.tsx", import.meta.url), "utf8");
const indicatorStyles = await readFile(new URL("../src/app/governi/government-indicator-chart.module.css", import.meta.url), "utf8");

test("government indicator chart keeps exact values, units and source in an accessible table", () => {
  assert.match(indicatorChart, /<ChartDataTable/);
  assert.match(indicatorChart, /sourceCodes/);
  assert.match(indicatorChart, /selected\.unit/);
  assert.match(indicatorChart, /Periodo:/);
  assert.match(indicatorChart, /Unità del confronto/);
  assert.match(indicatorChart, /Fonte:/);
  assert.match(indicatorChart, /AMECO/);
  assert.match(indicatorChart, /Percentage of active population": "% della popolazione attiva"/);
  assert.match(indicatorChart, /miglioramento normalizzato dall’inizio/);
  assert.match(indicatorChart, /un valore più basso è migliore/);
  assert.match(indicatorChart, /valore osservato/);
  assert.match(indicatorChart, /aria-label=\{chartLabel\}/);
  assert.match(indicatorStyles, /min-height: 44px/);
  assert.doesNotMatch(indicatorChart, /color: "#[0-9a-f]+"/i);
});

test("current monthly signal charts expose a source-aware table and derive dates from the snapshot", () => {
  assert.match(currentSignals, /<ChartDataTable/);
  assert.match(currentSignals, /Italia · variazione cumulata \(%\)/);
  assert.match(currentSignals, /Mediana peer · variazione cumulata \(%\)/);
  assert.match(currentSignals, /monthLabel\(data\.startPeriod\)/);
  assert.match(currentSignals, /data\.source\.landingUrl/);
  assert.match(currentSignals, /role="group"/);
  assert.doesNotMatch(currentSignals, /ottobre 2022/);
});

test("current overview mini charts have a keyboard-readable data table", () => {
  assert.match(currentOverview, /function TrendSparkline/);
  assert.match(currentOverview, /<ChartDataTable/);
  assert.match(currentOverview, /Mediana peer · variazione di livello/);
  assert.match(currentOverview, /relativeChangeLabel/);
  assert.match(currentOverview, /levelChange/);
});
