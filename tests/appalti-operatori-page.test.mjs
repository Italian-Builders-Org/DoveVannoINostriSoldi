import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

const pageSource = readFileSync(new URL("../src/app/appalti/operatori/page.tsx", import.meta.url), "utf8");
const detailSource = readFileSync(new URL("../src/app/appalti/operatori/[ref]/page.tsx", import.meta.url), "utf8");

test("operatori hub leads with summary tables and glossary", () => {
  assert.match(pageSource, /loadAnacOperatorNationalSummaries/);
  assert.match(pageSource, /Come leggere questi numeri/);
  assert.match(pageSource, /Cosa compare più spesso/);
  assert.match(pageSource, /Imprese con più aggiudicazioni/);
  assert.match(pageSource, /Imprese con più valore attribuibile/);
  assert.match(pageSource, /Categorie di lavoro più frequenti/);
  assert.match(pageSource, /Chi bandisce più spesso/);
  assert.match(pageSource, /Oggetti di gara più ripetuti/);
  assert.match(pageSource, /Vai all&apos;elenco completo/);
  assert.match(pageSource, /vista:\s*"elenco"/);
  assert.match(pageSource, /non sono giudizi, illeciti/);
  assert.match(pageSource, /barTrack/);
  assert.match(pageSource, /Apri la tabella con i numeri esatti/);
});

test("operatori full list stays behind vista=elenco with back link", () => {
  assert.match(pageSource, /first\(search\.vista\) === "elenco"/);
  assert.match(pageSource, /Torna alle tabelle riassuntive/);
  assert.match(pageSource, /listAnacOperatorsPage/);
});

test("operatori hub declares the below-threshold limitation without estimating it", () => {
  assert.match(pageSource, /OPERATOR_THRESHOLD_METHODOLOGY_URL/);
  assert.match(pageSource, /Sotto soglia<\/strong> = stato “non disponibile”/);
  assert.match(pageSource, /non viene stimata/);
});

test("operator detail links each CIG to the source and shows the threshold status", () => {
  assert.match(detailSource, /anacCigDetailUrl\(award\.cig\)/);
  assert.match(detailSource, /publishedProcedureFields\(award\.procedure\)/);
  assert.match(detailSource, /describeDistinctContractingAuthorities\(authorityCount\)/);
  assert.match(detailSource, /BELOW_THRESHOLD_REQUIRED_INPUTS\.map/);
  assert.match(detailSource, /dettaglio ufficiale ANAC/);
  assert.match(detailSource, /non indica di per sé un illecito/);
});
