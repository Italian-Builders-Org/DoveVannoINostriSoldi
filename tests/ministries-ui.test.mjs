import assert from "node:assert/strict";
import fs from "node:fs";
import test from "node:test";

const page = fs.readFileSync(new URL("../src/app/ministeri/page.tsx", import.meta.url), "utf8");
const css = fs.readFileSync(new URL("../src/app/ministeri/ministeri.module.css", import.meta.url), "utf8");
const treemap = fs.readFileSync(new URL("../src/app/ministeri/ministry-commitment-treemap.tsx", import.meta.url), "utf8");

test("Ministries page uses the locked RGS rendiconto without mixing institutions", () => {
  assert.match(page, /rgsMinistriesSnapshot/);
  assert.match(page, /rendiconto dello Stato 2025/);
  assert.match(page, /Non\s*\n?\s*includiamo Palazzo Chigi, Camera, Senato o Regioni/);
  assert.doesNotMatch(page, /getStateSpendingSnapshot|pcmFinancial|CPT/);
});

test("Ministries page keeps the competence frame exact and separate", () => {
  assert.match(page, /Pagato CP/);
  assert.match(page, /Rimasto da pagare CP/);
  assert.match(page, /Due componenti del Totale CP/);
  assert.match(page, /non è un totale di cassa/);
  assert.match(page, /da sola, non misura un\s*\n?\s*debito da pagare/);
  assert.match(page, /importo di competenza rimasto inutilizzato rispetto alle\s*\n?\s*previsioni o utilizzato oltre i limiti/);
  assert.match(page, /senza arrotondamenti intermedi/);
  assert.match(page, /Scorri la tabella verso destra/);
  assert.match(page, /sourceRecordId/);
  assert.match(page, /data-institutional-section/g);
  assert.doesNotMatch(page, /Pagamenti CS|Residui al 31\/12|Quota impegni CP/);
  assert.doesNotMatch(page, /quota non pagata|impegni non pagata/i);
  assert.doesNotMatch(page, /stato\/amministrazioni|Apri i pagamenti per missione/);
  assert.doesNotMatch(page, /spreco|corruzione|illecito/i);
});

test("Totale CP has a treemap and an exact accessible table fallback", () => {
  assert.match(treemap, /dataKey="totalCpCents"/);
  assert.match(treemap, /Composizione del Totale CP 2025/);
  assert.match(treemap, /aria-describedby="ministeri-totale-cp-caption"/);
  assert.match(treemap, /figcaption id="ministeri-totale-cp-caption"/);
  assert.match(treemap, /isAnimationActive={false}/);
  assert.match(page, /exactEuro\(euro\(ministry\.commitmentsCpCents\)\)/);
  assert.match(page, /exactEuro\(euro\(totals\.commitmentsCpCents\)\)/);
});

test("Ministries exact table remains internally scrollable", () => {
  assert.match(css, /min-width: 820px/);
  assert.match(css, /@media \(max-width: 900px\)/);
  assert.match(css, /@media \(max-width: 620px\)/);
  assert.doesNotMatch(css, /border-radius|box-shadow|linear-gradient|transition:\s*all/);
});
