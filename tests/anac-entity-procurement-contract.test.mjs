import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { existsSync, readFileSync } from "node:fs";
import test from "node:test";
import "./helpers/register-ts-alias.mjs";

import sourceSpecJson from "../scripts/etl/specs/anac-entity-procurement.source.json" with { type: "json" };
import parentSpecJson from "../scripts/etl/specs/anac-awardees.source.json" with { type: "json" };

const { assertAnacEntityProcurementCoverageManifest } = await import(
  "../src/lib/data/anac-entity-procurement-contract.ts"
);

const SOURCE_SPEC_PATH = "scripts/etl/specs/anac-entity-procurement.source.json";
const PARENT_SPEC_PATH = "scripts/etl/specs/anac-awardees.source.json";
const sourceSpecHash = createHash("sha256")
  .update(readFileSync(new URL("../scripts/etl/specs/anac-entity-procurement.source.json", import.meta.url)))
  .digest("hex");
const parentSpecHash = createHash("sha256")
  .update(readFileSync(new URL("../scripts/etl/specs/anac-awardees.source.json", import.meta.url)))
  .digest("hex");
const ARTIFACT_PATH = new URL("../src/data/generated/anac-entity-procurement-coverage.json", import.meta.url);
const ARTIFACT_REGISTRY_PATH = new URL("../scripts/ci/generated-artifacts.json", import.meta.url);
const artifactRegistered = JSON.parse(readFileSync(ARTIFACT_REGISTRY_PATH, "utf8")).artifacts.some(
  (entry) => entry.id === "anac-entity-procurement-coverage",
);

function sourceInputs() {
  const sourceInputs = structuredClone(sourceSpecJson.inputs);
  for (const key of ["awards", "awardees"]) {
    sourceInputs[key] = {
      ...structuredClone(parentSpecJson.inputs[key]),
      parentSpecPath: PARENT_SPEC_PATH,
      parentSpecSha256: parentSpecHash,
      parentInputKey: sourceInputs[key].parentInputKey,
      license: structuredClone(sourceInputs[key].license),
    };
  }
  return sourceInputs;
}

function sourceProvenance() {
  return {
    catalogObservedAt: sourceSpecJson.catalogObservedAt,
    catalogMetadataModifiedAt: sourceSpecJson.catalogMetadataModifiedAt,
    assetObservedAt: {
      cig: sourceSpecJson.inputs.cig.map((input) => input.assetObservedAt),
      stations: sourceSpecJson.inputs.stations.assetObservedAt,
    },
    sourceSpec: { path: SOURCE_SPEC_PATH, sha256: sourceSpecHash },
    parentSpec: {
      path: PARENT_SPEC_PATH,
      sha256: parentSpecHash,
      catalogObservedAt: parentSpecJson.catalogObservedAt,
      catalogMetadataModifiedAt: parentSpecJson.catalogMetadataModifiedAt,
    },
  };
}

function statusRows(overrides = {}) {
  return {
    missing: 0,
    invalid: 0,
    negative: 0,
    zero: 0,
    "positive-exact-cent": 0,
    "positive-subcent": 0,
    conflicting: 0,
    ...overrides,
  };
}

function amount(distinctRows, statuses, exactSum, subcentSum, positiveRows, positiveSum) {
  return {
    distinctRows,
    statusRows: statusRows(statuses),
    "positive-exact-centSum": exactSum,
    "positive-subcentSum": subcentSum,
    positiveRows,
    positiveSum,
  };
}

