import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import "./helpers/register-ts-alias.mjs";
const { assertOpenCivitas2019Snapshot } = await import("../src/lib/data/opencivitas-2019-contract.ts");

const load = () => JSON.parse(readFileSync(new URL("../src/data/generated/opencivitas-2019.json", import.meta.url), "utf8"));

test("FC60 2019 preserves official source dates, money, RSO coverage and service denominator", () => {
  const snapshot = assertOpenCivitas2019Snapshot(load());
  assert.equal(snapshot.referenceYear, 2019);
  assert.equal(snapshot.publishedAt, "2023-05-30");
  assert.equal(snapshot.modifiedAt, "2024-05-30");
  assert.equal(snapshot.source.family, "FC60TOT");
  assert.equal(snapshot.source.license, "CC BY 4.0");
  assert.equal(snapshot.source.bytes.data, 4631408);
  assert.equal(snapshot.coverage.municipalities, 6567);
  assert.equal(snapshot.coverage.regions, 15);
  const rome = snapshot.municipalities.find((row) => row.istatCode === "058091");
  assert.equal(rome.historicalSpendingCents, 308248360020);
  assert.equal(rome.standardSpendingCents, 279699907960);
  assert.equal(rome.differenceCents, 28548452060);
  assert.equal(rome.differencePerCapitaCents, 10166);
  assert.equal(rome.serviceDifferenceBasisPoints, 224);
  assert.equal(rome.spendingAssessmentReason, null);
  assert.match(snapshot.methodology.serviceMeaning, /fascia di popolazione/);
  assert.match(snapshot.methodology.differenceMeaning, /Non è una misura di spreco/);
  assert.match(snapshot.methodology.yearSeparationWarning, /2020 non è ricostruito/);
  assert.equal(snapshot.municipalities.filter((row) => row.region === "EMILIA-ROMAGNA").length, 328);
  assert.ok(!snapshot.municipalities.some((row) => row.region === "SICILIA" || row.istatCode.startsWith("ZZ")));
});

test("FC60 pin rejects coherent tampering, missing/suppressed cells and foreign families", () => {
  for (const mutate of [
    (s) => { s.referenceYear = 2020; },
    (s) => { s.source.family = "FC70TOT"; },
    (s) => { s.source.license = "Unverified"; },
    (s) => { s.source.bytes.data -= 1; },
    (s) => { s.source.dataUrl = "https://example.com/data.zip"; },
    (s) => { s.municipalityRows[0][4] += 100; s.municipalityRows[0][6] += 100; },
    (s) => { s.municipalityRows[0][13] = null; },
    (s) => { s.municipalityRows[0][16].push("cod_privacy"); },
    (s) => { s.municipalityRows[1][0] = s.municipalityRows[0][0]; },
    (s) => { s.methodology = {}; },
  ]) {
    const value = load();
    mutate(value);
    assert.throws(() => assertOpenCivitas2019Snapshot(value), /SHA-256 semantico/);
  }
  for (const year of [2021, 2022]) {
    const foreign = JSON.parse(readFileSync(new URL(`../src/data/generated/opencivitas-${year}.json`, import.meta.url), "utf8"));
    assert.throws(() => assertOpenCivitas2019Snapshot(foreign), /SHA-256 semantico/);
  }
});

test("FC60 only excludes coherent timezone-qualified acquisition timestamps from its pin", () => {
  for (const date of ["garbage", "2026-09-08", "2026-09-08T02:00:00", "2020-01-01T00:00:00Z", "2026-02-31T00:00:00Z", "2026-09-08T24:00:00Z"]) {
    const value = load();
    value.generatedAt = value.source.observedAt = date;
    assert.throws(() => assertOpenCivitas2019Snapshot(value), /timestamp/);
  }
  const value = load();
  value.generatedAt = value.source.observedAt = "2026-09-08T02:00:00Z";
  assert.equal(assertOpenCivitas2019Snapshot(value).generatedAt, value.generatedAt);
  value.source.observedAt = "2026-09-08T03:00:00Z";
  assert.throws(() => assertOpenCivitas2019Snapshot(value), /timestamp/);
});
