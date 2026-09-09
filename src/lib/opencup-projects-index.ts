import "server-only";

import { constants } from "node:fs";
import { open } from "node:fs/promises";
import { dirname } from "node:path";
import { z } from "zod";
import {
  canonicalJson,
  containsUnsafePublicUrl,
  integratedPublicRowSchema,
  isSafePublicHttpUrl,
  sha256Hex,
  type IntegratedPublicRow,
} from "@/lib/integrated-source-contract";
import {
  readImmutableLocalObject,
  type ImmutableObjectDescriptor,
} from "@/lib/integrated-object-store";

export const OPENCUP_PROJECT_DATASET = "opencup-progetti-bulk";
export const OPENCUP_PROJECT_HEADERS = [
  "CUP",
  "DESCRIZIONE_SINTETICA_CUP",
  "ANNO_DECISIONE",
  "STATO_PROGETTO",
  "COSTO_PROGETTO",
  "FINANZIAMENTO_PROGETTO",
  "SOGGETTO_TITOLARE",
  "PIVA_CODFISCALE_SOG_TITOLARE",
  "PIVA_CF_BENEFICIARIO",
  "CODICE_NATURA_INTERVENTO",
  "NATURA_INTERVENTO",
  "COD_NATURA_DIPE",
  "NATURA_DIPE",
  "CODICE_TIPO_INTERVENTO",
  "TIPOLOGIA_INTERVENTO",
  "CODICE_AREA_INTERVENTO",
  "AREA_INTERVENTO",
  "CODICE_SETTORE_INTERVENTO",
  "SETTORE_INTERVENTO",
  "CODICE_SOTTOSETTORE_INTERVENTO",
  "SOTTOSETTORE_INTERVENTO",
  "CODICE_CATEGORIA_INTERVENTO",
  "CATEGORIA_INTERVENTO",
  "DATA_GENERAZIONE_CUP",
] as const;
export type OpenCupProjectHeader = (typeof OPENCUP_PROJECT_HEADERS)[number];
export type OpenCupProjectCells = Readonly<Record<OpenCupProjectHeader, string | null>>;
export type OpenCupProjectRow = Omit<IntegratedPublicRow, "cells"> & {
  cells: OpenCupProjectCells;
};
export const OPENCUP_CUP_PATTERN = /^[A-Z0-9]{15}$/;
const OPENCUP_OFFICIAL_ORIGIN = "https://www.opencup.gov.it";
const OPENCUP_LANDING_PATH = "/portale/web/opencup/accesso-agli-open-data";
const OPENCUP_SOURCE_PATH_PREFIX = "/portale/documents/21195/299152/OpendataProgetti.zip/";
const OPENCUP_LICENSE_PATH = "/portale/web/opencup/licenza-cc-by";

