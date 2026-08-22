import { z } from "zod";
import { computePublicSpendingBenchmark } from "@/lib/data/public-spending-benchmark";

const isoDate = z.string().regex(/^\d{4}-\d{2}-\d{2}$/, "data ISO YYYY-MM-DD attesa").refine((value) => {
  const date = new Date(`${value}T00:00:00Z`);
  return !Number.isNaN(date.getTime()) && date.toISOString().startsWith(value);
}, "data di calendario non valida");
const httpUrl = z.url().refine((value) => {
  const protocol = new URL(value).protocol;
  return protocol === "https:" || protocol === "http:";
}, "URL HTTP(S) atteso");

export const sourceSchema = z.object({
  id: z.string().min(1),
  title: z.string().min(1),
  publisher: z.string().min(1),
  kind: z.enum(["official_record", "official_dataset", "official_finding", "legal_basis"]),
  url: httpUrl,
  identifier: z.string().min(1).optional(),
  publishedAt: isoDate.optional(),
  retrievedAt: isoDate,
  scope: z.string().min(1),
  reuseStatus: z.enum(["verified", "restricted", "unknown"]),
});

export const subjectSchema = z.object({
  spendingEntity: z.object({
    name: z.string().min(1),
    identifier: z.string().min(1).optional(),
  }),
  counterparty: z.object({
    name: z.string().min(1),
    identifier: z.string().min(1).optional(),
  }).optional(),
});

export const amountSchema = z.object({
  valueCents: z.number().int().nonnegative().safe(),
  currency: z.literal("EUR"),
  taxBasis: z.enum(["net", "gross", "not_stated"]),
  unit: z.enum(["award_total", "paid_total", "annual_total", "per_capita"]),
});

export const periodSchema = z.object({
  start: isoDate,
  end: isoDate,
  precision: z.enum(["day", "month", "year"]),
}).superRefine((period, context) => {
  if (period.end < period.start) {
    context.addIssue({ code: "custom", message: "period.end precede period.start", path: ["end"] });
  }
});

export const procurementMethodSchema = z.object({
  value: z.enum(["direct_award", "open_procedure", "restricted_procedure", "other", "unknown"]),
  provenance: z.enum(["source_explicit", "text_derived", "not_available"]),
  ruleVersion: z.string().min(1).optional(),
  confidence: z.enum(["high", "medium", "low"]).optional(),
}).superRefine((method, context) => {
  if (method.provenance === "text_derived" && (!method.ruleVersion || !method.confidence)) {
    context.addIssue({
      code: "custom",
      message: "una classificazione derivata richiede regola versionata e confidenza",
    });
  }
  if (method.provenance === "not_available" && method.value !== "unknown") {
    context.addIssue({ code: "custom", message: "metodo non disponibile deve avere valore unknown" });
  }
});

export const denominatorSchema = z.object({
  name: z.string().min(1),
  value: z.number().positive().finite(),
  unit: z.string().min(1),
});

export const sourcedDenominatorSchema = denominatorSchema.extend({
  sourceId: z.string().min(1),
});

export const benchmarkSchema = z.object({
  cohortId: z.string().min(1),
  cohortLabel: z.string().min(1),
  category: z.string().min(1),
  period: periodSchema,
  taxBasis: amountSchema.shape.taxBasis,
  unit: amountSchema.shape.unit,
  denominator: denominatorSchema,
  method: z.literal("linear_interpolation_r7"),
  cohortSize: z.number().int().min(3),
  medianCents: z.number().nonnegative().finite(),
  p25Cents: z.number().nonnegative().finite(),
  p75Cents: z.number().nonnegative().finite(),
  targetDeltaCents: z.number().finite(),
  targetDeltaPercent: z.number().finite().nullable(),
  observationIds: z.array(z.string().min(1)).min(3),
}).superRefine((benchmark, context) => {
  if (benchmark.observationIds.length !== benchmark.cohortSize) {
    context.addIssue({ code: "custom", message: "cohortSize non coincide con observationIds" });
  }
  if (new Set(benchmark.observationIds).size !== benchmark.observationIds.length) {
    context.addIssue({ code: "custom", message: "observationIds contiene duplicati" });
  }
  if (benchmark.p25Cents > benchmark.medianCents || benchmark.medianCents > benchmark.p75Cents) {
    context.addIssue({ code: "custom", message: "quantili benchmark non ordinati" });
  }
});

export const observationSchema = z.object({
  id: z.string().min(1),
  observedAt: isoDate,
  title: z.string().min(1),
  category: z.string().min(1),
  subject: subjectSchema,
  amount: amountSchema.nullable(),
  denominator: sourcedDenominatorSchema,
  period: periodSchema,
  procurementMethod: procurementMethodSchema,
  sourceIds: z.array(z.string().min(1)).min(1),
  classification: z.enum([
    "documented_irregularity",
    "anomaly",
    "missing_transparency",
    "incomplete_or_not_comparable",
  ]),
  evidenceStrength: z.enum([
    "official_finding",
    "verified_official_record",
    "computed_from_verified_sources",
    "unverified",
  ]),
  publicationStatus: z.enum(["draft", "publishable", "blocked"]),
  caveats: z.array(z.string().min(1)).min(1),
  benchmark: benchmarkSchema.optional(),
  transparencyGap: z.object({
    missingItem: z.string().min(1),
    legalBasisSourceId: z.string().min(1),
    checkedOfficialSourceId: z.string().min(1),
    checkedAt: isoDate,
  }).optional(),
}).superRefine((observation, context) => {
  if (new Set(observation.sourceIds).size !== observation.sourceIds.length) {
    context.addIssue({ code: "custom", message: "sourceIds contiene duplicati", path: ["sourceIds"] });
  }
});

