import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

const page = await readFile(new URL("../src/app/politici/page.tsx", import.meta.url), "utf8");
const graph = await readFile(new URL("../src/app/politici/repubblica-graph.tsx", import.meta.url), "utf8");
const panel = await readFile(new URL("../src/app/politici/repubblica-panel.tsx", import.meta.url), "utf8");
const judicial = await readFile(new URL("../src/app/politici/atlas-judicial.tsx", import.meta.url), "utf8");
const hemicycle = await readFile(new URL("../src/app/politici/atlas-hemicycle.tsx", import.meta.url), "utf8");
const styles = await readFile(new URL("../src/app/politici/politici.module.css", import.meta.url), "utf8");
const judicialPanel = await readFile(new URL("../src/app/politici/atlas-judicial.tsx", import.meta.url), "utf8");
const convictions = await readFile(new URL("../src/app/politici/atlas-condanne.tsx", import.meta.url), "utf8");
const snapshot = JSON.parse(
  await readFile(new URL("../src/data/generated/parlamento-giudiziario-xix.json", import.meta.url), "utf8"),
);

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

test("an amount is called danno erariale only when the Corte dei conti established it", () => {
  // Una provvisionale in un processo penale non e danno erariale, e su una sentenza
  // riformata non e piu dovuta: l'importo non deve comparire.
  assert.match(judicialPanel, /jurisdiction === "contabile" && item\.outcomeBucket === "contabile"/u);
  const snapshotCases = snapshot.cases.filter(
    (item) => item.jurisdiction !== "contabile" && item.events.some((event) => event.damagesEuroCents !== null),
  );
  assert.ok(snapshotCases.length > 0, "il test perde senso se nessun caso penale porta un importo");
});

test("every case states both when it happened and when we last looked", () => {
  // Due date diverse: la data dell'atto e la data del nostro controllo. Confonderle
  // fa sembrare recente un procedimento fermo da anni.
  for (const surface of [judicialPanel, convictions]) {
    assert.match(surface, /stato al \{item\.statusAsOf\}/u);
    assert.match(surface, /verificato il \{item\.verifiedAt\}/u);
    assert.doesNotMatch(surface, /aggiornato al/u);
  }
});

test("a proceeding left unchecked is shown as such on both surfaces", () => {
  assert.match(judicialPanel, /recheck === "da-riverificare"/u);
  assert.match(judicialPanel, /judicialRecheckNote/u);
  assert.match(convictions, /recheck === "da-riverificare"/u);
  assert.match(styles, /\.judicialRecheck\b/u);
});

test("the re-check flag never removes the case, it only stops it looking fresh", () => {
  // The record keeps its last known status: hiding it would erase a documented fact.
  assert.doesNotMatch(judicialPanel, /recheck === "da-riverificare"[\s\S]{0,60}return null/u);
});