function fixture() {
  return {
    schemaVersion: 1,
    dataset: "anac-entity-procurement-coverage",
    distributionKind: "full-snapshot",
    observedAt: "2026-08-30T21:30:00Z",
    generatedAt: "2026-08-30T23:31:00Z",
    scope: {
      cohort: "cig-2025-full",
      publicationMonths: [1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12],
      nationalPopulationClaim: "not-asserted",
      temporalAlignment: "cross-snapshot",
    },
    contract: {
      stationIdentity: "codice_ausa",
      entityIdentity: "cf_amministrazione_appaltante",
      stationKey: "ausa:<CODICE_AUSA>",
      entityKey: "cf:<CF_AMMINISTRAZIONE_APPALTANTE>",
      procedureKey: ["cig"],
      awardKey: ["cig", "id_aggiudicazione"],
      procedurePeriod: "data_pubblicazione",
      awardPeriod: "data_aggiudicazione_definitiva",
      procedureAmount: "importo_lotto",
      awardAmount: "importo_aggiudicazione",
      amountRepresentation: "exact-decimal",
      awardAmountAggregation: "once-per-distinct-award-pair",
      awardeeMultipartyPolicy: "awardee-rows-never-multiply-award-amount",
    },
    privacy: {
      aggregateOnly: true,
      containsRawRows: false,
      containsRawTaxIds: false,
      containsNames: false,
    },
    inputs: sourceInputs(),
    provenance: sourceProvenance(),
    coverage: {
      registry: {
        rowsTotal: 3,
        rowsWithAusa: 3,
        rowsWithCf: 2,
        rowsWithEntityCf: 2,
        rowsWithNonstandardCf: 0,
        distinctAusa: 3,
        distinctCf: 2,
        cfWithMultipleAusa: 0,
        "status:ATTIVO": 3,
        "status:CESSATO": 0,
        "status:(other)": 0,
        "status:(missing)": 0,
      },
      procedures: {
        rawRows: 4,
        nonPrimaryRows: 1,
        primaryRows: 3,
        distinctRawCigs: 3,
        cigsWithExactlyOnePrimary: 3,
        cigsWithoutPrimary: 0,
        cigsWithMultiplePrimary: 0,
        distinctCigs: 3,
        "publicationDate:valid": 2,
        "publicationDate:missing": 1,
        "publicationDate:invalid": 0,
        "publicationDate:before-1990": 0,
        "publicationDate:future": 0,
        "lotAmount:positive-exact-cent": 1,
        "lotAmount:positive-subcent": 1,
        "lotAmount:zero": 1,
        "lotAmount:missing": 0,
        "lotAmount:invalid": 0,
        "lotAmount:negative": 0,
        "lotAmount:conflicting": 0,
        "identity:resolved": 2,
        "identity:unresolved": 1,
        "identity:conflict": 0,
      },
      identity: {
        resolved: 2,
        unresolved: 1,
        conflict: 0,
        "via:ausa-only": 1,
        "via:cf-fallback": 1,
        "via:missing-both": 1,
        "via:ausa-and-cf": 0,
        "via:ausa-invalid": 0,
        "via:ausa-not-in-registry": 0,
        "via:ausa-cf-conflict": 0,
        "via:cf-invalid": 0,
        "via:cf-placeholder": 0,
        "via:cf-not-in-registry": 0,
        "via:ambiguous-cf": 0,
        "via:registry-cf-nonstandard": 0,
        "via:ausa-without-entity-cf": 0,
        "via:publication-date-unusable": 0,
        "via:ausa-outside-registry-interval": 0,
        "via:cf-no-active-station": 0,
      },
      awards: {
        rawRows: 4,
        "id:known": 3,
        "id:missing-sentinel": 1,
        "id:missing": 0,
        "id:invalid": 0,
        knownKeyRows: 3,
        ineligibleKeyRows: 1,
        "amount:positive-exact-cent": 1,
        "amount:positive-subcent": 1,
        "amount:zero": 1,
        "amount:missing": 1,
        "amount:invalid": 0,
        "amount:negative": 0,
        "amount:conflicting": 0,
        "awardDate:valid": 3,
        "awardDate:missing": 1,
        "awardDate:invalid": 0,
        "awardDate:before-1990": 0,
        "awardDate:future": 0,
        distinctAwards: 2,
        duplicateKeyRows: 1,
        duplicateKeyGroups: 1,
        amountConflictGroups: 1,
        awardDateConflictGroups: 1,
        criticalConflictGroups: 1,
        conflictingAwardKeys: 1,
        exactDuplicateRows: 0,
        nonIdenticalDuplicateRows: 1,
      },
      awardees: {
        rawRows: 3,
        "id:known": 2,
        "id:missing-sentinel": 1,
        "id:missing": 0,
        "id:invalid": 0,
        knownKeyRows: 2,
        ineligibleKeyRows: 1,
        distinctJoinPairs: 2,
        exactDuplicateRows: 0,
        pairsWithMultipleAwardeeRows: 0,
      },
    },
    amounts: {
      procedureLot: amount(
        3,
        { "positive-exact-cent": 1, "positive-subcent": 1, zero: 1 },
        "1.00",
        "0.001",
        2,
        "1.001",
      ),
      awardRows: amount(2, { "positive-exact-cent": 1, conflicting: 1 }, "2.00", "0", 1, "2.00"),
      awardContributionInCohort: amount(2, { "positive-exact-cent": 1, conflicting: 1 }, "2.00", "0", 1, "2.00"),
      awardeeMultiplication: false,
      lotAndAwardAmountsAreDistinctFields: true,
    },
    reconciliation: {
      awardPairsTotal: 2,
      awardPairsInCohort: 2,
      awardPairsOutOfCohort: 0,
      awardPairsWithAwardees: 1,
      awardPairsWithoutAwardees: 1,
      awardeePairsTotal: 2,
      awardeePairsInCohort: 2,
      awardeePairsOutOfCohort: 0,
      awardeePairsWithoutAward: 0,
    },
    sourceSpecSha256: sourceSpecHash,
    limitations: [
      "full-snapshot cross-temporal: CIG, aggiudicazioni e aggiudicatari non sono una fotografia sincronizzata",
      "nationalPopulationClaim non-asserted: il risultato non è una copertura nazionale corrente",
      "nessuna inferenza di spreco, illecito, ranking o HHI in questo slice",
      "denominazioni e deleghe sono conservate nella sorgente ma non sono chiavi dell'identita",
    ],
  };
}

