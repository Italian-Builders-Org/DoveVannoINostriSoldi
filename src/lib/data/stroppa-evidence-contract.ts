import { z } from "zod";

const id = z.string().trim().regex(/^[a-z0-9][a-z0-9:._-]*$/);
const nonEmptyText = z.string().trim().min(1);
const cents = z.number().int().nonnegative().max(Number.MAX_SAFE_INTEGER);
const isoDate = z.string().regex(/^\d{4}-\d{2}-\d{2}$/).refine(
  (value) => {
    const parsed = new Date(`${value}T00:00:00Z`);
    return !Number.isNaN(parsed.valueOf()) && parsed.toISOString().slice(0, 10) === value;
  },
  "data ISO non valida",
);
const isoTimestamp = z.string().datetime({ offset: true });
const sha256 = z.string().regex(/^[a-f0-9]{64}$/);
const httpsUrl = z.url().refine((value) => value.startsWith("https://"), "URL HTTPS atteso");

export const stroppaEvidenceSourceSchema = z.object({
  id,
  role: z.enum(["official_primary", "official_finding", "package_input", "derived_methodology"]),
  verification: z.enum(["verified", "package_only_unverified", "not_reproducible"]),
  publisher: nonEmptyText,
  title: nonEmptyText,
  url: httpsUrl.nullable(),
  locator: nonEmptyText.nullable(),
  publishedAt: isoDate.nullable(),
  observedAt: isoTimestamp,
  sha256: sha256.nullable(),
  licenseOrReuse: nonEmptyText.nullable(),
});

const subjectIdentifierSchema = z.object({
  scheme: z.enum(["ipa", "cig", "cup", "ocid", "tax_id", "native"]),
  value: nonEmptyText,
  sourceId: id,
  validFrom: isoDate.nullable(),
  validTo: isoDate.nullable(),
});

const subjectSchema = z.object({
  id,
  kind: z.enum(["administration", "contract", "award", "supplier", "service", "person"]),
  displayName: nonEmptyText,
  identifiers: z.array(subjectIdentifierSchema),
  personalDataPublication: z.enum(["not_personal", "necessary_public_role", "excluded"]),
});

const amountSchema = z.object({
  cents,
  currency: z.literal("EUR"),
  phase: z.enum(["award", "contract", "payment", "fee", "budget"]),
  taxTreatment: z.enum(["net", "gross", "unknown", "not_applicable"]),
  unit: z.enum(["total", "per_year", "per_month", "per_unit", "per_person", "per_day"]),
});

const periodSchema = z.object({
  kind: z.enum(["award", "contract", "payment", "assignment", "publication", "reference"]),
  start: isoDate.nullable(),
  end: isoDate.nullable(),
  referenceYear: z.number().int().min(1900).max(2200).nullable(),
  coverage: z.enum(["complete", "partial", "unknown"]),
  sourcePrecision: z.enum(["exact_day", "month_only", "year_only", "possible_year_default", "unknown"]),
}).superRefine((period, context) => {
  if (period.start && period.end && period.start > period.end) {
    context.addIssue({ code: "custom", message: "periodo invertito" });
  }
  if (!period.start && !period.end && period.referenceYear === null) {
    context.addIssue({ code: "custom", message: "periodo senza data o anno" });
  }
});

const procurementSchema = z.object({
  sourceLabel: nonEmptyText.nullable(),
  normalized: z.enum(["direct_award", "open", "negotiated", "other", "unknown"]),
  classification: z.discriminatedUnion("origin", [
    z.object({
      origin: z.literal("source_field"),
      sourceField: nonEmptyText,
      ruleVersion: z.null(),
      confidence: z.literal("source_declared"),
    }),
    z.object({
      origin: z.literal("text_derived"),
      sourceField: z.literal("oggetto"),
      ruleVersion: nonEmptyText,
      confidence: z.enum(["high", "medium", "low"]),
      matchedRule: nonEmptyText,
    }),
  ]),
  cig: nonEmptyText.nullable(),
  ocid: nonEmptyText.nullable(),
  cpv: nonEmptyText.nullable(),
  awardStatus: z.enum(["awarded", "not_awarded", "unknown"]),
  ruleVersionId: id.nullable(),
});

