import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

const pageSource = readFileSync(new URL("../src/app/appalti/operatori/page.tsx", import.meta.url), "utf8");

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