test("ANAC readiness manifest fixture is aggregate-only and reconciled", () => {
  const verified = assertAnacEntityProcurementCoverageManifest(fixture());
  assert.equal(verified.distributionKind, "full-snapshot");
  assert.equal(verified.generatedAt, "2026-08-30T23:31:00Z");
  assert.deepEqual(verified.scope.publicationMonths, [1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12]);
  assert.deepEqual(verified.contract.procedureKey, ["cig"]);
  assert.deepEqual(verified.contract.awardKey, ["cig", "id_aggiudicazione"]);
  assert.equal(verified.amounts.awardeeMultiplication, false);
  assert.equal(verified.amounts.lotAndAwardAmountsAreDistinctFields, true);
  assert.equal(verified.amounts.awardRows.statusRows["positive-exact-cent"], 1);
  assert.equal(verified.amounts.awardRows.statusRows.conflicting, 1);
  assert.equal(verified.privacy.containsRawTaxIds, false);
  assert.equal(verified.privacy.containsNames, false);
  assert.equal(verified.inputs.awards.parentInputKey, "awards");
  assert.equal(verified.inputs.awardees.parentInputKey, "awardees");
  assert.equal(verified.inputs.stations.datasetLegacyUuid, sourceSpecJson.inputs.stations.datasetLegacyUuid);
  assert.equal("resourcePageUrl" in verified.inputs.stations, false);
  assert.equal("resourceId" in verified.inputs.stations, false);
  assert.equal(verified.provenance.catalogMetadataModifiedAt, null);
  assert.equal(verified.provenance.assetObservedAt.cig.length, 12);
  assert.equal("entityPeriods" in verified, false);
});