const sha256Schema = z.string().regex(/^[0-9a-f]{64}$/);
const positiveInteger = z.number().int().positive().max(Number.MAX_SAFE_INTEGER);
const nonnegativeInteger = z.number().int().nonnegative().max(Number.MAX_SAFE_INTEGER);
const referenceDateSchema = z.string().regex(/^\d{4}-\d{2}-\d{2}$/);
const isoDateTimeSchema = z.string().datetime();
const descriptorSchema = z.object({
  sha256: sha256Schema,
  bytes: positiveInteger,
  rawBytes: positiveInteger,
  format: z.enum(["json-v1", "jsonl-gzip-v1"]),
  key: z.string().regex(/^sha256\/[0-9a-f]{64}$/),
}).strict().superRefine((value, context) => {
  if (value.key !== `sha256/${value.sha256}`) {
    context.addIssue({ code: "custom", message: "Chiave oggetto divergente." });
  }
});
const chunkSchema = descriptorSchema.and(z.object({
  ordinal: nonnegativeInteger,
  firstSourceRow: positiveInteger,
  rowCount: positiveInteger.max(1_000),
}).strict());
const chunkGroupManifestSchema = z.object({
  chunkCount: positiveInteger.max(256),
  firstOrdinal: nonnegativeInteger,
  firstSourceRow: positiveInteger,
  object: descriptorSchema,
  rowCount: positiveInteger,
}).strict();
const manifestBase = z.object({
  schemaVersion: z.literal(2),
  datasetId: z.literal(OPENCUP_PROJECT_DATASET),
  projectionVersion: z.literal(1),
  sourceSha256: sha256Schema,
  sourceSpecSha256: sha256Schema,
  sourceUrl: z.string().url(),
  landingUrl: z.string().url().nullable(),
  licenseUrl: z.string().url().nullable(),
  evidenceLabel: z.enum(["documented-fact", "synthetic-fixture"]),
  licenseStatus: z.string().min(1),
  referenceDate: referenceDateSchema.nullable(),
  publicationDate: referenceDateSchema.nullable(),
  lastModified: isoDateTimeSchema.nullable(),
  observedAt: isoDateTimeSchema.nullable(),
  acquiredAt: isoDateTimeSchema.nullable(),
  canary: z.object({
    cup: z.string().regex(OPENCUP_CUP_PATTERN),
    sourceRow: positiveInteger,
  }).strict(),
  receiptSha256: sha256Schema,
  sourceRows: positiveInteger,
  publicRows: positiveInteger,
  indexedRows: nonnegativeInteger,
  distinctCups: positiveInteger,
  headers: z.array(z.string().min(1)).min(1),
  rootIndex: descriptorSchema,
  chunkCount: positiveInteger,
  chunkGroups: z.array(chunkGroupManifestSchema).min(1),
});
const productionManifestSchema = manifestBase.extend({
  evidenceLabel: z.literal("documented-fact"),
  licenseStatus: z.literal("CC-BY-4.0"),
  landingUrl: z.string().url(),
  licenseUrl: z.string().url(),
  referenceDate: referenceDateSchema,
  lastModified: isoDateTimeSchema,
  observedAt: isoDateTimeSchema,
  acquiredAt: isoDateTimeSchema,
}).strict();
const fixtureManifestSchema = manifestBase.extend({
  fixtureOnly: z.literal(true),
  evidenceLabel: z.literal("synthetic-fixture"),
  licenseStatus: z.literal("unverified"),
  landingUrl: z.null(),
  licenseUrl: z.null(),
  referenceDate: z.null(),
  publicationDate: z.null(),
  lastModified: z.null(),
  observedAt: z.null(),
  acquiredAt: z.null(),
}).strict();
const manifestSchema = z.union([productionManifestSchema, fixtureManifestSchema]);
export type OpenCupManifest = z.infer<typeof manifestSchema>;

const directorySchema = z.object({
  schemaVersion: z.literal(2),
  kind: z.literal("directory"),
  children: z.array(z.object({
    minCup: z.string().regex(OPENCUP_CUP_PATTERN),
    maxCup: z.string().regex(OPENCUP_CUP_PATTERN),
    node: descriptorSchema,
  }).strict()).min(1).max(256),
}).strict();
const leafEntrySchema = z.object({
  cup: z.string().regex(OPENCUP_CUP_PATTERN),
  matchedRows: positiveInteger,
  refs: z.array(z.object({
    sourceRow: positiveInteger,
    chunkOrdinal: nonnegativeInteger,
  }).strict()).min(1).max(64),
}).strict().or(z.object({
  cup: z.string().regex(OPENCUP_CUP_PATTERN),
  matchedRows: positiveInteger,
  postingRoot: descriptorSchema,
}).strict());
const leafSchema = z.object({
  schemaVersion: z.literal(2),
  kind: z.literal("leaf"),
  entries: z.array(leafEntrySchema).min(1).max(256),
}).strict();
const postingSchema = z.object({
  schemaVersion: z.literal(2),
  kind: z.literal("postings"),
  cup: z.string().regex(OPENCUP_CUP_PATTERN),
  refs: z.array(z.object({
    sourceRow: positiveInteger,
    chunkOrdinal: nonnegativeInteger,
  }).strict()).min(1).max(1_000),
  start: nonnegativeInteger,
  next: descriptorSchema.nullable().optional(),
}).strict();
const postingDirectorySchema = z.object({
  schemaVersion: z.literal(2),
  kind: z.literal("posting-directory"),
  children: z.array(z.object({
    start: nonnegativeInteger,
    end: positiveInteger,
    node: descriptorSchema,
  }).strict()).min(1).max(256),
}).strict();
const chunkGroupSchema = z.object({
  schemaVersion: z.literal(2),
  kind: z.literal("chunk-group"),
  chunks: z.array(chunkSchema).min(1).max(256),
}).strict();

