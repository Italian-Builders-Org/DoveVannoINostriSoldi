import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";
import {
  auditSignals,
  getHomeAnomalySignals,
  homeAnomalySignalIds,
} from "../src/lib/audit-data.ts";

const homePage = await readFile(new URL("../src/app/page.tsx", import.meta.url), "utf8");

test("home anomaly gallery uses three distinct verified phenomena", () => {
  const signals = getHomeAnomalySignals();

  assert.equal(signals.length, 3);
  assert.deepEqual(
    signals.map((signal) => signal.id),
    homeAnomalySignalIds,
  );
  assert.equal(new Set(signals.map((signal) => signal.area)).size, 3);
  assert.equal(new Set(signals.map((signal) => signal.classification)).size, 3);
  assert.equal(new Set(signals.map((signal) => signal.source.url)).size, 3);
  assert.ok(signals.every((signal) => signal.source.documentType === "official-report"));
  assert.ok(signals.every((signal) => signal.source.url.startsWith("https://")));
});

test("home anomaly gallery keeps the compact presentation and one caveat", () => {
  assert.match(homePage, /Anomalie da approfondire/);
  assert.match(homePage, /anomalyGallery/);
  assert.match(homePage, /anomalyMarker/);
  assert.doesNotMatch(homePage, /ContractsIcon|ShieldCheck|CalendarClockIcon/);
  assert.match(homePage, /signal\.source\.url/);
  assert.match(homePage, /signal\.source\.institution/);
  assert.match(homePage, /Segnale da verificare, non prova/);
  assert.match(homePage, /href="\/controlli"/);
  assert.doesNotMatch(homePage, /procurement\.byValue/);
  assert.doesNotMatch(homePage, /procurement\.procedureCount/);
});

test("home anomaly gallery fails closed when a verified signal is unavailable", () => {
  const missingPnrr = auditSignals.filter((signal) => signal.id !== "pnrr-beyond-2026");
  const signals = getHomeAnomalySignals(missingPnrr);

  assert.equal(signals.length, 2);
  assert.ok(!signals.some((signal) => signal.id === "pnrr-beyond-2026"));
  assert.match(homePage, /anomalySignals\.length < 3/);
  assert.match(homePage, /Esplora gli altri controlli/);
});