const observationSchema = z.object({
  id,
  topic: z.enum(["direct_award", "consulting", "legal_consulting", "event", "advertising"]),
  subjectId: id,
  sourceIds: z.array(id).min(1),
  what: nonEmptyText,
  amount: amountSchema.nullable(),
  period: periodSchema,
  procurement: procurementSchema.nullable(),
  caveats: z.array(nonEmptyText),
});

export const benchmarkComparabilitySchema = z.object({
  categoryTaxonomy: nonEmptyText,
  categoryValue: nonEmptyText,
  periodKey: nonEmptyText,
  periodPrecision: z.enum(["exact_day", "month_only", "year_only"]),
  amountPhase: amountSchema.shape.phase,
  taxTreatment: amountSchema.shape.taxTreatment,
  unit: amountSchema.shape.unit,
  procurementScope: nonEmptyText,
  geography: nonEmptyText.nullable(),
});

const benchmarkCohortSchema = z.object({
  id,
  metricVersion: z.number().int().positive(),
  comparability: benchmarkComparabilitySchema,
  status: z.enum(["verified", "not_comparable"]),
  denominator: z.object({
    label: nonEmptyText,
    candidateRecords: z.number().int().nonnegative(),
    includedRecords: z.number().int().nonnegative(),
    excludedByReason: z.record(nonEmptyText, z.number().int().nonnegative()),
  }),
  summary: z.object({
    quantileConvention: z.literal("linear_interpolation_r7"),
    minimumCohortSize: z.number().int().min(4),
    count: z.number().int().nonnegative(),
    medianCents: cents.nullable(),
    p25Cents: cents.nullable(),
    p75Cents: cents.nullable(),
    p90Cents: cents.nullable(),
  }),
  formulaVersion: nonEmptyText,
  sourceIds: z.array(id).min(1),
  inputFingerprint: sha256,
}).superRefine((cohort, context) => {
  const excluded = Object.values(cohort.denominator.excludedByReason).reduce(
    (sum, value) => sum + value,
    0,
  );
  if (cohort.denominator.includedRecords + excluded !== cohort.denominator.candidateRecords) {
    context.addIssue({ code: "custom", message: "denominatore non riconciliato" });
  }
  if (cohort.summary.count !== cohort.denominator.includedRecords) {
    context.addIssue({ code: "custom", message: "conteggio coorte non riconciliato" });
  }
  const hasSummary = cohort.summary.medianCents !== null;
  if (cohort.status === "verified") {
    if (cohort.summary.count < cohort.summary.minimumCohortSize || !hasSummary) {
      context.addIssue({ code: "custom", message: "coorte verificata sotto la soglia minima" });
    }
  } else if ([cohort.summary.medianCents, cohort.summary.p25Cents, cohort.summary.p75Cents, cohort.summary.p90Cents].some((value) => value !== null)) {
    context.addIssue({ code: "custom", message: "coorte non comparabile con statistiche pubblicabili" });
  }
});

const benchmarkSchema = z.object({
  id,
  observationId: id,
  cohortId: id,
  observedCents: cents,
  medianCents: cents,
  deltaCents: z.number().int().min(-Number.MAX_SAFE_INTEGER).max(Number.MAX_SAFE_INTEGER),
  relativeDeltaBasisPoints: z.number().int().min(-Number.MAX_SAFE_INTEGER).max(Number.MAX_SAFE_INTEGER).nullable(),
  formula: z.literal("observedCents - medianCents"),
});

const legalBasisSchema = z.object({
  provision: nonEmptyText,
  officialUrl: httpsUrl,
  verifiedAt: isoDate,
  applicability: nonEmptyText,
});

const publicationCheckSchema = z.object({
  id,
  observationId: id,
  state: z.enum(["published", "checked_not_found", "not_applicable", "not_checked"]),
  expectedDocumentOrField: nonEmptyText,
  legalBasis: legalBasisSchema.nullable(),
  checkedAt: isoDate.nullable(),
  checkedOfficialLocations: z.array(id),
});

