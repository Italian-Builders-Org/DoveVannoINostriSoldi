import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";
import {
  assertConsulentiRegionaliSnapshot,
  queryConsulentiRegionali,
} from "../src/lib/data/consulenti-regionali-contract.ts";

const page = await readFile(
  new URL("../src/app/incarichi/territori/page.tsx", import.meta.url),
  "utf8",
);
const apiRoute = await readFile(
  new URL("../src/app/api/incarichi/territori/route.ts", import.meta.url),
  "utf8",
);
const snapshot = assertConsulentiRegionaliSnapshot(
  JSON.parse(
    await readFile(
      new URL("../src/data/generated/consulenti-regionali.json", import.meta.url),
      "utf8",
    ),
  ),
);

test("the territorial page keeps Perla PA separate from RGS consulting", () => {
  assert.match(page, /consulentiRegionaliSnapshot/);
  assert.match(page, /Non sono i bilanci delle sole Regioni/);
  assert.match(page, /\/spese\/consulenze/);
  assert.match(page, /regionePa/);
  assert.match(page, /Quanto risulta pagato/);
  assert.match(page, /data-testid="territori-table"/);
  assert.doesNotMatch(page, /paidCents\s*\+[^\n]*paidCents/);
});

test("the territorial page explains external appointments without leaving the page", () => {
  assert.match(page, /data-testid="territori-reading"/);
  assert.match(page, /Cosa sono gli incarichi esterni/);
  assert.match(page, /soggetti esterni/);
  assert.match(page, /non sono dipendenti pubblici/);
  assert.match(page, /href="\/incarichi"/);
  assert.match(page, /methodology\.rgsSeparation/);
  assert.match(page, /methodology\.territoryMeaning/);
  assert.match(page, /methodology\.currentYearWarning/);
  assert.match(page, /data-testid="territori-partial-year"/);
  assert.match(page, /non sommare a Perla PA/i);
  assert.doesNotMatch(page, /spreco automatico|classifica di utilit/i);
});

test("the territorial API route wires snapshot helpers and year selection", () => {
  assert.match(apiRoute, /getConsulentiRegionaliYear/);
  assert.match(apiRoute, /Parametro sconosciuto o ripetuto/);
  assert.match(apiRoute, /Il parametro anno richiede quattro cifre/);
  assert.equal(queryConsulentiRegionali(snapshot).year, snapshot.latestYear);
  assert.equal(
    queryConsulentiRegionali(snapshot, snapshot.years[0].year).year,
    snapshot.years[0].year,
  );
  assert.throws(() => queryConsulentiRegionali(snapshot, 1999), /assente/);
});
