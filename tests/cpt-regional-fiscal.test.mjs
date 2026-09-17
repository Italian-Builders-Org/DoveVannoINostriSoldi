import assert from "node:assert/strict";
import test from "node:test";
import "./helpers/register-ts-alias.mjs";

const {
  availableCptFiscalYears,
  cptRegionalFiscalSnapshot,
  queryCptRegionalFiscal,
} = await import("../src/lib/cpt-regional-fiscal-snapshot.ts");

test("CPT snapshot reconciles every balance and has complete territorial coverage", () => {
  assert.deepEqual(availableCptFiscalYears, Array.from({ length: 24 }, (_value, index) => 2000 + index));
  assert.equal(cptRegionalFiscalSnapshot.rows.length, 504);
  for (const year of availableCptFiscalYears) {
    assert.equal(cptRegionalFiscalSnapshot.rows.filter((row) => row.year === year).length, 21);
  }
  for (const row of cptRegionalFiscalSnapshot.rows) {
    assert.equal(row.balanceCents, row.revenueCents - row.expenditureCents);
  }
});

test("CPT pro-capita values are limited to the matching 2023 population reference", () => {
  const latest = queryCptRegionalFiscal({ year: 2023 });
  assert.equal(latest.rows.length, 21);
  assert.ok(latest.rows.every((row) => row.population > 0 && Number.isSafeInteger(row.balancePerCapitaCents)));
  const historical = queryCptRegionalFiscal({ year: 2022, region: "Calabria" });
  assert.equal(historical.rows[0].population, null);
  assert.equal(historical.rows[0].balancePerCapitaCents, null);
});

test("CPT queries reject unavailable years and unknown territories", () => {
  assert.throws(() => queryCptRegionalFiscal({ year: 2024 }), /Anno CPT non disponibile/);
  assert.throws(() => queryCptRegionalFiscal({ region: "Atlantide" }), /Territorio CPT non disponibile/);
  assert.equal(queryCptRegionalFiscal({ region: "18" }).rows[0].region, "Calabria");
});

test("CPT provenance pins both official CSVs with hashes", () => {
  const monetaryInputs = cptRegionalFiscalSnapshot.provenance.inputs.filter(
    (input) => input.kind !== "population",
  );
  assert.equal(monetaryInputs.length, 2);
  for (const input of monetaryInputs) {
    assert.match(input.resourceUrl, /^https:\/\/politichecoesione\.governo\.it\/media\//);
    assert.match(input.sha256, /^[a-f0-9]{64}$/);
    assert.ok(input.bytes > 100_000);
  }
});

test("CPT provenance also pins the official ISTAT population document", () => {
  const population = cptRegionalFiscalSnapshot.provenance.inputs.find(
    (input) => input.kind === "population",
  );
  assert.equal(population.referenceDate, "2023-12-31");
  assert.match(population.resourceUrl, /^https:\/\/www\.istat\.it\//);
  assert.match(population.sha256, /^[a-f0-9]{64}$/);
  assert.match(population.normalizedValuesSha256, /^[a-f0-9]{64}$/);
  assert.match(population.locator, /31 dicembre 2023/);
  assert.equal(population.bytes, 1_504_172);
});

test("CPT provenance fails closed on non-official input hosts", async () => {
  const { validateCptRegionalFiscalSnapshot } = await import(
    "../src/lib/data/cpt-regional-fiscal-contract.ts"
  );
  const forged = structuredClone(cptRegionalFiscalSnapshot);
  forged.provenance.inputs[0].resourceUrl = "https://example.com/en_pa_cemacro.csv";
  assert.throws(() => validateCptRegionalFiscalSnapshot(forged), /URL risorsa non ufficiale/);
  assert.ok(cptRegionalFiscalSnapshot.provenance.inputs.every((input) => input.rightsNote.length > 0));

  const duplicate = structuredClone(cptRegionalFiscalSnapshot);
  duplicate.provenance.inputs[1].kind = "revenue";
  assert.throws(() => validateCptRegionalFiscalSnapshot(duplicate), /tipi di input duplicati o mancanti/);

  const missingHash = structuredClone(cptRegionalFiscalSnapshot);
  delete missingHash.provenance.inputs[0].sha256;
  assert.throws(() => validateCptRegionalFiscalSnapshot(missingHash), /hash non valido/);
});
