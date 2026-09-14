import { createHash } from "node:crypto";
import { z } from "zod";
import sourceLock from "../../../scripts/etl/specs/eurostat-taxag-2014-2025.source.json";

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

export const EUROSTAT_TAXAG_PUBLISHED_ITEMS = [
  "D2_D5_D91_D61_M_D995",
  "D2_D5_D91",
  "D2",
  "D21",
  "D211",
  "D214",
  "D5",
  "D51",
  "D51A",
  "D51B",
  "D61",
  "D611",
  "D91",
  "D29A",
] as const;

export const EUROSTAT_TAXAG_SECTORS = ["S13", "S1311", "S1313", "S1314"] as const;

const observationSchema = z.object({
  naItem: z.enum(EUROSTAT_TAXAG_PUBLISHED_ITEMS),
  naItemLabelIt: z.string().min(1),
  naItemLabelEn: z.string().min(1),
  sector: z.enum(EUROSTAT_TAXAG_SECTORS),
  sectorLabelIt: z.string().min(1),
  year: z.number().int().min(2014).max(2025),
  status: z.enum(["observed", "absent"]),
  amountCents: integer.nullable(),
  flag: z.string().nullable(),
}).strict().superRefine((row, ctx) => {
  if (row.status === "observed") {
    if (row.amountCents === null) {
      ctx.addIssue({ code: "custom", message: "Cella observed senza importo" });
    }
  } else if (row.amountCents !== null) {
    ctx.addIssue({ code: "custom", message: "Cella absent con importo" });
  }
});

export const eurostatTaxagDataSchema = z.object({
  schemaVersion: z.literal(1),
  datasetId: z.literal("eurostat-taxag"),
  geography: z.object({ code: z.literal("IT"), label: z.literal("Italia") }).strict(),
  period: z.object({ from: z.literal(2014), to: z.literal(2025) }).strict(),
  units: z.object({
    money: z.literal("euro-cents"),
    sourceMoney: z.literal("million-euro"),
  }).strict(),
  sectors: z.array(z.object({
    code: z.enum(EUROSTAT_TAXAG_SECTORS),
    labelIt: z.string().min(1),
  }).strict()).length(4),
  items: z.array(z.object({
    code: z.enum(EUROSTAT_TAXAG_PUBLISHED_ITEMS),
    labelIt: z.string().min(1),
    expectedSectors: z.array(z.enum(EUROSTAT_TAXAG_SECTORS)).min(1),
  }).strict()).length(14),
  coverage: z.object({
    publishedItems: z.literal(14),
    sectors: z.literal(4),
    years: z.literal(12),
    observedCells: z.literal(516),
    absentCells: z.literal(156),
    totalCells: z.literal(672),
  }).strict(),
  caveats: z.array(z.string().min(1)).min(5),
  observations: z.array(observationSchema).length(672),
}).strict();

export const eurostatTaxagMetadataSchema = z.object({
  schemaVersion: z.literal(1),
  datasetId: z.literal("eurostat-taxag"),
  period: z.object({ from: z.literal(2014), to: z.literal(2025) }).strict(),
  observedAt: date,
  source: z.object({
    owner: z.literal("Eurostat (Commissione europea)"),
    datasetCode: z.literal("gov_10a_taxag"),
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
          id: z.literal("GOV_10A_TAXAG"),
          agencyId: z.literal("ESTAT"),
          version: z.string().min(1),
        }).strict(),
      }).strict(),
    }).strict(),
  }).strict(),
  coverage: eurostatTaxagDataSchema.shape.coverage,
  integrity: z.object({
    algorithm: z.literal("sha256"),
    canonicalization: z.string().min(1),
    dataArtifact: z.object({
      path: z.literal("src/data/generated/eurostat-taxag-2014-2025.data.json"),
      bytes: integer.refine((value) => value > 0),
      sha256,
    }).strict(),
    sourceLockSha256: sha256,
  }).strict(),
  semantics: z.object({
    soldi: z.object({
      unit: z.literal("euro-cents"),
      sourceUnit: z.literal("million-euro"),
      nature: z.literal("gettito SEC 2010 (competenza); non cassa e non tax gap"),
    }).strict(),
    periodo: z.object({
      referencePeriod: z.literal("2014-2025"),
      frequency: z.literal("annuale"),
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

export type EurostatTaxagData = z.infer<typeof eurostatTaxagDataSchema>;
export type EurostatTaxagMetadata = z.infer<typeof eurostatTaxagMetadataSchema>;

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
    throw new Error(`eurostat-taxag: ${label} incoerente con la fonte verificata`);
  }
}

export function validateEurostatTaxagBundle(
  dataInput: unknown,
  metadataInput: unknown,
): { data: EurostatTaxagData; metadata: EurostatTaxagMetadata } {
  const data = eurostatTaxagDataSchema.parse(dataInput);
  const metadata = eurostatTaxagMetadataSchema.parse(metadataInput);

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
  requireEqual(
    metadata.integrity.dataArtifact.bytes,
    sourceLock.integrity.dataArtifact.bytes,
    "byte data artifact nel lock",
  );
  requireEqual(metadata.source.landingUrl, sourceLock.source.landingUrl, "landing");
  requireEqual(metadata.source.assets["mio-eur"].sha256, sourceLock.source.assets["mio-eur"].sha256, "hash asset");
  requireEqual(metadata.source.assets["mio-eur"].bytes, sourceLock.source.assets["mio-eur"].bytes, "byte asset");
  requireEqual(metadata.source.assets["mio-eur"].url, sourceLock.source.assets["mio-eur"].url, "url asset");
  requireEqual(metadata.observedAt, sourceLock.source.acquisition.checkedAt, "observedAt");
  requireEqual(metadata.semantics.provenance.checkedAt, sourceLock.source.acquisition.checkedAt, "provenance checkedAt");
  requireEqual(
    metadata.semantics.provenance.acquisitionDate,
    sourceLock.source.acquisition.acquiredAt,
    "provenance acquisition",
  );
  requireEqual(
    data.items.map((item) => item.code),
    sourceLock.expected.publishedItems,
    "ordine voci",
  );

  const observed = data.observations.filter((row) => row.status === "observed");
  if (observed.length !== sourceLock.expected.observedCells) {
    throw new Error("eurostat-taxag: observedCells divergenti");
  }

  const byKey = new Map(
    observed.map((row) => [`${row.naItem}|${row.sector}|${row.year}`, row.amountCents] as const),
  );
  for (const sector of ["S13", "S1311", "S1313"] as const) {
    for (let year = 2014; year <= 2025; year += 1) {
      const total = byKey.get(`D2_D5_D91|${sector}|${year}`);
      const parts = (["D2", "D5", "D91"] as const)
        .map((code) => byKey.get(`${code}|${sector}|${year}`))
        .reduce<number | null>((sum, value) => {
          if (sum === null || value === null || value === undefined) return null;
          return sum + value;
        }, 0);
      if (total === undefined || parts === null || total !== parts) {
        throw new Error(`eurostat-taxag: riconciliazione D2_D5_D91 fallita per ${sector}/${year}`);
      }
    }
  }

  return { data, metadata };
}