const MAX_MANIFEST_BYTES = 2 * 1024 * 1024;
const MAX_OBJECT_READS = 8;
const MAX_RAW_BYTES = 16 * 1024 * 1024;
const MAX_INDEX_DEPTH = 4;
let fixtureAccessEnabledForTests = false;

/** Unit-test opt-in; production code cannot enable synthetic public rows through env alone. */
export function enableOpenCupFixtureAccessForTests(): void {
  if (process.env.NODE_ENV === "production") {
    throw new Error("Le fixture OpenCUP non possono essere abilitate in produzione.");
  }
  fixtureAccessEnabledForTests = true;
}

export class OpenCupUnavailableError extends Error {
  constructor(message = "OpenCUP è temporaneamente non disponibile.", options?: ErrorOptions) {
    super(message, options);
    this.name = "OpenCupUnavailableError";
  }
}

type ChunkDescriptor = z.infer<typeof chunkSchema>;
type PostingRef = z.infer<typeof postingSchema>["refs"][number];
type QueryBudget = {
  objectReads: number;
  rawBytes: number;
  loadedChunks: Set<number>;
  chunkDescriptors: Map<number, ChunkDescriptor>;
};
type PostingMatch = {
  cup: string;
  manifest: OpenCupManifest;
  releaseId: string;
  root: string;
  refs: readonly PostingRef[];
  matchedRows: number;
  budget: QueryBudget;
};

function abortError(): Error {
  const error = new Error("Ricerca OpenCUP annullata.");
  error.name = "AbortError";
  return error;
}

function throwIfAborted(signal?: AbortSignal): void {
  if (signal?.aborted) throw abortError();
}

function canonicalJsonBytes(value: unknown): Buffer {
  return Buffer.from(`${canonicalJson(value)}\n`, "utf8");
}

function isOpenCupProjectCells(
  cells: IntegratedPublicRow["cells"],
): cells is OpenCupProjectCells {
  return (
    Object.keys(cells).length === OPENCUP_PROJECT_HEADERS.length &&
    OPENCUP_PROJECT_HEADERS.every((header) => header in cells)
  );
}

function parseCanonicalJson(bytes: Buffer, label: string): unknown {
  let value: unknown;
  try {
    value = JSON.parse(new TextDecoder("utf-8", { fatal: true }).decode(bytes));
  } catch (error) {
    throw new OpenCupUnavailableError(`${label} non è JSON UTF-8 valido.`, { cause: error });
  }
  if (!bytes.equals(canonicalJsonBytes(value))) {
    throw new OpenCupUnavailableError(`${label} non usa la serializzazione canonica.`);
  }
  return value;
}

async function readManifest(path: string, signal?: AbortSignal): Promise<{ manifest: OpenCupManifest; bytes: Buffer }> {
  throwIfAborted(signal);
  let handle;
  try {
    handle = await open(path, constants.O_RDONLY | constants.O_NOFOLLOW);
    const stat = await handle.stat();
    if (!stat.isFile() || stat.size <= 0 || stat.size > MAX_MANIFEST_BYTES) {
      throw new Error("dimensione manifest fuori contratto");
    }
    const bytes = Buffer.allocUnsafe(stat.size);
    let offset = 0;
    while (offset < bytes.length) {
      throwIfAborted(signal);
      const { bytesRead } = await handle.read(bytes, offset, bytes.length - offset, offset);
      if (bytesRead <= 0) throw new Error("manifest cambiato durante la lettura");
      offset += bytesRead;
    }
    const manifest = manifestSchema.parse(parseCanonicalJson(bytes, "Manifest OpenCUP"));
    validateManifest(manifest);
    return { manifest, bytes };
  } catch (error) {
    if (error instanceof OpenCupUnavailableError || (error instanceof Error && error.name === "AbortError")) throw error;
    throw new OpenCupUnavailableError("Manifest OpenCUP mancante o non valido.", { cause: error });
  } finally {
    await handle?.close();
  }
}

