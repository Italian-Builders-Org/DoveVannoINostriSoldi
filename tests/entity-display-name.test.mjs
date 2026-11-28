import assert from "node:assert/strict";
import test from "node:test";
import "./helpers/register-ts-alias.mjs";
import { displayCompanyName, displayEntityName } from "../src/lib/entity-display-name.ts";

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

// IPA publishes the central administrations in mixed case, but each ministry
// is spelled differently: an apostrophe for the accent, lowercase words after
// "Ministero dell'", an acronym prefix on one name only. The list on /enti
// read as three different styles.
test("ministry names share one spelling, accents and capitalisation", () => {
  assert.equal(displayEntityName("Ministero dell'Universita' e della Ricerca"), "Ministero dell'Università e della Ricerca");
  assert.equal(displayEntityName("Ministero dell'istruzione e del merito"), "Ministero dell'Istruzione e del Merito");
  assert.equal(displayEntityName("Ministero del turismo"), "Ministero del Turismo");
  assert.equal(displayEntityName("Ministero delle infrastrutture e dei trasporti"), "Ministero delle Infrastrutture e dei Trasporti");
  assert.equal(
    displayEntityName("Ministero dell'agricoltura, della sovranità alimentare e delle foreste"),
    "Ministero dell'Agricoltura, della Sovranità Alimentare e delle Foreste",
  );
  // The acronym prefix appears on one ministry only: dropped for display.
  assert.equal(displayEntityName("MIMIT - Ministero delle Imprese e del Made in Italy"), "Ministero delle Imprese e del Made in Italy");
  assert.equal(displayEntityName("Ministero della Giustizia"), "Ministero della Giustizia");
  assert.equal(displayEntityName("Ministero degli Affari Esteri e della Cooperazione Internazionale"), "Ministero degli Affari Esteri e della Cooperazione Internazionale");
});

test("mixed-case names outside ministries keep their spelling except known accented words", () => {
  assert.equal(displayEntityName("Presidenza del Consiglio dei Ministri"), "Presidenza del Consiglio dei Ministri");
  assert.equal(displayEntityName("Avvocatura dello Stato"), "Avvocatura dello Stato");
  assert.equal(displayEntityName("Comunita' Montana Valle Brembana"), "Comunità Montana Valle Brembana");
  assert.equal(displayEntityName("Citta' di Torino"), "Città di Torino");
  // A closing quote after a word is not an accent.
  assert.equal(displayEntityName("Fondazione 'Banca Etica'"), "Fondazione 'Banca Etica'");
  // An acronym prefix outside ministries is part of the name.
  assert.equal(displayEntityName("ASREM - Azienda sanitaria"), "ASREM - Azienda sanitaria");
});

// MEF participation names arrive in capitals with legal forms spelled many
// ways (S.P.A, SPA, SOC. CONS. A R. L.). Display only: the tax code and the
// raw name stay in the data.
test("company names read in title case with one spelling per legal form", () => {
  assert.equal(displayCompanyName("HERA S.P.A."), "Hera S.p.A.");
  assert.equal(displayCompanyName("ABBANOA S.P.A"), "Abbanoa S.p.A.");
  assert.equal(displayCompanyName("MONDO ACQUA SPA"), "Mondo Acqua S.p.A.");
  assert.equal(displayCompanyName("CAP HOLDING S.P.A."), "CAP Holding S.p.A.");
  assert.equal(displayCompanyName("ASMEL CONSORTILE SOC. CONS. A R.L."), "Asmel Consortile Soc. cons. a r.l.");
  assert.equal(displayCompanyName("ASMENET SOC. CONS. A R. L."), "Asmenet Soc. cons. a r.l.");
  assert.equal(displayCompanyName("VIVERACQUA S.C. A R.L."), "Viveracqua S.c. a r.l.");
  assert.equal(displayCompanyName("PAVIA ACQUE S.C.A R.L."), "Pavia Acque S.c. a r.l.");
  assert.equal(displayCompanyName("LEPIDA S.C.P.A."), "Lepida S.c.p.A.");
  assert.equal(displayCompanyName("ALFA S.R.L."), "Alfa S.r.l.");
  assert.equal(displayCompanyName("BETA SRL"), "Beta S.r.l.");
  assert.equal(displayCompanyName("CONSORZIO CEV"), "Consorzio CEV");
  assert.equal(
    displayCompanyName("CONSORZIO DEI COMUNI TRENTINI - SOCIETA' COOPERATIVA"),
    "Consorzio dei Comuni Trentini - Società Cooperativa",
  );
  assert.equal(
    displayCompanyName("SOCIETA' METROPOLITANA ACQUE TORINO S.P.A. IN ALTERNATIVA SMA TORINO S.P.A. OVVERO SMAT S.P.A."),
    "Società Metropolitana Acque Torino S.p.A. in alternativa SMA Torino S.p.A. ovvero SMAT S.p.A.",
  );
  assert.equal(
    displayCompanyName("S.I.I. - S.P.A. - SERVIZIO IDRICO INTEGRATO DEL BIELLESE E VERCELLESE SIGLABILE 'S.I.I. - S.P.A.'"),
    "S.I.I. - S.p.A. - Servizio Idrico Integrato del Biellese e Vercellese siglabile \u201cS.I.I. - S.p.A.\u201d",
  );
  // A closing quote is not an accented vowel.
  assert.equal(
    displayCompanyName("BANCA POPOLARE ETICA SOCIETA' COOPERATIVA PER AZIONI O IN FORMA ABBREVIATA 'BANCA ETICA' O 'BPE'."),
    "Banca Popolare Etica Società Cooperativa per Azioni o in forma abbreviata \u201cBanca Etica\u201d o \u201cBPE\u201d.",
  );
  // A word that merely contains a legal-form sequence is not a legal form.
  assert.equal(displayCompanyName("SPAZIO SRLS"), "Spazio Srls");
  assert.equal(displayCompanyName("Acea S.p.A."), "Acea S.p.A.");
});
