import { createHash } from "node:crypto";
import { z } from "zod";
import sourceLock from "../../../scripts/etl/specs/eurostat-sha-health-2014-2025.source.json";

const integer = z.number().int().refine(Number.isSafeInteger, "Intero non sicuro");
const date = z.string().regex(/^\d{4}-\d{2}-\d{2}$/).refine((value) => {
  const parsed = new Date(`${value}T00:00:00Z`);
  return !Number.isNaN(parsed.getTime()) && parsed.toISOString().slice(0, 10) === value;
}, "Data non valida");
const sha256 = z.string().regex(/^[a-f0-9]{64}$/);
const officialEurostatUrl = z.string().url().refine((value) => {
  const url = new URL(value);
  return url.protocol === "https:" && url.hostname === "ec.europa.eu"
    && !url.username && !url.password && !url.port
    && url.pathname.startsWith("/eurostat/");
}, "Fonte non ufficiale Eurostat");

export const EUROSTAT_SHA_SCHEMES = [
  "TOT_HF",
  "HF1",
  "HF11",
  "HF12_13",
  "HF121",
  "HF122",
  "HF13",
  "HF2",
  "HF21",
  "HF22",
  "HF23",
  "HF3",
  "HF_UNK",
] as const;

const observationSchema = z.object({
  scheme: z.enum(EUROSTAT_SHA_SCHEMES),
  schemeLabelIt: z.string().min(1),
  schemeLabelEn: z.string().min(1),
  year: z.number().int().min(2014).max(2025),
  status: z.literal("observed"),
  amountCents: integer,
  flag: z.enum(["p"]).nullable(),
}).strict();

export const eurostatShaHealthDataSchema = z.object({
  schemaVersion: z.literal(1),
  datasetId: z.literal("eurostat-sha-health"),
  geography: z.object({ code: z.literal("IT"), label: z.literal("Italia") }).strict(),
  period: z.object({ from: z.literal(2014), to: z.literal(2025) }).strict(),
  units: z.object({
    money: z.literal("euro-cents"),
    sourceMoney: z.literal("million-euro"),
  }).strict(),
  schemes: z.array(z.object({
    code: z.enum(EUROSTAT_SHA_SCHEMES),
    labelIt: z.string().min(1),
  }).strict()).length(13),
  coverage: z.object({
    publishedSchemes: z.literal(13),
    years: z.literal(12),
    observedCells: z.literal(156),
    provisionalYears: z.tuple([z.literal(2025)]),
  }).strict(),
  caveats: z.array(z.string().min(1)).min(4),
  observations: z.array(observationSchema).length(156),
}).strict();

export const eurostatShaHealthMetadataSchema = z.object({
  schemaVersion: z.literal(1),
  datasetId: z.literal("eurostat-sha-health"),
  period: z.object({ from: z.literal(2014), to: z.literal(2025) }).strict(),
  observedAt: date,
  source: z.object({
    owner: z.literal("Eurostat (Commissione europea)"),
    datasetCode: z.literal("hlth_sha11_hf"),
    datasetLabel: z.string().min(1),
    landingUrl: officialEurostatUrl,
    termsUrl: officialEurostatUrl,
    licenseId: z.literal("CC-BY-4.0"),
    licenseNote: z.string().min(1),
    publicationDate: date,
    acquiredAt: date,
    checkedAt: date,
    updateFrequency: z.literal("annuale"),
    assets: z.object({
      "mio-eur": z.object({
        url: officialEurostatUrl,
        bytes: integer.refine((value) => value > 0),
        sha256,
        sourceUpdated: z.string().min(1),
        structure: z.object({
          id: z.literal("HLTH_SHA11_HF"),
          agencyId: z.literal("ESTAT"),
          version: z.string().min(1),
        }).strict(),
      }).strict(),
    }).strict(),
  }).strict(),
  coverage: eurostatShaHealthDataSchema.shape.coverage,
  integrity: z.object({
    algorithm: z.literal("sha256"),
    canonicalization: z.string().min(1),
    dataArtifact: z.object({
      path: z.literal("src/data/generated/eurostat-sha-health-2014-2025.data.json"),
      bytes: integer.refine((value) => value > 0),
      sha256,
    }).strict(),
    sourceLockSha256: sha256,
  }).strict(),
  semantics: z.object({
    soldi: z.object({
      unit: z.literal("euro-cents"),
      sourceUnit: z.literal("million-euro"),
      nature: z.literal("spesa sanitaria SHA per schema di finanziamento; non CE SSN né COFOG"),
    }).strict(),
    periodo: z.object({
      referencePeriod: z.literal("2014-2025"),
      frequency: z.literal("annuale"),
      provisionalYear: z.literal(2025),
    }).strict(),
    provenance: z.object({
      holder: z.literal("Eurostat (Commissione europea)"),
      canonicalUrls: z.array(officialEurostatUrl).min(2),
      publicationDate: date,
      acquisitionDate: date,
      checkedAt: date,
      license: z.literal("CC-BY-4.0"),
    }).strict(),
  }).strict(),
}).strict();

export type EurostatShaHealthData = z.infer<typeof eurostatShaHealthDataSchema>;
export type EurostatShaHealthMetadata = z.infer<typeof eurostatShaHealthMetadataSchema>;

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
    throw new Error(`eurostat-sha-health: ${label} incoerente con la fonte verificata`);
  }
}

export function validateEurostatShaHealthBundle(
  dataInput: unknown,
  metadataInput: unknown,
): { data: EurostatShaHealthData; metadata: EurostatShaHealthMetadata } {
  const data = eurostatShaHealthDataSchema.parse(dataInput);
  const metadata = eurostatShaHealthMetadataSchema.parse(metadataInput);

  const lockDigest = digest(canonicalJson({
    ...sourceLock,
    integrity: { ...sourceLock.integrity, lockSha256: "" },
  }));
  requireEqual(lockDigest, sourceLock.integrity.lockSha256, "hash source lock");
  requireEqual(metadata.integrity.sourceLockSha256, lockDigest, "hash metadata/source lock");
  requireEqual(
    metadata.integrity.dataArtifact.sha256,
    sourceLock.integrity.dataArtifact.sha256,
    "hash data artifact nel lock",
  );
  requireEqual(metadata.source.assets["mio-eur"].sha256, sourceLock.source.assets["mio-eur"].sha256, "hash asset");
  requireEqual(metadata.source.landingUrl, sourceLock.source.landingUrl, "landing");
  requireEqual(data.schemes.map((item) => item.code), sourceLock.expected.publishedSchemes, "ordine schemi");

  const byKey = new Map(data.observations.map((row) => [`${row.scheme}|${row.year}`, row.amountCents] as const));
  for (let year = 2014; year <= 2025; year += 1) {
    const total = byKey.get(`TOT_HF|${year}`);
    const parts = (["HF1", "HF2", "HF3", "HF_UNK"] as const)
      .map((code) => byKey.get(`${code}|${year}`))
      .reduce<number | null>((sum, value) => {
        if (sum === null || value === undefined) return null;
        return sum + value;
      }, 0);
    if (total === undefined || parts === null || total !== parts) {
      throw new Error(`eurostat-sha-health: riconciliazione TOT_HF fallita per ${year}`);
    }
  }

  return { data, metadata };
}
