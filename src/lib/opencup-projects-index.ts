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
  "DATA_GENERAZIONE_CUP",
  "STATO_PROGETTO",
  "COSTO_PROGETTO",
  "FINANZIAMENTO_PROGETTO",
  "SOGGETTO_TITOLARE",
  "PIVA_CODFISCALE_SOG_TITOLARE",
  "PIVA_CF_BENEFICIARIO",
  "CODICE_NATURA_INTERVENTO",
  "NATURA_INTERVENTO",
  "CODICE_TIPO_INTERVENTO",
  "TIPOLOGIA_INTERVENTO",
  "CODICE_REGIONE",
  "REGIONE",
  "CODICE_COMUNE",
  "COMUNE",
] as const;
export const OPENCUP_CUP_PATTERN = /^[A-Z0-9]{15}$/;

const sha256Schema = z.string().regex(/^[0-9a-f]{64}$/);
const positiveInteger = z.number().int().positive().max(Number.MAX_SAFE_INTEGER);
const nonnegativeInteger = z.number().int().nonnegative().max(Number.MAX_SAFE_INTEGER);
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
const manifestBase = z.object({
  schemaVersion: z.literal(1),
  datasetId: z.literal(OPENCUP_PROJECT_DATASET),
  projectionVersion: z.literal(1),
  sourceSha256: sha256Schema,
  sourceSpecSha256: sha256Schema,
  sourceUrl: z.string().url(),
  evidenceLabel: z.enum(["documented-fact", "synthetic-fixture"]),
  licenseStatus: z.string().min(1),
  observedAt: z.string().datetime().nullable(),
  publishedAt: z.string().datetime().nullable(),
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
  chunks: z.array(chunkSchema).min(1),
});
const productionManifestSchema = manifestBase.extend({
  evidenceLabel: z.literal("documented-fact"),
}).strict();
const fixtureManifestSchema = manifestBase.extend({
  fixtureOnly: z.literal(true),
  evidenceLabel: z.literal("synthetic-fixture"),
  licenseStatus: z.literal("unverified"),
  observedAt: z.null(),
  publishedAt: z.null(),
}).strict();
const manifestSchema = z.union([productionManifestSchema, fixtureManifestSchema]);
export type OpenCupManifest = z.infer<typeof manifestSchema>;