test("ANAC readiness manifest rejects source, licence, parent and scope drift", () => {
  const badSource = fixture();
  badSource.inputs.cig[0].resourceUrl = "https://example.com/cig.zip";
  assert.throws(() => assertAnacEntityProcurementCoverageManifest(badSource), /non ufficiale/);

  const formallyValidSourceDrift = fixture();
  formallyValidSourceDrift.inputs.cig[0].archiveBytes += 1;
  assert.throws(() => assertAnacEntityProcurementCoverageManifest(formallyValidSourceDrift), /source spec/);

  const formallyValidParentDrift = fixture();
  formallyValidParentDrift.inputs.awards.headers = [...formallyValidParentDrift.inputs.awards.headers].reverse();
  assert.throws(() => assertAnacEntityProcurementCoverageManifest(formallyValidParentDrift), /source spec/);

  const formallyValidMemberDrift = fixture();
  formallyValidMemberDrift.inputs.awardees.member.bytes += 1;
  assert.throws(() => assertAnacEntityProcurementCoverageManifest(formallyValidMemberDrift), /source spec/);

  const formallyValidParentHashDrift = fixture();
  formallyValidParentHashDrift.inputs.awards.parentSpecSha256 = "0".repeat(64);
  assert.throws(() => assertAnacEntityProcurementCoverageManifest(formallyValidParentHashDrift), /source spec/);

  const formallyValidProvenanceDrift = fixture();
  formallyValidProvenanceDrift.provenance.assetObservedAt.cig[0] = "2026-08-30T21:31:00Z";
  assert.throws(() => assertAnacEntityProcurementCoverageManifest(formallyValidProvenanceDrift), /source spec/);

  const badLicence = fixture();
  badLicence.inputs.stations.license.name = "CC BY-SA 4.0";
  assert.throws(() => assertAnacEntityProcurementCoverageManifest(badLicence), /licenza/);

  const badParent = fixture();
  badParent.inputs.awards.parentSpecSha256 = "0";
  assert.throws(() => assertAnacEntityProcurementCoverageManifest(badParent), /SHA-256/);

  const badParentKey = fixture();
  badParentKey.inputs.awardees.parentInputKey = "awards";
  assert.throws(() => assertAnacEntityProcurementCoverageManifest(badParentKey), /parent/);

  const badResourceId = fixture();
  badResourceId.inputs.cig[0].resourceId = "not-a-uuid";
  assert.throws(() => assertAnacEntityProcurementCoverageManifest(badResourceId), /resourceId/);

  const mismatchedResourceId = fixture();
  mismatchedResourceId.inputs.cig[0].resourceId = "a87a23dd-44a3-4b49-a7ad-b96566476979";
  assert.throws(() => assertAnacEntityProcurementCoverageManifest(mismatchedResourceId), /non riconciliati/);

  const badProvenancePath = fixture();
  badProvenancePath.provenance.sourceSpec.path = "scripts/etl/specs/other.source.json";
  assert.throws(() => assertAnacEntityProcurementCoverageManifest(badProvenancePath), /path source spec/);

  const badProvenanceTimestamp = fixture();
  badProvenanceTimestamp.provenance.assetObservedAt.stations = "2026-08-30";
  assert.throws(
    () => assertAnacEntityProcurementCoverageManifest(badProvenanceTimestamp),
    /assetObservedAt\.stations/,
  );

  const badChronology = fixture();
  badChronology.generatedAt = "2026-08-30T20:30:00Z";
  assert.throws(() => assertAnacEntityProcurementCoverageManifest(badChronology), /cronologia/);

  const badHash = fixture();
  badHash.sourceSpecSha256 = "0";
  assert.throws(() => assertAnacEntityProcurementCoverageManifest(badHash), /SHA-256/);

  const badScope = fixture();
  badScope.scope.publicationMonths = [1];
  assert.throws(() => assertAnacEntityProcurementCoverageManifest(badScope), /scope/);
});

test("ANAC readiness manifest rejects identity, amount and privacy drift", () => {
  const badIdentity = fixture();
  badIdentity.contract.entityIdentity = "denominazione_amministrazione_appaltante";
  assert.throws(() => assertAnacEntityProcurementCoverageManifest(badIdentity), /contract/);

  const badAwardKey = fixture();
  badAwardKey.contract.awardKey = ["cig"];
  assert.throws(() => assertAnacEntityProcurementCoverageManifest(badAwardKey), /contract/);

  const badAmountPolicy = fixture();
  badAmountPolicy.contract.awardAmountAggregation = "once-per-awardee-row";
  assert.throws(() => assertAnacEntityProcurementCoverageManifest(badAmountPolicy), /contract/);

  const badFloat = fixture();
  badFloat.amounts.awardRows.positiveSum = 2.5;
  assert.throws(() => assertAnacEntityProcurementCoverageManifest(badFloat), /non valido/);

  const exactDecimalPrecision = fixture();
  exactDecimalPrecision.amounts.procedureLot["positive-exact-centSum"] = "0.1";
  exactDecimalPrecision.amounts.procedureLot["positive-subcentSum"] = "0.2";
  exactDecimalPrecision.amounts.procedureLot.positiveSum = "0.3";
  assert.doesNotThrow(() => assertAnacEntityProcurementCoverageManifest(exactDecimalPrecision));

  for (const coverageKey of ["procedureLot", "awardRows", "awardContributionInCohort"]) {
    const badPositiveSum = fixture();
    badPositiveSum.amounts[coverageKey].positiveSum = "999.999";
    assert.throws(() => assertAnacEntityProcurementCoverageManifest(badPositiveSum), /somma positive/);
  }

  const badStatusPartition = fixture();
  badStatusPartition.amounts.procedureLot.statusRows.zero += 1;
  assert.throws(() => assertAnacEntityProcurementCoverageManifest(badStatusPartition), /partizione importi/);

  const badConflictPartition = fixture();
  badConflictPartition.amounts.awardRows.statusRows.conflicting += 1;
  assert.throws(() => assertAnacEntityProcurementCoverageManifest(badConflictPartition), /partizione importi/);

  const badLotSeparation = fixture();
  badLotSeparation.amounts.lotAndAwardAmountsAreDistinctFields = false;
  assert.throws(() => assertAnacEntityProcurementCoverageManifest(badLotSeparation), /amounts/);

  const privacyLeak = fixture();
  privacyLeak.privacy.containsNames = true;
  assert.throws(() => assertAnacEntityProcurementCoverageManifest(privacyLeak), /privacy/);

  for (const [counterName, leakedKey] of [
    ["registry", "denominazione"],
    ["procedures", "codice_fiscale"],
    ["identity", "cf_amministrazione_appaltante"],
    ["awards", "denominazione"],
    ["awardees", "codice_fiscale"],
  ]) {
    const counterLeak = fixture();
    counterLeak.coverage[counterName][leakedKey] = 1;
    assert.throws(() => assertAnacEntityProcurementCoverageManifest(counterLeak), /campi inattesi/);
  }

  for (const [counterName, leakedKey] of [
    ["procedures", "publicationDate:conflicting"],
    ["awards", "awardDate:conflicting"],
  ]) {
    const closedSetDrift = fixture();
    closedSetDrift.coverage[counterName][leakedKey] = 1;
    assert.throws(() => assertAnacEntityProcurementCoverageManifest(closedSetDrift), /campi inattesi/);
  }

  const rawEntityIndex = fixture();
  rawEntityIndex.entityPeriods = [];
  assert.throws(() => assertAnacEntityProcurementCoverageManifest(rawEntityIndex), /campi inattesi/);
});