function validateManifest(manifest: OpenCupManifest): void {
  const fixtureMode = "fixtureOnly" in manifest;
  if (
    manifest.sourceRows !== manifest.publicRows ||
    manifest.indexedRows !== manifest.publicRows
  ) {
    throw new OpenCupUnavailableError("Conteggi manifest OpenCUP non riconciliati.");
  }
  if (!fixtureMode && (
    !isOfficialOpenCupUrl(manifest.landingUrl, OPENCUP_LANDING_PATH) ||
    !isOfficialOpenCupUrl(manifest.sourceUrl, OPENCUP_SOURCE_PATH_PREFIX, true) ||
    !isOfficialOpenCupUrl(manifest.licenseUrl, OPENCUP_LICENSE_PATH)
  )) {
    throw new OpenCupUnavailableError("Provenienza URL manifest OpenCUP non valida.");
  }
  if (manifest.headers.join("\n") !== OPENCUP_PROJECT_HEADERS.join("\n")) {
    throw new OpenCupUnavailableError("Header manifest OpenCUP divergenti.");
  }
  let expectedOrdinal = 0;
  let expectedSourceRow = 1;
  for (const group of manifest.chunkGroups) {
    if (
      group.firstOrdinal !== expectedOrdinal ||
      group.firstSourceRow !== expectedSourceRow ||
      group.object.format !== "json-v1"
    ) {
      throw new OpenCupUnavailableError("Intervalli gruppo chunk OpenCUP non contigui.");
    }
    expectedOrdinal += group.chunkCount;
    expectedSourceRow += group.rowCount;
  }
  if (
    expectedOrdinal !== manifest.chunkCount ||
    expectedSourceRow !== manifest.publicRows + 1 ||
    manifest.rootIndex.format !== "json-v1"
  ) {
    throw new OpenCupUnavailableError("Copertura chunk OpenCUP non completa.");
  }
}

function isOfficialOpenCupUrl(value: string, path: string, prefix = false): boolean {
  try {
    const parsed = new URL(value);
    return (
      parsed.origin === OPENCUP_OFFICIAL_ORIGIN &&
      parsed.username === "" &&
      parsed.password === "" &&
      parsed.port === "" &&
      parsed.hash === "" &&
      (prefix ? parsed.pathname.startsWith(path) : parsed.pathname === path)
    );
  } catch {
    return false;
  }
}

async function readJsonObject(
  root: string,
  descriptor: ImmutableObjectDescriptor,
  budget: QueryBudget,
  signal?: AbortSignal,
): Promise<unknown> {
  if (budget.objectReads >= MAX_OBJECT_READS || budget.rawBytes + descriptor.rawBytes > MAX_RAW_BYTES) {
    throw new OpenCupUnavailableError("Budget di lettura OpenCUP esaurito.");
  }
  budget.objectReads += 1;
  budget.rawBytes += descriptor.rawBytes;
  try {
    const bytes = await readImmutableLocalObject(root, descriptor, signal);
    return parseCanonicalJson(bytes, "Oggetto indice OpenCUP");
  } catch (error) {
    if (error instanceof OpenCupUnavailableError || (error instanceof Error && error.name === "AbortError")) throw error;
    throw new OpenCupUnavailableError("Oggetto indice OpenCUP non valido.", { cause: error });
  }
}

function chunkGroupForOrdinal(manifest: OpenCupManifest, ordinal: number): OpenCupManifest["chunkGroups"][number] | null {
  return manifest.chunkGroups.find(
    (group) => group.firstOrdinal <= ordinal && ordinal < group.firstOrdinal + group.chunkCount,
  ) ?? null;
}

