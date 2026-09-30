import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import "./helpers/register-ts-alias.mjs";
const { assertOpenCivitasFunctionSnapshot } = await import("../src/lib/data/opencivitas-function-contract.ts");
const { OPENCIVITAS_2018_FUNCTIONS } = await import("../src/lib/data/opencivitas-2018-functions.ts");

const assertOpenCivitas2018FunctionSnapshot = (key, value) => assertOpenCivitasFunctionSnapshot(OPENCIVITAS_2018_FUNCTIONS[key], value);
const load = (key) => JSON.parse(readFileSync(new URL(`../src/data/generated/opencivitas-2018-${key}.json`, import.meta.url), "utf8"));

// Rome (058091) per function, read from the official 2018 CSVs; excluded = ISTAT codes absent by contract.
const EXPECTED = {
  istruzione: { municipalities: 6584, rome: [40124366340, 37867132350, 800, 3174, 6, 8], excluded: ["008045", "101014", "063019", "065081", "004039", "010022", "094013", "014006"] },
  polizia: { municipalities: 6594, rome: [33195434272, 34879167189, -597, 5007, 5, 7], excluded: [] },
  viabilita: { municipalities: 6594, rome: [29873369281, 21775206484, 2872, -4709, 9, 2], excluded: [] },
  rifiuti: { municipalities: 6606, rome: [78958728285, 81731639730, -984, -2209, 5, 3], excluded: [] },
  "sociale-asili": { municipalities: 6590, rome: [63950731449, 63543516105, 145, 3752, 6, 7], excluded: ["004222", "101014", "065036", "065081"] },
  amministrazione: { municipalities: 6586, rome: [53590491188, 40272619622, 4722, 404, 9, 6], excluded: [] },
};

for (const [key, expected] of Object.entries(EXPECTED)) {
  const descriptor = OPENCIVITAS_2018_FUNCTIONS[key];

  test(`${descriptor.family} 2018 preserves source dates, money, RSO coverage and function`, () => {
    const snapshot = assertOpenCivitas2018FunctionSnapshot(key, load(key));
    assert.equal(snapshot.referenceYear, 2018);
    assert.equal(snapshot.publishedAt, "2022-02-14");
    assert.equal(snapshot.modifiedAt, "2022-02-14");
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
    assert.match(snapshot.methodology.functionSeparationWarning, /FC50TOT 2018/);
    assert.match(snapshot.methodology.nationalDifferenceWarning, /non è un risultato/);
  });

  test(`${descriptor.family} 2018 pin rejects coherent tampering and cross-function confusion`, () => {
    for (const mutate of [
      (value) => { value.referenceYear = 2019; },
      (value) => { value.source.family = "FC60TOT"; },
      (value) => { value.coverage.function = "TOTALE"; },
      (value) => { value.source.bytes.data -= 1; },
      (value) => { value.municipalityRows[0][4] += 100; value.municipalityRows[0][6] += 100; },
      (value) => { value.methodology = {}; },
      (value) => {
        value.generatedAt = "2022-01-01T00:00:00Z";
        value.source.observedAt = "2022-01-01T00:00:00Z";
      },
    ]) {
      const value = load(key);
      mutate(value);
      assert.throws(() => assertOpenCivitas2018FunctionSnapshot(key, value), /SHA-256 semantico|timestamp/);
    }
    const other = key === "polizia" ? "istruzione" : "polizia";
    assert.throws(() => assertOpenCivitas2018FunctionSnapshot(other, load(key)), /SHA-256 semantico/);
  });

  test(`${descriptor.family} 2018 national totals are readable from the published payload`, () => {
    const snapshot = assertOpenCivitas2018FunctionSnapshot(key, load(key));
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

test("FC50ISTRUZ excludes Comuni without the service instead of publishing a zero need", () => {
  const snapshot = assertOpenCivitas2018FunctionSnapshot("istruzione", load("istruzione"));
  assert.deepEqual(OPENCIVITAS_2018_FUNCTIONS.istruzione.source.excludedNonPositiveStandard, ["CN039SIF11GT", "GE022SIF11WI", "IS013SIF11DF", "SO006SIF11GI"]);
  assert.ok(snapshot.municipalities.every((row) => row.standardSpendingCents > 0));
  assert.match(snapshot.methodology.coverageWarning, /cod_no_servizio/);
});

test("2018 and 2019 releases of the same function are not interchangeable", async () => {
  const { OPENCIVITAS_2019_FUNCTIONS } = await import("../src/lib/data/opencivitas-2019-functions.ts");
  for (const key of Object.keys(EXPECTED)) {
    assert.throws(() => assertOpenCivitasFunctionSnapshot(OPENCIVITAS_2019_FUNCTIONS[key], load(key)), /SHA-256 semantico/);
  }
});
