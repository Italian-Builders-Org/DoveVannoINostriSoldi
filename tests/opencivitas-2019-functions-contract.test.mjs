import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import "./helpers/register-ts-alias.mjs";
const { assertOpenCivitas2019FunctionSnapshot } = await import("../src/lib/data/opencivitas-2019-function-contract.ts");
const { OPENCIVITAS_2019_FUNCTIONS } = await import("../src/lib/data/opencivitas-2019-functions.ts");

const load = (key) => JSON.parse(readFileSync(new URL(`../src/data/generated/opencivitas-2019-${key}.json`, import.meta.url), "utf8"));

// Rome (058091) per function, read from the official 2019 CSVs; excluded = ISTAT codes absent by contract.
const EXPECTED = {
  istruzione: { municipalities: 6555, rome: [40851184787, 34918571174, 2113, 3265, 7, 8], excluded: ["065040", "001134"] },
  polizia: { municipalities: 6564, rome: [33662047517, 35046199077, -493, 7000, 5, 8], excluded: [] },
  viabilita: { municipalities: 6566, rome: [29785141381, 23641585996, 2188, -5138, 8, 2], excluded: [] },
  rifiuti: { municipalities: 6567, rome: [81726890790, 81483712473, 87, -2239, 6, 3], excluded: [] },
  "sociale-asili": { municipalities: 6566, rome: [65827780728, 63575794267, 801, 2425, 6, 7], excluded: ["101016"] },
  amministrazione: { municipalities: 6494, rome: [56395314819, 40377202570, 5704, 224, 9, 6], excluded: [] },
};

for (const [key, expected] of Object.entries(EXPECTED)) {
  const descriptor = OPENCIVITAS_2019_FUNCTIONS[key];

  test(`${descriptor.family} 2019 preserves source dates, money, RSO coverage and function`, () => {
    const snapshot = assertOpenCivitas2019FunctionSnapshot(key, load(key));
    assert.equal(snapshot.referenceYear, 2019);
    assert.equal(snapshot.publishedAt, "2023-05-30");
    assert.equal(snapshot.modifiedAt, "2023-05-30");
    assert.equal(snapshot.source.family, descriptor.family);
    assert.equal(snapshot.source.license, "CC BY 4.0");
    assert.equal(snapshot.source.publisher, "SOSE");
    assert.equal(snapshot.source.bytes.data, descriptor.source.files.data.bytes);
    assert.equal(snapshot.coverage.function, descriptor.function);
    assert.equal(snapshot.coverage.municipalities, expected.municipalities);
    assert.equal(snapshot.municipalities.length, expected.municipalities);
    const [historical, standard, differencePerCapita, serviceDifference, spendingLevel, serviceLevel] = expected.rome;
    const rome = snapshot.municipalities.find((row) => row.istatCode === "058091");
    assert.equal(rome.historicalSpendingCents, historical);
    assert.equal(rome.standardSpendingCents, standard);
    assert.equal(rome.differenceCents, historical - standard);
    assert.equal(rome.differencePerCapitaCents, differencePerCapita);
    assert.equal(rome.serviceDifferenceBasisPoints, serviceDifference);
    assert.equal(rome.spendingLevel, spendingLevel);
    assert.equal(rome.serviceLevel, serviceLevel);
    for (const [region, count] of Object.entries(descriptor.source.regionCounts)) {
      assert.equal(snapshot.municipalities.filter((row) => row.region === region).length, count, region);
    }
    assert.ok(!snapshot.municipalities.some((row) => expected.excluded.includes(row.istatCode)));
    assert.ok(!snapshot.municipalities.some((row) => row.region === "SICILIA" || row.region === "EMILIA ROMAGNA"));
    assert.match(snapshot.methodology.differenceMeaning, /Non è una misura di spreco/);
    assert.match(snapshot.methodology.functionSeparationWarning, /FC60TOT 2019/);
    assert.match(snapshot.methodology.nationalDifferenceWarning, /non è un risultato/);
  });

  test(`${descriptor.family} 2019 pin rejects coherent tampering and cross-function confusion`, () => {
    for (const mutate of [
      (value) => { value.referenceYear = 2021; },
      (value) => { value.source.family = "FC60TOT"; },
      (value) => { value.coverage.function = "TOTALE"; },
      (value) => { value.source.bytes.data -= 1; },
      (value) => { value.municipalityRows[0][4] += 100; value.municipalityRows[0][6] += 100; },
      (value) => { value.methodology = {}; },
      (value) => {
        value.generatedAt = "2023-01-01T00:00:00Z";
        value.source.observedAt = "2023-01-01T00:00:00Z";
      },
    ]) {
      const value = load(key);
      mutate(value);
      assert.throws(() => assertOpenCivitas2019FunctionSnapshot(key, value), /SHA-256 semantico|timestamp/);
    }
    const other = key === "polizia" ? "istruzione" : "polizia";
    assert.throws(() => assertOpenCivitas2019FunctionSnapshot(other, load(key)), /SHA-256 semantico/);
  });

  test(`${descriptor.family} 2019 national totals are readable from the published payload`, () => {
    const snapshot = assertOpenCivitas2019FunctionSnapshot(key, load(key));
    const totals = descriptor.source.nationalTotals;
    const sum = (field) => snapshot.municipalities.reduce((total, row) => total + row[field], 0);
    assert.equal(sum("historicalSpendingCents"), totals.historicalSpendingCents);
    assert.equal(sum("standardSpendingCents"), totals.standardSpendingCentsPublished);
    if (totals.reproportioned) {
      const joined = totals.standardSpendingCentsPublished + totals.standardSpendingCentsExcluded;
      assert.ok(Math.abs(joined - totals.historicalSpendingCents) <= totals.roundingToleranceCents);
      assert.match(snapshot.methodology.nationalDifferenceWarning, /riproporzionato sul totale della spesa storica/);
    } else {
      assert.equal(key, "sociale-asili");
      assert.ok(totals.standardSpendingCentsPublished > totals.historicalSpendingCents);
      assert.match(snapshot.methodology.nationalDifferenceWarning, /non riproporziona/);
    }
  });
}

test("FC60ISTRUZ keeps Nola's published 1 € instead of dropping or rescaling it", () => {
  const snapshot = assertOpenCivitas2019FunctionSnapshot("istruzione", load("istruzione"));
  const nola = snapshot.municipalities.find((row) => row.istatCode === "063050");
  assert.equal(nola.historicalSpendingCents, 100);
  assert.equal(nola.historicalPerCapitaCents, 0);
  assert.ok(nola.standardSpendingCents > 0);
});

test("FC60AMMIN keeps the cp1252 euro sign in source assessment reasons", () => {
  const snapshot = assertOpenCivitas2019FunctionSnapshot("amministrazione", load("amministrazione"));
  const reason = snapshot.municipalities.find((row) => row.istatCode === "015016").spendingAssessmentReason;
  assert.match(reason, /inferiore a 25 € procapite/);
  assert.ok(!snapshot.municipalities.some((row) => /[\u0080-\u009f�]/.test(`${row.spendingAssessmentReason}${row.servicesAssessmentReason}`)));
});
