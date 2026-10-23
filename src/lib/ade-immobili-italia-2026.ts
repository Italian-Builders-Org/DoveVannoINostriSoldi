import "server-only";

import { z } from "zod";
import analysisData from "@/data/generated/ade-immobili-italia-2026.data.json";
import analysisMeta from "@/data/generated/ade-immobili-italia-2026.meta.json";

export const ADE_IMMOBILI_ANALYSIS_ID = "ade-immobili-italia-2026";
export const ADE_IMMOBILI_PRELIEVO_DATASET = "ade-immobili-prelievo-2015-2024";
export const ADE_IMMOBILI_UTILIZZO_DATASET = "ade-immobili-utilizzo-provincia-2023";
export const ADE_IMMOBILI_TABELLE_DATASET = "ade-immobili-tabelle-2026";
export const ADE_IMMOBILI_ACQUISITION_DATE = "2026-10-23";
export const ADE_IMMOBILI_OPEN_DATA_ZIP =
  "https://www1.finanze.gov.it/finanze/immobili/public/contenuti/opendata.zip";
export const ADE_IMMOBILI_LANDING =
  "https://www.agenziaentrate.gov.it/portale/gli-immobili-in-italia-2026";
export const ADE_IMMOBILI_TABLE_API_PREFIX =
  "https://www1.finanze.gov.it/finanze/immobili/public/api/api.php/get_table?id=";

const prelievoPoint = z.object({
  voce: z.string().min(1),
  anno: z.number().int(),
  mldEuro: z.string().min(1),
  sourceUrl: z.string().url(),
}).strict();

const analysisSchema = z.object({
  caveats: z.array(z.string().min(1)),
  coverage: z.object({
    taxYear: z.number().int(),
    edition: z.number().int(),
    openDataZipBytes: z.number().int().positive(),
    tableCount: z.number().int().positive(),
    tablesAvailableViaApi: z.number().int().nonnegative(),
    tablesMissingViaApi: z.array(z.string().min(1)),
    utilizzoProvinciaRows: z.number().int().positive(),
  }).strict(),
  hero: z.object({
    imuGettito2024Mld: z.string().min(1),
    prelievoPatrimoniale2024Mld: z.string().min(1),
  }).strict(),
  chapters: z.array(z.object({
    id: z.string().min(1),
    title: z.string().min(1),
    tables: z.number().int().nonnegative(),
  }).strict()),
  prelievoSeries: z.array(prelievoPoint),
  sources: z.object({
    landingUrl: z.string().url(),
    openDataPortalUrl: z.string().url(),
    openDataZipUrl: z.string().url(),
    volumePdfUrl: z.string().url(),
    licenseUrl: z.string().url(),
  }).strict(),
}).strict();

const metaSchema = z.object({
  datasetId: z.literal(ADE_IMMOBILI_ANALYSIS_ID),
  schemaVersion: z.literal(1),
  semantics: z.object({
    periodo: z.object({
      referencePeriod: z.string().min(1),
      note: z.string().min(1),
    }).strict(),
    provenance: z.object({
      canonicalUrls: z.array(z.string().url()).min(1),
      acquisitionDate: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
      checkedAt: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
      publicationDate: z.null(),
    }).strict(),
  }).strict(),
}).strict();

export type AdeImmobiliAnalysis = z.infer<typeof analysisSchema>;

export const UTILIZZO_CATEGORIES = [
  "abitazioni",
  "pertinenze",
  "negozi",
  "uffici",
  "produttivo",
  "altro",
] as const;

export function getAdeImmobiliAnalysis(): AdeImmobiliAnalysis {
  const data = analysisSchema.parse(analysisData);
  metaSchema.parse(analysisMeta);
  if (data.hero.imuGettito2024Mld !== "20.98" || data.coverage.utilizzoProvinciaRows !== 16_632) {
    throw new Error("Snapshot analisi AdE immobili 2026 fuori dal contratto atteso.");
  }
  if (data.sources.landingUrl !== ADE_IMMOBILI_LANDING || data.sources.openDataZipUrl !== ADE_IMMOBILI_OPEN_DATA_ZIP) {
    throw new Error("URL fonte analisi AdE immobili 2026 divergenti.");
  }
  return data;
}

/** AdE publishes 0,00 after TASI abolition; treat post-2020 as non disponibile, not zero. */
export function prelievoMldFromSource(voce: string, anno: number, mldEuro: string): number | null {
  const trimmed = mldEuro.trim().toLowerCase();
  if (!trimmed || trimmed === "n.d." || trimmed === "nd" || trimmed === "-") {
    return null;
  }
  const mld = Number.parseFloat(mldEuro.replace(",", "."));
  if (!Number.isFinite(mld)) {
    return null;
  }
  if (voce.startsWith("TASI di cui") && anno > 2020) {
    return null;
  }
  return mld;
}

export function buildPrelievoChartSeries(analysis: AdeImmobiliAnalysis) {
  const voices = ["IMU di cui", "Cedolare secca", "TASI di cui"] as const;
  return voices.map((voice) => ({
    voice,
    points: analysis.prelievoSeries
      .filter((point) => point.voce.startsWith(voice))
      .sort((left, right) => left.anno - right.anno)
      .map((point) => ({
        year: point.anno,
        mld: prelievoMldFromSource(point.voce, point.anno, point.mldEuro),
        sourceUrl: point.sourceUrl,
      })),
  }));
}