const directorySchema = z.object({
  schemaVersion: z.literal(1),
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
  firstPage: descriptorSchema,
}).strict();
const leafSchema = z.object({
  schemaVersion: z.literal(1),
  kind: z.literal("leaf"),
  entries: z.array(leafEntrySchema).min(1).max(256),
}).strict();
const postingSchema = z.object({
  schemaVersion: z.literal(1),
  kind: z.literal("postings"),
  cup: z.string().regex(OPENCUP_CUP_PATTERN),
  refs: z.array(z.object({
    sourceRow: positiveInteger,
    chunkOrdinal: nonnegativeInteger,
  }).strict()).min(1).max(1_000),
  next: descriptorSchema.nullable(),
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

type QueryBudget = { objectReads: number; rawBytes: number; loadedChunks: Set<number> };
type PostingMatch = {
  cup: string;
  manifest: OpenCupManifest;
  releaseId: string;
  root: string;
  refs: readonly { sourceRow: number; chunkOrdinal: number }[];
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
  if (manifest.sourceRows !== manifest.publicRows || manifest.indexedRows > manifest.publicRows) {
    throw new OpenCupUnavailableError("Conteggi manifest OpenCUP non riconciliati.");
  }
  if (manifest.headers.join("\n") !== OPENCUP_PROJECT_HEADERS.join("\n")) {
    throw new OpenCupUnavailableError("Header manifest OpenCUP divergenti.");
  }
  let expectedSourceRow = 1;
  for (const [ordinal, chunk] of manifest.chunks.entries()) {
    if (
      chunk.ordinal !== ordinal ||
      chunk.firstSourceRow !== expectedSourceRow ||
      chunk.format !== "jsonl-gzip-v1"
    ) {
      throw new OpenCupUnavailableError("Intervalli chunk OpenCUP non contigui.");
    }
    expectedSourceRow += chunk.rowCount;
  }
  if (expectedSourceRow !== manifest.publicRows + 1 || manifest.rootIndex.format !== "json-v1") {
    throw new OpenCupUnavailableError("Copertura chunk OpenCUP non completa.");
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
  const budget: QueryBudget = { objectReads: 0, rawBytes: 0, loadedChunks: new Set() };
  const entry = await findLeafEntry(root, manifest.rootIndex, cup, budget, signal);
  if (!entry) {
    return { cup, manifest, releaseId, root, refs: [], matchedRows: 0, budget };
  }
  if (start < 0 || start >= entry.matchedRows) {
    throw new Error("Cursor OpenCUP oltre i risultati disponibili.");
  }
  const refs: { sourceRow: number; chunkOrdinal: number }[] = [];
  let descriptor: ImmutableObjectDescriptor | null = entry.firstPage;
  let position = 0;
  const seenPages = new Set<string>();
  let previousSourceRow = 0;
  while (descriptor) {
    if (seenPages.has(descriptor.sha256)) {
      throw new OpenCupUnavailableError("Ciclo nella posting list OpenCUP.");
    }
    seenPages.add(descriptor.sha256);
    const page = postingSchema.parse(await readJsonObject(root, descriptor, budget, signal));
    if (page.cup !== cup) throw new OpenCupUnavailableError("Posting list riferita a un CUP diverso.");
    for (const ref of page.refs) {
      if (
        position >= entry.matchedRows ||
        ref.sourceRow <= previousSourceRow ||
        ref.sourceRow > manifest.publicRows ||
        ref.chunkOrdinal >= manifest.chunks.length
      ) {
        throw new OpenCupUnavailableError("Riferimento riga OpenCUP non valido.");
      }
      const chunk = manifest.chunks[ref.chunkOrdinal];
      if (ref.sourceRow < chunk.firstSourceRow || ref.sourceRow >= chunk.firstSourceRow + chunk.rowCount) {
        throw new OpenCupUnavailableError("Riferimento riga OpenCUP fuori dal chunk dichiarato.");
      }
      previousSourceRow = ref.sourceRow;
      if (position >= start && refs.length < maximum) refs.push(ref);
      position += 1;
    }
    descriptor = page.next;
  }
  if (position !== entry.matchedRows) {
    throw new OpenCupUnavailableError("Conteggio posting list OpenCUP divergente.");
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
): Promise<{ rows: IntegratedPublicRow[]; loadedChunks: number }> {
  const rows: IntegratedPublicRow[] = [];
  let loadedOrdinal: number | undefined;
  let loadedRows: IntegratedPublicRow[] = [];
  for (const ref of match.refs) {
    throwIfAborted(signal);
    if (loadedOrdinal !== ref.chunkOrdinal) {
      const chunk = match.manifest.chunks[ref.chunkOrdinal];
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
          Object.keys(row.cells).length !== match.manifest.headers.length ||
          match.manifest.headers.some((header) => !(header in row.cells)) ||
          row.sourceRowSha256 !== publicDigest ||
          row.id !== expectedId ||
          seenIds.has(row.id) ||
          row.evidenceLabel !== match.manifest.evidenceLabel ||
          Object.values(row.cells).some(
            (cell) => cell !== null && containsUnsafePublicUrl(cell),
          ) ||
          row.sourceUrls.some((url) => !isSafePublicHttpUrl(url)) ||
          row.sourceUrls.join("\n") !== expectedSourceUrls.join("\n") ||
          privateFields.some((field) => {
            const cell = row.cells[field];
            const matchingRedactions = row.redactions.filter(
              (redaction) => redaction.field === field && redaction.reason === "personal-identifier",
            );
            return ![null, ""].includes(cell) ||
              (cell === null && matchingRedactions.length !== 1) ||
              (cell === "" && matchingRedactions.length !== 0);
          }) ||
          row.redactions.some((redaction) => !(redaction.field in row.cells))
        ) {
          throw new OpenCupUnavailableError("Schema o ordine riga OpenCUP divergente.");
        }
        seenIds.add(row.id);
        return row;
      });
      loadedOrdinal = ref.chunkOrdinal;
      match.budget.loadedChunks.add(ref.chunkOrdinal);
    }
    const chunk = match.manifest.chunks[ref.chunkOrdinal];
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
    distinctCups: manifest.distinctCups,
    fixtureOnly: "fixtureOnly" in manifest,
    publicRows: manifest.publicRows,
    publishedAt: manifest.publishedAt,
    releaseId,
  } as const;
}
