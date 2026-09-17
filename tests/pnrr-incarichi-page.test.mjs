import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

const source = (path) => readFile(new URL(path, import.meta.url), "utf8");

test("PNRR assignments page keeps scope, denominators and amount meaning explicit", async () => {
  const page = await source("../src/app/pnrr/incarichi/page.tsx");
  assert.equal(page.match(/<h1\b/g)?.length, 1);
  assert.match(page, /Aggiornamento: aprile 2026/);
  assert.match(page, /88 persone/);
  assert.match(page, /importi per l&apos;intera durata contrattuale/);
  assert.match(page, /Denominatore: 88 incarichi/);
  assert.match(page, /integer\(mostCommonTier\.assignments\)\} incarichi su 88/);
  assert.match(page, /non una prova di irregolarità/);
  assert.match(page, /Non misura quanto è\s*\n?\s*già stato pagato/);
});

test("PNRR assignments page exposes exact programs, tiers and all row fields", async () => {
  const page = await source("../src/app/pnrr/incarichi/page.tsx");
  for (const text of [
    "Per che cosa sono stati assegnati",
    "Quanto sono concentrati gli importi",
    "Chi, quanto e con quale atto",
    "Compenso contrattuale",
    "Selezione",
    "Decreto",
  ]) assert.match(page, new RegExp(text));
  assert.match(page, /data\.programs\.map/);
  assert.match(page, /data\.tiers\.map/);
  assert.match(page, /assignments\.map/);
  assert.match(page, /Apri l&apos;elenco completo degli incarichi/);
});

test("PNRR assignments page keeps sources last and uses only official URLs", async () => {
  const page = await source("../src/app/pnrr/incarichi/page.tsx");
  const dataStart = page.indexOf("programs-title");
  const rowsStart = page.indexOf("assignments-title");
  const sourcesStart = page.indexOf("sources-title");
  assert.ok(dataStart >= 0 && rowsStart > dataStart && sourcesStart > rowsStart);
  assert.match(page, /data\.source\.landingUrl/);
  assert.match(page, /data\.source\.resourceUrl/);
  assert.match(page, /Licenza di riuso non dichiarata/);
  assert.doesNotMatch(page, /\/Users\/|\/Downloads\/|\.tar\.gz|private\/tmp/i);
});

test("PNRR assignments page remains server-rendered and responsive", async () => {
  const [page, css] = await Promise.all([
    source("../src/app/pnrr/incarichi/page.tsx"),
    source("../src/app/pnrr/incarichi/incarichi-pnrr.module.css"),
  ]);
  assert.doesNotMatch(page, /^["']use client["'];/m);
  assert.match(page, /role="region"/);
  assert.match(page, /tabIndex=\{0\}/);
  assert.equal((page.match(/Scorri la tabella verso destra/g) ?? []).length, 2);
  assert.match(css, /overflow-x:\s*auto/);
  assert.match(css, /@media \(max-width: 760px\)[\s\S]*?grid-template-columns: 1fr/);
  assert.doesNotMatch(css, /#[0-9a-f]{3,8}/i);
});