const assessmentSchema = z.discriminatedUnion("classification", [
  z.object({
    id,
    observationId: id,
    classification: z.literal("documented_irregularity"),
    strength: z.literal("official_finding"),
    findingSourceId: id,
    authority: nonEmptyText,
    officialQualification: nonEmptyText,
    proceduralStatus: z.enum(["final", "not_final", "not_declared"]),
  }),
  z.object({
    id,
    observationId: id,
    classification: z.literal("benchmark_deviation"),
    strength: z.literal("reproduced_computation"),
    benchmarkId: id,
  }),
  z.object({
    id,
    observationId: id,
    classification: z.literal("transparency_missing"),
    strength: z.literal("verified_publication_check"),
    publicationCheckId: id,
  }),
  z.object({
    id,
    observationId: id,
    classification: z.literal("incomplete_or_not_comparable"),
    strength: z.enum(["package_only_unverified", "insufficient_evidence"]),
    reasons: z.array(nonEmptyText).min(1),
  }),
]);

const shareCardSchema = z.object({
  id,
  assessmentId: id,
  sourceIds: z.array(id).min(1),
  publicationStatus: z.enum(["publishable", "withheld"]),
  title: nonEmptyText,
  spender: nonEmptyText,
  what: nonEmptyText,
  amountLabel: nonEmptyText,
  periodLabel: nonEmptyText,
  benchmarkLabel: nonEmptyText.nullable(),
  evidenceLabel: nonEmptyText,
  caveat: nonEmptyText,
});