async function resolveChunkDescriptor(
  root: string,
  manifest: OpenCupManifest,
  ordinal: number,
  budget: QueryBudget,
  signal?: AbortSignal,
): Promise<ChunkDescriptor> {
  const cached = budget.chunkDescriptors.get(ordinal);
  if (cached) return cached;
  if (!Number.isSafeInteger(ordinal) || ordinal < 0 || ordinal >= manifest.chunkCount) {
    throw new OpenCupUnavailableError("Riferimento chunk OpenCUP non valido.");
  }
  const group = chunkGroupForOrdinal(manifest, ordinal);
  if (!group) throw new OpenCupUnavailableError("Riferimento chunk OpenCUP fuori dai gruppi dichiarati.");
  const payload = chunkGroupSchema.parse(await readJsonObject(root, group.object, budget, signal));
  if (
    payload.chunks.length !== group.chunkCount ||
    payload.chunks[0]?.ordinal !== group.firstOrdinal ||
    payload.chunks[0]?.firstSourceRow !== group.firstSourceRow ||
    payload.chunks.reduce((total, chunk) => total + chunk.rowCount, 0) !== group.rowCount
  ) {
    throw new OpenCupUnavailableError("Gruppo chunk OpenCUP divergente dal manifest.");
  }
  let expectedOrdinal = group.firstOrdinal;
  let expectedSourceRow = group.firstSourceRow;
  for (const chunk of payload.chunks) {
    if (
      chunk.ordinal !== expectedOrdinal ||
      chunk.firstSourceRow !== expectedSourceRow ||
      chunk.format !== "jsonl-gzip-v1"
    ) {
      throw new OpenCupUnavailableError("Intervalli chunk OpenCUP non contigui.");
    }
    budget.chunkDescriptors.set(chunk.ordinal, chunk);
    expectedOrdinal += 1;
    expectedSourceRow += chunk.rowCount;
  }
  const resolved = budget.chunkDescriptors.get(ordinal);
  if (!resolved) throw new OpenCupUnavailableError("Chunk OpenCUP non dichiarato.");
  return resolved;
}

async function findLeafEntry(
  root: string,
  descriptor: ImmutableObjectDescriptor,
  cup: string,
  budget: QueryBudget,
  signal?: AbortSignal,
): Promise<z.infer<typeof leafEntrySchema> | null> {
  let current = descriptor;
  for (let depth = 1; depth <= MAX_INDEX_DEPTH; depth += 1) {
    const raw = await readJsonObject(root, current, budget, signal);
    if ((raw as { kind?: unknown })?.kind === "directory") {
      const directory = directorySchema.parse(raw);
      let previousMax: string | undefined;
      for (const child of directory.children) {
        if (child.minCup > child.maxCup || (previousMax !== undefined && child.minCup <= previousMax)) {
          throw new OpenCupUnavailableError("Intervalli directory OpenCUP sovrapposti.");
        }
        previousMax = child.maxCup;
      }
      const child = directory.children.find((candidate) => candidate.minCup <= cup && cup <= candidate.maxCup);
      if (!child) return null;
      current = child.node;
      continue;
    }
    const leaf = leafSchema.parse(raw);
    const cups = leaf.entries.map((entry) => entry.cup);
    if (cups.join("\n") !== [...new Set(cups)].sort().join("\n")) {
      throw new OpenCupUnavailableError("Chiavi foglia OpenCUP non ordinate o duplicate.");
    }
    for (const entry of leaf.entries) {
      if ("refs" in entry && entry.refs.length !== entry.matchedRows) {
        throw new OpenCupUnavailableError("Conteggio posting list OpenCUP divergente.");
      }
      if (("refs" in entry && entry.matchedRows > 64) || (!("refs" in entry) && entry.matchedRows <= 64)) {
        throw new OpenCupUnavailableError("Schema posting OpenCUP divergente.");
      }
    }
    return leaf.entries.find((entry) => entry.cup === cup) ?? null;
  }
  throw new OpenCupUnavailableError("Profondità indice OpenCUP oltre il contratto.");
}

