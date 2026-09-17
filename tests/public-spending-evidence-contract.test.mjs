import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import "./helpers/register-ts-alias.mjs";

const {
  assessSocialCardReadiness,
  assertPublicSpendingEvidenceSnapshot,
} = await import("../src/lib/data/public-spending-evidence-contract.ts");
const { computePublicSpendingBenchmark } = await import(
  "../src/lib/data/public-spending-benchmark.ts"
);

const fixturePath = new URL(
  "./fixtures/public-spending-evidence/synthetic-snapshot.json",
  import.meta.url,
);

function fixture() {
  return JSON.parse(readFileSync(fixturePath, "utf8"));
}

function benchmarkReferenceFixture() {
  const snapshot = fixture();
  const reference = snapshot.observations[2];
  reference.classification = "benchmark_reference";
  reference.evidenceStrength = "verified_official_record";
  reference.publicationStatus = "blocked";
  reference.benchmark = structuredClone(snapshot.observations[0].benchmark);
  reference.benchmark.targetDeltaCents = 0;
  reference.benchmark.targetDeltaPercent = 0;
  return snapshot;
}

function benchmarkMembers() {
  return [80_000, 100_000, 120_000, 140_000].map((valueCents, index) => ({
    observationId: `synthetic-${index + 1}`,
    valueCents,
    category: "servizio-sintetico",
    period: { start: "2026-01-01", end: "2026-12-31", precision: "year" },
    taxBasis: "net",
    unit: "award_total",
    denominator: { name: "affidamento", value: 1, unit: "affidamento" },
  }));
}

test("accepts a fully synthetic evidence snapshot", () => {
  const snapshot = assertPublicSpendingEvidenceSnapshot(fixture());
  assert.equal(snapshot.observations.length, 3);
  assert.deepEqual(assessSocialCardReadiness(snapshot, snapshot.observations[0]), []);
});

test("fails closed on unsupported evidence classifications", () => {
  const documented = fixture();
  documented.observations[0].classification = "documented_irregularity";
  documented.observations[0].evidenceStrength = "verified_official_record";
  assert.throws(() => assertPublicSpendingEvidenceSnapshot(documented), /accertamento ufficiale/);

  const noBenchmark = fixture();
  delete noBenchmark.observations[0].benchmark;
  assert.throws(() => assertPublicSpendingEvidenceSnapshot(noBenchmark), /benchmark riproducibile/);

  const incomplete = fixture();
  incomplete.observations[0].classification = "incomplete_or_not_comparable";
  assert.throws(() => assertPublicSpendingEvidenceSnapshot(incomplete), /non pubblicabile/);

  const unresolvedCohort = fixture();
  unresolvedCohort.observations[0].benchmark.observationIds[2] = "missing-observation";
  assert.throws(() => assertPublicSpendingEvidenceSnapshot(unresolvedCohort), /non risolto/);

  const falseMedian = fixture();
  falseMedian.observations[0].benchmark.medianCents += 1;
  assert.throws(() => assertPublicSpendingEvidenceSnapshot(falseMedian), /non riconciliate/);

  const wrongDimension = fixture();
  wrongDimension.observations[0].benchmark.category = "categoria-diversa";
  assert.throws(() => assertPublicSpendingEvidenceSnapshot(wrongDimension), /non riconciliate/);

  const memberDenominator = fixture();
  memberDenominator.observations[1].denominator.value = 2;
  assert.throws(() => assertPublicSpendingEvidenceSnapshot(memberDenominator), /non like-for-like/);

  const declaredDenominator = fixture();
  declaredDenominator.observations[0].benchmark.denominator.name = "unità arbitraria";
  assert.throws(() => assertPublicSpendingEvidenceSnapshot(declaredDenominator), /non riconciliate/);
});

