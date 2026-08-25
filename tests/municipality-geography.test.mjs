import assert from "node:assert/strict";
import test from "node:test";
import "./helpers/register-ts-alias.mjs";

const {
  availableMunicipalityGeographyYears,
  eurosPerSquareKilometreCents,
  getMunicipalityGeographyByIstatCode,
  getMunicipalityGeographyByTaxCode,
  getRegionGeography,
  municipalityGeographyRows,
} = await import("../src/lib/municipality-geography.ts");

test("ISTAT geography snapshot has complete annual municipality coverage", () => {
  assert.deepEqual(availableMunicipalityGeographyYears, [2022, 2023, 2024, 2025, 2026]);
  for (const year of availableMunicipalityGeographyYears) {
    const rows = municipalityGeographyRows(year);
    assert.ok(rows.length > 7_800);
    assert.equal(new Set(rows.map((row) => row.istatCode)).size, rows.length);
    assert.ok(rows.every((row) => row.surfaceSquareMetres > 0));
  }
});

test("municipality geography joins exact official ISTAT and tax identifiers", () => {
  const byIstat = getMunicipalityGeographyByIstatCode(2026, "062008");
  const byTaxCode = getMunicipalityGeographyByTaxCode(2026, "00074270620");
  assert.ok(byIstat);
  assert.deepEqual(byTaxCode, byIstat);
  assert.equal(byIstat.name.toLocaleUpperCase("it-IT"), "BENEVENTO");
  assert.ok(byIstat.surfaceSquareKilometres > 100);
});

test("per-square-kilometre cents reconcile with signed half-up rounding", () => {
  assert.equal(eurosPerSquareKilometreCents(100, 1_000_000), 100);
  assert.equal(eurosPerSquareKilometreCents(1, 2_000_000), 1);
  assert.equal(eurosPerSquareKilometreCents(-1, 2_000_000), -1);
  assert.equal(eurosPerSquareKilometreCents(100, null), null);
  assert.equal(eurosPerSquareKilometreCents(100, 0), null);
});

test("regional geography reconciles municipality denominators", () => {
  const region = getRegionGeography(2023, "18");
  assert.ok(region);
  assert.equal(region.municipalities, municipalityGeographyRows(2023).filter((row) => row.regionCode === "18").length);
  assert.ok(region.surfaceSquareKilometres > 15_000);
  assert.ok(region.densityPerSquareKilometre > 100);
});
