import { createHash } from "node:crypto";
import { z } from "zod";

export const INTEGRATED_CORPUS_CONTRACT = {
  archiveEntries: 51_303,
  regularFiles: 46_438,
  hardlinks: 4_860,
  symlinks: 5,
  datasets: 79,
  sourceIdentities: 34_071,
  quarantinedSourceIdentities: 1_493,
  sourceRows: 13_321_128,
  publicRows: 338_782,
  catalogOnlyRows: 12_979_505,
  derivedOnlyRows: 2_841,
  sourceBytes: 2_537_014_778,
} as const;

export const INTEGRATED_ROW_CHUNK_ROWS = 1_000;
export const INTEGRATED_ROW_CHUNK_MAX_RAW_BYTES = 2 * 1024 * 1024;

export function integratedRowChunkCount(publicRows: number): number {
  return Math.ceil(publicRows / INTEGRATED_ROW_CHUNK_ROWS);
}

export function integratedRowChunkName(datasetId: string, ordinal: number): string {
  if (!/^[a-z0-9]+(?:-[a-z0-9]+)*$/.test(datasetId)) {
    throw new Error(`Identificativo dataset non valido: ${datasetId}`);
  }
  if (!Number.isSafeInteger(ordinal) || ordinal < 0 || ordinal > 99_999) {
    throw new Error(`Indice chunk non valido per ${datasetId}: ${ordinal}`);
  }
  return `${datasetId}.part-${String(ordinal).padStart(5, "0")}.jsonl.gz`;
}

const sha256Schema = z.string().regex(/^[0-9a-f]{64}$/);
const safeIntegerSchema = z.number().int().nonnegative().max(Number.MAX_SAFE_INTEGER);
const positiveSafeIntegerSchema = safeIntegerSchema.min(1);
const datasetIdSchema = z.string().regex(/^[a-z0-9]+(?:-[a-z0-9]+)*$/);
const reasonCodeSchema = z.string().regex(/^[a-z0-9]+(?:[_-][a-z0-9]+)*$/);
const isoDateSchema = z.string().regex(/^\d{4}-\d{2}-\d{2}$/);

export const publicationSchema = z.enum([
  "rows",
  "source-index",
  "catalog-only",
  "derived-only",
]);
export type IntegratedPublication = z.infer<typeof publicationSchema>;

export const evidenceLabelSchema = z.enum([
  "documented-fact",
  "missing-data",
  "verified-difference",
  "needs-explanation",
  "official-finding",
]);
export type IntegratedEvidenceLabel = z.infer<typeof evidenceLabelSchema>;

export const licenseStatusSchema = z.enum([
  "not-declared",
  "verified-open-cc-by-4.0",
]);
export type IntegratedLicenseStatus = z.infer<typeof licenseStatusSchema>;

export const integratedSourceMetadataSchema = z.object({
  holder: z.string().min(1),
  referencePeriod: z.string().min(1).nullable(),
  publicationDate: isoDateSchema.nullable(),
  acquisitionDate: isoDateSchema.nullable(),
  checkedAt: isoDateSchema,
  updateFrequency: z.string().min(1).nullable(),
  canonicalUrls: z.array(z.string().url()).max(8),
}).strict();
export type IntegratedSourceMetadata = z.infer<typeof integratedSourceMetadataSchema>;

const inspectionSourceIdSchema = z.string().regex(/^source-[0-9]{4}$/);
const inspectionMemberIdSchema = z.string().regex(/^member-[0-9]{4}$/);
const inspectionEncodingSchema = z.enum(["utf-8-sig", "latin-1"]);
const inspectionDelimiterSchema = z.enum(["tab", "pipe", "comma", "semicolon"]);

const inspectionTerminalFragmentSchema = z.object({
  bytes: positiveSafeIntegerSchema,
  sha256: sha256Schema,
}).strict();

const inspectionArchiveMemberSchema = z.object({
  id: inspectionMemberIdSchema,
  bytes: positiveSafeIntegerSchema,
  compressedBytes: positiveSafeIntegerSchema,
  crc32: z.string().regex(/^[0-9a-f]{8}$/),
  flagBits: safeIntegerSchema,
  compression: safeIntegerSchema,
}).strict();

const inspectionDelimitedFileSchema = z.object({
  id: inspectionSourceIdSchema,
  encoding: inspectionEncodingSchema,
  delimiter: inspectionDelimiterSchema,
  columns: positiveSafeIntegerSchema,
  headerSha256: sha256Schema,
  rows: safeIntegerSchema,
  validRows: safeIntegerSchema,
  malformedRows: safeIntegerSchema,
  terminalFragment: inspectionTerminalFragmentSchema.optional(),
}).strict();

