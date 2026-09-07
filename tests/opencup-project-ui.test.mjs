import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

const source = (path) => readFile(new URL(path, import.meta.url), "utf8");

test("project route composes PNRR and OpenCUP evidence without making PNRR mandatory", async () => {
  const [page, notFound] = await Promise.all([
    source("../src/app/progetti/[cup]/page.tsx"),
    source("../src/app/progetti/[cup]/not-found.tsx"),
  ]);

  assert.match(page, /selectOpenCupProjects/);
  assert.match(page, /OpenCupProjectPanel/);
  assert.match(page, /getPnrrChildcareProject\(cup\)/);
  assert.match(page, /Progetto CUP \$\{cup\}/);
  assert.match(page, /OpenCUP temporaneamente non disponibile/i);
  assert.match(notFound, /non compare nei rilasci pubblici interrogati/i);
  assert.doesNotMatch(page, /function projectFrom/);
});

test("OpenCUP panel exposes plural records, pagination state and cautious accounting labels", async () => {
  const panel = await source("../src/app/progetti/[cup]/opencup-project-panel.tsx");

  assert.match(panel, /^"use client";/m);
  assert.match(panel, /aria-live="polite"/);
  assert.match(panel, /Registrazioni OpenCUP/);
  assert.match(panel, /Costo dichiarato/);
  assert.match(panel, /Finanziamento richiesto/);
  assert.match(panel, /Release manifest/);
  assert.match(panel, /sourceMetadata\.publicationDate/);
  assert.match(panel, /OpenCUP · DIPE/);
  assert.match(panel, /Dati sintetici di test/);
  assert.match(panel, /non è un pagamento osservato/i);
  assert.match(panel, /\/api\/opencup\/progetti/);
  assert.match(panel, /focus\(\)/);
});

test("catalog-only OpenCUP page offers exact CUP navigation instead of a national scan", async () => {
  const [page, search] = await Promise.all([
    source("../src/app/dati/[dataset]/page.tsx"),
    source("../src/components/opencup-search-form.tsx"),
  ]);

  assert.match(page, /dataset\.id === "opencup-progetti-bulk"/);
  assert.match(page, /OpenCupSearchForm/);
  assert.match(search, /router\.push\(`\/progetti\/\$\{cup\}`\)/);
  assert.match(search, /\[A-Z0-9\]\{15\}/);
  assert.doesNotMatch(search, /api\/opencup\/progetti/);
});
