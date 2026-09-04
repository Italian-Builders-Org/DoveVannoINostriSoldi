import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

const fiscalPage = await readFile(
  new URL("../src/app/territori/fisco/page.tsx", import.meta.url),
  "utf8",
);
const fiscalCss = await readFile(
  new URL("../src/app/territori/fisco/fisco.module.css", import.meta.url),
  "utf8",
);
const invalidityPage = await readFile(
  new URL("../src/app/spese/invalidita/page.tsx", import.meta.url),
  "utf8",
);
const invalidityCss = await readFile(
  new URL("../src/app/spese/invalidita/invalidita.module.css", import.meta.url),
  "utf8",
);
const spendingPage = await readFile(new URL("../src/app/spese/page.tsx", import.meta.url), "utf8");
const spendingCss = await readFile(
  new URL("../src/app/spese/spese.module.css", import.meta.url),
  "utf8",
);
const healthPage = await readFile(
  new URL("../src/app/spese/sanita/page.tsx", import.meta.url),
  "utf8",
);
const healthCss = await readFile(
  new URL("../src/app/spese/sanita/sanita.module.css", import.meta.url),
  "utf8",
);
const controlsPage = await readFile(
  new URL("../src/app/controlli/page.tsx", import.meta.url),
  "utf8",
);
const controlsCss = await readFile(
  new URL("../src/app/controlli/controlli.module.css", import.meta.url),
  "utf8",
);
const participationsPage = await readFile(
  new URL("../src/app/partecipazioni/page.tsx", import.meta.url),
  "utf8",
);
const participationsCss = await readFile(
  new URL("../src/app/partecipazioni/partecipazioni.module.css", import.meta.url),
  "utf8",
);