const inspectionZipDelimitedMemberSchema = inspectionArchiveMemberSchema.extend({
  rows: safeIntegerSchema,
  physicalDataLines: safeIntegerSchema,
  columns: positiveSafeIntegerSchema,
  headerSha256: sha256Schema,
}).strict();

const inspectionSheetSchema = z.object({
  index: safeIntegerSchema,
  count: positiveSafeIntegerSchema,
  headerRows: positiveSafeIntegerSchema,
  physicalRows: positiveSafeIntegerSchema,
  rows: safeIntegerSchema,
  columns: positiveSafeIntegerSchema,
  headerSha256: sha256Schema,
}).strict();

const inspectionProjectionSchema = z.discriminatedUnion("kind", [
  z.object({
    schemaVersion: z.literal(1),
    kind: z.literal("delimited-set"),
    rows: safeIntegerSchema,
    validRows: safeIntegerSchema,
    malformedRows: safeIntegerSchema,
    files: z.array(inspectionDelimitedFileSchema).min(1),
    contractSha256: sha256Schema,
    sha256: sha256Schema,
  }).strict(),
  z.object({
    schemaVersion: z.literal(1),
    kind: z.literal("zip-delimited-set"),
    rows: safeIntegerSchema,
    validRows: safeIntegerSchema,
    malformedRows: safeIntegerSchema,
    encoding: inspectionEncodingSchema,
    delimiter: inspectionDelimiterSchema,
    maxTotalUncompressedBytes: positiveSafeIntegerSchema,
    files: z.array(z.object({
      id: inspectionSourceIdSchema,
      rows: safeIntegerSchema,
      validRows: safeIntegerSchema,
      malformedRows: safeIntegerSchema,
      members: z.array(inspectionZipDelimitedMemberSchema).min(1),
    }).strict()).length(1),
    contractSha256: sha256Schema,
    sha256: sha256Schema,
  }).strict(),
  z.object({
    schemaVersion: z.literal(1),
    kind: z.literal("zip-xls"),
    rows: safeIntegerSchema,
    validRows: safeIntegerSchema,
    malformedRows: safeIntegerSchema,
    maxTotalUncompressedBytes: positiveSafeIntegerSchema,
    files: z.array(z.object({
      id: inspectionSourceIdSchema,
      rows: safeIntegerSchema,
      validRows: safeIntegerSchema,
      malformedRows: safeIntegerSchema,
      member: inspectionArchiveMemberSchema.extend({ sha256: sha256Schema }).strict(),
      sheet: inspectionSheetSchema,
    }).strict()).length(1),
    contractSha256: sha256Schema,
    sha256: sha256Schema,
  }).strict(),
  z.object({
    schemaVersion: z.literal(1),
    kind: z.literal("xlsx"),
    rows: safeIntegerSchema,
    validRows: safeIntegerSchema,
    malformedRows: safeIntegerSchema,
    maxTotalUncompressedBytes: positiveSafeIntegerSchema,
    files: z.array(z.object({
      id: inspectionSourceIdSchema,
      rows: safeIntegerSchema,
      validRows: safeIntegerSchema,
      malformedRows: safeIntegerSchema,
      archiveMembers: z.array(inspectionArchiveMemberSchema).min(1),
      sheet: inspectionSheetSchema.extend({ dimension: z.string().min(1) }).strict(),
    }).strict()).length(1),
    contractSha256: sha256Schema,
    sha256: sha256Schema,
  }).strict(),
]);

const releaseArchiveSchema = z.object({
  receiptBytes: positiveSafeIntegerSchema,
  receiptSha256: sha256Schema,
  archiveBytes: positiveSafeIntegerSchema,
  archiveSha256: sha256Schema,
  elementSetSha256: sha256Schema,
  shards: positiveSafeIntegerSchema,
  shardBytes: positiveSafeIntegerSchema,
  entries: positiveSafeIntegerSchema,
  regular: positiveSafeIntegerSchema,
  hardlink: positiveSafeIntegerSchema,
  symlink: positiveSafeIntegerSchema,
  storedBytes: positiveSafeIntegerSchema,
  logicalBytes: positiveSafeIntegerSchema,
}).strict();

const releaseSourceCatalogSchema = z.object({
  proofBytes: positiveSafeIntegerSchema,
  proofSha256: sha256Schema,
  catalogBytes: positiveSafeIntegerSchema,
  catalogSha256: sha256Schema,
  identities: positiveSafeIntegerSchema,
  published: safeIntegerSchema,
  quarantined: safeIntegerSchema,
  totalOccurrences: positiveSafeIntegerSchema,
}).strict();

