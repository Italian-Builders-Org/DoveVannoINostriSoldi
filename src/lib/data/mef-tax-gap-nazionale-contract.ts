import { createHash } from "node:crypto";
import { z } from "zod";
import sourceLock from "../../../scripts/etl/specs/mef-tax-gap-nazionale.source.json";

const integer = z.number().int().refine(Number.isSafeInteger, "Intero non sicuro");
const date = z.string().regex(/^\d{4}-\d{2}-\d{2}$/).refine((value) => {
  const parsed = new Date(`${value}T00:00:00Z`);
  return !Number.isNaN(parsed.getTime()) && parsed.toISOString().slice(0, 10) === value;
}, "Data non valida");
const sha256 = z.string().regex(/^[a-f0-9]{64}$/);
const officialMefUrl = z.string().url().refine((value) => {
  const url = new URL(value);
  return url.protocol === "https:" && url.hostname === "www.mef.gov.it"
    && !url.username && !url.password && !url.port;
}, "Fonte non ufficiale MEF");

const gapCellSchema = z.object({
  status: z.literal("observed"),
  shape: z.enum(["point", "range"]),
  minCents: integer.nullable(),
  maxCents: integer.nullable(),
  valueCents: integer.nullable(),
}).strict().superRefine((cell, ctx) => {
  if (cell.shape === "point") {
    if (cell.valueCents === null || cell.minCents !== null || cell.maxCents !== null) {
      ctx.addIssue({ code: "custom", message: "Cella gap point incoerente" });
    }
  } else if (cell.minCents === null || cell.maxCents === null || cell.valueCents !== null) {
    // Min/Max are the source hypothesis columns, not a sorted numeric interval:
    // differences can have minCents > maxCents when both are negative.
    ctx.addIssue({ code: "custom", message: "Cella gap range incoerente" });
  }
});

const propensioneCellSchema = z.object({
  status: z.enum(["observed", "absent"]),
  shape: z.enum(["point", "range", "absent"]),
  minTenthsPp: integer.nullable(),
  maxTenthsPp: integer.nullable(),
  valueTenthsPp: integer.nullable(),
}).strict().superRefine((cell, ctx) => {
  if (cell.status === "absent") {
    if (cell.shape !== "absent" || cell.minTenthsPp !== null || cell.maxTenthsPp !== null
      || cell.valueTenthsPp !== null) {
      ctx.addIssue({ code: "custom", message: "Cella propensione absent incoerente" });
    }
    return;
  }
  if (cell.shape === "point") {
    if (cell.valueTenthsPp === null || cell.minTenthsPp !== null || cell.maxTenthsPp !== null) {
      ctx.addIssue({ code: "custom", message: "Cella propensione point incoerente" });
    }
  } else if (cell.shape === "range") {
    if (cell.minTenthsPp === null || cell.maxTenthsPp === null || cell.valueTenthsPp !== null) {
      ctx.addIssue({ code: "custom", message: "Cella propensione range incoerente" });
    }
  } else {
    ctx.addIssue({ code: "custom", message: "Shape propensione osservata non valida" });
  }
});

const yearRowSchema = z.object({
  year: z.number().int().min(2018).max(2022),
  gap: gapCellSchema,
  propensione: propensioneCellSchema,
}).strict();

const taxRowSchema = z.object({
  id: z.string().min(1),
  sourceLabel: z.string().min(1),
  shape: z.enum(["point", "range"]),
  series: z.array(yearRowSchema).length(5),
  difference2022vs2018: z.object({
    gap: gapCellSchema,
    propensione: propensioneCellSchema,
  }).strict(),
  average2018to2022: z.object({
    gap: gapCellSchema,
    propensione: propensioneCellSchema,
  }).strict(),
}).strict();

export const mefTaxGapNazionaleDataSchema = z.object({
  schemaVersion: z.literal(1),
  datasetId: z.literal("mef-tax-gap-nazionale"),
  geography: z.object({ code: z.literal("IT"), label: z.literal("Italia") }).strict(),
  period: z.object({ from: z.literal(2018), to: z.literal(2022) }).strict(),
  units: z.object({
    money: z.literal("euro-cents"),
    sourceMoney: z.literal("million-euro"),
    propensione: z.literal("tenths-of-a-percentage-point"),
  }).strict(),
  caveats: z.array(z.string().min(1)).min(5),
  taxRows: z.array(taxRowSchema).length(16),
}).strict();

