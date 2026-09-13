import { createHash } from "node:crypto";
import { z } from "zod";
import sourceLock from "../../../scripts/etl/specs/eu-vat-gap-italy.source.json";

const integer = z.number().int().refine(Number.isSafeInteger, "Intero non sicuro");
const date = z.string().regex(/^\d{4}-\d{2}-\d{2}$/).refine((value) => {
  const parsed = new Date(`${value}T00:00:00Z`);
  return !Number.isNaN(parsed.getTime()) && parsed.toISOString().slice(0, 10) === value;
}, "Data non valida");
const sha256 = z.string().regex(/^[a-f0-9]{64}$/);
const officialTaxudUrl = z.string().url().refine((value) => {
  const url = new URL(value);
  return url.protocol === "https:" && url.hostname === "taxation-customs.ec.europa.eu"
    && !url.username && !url.password && !url.port;
}, "Fonte non ufficiale DG TAXUD");
const evidenceUrl = z.string().url().refine((value) => {
  const url = new URL(value);
  return url.protocol === "https:"
    && (url.hostname === "taxation-customs.ec.europa.eu" || url.hostname === "op.europa.eu")
    && !url.username && !url.password && !url.port;
}, "URL evidenza non ufficiale");

export const euVatGapCellSchema = z.object({
  value: integer.nullable(),
  status: z.enum(["observed", "missing", "unavailable"]),
}).strict().refine((cell) => (cell.status === "observed") === (cell.value !== null), "Stato e valore della cella incoerenti");

const compositionRow = z.object({
  id: z.string().min(1),
  sourceLabel: z.string().min(1),
  amountCents: euVatGapCellSchema,
}).strict();

const yearRow = z.object({
  year: z.number().int().min(2019).max(2024),
  estimateKind: z.enum(["standard", "rapid-estimate"]),
  sourceYearLabel: z.string().min(1),
  vttlCents: euVatGapCellSchema,
  vatRevenueCents: euVatGapCellSchema,
  complianceGapCents: euVatGapCellSchema,
  complianceGapShareMillionths: euVatGapCellSchema,
  vttlComposition: z.array(compositionRow).length(5),
}).strict();

export const euVatGapItalyDataSchema = z.object({
  schemaVersion: z.literal(1),
  datasetId: z.literal("eu-vat-gap-italy"),
  geography: z.object({ code: z.literal("IT"), label: z.literal("Italia") }).strict(),
  period: z.object({ from: z.literal(2019), to: z.literal(2024) }).strict(),
  units: z.object({
    money: z.literal("euro-cents"),
    sourceMoney: z.literal("million-euro"),
    complianceGapShare: z.literal("millionths-of-unity"),
    gapChange: z.literal("tenths-of-a-percentage-point"),
  }).strict(),
  caveats: z.array(z.string().min(1)).min(5),
  years: z.array(yearRow).length(6),
  gapChangeSince2019: z.object({
    asOfYear: z.literal(2023),
    sourceLabel: z.string().min(1),
    valueTenthsOfPp: euVatGapCellSchema,
    sourceText: z.literal("-4.2pp"),
  }).strict(),
}).strict();

export const euVatGapItalyMetadataSchema = z.object({
  schemaVersion: z.literal(1),
  datasetId: z.literal("eu-vat-gap-italy"),
  period: z.object({ from: z.literal(2019), to: z.literal(2024) }).strict(),
  observedAt: date,
  source: z.object({
    owner: z.literal("Commissione europea, DG TAXUD"),
    landingUrl: officialTaxudUrl,
    url: officialTaxudUrl,
    filename: z.string().min(1),
    licenseId: z.literal("not-declared"),
    licenseNote: z.string().min(1),
    evidenceUrls: z.array(evidenceUrl).min(1),
    publicationDate: date,
    acquiredAt: date,
    checkedAt: date,
    bytes: integer.refine((value) => value > 0),
    sha256,
    path: z.string().min(1),
    geography: z.string().min(1),
    updateFrequency: z.literal("annuale"),
  }).strict(),
  coverage: z.object({
    years: z.literal(6),
    coreMeasures: z.literal(4),
    compositionRows: z.literal(5),
  }).strict(),
  integrity: z.object({
    sourceLockSha256: sha256,
    dataSha256: sha256,
    dataBytes: integer.refine((value) => value > 0),
  }).strict(),
  semantics: z.object({
    soldi: z.object({
      unit: z.literal("euro-cents"),
      sourceUnit: z.literal("million-euro"),
      nature: z.literal("stima compliance gap / VTTL / VAT revenue DG TAXUD; non gettito riscosso MEF né NOE ISTAT"),
    }).strict(),
    periodo: z.object({
      referencePeriod: z.literal("2019-2024"),
      rapidEstimateYear: z.literal(2024),
    }).strict(),
    provenance: z.object({
      holder: z.literal("Commissione europea, DG TAXUD"),
      publicationDate: date,
      acquiredAt: date,
      checkedAt: date,
    }).strict(),
  }).strict(),
}).strict();

export type EuVatGapItalyData = z.infer<typeof euVatGapItalyDataSchema>;
export type EuVatGapItalyMetadata = z.infer<typeof euVatGapItalyMetadataSchema>;
export type EuVatGapCell = z.infer<typeof euVatGapCellSchema>;

