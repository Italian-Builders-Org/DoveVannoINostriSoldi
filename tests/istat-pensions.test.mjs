import assert from "node:assert/strict";
import test from "node:test";
import "./helpers/register-ts-alias.mjs";

const {
  istatPensionsData,
  istatPensionsMetadata,
  queryIstatPensions,
} = await import("../src/lib/istat-pensions-snapshot.ts");
const {
  validateIstatPensionsBundle,
  validateIstatPensionsMetadata,
  validateIstatPensionsSnapshot,
} = await import("../src/lib/data/istat-pensions-contract.ts");

test("il bundle ISTAT pensioni mantiene flussi, periodo e fonti distinti", () => {
  const validated = validateIstatPensionsBundle(istatPensionsData, istatPensionsMetadata);
  assert.equal(validated.data.schemaVersion, 1);
  assert.deepEqual(validated.data.period, { from: 2012, to: 2022 });
  assert.equal(validated.data.pensionBenefits.observations.length, 88);
  assert.equal(validated.data.pensioners.observations.length, 11);
  assert.equal(validated.metadata.source.assets.pensionBenefits.dataflowId, "IT1,46_813,1.0");
  assert.equal(validated.metadata.source.assets.pensionBenefits.dsd, "DCAR_PENSIONI2");
  assert.equal(validated.metadata.source.assets.pensioners.dataflowId, "IT1,46_812,1.0");
  assert.equal(validated.metadata.source.assets.pensioners.dsd, "DCAR_PENSIONATI2");
  assert.equal(validated.metadata.source.licenseStatus, "not-declared");
  assert.equal(validated.metadata.overlap.additive, false);
});

test("queryIstatPensions filtra l'anno e proietta fonti con titolo, URL, periodo e hash", () => {
  const all = queryIstatPensions();
  assert.equal(all.pensionBenefits.length, 88);
  assert.equal(all.pensioners.length, 11);
  assert.equal(all.sources.length, 2);
  assert.deepEqual(all.sources.map((source) => source.id), [
    "istat-pension-benefits-2012-2022",
    "istat-pensioners-2012-2022",
  ]);
  assert.deepEqual(all.sources[0].period, { from: 2012, to: 2022 });
  assert.match(all.sources[0].url, /A\.IT\.P_NSNU\+ANP_NS\+AMEP_NS/);
  assert.match(all.sources[1].url, /A\.IT\.P_RSNU\+ANP_RS\+AMEP_RS/);

  const latest = queryIstatPensions({ year: 2022 });
  assert.equal(latest.pensionBenefits.length, 8);
  assert.equal(latest.pensioners.length, 1);
  assert.equal(latest.pensionBenefits.find((row) => row.pensionType === "ALL").pensionCount, 22_365_288);
  assert.equal(latest.pensioners[0].pensionerCount, 15_759_676);
  assert.throws(() => queryIstatPensions({ year: 2011 }), /intero tra 2012 e 2022/);
  assert.throws(() => queryIstatPensions({ year: 2022.5 }), /intero tra 2012 e 2022/);
});

test("il contratto fallisce chiuso su schema, categorie, duplicati, anni e riconciliazioni", () => {
  const missingField = structuredClone(istatPensionsData);
  delete missingField.pensionBenefits.observations[0].grossAnnualMeanEuros;
  assert.throws(() => validateIstatPensionsSnapshot(missingField));

  const unknownCategory = structuredClone(istatPensionsData);
  unknownCategory.pensionBenefits.observations[0].pensionType = "UNKNOWN";
  assert.throws(() => validateIstatPensionsSnapshot(unknownCategory));

  const duplicate = structuredClone(istatPensionsData);
  duplicate.pensionBenefits.observations[1].pensionType = "ALL";
  assert.throws(() => validateIstatPensionsSnapshot(duplicate), /duplicata|copertura/i);

  const missingYear = structuredClone(istatPensionsData);
  missingYear.pensionBenefits.observations[8].year = 2012;
  assert.throws(() => validateIstatPensionsSnapshot(missingYear), /copertura|duplicata/i);

  const brokenAmount = structuredClone(istatPensionsData);
  brokenAmount.pensionBenefits.observations[1].grossAnnualThousandEuros += 100;
  assert.throws(() => validateIstatPensionsSnapshot(brokenAmount), /riconcilia|Riconciliazione/i);

  const brokenMean = structuredClone(istatPensionsData);
  brokenMean.pensioners.observations[0].grossAnnualMeanEuros += 100;
  assert.throws(() => validateIstatPensionsSnapshot(brokenMean), /media pensionati/i);
});

test("il contratto dei metadati fallisce su hash, byte, schema e query wildcard", () => {
  const wrongHash = structuredClone(istatPensionsMetadata);
  wrongHash.source.assets.pensionBenefits.sha256 = "0".repeat(64);
  assert.throws(() => validateIstatPensionsMetadata(wrongHash));

  const wrongBytes = structuredClone(istatPensionsMetadata);
  wrongBytes.source.assets.pensioners.bytes += 1;
  assert.throws(() => validateIstatPensionsMetadata(wrongBytes));

  const wrongSchema = structuredClone(istatPensionsMetadata);
  wrongSchema.schemaVersion = 2;
  assert.throws(() => validateIstatPensionsMetadata(wrongSchema));

  const wildcard = structuredClone(istatPensionsMetadata);
  wildcard.source.assets.pensionBenefits.queryKey = "all";
  assert.throws(() => validateIstatPensionsMetadata(wildcard), /wildcard|non ammessa/i);

  const wrongHost = structuredClone(istatPensionsMetadata);
  wrongHost.source.assets.pensionBenefits.url = wrongHost.source.assets.pensionBenefits.url
    .replace("https://esploradati.istat.it", "https://example.org");
  assert.throws(() => validateIstatPensionsMetadata(wrongHost), /non autorizzata/i);

  const driftedArtifact = structuredClone(istatPensionsData);
  driftedArtifact.caveats.nominal += " Testo alterato.";
  assert.throws(
    () => validateIstatPensionsBundle(driftedArtifact, istatPensionsMetadata),
    /Binding byte\/SHA-256/i,
  );
});