export const datasetTotalsSchema = z.object({
  datasets: positiveSafeIntegerSchema,
  sourceRows: safeIntegerSchema,
  publicRows: safeIntegerSchema,
  catalogOnlyRows: safeIntegerSchema,
  derivedOnlyRows: safeIntegerSchema,
  sourceBytes: positiveSafeIntegerSchema,
}).strict();
export type IntegratedDatasetTotals = z.infer<typeof datasetTotalsSchema>;

const releaseDatasetsSchema = z.object({
  specBytes: positiveSafeIntegerSchema,
  specSha256: sha256Schema,
  proofBytes: positiveSafeIntegerSchema,
  proofSha256: sha256Schema,
  catalogBytes: positiveSafeIntegerSchema,
  catalogSha256: sha256Schema,
  receipts: positiveSafeIntegerSchema,
  rowArtifacts: safeIntegerSchema,
  artifactCount: positiveSafeIntegerSchema,
  receiptSetSha256: sha256Schema,
  artifactSetSha256: sha256Schema,
  sourceRows: safeIntegerSchema,
  publicRows: safeIntegerSchema,
  catalogOnlyRows: safeIntegerSchema,
  derivedOnlyRows: safeIntegerSchema,
  sourceBytes: positiveSafeIntegerSchema,
}).strict();

export const integratedReleaseProofSchema = z.object({
  schemaVersion: z.literal(1),
  complete: z.literal(true),
  contract: z.object({
    archiveEntries: positiveSafeIntegerSchema,
    regularFiles: positiveSafeIntegerSchema,
    hardlinks: positiveSafeIntegerSchema,
    symlinks: positiveSafeIntegerSchema,
    datasets: positiveSafeIntegerSchema,
    datasetSourceRows: safeIntegerSchema,
    datasetPublicRows: safeIntegerSchema,
    datasetCatalogOnlyRows: safeIntegerSchema,
    datasetDerivedOnlyRows: safeIntegerSchema,
  }).strict(),
  archiveReceipt: releaseArchiveSchema,
  sourceCatalog: releaseSourceCatalogSchema,
  datasets: releaseDatasetsSchema,
  releaseSetSha256: sha256Schema,
}).strict();
export type IntegratedReleaseProof = z.infer<typeof integratedReleaseProofSchema>;

export const integratedDatasetCatalogEntrySchema = z.object({
  id: datasetIdSchema,
  title: z.string().min(1),
  domain: datasetIdSchema,
  authority: datasetIdSchema,
  licenseStatus: licenseStatusSchema,
  publication: publicationSchema,
  evidenceLabel: evidenceLabelSchema,
  rows: safeIntegerSchema,
  publicRows: safeIntegerSchema,
  rowsWithPublicSource: safeIntegerSchema,
  headers: z.array(z.string().min(1)).min(1),
  privateFields: z.array(z.string().min(1)),
  caveats: z.array(z.string().min(1)),
  sourceMetadata: integratedSourceMetadataSchema,
  receiptSha256: sha256Schema,
  inspection: inspectionProjectionSchema.optional(),
}).strict();
export type IntegratedDatasetCatalogEntry = z.infer<typeof integratedDatasetCatalogEntrySchema>;

export const integratedDatasetCatalogSchema = z.object({
  schemaVersion: z.literal(1),
  generatedAt: z.string().datetime({ offset: true }),
  corpusContract: z.object({
    elements: positiveSafeIntegerSchema,
    regularFiles: positiveSafeIntegerSchema,
    hardlinks: positiveSafeIntegerSchema,
    symlinks: positiveSafeIntegerSchema,
  }).strict(),
  totals: datasetTotalsSchema,
  datasets: z.array(integratedDatasetCatalogEntrySchema),
}).strict();
export type IntegratedDatasetCatalog = z.infer<typeof integratedDatasetCatalogSchema>;

export const integratedDatasetProofSchema = z.object({
  schemaVersion: z.literal(1),
  generatedAt: z.string().datetime({ offset: true }),
  complete: z.literal(true),
  totals: datasetTotalsSchema,
  catalogSha256: sha256Schema,
  artifactSha256: z.record(z.string().min(1), sha256Schema),
}).strict();
export type IntegratedDatasetProof = z.infer<typeof integratedDatasetProofSchema>;

const countMapSchema = z.record(z.string().min(1), safeIntegerSchema);

