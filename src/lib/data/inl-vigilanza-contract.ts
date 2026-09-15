import { createHash } from "node:crypto";
import { z } from "zod";
import sourceLock from "../../../scripts/etl/specs/inl-vigilanza-2025.source.json";

const OFFICIAL_PREFIX = "https://www.ispettorato.gov.it/";
const officialUrl = (message: string) =>
  z.string().refine((url) => url.startsWith(OFFICIAL_PREFIX), message);

const isoDate = z.string().regex(/^\d{4}-\d{2}-\d{2}$/);
const sha256 = z.string().regex(/^[a-f0-9]{64}$/);
const safeInt = z.number().int().refine(Number.isSafeInteger, "Intero non sicuro");
const sector = z.enum(["Agricoltura", "Industria", "Edilizia", "Terziario", "ND", "Totale"]);
const scope = z.enum([
  "Vigilanza Lavoro",
  "Vigilanza Previdenziale",
  "Vigilanza Assicurativa",
  "Totale",
]);

const startedObservation = z
  .object({
    table: z.literal("inspectionsStarted"),
    year: z.literal(2025),
    territory: z.string().min(1),
    sector,
    inspections: safeInt.min(0),
    checks: safeInt.min(0),
    accesses: safeInt.min(0),
  })
  .strict();

const outcomeObservation = z
  .object({
    table: z.literal("inspectionsOutcome"),
    year: z.literal(2025),
    territory: z.string().min(1),
    sector,
    irregularInspections: safeInt.min(0),
    regularInspections: safeInt.min(0),
    definedInspections: safeInt.min(0),
    irregularityRateTenths: safeInt.min(0),
  })
  .strict();

const recoveryObservation = z
  .object({
    table: z.literal("recovery"),
    year: z.literal(2025),
    territory: z.literal("ITALIA"),
    scope,
    definedInspections: safeInt.min(0),
    irregularInspections: safeInt.min(0),
    irregularityRateTenths: safeInt.min(0),
    irregularWorkers: safeInt.min(0),
    fullyUndeclaredWorkers: safeInt.min(0),
    recoveryEuroCents: safeInt.min(0),
  })
  .strict();

const observationSchema = z.union([startedObservation, outcomeObservation, recoveryObservation]);

export const inlVigilanzaDataSchema = z
  .object({
    schemaVersion: z.literal(1),
    datasetId: z.literal("inl-vigilanza"),
    period: z.object({ from: z.literal(2025), to: z.literal(2025) }).strict(),
    geography: z
      .object({
        level: z.literal("mixed"),
        territories: z.literal(131),
        note: z.string().min(1),
      })
      .strict(),
    units: z
      .object({
        count: z.literal("unita"),
        rate: z.literal("decimi di punto percentuale (64,8% → 648)"),
        money: z.literal("centesimi di euro"),
        moneyNote: z.string().min(1),
      })
      .strict(),
    coverage: z
      .object({
        years: z.tuple([z.literal(2025)]),
        territories: z.literal(131),
        sectors: z.literal(6),
        tables: z
          .object({
            inspectionsStarted: z.literal(786),
            inspectionsOutcome: z.literal(786),
            recovery: z.literal(4),
          })
          .strict(),
        observedRows: z.literal(1576),
        perimeter: z.string().min(1),
      })
      .strict(),
    measures: z
      .object({
        inspectionsStarted: z.string().min(1),
        inspectionsOutcome: z.string().min(1),
        recovery: z.string().min(1),
      })
      .strict(),
    caveats: z.array(z.string().min(1)).min(7),
    pdfPages: z
      .object({
        inspectionsStarted: z.object({ from: z.literal(27), to: z.literal(157) }).strict(),
        inspectionsOutcome: z.object({ from: z.literal(420), to: z.literal(550) }).strict(),
        recovery: z.object({ page: z.literal(4) }).strict(),
      })
      .strict(),
    observations: z.array(observationSchema).length(1576),
  })
  .strict();

