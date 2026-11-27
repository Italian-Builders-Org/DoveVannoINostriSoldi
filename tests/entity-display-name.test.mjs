import assert from "node:assert/strict";
import test from "node:test";
import "./helpers/register-ts-alias.mjs";
import { displayEntityName } from "../src/lib/entity-display-name.ts";

// The SIOPE registry publishes entity names in capitals with raw separators.
// The /enti list shows a readable form; links and data keep the raw value.
test("entity names read as Italian title case with lowercase connectors", () => {
  assert.equal(displayEntityName("AZIENDA SANITARIA LOCALE VITERBO"), "Azienda Sanitaria Locale Viterbo");
  assert.equal(displayEntityName("AZIENDA SANITARIA PROVINCIALE DI REGGIO CALABRIA"), "Azienda Sanitaria Provinciale di Reggio Calabria");
  assert.equal(displayEntityName("AZIENDA SOCIO SANITARIA LOCALE N.2 DELLA GALLURA"), "Azienda Socio Sanitaria Locale N.2 della Gallura");
  assert.equal(displayEntityName("AZIENDA PER LA TUTELA DELLA SALUTE - ATS SARDEGNA"), "Azienda per la Tutela della Salute - ATS Sardegna");
});

test("elisions keep the article lowercase and the noun capitalised", () => {
  assert.equal(displayEntityName("PROVINCIA DELL'OGLIASTRA"), "Provincia dell'Ogliastra");
  assert.equal(displayEntityName("AZIENDA SANITARIA LOCALE 1 DI AVEZZANO-SULMONA-L'AQUILA"), "Azienda Sanitaria Locale 1 di Avezzano-Sulmona-L'Aquila");
  assert.equal(displayEntityName("AMMINISTRAZIONE PROVINCIALE DELL'AQUILA"), "Amministrazione Provinciale dell'Aquila");
});

test("a final apostrophe is the registry's spelling of an accented vowel", () => {
  assert.equal(displayEntityName("CITTA' METROPOLITANA DI SASSARI"), "Città Metropolitana di Sassari");
  assert.equal(displayEntityName("AZIENDA UNITA' SANITARIA LOCALE UMBRIA 1"), "Azienda Unità Sanitaria Locale Umbria 1");
  assert.equal(displayEntityName("AMMINISTRAZIONE PROVINCIALE DI FORLI'CESENA"), "Amministrazione Provinciale di Forlì-Cesena");
});

test("acronyms, health-district codes and Roman numerals stay uppercase", () => {
  assert.equal(displayEntityName("AZIENDA ULSS N.4 VENETO ORIENTALE"), "Azienda ULSS N.4 Veneto Orientale");
  assert.equal(displayEntityName("AZIENDA USL DI IMOLA"), "Azienda USL di Imola");
  assert.equal(displayEntityName("ASREM - AZIENDA SANITARIA REGIONALE DEL MOLISE"), "ASREM - Azienda Sanitaria Regionale del Molise");
  assert.equal(displayEntityName("AZIENDA SANITARIA LOCALE CN1"), "Azienda Sanitaria Locale CN1");
  assert.equal(displayEntityName("AZIENDA SANITARIA LOCALE NO DI NOVARA"), "Azienda Sanitaria Locale NO di Novara");
  // "AL" is also the article "al": after "Locale" it is Alessandria's code.
  assert.equal(displayEntityName("AZIENDA SANITARIA LOCALE AL DI ALESSANDRIA"), "Azienda Sanitaria Locale AL di Alessandria");
  assert.equal(displayEntityName("AZIENDA SANITARIA LOCALE DI BRINDISI"), "Azienda Sanitaria Locale di Brindisi");
  assert.equal(displayEntityName("AZIENDA SANITARIA LOCALE DI ASTI - ASL AT"), "Azienda Sanitaria Locale di Asti - ASL AT");
  assert.equal(displayEntityName("AZIENDA SANITARIA LOCALE DI MATERA A.S.M."), "Azienda Sanitaria Locale di Matera A.S.M.");
  assert.equal(displayEntityName("AZIENDA UNITA' SANITARIA LOCALE - IRCCS DI REGGIO EMILIA"), "Azienda Unità Sanitaria Locale - IRCCS di Reggio Emilia");
  assert.equal(displayEntityName("MUNICIPIO ROMA II"), "Municipio Roma II");
  assert.equal(displayEntityName("ASP DI ENNA"), "ASP di Enna");
});

test("raw underscores become spaces and the first word is always capitalised", () => {
  assert.equal(
    displayEntityName("AZIENDA PER IL GOVERNO DELLA SANITA' DELLA REGIONE CALABRIA_AZIENDA_ZERO"),
    "Azienda per il Governo della Sanità della Regione Calabria Azienda Zero",
  );
  assert.equal(displayEntityName("  DI  PROVA  "), "Di Prova");
  assert.equal(displayEntityName("AMMINISTRAZIONE PROVINCIALE DI BARLETTA, ANDRIA E TRANI"), "Amministrazione Provinciale di Barletta, Andria e Trani");
});

test("already mixed-case names are left as published", () => {
  assert.equal(displayEntityName("Comune di Reggio nell'Emilia"), "Comune di Reggio nell'Emilia");
  assert.equal(displayEntityName(""), "");
});
