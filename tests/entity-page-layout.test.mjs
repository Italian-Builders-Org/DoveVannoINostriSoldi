import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

const entityPage = readFileSync(new URL("../src/app/enti/[codice]/page.tsx", import.meta.url), "utf8");
const entityInformation = readFileSync(new URL("../src/app/enti/[codice]/entity-information.tsx", import.meta.url), "utf8");

test("entity pages use one readable column layout for every profile type", () => {
  assert.match(entityPage, /className=\{styles\.municipalityLayout\}/);
  assert.doesNotMatch(entityPage, /styles\.split/);
  assert.doesNotMatch(entityPage, /Identità amministrativa/);
  assert.doesNotMatch(entityPage, /Altri dati economici · collegamenti in corso/);
  assert.match(entityPage, /EntityProcurementSection state=\{procurementState\}/);
  assert.match(entityPage, /EntityInformation/);
  assert.match(entityPage, /variant=\{isMunicipality \? "municipality" : "organization"\}/);
});

test("entity information keeps administrative details in a collapsed panel", () => {
  assert.match(entityInformation, /data-entity-information/);
  assert.match(entityInformation, /Informazioni sull'ente e fonti/);
  assert.match(entityInformation, /Informazioni sul Comune e fonti/);
  assert.match(entityInformation, /Uffici dichiarati in IPA/);
  assert.match(entityInformation, /Altri collegamenti economici/);
});
