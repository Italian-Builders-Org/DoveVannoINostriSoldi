import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

const source = (path) => readFile(new URL(path, import.meta.url), "utf8");

test("PNRR catalog is server-rendered, searchable, and semantically cautious", async () => {
  const page = await source("../src/app/coesione/asili/page.tsx");
  assert.doesNotMatch(page, /^["']use client["'];/m);
  assert.match(page, /queryPnrrChildcare/);
  assert.match(page, /finanziamento PNRR registrato/i);
  assert.match(page, /pista documentale su CUP, finanziamenti, gare e aggiudicatari/i);
  assert.match(page, /non contiene i pagamenti ReGiS/i);
  assert.match(page, /Intero archivio:[\s\S]*?coverage\.uniqueProjects/);
  assert.match(page, /submeasure\.code/);
  assert.match(page, /longDate\(pnrrChildcareMeta\.referenceDate\)/);
  assert.match(page, /pnrrChildcareMeta\.source\.landingUrl/);
  assert.equal(page.match(/<h1\b/g)?.length, 1);
  assert.match(page, /aria-label="Pagine dei risultati"/);
  assert.doesNotMatch(page, /heroMetric|kicker|01 ·|02 ·/);
});

test("project trace labels observed, linked, derived and missing evidence", async () => {
  const page = await source("../src/app/progetti/[cup]/page.tsx");
  for (const evidence of ["osservato", "collegato", "derivato", "mancante"]) {
    assert.match(page, new RegExp(`kind=\\"${evidence}\\"`));
  }
  assert.match(page, /Pagamenti ReGiS/);
  assert.match(page, /non vengono attribuite a una procedura per approssimazione/i);
  assert.doesNotMatch(page, /Promise\.race/);
  assert.match(page, /getPublicWorksByCup\(cup,\s*\{\s*signal:\s*AbortSignal\.timeout\(3_500\),?\s*\}\)/);
  assert.match(page, /3_500/);
  assert.equal(page.match(/<h1\b/g)?.length, 1);
});

test("PNRR layouts collapse every major grid on narrow screens", async () => {
  const [catalogCss, projectCss] = await Promise.all([
    source("../src/app/coesione/asili/pnrr-asili.module.css"),
    source("../src/app/progetti/[cup]/project.module.css"),
  ]);
  assert.match(catalogCss, /@media \(max-width: 650px\)[\s\S]*?grid-template-columns: 1fr;/);
  assert.match(catalogCss, /@media \(max-width: 650px\)[\s\S]*?\.card \{[\s\S]*?min-height: auto;/);
  assert.match(projectCss, /@media \(max-width: 620px\)[\s\S]*?\.flowGrid \{[\s\S]*?grid-template-columns: 1fr;/);
  assert.match(projectCss, /overflow-wrap:\s+anywhere/);
});

test("PNRR snapshot stays server-only and the new UI uses design tokens", async () => {
  const [snapshot, catalogCss, projectCss] = await Promise.all([
    source("../src/lib/pnrr-childcare-snapshot.ts"),
    source("../src/app/coesione/asili/pnrr-asili.module.css"),
    source("../src/app/progetti/[cup]/project.module.css"),
  ]);
  assert.match(snapshot, /^import "server-only";/m);
  assert.doesNotMatch(`${catalogCss}\n${projectCss}`, /#[0-9a-f]{3,8}/i);
  assert.doesNotMatch(`${catalogCss}\n${projectCss}`, /color-neutral-0/);
  assert.match(projectCss, /border-radius: var\(--radius-sm\)/);
});
