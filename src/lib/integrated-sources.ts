import "server-only";

import { constants } from "node:fs";
import { open } from "node:fs/promises";
import { join } from "node:path";
import { promisify } from "node:util";
import { gunzip } from "node:zlib";
import {
  assertArchiveReceipt,
  assertIntegratedDatasetChunk,
  assertIntegratedDatasetCatalog,
  assertIntegratedDatasetProof,
  assertIntegratedReleaseProof,
  assertPublicSourceCatalog,
  canonicalJson,
  INTEGRATED_ROW_CHUNK_MAX_RAW_BYTES,
  integratedRowChunkCount,
  integratedRowChunkName,
  sha256Hex,
  type ArchiveReceipt,
  type IntegratedDatasetCatalog,
  type IntegratedDatasetCatalogEntry,
  type IntegratedDatasetProof,
  type IntegratedPublicRow,
  type IntegratedReleaseProof,
  type PublicSourceCatalogEntry,
} from "@/lib/integrated-source-contract";

const unzip = promisify(gunzip);
const SOURCE_LEDGER_DIRECTORY = join(process.cwd(), "data", "source-ledger");
const INTEGRATED_DATA_DIRECTORY = join(
  process.cwd(),
  "src",
  "data",
  "generated",
  "integrated",
);
const RELEASE_PROOF_PATH = join(SOURCE_LEDGER_DIRECTORY, "release-proof.json");
const ARCHIVE_RECEIPT_PATH = join(SOURCE_LEDGER_DIRECTORY, "receipt.json");
const SOURCE_CATALOG_PATH = join(SOURCE_LEDGER_DIRECTORY, "sources.jsonl");
const DATASET_PROOF_PATH = join(SOURCE_LEDGER_DIRECTORY, "dataset-proof.json");
const DATASET_CATALOG_PATH = join(INTEGRATED_DATA_DIRECTORY, "catalog.json");
const DATASET_ROWS_DIRECTORY = join(INTEGRATED_DATA_DIRECTORY, "rows");
const MAX_BOOTSTRAP_PROOF_BYTES = 1024 * 1024;
const MAX_ARCHIVE_RECEIPT_BYTES = 1024 * 1024;
const MAX_SOURCE_CATALOG_BYTES = 16 * 1024 * 1024;
const MAX_DATASET_PROOF_BYTES = 1024 * 1024;
const MAX_DATASET_CATALOG_BYTES = 1024 * 1024;
const MAX_COMPRESSED_DATASET_CHUNK_BYTES = INTEGRATED_ROW_CHUNK_MAX_RAW_BYTES + 64 * 1024;
const MAX_CONCURRENT_DATASET_LOADS = 2;
const MAX_PENDING_DATASET_LOADS = 64;
const MAX_CONSUMERS_PER_CHUNK = 64;
const BOUNDED_READ_BLOCK_BYTES = 64 * 1024;

export class IntegratedLoadOverloadedError extends Error {
  constructor() {
    super("Il caricamento dei dati integrati è temporaneamente saturo.");
    this.name = "IntegratedLoadOverloadedError";
  }
}

export type IntegratedSourceBundle = {
  release: IntegratedReleaseProof;
  receipt: ArchiveReceipt;
  catalog: IntegratedDatasetCatalog;
  datasetProof: IntegratedDatasetProof;
  datasetsById: ReadonlyMap<string, IntegratedDatasetCatalogEntry>;
  sources: readonly PublicSourceCatalogEntry[];
};

let bundlePromise: Promise<IntegratedSourceBundle> | undefined;
export type LoadedIntegratedDatasetChunk = {
  ordinal: number;
  compressedBytes: number;
  uncompressedBytes: number;
  rows: readonly IntegratedPublicRow[];
};

type InFlightChunkLoad = {
  promise: Promise<LoadedIntegratedDatasetChunk>;
  controller: AbortController;
  consumers: number;
  settled: boolean;
};

type QueuedDatasetLoad = {
  resolve: () => void;
  reject: (reason: unknown) => void;
  signal: AbortSignal;
  onAbort: () => void;
};

const inFlightChunkLoads = new Map<string, InFlightChunkLoad>();
const datasetLoadQueue: QueuedDatasetLoad[] = [];
let activeDatasetLoads = 0;
let completedChunkLoads = 0;
let maxObservedChunkRawBytes = 0;

function abortedError(): Error {
  const error = new Error("Caricamento dei dati integrati annullato.");
  error.name = "AbortError";
  return error;
}

function throwIfAborted(signal?: AbortSignal): void {
  if (signal?.aborted) throw abortedError();
}