export const archiveReceiptSchema = z.object({
  schemaVersion: z.literal(1),
  status: z.literal("complete"),
  id: z.object({ prefix: z.string().min(1), width: positiveSafeIntegerSchema }).strict(),
  policy: z.object({ schemaVersion: z.literal(1), sha256: sha256Schema }).strict(),
  archive: z.object({ bytes: positiveSafeIntegerSchema, sha256: sha256Schema }).strict(),
  expected: z.object({
    entries: positiveSafeIntegerSchema,
    regular: positiveSafeIntegerSchema,
    hardlink: positiveSafeIntegerSchema,
    symlink: positiveSafeIntegerSchema,
  }).strict(),
  observed: z.object({
    entries: positiveSafeIntegerSchema,
    regular: positiveSafeIntegerSchema,
    hardlink: positiveSafeIntegerSchema,
    symlink: positiveSafeIntegerSchema,
    storedBytes: positiveSafeIntegerSchema,
    logicalBytes: positiveSafeIntegerSchema,
    contentClasses: countMapSchema,
    dispositions: countMapSchema,
    families: countMapSchema,
  }).strict(),
  sharding: z.object({
    size: positiveSafeIntegerSchema,
    elementSetSha256: sha256Schema,
    shards: z.array(z.object({
      file: z.string().regex(/^part-[0-9]{5}\.jsonl$/),
      firstOrdinal: positiveSafeIntegerSchema,
      lastOrdinal: positiveSafeIntegerSchema,
      records: positiveSafeIntegerSchema,
      bytes: positiveSafeIntegerSchema,
      sha256: sha256Schema,
    }).strict()),
  }).strict(),
}).strict();
export type ArchiveReceipt = z.infer<typeof archiveReceiptSchema>;

export const publicSourceCatalogEntrySchema = z.object({
  id: z.string().regex(/^src_[a-z2-7]{26}$/),
  kind: z.enum(["url", "text"]),
  classification: z.enum([
    "commercial",
    "local",
    "news",
    "official_index",
    "official_primary",
    "official_secondary",
    "unknown",
    "unresolved",
  ]),
  disposition: z.enum(["published", "quarantined"]),
  occurrences: positiveSafeIntegerSchema,
  publicValue: z.string().min(1).nullable(),
  reasonCodes: z.array(reasonCodeSchema),
}).strict();
export type PublicSourceCatalogEntry = z.infer<typeof publicSourceCatalogEntrySchema>;

export const integratedPublicRowSchema = z.object({
  id: z.string().regex(/^row-[0-9a-f]{24}$/),
  cells: z.record(z.string().min(1), z.string().nullable()),
  evidenceLabel: evidenceLabelSchema,
  redactions: z.array(
    z.object({ field: z.string().min(1), reason: reasonCodeSchema }).strict(),
  ),
  sourceRow: positiveSafeIntegerSchema,
  sourceRowSha256: sha256Schema,
  sourceUrls: z.array(z.string().url()),
}).strict();
export type IntegratedPublicRow = z.infer<typeof integratedPublicRowSchema>;

function canonicalize(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(canonicalize);
  if (value !== null && typeof value === "object") {
    return Object.fromEntries(
      Object.entries(value as Record<string, unknown>)
        .sort(([left], [right]) => (left < right ? -1 : left > right ? 1 : 0))
        .map(([key, child]) => [key, canonicalize(child)]),
    );
  }
  return value;
}

export function canonicalJson(value: unknown): string {
  return JSON.stringify(canonicalize(value));
}

export function sha256Hex(value: string | Uint8Array): string {
  return createHash("sha256").update(value).digest("hex");
}

const SENSITIVE_URL_KEYS = new Set([
  "accesstoken",
  "apikey",
  "auth",
  "authorization",
  "clientsecret",
  "code",
  "cookie",
  "credential",
  "jwt",
  "key",
  "password",
  "secret",
  "session",
  "sessionid",
  "sig",
  "signature",
  "token",
  "xamzcredential",
  "xamzsignature",
  "xgoogcredential",
  "xgoogsignature",
]);
const SENSITIVE_URL_KEY_SUFFIXES = [
  "auth",
  "credential",
  "password",
  "secret",
  "sessionid",
  "signature",
  "token",
];

function normalizedUrlKey(value: string): string {
  return value.toLocaleLowerCase("en-US").replace(/[^a-z0-9]+/g, "");
}

