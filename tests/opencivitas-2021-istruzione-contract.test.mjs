import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import "./helpers/register-ts-alias.mjs";
const { assertOpenCivitas2021IstruzioneSnapshot } = await import("../src/lib/data/opencivitas-2021-istruzione-contract.ts");

const load = () => JSON.parse(readFileSync(new URL("../src/data/generated/opencivitas-2021-istruzione.json", import.meta.url), "utf8"));

test("FC70ISTRUZ 2021 preserves official source dates, money, RSO coverage and function", () => {
  const snapshot = assertOpenCivitas2021IstruzioneSnapshot(load());
  assert.equal(snapshot.referenceYear, 2021);
  assert.equal(snapshot.publishedAt, "2024-05-30");
  assert.equal(snapshot.modifiedAt, "2024-05-30");
  assert.equal(snapshot.source.family, "FC70ISTRUZ");
  assert.equal(snapshot.coverage.function, "ISTRUZIONE");
  assert.equal(snapshot.source.license, "CC BY 4.0");
  assert.equal(snapshot.source.bytes.data, 2336072);
  assert.equal(snapshot.coverage.municipalities, 6549);
  assert.equal(snapshot.coverage.regions, 15);
  const rome = snapshot.municipalities.find((row) => row.istatCode === "058091");
  assert.equal(rome.historicalSpendingCents, 50401805158);
  assert.equal(rome.standardSpendingCents, 36172894223);
  assert.equal(rome.differenceCents, 14228910935);
  assert.equal(rome.differencePerCapitaCents, 5176);
  assert.equal(rome.serviceDifferenceBasisPoints, 3252);
  assert.equal(rome.spendingLevel, 9);
  assert.equal(rome.serviceLevel, 8);
  assert.equal(rome.spendingAssessmentReason, null);
  assert.match(snapshot.methodology.serviceMeaning, /Istruzione/);
  assert.match(snapshot.methodology.differenceMeaning, /Non è una misura di spreco/);
  assert.match(snapshot.methodology.functionSeparationWarning, /FC70TOT/);
  assert.match(snapshot.methodology.coverageWarning, /15 Comuni/);
  assert.match(snapshot.methodology.nationalDifferenceWarning, /riproporzionato sul totale della spesa storica/);
  assert.match(snapshot.methodology.nationalDifferenceWarning, /non è un risultato/);
  assert.equal(snapshot.municipalities.filter((row) => row.region === "EMILIA-ROMAGNA").length, 330);
  assert.equal(snapshot.municipalities.filter((row) => row.region === "CALABRIA").length, 398);
  assert.equal(snapshot.municipalities.filter((row) => row.region === "ABRUZZO").length, 301);
  assert.equal(snapshot.municipalities.filter((row) => row.region === "LOMBARDIA").length, 1504);
  const zero = snapshot.municipalities.find((row) => row.istatCode === "001121");
  assert.equal(zero.name, "INGRIA");
  assert.equal(zero.historicalSpendingCents, 0);
  assert.ok(zero.standardSpendingCents > 0);
  const esclusi = ["066083", "066093", "016103", "069013", "069043", "078008", "078128", "078131", "063020", "063042", "063073", "018064", "080033", "080096", "102037", "010022"];
  assert.ok(!snapshot.municipalities.some((row) => esclusi.includes(row.istatCode)));
  assert.ok(!snapshot.municipalities.some((row) => row.region === "SICILIA" || row.istatCode.startsWith("ZZ")));
});

test("FC70ISTRUZ pin rejects coherent tampering", () => {
  for (const mutate of [
    (value) => { value.referenceYear = 2019; },
    (value) => { value.source.family = "FC70TOT"; },
    (value) => { value.coverage.function = "TOTALE"; },
    (value) => { value.source.bytes.data -= 1; },
    (value) => { value.municipalityRows[0][4] += 100; value.municipalityRows[0][6] += 100; },
    (value) => { value.methodology = {}; },
    (value) => {
      value.generatedAt = "2024-01-01T00:00:00Z";
      value.source.observedAt = "2024-01-01T00:00:00Z";
    },
  ]) {
    const value = load();
    mutate(value);
    assert.throws(() => assertOpenCivitas2021IstruzioneSnapshot(value), /SHA-256 semantico|timestamp/);
  }
});

test("FC70ISTRUZ keeps the reproportioning invariant readable from the published payload", () => {
  const snapshot = assertOpenCivitas2021IstruzioneSnapshot(load());
  const somma = (chiave) => snapshot.municipalities.reduce((totale, riga) => totale + riga[chiave], 0);
  const storica = somma("historicalSpendingCents");
  const fabbisogno = somma("standardSpendingCents");
  assert.equal(storica, 425741217954);
  assert.equal(fabbisogno, 425101502171);
  assert.equal(storica - fabbisogno, 639715783);
  assert.ok(Math.abs((fabbisogno + 639715790) - storica) <= 100);
});
