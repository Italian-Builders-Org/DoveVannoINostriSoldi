import assert from "node:assert/strict";
import test from "node:test";
import "./helpers/register-ts-alias.mjs";

const { assertLicenzeSnapshot, buildLicenzeView } = await import("../src/lib/pa-licenze-software.ts");

function vendor(name, cents, openSource = false) {
  return { vendor: name, cents, orders: 1, openSource };
}

function year(value, vendors, extra = {}) {
  const cents = vendors.reduce((sum, item) => sum + item.cents, 0);
  return {
    year: value,
    cents,
    orders: vendors.length,
    allConventionsCents: cents * 2,
    byVendor: vendors,
    byConvention: [{ convention: "LICENZE SOFTWARE MULTIBRAND 7", cents, orders: vendors.length }],
    byAdministrationType: [{ type: "COMUNI", cents, orders: vendors.length }],
    ...extra,
  };
}

function snapshot(overrides = {}) {
  return {
    schemaVersion: 1,
    datasetId: "pa-licenze-software",
    partialYear: 2026,
    sources: {
      consip: { owner: "Consip", landingUrl: "https://dati.consip.it/", license: "CC-BY-4.0", licenseUrl: "https://x", acquiredAt: "2026-11-26", assets: { "convenzioni-2026": { url: "https://dati.consip.it/x.csv", sha256: "f".repeat(64), lastModified: "2026-11-25" } } },
      anac: { owner: "ANAC", landingUrl: "https://dati.anticorruzione.it/opendata", license: "CC-BY-SA-4.0", licenseUrl: "https://x", cohort: "CIG pubblicati nel 2025" },
      siope: { owner: "RGS", landingUrl: "https://www.siope.it/", license: "non dichiarata dalla fonte" },
      ipa: { url: "https://indicepa.gov.it/x", sha256: "a".repeat(64), acquiredAt: "2026-11-26", license: "CC-BY-4.0" },
    },
    consip: {
      families: [{ id: "multibrand", label: "Licenze Software Multibrand" }],
      conventions: [
        year(2025, [vendor("Microsoft", 600), vendor("Red Hat", 300, true), vendor("SUSE", 100, true)]),
        year(2026, [vendor("Microsoft", 50)]),
      ],
      mepa: [{ year: 2025, cents: 70, orders: null, allMepaCents: 700, byAdministrationType: [{ type: "COMUNI", cents: 70, orders: null }] }],
      mepaCategories: ["Licenze software-Mepa Beni"],
    },
    anac: {
      cohort: "CIG pubblicati nel 2025",
      cpvDivision: "48",
      cents: 1000,
      awards: 3,
      attributedCents: 800,
      byCpv: [{ code: "48000000-8", label: "PACCHETTI SOFTWARE", cents: 1000, awards: 3 }],
      topVendors: [{ vendor: "ITALWARE S.R.L.", cents: 800, awards: 2 }],
      topEntities: [{ codiceIpa: "inps", entity: "INPS", cents: 1000, awards: 3 }],
      largestAwards: [{ cig: "B7377A7739", codiceIpa: "inps", entity: "INPS", vendor: null, cpv: "48000000-8", cents: 600, awardedAt: null }],
      artefacts: { cpvMetaSha256: "b".repeat(64), awardsMetaSha256: "c".repeat(64) },
    },
    siope: {
      code: "5205",
      label: "Licenze software",
      entityType: "ASL",
      byYear: [{ year: 2025, cents: 2413708990, entities: 29, monthsObserved: 12 }],
      releaseId: "d".repeat(64),
      fileSha256: "e".repeat(64),
    },
    ...overrides,
  };
}

test("accepts a well-formed snapshot", () => {
  const parsed = assertLicenzeSnapshot(snapshot());
  assert.equal(parsed.consip.conventions.length, 2);
  assert.equal(parsed.consip.mepa[0].orders, null);
  assert.equal(parsed.partialYearUpdatedAt, "2026-11-25");
});

test("refuses a year whose total is not the sum of its vendors", () => {
  const broken = snapshot();
  broken.consip.conventions[0].cents += 1;
  assert.throws(() => assertLicenzeSnapshot(broken), /somma/);
});

test("refuses attributed ANAC amounts above the total and a wrong CPV division", () => {
  const over = snapshot();
  over.anac.attributedCents = 2000;
  assert.throws(() => assertLicenzeSnapshot(over), /attribuit/);
  const division = snapshot();
  division.anac.byCpv[0].code = "30200000-1";
  assert.throws(() => assertLicenzeSnapshot(division), /divisione/);
});

test("refuses a malformed CIG, which would break the verification link", () => {
  const broken = snapshot();
  broken.anac.largestAwards[0].cig = "javascript:alert(1)";
  assert.throws(() => assertLicenzeSnapshot(broken), /CIG/);
});

test("view uses the last complete year, never the partial one, and keeps open source apart", () => {
  const view = buildLicenzeView(assertLicenzeSnapshot(snapshot()));
  assert.equal(view.referenceYear.year, 2025);
  assert.equal(view.referenceYear.openSourceCents, 400);
  assert.equal(view.referenceYear.proprietaryCents, 600);
  assert.equal(view.referenceYear.vendors[0].share, 0.6);
  assert.equal(view.partialYear.year, 2026);
  assert.equal(view.anacAttributedShare, 0.8);
});

test("view refuses to pick a reference year when only the partial year exists", () => {
  const only = snapshot();
  only.consip.conventions = [only.consip.conventions[1]];
  assert.throws(() => buildLicenzeView(assertLicenzeSnapshot(only)), /anno completo/);
});
