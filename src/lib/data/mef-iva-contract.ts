import { createHash } from "node:crypto";
import { z } from "zod";
import sourceLock from "../../../scripts/etl/specs/mef-iva-2024-2025.source.json";

const integer = z.number().int().refine(Number.isSafeInteger, "Intero non sicuro");
const date = z.string().regex(/^\d{4}-\d{2}-\d{2}$/).refine((value) => {
  const parsed = new Date(`${value}T00:00:00Z`);
  return !Number.isNaN(parsed.getTime()) && parsed.toISOString().slice(0, 10) === value;
}, "Data non valida");
const officialUrl = z.string().url().refine((value) => {
  const url = new URL(value);
  return url.protocol === "https:" && url.hostname === "www1.finanze.gov.it" && !url.username && !url.password && !url.port;
}, "Fonte non ufficiale");
const sha256 = z.string().regex(/^[a-f0-9]{64}$/);
export const mefIvaCellSchema = z.object({
  value: integer.nullable(),
  status: z.enum(["observed", "suppressed", "missing"]),
}).strict().refine((cell) => (cell.status === "observed") === (cell.value !== null), "Stato e valore della cella incoerenti");
const measure = z.object({
  id: z.string().min(1), label: z.string().min(1), frequencyUnit: z.literal("count"),
  amountUnit: z.literal("euro-cents"), meanUnit: z.literal("euro-cents"),
  sourceUnit: z.literal("thousand-euros"), amountDecimals: z.literal(0), meanDecimals: z.literal(2), allowNegative: z.boolean(),
}).strict();
const row = z.object({
  id: z.string().min(1), sourceCode: z.string().min(1), label: z.string().min(1),
  kind: z.enum(["territory", "activity", "unspecified", "total"]),
  taxpayers: mefIvaCellSchema,
  values: z.array(z.object({ measureId: z.string().min(1), frequency: mefIvaCellSchema,
    amountCents: mefIvaCellSchema, meanCents: mefIvaCellSchema }).strict()).length(10),
}).strict();
const table = z.object({
  id: z.string().min(1), declarationYear: z.union([z.literal(2024), z.literal(2025)]),
  taxYear: z.union([z.literal(2023), z.literal(2024)]), breakdown: z.enum(["regione", "attivita"]),
  publicationDate: date, classificationEdition: z.string().min(1), sourceUrl: officialUrl,
  measures: z.array(measure).length(10), rows: z.array(row).min(1),
}).strict();
export const mefIvaDataSchema = z.object({
  schemaVersion: z.literal(1), datasetId: z.literal("mef-iva"), tables: z.array(table).length(4),
  caveats: z.array(z.string().min(1)).min(1),
}).strict();
const receipt = z.object({ url: officialUrl, sha256, bytes: integer.refine((v) => v > 0), filename: z.string().min(1) }).strict();
const period = z.object({ from: z.literal(2024), to: z.literal(2025) }).strict();
const taxPeriod = z.object({ from: z.literal(2023), to: z.literal(2024) }).strict();
export const mefIvaMetadataSchema = z.object({
  schemaVersion: z.literal(1), datasetId: z.literal("mef-iva"), period, taxPeriod, observedAt: date,
  source: z.object({
    owner: z.literal("MEF - Dipartimento delle Finanze"), landingUrl: officialUrl,
    licenseId: z.literal("CC-BY-3.0-IT"), licenseUrl: z.literal("http://creativecommons.org/licenses/by/3.0/it/"),
    acquiredAt: date, checkedAt: date, encoding: z.literal("utf-8-sig"), delimiter: z.literal(";"),
    files: z.record(z.string(), z.object({ csv: receipt, html: receipt }).strict()),
  }).strict(),
  coverage: z.object({ tables: z.literal(4), rows: z.literal(93) }).strict(),
  integrity: z.object({ sourceLockSha256: sha256, dataSha256: sha256, dataBytes: integer.refine((v) => v > 0) }).strict(),
  semantics: z.object({
    soldi: z.object({ unit: z.literal("euro-cents"), sourceUnit: z.literal("thousand-euros"),
      nature: z.literal("dichiarazioni IVA, non gettito riscosso; frequenza e contribuenti sono conteggi") }).strict(),
    periodo: z.object({ referencePeriod: z.literal("2023-2024"), declarationPeriod: z.literal("2024-2025") }).strict(),
    provenance: z.object({ holder: z.literal("MEF - Dipartimento delle Finanze"),
      publicationDates: z.record(z.string(), date), acquiredAt: date, checkedAt: date }).strict(),
  }).strict(),
}).strict();

export type MefIvaData = z.infer<typeof mefIvaDataSchema>;
export type MefIvaMetadata = z.infer<typeof mefIvaMetadataSchema>;
export type MefIvaCell = z.infer<typeof mefIvaCellSchema>;

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
  if (canonicalJson(actual) !== canonicalJson(expected)) throw new Error(`MEF IVA: ${label} incoerente con la fonte verificata.`);
}