test("keeps a zero-delta benchmark reference neutral and off social cards", () => {
  const snapshot = assertPublicSpendingEvidenceSnapshot(benchmarkReferenceFixture());
  const reference = snapshot.observations[2];

  assert.deepEqual(assessSocialCardReadiness(snapshot, reference), [
    "stato non pubblicabile",
    "riferimento benchmark non destinato a card",
  ]);

  const zeroDeltaAnomaly = benchmarkReferenceFixture();
  zeroDeltaAnomaly.observations[2].classification = "anomaly";
  zeroDeltaAnomaly.observations[2].evidenceStrength = "computed_from_verified_sources";
  zeroDeltaAnomaly.observations[2].publicationStatus = "publishable";
  assert.throws(
    () => assertPublicSpendingEvidenceSnapshot(zeroDeltaAnomaly),
    /delta zero non è un'anomalia/,
  );

  const publishableReference = benchmarkReferenceFixture();
  publishableReference.observations[2].publicationStatus = "publishable";
  assert.throws(
    () => assertPublicSpendingEvidenceSnapshot(publishableReference),
    /pubblicazione bloccata/,
  );
});

test("requires a verified legal basis for missing-transparency claims", () => {
  const snapshot = fixture();
  snapshot.observations[0].classification = "missing_transparency";
  delete snapshot.observations[0].transparencyGap;
  assert.throws(
    () => assertPublicSpendingEvidenceSnapshot(snapshot),
    /base normativa e pagina o record ufficiale verificato/,
  );

  const missingControlSource = fixture();
  missingControlSource.sources.push({
    id: "synthetic-legal-source",
    title: "Base normativa sintetica",
    publisher: "Ente dimostrativo",
    kind: "legal_basis",
    url: "https://example.test/norme/1",
    retrievedAt: "2026-01-31",
    scope: "Fixture sintetica",
    reuseStatus: "unknown",
  });
  missingControlSource.observations[0].classification = "missing_transparency";
  missingControlSource.observations[0].evidenceStrength = "verified_official_record";
  missingControlSource.observations[0].sourceIds = ["synthetic-legal-source"];
  missingControlSource.observations[0].transparencyGap = {
    missingItem: "Documento sintetico",
    legalBasisSourceId: "synthetic-legal-source",
    checkedOfficialSourceId: "synthetic-legal-source",
    checkedAt: "2026-01-31",
  };
  assert.throws(
    () => assertPublicSpendingEvidenceSnapshot(missingControlSource),
    /pagina o record ufficiale verificato/,
  );

  const datasetIsNotCheckedPage = fixture();
  datasetIsNotCheckedPage.sources[0].kind = "official_dataset";
  datasetIsNotCheckedPage.sources.push({
    id: "synthetic-legal-source",
    title: "Base normativa sintetica",
    publisher: "Ente dimostrativo",
    kind: "legal_basis",
    url: "https://example.test/norme/1",
    retrievedAt: "2026-01-31",
    scope: "Fixture sintetica",
    reuseStatus: "unknown",
  });
  datasetIsNotCheckedPage.observations[0].classification = "missing_transparency";
  datasetIsNotCheckedPage.observations[0].evidenceStrength = "verified_official_record";
  datasetIsNotCheckedPage.observations[0].sourceIds.push("synthetic-legal-source");
  datasetIsNotCheckedPage.observations[0].transparencyGap = {
    missingItem: "Documento sintetico",
    legalBasisSourceId: "synthetic-legal-source",
    checkedOfficialSourceId: "synthetic-record-source",
    checkedAt: "2026-01-31",
  };
  assert.throws(
    () => assertPublicSpendingEvidenceSnapshot(datasetIsNotCheckedPage),
    /pagina o record ufficiale verificato/,
  );
});

test("requires an official source for every denominator", () => {
  const unresolved = fixture();
  unresolved.observations[1].denominator.sourceId = "missing-source";
  assert.throws(
    () => assertPublicSpendingEvidenceSnapshot(unresolved),
    /fonte ufficiale del denominatore/,
  );

  const notLinked = fixture();
  notLinked.sources.push({
    id: "other-official-record",
    title: "Altro record ufficiale sintetico",
    publisher: "Ente dimostrativo",
    kind: "official_record",
    url: "https://example.test/atti/2",
    retrievedAt: "2026-01-31",
    scope: "Fixture sintetica",
    reuseStatus: "unknown",
  });
  notLinked.observations[1].denominator.sourceId = "other-official-record";
  assert.throws(
    () => assertPublicSpendingEvidenceSnapshot(notLinked),
    /fonte ufficiale del denominatore/,
  );

  const wrongRole = fixture();
  wrongRole.sources[0].kind = "legal_basis";
  assert.throws(
    () => assertPublicSpendingEvidenceSnapshot(wrongRole),
    /fonte ufficiale del denominatore/,
  );
});

