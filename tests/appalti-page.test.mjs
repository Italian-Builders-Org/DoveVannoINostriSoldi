import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import "./helpers/register-ts-alias.mjs";

const pageSource = readFileSync(new URL("../src/app/appalti/page.tsx", import.meta.url), "utf8");
const scrollRegionSource = readFileSync(new URL("../src/app/appalti/scroll-region.tsx", import.meta.url), "utf8");
const stylesSource = readFileSync(new URL("../src/app/appalti/appalti.module.css", import.meta.url), "utf8");
const controlsPageSource = readFileSync(new URL("../src/app/controlli/page.tsx", import.meta.url), "utf8");
const { anacCigSnapshot } = await import("../src/lib/anac-cig-snapshot.ts");

test("appalti page keeps the verified 2025 denominators and scope visible", () => {
  assert.match(pageSource, /Periodo: 2025/);
  assert.match(pageSource, /CIG unici/);
  assert.match(pageSource, /servizi e forniture/);
  assert.match(pageSource, /importo_lotto/);
  assert.equal(anacCigSnapshot.population.records, 1_453_918);
  assert.equal(anacCigSnapshot.population.servicesAndSupplies, 1_290_218);
  assert.equal(anacCigSnapshot.procedureChoice.directAward.records, 1_192_083);
  assert.equal(anacCigSnapshot.procedureChoice.directAward.amountEuroCents, 23_938_909_526_365);
  assert.equal(anacCigSnapshot.servicesAndSuppliesBelow140000.records, 1_159_940);
  assert.equal(anacCigSnapshot.thresholdBand135000To140000.strictContractRecords, 13_393);
  assert.match(pageSource, /quota sul numero di CIG/);
  assert.match(pageSource, /Affidamento diretto · sul valore CIG/);
  assert.match(pageSource, /amountShare\(/);
  assert.match(pageSource, /Valore dichiarato/);
  assert.match(pageSource, /Quota valore/);
  assert.match(controlsPageSource, /href="\/appalti"/);
});

test("appalti page makes the chart/table equivalence and denominator explicit", () => {
  assert.match(pageSource, /Distribuzione delle etichette/);
  assert.match(pageSource, /Tabella esatta della distribuzione/);
  assert.match(pageSource, /CIG e somma importo_lotto/);
  assert.match(pageSource, /Quota CIG/);
  assert.match(pageSource, /Apri tutte le 32 etichette originali/);
  assert.match(pageSource, /AFFIDAMENTO DIRETTO/);
  assert.match(pageSource, /row\.records \/ totalCigs/);
  assert.match(pageSource, /row\.amountEuroCents/);
  assert.doesNotMatch(pageSource, /largestProcedureCount/);
  assert.match(pageSource, /ScrollRegion/);
  assert.match(scrollRegionSource, /event\.key === "End"/);
  assert.equal((pageSource.match(/Scorri la tabella verso destra/g) ?? []).length, 4);
  assert.equal(anacCigSnapshot.provenance.license, "CC BY-SA 4.0");
});

test("appalti page separates CIG euro sums from the Relazione ANAC perimeter", () => {
  assert.match(pageSource, /Come leggere questi numeri/);
  assert.match(pageSource, /stesso snapshot CIG 2025/);
  assert.match(pageSource, /Non confondere con la Relazione ANAC/);
  assert.match(pageSource, /Non sostituisce i numeri della tabella/);
  assert.match(pageSource, /40\.000 € in su/);
  assert.doesNotMatch(pageSource, /Sul valore in euro la storia cambia/);
  const tableMarker = pageSource.indexOf("procedure-breakdown-title");
  const relazioneMarker = pageSource.indexOf("value-share-title");
  assert.ok(tableMarker >= 0);
  assert.ok(relazioneMarker > tableMarker);
});

test("appalti page treats threshold concentrations as screening signals, not findings", () => {
  assert.match(pageSource, /indicano dove guardare\s*\n?\s*meglio negli atti/);
  assert.match(pageSource, /serve a scegliere cosa verificare negli atti/);
  assert.match(pageSource, /Definizione stretta/);
  assert.match(pageSource, /thresholdBand\.strictContractDefinition/);
  assert.match(pageSource, /135\.000 €/);
  assert.match(stylesSource, /\.detailTable\s*\{[^}]*min-width:\s*0/);
  assert.doesNotMatch(pageSource, /93%|quasi 95%|sprechi accertati|fornitori?\s*:/i);
});

test("appalti page keeps sources and methodology after the data sections", () => {
  const dataStart = pageSource.indexOf("procedure-breakdown-title");
  const sourceStart = pageSource.indexOf("sources-title");
  assert.ok(dataStart >= 0);
  assert.ok(sourceStart > dataStart);
  assert.match(anacCigSnapshot.provenance.datasetUrl, /^https:\/\/dati\.anticorruzione\.it\//);
  assert.match(pageSource, /12 mesi completi/);
});

test("appalti page avoids supplier attribution", () => {
  assert.match(pageSource, /senza nomi di fornitori/);
  assert.match(pageSource, /né concentrazione\s*\n?\s*per soggetto/);
});
