import { createHash } from "node:crypto";
import { z } from "zod";
import sourceLock from "../../../scripts/etl/specs/inps-assegno-unico-2022-2024.source.json";

const OFFICIAL_PREFIX = "https://opendata.inps.it/";
const officialUrl = (message: string) =>
  z.string().refine((url) => url.startsWith(OFFICIAL_PREFIX), message);

const isoDate = z.string().regex(/^\d{4}-\d{2}-\d{2}$/);
const sha256 = z.string().regex(/^[a-f0-9]{64}$/);
const safeInt = z.number().int().refine(Number.isSafeInteger, "Intero non sicuro");

const nucleiObservation = z
  .object({
    table: z.literal("nuclei"),
    year: z.number().int().min(2022).max(2024),
    region: z.string().min(1),
    province: z.string().min(1),
    zone: z.string().min(1),
    childrenDisabilityFlag: z.union([z.literal(0), z.literal(1)]),
    householdCount: safeInt.min(0),
    childrenCount: safeInt.min(0),
    childrenCountNote: z.literal("unita-non-documentata-dalla-fonte"),
    amountMilli: safeInt,
    monthSum: safeInt.min(0),
  })
  .strict();

const figliObservation = z
  .object({
    table: z.literal("figli_disabilita"),
    year: z.number().int().min(2022).max(2024),
    region: z.string().min(1),
    province: z.string().min(1),
    zone: z.string().min(1),
    childrenDisabilityFlag: z.union([z.literal(0), z.literal(1)]),
    iseeClass: z.string().min(1),
    ageClass: z.string().min(1),
    childrenCount: safeInt.min(0),
    amountMilli: safeInt,
    monthSum: safeInt.min(0),
  })
  .strict();

export const inpsAssegnoUnicoDataSchema = z
  .object({
    schemaVersion: z.literal(1),
    datasetId: z.literal("inps-assegno-unico"),
    period: z.object({ from: z.literal(2022), to: z.literal(2024) }).strict(),
    units: z
      .object({
        money: z.literal("euro-millesimi"),
        sourceMoney: z.literal("euro"),
        moneyNote: z.string().min(1),
      })
      .strict(),
    tables: z
      .array(
        z
          .object({
            id: z.enum(["nuclei", "figli_disabilita"]),
            package: z.string().min(1),
            title: z.string().min(1),
            rows: z.number().int().positive(),
            dimensions: z.array(z.string().min(1)).min(1),
          })
          .strict(),
      )
      .length(2),
    coverage: z
      .object({
        years: z.tuple([z.literal(2022), z.literal(2023), z.literal(2024)]),
        provinces: z.literal(106),
        observedRows: z.literal(4452),
        perimeter: z.literal("AUU a domanda — esclusi beneficiari RdC"),
      })
      .strict(),
    measures: z
      .object({
        householdCount: z.string().min(1),
        childrenCount: z.string().min(1),
        amountMilli: z.string().min(1),
        monthSum: z.string().min(1),
      })
      .strict(),
    nucleiChildrenColumn: z
      .object({
        note: z.string().min(1),
        byYear: z.record(
          z.string(),
          z
            .object({
              households: safeInt,
              childrenColumn: safeInt,
              months: safeInt,
              childrenColumnPerMonth: z.number(),
            })
            .strict(),
        ),
      })
      .strict(),
    caveats: z.array(z.string().min(1)).min(8),
    observations: z.array(z.union([nucleiObservation, figliObservation])).length(4452),
  })
  .strict();

export const inpsAssegnoUnicoMetadataSchema = z
  .object({
    schemaVersion: z.literal(1),
    datasetId: z.literal("inps-assegno-unico"),
    period: z.object({ from: z.literal(2022), to: z.literal(2024) }).strict(),
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
            nuclei: z
              .object({
                package: z.string().min(1),
                filename: z.string().min(1),
                path: z.string().min(1),
                url: officialUrl("asset nuclei"),
                bytes: z.number().int().positive(),
                sha256,
                packageLandingUrl: officialUrl("landing nuclei"),
              })
              .strict(),
            figli_disabilita: z
              .object({
                package: z.string().min(1),
                filename: z.string().min(1),
                path: z.string().min(1),
                url: officialUrl("asset figli"),
                bytes: z.number().int().positive(),
                sha256,
                packageLandingUrl: officialUrl("landing figli"),
              })
              .strict(),
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
            nature: z.literal("erogato"),
            unit: z.literal("euro-millesimi"),
            note: z.string().min(1),
          })
          .strict(),
        periodo: z
          .object({
            referencePeriod: z.literal("2022-2024"),
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
            path: z.literal("src/data/generated/inps-assegno-unico-2022-2024.data.json"),
            bytes: z.number().int().positive(),
            sha256,
          })
          .strict(),
        sourceLockSha256: sha256,
      })
      .strict(),
  })
  .strict();

export type InpsAssegnoUnicoData = z.infer<typeof inpsAssegnoUnicoDataSchema>;
export type InpsAssegnoUnicoMetadata = z.infer<typeof inpsAssegnoUnicoMetadataSchema>;
export type InpsAssegnoUnicoObservation = InpsAssegnoUnicoData["observations"][number];

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
    throw new Error(`inps-assegno-unico: ${label} incoerente con la fonte verificata`);
  }
}

export function validateInpsAssegnoUnicoBundle(
  dataInput: unknown,
  metadataInput: unknown,
): { data: InpsAssegnoUnicoData; metadata: InpsAssegnoUnicoMetadata } {
  const data = inpsAssegnoUnicoDataSchema.parse(dataInput);
  const metadata = inpsAssegnoUnicoMetadataSchema.parse(metadataInput);

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
    metadata.source.assets.nuclei.sha256,
    sourceLock.source.assets.nuclei.sha256,
    "hash asset nuclei",
  );
  requireEqual(
    metadata.source.assets.figli_disabilita.sha256,
    sourceLock.source.assets.figli_disabilita.sha256,
    "hash asset figli",
  );
  requireEqual(metadata.source.landingUrl, sourceLock.source.landingUrl, "landing");

  const nuclei = data.observations.filter((row) => row.table === "nuclei");
  const figli = data.observations.filter((row) => row.table === "figli_disabilita");
  if (nuclei.length !== 636 || figli.length !== 3816) {
    throw new Error("inps-assegno-unico: conteggio tabelle divergente");
  }

  const nucleiKeys = new Set(
    nuclei.map((row) => `${row.year}|${row.province}|${row.childrenDisabilityFlag}`),
  );
  if (nucleiKeys.size !== 636) {
    throw new Error("inps-assegno-unico: chiavi nuclei non uniche");
  }
  const figliKeys = new Set(
    figli.map(
      (row) =>
        `${row.year}|${row.province}|${row.childrenDisabilityFlag}|${"iseeClass" in row ? row.iseeClass : ""}|${"ageClass" in row ? row.ageClass : ""}`,
    ),
  );
  if (figliKeys.size !== 3816) {
    throw new Error("inps-assegno-unico: chiavi figli non uniche");
  }

  if (!data.caveats.some((item) => /esclusi beneficiari RdC/i.test(item))) {
    throw new Error("inps-assegno-unico: manca il caveat RdC");
  }
  if (!data.caveats.some((item) => /millesimi/i.test(item))) {
    throw new Error("inps-assegno-unico: manca il caveat millesimi");
  }

  return { data, metadata };
}
