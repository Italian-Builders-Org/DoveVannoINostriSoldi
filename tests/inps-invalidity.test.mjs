import assert from "node:assert/strict";
import test from "node:test";
import "./helpers/register-ts-alias.mjs";

const {
  availableInpsRegionalYears,
  availableInpsSpendingYears,
  inpsCivilInvaliditySnapshot,
  queryInpsCivilInvalidity,
} = await import("../src/lib/inps-invalidity-snapshot.ts");
const { validateInpsCivilInvaliditySnapshot } = await import(
  "../src/lib/data/inps-invalidity-contract.ts"
);

function cloneSnapshot() {
  return structuredClone(inpsCivilInvaliditySnapshot);
}

test("INPS snapshot reconciles national spending, stock and every regional year", () => {
  assert.deepEqual(availableInpsSpendingYears, [2021, 2022, 2023, 2024, 2025]);
  assert.deepEqual(availableInpsRegionalYears, [2016, 2017, 2018, 2019, 2020, 2021, 2022, 2023, 2024]);
  assert.equal(inpsCivilInvaliditySnapshot.spending.series.at(-1).amountCents, 2_361_600_000_000);
  assert.equal(inpsCivilInvaliditySnapshot.spending.latestChangeCents, 76_000_000_000);
  assert.equal(
    inpsCivilInvaliditySnapshot.benefitsStock.attendanceAllowances +
      inpsCivilInvaliditySnapshot.benefitsStock.civilInvalidityPensions,
    inpsCivilInvaliditySnapshot.benefitsStock.totalBenefits,
  );

  inpsCivilInvaliditySnapshot.regionalNewPensions.years.forEach((year, index) => {
    const total = inpsCivilInvaliditySnapshot.regionalNewPensions.regions.reduce(
      (sum, region) => sum + region.values[index],
      0,
    );
    assert.equal(total, inpsCivilInvaliditySnapshot.regionalNewPensions.nationalTotals[index], year);
  });
});

test("INPS provenance is official, hashed and does not invent an open-data license", () => {
  for (const source of inpsCivilInvaliditySnapshot.sources) {
    assert.match(source.url, /^https:\/\/www\.inps\.it\//);
    assert.match(source.sha256, /^[a-f0-9]{64}$/);
    assert.match(source.rightsNote, /non presentato come dataset IODL/i);
  }
});

test("INPS query filters only supported years and regions without fabricating coverage", () => {
  const calabria = queryInpsCivilInvalidity({ year: 2023, region: "Calabria" });
  assert.deepEqual(calabria.regionalNewPensions.years, [2023]);
  assert.deepEqual(calabria.regionalNewPensions.regions, [
    { region: "Calabria", values: [8789] },
  ]);
  assert.deepEqual(calabria.query, { year: 2023, region: "Calabria" });
  assert.deepEqual(calabria.spending.geographicScope, {
    level: "country",
    code: "IT",
    name: "Italia",
  });
  assert.deepEqual(calabria.regionalNewPensions.geographicScopes.rows, {
    level: "region",
    name: "Calabria",
  });
  assert.deepEqual(calabria.regionalNewPensions.geographicScopes.nationalTotals, {
    level: "covered-regions",
    name: "18 regioni coperte",
  });
  assert.equal(calabria.regionalNewPensions.nationalTotals[0], 134_309);
  assert.equal(calabria.regionalNewPensions.regions[0].values[0], 8_789);
  assert.equal(calabria.spending.series.length, 1);
  assert.equal(calabria.spending.series[0].amountCents, 2_161_900_000_000);
  assert.deepEqual(calabria.spending.change, {
    fromYear: 2022,
    toYear: 2023,
    amountCents: 108_400_000_000,
    percent: 5.3,
  });
  assert.equal(calabria.benefitsStock, null);
  assert.deepEqual(calabria.regionalNewPensions.provisionalYears, []);

  const onlyNational = queryInpsCivilInvalidity({ year: 2025 });
  assert.equal(onlyNational.spending.series.length, 1);
  assert.deepEqual(onlyNational.regionalNewPensions.years, []);
  assert.deepEqual(onlyNational.regionalNewPensions.regions, []);
  assert.deepEqual(onlyNational.spending.change, {
    fromYear: 2024,
    toYear: 2025,
    amountCents: 76_000_000_000,
    percent: 3.3,
  });
  assert.equal(onlyNational.benefitsStock, null);

  const stockYear = queryInpsCivilInvalidity({ year: 2024 });
  assert.equal(stockYear.benefitsStock?.asOf, "2024-12-31");
  assert.equal(stockYear.benefitsStock?.geographicScope.level, "country");
  assert.deepEqual(stockYear.regionalNewPensions.provisionalYears, [2024]);
  assert.equal(stockYear.regionalNewPensions.geographicScopes.rows.level, "covered-regions");
  assert.throws(
    () => queryInpsCivilInvalidity({ year: 2025, region: "Calabria" }),
    /dettaglio regionale INPS non è disponibile/,
  );

  assert.throws(() => queryInpsCivilInvalidity({ year: 2015 }), /Anno INPS non disponibile/);
  assert.throws(
    () => queryInpsCivilInvalidity({ region: "Valle d'Aosta" }),
    /non è inclusa nella serie INPS/,
  );
  assert.throws(
    () => queryInpsCivilInvalidity({ region: "Valle d’Aosta" }),
    /non è inclusa nella serie INPS/,
  );
  assert.throws(() => queryInpsCivilInvalidity({ region: "Atlantide" }), /Regione INPS non disponibile/);
});

test("INPS contract rejects malformed metadata, years and management values", () => {
  const invalidDate = cloneSnapshot();
  invalidDate.generatedAt = "non-una-data";
  assert.throws(
    () => validateInpsCivilInvaliditySnapshot(invalidDate),
    /generatedAt non valida/,
  );

  const fractionalYear = cloneSnapshot();
  fractionalYear.spending.series[0].year = 2021.5;
  assert.throws(
    () => validateInpsCivilInvaliditySnapshot(fractionalYear),
    /serie di spesa non valida/,
  );

  const negativeManagementValue = cloneSnapshot();
  negativeManagementValue.managementDetail2024.attendanceAllowances = -1;
  assert.throws(
    () => validateInpsCivilInvaliditySnapshot(negativeManagementValue),
    /accompagnamenti nel dettaglio 2024 non valido/,
  );

  const missingRights = cloneSnapshot();
  missingRights.sources[0].rightsNote = " ";
  assert.throws(
    () => validateInpsCivilInvaliditySnapshot(missingRights),
    /nota diritti fonte.*mancante/,
  );
});

test("INPS snapshot publishes territorial limits and no individual records", () => {
  assert.equal(inpsCivilInvaliditySnapshot.territorialAvailability.publicStructuredLevel, "region");
  assert.match(inpsCivilInvaliditySnapshot.territorialAvailability.municipality, /richiede abilitazione/i);
  assert.match(inpsCivilInvaliditySnapshot.methodology.interpretation, /Non provano frode/i);
  assert.equal("people" in inpsCivilInvaliditySnapshot, false);
  assert.equal("doctors" in inpsCivilInvaliditySnapshot, false);
});