test("the fiscal formula has one explicit screen-reader relationship", () => {
  const accessibleFormula =
    "Il saldo contabile territoriale è uguale alle entrate territorializzate meno le spese territorializzate.";
  assert.equal(fiscalPage.split(accessibleFormula).length - 1, 1);
  assert.match(fiscalPage, /className=\{styles\.formulaVisual\} aria-hidden="true"/);
  assert.doesNotMatch(fiscalPage, /className=\{styles\.formula\} aria-label=/);
  assert.match(fiscalCss, /@media \(max-width: 420px\)[\s\S]*?\.formulaVisual \{ display: grid;/);
  assert.match(fiscalCss, /\.formulaVisual strong \{ grid-column: 1 \/ -1; \}/);
});

test("the three INPS headline statistics use a complete responsive grid", () => {
  assert.match(invalidityPage, /className=\{`stat-strip \$\{styles\.stats\}`\}/);
  assert.match(invalidityCss, /grid-template-columns: repeat\(3, minmax\(0, 1fr\)\)/);
  assert.match(invalidityCss, /> div:nth-child\(-n \+ 2\) \{\s*border-bottom: 0;/);
  assert.match(invalidityCss, /@media \(max-width: 620px\)[\s\S]*?\.stats:global\(\.stat-strip\) \{ grid-template-columns: 1fr; \}/);
  assert.match(invalidityCss, /@media \(max-width: 620px\)[\s\S]*?> div:nth-child\(-n \+ 2\) \{[\s\S]*?border-bottom: 1px solid/);
});

test("municipal screening is marked derived, bounded and dimension-aware", () => {
  assert.match(controlsPage, /Screening derivato · OpenCivitas/);
  assert.match(controlsPage, /Non è un esito ufficiale di controllo/);
  assert.match(controlsPage, /Segnali da relazioni ufficiali/);
  assert.match(controlsPage, /Come leggere i numeri/);
  assert.match(controlsPage, /Popolazione implicita/);
  assert.match(controlsPage, /sensitivityByPopulationBand/);
  assert.match(controlsPage, /OpenCivitas/);
  assert.match(controlsPage, /selectedYear !== null/);
  assert.match(controlsPage, /ordinati per distanza dalla soglia solo per facilitare la lettura/);
  assert.match(controlsCss, /\.outlierTable table \{[\s\S]*?min-width: 900px;/);
});

test("scope guidance is consolidated without losing its source boundaries", () => {
  assert.equal(
    spendingPage.match(/className="notice scope-notice"/g)?.length,
    1,
  );
  assert.equal(
    controlsPage.match(/className="notice scope-notice"/g)?.length,
    1,
  );
  assert.match(spendingPage, /href=\{`\/territori\?anno=\$\{year\}`\}/);
  assert.match(spendingPage, /href="\/spese\/invalidita"/);
  assert.match(spendingPage, /href="\/stato"/);
  assert.match(spendingPage, /href="\/parlamento"/);
  assert.match(spendingPage, /href="\/spese\/sanita"/);
  assert.match(controlsPage, /href="\/fonti"/);
  assert.match(controlsPage, /href="\/metodologia"/);
  assert.match(controlsPage, /href="\/mcp"/);
  assert.match(controlsPage, /dati\.anticorruzione\.it\/opendata\/dataset/);
  assert.match(controlsPage, /Un segnale\s*\n?\s*indica cosa approfondire/);
  assert.match(controlsPage, /non sostituisce Guardia di finanza, ANAC, Corte dei conti/);
});

test("the SSN view labels accounting scope and remains responsive", () => {
  assert.match(healthPage, /misura costi di competenza economica/);
  assert.match(healthPage, /non pubblica una voce chiamata “gettonisti” o “cooperative”/);
  assert.match(healthPage, /alfabetico per codice geografico e Codice Ente SSN/);
  assert.match(healthPage, /codici 041[\s\S]*042/);
  assert.match(healthPage, /datasets\.entities\.sourceSha256/);
  assert.match(healthPage, /Aggregato nazionale ufficiale/);
  assert.match(healthPage, /integer\(data\.detailCoverage\.entityCount\)/);
  assert.match(healthPage, /Enti di dettaglio esposti/i);
  assert.match(
    healthPage,
    /aria-label="Non applicabile: il totale nazionale è un aggregato, senza conteggio enti"/,
  );
  assert.doesNotMatch(
    healthPage,
    /<span className=\{styles\.visuallyHidden\}>\s*Non applicabile:/,
  );
  assert.match(healthCss, /grid-template-columns: repeat\(3, minmax\(0, 1fr\)\)/);
  assert.match(healthCss, /@media \(max-width: 620px\)[\s\S]*?grid-template-columns: 1fr/);
  assert.doesNotMatch(healthCss, /border-radius\s*:/);
});

test("the spending analysis explains the share without turning it into a merit ranking", () => {
  assert.equal(spendingPage.match(/className=\{styles\.analysis\}/g)?.length, 1);
  assert.match(spendingPage, /spese correnti/);
  assert.match(spendingPage, /Titolo 1 nella fonte\s*\n?\s*SIOPE/);
  assert.match(spendingPage, /Misura di cassa e\s*\n?\s*classificazione contabile/);
  assert.match(spendingPage, /Confronto tra snapshot/);
  assert.match(spendingPage, /partialComparisonYears/);
  assert.doesNotMatch(spendingPage, /il 2026 è ancora parziale/);
  assert.match(spendingPage, /<th scope="col" className="num">Quota<\/th>/);
  assert.match(spendingPage, /<th scope="col">Stato<\/th>/);
  assert.match(spendingPage, /distribuzione completa/);
  assert.match(spendingPage, /data\.distribution\.perCapita\.residentWeighted/);
  assert.doesNotMatch(spendingPage, /primi 100/);
  assert.doesNotMatch(spendingPage, /warning-notice/);
  assert.match(spendingCss, /\.analysis \{/);
  assert.match(spendingCss, /@media \(max-width: 620px\)[\s\S]*?\.quantiles \{/);
  assert.match(spendingCss, /@media \(max-width: 420px\)[\s\S]*?table-layout: fixed/);
});

test("wide oversight tables disclose horizontal scrolling on mobile", () => {
  assert.equal(controlsPage.match(/className=\{styles\.tableHint\}/g)?.length, 4);
  assert.match(controlsPage, /aria-describedby="outlier-table-hint"/);
  assert.match(controlsPage, /aria-describedby="sensitivity-table-hint"/);
  assert.match(controlsPage, /aria-describedby="procurement-table-hint"/);
  assert.match(controlsPage, /aria-describedby="scenario-table-hint"/);
  assert.match(controlsCss, /\.tableHint \{\s*display: none;/);
  assert.match(controlsCss, /@media \(max-width: 620px\)[\s\S]*?\.tableHint \{[\s\S]*?display: block;/);
  assert.match(participationsPage, /aria-describedby="participations-table-hint"/);
  assert.match(participationsPage, /Freccia sinistra e Freccia destra/);
  assert.match(participationsCss, /@media \(max-width: 620px\)[\s\S]*?\.tableHint \{[\s\S]*?display: block;/);
});
