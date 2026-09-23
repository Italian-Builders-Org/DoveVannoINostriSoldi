import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import "./helpers/register-ts-alias.mjs";
const { assertOpenCivitas2021ViabilitaSnapshot } = await import("../src/lib/data/opencivitas-2021-viabilita-contract.ts");

const load = () => JSON.parse(readFileSync(new URL("../src/data/generated/opencivitas-2021-viabilita.json", import.meta.url), "utf8"));

test("FC70TERRVIAB 2021 preserves official source dates, money, RSO coverage and roads function", () => {
  const snapshot = assertOpenCivitas2021ViabilitaSnapshot(load());
  assert.equal(snapshot.referenceYear, 2021);
  assert.equal(snapshot.publishedAt, "2024-05-30");
  assert.equal(snapshot.modifiedAt, "2024-05-30");
  assert.equal(snapshot.source.family, "FC70TERRVIAB");
  assert.equal(snapshot.coverage.function, "TERR_VIAB");
  assert.equal(snapshot.source.license, "CC BY 4.0");
  assert.equal(snapshot.source.bytes.data, 3394631);
  assert.equal(snapshot.coverage.municipalities, 6551);
  assert.equal(snapshot.coverage.regions, 15);
  const rome = snapshot.municipalities.find((row) => row.istatCode === "058091");
  assert.equal(rome.historicalSpendingCents, 31336559877);
  assert.equal(rome.standardSpendingCents, 24043115089);
  assert.equal(rome.differenceCents, 7293444788);
  assert.equal(rome.differencePerCapitaCents, 2653);
  assert.equal(rome.serviceDifferenceBasisPoints, -5429);
  assert.equal(rome.spendingLevel, 8);
  assert.equal(rome.serviceLevel, 2);
  assert.equal(rome.spendingAssessmentReason, null);
  assert.match(snapshot.methodology.serviceMeaning, /Viabilità/);
  assert.match(snapshot.methodology.differenceMeaning, /Non è una misura di spreco/);
  assert.match(snapshot.methodology.functionSeparationWarning, /FC70TOT/);
  assert.match(snapshot.methodology.functionSeparationWarning, /FC80TERRVIAB/);
  assert.match(snapshot.methodology.coverageWarning, /14 Comuni/);
  assert.equal(snapshot.municipalities.filter((row) => row.region === "EMILIA-ROMAGNA").length, 330);
  assert.equal(snapshot.municipalities.filter((row) => row.region === "CALABRIA").length, 397);
  assert.equal(snapshot.municipalities.filter((row) => row.region === "ABRUZZO").length, 302);
  assert.equal(snapshot.municipalities.filter((row) => row.region === "LOMBARDIA").length, 1505);
  assert.ok(!snapshot.municipalities.some((row) => ["066083", "016103", "061093", "069013", "069043", "078002", "078008", "078128", "078131", "063042", "063073", "080033", "080096", "102037"].includes(row.istatCode)));
  assert.ok(!snapshot.municipalities.some((row) => row.region === "SICILIA" || row.istatCode.startsWith("ZZ")));
});

test("FC70TERRVIAB pin rejects coherent tampering", () => {
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
    assert.throws(() => assertOpenCivitas2021ViabilitaSnapshot(value), /SHA-256 semantico|timestamp|oggetto/);
  }
});
