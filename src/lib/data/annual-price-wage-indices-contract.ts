import { z } from "zod";

/**
 * Boundary contracts for the three annual index snapshots used to compare the
 * deputies' institutional rate with wages: HICP (Eurostat), FOI (ISTAT) and the
 * contractual wage index per employee (ISTAT). The ETL already locks bytes and
 * hashes; here we only refuse shapes the UI cannot read safely: missing or
 * unordered years, non-positive indices, unknown datasets.
 */

const isoDate = z.string().regex(/^\d{4}-\d{2}-\d{2}$/u);
const year = z.number().int().min(1990).max(2100);
const positiveTenths = z.number().int().positive();

function contiguousYears<T extends { year: number }>(observations: readonly T[], context: z.RefinementCtx) {
  for (let index = 1; index < observations.length; index += 1) {
    if (observations[index]!.year !== observations[index - 1]!.year + 1) {
      context.addIssue({
        code: "custom",
        message: `anni non consecutivi: ${observations[index - 1]!.year} poi ${observations[index]!.year}`,
        path: ["observations", index, "year"],
      });
      return;
    }
  }
}

const provenanceBase = {
  holder: z.string().min(1),
  landingUrl: z.string().url(),
  license: z.string().min(1),
  licenseNote: z.string().min(1).optional(),
  acquisitionDate: isoDate,
};

const caveats = z.array(z.string().min(1)).min(1);

export const eurostatHicpAnnualSnapshotSchema = z.object({
  schemaVersion: z.literal(1),
  datasetId: z.literal("eurostat-hicp-annuale"),
  referencePeriod: z.string().regex(/^\d{4}-\d{4}$/u),
  caveats,
  observations: z.array(z.object({
    year,
    indexTenths: positiveTenths,
    annualAverageRateTenths: z.number().int().optional(),
  }).passthrough()).min(2),
  semantics: z.object({
    provenance: z.object({ ...provenanceBase, url: z.string().url() }).passthrough(),
  }).passthrough(),
}).passthrough().superRefine((snapshot, context) => contiguousYears(snapshot.observations, context));

export const istatFoiAnnualSnapshotSchema = z.object({
  schemaVersion: z.literal(1),
  datasetId: z.literal("istat-foi-annuale"),
  referencePeriod: z.string().regex(/^\d{4}-\d{4}$/u),
  caveats,
  observations: z.array(z.object({
    year,
    base: z.number().int(),
    foiTenths: positiveTenths,
    base2025: z.object({
      foiHundredths: z.number().int().positive(),
      foiNoTobaccoHundredths: z.number().int().positive(),
    }),
  }).passthrough()).min(2),
  semantics: z.object({
    provenance: z.object(provenanceBase).passthrough(),
  }).passthrough(),
}).passthrough().superRefine((snapshot, context) => contiguousYears(snapshot.observations, context));

export const istatContractualWagesSnapshotSchema = z.object({
  schemaVersion: z.literal(1),
  datasetId: z.literal("istat-retribuzioni-contrattuali"),
  referencePeriod: z.string().regex(/^\d{4}-\d{4}$/u),
  caveats,
  observations: z.array(z.object({ year, indexTenths: positiveTenths }).passthrough()).min(2),
  semantics: z.object({
    provenance: z.object({ ...provenanceBase, url: z.string().url() }).passthrough(),
  }).passthrough(),
}).passthrough().superRefine((snapshot, context) => contiguousYears(snapshot.observations, context));

export type EurostatHicpAnnualSnapshot = z.infer<typeof eurostatHicpAnnualSnapshotSchema>;
export type IstatFoiAnnualSnapshot = z.infer<typeof istatFoiAnnualSnapshotSchema>;
export type IstatContractualWagesSnapshot = z.infer<typeof istatContractualWagesSnapshotSchema>;

function parseWith<T>(schema: z.ZodType<T>, name: string, raw: unknown): T {
  const result = schema.safeParse(raw);
  if (!result.success) {
    throw new Error(`snapshot ${name} non valido: ${result.error.issues.map((issue) => issue.message).join("; ")}`);
  }
  return result.data;
}

export function parseEurostatHicpAnnualSnapshot(raw: unknown): EurostatHicpAnnualSnapshot {
  return parseWith(eurostatHicpAnnualSnapshotSchema, "eurostat-hicp-annuale", raw);
}

export function parseIstatFoiAnnualSnapshot(raw: unknown): IstatFoiAnnualSnapshot {
  return parseWith(istatFoiAnnualSnapshotSchema, "istat-foi-annuale", raw);
}

export function parseIstatContractualWagesSnapshot(raw: unknown): IstatContractualWagesSnapshot {
  return parseWith(istatContractualWagesSnapshotSchema, "istat-retribuzioni-contrattuali", raw);
}
