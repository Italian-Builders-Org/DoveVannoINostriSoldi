import assert from "node:assert/strict";
import { readFileSync, statSync } from "node:fs";
import test from "node:test";
import "./helpers/register-ts-alias.mjs";

const [{ getMunicipalityProfile }, { getSiopeMunicipalityDetail }, { buildMunicipalitySpendingRows }] = await Promise.all([
  import("../src/lib/municipality-profile.ts"),
  import("../src/lib/siope-municipality-detail.ts"),
  import("../src/lib/municipality-spending-view.ts"),
]);

const detailArtifacts = [
  "src/data/generated/siope-municipal-detail-2024.json",
  "src/data/generated/siope-municipal-detail-2025.json",
  "src/data/generated/siope-municipal-detail.json",
];

function entity({
  codiceIpa,
  taxCode,
  istatCode,
  cadastralCode,
}) {
  return {
    codiceIpa,
    denominazione: `Comune ${codiceIpa}`,
    codiceFiscale: taxCode,
    tipologia: "Pubbliche Amministrazioni",
    codiceCategoria: "L6",
    codiceNatura: "2430",
    codiceAteco: null,
    inLiquidazione: false,
    codiceMiur: null,
    codiceIstat: null,
    acronimo: null,
    responsabile: { nome: null, cognome: null, titolo: null },
    sede: {
      codiceComuneIstat: istatCode,
      codiceCatastaleComune: cadastralCode,
      cap: null,
      indirizzo: null,
    },
    email: [],
    sitoIstituzionale: null,
    social: { facebook: null, linkedin: null, twitter: null, youtube: null },
    dataAggiornamento: null,
  };
}

test("SIOPE municipality detail covers every active row and reconciles Benevento", () => {
  const detail = getSiopeMunicipalityDetail("00074270620");
  assert.ok(detail);
  assert.equal(detail.name, "COMUNE DI BENEVENTO");
  assert.deepEqual(detail.years.map((year) => year.year), [2026, 2025, 2024]);
  for (const year of detail.years) {
    assert.equal(
      year.titles.reduce((total, title) => total + title.amountCents, 0),
      year.totalCents,
    );
  }
  assert.equal(getSiopeMunicipalityDetail("not-a-tax-code"), null);
});

test("SIOPE municipality artifacts stay compact and retain national coverage", () => {
  for (const path of detailArtifacts) {
    assert.ok(statSync(path).size < 1_500_000, `${path} supera il budget di 1,5 MB`);
    const artifact = JSON.parse(readFileSync(path, "utf8"));
    assert.ok(artifact.coverage.activeMunicipalities > 7_800);
    assert.ok(artifact.coverage.withIpaIdentifier > 7_800);
    assert.equal(
      artifact.coverage.withMovements + artifact.coverage.withoutMovements,
      artifact.coverage.activeMunicipalities,
    );
  }
});

test("citizen-facing main categories plus other categories reconcile with SIOPE total", () => {
  const detail = getSiopeMunicipalityDetail("00074270620");
  assert.ok(detail);
  const latest = detail.years[0];
  const rows = buildMunicipalitySpendingRows(latest.titles, latest.totalCents);
  assert.equal(rows.length, 5);
  assert.equal(rows.at(-1).label, "Altre categorie");
  assert.equal(rows.reduce((sum, row) => sum + row.amountCents, 0), latest.totalCents);
});

test("ordinary-statute municipality joins every available source by exact identifiers", async () => {
  const profile = await getMunicipalityProfile(entity({
    codiceIpa: "c_a783",
    taxCode: "00074270620",
    istatCode: "062008",
    cadastralCode: "A783",
  }));
  assert.ok(profile);
  assert.equal(profile.identifiers.joinMethod, "exact_official_identifiers");
  assert.equal(profile.irpef.status, "available");
  assert.equal(profile.openCivitas.status, "available");
  assert.equal(profile.pnrrChildcare.data.totalProjects, 3);
  assert.ok(profile.siope.peerBenchmark);
  assert.equal(
    profile.siope.peerBenchmark.populationYear,
    profile.siope.data.years[0].geography.populationYear,
  );
  assert.ok(
    Buffer.byteLength(JSON.stringify(profile)) < 100_000,
    "municipalityProfile deve restare sotto il budget di 100 kB",
  );
});

test("committed SIOPE and ISTAT identity can serve a municipality without a live IPA cadastral field", async () => {
  const profile = await getMunicipalityProfile(entity({
    codiceIpa: "c_a783",
    taxCode: "00074270620",
    istatCode: "062008",
    cadastralCode: null,
  }), { allowCommittedIstatIdentity: true });
  assert.ok(profile);
  assert.equal(profile.irpef.status, "available");
  assert.equal(profile.openCivitas.status, "available");
  assert.equal(profile.identifiers.istatCode, "062008");
});

test("special-statute municipality keeps national data and declares OpenCivitas out of scope", async () => {
  const profile = await getMunicipalityProfile(entity({
    codiceIpa: "c_g273",
    taxCode: "80016350821",
    istatCode: "082053",
    cadastralCode: "G273",
  }));
  assert.ok(profile);
  assert.equal(profile.irpef.status, "available");
  assert.equal(profile.openCivitas.status, "out_of_scope");
  assert.equal(profile.openCivitas.reason, "outside_source_scope");
});

test("municipality without childcare projects reports zero only in the analysed PNRR scope", async () => {
  const profile = await getMunicipalityProfile(entity({
    codiceIpa: "c_i238",
    taxCode: "00031730948",
    istatCode: "094045",
    cadastralCode: "I238",
  }));
  assert.ok(profile);
  assert.equal(profile.irpef.status, "available");
  assert.equal(profile.pnrrChildcare.status, "available");
  assert.equal(profile.pnrrChildcare.data.totalProjects, 0);
  assert.equal(profile.pnrrChildcare.data.knownTotalFundingCents, 0);
  assert.deepEqual(profile.pnrrChildcare.data.projects, []);
});

test("mismatched territorial identifiers fail closed and non-municipal entities stay unchanged", async () => {
  const mismatch = await getMunicipalityProfile(entity({
    codiceIpa: "c_a783",
    taxCode: "00074270620",
    istatCode: "082053",
    cadastralCode: "A783",
  }));
  assert.ok(mismatch);
  assert.equal(mismatch.irpef.status, "not_found");
  assert.equal(mismatch.openCivitas.status, "not_found");
  assert.equal(mismatch.identifiers.istatCode, null);

  const nonMunicipal = await getMunicipalityProfile(entity({
    codiceIpa: "agid",
    taxCode: "97735020584",
    istatCode: "058091",
    cadastralCode: "H501",
  }));
  assert.equal(nonMunicipal, null);
});