export const publicSpendingEvidenceSnapshotSchema = z.object({
  schemaVersion: z.literal(1),
  generatedAt: isoDate,
  sources: z.array(sourceSchema).min(1),
  observations: z.array(observationSchema).min(1),
}).superRefine((snapshot, context) => {
  const sources = new Map(snapshot.sources.map((source) => [source.id, source]));
  if (sources.size !== snapshot.sources.length) {
    context.addIssue({ code: "custom", message: "source.id duplicato", path: ["sources"] });
  }

  const observationIds = new Set(snapshot.observations.map((observation) => observation.id));
  if (observationIds.size !== snapshot.observations.length) {
    context.addIssue({ code: "custom", message: "observation.id duplicato", path: ["observations"] });
  }

  snapshot.observations.forEach((observation, index) => {
    const path = ["observations", index];
    const linkedSources = observation.sourceIds.map((sourceId) => sources.get(sourceId));
    if (linkedSources.some((source) => !source)) {
      context.addIssue({ code: "custom", message: "sourceId non risolto", path: [...path, "sourceIds"] });
    }

    const denominatorSource = sources.get(observation.denominator.sourceId);
    const denominatorSourceIsOfficial =
      denominatorSource?.kind === "official_record" ||
      denominatorSource?.kind === "official_dataset";
    if (
      !observation.sourceIds.includes(observation.denominator.sourceId) ||
      !denominatorSourceIsOfficial
    ) {
      context.addIssue({
        code: "custom",
        message: "fonte ufficiale del denominatore richiesta",
        path: [...path, "denominator", "sourceId"],
      });
    }

    const hasPublishableOfficialSource = linkedSources.some((source) =>
      source?.kind === "official_record" ||
      source?.kind === "official_dataset" ||
      source?.kind === "official_finding");
    if (observation.publicationStatus === "publishable" && !hasPublishableOfficialSource) {
      context.addIssue({ code: "custom", message: "fonte ufficiale richiesta per pubblicare", path });
    }

    if (observation.classification === "documented_irregularity") {
      const hasFinding = linkedSources.some((source) => source?.kind === "official_finding");
      if (observation.evidenceStrength !== "official_finding" || !hasFinding) {
        context.addIssue({ code: "custom", message: "accertamento ufficiale richiesto", path });
      }
    }

    if (observation.classification === "anomaly") {
      if (!observation.benchmark) {
        context.addIssue({ code: "custom", message: "benchmark riproducibile richiesto", path });
      }
      if (observation.evidenceStrength !== "computed_from_verified_sources") {
        context.addIssue({ code: "custom", message: "evidenza calcolata e verificata richiesta", path });
      }
    }
    if (
      (observation.classification === "anomaly" ||
        observation.evidenceStrength === "computed_from_verified_sources") &&
      !linkedSources.some((source) =>
        source?.kind === "official_record" || source?.kind === "official_dataset")
    ) {
      context.addIssue({ code: "custom", message: "fonte ufficiale del dato richiesta", path });
    }
    if (observation.benchmark) {
      const members = observation.benchmark.observationIds.map((observationId) =>
        snapshot.observations.find((candidate) => candidate.id === observationId));
      if (members.some((member) => !member?.amount)) {
        context.addIssue({ code: "custom", message: "membro benchmark non risolto", path });
      } else {
        const membersHaveOfficialDataSource = members.every((member) =>
          member!.sourceIds.some((sourceId) => {
            const source = sources.get(sourceId);
            return source?.kind === "official_record" || source?.kind === "official_dataset";
          }));
        if (!membersHaveOfficialDataSource) {
          context.addIssue({ code: "custom", message: "fonte ufficiale richiesta per ogni membro", path });
        }
        try {
          const computed = computePublicSpendingBenchmark({
            cohortId: observation.benchmark.cohortId,
            cohortLabel: observation.benchmark.cohortLabel,
            targetObservationId: observation.id,
            members: members.map((member) => ({
              observationId: member!.id,
              valueCents: member!.amount!.valueCents,
              category: member!.category,
              period: member!.period,
              taxBasis: member!.amount!.taxBasis,
              unit: member!.amount!.unit,
              denominator: {
                name: member!.denominator.name,
                value: member!.denominator.value,
                unit: member!.denominator.unit,
              },
            })),
          });
          const metrics = [
            "medianCents",
            "p25Cents",
            "p75Cents",
            "targetDeltaCents",
            "targetDeltaPercent",
          ] as const;
          const declared = observation.benchmark;
          const dimensionsMatch =
            computed.category === declared.category &&
            computed.taxBasis === declared.taxBasis &&
            computed.unit === declared.unit &&
            computed.period.start === declared.period.start &&
            computed.period.end === declared.period.end &&
            computed.period.precision === declared.period.precision &&
            computed.denominator.name === declared.denominator.name &&
            computed.denominator.value === declared.denominator.value &&
            computed.denominator.unit === declared.denominator.unit;
          if (
            !dimensionsMatch ||
            metrics.some((metric) => computed[metric] !== declared[metric])
          ) {
            context.addIssue({ code: "custom", message: "metriche benchmark non riconciliate", path });
          }
        } catch {
          context.addIssue({ code: "custom", message: "coorte benchmark non like-for-like", path });
        }
      }
    }

    if (observation.classification === "missing_transparency") {
      const gap = observation.transparencyGap;
      const legalSource = gap ? sources.get(gap.legalBasisSourceId) : undefined;
      const checkedOfficialSource = gap ? sources.get(gap.checkedOfficialSourceId) : undefined;
      if (
        !gap ||
        legalSource?.kind !== "legal_basis" ||
        !observation.sourceIds.includes(gap.legalBasisSourceId) ||
        checkedOfficialSource?.kind !== "official_record" ||
        !observation.sourceIds.includes(gap.checkedOfficialSourceId)
      ) {
        context.addIssue({
          code: "custom",
          message: "base normativa e pagina o record ufficiale verificato richiesti",
          path,
        });
      }
    }

    if (observation.publicationStatus === "publishable" && observation.evidenceStrength === "unverified") {
      context.addIssue({ code: "custom", message: "evidenza non verificata non pubblicabile", path });
    }

    if (
      observation.classification === "incomplete_or_not_comparable" &&
      observation.publicationStatus === "publishable"
    ) {
      context.addIssue({ code: "custom", message: "dato incompleto non pubblicabile come evidenza", path });
    }
  });
});

