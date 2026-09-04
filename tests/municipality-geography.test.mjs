import assert from "node:assert/strict";
import test from "node:test";
import "./helpers/register-ts-alias.mjs";

const {
  availableMunicipalityGeographyYears,
  centsPerSquareKilometreForCompleteCoverage,
  eurosPerSquareKilometreCents,
  getMunicipalityGeographyByIstatCode,
  getMunicipalityGeographyByTaxCode,
  getMunicipalityGeographyByTaxCodeIfNameAgrees,
  getRegionGeography,
  municipalityGeographyRows,
  municipalityNamesAgree,
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

test("national per-square-kilometre value is null when one Region lacks geography", () => {
  assert.equal(centsPerSquareKilometreForCompleteCoverage([
    { amountCents: 100, surfaceSquareMetres: 1_000_000 },
    { amountCents: 300, surfaceSquareMetres: 1_000_000 },
  ]), 200);
  assert.equal(centsPerSquareKilometreForCompleteCoverage([
    { amountCents: 100, surfaceSquareMetres: 1_000_000 },
    { amountCents: 300, surfaceSquareMetres: null },
  ]), null);
  assert.equal(centsPerSquareKilometreForCompleteCoverage([]), null);
});
test("regional geography reconciles municipality denominators", () => {
  const region = getRegionGeography(2023, "18");
  assert.ok(region);
  assert.equal(region.municipalities, municipalityGeographyRows(2023).filter((row) => row.regionCode === "18").length);
  assert.ok(region.surfaceSquareKilometres > 15_000);
  assert.ok(region.densityPerSquareKilometre > 100);
});

test("municipality name agreement keeps spelling and bilingual variants, not swapped comunes", () => {
  assert.equal(municipalityNamesAgree("COMUNE DI BENEVENTO", "Benevento"), true);
  assert.equal(municipalityNamesAgree("COMUNE DI BOLZANO", "Bolzano/Bozen"), true);
  assert.equal(municipalityNamesAgree("ROMA CAPITALE", "Roma"), true);
  assert.equal(municipalityNamesAgree("COMUNE DI POIANA MAGGIORE", "Pojana Maggiore"), true);
  assert.equal(municipalityNamesAgree("COMUNE DI CASSANO ALLO IONIO", "Cassano all'Ionio"), true);
  assert.equal(municipalityNamesAgree("COMUNE DI DUINO-AURISINA", "Duino Aurisina-Devin Nabrežina"), true);
  assert.equal(municipalityNamesAgree("COMUNE DI VALLECROSIA AL MARE", "Vallecrosia"), true);
  assert.equal(municipalityNamesAgree("COMUNE DI SGONICO", "Sgonico-Zgonik"), true);
  assert.equal(municipalityNamesAgree("COMUNE DI MURISENGO MONFERRATO", "Murisengo"), true);
  assert.equal(municipalityNamesAgree("COMUNE DI TRIPI - ABAKAINON", "Tripi"), true);
  assert.equal(municipalityNamesAgree("COMUNE DI MONTEGRANARO", "Monte San Pietrangeli"), false);
  assert.equal(municipalityNamesAgree("COMUNE DI MONTEFORTINO", "Monte Rinaldo"), false);
  assert.equal(municipalityNamesAgree("COMUNE DI CASTIGLIONE DEL GENOVESI", "San Mango Piemonte"), false);
});

const ISTAT_TAX_CODE_ROTATION_SIOPE_NAMES = new Set([
  "COMUNE DI MONTEFALCONE APPENNINO",
  "COMUNE DI MONTEFORTINO",
  "COMUNE DI MONTE GIBERTO",
  "COMUNE DI MONTEGIORGIO",
  "COMUNE DI MONTEGRANARO",
  "COMUNE DI MONTELEONE DI FERMO",
  "COMUNE DI MONTELPARO",
  "COMUNE DI MONTE RINALDO",
  "COMUNE DI MONTERUBBIANO",
  "COMUNE DI MONTE SAN PIETRANGELI",
  "COMUNE DI MONTE URANO",
  "COMUNE DI MONTE VIDON COMBATTE",
  "COMUNE DI MONTE VIDON CORRADO",
  "COMUNE DI CASTIGLIONE DEL GENOVESI",
  "COMUNE DI SAN MANGO PIEMONTE",
]);

test("SIOPE↔ISTAT geography join fails closed on the known COD_COM_FISCALE rotation", async () => {
  const { getSiopeMunicipalityDetail } = await import("../src/lib/siope-municipality-detail.ts");
  const detail2025 = (await import("../src/data/generated/siope-municipal-detail-2025.json", { with: { type: "json" } })).default;

  const benevento = getMunicipalityGeographyByTaxCodeIfNameAgrees(2026, "00074270620", "COMUNE DI BENEVENTO");
  assert.ok(benevento);
  assert.equal(benevento.istatCode, "062008");

  const rotated = detail2025.municipalities.filter((row) => ISTAT_TAX_CODE_ROTATION_SIOPE_NAMES.has(row[2]));
  assert.equal(rotated.length, 15);

  for (const [taxCode, , siopeName] of rotated) {
    const mismatched = getMunicipalityGeographyByTaxCode(2025, taxCode);
    assert.ok(mismatched, `ISTAT still indexes ${taxCode}`);
    assert.notEqual(mismatched.name.toLocaleUpperCase("it-IT"), siopeName.replace(/^COMUNE DI /u, ""));
    assert.equal(municipalityNamesAgree(siopeName, mismatched.name), false);
    assert.equal(getMunicipalityGeographyByTaxCodeIfNameAgrees(2025, taxCode, siopeName), null);

    const detail = getSiopeMunicipalityDetail(taxCode);
    assert.ok(detail);
    assert.ok(
      detail.years.every((year) => year.geography === null && year.perSquareKmCents === null),
      `${siopeName} must not publish a km² figure from the swapped ISTAT tax code`,
    );
  }
});
