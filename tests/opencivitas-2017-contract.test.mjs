import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import "./helpers/register-ts-alias.mjs";
const { assertOpenCivitas2017Snapshot } = await import("../src/lib/data/opencivitas-2017-contract.ts");

const load = () => JSON.parse(readFileSync(new URL("../src/data/generated/opencivitas-2017.json", import.meta.url), "utf8"));

test("FC40 2017 preserves official source, RSO coverage and annual values", () => {
  const snapshot = assertOpenCivitas2017Snapshot(load());
  assert.equal(snapshot.referenceYear, 2017);
  assert.equal(snapshot.publishedAt, "2021-03-15");
  assert.equal(snapshot.modifiedAt, "2021-03-15");
  assert.equal(snapshot.source.family, "FC40TOT");
  assert.equal(snapshot.source.license, "CC BY 4.0");
  assert.equal(snapshot.source.bytes.data, 5368963);
  assert.equal(snapshot.coverage.municipalities, 6627);
  assert.equal(snapshot.coverage.regions, 15);
  const rome = snapshot.municipalities.find((row) => row.istatCode === "058091");
  assert.equal(rome.historicalSpendingCents, 302180645180);
  assert.equal(rome.standardSpendingCents, 280071923540);
  assert.equal(rome.differenceCents, 22108721640);
  assert.equal(rome.differencePerCapitaCents, 7696);
  assert.equal(rome.serviceDifferenceBasisPoints, 146);
  assert.equal(snapshot.municipalities.filter((row) => row.region === "EMILIA-ROMAGNA").length, 333);
  assert.ok(!snapshot.municipalities.some((row) => row.region === "SICILIA" || row.istatCode.startsWith("ZZ")));
  assert.match(snapshot.methodology.differenceMeaning, /Non è una misura di spreco/);
  assert.match(snapshot.methodology.yearSeparationWarning, /2020 non è ricostruito/);
});

test("FC40 semantic pin rejects coherent tampering and foreign releases", () => {
  for (const mutate of [
    (s) => { s.referenceYear = 2018; },
    (s) => { s.source.family = "FC50TOT"; },
    (s) => { s.source.license = "Unverified"; },
    (s) => { s.source.bytes.data -= 1; },
    (s) => { s.municipalityRows[0][4] += 100; s.municipalityRows[0][6] += 100; },
    (s) => { s.municipalityRows[0][13] = null; },
    (s) => { s.methodology = {}; },
  ]) {
    const value = load();
    mutate(value);
    assert.throws(() => assertOpenCivitas2017Snapshot(value), /SHA-256 semantico/);
  }
  for (const year of [2018, 2019, 2021, 2022]) {
    const foreign = JSON.parse(readFileSync(new URL(`../src/data/generated/opencivitas-${year}.json`, import.meta.url), "utf8"));
    assert.throws(() => assertOpenCivitas2017Snapshot(foreign), /SHA-256 semantico/);
  }
});

test("FC40 pin excludes only coherent timezone-qualified acquisition timestamps", () => {
  for (const date of ["garbage", "2026-09-12", "2026-09-12T02:00:00", "2020-01-01T00:00:00Z", "2026-02-31T00:00:00Z", "2026-09-12T24:00:00Z"]) {
    const value = load();
    value.generatedAt = value.source.observedAt = date;
    assert.throws(() => assertOpenCivitas2017Snapshot(value), /timestamp/);
  }
  const value = load();
  value.generatedAt = value.source.observedAt = "2026-09-12T02:00:00Z";
  assert.equal(assertOpenCivitas2017Snapshot(value).generatedAt, value.generatedAt);
});

test("FC40 preserves its two source-coded assessment reasons", () => {
  const rows = assertOpenCivitas2017Snapshot(load()).municipalities;
  const unavailable = rows.filter((row) => row.servicesAssessmentReason !== null);
  assert.deepEqual(unavailable.map((row) => row.istatCode), ["001316", "079110"]);
  assert.ok(unavailable.every((row) => row.servicesAssessmentReason === "cod_out_noval_nospesa"));
  assert.ok(unavailable.every((row) => row.spendingAssessmentReason === "cod_sps_noval"));
});