function acquireDatasetLoadSlot(signal: AbortSignal): Promise<void> {
  throwIfAborted(signal);
  if (activeDatasetLoads < MAX_CONCURRENT_DATASET_LOADS) {
    activeDatasetLoads += 1;
    return Promise.resolve();
  }
  if (datasetLoadQueue.length >= MAX_PENDING_DATASET_LOADS) {
    return Promise.reject(new IntegratedLoadOverloadedError());
  }
  return new Promise((resolve, reject) => {
    const queued = {} as QueuedDatasetLoad;
    const onAbort = () => {
      const index = datasetLoadQueue.indexOf(queued);
      if (index >= 0) datasetLoadQueue.splice(index, 1);
      reject(abortedError());
    };
    Object.assign(queued, { resolve, reject, signal, onAbort });
    signal.addEventListener("abort", onAbort, { once: true });
    datasetLoadQueue.push(queued);
  });
}

function releaseDatasetLoadSlot(): void {
  activeDatasetLoads -= 1;
  while (datasetLoadQueue.length > 0) {
    const next = datasetLoadQueue.shift()!;
    next.signal.removeEventListener("abort", next.onAbort);
    if (next.signal.aborted) {
      next.reject(abortedError());
      continue;
    }
    activeDatasetLoads += 1;
    next.resolve();
    break;
  }
}

export async function withIntegratedDatasetLoadSlot<T>(
  load: () => Promise<T>,
  signal: AbortSignal,
): Promise<T> {
  await acquireDatasetLoadSlot(signal);
  try {
    throwIfAborted(signal);
    return await load();
  } finally {
    releaseDatasetLoadSlot();
  }
}

async function readRegular(
  path: string,
  label: string,
  maximumBytes: number,
  expectedBytes?: number,
  signal?: AbortSignal,
): Promise<Buffer> {
  let handle;
  try {
    throwIfAborted(signal);
    handle = await open(path, constants.O_RDONLY | constants.O_NOFOLLOW);
    const metadata = await handle.stat();
    if (
      !metadata.isFile() ||
      !Number.isSafeInteger(metadata.size) ||
      metadata.size <= 0 ||
      metadata.size > maximumBytes ||
      (expectedBytes !== undefined && metadata.size !== expectedBytes)
    ) {
      throw new Error(`${label} mancante o non regolare.`);
    }
    const bytes = Buffer.allocUnsafe(metadata.size);
    let offset = 0;
    while (offset < bytes.length) {
      throwIfAborted(signal);
      const length = Math.min(BOUNDED_READ_BLOCK_BYTES, bytes.length - offset);
      const { bytesRead } = await handle.read(bytes, offset, length, offset);
      if (bytesRead <= 0) throw new Error(`${label} è cambiato durante la lettura.`);
      offset += bytesRead;
    }
    const probe = Buffer.allocUnsafe(1);
    const [{ bytesRead: extraBytes }, finalMetadata] = await Promise.all([
      handle.read(probe, 0, 1, bytes.length),
      handle.stat(),
    ]);
    throwIfAborted(signal);
    if (extraBytes !== 0 || finalMetadata.size !== metadata.size) {
      throw new Error(`${label} è cambiato durante la lettura.`);
    }
    return bytes;
  } catch (error) {
    if (
      error instanceof Error &&
      (error.name === "AbortError" || error.message.startsWith(label))
    ) {
      throw error;
    }
    throw new Error(`${label} mancante o non regolare.`, { cause: error });
  } finally {
    await handle?.close();
  }
}

function decodeUtf8(bytes: Buffer, label: string): string {
  try {
    return new TextDecoder("utf-8", { fatal: true }).decode(bytes);
  } catch {
    throw new Error(`${label} non è UTF-8 valido.`);
  }
}

function parseCanonicalJson(bytes: Buffer, label: string): unknown {
  let value: unknown;
  try {
    value = JSON.parse(decodeUtf8(bytes, label));
  } catch {
    throw new Error(`${label} non è JSON UTF-8 valido.`);
  }
  if (!bytes.equals(Buffer.from(`${canonicalJson(value)}\n`, "utf8"))) {
    throw new Error(`${label} non usa la serializzazione canonica attesa.`);
  }
  return value;
}

function parseCanonicalJsonLines(bytes: Buffer, label: string): unknown[] {
  if (bytes.length === 0 || bytes[bytes.length - 1] !== 0x0a) {
    throw new Error(`${label} deve essere non vuoto e terminare con newline.`);
  }
  const lines = decodeUtf8(bytes, label).slice(0, -1).split("\n");
  return lines.map((line, index) => {
    let value: unknown;
    try {
      value = JSON.parse(line);
    } catch {
      throw new Error(`${label}, riga ${index + 1}, non è JSON valido.`);
    }
    if (line !== canonicalJson(value)) {
      throw new Error(`${label}, riga ${index + 1}, non è canonico.`);
    }
    return value;
  });
}