function queryPairs(value: string): [string, string][] {
  try {
    const url = new URL(value);
    const pairs = [...url.searchParams.entries()];
    if (url.hash.includes("=")) {
      pairs.push(...new URLSearchParams(url.hash.slice(1)).entries());
    }
    return pairs;
  } catch {
    const question = value.indexOf("?");
    const query = question >= 0 ? value.slice(question + 1) : value;
    if (!query.includes("=")) return [];
    return [...new URLSearchParams(query).entries()];
  }
}

function containsSensitiveUrlMaterial(value: string): boolean {
  const pending = [value];
  const seen = new Set(pending);
  for (let depth = 0; depth < 4 && pending.length > 0; depth += 1) {
    const levelSize = pending.length;
    for (let index = 0; index < levelSize; index += 1) {
      const candidate = pending.shift()!;
      const pairs = queryPairs(candidate);
      if (pairs.length > 64) return true;
      for (const [key, nestedValue] of pairs) {
        const normalized = normalizedUrlKey(key);
        if (
          SENSITIVE_URL_KEYS.has(normalized) ||
          SENSITIVE_URL_KEY_SUFFIXES.some((suffix) => normalized.endsWith(suffix))
        ) {
          return true;
        }
        for (const nested of [nestedValue, safeDecodeURIComponent(nestedValue)]) {
          if (
            !seen.has(nested) &&
            seen.size < 256 &&
            (nested.includes("?") || nested.includes("=") || nested.includes("%"))
          ) {
            seen.add(nested);
            pending.push(nested);
          }
        }
      }
    }
  }
  return false;
}

function safeDecodeURIComponent(value: string): string {
  try {
    return decodeURIComponent(value);
  } catch {
    return value;
  }
}

export function isSafePublicHttpUrl(value: string): boolean {
  try {
    const url = new URL(value);
    return (
      value.length <= 4_096 &&
      (url.protocol === "http:" || url.protocol === "https:") &&
      url.username === "" &&
      url.password === "" &&
      !containsSensitiveUrlMaterial(value)
    );
  } catch {
    return false;
  }
}

function containsUnsafePublicUrl(value: string): boolean {
  const matches = value.match(/https?:\/\/[^\s<>"']+/gi) ?? [];
  return matches.some((match) => {
    const candidate = match.replace(/[.,;:!?\])}]+$/g, "");
    return !isSafePublicHttpUrl(candidate);
  });
}

function sumCountMap(values: Record<string, number>): number {
  return Object.values(values).reduce((sum, value) => sum + value, 0);
}

function expectedDatasetTotals(): IntegratedDatasetTotals {
  return {
    datasets: INTEGRATED_CORPUS_CONTRACT.datasets,
    sourceRows: INTEGRATED_CORPUS_CONTRACT.sourceRows,
    publicRows: INTEGRATED_CORPUS_CONTRACT.publicRows,
    catalogOnlyRows: INTEGRATED_CORPUS_CONTRACT.catalogOnlyRows,
    derivedOnlyRows: INTEGRATED_CORPUS_CONTRACT.derivedOnlyRows,
    sourceBytes: INTEGRATED_CORPUS_CONTRACT.sourceBytes,
  };
}

export function assertIntegratedReleaseProof(value: unknown): IntegratedReleaseProof {
  const release = integratedReleaseProofSchema.parse(value);
  const contract = INTEGRATED_CORPUS_CONTRACT;
  const expectedContract = {
    archiveEntries: contract.archiveEntries,
    regularFiles: contract.regularFiles,
    hardlinks: contract.hardlinks,
    symlinks: contract.symlinks,
    datasets: contract.datasets,
    datasetSourceRows: contract.sourceRows,
    datasetPublicRows: contract.publicRows,
    datasetCatalogOnlyRows: contract.catalogOnlyRows,
    datasetDerivedOnlyRows: contract.derivedOnlyRows,
  };
  if (JSON.stringify(release.contract) !== JSON.stringify(expectedContract)) {
    throw new Error("Il contratto del corpus integrato non coincide con quello atteso.");
  }
  if (
    release.archiveReceipt.entries !== contract.archiveEntries ||
    release.archiveReceipt.regular !== contract.regularFiles ||
    release.archiveReceipt.hardlink !== contract.hardlinks ||
    release.archiveReceipt.symlink !== contract.symlinks
  ) {
    throw new Error("La ricevuta aggregata non chiude il conteggio degli elementi.");
  }
  if (
    release.sourceCatalog.identities !== contract.sourceIdentities ||
    release.sourceCatalog.published + release.sourceCatalog.quarantined !==
      contract.sourceIdentities ||
    release.sourceCatalog.quarantined !== contract.quarantinedSourceIdentities
  ) {
    throw new Error("Il catalogo delle fonti non chiude il conteggio delle identità.");
  }
  if (release.datasets.receipts !== contract.datasets) {
    throw new Error("Il numero di ricevute dataset non coincide con il contratto atteso.");
  }
  const expectedTotals = expectedDatasetTotals();
  for (const field of [
    "sourceRows",
    "publicRows",
    "catalogOnlyRows",
    "derivedOnlyRows",
    "sourceBytes",
  ] as const) {
    if (release.datasets[field] !== expectedTotals[field]) {
      throw new Error(`Il totale dataset ${field} non coincide con il contratto atteso.`);
    }
  }
  const releaseSet = {
    contract: release.contract,
    archiveReceipt: release.archiveReceipt,
    sourceCatalog: release.sourceCatalog,
    datasets: release.datasets,
  };
  if (sha256Hex(canonicalJson(releaseSet)) !== release.releaseSetSha256) {
    throw new Error("L'hash dell'insieme di rilascio non è riproducibile.");
  }
  return release;
}

