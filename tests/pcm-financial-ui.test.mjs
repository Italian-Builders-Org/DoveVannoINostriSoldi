import assert from "node:assert/strict";
import fs from "node:fs";
import test from "node:test";

const page = fs.readFileSync(new URL("../src/app/palazzo-chigi/page.tsx", import.meta.url), "utf8");
const css = fs.readFileSync(new URL("../src/app/palazzo-chigi/palazzo-chigi.module.css", import.meta.url), "utf8");
const treemap = fs.readFileSync(new URL("../src/app/palazzo-chigi/pcm-mission-treemap.tsx", import.meta.url), "utf8");
const parliament = fs.readFileSync(new URL("../src/app/parlamento/page.tsx", import.meta.url), "utf8");
const parliamentCss = fs.readFileSync(new URL("../src/app/parlamento/parlamento.module.css", import.meta.url), "utf8");

test("Palazzo Chigi keeps scope, accounting phases and source visible", () => {
  assert.match(page, /soltanto la Presidenza del Consiglio/);
  assert.match(page, /Conto competenza/);
  assert.match(page, /Conto residui/);
  assert.match(page, /non dichiara una licenza/);
  assert.match(page, /Scarica il file ufficiale XLSX/);
  assert.match(page, /Quota del pagato PCM/);
  assert.match(treemap, /dataKey="paymentsCents"/);
  assert.match(treemap, /mission\.paymentsCents > 0/);
  assert.match(treemap, /Le due missioni\s*\n?\s*a zero restano nella tabella/);
  assert.doesNotMatch(page, /spreco|corruzione|illecito/i);
});

test("institutional pages keep Parliament and Palazzo Chigi separate", () => {
  assert.match(parliament, /Camera e Senato hanno bilanci autonomi/);
  assert.match(parliament, /Solo metadati/);
  assert.doesNotMatch(parliament, /pcmFinancial|Palazzo Chigi/);
  assert.doesNotMatch(page, /parliamentSnapshot|Camera dei deputati|Senato della Repubblica/);
});

test("institutional tables explain horizontal access on mobile", () => {
  assert.match(parliament, /Scorri la tabella verso destra per vedere approvazione, copertura e fonti/);
  assert.match(parliament, /ID fonte:/);
  assert.match(page, /Scorri la tabella verso destra per vedere importi e quote/);
  assert.match(parliamentCss, /\.scrollHint/);
  assert.match(css, /\.scrollHint/);
});

test("Palazzo Chigi layout has bounded responsive collapses", () => {
  assert.match(css, /@media \(max-width: 900px\)/);
  assert.match(css, /@media \(max-width: 620px\)/);
  assert.doesNotMatch(css, /border-radius|box-shadow|linear-gradient|transition:\s*all/);
  assert.doesNotMatch(css, /#[0-9a-f]{3,8}/i);
});
