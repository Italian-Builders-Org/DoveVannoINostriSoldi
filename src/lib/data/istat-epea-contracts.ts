import { z } from "zod";

/**
 * Contratto fail-closed per lo snapshot ISTAT EPEA (spesa protezione ambiente).
 * Edizione 2025M2, anni 2016–2022. Non mescolare con RGS / PNRR M2 / SAD-SAF.
 */

export const IstatEpeaEdition = z.literal("2025M2");

export const IstatEpeaRowSchema = z.object({
  year: z.number().int().min(2016).max(2022),
  institutionalSector: z.string().min(1),
  cepaClass: z.string().min(1),
  dataTypeAggr: z.string().min(1),
  obsValueMillions: z.string().nullable(),
  amountCents: z.number().int().nullable(),
  valuation: z.string(),
  refArea: z.string(),
});

export const IstatEpeaDataSchema = z.object({
  datasetId: z.literal("istat-epea"),
  edition: IstatEpeaEdition,
  rows: z.array(IstatEpeaRowSchema).min(1),
});

export const IstatEpeaMetaSchema = z.object({
  datasetId: z.literal("istat-epea"),
  edition: IstatEpeaEdition,
  referencePeriod: z.object({
    from: z.literal(2016),
    to: z.literal(2022),
  }),
  source: z.object({
    sha256: z.string().length(64),
    rows: z.number().int().positive(),
    dataflowId: z.string(),
    url: z.string().url(),
  }),
  caveats: z.array(z.string()).min(1),
  issue: z.literal(86),
});

export type IstatEpeaData = z.infer<typeof IstatEpeaDataSchema>;
export type IstatEpeaMeta = z.infer<typeof IstatEpeaMetaSchema>;

export function parseIstatEpeaData(input: unknown): IstatEpeaData {
  return IstatEpeaDataSchema.parse(input);
}

export function parseIstatEpeaMeta(input: unknown): IstatEpeaMeta {
  return IstatEpeaMetaSchema.parse(input);
}
