import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import "./helpers/register-ts-alias.mjs";

const { assertAnacAwardeesCoverageManifest } = await import(
  "../src/lib/data/anac-awardees-contract.ts"
);
const manifestUrl = new URL(
  "../src/data/generated/anac-awardees-coverage.json",
  import.meta.url,
);

function manifest() {
  return JSON.parse(readFileSync(manifestUrl, "utf8"));
}

test("ANAC awardees manifest is source-locked, aggregate-only and reconciled", () => {
  const verified = assertAnacAwardeesCoverageManifest(manifest());
  assert.equal(verified.scope.distributionKind, "full-snapshot");
  assert.equal(verified.scope.nationalPopulationClaim, "not-asserted");
  assert.deepEqual(verified.contract.joinKey, ["cig", "id_aggiudicazione"]);
  assert.equal(verified.contract.awardAmountPolicy, "not-measured-in-this-slice");
  assert.equal(verified.scope.temporalAlignment, "cross-snapshot");
  assert.ok(verified.coverage.awardees.rowsTotal > 5_000_000);
  assert.ok(verified.reconciliation.matchedAwardeeRows > 5_000_000);
  assert.equal(verified.privacy.containsRawTaxIds, false);
  assert.equal(verified.privacy.fixturePolicy, "synthetic-only");
});

test("ANAC awardees manifest rejects source, join, count and privacy drift", () => {
  const badUrl = manifest();
  badUrl.inputs.awardees.resourceUrl = "https://example.com/awardees.zip";
  assert.throws(() => assertAnacAwardeesCoverageManifest(badUrl), /non ufficiale/);

  const badHash = manifest();
  badHash.inputs.awards.archiveSha256 = "0";
  assert.throws(() => assertAnacAwardeesCoverageManifest(badHash), /SHA-256/);

  const badHeaders = manifest();
  badHeaders.inputs.awardees.headers = ["cig"];
  assert.throws(() => assertAnacAwardeesCoverageManifest(badHeaders), /formato CSV/);

  const badLicense = manifest();
  badLicense.license.url = "https://example.com/license";
  assert.throws(() => assertAnacAwardeesCoverageManifest(badLicense), /licenza/);

  const badJoin = manifest();
  badJoin.contract.joinKey = ["id_aggiudicazione"];
  assert.throws(() => assertAnacAwardeesCoverageManifest(badJoin), /contratto di join/);

  const badPartition = manifest();
  badPartition.reconciliation.matchedAwardeeRows += 1;
  assert.throws(() => assertAnacAwardeesCoverageManifest(badPartition), /partizione del join/);

  const badYear = manifest();
  badYear.byAwardYear[0].matchedAwardeeRows += 1;
  assert.throws(() => assertAnacAwardeesCoverageManifest(badYear), /anni non riconciliati/);

  const badAmountPolicy = manifest();
  badAmountPolicy.contract.awardAmountPolicy = "validated";
  assert.throws(() => assertAnacAwardeesCoverageManifest(badAmountPolicy), /contratto di join/);

  const badScope = manifest();
  badScope.scope.deltasApplied = ["2026-08"];
  assert.throws(() => assertAnacAwardeesCoverageManifest(badScope), /perimetro/);

  const badRoleCount = manifest();
  badRoleCount.coverage.awardees.roleRows.MANDANTE = "370281";
  assert.throws(() => assertAnacAwardeesCoverageManifest(badRoleCount), /ruoli/);

  const badDateCount = manifest();
  badDateCount.coverage.awards.dateStatusRows.valid = -1;
  assert.throws(() => assertAnacAwardeesCoverageManifest(badDateCount), /stati data/);

  const badDistinctCount = manifest();
  badDistinctCount.coverage.awardees.distinctJoinPairs = "4822171";
  assert.throws(() => assertAnacAwardeesCoverageManifest(badDistinctCount), /distinctJoinPairs/);

  const privacyLeak = manifest();
  privacyLeak.privacy.containsRawTaxIds = true;
  assert.throws(() => assertAnacAwardeesCoverageManifest(privacyLeak), /privacy contract/);
});

test("ANAC awardees manifest contains no row-level identity arrays", () => {
  const candidate = manifest();
  assert.equal("rows" in candidate, false);
  assert.equal("taxIds" in candidate, false);
  assert.equal("companies" in candidate, false);
  assert.equal("denominazioni" in candidate, false);
});
