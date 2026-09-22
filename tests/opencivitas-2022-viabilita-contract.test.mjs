import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import "./helpers/register-ts-alias.mjs";
const { assertOpenCivitas2022ViabilitaSnapshot } = await import("../src/lib/data/opencivitas-2022-viabilita-contract.ts");

const load = () => JSON.parse(readFileSync(new URL("../src/data/generated/opencivitas-2022-viabilita.json", import.meta.url), "utf8"));

test("FC80TERRVIAB 2022 preserves official source dates, money, RSO coverage and roads function", () => {
  const snapshot = assertOpenCivitas2022ViabilitaSnapshot(load());
  assert.equal(snapshot.referenceYear, 2022);
  assert.equal(snapshot.publishedAt, "2025-06-16");
  assert.equal(snapshot.modifiedAt, "2025-06-16");
  assert.equal(snapshot.source.family, "FC80TERRVIAB");
  assert.equal(snapshot.coverage.function, "TERR_VIAB");
  assert.equal(snapshot.source.license, "CC BY 4.0");
  assert.equal(snapshot.source.bytes.data, 3499805);
  assert.equal(snapshot.coverage.municipalities, 6553);
  assert.equal(snapshot.coverage.regions, 15);
  const rome = snapshot.municipalities.find((row) => row.istatCode === "058091");
  assert.equal(rome.historicalSpendingCents, 35847989381);
  assert.equal(rome.standardSpendingCents, 25225928545);
  assert.equal(rome.differenceCents, 10622060836);
  assert.equal(rome.differencePerCapitaCents, 3856);
  assert.equal(rome.serviceDifferenceBasisPoints, -4092);
  assert.equal(rome.spendingLevel, 9);
  assert.equal(rome.serviceLevel, 2);
  assert.equal(rome.spendingAssessmentReason, null);
  assert.match(snapshot.methodology.serviceMeaning, /Viabilità/);
  assert.match(snapshot.methodology.differenceMeaning, /Non è una misura di spreco/);
  assert.match(snapshot.methodology.functionSeparationWarning, /FC80RIFIUTI/);
  assert.match(snapshot.methodology.coverageWarning, /4 Comuni/);
  assert.equal(snapshot.municipalities.filter((row) => row.region === "EMILIA-ROMAGNA").length, 330);
  assert.equal(snapshot.municipalities.filter((row) => row.region === "CALABRIA").length, 401);
  assert.equal(snapshot.municipalities.filter((row) => row.region === "ABRUZZO").length, 304);
  assert.ok(!snapshot.municipalities.some((row) => ["078052", "079138", "068003", "080040"].includes(row.istatCode)));
  assert.ok(!snapshot.municipalities.some((row) => row.region === "SICILIA" || row.istatCode.startsWith("ZZ")));
});

test("FC80TERRVIAB pin rejects coherent tampering", () => {
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
    assert.throws(() => assertOpenCivitas2022ViabilitaSnapshot(value), /SHA-256 semantico|timestamp|oggetto/);
  }
});