async function buildBundle(): Promise<IntegratedSourceBundle> {
  const firstReleaseBytes = await readRegular(
    RELEASE_PROOF_PATH,
    "Prova di rilascio",
    MAX_BOOTSTRAP_PROOF_BYTES,
  );
  const release = assertIntegratedReleaseProof(
    parseCanonicalJson(firstReleaseBytes, "Prova di rilascio"),
  );
  const [receiptBytes, sourceCatalogBytes, datasetProofBytes, datasetCatalogBytes] =
    await Promise.all([
      readRegular(
        ARCHIVE_RECEIPT_PATH,
        "Prova del corpus",
        MAX_ARCHIVE_RECEIPT_BYTES,
        release.archiveReceipt.receiptBytes,
      ),
      readRegular(
        SOURCE_CATALOG_PATH,
        "Catalogo delle fonti",
        MAX_SOURCE_CATALOG_BYTES,
        release.sourceCatalog.catalogBytes,
      ),
      readRegular(
        DATASET_PROOF_PATH,
        "Prova dei dataset",
        MAX_DATASET_PROOF_BYTES,
        release.datasets.proofBytes,
      ),
      readRegular(
        DATASET_CATALOG_PATH,
        "Catalogo dei dataset",
        MAX_DATASET_CATALOG_BYTES,
        release.datasets.catalogBytes,
      ),
    ]);

  const catalog = assertIntegratedDatasetCatalog(
    parseCanonicalJson(datasetCatalogBytes, "Catalogo dei dataset"),
    release,
    datasetCatalogBytes,
  );
  const datasetProof = assertIntegratedDatasetProof(
    parseCanonicalJson(datasetProofBytes, "Prova dei dataset"),
    release,
    datasetProofBytes,
    catalog,
  );
  const receipt = assertArchiveReceipt(
    parseCanonicalJson(receiptBytes, "Prova del corpus"),
    release,
    receiptBytes,
  );
  const sources = assertPublicSourceCatalog(
    parseCanonicalJsonLines(sourceCatalogBytes, "Catalogo delle fonti"),
    release,
    sourceCatalogBytes,
  );

  const secondReleaseBytes = await readRegular(
    RELEASE_PROOF_PATH,
    "Prova di rilascio",
    MAX_BOOTSTRAP_PROOF_BYTES,
    firstReleaseBytes.length,
  );
  if (!firstReleaseBytes.equals(secondReleaseBytes)) {
    throw new Error("La prova di rilascio è cambiata durante il caricamento.");
  }

  return {
    release,
    receipt,
    catalog,
    datasetProof,
    datasetsById: new Map(catalog.datasets.map((dataset) => [dataset.id, dataset])),
    sources,
  };
}

/** Internal, server-only entry point. Public routes must use integrated-public-view.ts. */
export function loadIntegratedSourceBundle(): Promise<IntegratedSourceBundle> {
  bundlePromise ??= buildBundle();
  return bundlePromise;
}

async function readDatasetChunk(
  bundle: IntegratedSourceBundle,
  dataset: IntegratedDatasetCatalogEntry,
  ordinal: number,
  signal?: AbortSignal,
): Promise<LoadedIntegratedDatasetChunk> {
  if (dataset.publication !== "rows" && dataset.publication !== "source-index") {
    throw new Error(`Il dataset ${dataset.id} non espone chunk pubblici.`);
  }
  const chunkCount = integratedRowChunkCount(dataset.publicRows);
  if (!Number.isSafeInteger(ordinal) || ordinal < 0 || ordinal >= chunkCount) {
    throw new Error(`Indice chunk fuori perimetro per ${dataset.id}.`);
  }
  const artifactName = integratedRowChunkName(dataset.id, ordinal);
  const artifactPath = join(DATASET_ROWS_DIRECTORY, artifactName);
  const artifactKey = `src/data/generated/integrated/rows/${artifactName}`;
  const expectedHash = bundle.datasetProof.artifactSha256[artifactKey];
  if (!expectedHash) throw new Error(`Chunk righe non allowlisted per ${dataset.id}.`);

  const compressed = await readRegular(
    artifactPath,
    `Chunk ${ordinal} del dataset ${dataset.id}`,
    MAX_COMPRESSED_DATASET_CHUNK_BYTES,
    undefined,
    signal,
  );
  if (sha256Hex(compressed) !== expectedHash) {
    throw new Error(`I byte del chunk divergono dalla prova per ${dataset.id}.`);
  }
  const uncompressed = await gunzipBounded(compressed, dataset.id, signal);
  const rows = assertIntegratedDatasetChunk(
    dataset,
    ordinal,
    parseCanonicalJsonLines(uncompressed, `Chunk ${ordinal} del dataset ${dataset.id}`),
  );
  completedChunkLoads += 1;
  maxObservedChunkRawBytes = Math.max(maxObservedChunkRawBytes, uncompressed.length);
  return {
    ordinal,
    compressedBytes: compressed.length,
    uncompressedBytes: uncompressed.length,
    rows,
  };
}