export async function openCupPostingRefs(
  cup: string,
  start: number,
  maximum: number,
  signal?: AbortSignal,
  expectedRelease?: string,
): Promise<PostingMatch> {
  const manifestPath = process.env.DVNS_OPENCUP_PROJECTS_MANIFEST;
  if (!manifestPath) throw new OpenCupUnavailableError("Manifest OpenCUP non configurato.");
  const { manifest, bytes } = await readManifest(manifestPath, signal);
  const fixtureMode = "fixtureOnly" in manifest;
  if (fixtureMode && !fixtureAccessEnabledForTests) {
    throw new OpenCupUnavailableError("Le fixture OpenCUP non sono servibili dal runtime pubblico.");
  }
  const releaseId = sha256Hex(bytes);
  if (expectedRelease && expectedRelease !== releaseId) {
    throw new Error("Cursor OpenCUP riferito a un rilascio diverso; riparti dalla prima pagina.");
  }
  const root = dirname(manifestPath);
  if (!Number.isSafeInteger(start) || start < 0 || !Number.isSafeInteger(maximum) || maximum <= 0) {
    throw new Error("Intervallo pagina OpenCUP non valido.");
  }
  const budget: QueryBudget = {
    objectReads: 0,
    rawBytes: 0,
    loadedChunks: new Set(),
    chunkDescriptors: new Map(),
  };
  const entry = await findLeafEntry(root, manifest.rootIndex, cup, budget, signal);
  if (!entry) {
    return { cup, manifest, releaseId, root, refs: [], matchedRows: 0, budget };
  }
  if (start < 0 || start >= entry.matchedRows) {
    throw new Error("Cursor OpenCUP oltre i risultati disponibili.");
  }
  const refs: PostingRef[] = [];
  if ("refs" in entry) {
    let previousSourceRow = 0;
    for (const [position, ref] of entry.refs.entries()) {
      if (ref.sourceRow <= previousSourceRow || ref.sourceRow > manifest.publicRows || ref.chunkOrdinal >= manifest.chunkCount) {
        throw new OpenCupUnavailableError("Riferimento riga OpenCUP non valido.");
      }
      previousSourceRow = ref.sourceRow;
      if (position >= start && refs.length < maximum) refs.push(ref);
    }
  } else {
    let descriptor: ImmutableObjectDescriptor = entry.postingRoot;
    let page: z.infer<typeof postingSchema> | null = null;
    let expectedRangeStart = 0;
    let expectedRangeEnd = entry.matchedRows;
    for (let depth = 1; depth <= MAX_INDEX_DEPTH; depth += 1) {
      const raw = await readJsonObject(root, descriptor, budget, signal);
      if ((raw as { kind?: unknown })?.kind === "posting-directory") {
        const directory = postingDirectorySchema.parse(raw);
        let previousEnd = expectedRangeStart;
        for (const child of directory.children) {
          if (
            child.start !== previousEnd ||
            child.end <= child.start ||
            child.end > expectedRangeEnd
          ) {
            throw new OpenCupUnavailableError("Intervalli directory posting OpenCUP non validi.");
          }
          previousEnd = child.end;
        }
        if (previousEnd !== expectedRangeEnd) {
          throw new OpenCupUnavailableError("Copertura directory posting OpenCUP divergente.");
        }
        const child = directory.children.find(
          (candidate) => candidate.start <= start && start < candidate.end,
        );
        if (!child) throw new OpenCupUnavailableError("Pagina posting OpenCUP non trovata.");
        expectedRangeStart = child.start;
        expectedRangeEnd = child.end;
        descriptor = child.node;
        continue;
      }
      page = postingSchema.parse(raw);
      break;
    }
    if (!page) throw new OpenCupUnavailableError("Profondità albero posting OpenCUP oltre il contratto.");

    const seenPages = new Set<string>();
    let position = page.start;
    let previousSourceRow = 0;
    let enforcePageRange = true;
    while (page) {
      if (seenPages.has(descriptor.sha256)) {
        throw new OpenCupUnavailableError("Ciclo nella posting list OpenCUP.");
      }
      seenPages.add(descriptor.sha256);
      if (
        page.cup !== cup ||
        page.start !== position ||
        (enforcePageRange && page.start !== expectedRangeStart) ||
        (enforcePageRange && (
          page.start > start ||
          start >= page.start + page.refs.length
        )) ||
        (enforcePageRange && page.start + page.refs.length !== expectedRangeEnd) ||
        page.start + page.refs.length > entry.matchedRows
      ) {
        throw new OpenCupUnavailableError("Intervallo pagina posting OpenCUP non valido.");
      }
      for (const [offset, ref] of page.refs.entries()) {
        const refPosition = page.start + offset;
        if (refPosition >= entry.matchedRows || ref.sourceRow <= previousSourceRow || ref.sourceRow > manifest.publicRows || ref.chunkOrdinal >= manifest.chunkCount) {
          throw new OpenCupUnavailableError("Riferimento riga OpenCUP non valido.");
        }
        previousSourceRow = ref.sourceRow;
        if (refPosition >= start && refs.length < maximum) refs.push(ref);
      }
      position = page.start + page.refs.length;
      const next = page.next ?? null;
      if (refs.length >= maximum) break;
      if (position === entry.matchedRows) {
        if (next) throw new OpenCupUnavailableError("Pagina posting finale con continuazione inattesa.");
        break;
      }
      if (!next) throw new OpenCupUnavailableError("Conteggio posting list OpenCUP divergente.");
      descriptor = next;
      page = postingSchema.parse(await readJsonObject(root, descriptor, budget, signal));
      enforcePageRange = false;
    }
  }
  return {
    cup,
    manifest,
    releaseId,
    root,
    refs,
    matchedRows: entry.matchedRows,
    budget,
  };
}