export function assertIntegratedDatasetCatalog(
  value: unknown,
  release: IntegratedReleaseProof,
  catalogBytes: Uint8Array,
): IntegratedDatasetCatalog {
  const catalog = integratedDatasetCatalogSchema.parse(value);
  if (sha256Hex(catalogBytes) !== release.datasets.catalogSha256) {
    throw new Error("I byte del catalogo dataset divergono dalla prova di rilascio.");
  }
  if (
    catalog.corpusContract.elements !== INTEGRATED_CORPUS_CONTRACT.archiveEntries ||
    catalog.corpusContract.regularFiles !== INTEGRATED_CORPUS_CONTRACT.regularFiles ||
    catalog.corpusContract.hardlinks !== INTEGRATED_CORPUS_CONTRACT.hardlinks ||
    catalog.corpusContract.symlinks !== INTEGRATED_CORPUS_CONTRACT.symlinks
  ) {
    throw new Error("Il catalogo dataset non appartiene al corpus integrato.");
  }
  if (catalog.datasets.length !== INTEGRATED_CORPUS_CONTRACT.datasets) {
    throw new Error("Il catalogo non contiene tutti i dataset attesi.");
  }
  const ids = catalog.datasets.map((dataset) => dataset.id);
  if (new Set(ids).size !== ids.length || ids.join("\n") !== [...ids].sort().join("\n")) {
    throw new Error("Gli identificativi dataset non sono unici e ordinati.");
  }

  const totals: IntegratedDatasetTotals = {
    datasets: catalog.datasets.length,
    sourceRows: 0,
    publicRows: 0,
    catalogOnlyRows: 0,
    derivedOnlyRows: 0,
    sourceBytes: catalog.totals.sourceBytes,
  };
  for (const dataset of catalog.datasets) {
    totals.sourceRows += dataset.rows;
    totals.publicRows += dataset.publicRows;
    if (dataset.publication === "catalog-only") totals.catalogOnlyRows += dataset.rows;
    if (dataset.publication === "derived-only") totals.derivedOnlyRows += dataset.rows;
    const rowMode = dataset.publication === "rows" || dataset.publication === "source-index";
    if (rowMode && dataset.publicRows !== dataset.rows) {
      throw new Error(`Il dataset ${dataset.id} non chiude le righe pubbliche.`);
    }
    if (!rowMode && dataset.publicRows !== 0) {
      throw new Error(`Il dataset ${dataset.id} dichiara righe pubbliche non disponibili.`);
    }
    if (dataset.rowsWithPublicSource > dataset.rows) {
      throw new Error(`Il dataset ${dataset.id} supera la propria copertura di fonte.`);
    }
    if (new Set(dataset.headers).size !== dataset.headers.length) {
      throw new Error(`Il dataset ${dataset.id} ha intestazioni duplicate.`);
    }
    if (new Set(dataset.sourceMetadata.canonicalUrls).size !== dataset.sourceMetadata.canonicalUrls.length) {
      throw new Error(`Il dataset ${dataset.id} ha fonti canoniche duplicate.`);
    }
    if (dataset.sourceMetadata.canonicalUrls.some((url) => !isSafePublicHttpUrl(url))) {
      throw new Error(`Il dataset ${dataset.id} contiene una fonte canonica non sicura.`);
    }
  }
  if (JSON.stringify(catalog.totals) !== JSON.stringify(totals)) {
    throw new Error("I totali del catalogo dataset non si riconciliano.");
  }
  if (
    catalog.totals.sourceRows !==
    catalog.totals.publicRows + catalog.totals.catalogOnlyRows + catalog.totals.derivedOnlyRows
  ) {
    throw new Error("L'equazione globale delle righe non si chiude.");
  }
  const releaseTotals = {
    datasets: release.datasets.receipts,
    sourceRows: release.datasets.sourceRows,
    publicRows: release.datasets.publicRows,
    catalogOnlyRows: release.datasets.catalogOnlyRows,
    derivedOnlyRows: release.datasets.derivedOnlyRows,
    sourceBytes: release.datasets.sourceBytes,
  };
  if (JSON.stringify(catalog.totals) !== JSON.stringify(releaseTotals)) {
    throw new Error("Catalogo e prova di rilascio dichiarano totali diversi.");
  }
  return catalog;
}

