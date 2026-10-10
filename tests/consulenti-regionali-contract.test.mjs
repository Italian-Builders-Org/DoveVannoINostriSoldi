import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";
import {
  assertConsulentiRegionaliSnapshot,
  queryConsulentiRegionali,
} from "../src/lib/data/consulenti-regionali-contract.ts";

const snapshotJson = JSON.parse(
  await readFile(
    new URL("../src/data/generated/consulenti-regionali.json", import.meta.url),
    "utf8",
  ),
);

test("the territorial Consulenti snapshot keeps money, period and provenance", () => {
  const snapshot = assertConsulentiRegionaliSnapshot(snapshotJson);
  assert.equal(snapshot.scope, "territorial-external-appointments");
  assert.equal(snapshot.appointmentKind, "external");
  assert.equal(snapshot.soldi.unit, "EUR-cents");
  assert.equal(snapshot.periodo.field, "annoConferimento");
  assert.equal(snapshot.periodo.partialLatestYear, true);
  assert.match(snapshot.methodology.territoryMeaning, /non coincide con i soli bilanci/i);
  assert.match(snapshot.methodology.rgsSeparation, /non va sommata/i);
  for (const year of snapshot.years) {
    assert.ok(year.territories.length >= 1);
    assert.equal(year.territoryCount, year.territories.length);
    assert.equal(
      year.roundingResidualCents,
      year.territoryPaidCentsSum - year.paidCents,
    );
    assert.ok(Math.abs(year.roundingResidualCents) <= year.territoryCount);
  }
});

test("querying a missing year fails closed", () => {
  const snapshot = assertConsulentiRegionaliSnapshot(snapshotJson);
  assert.equal(queryConsulentiRegionali(snapshot).year, snapshot.latestYear);
  assert.throws(() => queryConsulentiRegionali(snapshot, 1999), /assente/);
});

test("tampered totals fail closed", () => {
  const forged = structuredClone(snapshotJson);
  forged.years[0].paidCents += 1;
  assert.throws(() => assertConsulentiRegionaliSnapshot(forged), /residuo|riconcilia|incoerente/);
});