test("blocks publication backed only by a legal basis", () => {
  const snapshot = fixture();
  snapshot.sources[0].kind = "legal_basis";
  snapshot.observations[0].classification = "documented_irregularity";
  snapshot.observations[0].evidenceStrength = "official_finding";
  assert.throws(
    () => assertPublicSpendingEvidenceSnapshot(snapshot),
    /fonte ufficiale richiesta per pubblicare/,
  );

  const parsed = structuredClone(snapshot.observations[0]);
  assert.ok(
    assessSocialCardReadiness(snapshot, parsed).includes(
      "fonte ufficiale per la pubblicazione non disponibile",
    ),
  );
});

test("requires distinct and role-appropriate sources at runtime", () => {
  const wrongRole = fixture();
  wrongRole.sources[0].kind = "legal_basis";
  assert.throws(() => assertPublicSpendingEvidenceSnapshot(wrongRole), /fonte ufficiale del dato/);

  const duplicateSource = fixture();
  duplicateSource.observations[0].sourceIds.push("synthetic-record-source");
  assert.throws(() => assertPublicSpendingEvidenceSnapshot(duplicateSource), /contiene duplicati/);

  const memberWithoutDataSource = fixture();
  memberWithoutDataSource.sources.push({
    id: "synthetic-legal-source",
    title: "Base normativa sintetica",
    publisher: "Ente dimostrativo",
    kind: "legal_basis",
    url: "https://example.test/norme/1",
    retrievedAt: "2026-01-31",
    scope: "Fixture sintetica",
    reuseStatus: "unknown",
  });
  memberWithoutDataSource.observations[1].sourceIds = ["synthetic-legal-source"];
  assert.throws(
    () => assertPublicSpendingEvidenceSnapshot(memberWithoutDataSource),
    /fonte ufficiale richiesta per ogni membro/,
  );

  assert.deepEqual(assessSocialCardReadiness(wrongRole, wrongRole.observations[0]), [
    "fonte ufficiale del denominatore non disponibile",
    "fonte ufficiale per la pubblicazione non disponibile",
    "fonte ufficiale del dato non disponibile",
  ]);
});

test("requires explicit provenance for text-derived procurement methods", () => {
  const snapshot = fixture();
  snapshot.observations[0].procurementMethod = {
    value: "direct_award",
    provenance: "text_derived",
  };
  assert.throws(
    () => assertPublicSpendingEvidenceSnapshot(snapshot),
    /regola versionata e confidenza/,
  );

  const invalidDate = fixture();
  invalidDate.observations[0].period.start = "2026-02-31";
  assert.throws(() => assertPublicSpendingEvidenceSnapshot(invalidDate), /calendario non valida/);
});

test("computes transparent R7 quantiles and target delta", () => {
  const benchmark = computePublicSpendingBenchmark({
    cohortId: "synthetic-cohort",
    cohortLabel: "Quattro record sintetici omogenei",
    targetObservationId: "synthetic-4",
    members: benchmarkMembers(),
  });

  assert.equal(benchmark.medianCents, 110_000);
  assert.equal(benchmark.p25Cents, 95_000);
  assert.equal(benchmark.p75Cents, 125_000);
  assert.equal(benchmark.targetDeltaCents, 30_000);
  assert.equal(benchmark.targetDeltaPercent, (30_000 / 110_000) * 100);
});

test("rejects cohorts that are not like-for-like", () => {
  const members = benchmarkMembers();
  members[3].taxBasis = "gross";
  assert.throws(
    () => computePublicSpendingBenchmark({
      cohortId: "synthetic-cohort",
      cohortLabel: "Coorte incoerente",
      targetObservationId: "synthetic-4",
      members,
    }),
    /non like-for-like/,
  );
});

test("social cards stay blocked when material fields are missing", () => {
  const snapshot = assertPublicSpendingEvidenceSnapshot(fixture());
  const observation = structuredClone(snapshot.observations[0]);
  observation.amount = null;
  observation.publicationStatus = "draft";
  observation.evidenceStrength = "unverified";
  delete observation.benchmark;

  assert.deepEqual(assessSocialCardReadiness(snapshot, observation), [
    "stato non pubblicabile",
    "importo non disponibile",
    "benchmark non disponibile",
    "evidenza non verificata",
  ]);
});