/** The dataset argument must come from the validated allowlist in the bundle. */
export function loadIntegratedDatasetChunk(
  bundle: IntegratedSourceBundle,
  dataset: IntegratedDatasetCatalogEntry,
  ordinal: number,
  signal?: AbortSignal,
): Promise<LoadedIntegratedDatasetChunk> {
  throwIfAborted(signal);
  const allowlisted = bundle.datasetsById.get(dataset.id);
  if (allowlisted !== dataset) {
    throw new Error("Dataset non proveniente dalla allowlist validata.");
  }
  const key = `${dataset.id}:${ordinal}`;
  const existing = inFlightChunkLoads.get(key);
  if (existing) return attachChunkConsumer(existing, signal);

  const controller = new AbortController();
  const pending = {} as InFlightChunkLoad;
  pending.controller = controller;
  pending.consumers = 0;
  pending.settled = false;
  pending.promise = withIntegratedDatasetLoadSlot(
    () => readDatasetChunk(bundle, dataset, ordinal, controller.signal),
    controller.signal,
  ).finally(() => {
    pending.settled = true;
    if (inFlightChunkLoads.get(key) === pending) {
      inFlightChunkLoads.delete(key);
    }
  });
  inFlightChunkLoads.set(key, pending);
  return attachChunkConsumer(pending, signal);
}

async function gunzipBounded(
  compressed: Buffer,
  datasetId: string,
  signal?: AbortSignal,
): Promise<Buffer> {
  let uncompressed: Buffer;
  try {
    uncompressed = await unzip(compressed, {
      maxOutputLength: INTEGRATED_ROW_CHUNK_MAX_RAW_BYTES,
    });
  } catch (error) {
    throw new Error(`Chunk compresso non valido o oltre limite per ${datasetId}.`, {
      cause: error,
    });
  }
  throwIfAborted(signal);
  if (uncompressed.length > INTEGRATED_ROW_CHUNK_MAX_RAW_BYTES) {
    throw new Error(`Chunk decompresso troppo grande per ${datasetId}.`);
  }
  return uncompressed;
}

function attachChunkConsumer(
  pending: InFlightChunkLoad,
  signal?: AbortSignal,
): Promise<LoadedIntegratedDatasetChunk> {
  throwIfAborted(signal);
  if (pending.consumers >= MAX_CONSUMERS_PER_CHUNK) {
    return Promise.reject(new IntegratedLoadOverloadedError());
  }
  pending.consumers += 1;
  return new Promise((resolve, reject) => {
    let finished = false;
    const finish = () => {
      if (finished) return false;
      finished = true;
      signal?.removeEventListener("abort", onAbort);
      pending.consumers -= 1;
      if (pending.consumers === 0 && !pending.settled) pending.controller.abort();
      return true;
    };
    const onAbort = () => {
      if (finish()) reject(abortedError());
    };
    signal?.addEventListener("abort", onAbort, { once: true });
    pending.promise.then(
      (value) => {
        if (finish()) resolve(value);
      },
      (error) => {
        if (finish()) reject(error);
      },
    );
  });
}

/** Test-only observability for the bounded, server-internal artifact loader. */
export function getIntegratedDatasetLoaderDiagnosticsForTests() {
  return {
    maxConcurrentLoads: MAX_CONCURRENT_DATASET_LOADS,
    maxPendingLoads: MAX_PENDING_DATASET_LOADS,
    maxConsumersPerChunk: MAX_CONSUMERS_PER_CHUNK,
    activeLoads: activeDatasetLoads,
    queuedLoads: datasetLoadQueue.length,
    inFlightChunkKeys: [...inFlightChunkLoads.keys()],
    completedChunkLoads,
    maxObservedChunkRawBytes,
  } as const;
}

export function resetIntegratedDatasetLoaderDiagnosticsForTests(): void {
  if (activeDatasetLoads !== 0 || datasetLoadQueue.length !== 0 || inFlightChunkLoads.size !== 0) {
    throw new Error("Impossibile azzerare la diagnostica durante un caricamento.");
  }
  completedChunkLoads = 0;
  maxObservedChunkRawBytes = 0;
}

export function readRegularFileForTests(path: string, maximumBytes: number): Promise<Buffer> {
  return readRegular(path, "File di test", maximumBytes);
}

export function parseCanonicalJsonLinesForTests(bytes: Buffer): unknown[] {
  return parseCanonicalJsonLines(bytes, "JSONL di test");
}

export function gunzipDatasetChunkForTests(bytes: Buffer): Promise<Buffer> {
  return gunzipBounded(bytes, "test");
}
