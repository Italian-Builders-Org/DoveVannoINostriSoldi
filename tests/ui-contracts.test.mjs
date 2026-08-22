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
const sourcesPage = await readFile(new URL("../src/app/fonti/page.tsx", import.meta.url), "utf8");
const sourcesCss = await readFile(
  new URL("../src/app/fonti/fonti.module.css", import.meta.url),
  "utf8",
);
const mcpPage = await readFile(new URL("../src/app/mcp/page.tsx", import.meta.url), "utf8");
const mcpCss = await readFile(new URL("../src/app/mcp/mcp.module.css", import.meta.url), "utf8");
const methodologyPage = await readFile(
  new URL("../src/app/metodologia/page.tsx", import.meta.url),
  "utf8",
);
const sourceStatusPage = await readFile(
  new URL("../src/app/fonti/stato/page.tsx", import.meta.url),
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
  assert.match(controlsPage, /Screening derivato sui Comuni/);
  assert.match(controlsPage, /non è una classifica di/);
  assert.match(controlsPage, /Popolazione implicita/);
  assert.match(controlsPage, /sensitivityByPopulationBand/);
  assert.match(controlsPage, /OpenCivitas/);
  assert.match(controlsPage, /selectedYear !== null/);
  assert.match(controlsPage, /non\s+sono una graduatoria di Comuni/);
  assert.match(controlsCss, /\.outlierTable table \{[\s\S]*?min-width: 900px;/);
});

test("wide oversight tables disclose horizontal scrolling on mobile", () => {
  assert.equal(controlsPage.match(/className=\{styles\.tableHint\}/g)?.length, 4);
  assert.match(controlsPage, /aria-describedby="outlier-table-hint"/);
  assert.match(controlsPage, /aria-describedby="procurement-table-hint"/);
  assert.match(controlsCss, /\.tableHint \{\s*display: none;/);
  assert.match(controlsCss, /@media \(max-width: 620px\)[\s\S]*?\.tableHint \{[\s\S]*?display: block;/);
  assert.match(participationsPage, /aria-describedby="participations-table-hint"/);
  assert.match(participationsPage, /Freccia sinistra e Freccia destra/);
  assert.match(participationsCss, /@media \(max-width: 620px\)[\s\S]*?\.tableHint \{[\s\S]*?display: block;/);
});

test("source and MCP registries preserve complete mobile table geometry", () => {
  assert.match(sourcesPage, /aria-describedby="sources-table-hint"/);
  assert.match(sourcesCss, /\.sourceTable \{\s*min-width: 980px;/);
  assert.match(mcpPage, /aria-describedby="datasets-table-hint"/);
  assert.match(mcpCss, /\.datasetTable \{[^}]*min-width: 1100px;/);
  assert.match(mcpCss, /@media \(max-width: 760px\)[\s\S]*?\.tableHint \{[\s\S]*?display: block;/);
});

test("supporting pages avoid decorative sequence labels", () => {
  assert.doesNotMatch(methodologyPage, /styles\.index|padStart/);
  assert.doesNotMatch(sourceStatusPage, /styles\.kicker|STATO DELLE FONTI/);
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
  assert.match(controlsPage, /non dimostra una colpa/);
  assert.match(controlsPage, /non sostituisce Guardia di finanza, ANAC, Corte dei conti/);
});

test("the SSN view labels accounting scope and remains responsive", () => {
  assert.match(healthPage, /competenza economica, non pagamenti di cassa/);
  assert.match(healthPage, /non pubblica una voce chiamata “gettonisti” o “cooperative”/);
  assert.match(healthPage, /Non è una graduatoria/);
  assert.match(healthPage, /codici 041[\s\S]*042/);
  assert.match(healthPage, /datasets\.entities\.sourceSha256/);
  assert.match(healthPage, /Aggregato nazionale ufficiale/);
  assert.match(healthPage, /integer\(data\.detailCoverage\.entityCount\)/);
  assert.match(healthPage, /Enti di dettaglio esposti/i);
  assert.match(
    healthPage,
    /aria-label="Non applicabile: il totale nazionale non è un conteggio di enti"/,
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
  assert.match(spendingPage, /Titolo 1 · spese correnti/);
  assert.match(spendingPage, /non dice se una spesa sia utile/);
  assert.match(spendingPage, /Il confronto non è un trend/);
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