function canonicalJson(value: unknown): string {
  if (Array.isArray(value)) return `[${value.map(canonicalJson).join(",")}]`;
  if (value !== null && typeof value === "object") {
    return `{${Object.entries(value).sort(([a], [b]) => a < b ? -1 : a > b ? 1 : 0)
      .map(([key, item]) => `${JSON.stringify(key)}:${canonicalJson(item)}`).join(",")}}`;
  }
  return JSON.stringify(value);
}

const digest = (value: string) => createHash("sha256").update(value, "utf8").digest("hex");

function requireEqual(actual: unknown, expected: unknown, label: string) {
  if (canonicalJson(actual) !== canonicalJson(expected)) {
    throw new Error(`EU VAT gap Italy: ${label} incoerente con la fonte verificata.`);
  }
}

export function validateEuVatGapItalyBundle(
  dataInput: unknown,
  metadataInput: unknown,
): { data: EuVatGapItalyData; metadata: EuVatGapItalyMetadata } {
  const data = euVatGapItalyDataSchema.parse(dataInput);
  const metadata = euVatGapItalyMetadataSchema.parse(metadataInput);
  const lockDigest = digest(canonicalJson({
    ...sourceLock,
    integrity: { ...sourceLock.integrity, lockSha256: "" },
  }));
  requireEqual(lockDigest, sourceLock.integrity.lockSha256, "hash source lock");
  requireEqual(metadata.integrity.sourceLockSha256, lockDigest, "hash metadata/source lock");
  requireEqual(digest(canonicalJson(dataInput)), sourceLock.dataCanonicalSha256, "digest canonico dati");
  const artifact = `${JSON.stringify(dataInput, null, 2)}\n`;
  requireEqual(metadata.integrity.dataSha256, digest(artifact), "hash artifact");
  requireEqual(metadata.integrity.dataBytes, Buffer.byteLength(artifact, "utf8"), "byte artifact");
  requireEqual(metadata.observedAt, sourceLock.source.acquiredAt, "osservazione");
  requireEqual(metadata.source.owner, sourceLock.source.owner, "titolare");
  requireEqual(metadata.source.url, sourceLock.source.url, "url");
  requireEqual(metadata.source.landingUrl, sourceLock.source.landingUrl, "landing");
  requireEqual(metadata.source.licenseId, sourceLock.source.licenseId, "licenza");
  requireEqual(metadata.source.bytes, sourceLock.source.bytes, "bytes");
  requireEqual(metadata.source.sha256, sourceLock.source.sha256, "sha256 sorgente");
  requireEqual(metadata.source.publicationDate, sourceLock.source.publicationDate, "pubblicazione");
  requireEqual(metadata.source.acquiredAt, sourceLock.source.acquiredAt, "acquisizione");
  requireEqual(metadata.source.checkedAt, sourceLock.source.checkedAt, "controllo");
  if (metadata.source.checkedAt < metadata.source.acquiredAt) {
    throw new Error("EU VAT gap Italy: verifica precedente all'acquisizione.");
  }
  if (metadata.source.publicationDate > metadata.source.acquiredAt) {
    throw new Error("EU VAT gap Italy: pubblicazione successiva all'acquisizione.");
  }

  const compositionIds = sourceLock.expected.vttlComposition.map((entry) => entry.id);
  for (const [index, year] of data.years.entries()) {
    const locked = sourceLock.expected.years[index];
    requireEqual(year.year, locked.year, "anno");
    requireEqual(year.estimateKind, locked.estimateKind, "estimateKind");
    requireEqual(year.sourceYearLabel, locked.sourceYearLabel, "sourceYearLabel");
    if (year.vttlCents.status !== "observed" || year.vatRevenueCents.status !== "observed"
      || year.complianceGapCents.status !== "observed"
      || year.complianceGapShareMillionths.status !== "observed") {
      throw new Error("EU VAT gap Italy: misure core non osservate.");
    }
    if (year.vttlCents.value! - year.vatRevenueCents.value! !== year.complianceGapCents.value) {
      throw new Error("EU VAT gap Italy: VTTL − VAT revenue ≠ compliance gap.");
    }
    requireEqual(year.vttlComposition.map((row) => row.id), compositionIds, "composition ids");
    for (const [compIndex, row] of year.vttlComposition.entries()) {
      requireEqual(row.sourceLabel, sourceLock.expected.vttlComposition[compIndex].sourceLabel, "composition label");
      if (year.year === 2024) {
        if (row.amountCents.status !== "unavailable" || row.amountCents.value !== null) {
          throw new Error("EU VAT gap Italy: composizione 2024 deve restare unavailable.");
        }
      } else if (row.amountCents.status !== "observed" || row.amountCents.value === null) {
        throw new Error("EU VAT gap Italy: composizione 2019-2023 deve essere osservata.");
      }
    }
  }
  requireEqual(data.gapChangeSince2019.asOfYear, sourceLock.expected.gapChangeSince2019.asOfYear, "asOfYear");
  requireEqual(
    data.gapChangeSince2019.valueTenthsOfPp.value,
    sourceLock.expected.gapChangeSince2019.valueTenthsOfPp,
    "gap change",
  );
  if (data.years.filter((year) => year.estimateKind === "rapid-estimate").length !== 1
    || data.years.at(-1)?.year !== 2024) {
    throw new Error("EU VAT gap Italy: stima rapida 2024 assente o fuori posto.");
  }
  return { data, metadata };
}
