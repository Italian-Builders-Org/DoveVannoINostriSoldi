import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

const page = await readFile(new URL("../src/app/politici/page.tsx", import.meta.url), "utf8");
const graph = await readFile(new URL("../src/app/politici/repubblica-graph.tsx", import.meta.url), "utf8");
const panel = await readFile(new URL("../src/app/politici/repubblica-panel.tsx", import.meta.url), "utf8");
const judicial = await readFile(new URL("../src/app/politici/atlas-judicial.tsx", import.meta.url), "utf8");
const hemicycle = await readFile(new URL("../src/app/politici/atlas-hemicycle.tsx", import.meta.url), "utf8");
const styles = await readFile(new URL("../src/app/politici/politici.module.css", import.meta.url), "utf8");

test("the page ships only the marker list and keeps the snapshot server side", () => {
  assert.match(page, /graphPeopleWithDocumentedCases/u);
  assert.match(page, /judicialPersonIds=\{judicialPersonIds\}/u);
  assert.doesNotMatch(graph, /@\/data\/generated\/parlamento-giudiziario-xix\.json/u);
  assert.doesNotMatch(panel, /@\/data\/generated\/parlamento-giudiziario-xix\.json/u);
  assert.doesNotMatch(judicial, /@\/data\/generated\/parlamento-giudiziario-xix\.json/u);
});

test("the node marker states presence, never a severity ranking", () => {
  assert.match(hemicycle, /data-giudiziario=/u);
  assert.match(styles, /\.seat\[data-giudiziario="true"\]/u);
  // A severity ramp would encode guilt on the map: months and damages must not drive the node.
  assert.doesNotMatch(hemicycle, /sentenceMonths[\s\S]{0,120}(fill|opacity|r=)/u);
  assert.doesNotMatch(styles, /\.seat\[data-giudiziario[^\]]*\][^{]*\{[^}]*opacity/u);
});

test("the legend explains that the marker is a signal, not a verdict", () => {
  assert.match(hemicycle, /judicialSample/u);
  assert.match(hemicycle, /non una colpevolezza/u);
});

test("the person panel states the presumption of innocence and the stage reached", () => {
  assert.match(panel, /JudicialBlock/u);
  assert.match(judicial, /Procedimenti giudiziari documentati/u);
  assert.match(judicial, /art\. 27 della Costituzione/u);
  assert.match(judicial, /statusAsOf/u);
  assert.match(judicial, /judicialSteps/u);
});

test("a sentence is shown only for a case that ended in a conviction", () => {
  assert.match(judicial, /outcomeBucket === "condannato"\s*\?\s*formatSentenceMonths/u);
});

test("every case in the panel shows its sources", () => {
  assert.match(judicial, /Fonti:/u);
  assert.match(judicial, /source\.publisher/u);
  assert.match(judicial, /rel="noreferrer nofollow"/u);
});

test("the panel never renders an empty block that would read as a clean record", () => {
  assert.match(judicial, /judicial\.cases\.length === 0[\s\S]{0,80}return null/u);
  assert.match(judicial, /coverageNote/u);
});

test("the sources and limits section declares the judicial dataset", () => {
  assert.match(page, /Procedimenti giudiziari/u);
  assert.match(page, /editori indipendenti/u);
  assert.match(page, /judicial\.coverage\.checkedAt/u);
});