export async function loadOpenCupRows(
  match: PostingMatch,
  signal?: AbortSignal,
): Promise<{ rows: OpenCupProjectRow[]; loadedChunks: number }> {
  const rows: OpenCupProjectRow[] = [];
  let loadedOrdinal: number | undefined;
  let loadedRows: OpenCupProjectRow[] = [];
  for (const ref of match.refs) {
    throwIfAborted(signal);
    if (loadedOrdinal !== ref.chunkOrdinal) {
      // Reserve both the descriptor group (if absent) and the row object.
      const neededReads = match.budget.chunkDescriptors.has(ref.chunkOrdinal) ? 1 : 2;
      if (match.budget.objectReads + neededReads > MAX_OBJECT_READS) break;
      const chunk = await resolveChunkDescriptor(
        match.root,
        match.manifest,
        ref.chunkOrdinal,
        match.budget,
        signal,
      );
      if (ref.sourceRow < chunk.firstSourceRow || ref.sourceRow >= chunk.firstSourceRow + chunk.rowCount) {
        throw new OpenCupUnavailableError("Riferimento riga OpenCUP fuori dal chunk dichiarato.");
      }
      if (
        match.budget.objectReads >= MAX_OBJECT_READS ||
        match.budget.rawBytes + chunk.rawBytes > MAX_RAW_BYTES
      ) {
        break;
      }
      match.budget.objectReads += 1;
      match.budget.rawBytes += chunk.rawBytes;
      let raw: Buffer;
      try {
        raw = await readImmutableLocalObject(match.root, chunk, signal);
      } catch (error) {
        if (error instanceof Error && error.name === "AbortError") throw error;
        throw new OpenCupUnavailableError("Chunk OpenCUP non valido.", { cause: error });
      }
      if (!raw.equals(Buffer.from(raw.toString("utf8"), "utf8")) || raw.at(-1) !== 0x0a) {
        throw new OpenCupUnavailableError("Chunk OpenCUP non è JSONL UTF-8 canonico.");
      }
      const lines = raw.toString("utf8").slice(0, -1).split("\n");
      if (lines.length !== chunk.rowCount) throw new OpenCupUnavailableError("Conteggio righe chunk OpenCUP divergente.");
      const seenIds = new Set<string>();
      loadedRows = lines.map((line, index) => {
        let value: unknown;
        try { value = JSON.parse(line); } catch (error) {
          throw new OpenCupUnavailableError("Riga chunk OpenCUP non valida.", { cause: error });
        }
        if (canonicalJson(value) !== line) throw new OpenCupUnavailableError("Riga chunk OpenCUP non canonica.");
        const row = integratedPublicRowSchema.parse(value);
        if (!isOpenCupProjectCells(row.cells)) {
          throw new OpenCupUnavailableError("Schema o ordine riga OpenCUP divergente.");
        }
        const cells = row.cells;
        const publicDigest = sha256Hex(Buffer.from(`${canonicalJson(row.cells)}\n`, "utf8"));
        const expectedId = `row-${sha256Hex(`${OPENCUP_PROJECT_DATASET}:${row.sourceRow}:${publicDigest}`).slice(0, 24)}`;
        const fixtureMode = "fixtureOnly" in match.manifest;
        const expectedSourceUrls = fixtureMode ? [] : [match.manifest.sourceUrl];
        const privateFields = [
          "PIVA_CODFISCALE_SOG_TITOLARE",
          "PIVA_CF_BENEFICIARIO",
        ] as const;
        if (
          row.sourceRow !== chunk.firstSourceRow + index ||
          row.sourceRowSha256 !== publicDigest ||
          row.id !== expectedId ||
          seenIds.has(row.id) ||
          row.evidenceLabel !== match.manifest.evidenceLabel ||
          Object.values(row.cells).some(
            (cell) => cell !== null && containsUnsafePublicUrl(cell),
          ) ||
          row.sourceUrls.some((url) => !isSafePublicHttpUrl(url)) ||
          row.sourceUrls.join("\n") !== expectedSourceUrls.join("\n") ||
          (["COSTO_PROGETTO", "FINANZIAMENTO_PROGETTO"] as const).some((field) => {
            const value = cells[field];
            return value !== null && !/^[0-9]+$/.test(value);
          }) ||
          privateFields.some((field) => {
            const cell = cells[field];
            const matchingRedactions = row.redactions.filter(
              (redaction) => redaction.field === field && redaction.reason === "personal-identifier",
            );
            return cell !== null || matchingRedactions.length !== 1;
          }) ||
          row.redactions.some((redaction) => !(redaction.field in row.cells))
        ) {
          throw new OpenCupUnavailableError("Schema o ordine riga OpenCUP divergente.");
        }
        seenIds.add(row.id);
        return { ...row, cells };
      });
      loadedOrdinal = ref.chunkOrdinal;
      match.budget.loadedChunks.add(ref.chunkOrdinal);
    }
    const chunk = match.budget.chunkDescriptors.get(ref.chunkOrdinal);
    if (!chunk) throw new OpenCupUnavailableError("Chunk OpenCUP non caricato.");
    const row = loadedRows[ref.sourceRow - chunk.firstSourceRow];
    if (!row || row.sourceRow !== ref.sourceRow || row.cells.CUP !== match.cup) {
      throw new OpenCupUnavailableError("Riferimento indice OpenCUP divergente dalla riga.");
    }
    rows.push(row);
  }
  return { rows, loadedChunks: match.budget.loadedChunks.size };
}

