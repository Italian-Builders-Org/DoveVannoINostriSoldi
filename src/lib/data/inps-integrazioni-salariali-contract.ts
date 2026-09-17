import { createHash } from "node:crypto";
import { z } from "zod";
import sourceLock from "../../../scripts/etl/specs/inps-integrazioni-salariali-2023.source.json";

const OFFICIAL_PREFIX = "https://opendata.inps.it/";
const officialUrl = (message: string) =>
  z.string().refine((url) => url.startsWith(OFFICIAL_PREFIX), message);

const isoDate = z.string().regex(/^\d{4}-\d{2}-\d{2}$/);
const sha256 = z.string().regex(/^[a-f0-9]{64}$/);
const safeInt = z.number().int().refine(Number.isSafeInteger, "Intero non sicuro");
const tableId = z.enum(["lavoratori", "domande", "mensilita"]);
const interventionType = z.enum([
  "CIGD",
  "CIGO",
  "CIGS",
  "FIS",
  "FONDI_Centrali",
  "FONDI_Territorio",
]);

const observationSchema = z
  .object({
    table: tableId,
    year: z.literal(2023),
    month: z.string().min(1),
    interventionType,
    region: z.string().min(1),
    count: safeInt.min(0),
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

export const inpsIntegrazioniSalarialiDataSchema = z
  .object({
    schemaVersion: z.literal(1),
    datasetId: z.literal("inps-integrazioni-salariali"),
    period: z.object({ from: z.literal(2023), to: z.literal(2023) }).strict(),
    units: z
      .object({
        count: z.literal("unita"),
        money: z.literal("nessuna — il dataset non contiene importi"),
        countNote: z.string().min(1),
      })
      .strict(),
    tables: z
      .array(
        z
          .object({
            id: tableId,
            package: z.string().min(1),
            title: z.string().min(1),
            rows: z.number().int().positive(),
            dimensions: z.array(z.string().min(1)).min(1),
            measureColumn: z.string().min(1),
          })
          .strict(),
      )
      .length(3),
    coverage: z
      .object({
        years: z.tuple([z.literal(2023)]),
        regions: z.literal(20),
        interventionTypes: z.literal(6),
        observedRows: z.literal(2339),
        perimeter: z.literal(
          "Report annuale integrazioni salariali 2023 — Direzione Ammortizzatori Sociali",
        ),
      })
      .strict(),
    measures: z
      .object({
        lavoratori: z.string().min(1),
        domande: z.string().min(1),
        mensilita: z.string().min(1),
      })
      .strict(),
    caveats: z.array(z.string().min(1)).min(7),
    observations: z.array(observationSchema).length(2339),
  })
  .strict();

export const inpsIntegrazioniSalarialiMetadataSchema = z
  .object({
    schemaVersion: z.literal(1),
    datasetId: z.literal("inps-integrazioni-salariali"),
    period: z.object({ from: z.literal(2023), to: z.literal(2023) }).strict(),
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
            lavoratori: assetSchema,
            domande: assetSchema,
            mensilita: assetSchema,
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
            referencePeriod: z.literal("2023"),
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
            path: z.literal("src/data/generated/inps-integrazioni-salariali-2023.data.json"),
            bytes: z.number().int().positive(),
            sha256,
          })
          .strict(),
        sourceLockSha256: sha256,
      })
      .strict(),
  })
  .strict();

export type InpsIntegrazioniSalarialiData = z.infer<typeof inpsIntegrazioniSalarialiDataSchema>;
export type InpsIntegrazioniSalarialiMetadata = z.infer<
  typeof inpsIntegrazioniSalarialiMetadataSchema
>;
export type InpsIntegrazioniSalarialiObservation = z.infer<typeof observationSchema>;

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
    throw new Error(`inps-integrazioni-salariali: ${label} incoerente con la fonte verificata`);
  }
}

export function validateInpsIntegrazioniSalarialiBundle(
  dataInput: unknown,
  metadataInput: unknown,
): { data: InpsIntegrazioniSalarialiData; metadata: InpsIntegrazioniSalarialiMetadata } {
  const data = inpsIntegrazioniSalarialiDataSchema.parse(dataInput);
  const metadata = inpsIntegrazioniSalarialiMetadataSchema.parse(metadataInput);

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
  for (const table of ["lavoratori", "domande", "mensilita"] as const) {
    requireEqual(
      metadata.source.assets[table].sha256,
      sourceLock.source.assets[table].sha256,
      `hash asset ${table}`,
    );
  }
  requireEqual(metadata.source.landingUrl, sourceLock.source.landingUrl, "landing");

  const counts = {
    lavoratori: data.observations.filter((row) => row.table === "lavoratori").length,
    domande: data.observations.filter((row) => row.table === "domande").length,
    mensilita: data.observations.filter((row) => row.table === "mensilita").length,
  };
  if (counts.lavoratori !== 790 || counts.domande !== 759 || counts.mensilita !== 790) {
    throw new Error("inps-integrazioni-salariali: conteggio tabelle divergente");
  }

  const keys = new Set(
    data.observations.map(
      (row) => `${row.table}|${row.year}|${row.month}|${row.interventionType}|${row.region}`,
    ),
  );
  if (keys.size !== 2339) {
    throw new Error("inps-integrazioni-salariali: chiavi non uniche");
  }

  if (!data.caveats.some((item) => /lavoratori.*domande.*mensilit/i.test(item))) {
    throw new Error("inps-integrazioni-salariali: manca il caveat sulle tre misure");
  }
  if (!data.caveats.some((item) => /NON euro|non contiene importi/i.test(item))) {
    throw new Error("inps-integrazioni-salariali: manca il caveat assenza euro");
  }

  return { data, metadata };
}
