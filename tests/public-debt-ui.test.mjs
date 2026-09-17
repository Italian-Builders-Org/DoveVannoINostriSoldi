import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

const page = await readFile(new URL("../src/app/debito/page.tsx", import.meta.url), "utf8");
const chart = await readFile(new URL("../src/components/charts/public-debt-history-chart.tsx", import.meta.url), "utf8");
const styles = await readFile(new URL("../src/app/debito/debito.module.css", import.meta.url), "utf8");

test("debt page is server-first and follows the seven-question hierarchy", () => {
  assert.doesNotMatch(page, /^"use client"/);
  const questions = ["Quanto debito c’è", "Perché è cambiato", "A cosa serve e come viene rimborsato", "Da cosa è composto", "Chi lo detiene", "Quando deve essere rifinanziato", "Come può incidere sulla tua vita"];
  let cursor = -1;
  for (const question of questions) { const next = page.indexOf(question); assert.ok(next > cursor, question); cursor = next; }
  assert.match(page, /Il dato, da solo, non prova che un servizio verrà tagliato o che una tassa aumenterà/);
  assert.match(page, /Quando una parte maggiore del debito deve essere rifinanziata presto/);
  for (const heading of ["Cosa vediamo", "Come funziona", "Come può arrivare alla tua vita", "Cosa non dimostra"]) {
    assert.equal(page.match(new RegExp(`<h4>${heading}</h4>`, "g"))?.length, 3, heading);
  }
});

test("debt page exposes financing, composition, holder and refinancing boundaries", () => {
  assert.match(page, /netShortTermSecuritiesCents/);
  assert.match(page, /netMediumLongTermSecuritiesCents/);
  assert.match(page, /Netto significa emissioni meno rimborsi/);
  assert.match(page, /Un valore positivo non è il totale collocato/);
  assert.match(page, /Composizione del debito in euro convertiti/);
  assert.match(page, /componente \/ totale/);
  assert.match(page, /settori istituzionali, non singoli investitori/i);
  assert.match(page, /Altri residenti” non equivale alle sole famiglie/);
  assert.match(page, /Eurosistema possono apparire tra i non residenti/);
  assert.match(page, /non è una previsione di crisi né il calendario delle singole aste/);
});

test("citizen impact keeps observed values, formulas, sources and non-predictive copy together", () => {
  assert.match(page, /I dati non dicono che domani aumenteranno le tasse o diminuiranno i servizi/);
  assert.match(page, /D41PAY \/ TE × 100/);
  assert.match(page, /euro di interessi ogni 100 euro di spesa pubblica totale/);
  assert.match(page, /Importo nominale e quota possono muoversi in direzioni diverse/);
  assert.match(page, /non è una fattura individuale/);
  assert.doesNotMatch(page, /quota per cittadino|debito speso in|spread/i);
});

test("official sources are linked in a new tab and periods remain distinct", () => {
  for (const source of ["landingUrl", "bdsUrl", "datasetUrl", "termsUrl", "TREASURY_URL"]) assert.match(page, new RegExp(source));
  assert.ok((page.match(/target="_blank"/g) ?? []).length >= 7);
  assert.match(page, /Detentori al/);
  assert.match(page, /bancaditalia\.accessedAt/);
  assert.match(page, /eurostat\.accessedAt/);
  assert.match(page, /upstreamUpdatedAt/);
  assert.match(page, /precisionNote/);
  assert.match(page, /accessedAt/);
  assert.match(page, /attribution/);
  assert.doesNotMatch(page, /esatti|esatta/);
});

test("debt page follows the shared civic shell and source provenance pattern", () => {
  assert.match(page, /<main className="shell page">/);
  assert.match(page, /<header className="page-intro">/);
  assert.match(page, /stat-strip/);
  assert.ok((page.match(/className={`panel \$\{styles\.section\}`}/g) ?? []).length >= 7);
  assert.match(page, /Apri sempre il dato originale/);
  assert.match(page, /I link portano ai dati e alle pagine ufficiali usati per costruire questa pagina/);
  assert.match(page, /className={styles\.provenanceRow}/);
  assert.match(page, /className={styles\.provenanceActions}/);
  assert.match(styles, /\.provenanceRow\s*\{/);
  assert.match(styles, /@media \(max-width: 760px\)/);
  assert.match(styles, /\.provenanceRow\s*\{[^}]*grid-template-columns:\s*1fr/s);
});

test("the only debt client component is a non-animated line with a table equivalent", () => {
  assert.match(chart, /^"use client"/);
  assert.match(chart, /<Line /);
  assert.doesNotMatch(chart, /<Area|<Bar/);
  assert.match(chart, /isAnimationActive=\{false\}/);
  assert.match(chart, /ChartDataTable/);
});