export const stroppaEvidenceSnapshotSchema = z.object({
  schemaVersion: z.literal(1),
  transformVersion: z.literal(1),
  generatedAt: isoTimestamp,
  subjects: z.array(subjectSchema),
  sources: z.array(stroppaEvidenceSourceSchema),
  observations: z.array(observationSchema),
  benchmarkCohorts: z.array(benchmarkCohortSchema),
  benchmarks: z.array(benchmarkSchema),
  assessments: z.array(assessmentSchema),
  publicationChecks: z.array(publicationCheckSchema),
  shareCards: z.array(shareCardSchema),
}).superRefine((snapshot, context) => {
  const collections = [
    ["subjects", snapshot.subjects],
    ["sources", snapshot.sources],
    ["observations", snapshot.observations],
    ["benchmarkCohorts", snapshot.benchmarkCohorts],
    ["benchmarks", snapshot.benchmarks],
    ["assessments", snapshot.assessments],
    ["publicationChecks", snapshot.publicationChecks],
    ["shareCards", snapshot.shareCards],
  ] as const;
  for (const [name, items] of collections) {
    const ids = items.map((item) => item.id);
    if (new Set(ids).size !== ids.length) {
      context.addIssue({ code: "custom", message: `${name}: ID duplicati` });
    }
    if (ids.some((value, index) => index > 0 && value <= ids[index - 1])) {
      context.addIssue({ code: "custom", message: `${name}: ordine canonico atteso` });
    }
  }

  const sources = new Map(snapshot.sources.map((item) => [item.id, item]));
  const subjects = new Set(snapshot.subjects.map((item) => item.id));
  const observations = new Map(snapshot.observations.map((item) => [item.id, item]));
  const cohorts = new Map(snapshot.benchmarkCohorts.map((item) => [item.id, item]));
  const benchmarks = new Map(snapshot.benchmarks.map((item) => [item.id, item]));
  const checks = new Map(snapshot.publicationChecks.map((item) => [item.id, item]));
  const assessments = new Map(snapshot.assessments.map((item) => [item.id, item]));

  for (const subject of snapshot.subjects) {
    for (const identifier of subject.identifiers) {
      if (!sources.has(identifier.sourceId)) context.addIssue({ code: "custom", message: `${subject.id}: fonte identificatore mancante` });
      if (identifier.validFrom && identifier.validTo && identifier.validFrom > identifier.validTo) {
        context.addIssue({ code: "custom", message: `${subject.id}: validità identificatore invertita` });
      }
    }
  }
  for (const observation of snapshot.observations) {
    if (!subjects.has(observation.subjectId)) context.addIssue({ code: "custom", message: `${observation.id}: soggetto mancante` });
    for (const sourceId of observation.sourceIds) {
      if (!sources.has(sourceId)) context.addIssue({ code: "custom", message: `${observation.id}: fonte mancante` });
    }
  }
  for (const cohort of snapshot.benchmarkCohorts) {
    for (const sourceId of cohort.sourceIds) {
      if (!sources.has(sourceId)) context.addIssue({ code: "custom", message: `${cohort.id}: fonte mancante` });
    }
  }
  for (const benchmark of snapshot.benchmarks) {
    const observation = observations.get(benchmark.observationId);
    const cohort = cohorts.get(benchmark.cohortId);
    if (!observation || !cohort) {
      context.addIssue({ code: "custom", message: `${benchmark.id}: riferimento mancante` });
      continue;
    }
    if (cohort.status !== "verified") context.addIssue({ code: "custom", message: `${benchmark.id}: coorte non verificata` });
    if (observation.period.sourcePrecision === "possible_year_default" || observation.period.sourcePrecision === "unknown") {
      context.addIssue({ code: "custom", message: `${benchmark.id}: precisione temporale insufficiente` });
    }
    const observationPrecision = observation.period.sourcePrecision === "month_only"
      ? "month_only"
      : observation.period.sourcePrecision === "year_only"
        ? "year_only"
        : "exact_day";
    if (cohort.comparability.periodPrecision !== observationPrecision) {
      context.addIssue({ code: "custom", message: `${benchmark.id}: precisione temporale non like-for-like` });
    }
    if (!observation.amount || observation.amount.cents !== benchmark.observedCents) {
      context.addIssue({ code: "custom", message: `${benchmark.id}: importo osservato non riconciliato` });
    } else if (
      observation.amount.phase !== cohort.comparability.amountPhase
      || observation.amount.taxTreatment !== cohort.comparability.taxTreatment
      || observation.amount.unit !== cohort.comparability.unit
    ) {
      context.addIssue({ code: "custom", message: `${benchmark.id}: base importo non like-for-like` });
    }
    if (cohort.summary.medianCents !== benchmark.medianCents) context.addIssue({ code: "custom", message: `${benchmark.id}: mediana non riconciliata` });
    const expectedDelta = benchmark.observedCents - benchmark.medianCents;
    const expectedRelative = benchmark.medianCents > 0
      ? Math.round((10_000 * expectedDelta) / benchmark.medianCents)
      : null;
    if (benchmark.deltaCents !== expectedDelta || benchmark.relativeDeltaBasisPoints !== expectedRelative) {
      context.addIssue({ code: "custom", message: `${benchmark.id}: delta non riconciliato` });
    }
  }
  for (const check of snapshot.publicationChecks) {
    if (!observations.has(check.observationId)) context.addIssue({ code: "custom", message: `${check.id}: osservazione mancante` });
    if (check.state === "checked_not_found" && (!check.legalBasis || !check.checkedAt || check.checkedOfficialLocations.length === 0)) {
      context.addIssue({ code: "custom", message: `${check.id}: mancanza non verificata` });
    }
    for (const sourceId of check.checkedOfficialLocations) {
      const source = sources.get(sourceId);
      if (!source || source.role !== "official_primary" || source.verification !== "verified") {
        context.addIssue({ code: "custom", message: `${check.id}: luogo ufficiale non verificato` });
      }
    }
  }
  for (const assessment of snapshot.assessments) {
    if (!observations.has(assessment.observationId)) context.addIssue({ code: "custom", message: `${assessment.id}: osservazione mancante` });
    if (assessment.classification === "documented_irregularity") {
      const source = sources.get(assessment.findingSourceId);
      const observation = observations.get(assessment.observationId);
      if (!source || source.role !== "official_finding" || source.verification !== "verified") {
        context.addIssue({ code: "custom", message: `${assessment.id}: atto ufficiale qualificante mancante` });
      }
      if (!observation?.sourceIds.includes(assessment.findingSourceId)) {
        context.addIssue({ code: "custom", message: `${assessment.id}: atto ufficiale non collegato all'osservazione` });
      }
    }
    if (assessment.classification === "benchmark_deviation") {
      const benchmark = benchmarks.get(assessment.benchmarkId);
      if (!benchmark || benchmark.observationId !== assessment.observationId) {
        context.addIssue({ code: "custom", message: `${assessment.id}: benchmark mancante o non collegato` });
      }
    }
    if (assessment.classification === "transparency_missing") {
      const check = checks.get(assessment.publicationCheckId);
      if (!check || check.state !== "checked_not_found" || check.observationId !== assessment.observationId) {
        context.addIssue({ code: "custom", message: `${assessment.id}: controllo pubblicazione insufficiente o non collegato` });
      }
    }
  }
  for (const card of snapshot.shareCards) {
    const assessment = assessments.get(card.assessmentId);
    if (!assessment) {
      context.addIssue({ code: "custom", message: `${card.id}: valutazione mancante` });
      continue;
    }
    const observation = observations.get(assessment.observationId);
    if (!observation || card.sourceIds.some((sourceId) => !observation.sourceIds.includes(sourceId))) {
      context.addIssue({ code: "custom", message: `${card.id}: fonti non riconciliate con l'osservazione` });
    }
    if (assessment.classification === "benchmark_deviation" && card.benchmarkLabel === null) {
      context.addIssue({ code: "custom", message: `${card.id}: benchmark leggibile mancante` });
    }
    const cardSources = card.sourceIds.map((sourceId) => sources.get(sourceId));
    if (cardSources.some((source) => !source)) context.addIssue({ code: "custom", message: `${card.id}: fonte mancante` });
    const hasVerifiedOfficialSource = cardSources.some((source) => source?.verification === "verified" && (source.role === "official_primary" || source.role === "official_finding"));
    if (card.publicationStatus === "publishable" && !hasVerifiedOfficialSource) {
      context.addIssue({ code: "custom", message: `${card.id}: card pubblicabile senza fonte ufficiale verificata` });
    }
    if (card.publicationStatus === "publishable" && assessment.classification === "incomplete_or_not_comparable" && assessment.strength === "package_only_unverified") {
      context.addIssue({ code: "custom", message: `${card.id}: il solo pacchetto non abilita la pubblicazione` });
    }
  }
});