export type EvidenceSource = z.infer<typeof sourceSchema>;
export type EvidenceSubject = z.infer<typeof subjectSchema>;
export type EvidenceAmount = z.infer<typeof amountSchema>;
export type EvidencePeriod = z.infer<typeof periodSchema>;
export type SourcedDenominator = z.infer<typeof sourcedDenominatorSchema>;
export type ProcurementMethod = z.infer<typeof procurementMethodSchema>;
export type Benchmark = z.infer<typeof benchmarkSchema>;
export type EvidenceObservation = z.infer<typeof observationSchema>;
export type PublicSpendingEvidenceSnapshot = z.infer<typeof publicSpendingEvidenceSnapshotSchema>;

export function assertPublicSpendingEvidenceSnapshot(value: unknown): PublicSpendingEvidenceSnapshot {
  return publicSpendingEvidenceSnapshotSchema.parse(value);
}

export function assessSocialCardReadiness(
  snapshot: PublicSpendingEvidenceSnapshot,
  observation: EvidenceObservation,
): string[] {
  const reasons: string[] = [];
  if (observation.publicationStatus !== "publishable") reasons.push("stato non pubblicabile");
  if (!observation.amount) reasons.push("importo non disponibile");
  if (!observation.benchmark) reasons.push("benchmark non disponibile");
  if (observation.evidenceStrength === "unverified") reasons.push("evidenza non verificata");
  const sources = new Map(snapshot.sources.map((source) => [source.id, source]));
  const linkedSources = observation.sourceIds.map((sourceId) => sources.get(sourceId));
  if (linkedSources.some((source) => !source)) {
    reasons.push("fonte non risolta");
  }
  const denominatorSource = sources.get(observation.denominator.sourceId);
  if (
    !observation.sourceIds.includes(observation.denominator.sourceId) ||
    (denominatorSource?.kind !== "official_record" && denominatorSource?.kind !== "official_dataset")
  ) {
    reasons.push("fonte ufficiale del denominatore non disponibile");
  }
  if (
    observation.publicationStatus === "publishable" &&
    !linkedSources.some((source) =>
      source?.kind === "official_record" ||
      source?.kind === "official_dataset" ||
      source?.kind === "official_finding")
  ) {
    reasons.push("fonte ufficiale per la pubblicazione non disponibile");
  }
  if (
    observation.classification === "anomaly" &&
    !linkedSources.some((source) =>
      source?.kind === "official_record" || source?.kind === "official_dataset")
  ) {
    reasons.push("fonte ufficiale del dato non disponibile");
  }
  if (observation.classification === "missing_transparency") {
    const gap = observation.transparencyGap;
    const legalSource = gap ? sources.get(gap.legalBasisSourceId) : undefined;
    const checkedOfficialSource = gap ? sources.get(gap.checkedOfficialSourceId) : undefined;
    if (
      !gap ||
      legalSource?.kind !== "legal_basis" ||
      !observation.sourceIds.includes(gap.legalBasisSourceId) ||
      checkedOfficialSource?.kind !== "official_record" ||
      !observation.sourceIds.includes(gap.checkedOfficialSourceId)
    ) {
      reasons.push("verifica della trasparenza incompleta");
    }
  }
  return reasons;
}