test("ANAC readiness manifest rejects reconciliation and counter drift", () => {
  const badCohort = fixture();
  badCohort.reconciliation.awardPairsWithAwardees += 1;
  assert.throws(() => assertAnacEntityProcurementCoverageManifest(badCohort), /reconciliation/);

  const badProcedure = fixture();
  badProcedure.coverage.procedures["lotAmount:zero"] += 1;
  assert.throws(() => assertAnacEntityProcurementCoverageManifest(badProcedure), /stati procedure/);

  const badIdentity = fixture();
  badIdentity.coverage.identity["via:missing-both"] -= 1;
  assert.throws(() => assertAnacEntityProcurementCoverageManifest(badIdentity), /identità/);

  const badAwards = fixture();
  badAwards.coverage.awards.duplicateKeyRows += 1;
  assert.throws(() => assertAnacEntityProcurementCoverageManifest(badAwards), /aggiudicazioni/);

  const missingCounterKey = fixture();
  delete missingCounterKey.coverage.awardees["id:invalid"];
  assert.throws(() => assertAnacEntityProcurementCoverageManifest(missingCounterKey), /campi inattesi/);

  const badConflictMetrics = fixture();
  badConflictMetrics.coverage.awards.nonIdenticalDuplicateRows = 0;
  assert.throws(() => assertAnacEntityProcurementCoverageManifest(badConflictMetrics), /aggiudicazioni/);

  const badStations = fixture();
  badStations.inputs.stations.catalogMetadataModifiedAt = "not-a-date";
  assert.throws(() => assertAnacEntityProcurementCoverageManifest(badStations), /metadata catalogo/);

  const badRegistryPartition = fixture();
  badRegistryPartition.coverage.registry.rowsWithNonstandardCf = 1;
  assert.throws(() => assertAnacEntityProcurementCoverageManifest(badRegistryPartition), /registry/);

  const badStationsKeys = fixture();
  badStationsKeys.inputs.stations.codice_fiscale = "12345678901";
  assert.throws(() => assertAnacEntityProcurementCoverageManifest(badStationsKeys), /campi inattesi/);
});

test("ANAC readiness validates the committed artifact when it is registered", () => {
  const artifactPresent = existsSync(ARTIFACT_PATH);
  assert.equal(
    artifactPresent || !artifactRegistered,
    true,
    "artifact ANAC entity procurement registrato ma assente",
  );
  if (!artifactPresent) return;
  const verified = assertAnacEntityProcurementCoverageManifest(
    JSON.parse(readFileSync(ARTIFACT_PATH, "utf8")),
  );
  assert.equal(verified.provenance.sourceSpec.path, "scripts/etl/specs/anac-entity-procurement.source.json");
  assert.equal(verified.privacy.containsRawRows, false);
});