const archiveEntrySchema = z.object({
  path: nonEmptyText.refine(
    (value) => {
      const segments = value.split("/");
      return !value.startsWith("/")
        && !value.includes("\\")
        && segments.every((segment) => segment !== "" && segment !== "." && segment !== "..");
    },
    "path archivio non sicuro",
  ),
  sizeBytes: z.number().int().nonnegative(),
  sha256: sha256.nullable(),
  role: z.enum(["raw", "source", "derived", "final", "draft", "backup", "note", "qc", "stub"]),
  sensitivity: z.enum(["public", "public_personal_data", "potential_personal_data", "unknown"]),
  licenseStatus: z.enum(["verified", "declared_unknown", "not_found", "not_applicable"]),
  sourceUrl: httpsUrl.nullable(),
  dataDate: isoDate.nullable(),
  scope: nonEmptyText,
  validationStatus: z.enum(["validated", "partial", "failed", "not_checked"]),
});

export const stroppaArchiveManifestSchema = z.object({
  schemaVersion: z.literal(1),
  archiveBasename: z.literal("spesa-pa-voce-2026-08-21.tar.gz"),
  archiveSizeBytes: z.number().int().positive(),
  archiveSha256: sha256,
  observedAt: isoTimestamp,
  extractionPolicy: z.literal("listing-and-selective-extraction-only"),
  selectedEntries: z.array(archiveEntrySchema),
}).superRefine((manifest, context) => {
  const paths = manifest.selectedEntries.map((entry) => entry.path);
  if (new Set(paths).size !== paths.length) context.addIssue({ code: "custom", message: "manifest: path duplicati" });
  if (paths.some((value, index) => index > 0 && value <= paths[index - 1])) context.addIssue({ code: "custom", message: "manifest: ordine canonico atteso" });
});

export type StroppaEvidenceSnapshot = z.infer<typeof stroppaEvidenceSnapshotSchema>;
export type StroppaArchiveManifest = z.infer<typeof stroppaArchiveManifestSchema>;
export type BenchmarkComparability = z.infer<typeof benchmarkComparabilitySchema>;

function parsed<T>(result: z.ZodSafeParseResult<T>, name: string): T {
  if (!result.success) {
    throw new Error(`${name}: ${result.error.issues.map((issue) => issue.message).join("; ")}`);
  }
  return result.data;
}

export function assertStroppaEvidenceSnapshot(value: unknown): StroppaEvidenceSnapshot {
  return parsed(stroppaEvidenceSnapshotSchema.safeParse(value), "stroppa evidence snapshot");
}

export function assertStroppaArchiveManifest(value: unknown): StroppaArchiveManifest {
  return parsed(stroppaArchiveManifestSchema.safeParse(value), "stroppa archive manifest");
}