/** Probe the pinned root and one public canary without contacting the bulk source. */
export async function probeOpenCupRelease(signal?: AbortSignal) {
  const manifestPath = process.env.DVNS_OPENCUP_PROJECTS_MANIFEST;
  if (!manifestPath) throw new OpenCupUnavailableError("Manifest OpenCUP non configurato.");
  const { manifest, bytes } = await readManifest(manifestPath, signal);
  const fixtureMode = "fixtureOnly" in manifest;
  if (fixtureMode && !fixtureAccessEnabledForTests) {
    throw new OpenCupUnavailableError("Le fixture OpenCUP non sono servibili dal runtime pubblico.");
  }
  const releaseId = sha256Hex(bytes);
  const match = await openCupPostingRefs(
    manifest.canary.cup,
    0,
    1,
    signal,
    releaseId,
  );
  const loaded = await loadOpenCupRows(match, signal);
  if (
    loaded.rows.length !== 1 ||
    loaded.rows[0]?.sourceRow !== manifest.canary.sourceRow ||
    loaded.rows[0]?.cells.CUP !== manifest.canary.cup
  ) {
    throw new OpenCupUnavailableError("Canary pubblica OpenCUP non riconciliata.");
  }
  return {
    acquiredAt: manifest.acquiredAt,
    distinctCups: manifest.distinctCups,
    fixtureOnly: "fixtureOnly" in manifest,
    landingUrl: manifest.landingUrl,
    lastModified: manifest.lastModified,
    licenseUrl: manifest.licenseUrl,
    observedAt: manifest.observedAt,
    publicationDate: manifest.publicationDate,
    publicRows: manifest.publicRows,
    referenceDate: manifest.referenceDate,
    releaseId,
  } as const;
}
