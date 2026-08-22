import assert from "node:assert/strict";
import fs from "node:fs";
import test from "node:test";

const page = fs.readFileSync(new URL("../src/app/regioni/page.tsx", import.meta.url), "utf8");
const css = fs.readFileSync(new URL("../src/app/regioni/regioni.module.css", import.meta.url), "utf8");
const treemap = fs.readFileSync(new URL("../src/app/regioni/region-title-treemap.tsx", import.meta.url), "utf8");

test("Regions page uses only the verified Istat regional account", () => {
  assert.match(page, /istatRegionsSnapshot/);
  assert.match(page, /22 amministrazioni/);
  assert.match(page, /impegni, non pagamenti/);
  assert.match(page, /non li mescoliamo con\s*\n?\s*Comuni, sanità, CPT o residuo fiscale/);
  assert.doesNotMatch(page, /getRegionalFiscal|SIOPE|OpenCivitas/);
});

test("Regions page exposes a URL filter, exact table and honest comparison limits", () => {
  assert.match(page, /searchParams: Promise/);
  assert.match(page, /name="ente"/);
  assert.match(page, /Non è una classifica tra territori/);
  assert.match(page, /non calcoliamo valori pro capite/);
  assert.match(page, /in questa vista non usiamo la mappa/);
  assert.match(page, /Valori esatti degli impegni 2024/);
  assert.match(page, /Scorri la tabella verso destra/);
  assert.doesNotMatch(page, /spreco|corruzione|illecito/i);
});

test("Regional treemap is additive and exact tables remain internally scrollable", () => {
  assert.match(treemap, /commitmentsCents \/ entity\.commitmentsCents/);
  assert.match(treemap, /aria-describedby="regioni-treemap-caption"/);
  assert.match(treemap, /un solo consuntivo, una sola amministrazione, impegni 2024/);
  assert.match(css, /min-width: 680px/);
  assert.match(css, /min-width: 760px/);
  assert.match(css, /@media \(max-width: 620px\)/);
  assert.doesNotMatch(`${css}\n${treemap}`, /border-radius|box-shadow|linear-gradient|transition:\s*all/);
});
