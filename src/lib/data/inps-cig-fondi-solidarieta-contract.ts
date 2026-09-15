import { createHash } from "node:crypto";
import { z } from "zod";
import sourceLock from "../../../scripts/etl/specs/inps-cig-fondi-solidarieta-2023-2024.source.json";

const OFFICIAL_PREFIX = "https://opendata.inps.it/";
const officialUrl = (message: string) =>
  z.string().refine((url) => url.startsWith(OFFICIAL_PREFIX), message);

const isoDate = z.string().regex(/^\d{4}-\d{2}-\d{2}$/);
const sha256 = z.string().regex(/^[a-f0-9]{64}$/);
const safeInt = z.number().int().refine(Number.isSafeInteger, "Intero non sicuro");
const fundManagement = z.enum(["FIS", "Altri fondi"]);
const sector = z.enum(["Commercio", "Credito", "Industria", "ex Enti Pubblici"]);

const observationSchema = z
  .object({
    year: z.union([z.literal(2023), z.literal(2024)]),
    fundManagement,
    region: z.string().min(1),
    month: z.string().min(1),
    sector,
    authorizedHours: safeInt.min(0),
  })
  .strict();

const assetSchema = z
  .object({
    package: z.string().min(1),
    filename: z.string().min(1),
    path: z.string().min(1),
    url: officialUrl("asset non ufficiale"),
    bytes: z.number().int().positive(),
    sha256,
    packageLandingUrl: officialUrl("landing package non ufficiale"),
  })
  .strict();

export const inpsCigFondiSolidarietaDataSchema = z
  .object({
    schemaVersion: z.literal(1),
    datasetId: z.literal("inps-cig-fondi-solidarieta"),
    period: z.object({ from: z.literal(2023), to: z.literal(2024) }).strict(),
    units: z
      .object({
        hours: z.literal("ore"),
        money: z.literal("nessuna — il dataset non contiene importi"),
        hoursNote: z.string().min(1),
      })
      .strict(),
    coverage: z
      .object({
        years: z.tuple([z.literal(2023), z.literal(2024)]),
        regions: z.literal(20),
        fundManagements: z.literal(2),
        sectors: z.literal(4),
        observedRows: z.literal(628),
        perimeter: z.literal(
          "CIG Fondi di Solidarietà — ore autorizzate per regione, mese, gestione e ramo",
        ),
      })
      .strict(),
    measures: z
      .object({
        authorizedHours: z.string().min(1),
      })
      .strict(),
    caveats: z.array(z.string().min(1)).min(7),
    observations: z.array(observationSchema).length(628),
  })
  .strict();

export const inpsCigFondiSolidarietaMetadataSchema = z
  .object({
    schemaVersion: z.literal(1),
    datasetId: z.literal("inps-cig-fondi-solidarieta"),
    period: z.object({ from: z.literal(2023), to: z.literal(2024) }).strict(),
    observedAt: isoDate,
    source: z
      .object({
        owner: z.literal("INPS — Istituto Nazionale della Previdenza Sociale"),
        landingUrl: officialUrl("landing non ufficiale"),
        catalogApi: officialUrl("catalogApi non ufficiale"),
        licenseId: z.literal("CC-BY"),
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
        assets: z
          .object({
            hours: assetSchema,
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
    semantics: z
      .object({
        soldi: z
          .object({
            unit: z.literal("nessuna — il dataset non contiene importi"),
            nature: z.string().min(1),
            note: z.string().min(1),
          })
          .strict(),
        periodo: z
          .object({
            referencePeriod: z.literal("2023-2024"),
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
            path: z.literal("src/data/generated/inps-cig-fondi-solidarieta-2023-2024.data.json"),
            bytes: z.number().int().positive(),
            sha256,
          })
          .strict(),
        sourceLockSha256: sha256,
      })
      .strict(),
  })
  .strict();

export type InpsCigFondiSolidarietaData = z.infer<typeof inpsCigFondiSolidarietaDataSchema>;
export type InpsCigFondiSolidarietaMetadata = z.infer<typeof inpsCigFondiSolidarietaMetadataSchema>;
export type InpsCigFondiSolidarietaObservation = z.infer<typeof observationSchema>;

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
    throw new Error(`inps-cig-fondi-solidarieta: ${label} incoerente con la fonte verificata`);
  }
}

export function validateInpsCigFondiSolidarietaBundle(
  dataInput: unknown,
  metadataInput: unknown,
): { data: InpsCigFondiSolidarietaData; metadata: InpsCigFondiSolidarietaMetadata } {
  const data = inpsCigFondiSolidarietaDataSchema.parse(dataInput);
  const metadata = inpsCigFondiSolidarietaMetadataSchema.parse(metadataInput);

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
  requireEqual(
    metadata.source.assets.hours.sha256,
    sourceLock.source.assets.hours.sha256,
    "hash asset hours",
  );
  requireEqual(metadata.source.landingUrl, sourceLock.source.landingUrl, "landing");

  const keys = new Set(
    data.observations.map(
      (row) =>
        `${row.year}|${row.fundManagement}|${row.region}|${row.month}|${row.sector}`,
    ),
  );
  if (keys.size !== 628) {
    throw new Error("inps-cig-fondi-solidarieta: chiavi non uniche");
  }

  if (!data.caveats.some((item) => /NON euro|non contiene importi/i.test(item))) {
    throw new Error("inps-cig-fondi-solidarieta: manca il caveat assenza euro");
  }
  if (!data.caveats.some((item) => /ore autorizzate/i.test(item))) {
    throw new Error("inps-cig-fondi-solidarieta: manca il caveat sulle ore");
  }

  return { data, metadata };
}