export function validateMefIvaBundle(dataInput: unknown, metadataInput: unknown): { data: MefIvaData; metadata: MefIvaMetadata } {
  const data = mefIvaDataSchema.parse(dataInput);
  const metadata = mefIvaMetadataSchema.parse(metadataInput);
  const lockDigest = digest(canonicalJson({ ...sourceLock, integrity: { ...sourceLock.integrity, lockSha256: "" } }));
  requireEqual(lockDigest, sourceLock.integrity.lockSha256, "hash source lock");
  requireEqual(metadata.integrity.sourceLockSha256, lockDigest, "hash metadata/source lock");
  // The separately reviewed source lock binds the cells, including suppressed vs
  // missing. Rewriting a cell AND its self-reported metadata hash cannot pass.
  requireEqual(digest(canonicalJson(dataInput)), sourceLock.dataCanonicalSha256, "digest canonico dati");
  const artifact = `${JSON.stringify(dataInput, null, 2)}\n`;
  requireEqual(metadata.integrity.dataSha256, digest(artifact), "hash artifact");
  requireEqual(metadata.integrity.dataBytes, Buffer.byteLength(artifact, "utf8"), "byte artifact");
  requireEqual(metadata.source, {
    ...sourceLock.source,
    files: Object.fromEntries(sourceLock.tables.map((entry) => [entry.id, entry.receipts])),
  }, "provenance");
  requireEqual(metadata.observedAt, sourceLock.source.acquiredAt, "osservazione");
  requireEqual(metadata.semantics.provenance, {
    holder: sourceLock.source.owner,
    publicationDates: Object.fromEntries(sourceLock.tables.map((entry) => [entry.id, entry.publicationDate])),
    acquiredAt: sourceLock.source.acquiredAt, checkedAt: sourceLock.source.checkedAt,
  }, "date provenance");
  if (metadata.source.checkedAt < metadata.source.acquiredAt) throw new Error("MEF IVA: verifica precedente all'acquisizione.");

  const totals = new Map<number, unknown>();
  for (const [index, current] of data.tables.entries()) {
    const locked = sourceLock.tables[index];
    for (const key of ["id", "declarationYear", "taxYear", "breakdown", "publicationDate", "classificationEdition", "sourceUrl", "measures"] as const) {
      requireEqual(current[key], locked[key], `tabella ${key}`);
    }
    if (current.publicationDate > metadata.source.acquiredAt) throw new Error("MEF IVA: pubblicazione successiva all'acquisizione.");
    requireEqual(current.rows.length, locked.dictionary.length, "numero righe");
    for (const [rowIndex, item] of current.rows.entries()) {
      const entry = locked.dictionary[rowIndex];
      for (const key of ["id", "sourceCode", "label", "kind"] as const) requireEqual(item[key], entry[key], `dizionario ${key}`);
      const cells: [MefIvaCell, boolean, number][] = [[item.taxpayers, false, 1]];
      item.values.forEach((value, measureIndex) => {
        const definition = current.measures[measureIndex];
        requireEqual(value.measureId, definition.id, "misura");
        cells.push([value.frequency, false, 1], [value.amountCents, definition.allowNegative, 100_000], [value.meanCents, definition.allowNegative, 1_000]);
        if (value.frequency.value !== null && item.taxpayers.value !== null && value.frequency.value > item.taxpayers.value) {
          throw new Error("MEF IVA: frequenza superiore ai contribuenti.");
        }
      });
      for (const [cell, allowNegative, quantum] of cells) {
        if (cell.value !== null && ((!allowNegative && cell.value < 0) || cell.value % quantum !== 0)) {
          throw new Error("MEF IVA: segno o precisione della fonte non validi.");
        }
      }
    }
    const total = current.rows.at(-1)!;
    if (total.kind !== "total" || current.rows.filter((item) => item.kind === "total").length !== 1) {
      throw new Error("MEF IVA: totale ufficiale mancante o duplicato.");
    }
    // Only reconcile fully observed cells, never infer suppressed values. The
    // published amounts are rounded independently to thousands of euros.
    const reconcile = (cells: MefIvaCell[], monetary: boolean) => {
      if (cells.some((cell) => cell.value === null)) return;
      const sum = cells.slice(0, -1).reduce((acc, cell) => acc + BigInt(cell.value!), BigInt(0));
      const difference = sum - BigInt(cells.at(-1)!.value!);
      const tolerance = monetary ? BigInt(cells.length * 50_000) : BigInt(0);
      if (difference > tolerance || difference < -tolerance) throw new Error("MEF IVA: riconciliazione del totale fallita.");
    };
    reconcile(current.rows.map((item) => item.taxpayers), false);
    current.measures.forEach((_, measureIndex) => {
      reconcile(current.rows.map((item) => item.values[measureIndex].frequency), false);
      reconcile(current.rows.map((item) => item.values[measureIndex].amountCents), true);
    });
    const comparable = { taxpayers: total.taxpayers, values: total.values };
    if (totals.has(current.declarationYear)) requireEqual(comparable, totals.get(current.declarationYear), "totali fra tagli");
    totals.set(current.declarationYear, comparable);
  }
  requireEqual(data.tables.reduce((sum, current) => sum + current.rows.length, 0), metadata.coverage.rows, "copertura righe");
  return { data, metadata };
}