export function assertIntegratedDatasetProof(
  value: unknown,
  release: IntegratedReleaseProof,
  proofBytes: Uint8Array,
  catalog: IntegratedDatasetCatalog,
): IntegratedDatasetProof {
  const proof = integratedDatasetProofSchema.parse(value);
  if (sha256Hex(proofBytes) !== release.datasets.proofSha256) {
    throw new Error("I byte della prova dataset divergono dal rilascio.");
  }
  if (
    proof.generatedAt !== catalog.generatedAt ||
    JSON.stringify(proof.totals) !== JSON.stringify(catalog.totals) ||
    proof.catalogSha256 !== release.datasets.catalogSha256
  ) {
    throw new Error("La prova dataset non coincide con il catalogo validato.");
  }
  if (sha256Hex(canonicalJson(proof.artifactSha256)) !== release.datasets.artifactSetSha256) {
    throw new Error("L'insieme degli hash degli artefatti dataset diverge dal rilascio.");
  }
  const expectedArtifactKeys = new Set<string>([
    "src/data/generated/integrated/catalog.json",
  ]);
  const expectedRowArtifactKeys: string[] = [];
  for (const dataset of catalog.datasets) {
    expectedArtifactKeys.add(`data/source-ledger/datasets/${dataset.id}.receipt.json`);
    if (dataset.publication !== "rows" && dataset.publication !== "source-index") continue;
    for (let ordinal = 0; ordinal < integratedRowChunkCount(dataset.publicRows); ordinal += 1) {
      const key = `src/data/generated/integrated/rows/${integratedRowChunkName(dataset.id, ordinal)}`;
      expectedArtifactKeys.add(key);
      expectedRowArtifactKeys.push(key);
    }
  }
  const observedArtifactKeys = Object.keys(proof.artifactSha256);
  if (
    observedArtifactKeys.length !== expectedArtifactKeys.size ||
    observedArtifactKeys.some((key) => !expectedArtifactKeys.has(key))
  ) {
    throw new Error("La prova dataset contiene chunk mancanti, extra o non canonici.");
  }
  if (
    release.datasets.receipts !== catalog.datasets.length ||
    release.datasets.rowArtifacts !== expectedRowArtifactKeys.length ||
    release.datasets.artifactCount !== expectedArtifactKeys.size
  ) {
    throw new Error("I conteggi degli artefatti chunk non coincidono con il catalogo.");
  }
  return proof;
}

export function assertArchiveReceipt(
  value: unknown,
  release: IntegratedReleaseProof,
  receiptBytes: Uint8Array,
): ArchiveReceipt {
  const receipt = archiveReceiptSchema.parse(value);
  if (sha256Hex(receiptBytes) !== release.archiveReceipt.receiptSha256) {
    throw new Error("I byte della ricevuta archivio divergono dal rilascio.");
  }
  if (
    receipt.expected.entries !== INTEGRATED_CORPUS_CONTRACT.archiveEntries ||
    receipt.expected.regular !== INTEGRATED_CORPUS_CONTRACT.regularFiles ||
    receipt.expected.hardlink !== INTEGRATED_CORPUS_CONTRACT.hardlinks ||
    receipt.expected.symlink !== INTEGRATED_CORPUS_CONTRACT.symlinks ||
    receipt.observed.entries !== receipt.expected.entries ||
    receipt.observed.regular !== receipt.expected.regular ||
    receipt.observed.hardlink !== receipt.expected.hardlink ||
    receipt.observed.symlink !== receipt.expected.symlink
  ) {
    throw new Error("La ricevuta archivio non chiude il contratto atteso.");
  }
  for (const [label, values] of [
    ["classi", receipt.observed.contentClasses],
    ["disposizioni", receipt.observed.dispositions],
    ["famiglie", receipt.observed.families],
  ] as const) {
    if (sumCountMap(values) !== receipt.observed.entries) {
      throw new Error(`Il totale delle ${label} non chiude gli elementi del corpus.`);
    }
  }
  return receipt;
}

