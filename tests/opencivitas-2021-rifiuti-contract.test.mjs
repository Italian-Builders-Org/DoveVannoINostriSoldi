import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import "./helpers/register-ts-alias.mjs";
const { assertOpenCivitas2021RifiutiSnapshot } = await import("../src/lib/data/opencivitas-2021-rifiuti-contract.ts");

const load = () => JSON.parse(readFileSync(new URL("../src/data/generated/opencivitas-2021-rifiuti.json", import.meta.url), "utf8"));

test("FC70RIFIUTI 2021 preserves official source dates, money, RSO coverage and waste function", () => {
  const snapshot = assertOpenCivitas2021RifiutiSnapshot(load());
  assert.equal(snapshot.referenceYear, 2021);
  assert.equal(snapshot.publishedAt, "2024-05-30");
  assert.equal(snapshot.modifiedAt, "2024-05-30");
  assert.equal(snapshot.source.family, "FC70RIFIUTI");
  assert.equal(snapshot.coverage.function, "RIFIUTI");
  assert.equal(snapshot.source.license, "CC BY 4.0");
  assert.equal(snapshot.source.bytes.data, 1725294);
  assert.equal(snapshot.coverage.municipalities, 6565);
  assert.equal(snapshot.coverage.regions, 15);
  const rome = snapshot.municipalities.find((row) => row.istatCode === "058091");
  assert.equal(rome.historicalSpendingCents, 90544611677);
  assert.equal(rome.standardSpendingCents, 83045151185);
  assert.equal(rome.differenceCents, 7499460492);
  assert.equal(rome.differencePerCapitaCents, 2728);
  assert.equal(rome.serviceDifferenceBasisPoints, -2431);
  assert.equal(rome.spendingLevel, 7);
  assert.equal(rome.serviceLevel, 2);
  assert.equal(rome.spendingAssessmentReason, null);
  assert.match(snapshot.methodology.serviceMeaning, /Rifiuti/);
  assert.match(snapshot.methodology.differenceMeaning, /Non è una misura di spreco/);
  assert.match(snapshot.methodology.functionSeparationWarning, /FC70TOT/);
  assert.match(snapshot.methodology.functionSeparationWarning, /FC80RIFIUTI/);
  assert.equal(snapshot.municipalities.filter((row) => row.region === "LOMBARDIA").length, 1506);
  assert.equal(snapshot.municipalities.filter((row) => row.region === "VENETO").length, 563);
  assert.equal(snapshot.municipalities.filter((row) => row.region === "EMILIA-ROMAGNA").length, 330);
  assert.ok(!snapshot.municipalities.some((row) => row.region === "SICILIA" || row.istatCode.startsWith("ZZ")));
});

test("FC70RIFIUTI pin rejects coherent tampering", () => {
  for (const mutate of [
    (s) => { s.referenceYear = 2019; },
    (s) => { s.source.family = "FC80TOT"; },
    (s) => { s.coverage.function = "TOTALE"; },
    (s) => { s.source.bytes.data -= 1; },
    (s) => { s.municipalityRows[0][4] += 100; s.municipalityRows[0][6] += 100; },
    (s) => { s.methodology = {}; },
  ]) {
    const value = load();
    mutate(value);
    assert.throws(() => assertOpenCivitas2021RifiutiSnapshot(value), /SHA-256 semantico|timestamp|oggetto/);
  }
});