export const inlVigilanzaMetadataSchema = z
  .object({
    schemaVersion: z.literal(1),
    datasetId: z.literal("inl-vigilanza"),
    period: z.object({ from: z.literal(2025), to: z.literal(2025) }).strict(),
    observedAt: isoDate,
    source: z
      .object({
        owner: z.literal("Ispettorato Nazionale del Lavoro"),
        landingUrl: officialUrl("landing non ufficiale"),
        documentUrl: officialUrl("documentUrl non ufficiale"),
        licenseId: z.literal("CC-BY-3.0-IT"),
        licenseNote: z.string().min(1),
        termsUrl: z.string().url(),
        publicationDate: isoDate,
        updateFrequency: z.literal("annuale"),
        distributionChoice: z
          .object({
            used: z.string().min(1),
            note: z.string().min(1),
          })
          .strict(),
        asset: z
          .object({
            filename: z.string().min(1),
            path: z.string().min(1),
            url: officialUrl("asset non ufficiale"),
            bytes: z.number().int().positive(),
            sha256,
            pages: z.literal(1467),
          })
          .strict(),
        acquisition: z
          .object({
            acquiredAt: isoDate,
            checkedAt: isoDate,
          })
          .strict(),
      })
      .strict(),
    pdf: z
      .object({
        inspectionsStarted: z.object({ from: z.literal(27), to: z.literal(157) }).strict(),
        inspectionsOutcome: z.object({ from: z.literal(420), to: z.literal(550) }).strict(),
        recovery: z.object({ page: z.literal(4) }).strict(),
      })
      .strict(),
    semantics: z
      .object({
        soldi: z
          .object({
            unit: z.string().min(1),
            nature: z.string().min(1),
            note: z.string().min(1),
          })
          .strict(),
        periodo: z
          .object({
            referencePeriod: z.literal("2025"),
            note: z.string().min(1),
          })
          .strict(),
        provenance: z
          .object({
            acquisitionDate: isoDate,
            checkedAt: isoDate,
            publicationDate: isoDate,
            canonicalUrls: z.array(officialUrl("canonical")).min(3),
          })
          .strict(),
      })
      .strict(),
    integrity: z
      .object({
        algorithm: z.literal("sha256"),
        canonicalization: z.string().min(1),
        dataArtifact: z
          .object({
            path: z.literal("src/data/generated/inl-vigilanza-2025.data.json"),
            bytes: z.number().int().positive(),
            sha256,
          })
          .strict(),
        sourceLockSha256: sha256,
      })
      .strict(),
  })
  .strict();

export type InlVigilanzaData = z.infer<typeof inlVigilanzaDataSchema>;
export type InlVigilanzaMetadata = z.infer<typeof inlVigilanzaMetadataSchema>;
export type InlVigilanzaObservation = z.infer<typeof observationSchema>;

function canonicalJson(value: unknown): string {
  if (Array.isArray(value)) return `[${value.map(canonicalJson).join(",")}]`;
  if (value !== null && typeof value === "object") {
    return `{${Object.entries(value as Record<string, unknown>)
      .sort(([left], [right]) => (left < right ? -1 : left > right ? 1 : 0))
      .map(([key, item]) => `${JSON.stringify(key)}:${canonicalJson(item)}`)
      .join(",")}}`;
  }
  return JSON.stringify(value);
}

const digest = (value: string) => createHash("sha256").update(value, "utf8").digest("hex");

function requireEqual(actual: unknown, expected: unknown, label: string) {
  if (canonicalJson(actual) !== canonicalJson(expected)) {
    throw new Error(`inl-vigilanza: ${label} incoerente con la fonte verificata`);
  }
}

export function validateInlVigilanzaBundle(
  dataInput: unknown,
  metadataInput: unknown,
): { data: InlVigilanzaData; metadata: InlVigilanzaMetadata } {
  const data = inlVigilanzaDataSchema.parse(dataInput);
  const metadata = inlVigilanzaMetadataSchema.parse(metadataInput);

  const lockDigest = digest(
    canonicalJson({
      ...sourceLock,
      integrity: { ...sourceLock.integrity, lockSha256: "" },
    }),
  );
  requireEqual(lockDigest, sourceLock.integrity.lockSha256, "hash source lock");
  requireEqual(metadata.integrity.sourceLockSha256, lockDigest, "hash metadata/source lock");
  requireEqual(
    metadata.integrity.dataArtifact.sha256,
    sourceLock.integrity.dataArtifact.sha256,
    "hash data artifact nel lock",
  );
  requireEqual(metadata.source.asset.sha256, sourceLock.source.asset.sha256, "hash PDF");
  requireEqual(metadata.source.landingUrl, sourceLock.source.landingUrl, "landing");

  const started = data.observations.filter((row) => row.table === "inspectionsStarted");
  const outcome = data.observations.filter((row) => row.table === "inspectionsOutcome");
  const recovery = data.observations.filter((row) => row.table === "recovery");
  if (started.length !== 786 || outcome.length !== 786 || recovery.length !== 4) {
    throw new Error("inl-vigilanza: conteggio tabelle divergente");
  }

  if (!data.caveats.some((item) => /mirat/i.test(item))) {
    throw new Error("inl-vigilanza: manca il caveat sui controlli mirati");
  }
  if (!data.caveats.some((item) => /tax gap|VAT gap|economia non osservata/i.test(item))) {
    throw new Error("inl-vigilanza: manca il caveat di separazione dalle altre stime");
  }

  return { data, metadata };
}