export const mefTaxGapNazionaleMetadataSchema = z.object({
  schemaVersion: z.literal(1),
  datasetId: z.literal("mef-tax-gap-nazionale"),
  period: z.object({ from: z.literal(2018), to: z.literal(2022) }).strict(),
  observedAt: date,
  source: z.object({
    owner: z.literal("MEF — Commissione ex art. 10-bis.1 L. 196/2009"),
    landingUrl: officialMefUrl,
    url: officialMefUrl,
    filename: z.string().min(1),
    versionDate: date,
    licenseId: z.literal("not-declared"),
    licenseNote: z.string().min(1),
    publicationDate: date.nullable(),
    acquiredAt: date,
    checkedAt: date,
    bytes: integer.refine((value) => value > 0),
    sha256,
    path: z.string().min(1),
    geography: z.string().min(1),
    updateFrequency: z.literal("annuale"),
  }).strict(),
  coverage: z.object({
    years: z.literal(5),
    taxRows: z.literal(16),
    propensioneRows: z.literal(12),
    tables: z.tuple([z.literal("I.1"), z.literal("I.2")]),
  }).strict(),
  pdf: z.object({
    tableI1PageIndex: z.literal(8),
    tableI2PageIndex: z.literal(9),
    tableI1Title: z.string().min(1),
    tableI2Title: z.string().min(1),
    tableI1TextSha256: sha256,
    tableI2TextSha256: sha256,
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
      nature: z.literal("stima tax gap MEF (tributario/contributivo); non accertamento né recupero"),
    }).strict(),
    periodo: z.object({
      referencePeriod: z.literal("2018-2022"),
      semiDefinitiveYear: z.literal(2022),
    }).strict(),
    provenance: z.object({
      holder: z.literal("MEF — Commissione ex art. 10-bis.1 L. 196/2009"),
      publicationDate: date.nullable(),
      acquiredAt: date,
      checkedAt: date,
    }).strict(),
  }).strict(),
}).strict();

export type MefTaxGapNazionaleData = z.infer<typeof mefTaxGapNazionaleDataSchema>;
export type MefTaxGapNazionaleMetadata = z.infer<typeof mefTaxGapNazionaleMetadataSchema>;

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
    throw new Error(`MEF tax gap nazionale: ${label} incoerente con la fonte verificata.`);
  }
}

export function validateMefTaxGapNazionaleBundle(
  dataInput: unknown,
  metadataInput: unknown,
): { data: MefTaxGapNazionaleData; metadata: MefTaxGapNazionaleMetadata } {
  const data = mefTaxGapNazionaleDataSchema.parse(dataInput);
  const metadata = mefTaxGapNazionaleMetadataSchema.parse(metadataInput);
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
  requireEqual(metadata.source, sourceLock.source, "provenance fonte");
  requireEqual(metadata.pdf, sourceLock.pdf, "riferimenti PDF");
  requireEqual(metadata.semantics.provenance, {
    holder: sourceLock.source.owner,
    publicationDate: sourceLock.source.publicationDate,
    acquiredAt: sourceLock.source.acquiredAt,
    checkedAt: sourceLock.source.checkedAt,
  }, "provenance semantica");
  if (metadata.source.checkedAt < metadata.source.acquiredAt) {
    throw new Error("MEF tax gap nazionale: verifica precedente all'acquisizione.");
  }
  if (metadata.source.publicationDate !== null && metadata.source.publicationDate > metadata.source.acquiredAt) {
    throw new Error("MEF tax gap nazionale: pubblicazione successiva all'acquisizione.");
  }
  requireEqual(
    data.taxRows.map((row) => row.id),
    sourceLock.expected.taxRowIds,
    "ordine righe",
  );
  for (const row of data.taxRows) {
    const contributive = row.id.startsWith("entrate-contributive")
      || row.id === "totale-entrate-contributive"
      || row.id === "totale-entrate-tributarie-e-contributive";
    for (const year of row.series) {
      if (year.gap.shape !== row.shape) {
        throw new Error("MEF tax gap nazionale: shape gap diversa dalla riga.");
      }
      if (contributive && year.propensione.status !== "absent") {
        throw new Error("MEF tax gap nazionale: propensione inventata su riga contributiva.");
      }
      if (!contributive && year.propensione.status !== "observed") {
        throw new Error("MEF tax gap nazionale: propensione assente su riga tributaria.");
      }
    }
  }
  return { data, metadata };
}
