import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import "./helpers/register-ts-alias.mjs";

const {
  assertStroppaArchiveManifest,
  assertStroppaEvidenceSnapshot,
} = await import("../src/lib/data/stroppa-evidence-contract.ts");
const { computeLikeForLikeBenchmark } = await import(
  "../src/lib/data/stroppa-benchmark.ts"
);

const comparability = {
  categoryTaxonomy: "fixture-v1",
  categoryValue: "servizio-test",
  periodKey: "2025",
  periodPrecision: "exact_day",
  amountPhase: "award",
  taxTreatment: "net",
  unit: "total",
  procurementScope: "direct-award-fixture",
  geography: null,
};

function snapshot() {
  return {
    schemaVersion: 1,
    transformVersion: 1,
    generatedAt: "2026-08-22T12:00:00Z",
    subjects: [
      {
        id: "subject:test",
        kind: "award",
        displayName: "Affidamento test",
        identifiers: [
          {
            scheme: "cig",
            value: "B000000001",
            sourceId: "source:official",
            validFrom: null,
            validTo: null,
          },
        ],
        personalDataPublication: "not_personal",
      },
    ],
    sources: [
      {
        id: "source:official",
        role: "official_primary",
        verification: "verified",
        publisher: "Ente test",
        title: "Atto test",
        url: "https://example.test/atto",
        locator: "B000000001",
        publishedAt: "2025-03-10",
        observedAt: "2026-08-22T12:00:00Z",
        sha256: null,
        licenseOrReuse: "Fixture sintetica, nessun dato reale",
      },
      {
        id: "source:package",
        role: "package_input",
        verification: "package_only_unverified",
        publisher: "Pacchetto test",
        title: "Riga test",
        url: null,
        locator: "fixture:2",
        publishedAt: null,
        observedAt: "2026-08-22T12:00:00Z",
        sha256: null,
        licenseOrReuse: null,
      },
    ],
    observations: [
      {
        id: "observation:test",
        topic: "direct_award",
        subjectId: "subject:test",
        sourceIds: ["source:official", "source:package"],
        what: "Servizio test",
        amount: {
          cents: 15_000,
          currency: "EUR",
          phase: "award",
          taxTreatment: "net",
          unit: "total",
        },
        period: {
          kind: "award",
          start: "2025-03-10",
          end: "2025-03-10",
          referenceYear: 2025,
          coverage: "complete",
          sourcePrecision: "exact_day",
        },
        procurement: {
          sourceLabel: null,
          normalized: "direct_award",
          classification: {
            origin: "text_derived",
            sourceField: "oggetto",
            ruleVersion: "stroppa-direct-award-text-v1",
            confidence: "high",
            matchedRule: "affidamento diretto",
          },
          cig: "B000000001",
          ocid: null,
          cpv: null,
          awardStatus: "awarded",
          ruleVersionId: "rule:direct-award-2025",
        },
        caveats: ["Fixture sintetica"],
      },
    ],
    benchmarkCohorts: [
      {
        id: "cohort:test",
        metricVersion: 1,
        comparability,
        status: "verified",
        denominator: {
          label: "Cinque record sintetici",
          candidateRecords: 6,
          includedRecords: 5,
          excludedByReason: { "base-diversa": 1 },
        },
        summary: {
          quantileConvention: "linear_interpolation_r7",
          minimumCohortSize: 5,
          count: 5,
          medianCents: 10_000,
          p25Cents: 9_000,
          p75Cents: 11_000,
          p90Cents: 11_600,
        },
        formulaVersion: "median-delta-v1",
        sourceIds: ["source:official"],
        inputFingerprint: "a".repeat(64),
      },
    ],
    benchmarks: [
      {
        id: "benchmark:test",
        observationId: "observation:test",
        cohortId: "cohort:test",
        observedCents: 15_000,
        medianCents: 10_000,
        deltaCents: 5_000,
        relativeDeltaBasisPoints: 5_000,
        formula: "observedCents - medianCents",
      },
    ],
    assessments: [
      {
        id: "assessment:test",
        observationId: "observation:test",
        classification: "benchmark_deviation",
        strength: "reproduced_computation",
        benchmarkId: "benchmark:test",
      },
    ],
    publicationChecks: [],
    shareCards: [
      {
        id: "card:test",
        assessmentId: "assessment:test",
        sourceIds: ["source:official"],
        publicationStatus: "publishable",
        title: "Confronto test",
        spender: "Ente test",
        what: "Servizio test",
        amountLabel: "150 euro",
        periodLabel: "10 marzo 2025",
        benchmarkLabel: "Mediana 100 euro, 5 record",
        evidenceLabel: "Confronto riproducibile",
        caveat: "Il confronto non prova spreco o illecito.",
      },
    ],
  };
}

