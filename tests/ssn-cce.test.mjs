import assert from "node:assert/strict";
import test from "node:test";
import "./helpers/register-ts-alias.mjs";

const {
  SSN_CCE_DATASET_ID,
  SSN_CCE_METRICS,
  validateSsnCceSnapshot,
} = await import("../src/lib/data/ssn-cce-contract.ts");
const {
  querySsnCce,
  querySsnCceMetric,
  ssnCceSnapshot,
  getSsnCceSourceHealth,
  SsnCceQueryError,
} = await import("../src/lib/ssn-cce-snapshot.ts");

test("SSN snapshot has the locked national accounting totals", () => {
  assert.equal(ssnCceSnapshot.datasetId, SSN_CCE_DATASET_ID);
  assert.equal(ssnCceSnapshot.referenceYear, 2024);
  assert.equal(ssnCceSnapshot.observation.type, "CONSUNTIVO");
  assert.equal(ssnCceSnapshot.observation.accountingBasis.includes("competenza economica"), true);
  assert.deepEqual([...SSN_CCE_METRICS], [
    "productionCosts",
    "personnelCost",
    "healthcareWorkServices",
    "nonHealthcareWorkServices",
    "purchasedServices",
  ]);
  assert.equal(ssnCceSnapshot.national.values.personnelCost, 4_037_827_491_649);
  assert.equal(ssnCceSnapshot.national.values.healthcareWorkServices, 184_360_514_664);
  assert.equal(ssnCceSnapshot.national.values.nonHealthcareWorkServices, 23_628_458_264);
  assert.equal(ssnCceSnapshot.national.values.productionCosts, 14_919_584_274_769);
  assert.equal(ssnCceSnapshot.national.values.purchasedServices, 6_626_162_783_206);
  assert.equal(ssnCceSnapshot.entities.length, 232);
  assert.equal(ssnCceSnapshot.detailCoverage.entityCount, 232);
  assert.equal(ssnCceSnapshot.entities.some((entity) => entity.codeSsn === "999"), false);
  assert.equal(ssnCceSnapshot.regions.length, 21);
});

test("source health exposes the pinned artifact and all three official inputs", () => {
  const health = getSsnCceSourceHealth();
  assert.equal(health.status, "verified");
  assert.equal(health.check, "offline-source-lock-and-snapshot-contract");
  assert.equal(health.runtimeFetch, false);
  assert.equal(health.artifact.bytes, 126_487);
  assert.match(health.artifact.sha256, /^[a-f0-9]{64}$/);
  assert.match(health.artifact.lockSha256, /^[a-f0-9]{64}$/);
  assert.deepEqual(Object.keys(health.datasets).sort(), ["entities", "national", "regional"]);
  assert.equal(health.datasets.entities.expectedRows, 76_124);
  assert.equal(health.datasets.national.expectedRows, 5);
  assert.equal(health.datasets.regional.expectedRows, 105);
  for (const dataset of Object.values(health.datasets)) {
    assert.equal(dataset.status, "verified");
    assert.match(dataset.sourceSha256, /^[a-f0-9]{64}$/);
    assert.match(dataset.landingUrl, /^https:\/\//);
    assert.match(dataset.sourceUrl, /^https:\/\//);
  }
});

test("official geography keeps the two autonomous provinces separate", () => {
  const bolzano = querySsnCce({ region: "P. A. Bolzano", limit: 100 });
  const trento = querySsnCce({ region: "P. A. Trento", limit: 100 });
  assert.equal(bolzano.regions.map((region) => region.code).join(), "041");
  assert.equal(trento.regions.map((region) => region.code).join(), "042");
  assert.notEqual(bolzano.regions[0].name, trento.regions[0].name);
});

test("queries are bounded and return paginated entity detail", () => {
  const national = querySsnCce({ limit: 1 });
  assert.equal(national.query.region, null);
  assert.equal(national.regions.length, 21);
  assert.equal(national.selectedAggregate.level, "national");
  assert.deepEqual(national.selectedAggregate.values, ssnCceSnapshot.national.values);

  const page = querySsnCce({ region: "Calabria", limit: 2, offset: 1 });
  assert.equal(page.pagination.total, 11);
  assert.equal(page.pagination.returned, 2);
  assert.equal(page.entities.length, 2);
  assert.ok(page.entities.every((entity) => entity.region === "Calabria"));
  assert.equal(page.selectedAggregate.level, "region");
  assert.equal(page.selectedAggregate.code, "180");
  assert.deepEqual(page.selectedAggregate.values, page.regions[0].values);

  const codeOnly = querySsnCce({ code: page.entities[0].codeSsn, limit: 1 });
  assert.equal(codeOnly.selectedAggregate.level, "entity_match");
  assert.equal(codeOnly.selectedAggregate.values, null);

  const codeAndRegion = querySsnCce({
    region: " Calabria ",
    code: ` ${page.entities[0].codeSsn} `,
    limit: 1,
  });
  assert.equal(codeAndRegion.selectedAggregate.level, "entity_match");
  assert.equal(codeAndRegion.selectedAggregate.values, null);
  assert.equal(codeAndRegion.selectedAggregate.contextRegion.code, "180");

  const metric = querySsnCceMetric({
    region: "Calabria",
    code: ` ${page.entities[0].codeSsn} `,
    metric: "personnelCost",
    limit: 1,
  });
  assert.equal(metric.metric, "personnelCost");
  assert.equal(metric.values.length, 1);
  assert.equal(typeof metric.values[0].amountCents, "number");
  assert.equal(typeof metric.values[0].missing, "boolean");
  assert.equal(metric.selectedAggregate.level, "entity_match");

  assert.throws(
    () => querySsnCce({ limit: 101 }),
    (error) => error instanceof SsnCceQueryError && error.code === "invalid_query",
  );
  assert.throws(
    () => querySsnCce({ limit: 0 }),
    (error) => error instanceof SsnCceQueryError && error.code === "invalid_query",
  );
  assert.throws(
    () => querySsnCce({ year: 2023 }),
    (error) => error instanceof SsnCceQueryError && error.code === "not_found",
  );
});

test("contract rejects semantic or reconciliation drift", () => {
  const semanticDrift = structuredClone(ssnCceSnapshot);
  semanticDrift.methodology.externalStaffBoundary = "Le voci sono gettonisti e cooperative.";
  assert.throws(
    () => validateSsnCceSnapshot(semanticDrift),
    /limite semantico personale esterno divergente/,
  );

  const labelDrift = structuredClone(ssnCceSnapshot);
  labelDrift.metrics[2].label = "gettonisti";
  assert.throws(() => validateSsnCceSnapshot(labelDrift), /label metrica inattesa/);

  const licenseDrift = structuredClone(ssnCceSnapshot);
  licenseDrift.source.licenseVersion = "4.0 International";
  assert.throws(() => validateSsnCceSnapshot(licenseDrift), /metadati licenza inattesi/);

  const reconciliationDrift = structuredClone(ssnCceSnapshot);
  reconciliationDrift.national.values.personnelCost += 1;
  assert.throws(
    () => validateSsnCceSnapshot(reconciliationDrift),
    /totale nazionale inatteso/,
  );

  const detailOnly = structuredClone(ssnCceSnapshot);
  detailOnly.entities[0].values.personnelCost += 1;
  assert.doesNotThrow(() => validateSsnCceSnapshot(detailOnly));

  const missingDrift = structuredClone(ssnCceSnapshot);
  missingDrift.entities[0].missing.personnelCost = 2;
  assert.throws(() => validateSsnCceSnapshot(missingDrift), /missing ente non binario/);
});