export function assertPublicSourceCatalog(
  values: unknown[],
  release: IntegratedReleaseProof,
  catalogBytes: Uint8Array,
): PublicSourceCatalogEntry[] {
  if (sha256Hex(catalogBytes) !== release.sourceCatalog.catalogSha256) {
    throw new Error("I byte del catalogo fonti divergono dal rilascio.");
  }
  const entries = z.array(publicSourceCatalogEntrySchema).parse(values);
  if (entries.length !== INTEGRATED_CORPUS_CONTRACT.sourceIdentities) {
    throw new Error("Il catalogo fonti non contiene tutte le identità attese.");
  }
  const ids = entries.map((entry) => entry.id);
  if (new Set(ids).size !== ids.length || ids.join("\n") !== [...ids].sort().join("\n")) {
    throw new Error("Gli identificativi delle fonti non sono unici e ordinati.");
  }
  let published = 0;
  let quarantined = 0;
  for (const entry of entries) {
    if (entry.disposition === "published") {
      published += 1;
      if (entry.publicValue === null || !isSafePublicHttpUrl(entry.publicValue)) {
        throw new Error(`La fonte ${entry.id} non contiene un URL pubblico sicuro.`);
      }
    } else {
      quarantined += 1;
      if (entry.publicValue !== null) {
        throw new Error(`La fonte in quarantena ${entry.id} espone un valore.`);
      }
    }
  }
  if (
    published !== release.sourceCatalog.published ||
    quarantined !== release.sourceCatalog.quarantined
  ) {
    throw new Error("Le disposizioni del catalogo fonti non si riconciliano.");
  }
  return entries;
}

function assertIntegratedDatasetRowRange(
  dataset: IntegratedDatasetCatalogEntry,
  values: unknown[],
  firstSourceRow: number,
  expectedRows: number,
): IntegratedPublicRow[] {
  const rows = z.array(integratedPublicRowSchema).parse(values);
  if (rows.length !== expectedRows) {
    throw new Error(`Le righe pubbliche di ${dataset.id} non coincidono con il catalogo.`);
  }
  const ids = new Set<string>();
  for (const [index, row] of rows.entries()) {
    if (ids.has(row.id)) throw new Error(`Il dataset ${dataset.id} contiene ID riga duplicati.`);
    ids.add(row.id);
    if (row.sourceRow !== firstSourceRow + index) {
      throw new Error(`Il dataset ${dataset.id} non conserva l'ordine delle righe sorgente.`);
    }
    if (row.evidenceLabel !== dataset.evidenceLabel) {
      throw new Error(`Il dataset ${dataset.id} contiene un'etichetta probatoria divergente.`);
    }
    if (
      Object.keys(row.cells).length !== dataset.headers.length ||
      dataset.headers.some((header) => !(header in row.cells))
    ) {
      throw new Error(`Il dataset ${dataset.id} contiene una riga con schema divergente.`);
    }
    if (
      Object.values(row.cells).some(
        (value) => value !== null && containsUnsafePublicUrl(value),
      )
    ) {
      throw new Error(`Il dataset ${dataset.id} contiene un URL non sicuro in una cella.`);
    }
    if (row.sourceUrls.some((url) => !isSafePublicHttpUrl(url))) {
      throw new Error(`Il dataset ${dataset.id} contiene un collegamento fonte non sicuro.`);
    }
    if (row.sourceUrls.join("\n") !== [...new Set(row.sourceUrls)].sort().join("\n")) {
      throw new Error(`Il dataset ${dataset.id} contiene collegamenti duplicati o non ordinati.`);
    }
  }
  return rows;
}

export function assertIntegratedDatasetChunk(
  dataset: IntegratedDatasetCatalogEntry,
  ordinal: number,
  values: unknown[],
): IntegratedPublicRow[] {
  const chunkCount = integratedRowChunkCount(dataset.publicRows);
  if (!Number.isSafeInteger(ordinal) || ordinal < 0 || ordinal >= chunkCount) {
    throw new Error(`Indice chunk fuori perimetro per ${dataset.id}.`);
  }
  const firstSourceRow = ordinal * INTEGRATED_ROW_CHUNK_ROWS + 1;
  const expectedRows = Math.min(
    INTEGRATED_ROW_CHUNK_ROWS,
    dataset.publicRows - firstSourceRow + 1,
  );
  return assertIntegratedDatasetRowRange(dataset, values, firstSourceRow, expectedRows);
}