test("committed Stroppa archive manifest is compact, hash-bound and selective", () => {
  const value = JSON.parse(
    readFileSync(
      new URL("../scripts/etl/specs/stroppa-package.manifest.json", import.meta.url),
      "utf8",
    ),
  );
  const manifest = assertStroppaArchiveManifest(value);
  assert.equal(manifest.archiveSizeBytes, 10_139_244_307);
  assert.equal(manifest.extractionPolicy, "listing-and-selective-extraction-only");
  assert.equal(manifest.selectedEntries.length, 9);
  assert.ok(manifest.selectedEntries.every((entry) => entry.sizeBytes < 5_000_000));

  const traversal = structuredClone(value);
  traversal.selectedEntries[0].path = "../raw-dump.tsv";
  assert.throws(() => assertStroppaArchiveManifest(traversal), /path archivio non sicuro/);

  const invalidDate = structuredClone(value);
  invalidDate.selectedEntries[0].dataDate = "2025-02-30";
  assert.throws(() => assertStroppaArchiveManifest(invalidDate), /data ISO non valida/);
});

test("evidence contract reconciles a verified benchmark and materialized card", () => {
  const checked = assertStroppaEvidenceSnapshot(snapshot());
  assert.equal(checked.assessments[0].classification, "benchmark_deviation");
  assert.equal(checked.observations[0].procurement.classification.origin, "text_derived");
  assert.equal(checked.observations[0].period.sourcePrecision, "exact_day");
});

test("package-only evidence and coarse dates cannot become benchmark cards", () => {
  const packageOnly = snapshot();
  packageOnly.shareCards[0].sourceIds = ["source:package"];
  assert.throws(() => assertStroppaEvidenceSnapshot(packageOnly), /fonte ufficiale verificata/);

  const coarse = snapshot();
  coarse.observations[0].period.sourcePrecision = "possible_year_default";
  assert.throws(() => assertStroppaEvidenceSnapshot(coarse), /precisione temporale insufficiente/);

  const mixedAmountBasis = snapshot();
  mixedAmountBasis.observations[0].amount.taxTreatment = "gross";
  assert.throws(() => assertStroppaEvidenceSnapshot(mixedAmountBasis), /base importo non like-for-like/);
});

test("documented irregularity and transparency missing fail closed", () => {
  const irregularity = snapshot();
  irregularity.assessments = [
    {
      id: "assessment:test",
      observationId: "observation:test",
      classification: "documented_irregularity",
      strength: "official_finding",
      findingSourceId: "source:package",
      authority: "Autorità test",
      officialQualification: "Qualificazione test",
      proceduralStatus: "not_declared",
    },
  ];
  irregularity.shareCards[0].publicationStatus = "withheld";
  assert.throws(() => assertStroppaEvidenceSnapshot(irregularity), /atto ufficiale qualificante/);

  const detachedBenchmark = snapshot();
  detachedBenchmark.assessments[0].observationId = "observation:missing";
  detachedBenchmark.shareCards[0].publicationStatus = "withheld";
  assert.throws(() => assertStroppaEvidenceSnapshot(detachedBenchmark), /benchmark mancante o non collegato/);

  const missing = snapshot();
  missing.publicationChecks = [
    {
      id: "check:test",
      observationId: "observation:test",
      state: "checked_not_found",
      expectedDocumentOrField: "Documento test",
      legalBasis: null,
      checkedAt: null,
      checkedOfficialLocations: [],
    },
  ];
  missing.assessments = [
    {
      id: "assessment:test",
      observationId: "observation:test",
      classification: "transparency_missing",
      strength: "verified_publication_check",
      publicationCheckId: "check:test",
    },
  ];
  missing.shareCards[0].publicationStatus = "withheld";
  assert.throws(() => assertStroppaEvidenceSnapshot(missing), /mancanza non verificata/);
});

test("like-for-like benchmark uses R7 quantiles and rejects mixed bases", () => {
  const observed = { id: "observed", amountCents: 15_000, comparability };
  const cohort = [8_000, 9_000, 10_000, 11_000, 12_000].map((amountCents, index) => ({
    id: `cohort-${index}`,
    amountCents,
    comparability,
  }));
  const result = computeLikeForLikeBenchmark(observed, cohort);
  assert.deepEqual(
    {
      median: result.medianCents,
      p25: result.p25Cents,
      p75: result.p75Cents,
      p90: result.p90Cents,
      delta: result.deltaCents,
      relative: result.relativeDeltaBasisPoints,
    },
    { median: 10_000, p25: 9_000, p75: 11_000, p90: 11_600, delta: 5_000, relative: 5_000 },
  );

  const mixed = structuredClone(cohort);
  mixed[0].comparability.taxTreatment = "gross";
  assert.throws(() => computeLikeForLikeBenchmark(observed, mixed), /non like-for-like/);
  assert.throws(() => computeLikeForLikeBenchmark(observed, cohort.slice(0, 3)), /soglia minima/);
});
