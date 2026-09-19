import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import "./helpers/register-ts-alias.mjs";
const { assertOpenCivitas2022RifiutiSnapshot } = await import("../src/lib/data/opencivitas-2022-rifiuti-contract.ts");

const load = () => JSON.parse(readFileSync(new URL("../src/data/generated/opencivitas-2022-rifiuti.json", import.meta.url), "utf8"));

test("FC80RIFIUTI 2022 preserves official source dates, money, RSO coverage and waste function", () => {
  const snapshot = assertOpenCivitas2022RifiutiSnapshot(load());
  assert.equal(snapshot.referenceYear, 2022);
  assert.equal(snapshot.publishedAt, "2025-06-16");
  assert.equal(snapshot.modifiedAt, "2025-06-16");
  assert.equal(snapshot.source.family, "FC80RIFIUTI");
  assert.equal(snapshot.coverage.function, "RIFIUTI");
  assert.equal(snapshot.source.license, "CC BY 4.0");
  assert.equal(snapshot.source.bytes.data, 1889844);
  assert.equal(snapshot.coverage.municipalities, 6557);
  assert.equal(snapshot.coverage.regions, 15);
  const rome = snapshot.municipalities.find((row) => row.istatCode === "058091");
  assert.equal(rome.historicalSpendingCents, 80038300332);
  assert.equal(rome.standardSpendingCents, 87496878022);
  assert.equal(rome.differenceCents, -7458577690);
  assert.equal(rome.differencePerCapitaCents, -2707);
  assert.equal(rome.serviceDifferenceBasisPoints, -2512);
  assert.equal(rome.spendingLevel, 4);
  assert.equal(rome.serviceLevel, 2);
  assert.equal(rome.spendingAssessmentReason, null);
  assert.match(snapshot.methodology.serviceMeaning, /Rifiuti/);
  assert.match(snapshot.methodology.differenceMeaning, /Non è una misura di spreco/);
  assert.match(snapshot.methodology.functionSeparationWarning, /FC80TOT/);
  assert.equal(snapshot.municipalities.filter((row) => row.region === "EMILIA-ROMAGNA").length, 330);
  assert.ok(!snapshot.municipalities.some((row) => row.region === "SICILIA" || row.istatCode.startsWith("ZZ")));
});

test("FC80RIFIUTI pin rejects coherent tampering", () => {
  for (const mutate of [
    (s) => { s.referenceYear = 2021; },
    (s) => { s.source.family = "FC80TOT"; },
    (s) => { s.coverage.function = "TOTALE"; },
    (s) => { s.source.bytes.data -= 1; },
    (s) => { s.municipalityRows[0][4] += 100; s.municipalityRows[0][6] += 100; },
    (s) => { s.methodology = {}; },
  ]) {
    const value = load();
    mutate(value);
    assert.throws(() => assertOpenCivitas2022RifiutiSnapshot(value), /SHA-256 semantico|timestamp|oggetto/);
  }
});
