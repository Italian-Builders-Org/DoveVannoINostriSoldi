import "server-only";

import {
  loadIntegratedDatasetChunk,
  loadIntegratedSourceBundle,
} from "@/lib/integrated-sources";
import type {
  IntegratedDatasetCatalogEntry,
  IntegratedEvidenceLabel,
  IntegratedLicenseStatus,
  IntegratedPublication,
  IntegratedPublicRow,
  IntegratedSourceMetadata,
  PublicSourceCatalogEntry,
} from "@/lib/integrated-source-contract";
import {
  canonicalJson,
  INTEGRATED_ROW_CHUNK_MAX_RAW_BYTES,
  INTEGRATED_ROW_CHUNK_ROWS,
  sha256Hex,
} from "@/lib/integrated-source-contract";

export const INTEGRATED_DEFAULT_LIMIT = 50;
export const INTEGRATED_MAX_LIMIT = 100;
export const INTEGRATED_MAX_QUERY_LENGTH = 200;
export const INTEGRATED_MAX_CURSOR_LENGTH = 512;
export const INTEGRATED_MAX_SEARCH_CHUNKS = 8;
export const INTEGRATED_MAX_SEARCH_ROWS = 8_000;
export const INTEGRATED_MAX_SEARCH_RAW_BYTES = 16 * 1024 * 1024;
const INTEGRATED_MAX_SOURCE_OFFSET = 100_000;

export class IntegratedQueryError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "IntegratedQueryError";
  }
}

export class IntegratedDatasetNotFoundError extends Error {
  constructor(datasetId: string) {
    super(`Dataset non trovato: ${datasetId}`);
    this.name = "IntegratedDatasetNotFoundError";
  }
}

export type IntegratedDatasetMetadata = {
  id: string;
  title: string;
  domain: string;
  authority: string;
  licenseStatus: IntegratedLicenseStatus;
  publication: IntegratedPublication;
  evidenceLabel: IntegratedEvidenceLabel;
  sourceRows: number;
  publicRows: number;
  rowsWithPublicSource: number;
  headers: readonly string[];
  caveats: readonly string[];
  sourceMetadata: IntegratedSourceMetadata;
  provenanceHref: string;
  queryable: boolean;
  publicationNote: string;
  reuseNote: string;
};

export type IntegratedDatasetResult = {
  dataset: IntegratedDatasetMetadata;
  query: string | null;
  limit: number;
  offset: number | null;
  /** Exact without q; exact for a filtered scan only when one response exhausts it; otherwise null. */
  matchedRows: number | null;
  rows: readonly IntegratedPublicRow[];
  pagination: {
    returned: number;
    scannedRows: number;
    scanStartSourceRow: number | null;
    scanEndSourceRow: number | null;
    /** Resumes at the next unscanned source row and is bound to dataset, release and normalized q. */
    nextCursor: string | null;
    exhausted: boolean;
  };
};

export type PublicSourceResult = {
  query: string | null;
  disposition: "published" | "quarantined" | null;
  limit: number;
  offset: number;
  matchedSources: number;
  sources: readonly PublicSourceCatalogEntry[];
};

type DatasetSelectorInput = {
  datasetId: unknown;
  q?: unknown;
  limit?: unknown;
  offset?: unknown;
  cursor?: unknown;
  signal?: AbortSignal;
};

type SourceSelectorInput = {
  q?: unknown;
  disposition?: unknown;
  limit?: unknown;
  offset?: unknown;
};

function singleString(value: unknown, label: string, optional = true): string | undefined {
  if (value === undefined || value === null || value === "") {
    if (optional) return undefined;
    throw new IntegratedQueryError(`Il parametro ${label} è obbligatorio.`);
  }
  if (Array.isArray(value) || typeof value !== "string") {
    throw new IntegratedQueryError(`Il parametro ${label} deve comparire una sola volta.`);
  }
  return value;
}

function boundedInteger(
  value: unknown,
  label: string,
  fallback: number,
  maximum: number,
  minimum = 0,
): number {
  if (value === undefined || value === null || value === "") return fallback;
  if (Array.isArray(value)) {
    throw new IntegratedQueryError(`Il parametro ${label} deve comparire una sola volta.`);
  }
  const text = typeof value === "number" ? String(value) : value;
  if (typeof text !== "string" || !/^\d+$/.test(text)) {
    throw new IntegratedQueryError(`Il parametro ${label} deve essere un intero non negativo.`);
  }
  const parsed = Number(text);
  if (!Number.isSafeInteger(parsed) || parsed < minimum || parsed > maximum) {
    throw new IntegratedQueryError(
      `Il parametro ${label} deve essere compreso tra ${minimum} e ${maximum}.`,
    );
  }
  return parsed;
}

function normalizedQuery(value: unknown): string | null {
  const text = singleString(value, "q");
  if (text === undefined) return null;
  const trimmed = text.trim();
  if (trimmed.length > INTEGRATED_MAX_QUERY_LENGTH) {
    throw new IntegratedQueryError(
      `Il parametro q non può superare ${INTEGRATED_MAX_QUERY_LENGTH} caratteri.`,
    );
  }
  return trimmed === "" ? null : trimmed;
}

type IntegratedCursorPayload = {
  datasetId: string;
  nextSourceRow: number;
  querySha256: string;
  releaseSetSha256: string;
  v: 1;
};

const CURSOR_KEYS = [
  "datasetId",
  "nextSourceRow",
  "querySha256",
  "releaseSetSha256",
  "v",
] as const;

function cursorQuerySha256(query: string | null): string {
  return sha256Hex(canonicalJson(query?.toLocaleLowerCase("it-IT") ?? null));
}

function encodeDatasetCursor(
  dataset: IntegratedDatasetCatalogEntry,
  releaseSetSha256: string,
  query: string | null,
  nextSourceRow: number,
): string {
  const payload: IntegratedCursorPayload = {
    datasetId: dataset.id,
    nextSourceRow,
    querySha256: cursorQuerySha256(query),
    releaseSetSha256,
    v: 1,
  };
  return Buffer.from(canonicalJson(payload), "utf8").toString("base64url");
}

function decodeDatasetCursor(
  value: unknown,
  dataset: IntegratedDatasetCatalogEntry,
  releaseSetSha256: string,
  query: string | null,
): IntegratedCursorPayload | null {
  const token = singleString(value, "cursor");
  if (token === undefined) return null;
  if (
    token.length > INTEGRATED_MAX_CURSOR_LENGTH ||
    token.length < 16 ||
    !/^[A-Za-z0-9_-]+$/.test(token)
  ) {
    throw new IntegratedQueryError("Il parametro cursor non è valido.");
  }
  let decoded: Buffer;
  let raw: unknown;
  try {
    decoded = Buffer.from(token, "base64url");
    if (decoded.toString("base64url") !== token) throw new Error("base64url non canonico");
    raw = JSON.parse(decoded.toString("utf8"));
  } catch {
    throw new IntegratedQueryError("Il parametro cursor non è valido.");
  }
  if (
    raw === null ||
    typeof raw !== "object" ||
    Array.isArray(raw) ||
    canonicalJson(raw) !== decoded.toString("utf8") ||
    Object.keys(raw).join("\n") !== CURSOR_KEYS.join("\n")
  ) {
    throw new IntegratedQueryError("Il parametro cursor non è canonico.");
  }
  const cursor = raw as Record<string, unknown>;
  if (
    cursor.v !== 1 ||
    cursor.datasetId !== dataset.id ||
    cursor.releaseSetSha256 !== releaseSetSha256 ||
    cursor.querySha256 !== cursorQuerySha256(query) ||
    typeof cursor.querySha256 !== "string" ||
    !/^[0-9a-f]{64}$/.test(cursor.querySha256) ||
    typeof cursor.releaseSetSha256 !== "string" ||
    !/^[0-9a-f]{64}$/.test(cursor.releaseSetSha256) ||
    !Number.isSafeInteger(cursor.nextSourceRow) ||
    (cursor.nextSourceRow as number) < 1 ||
    (cursor.nextSourceRow as number) > dataset.publicRows + 1
  ) {
    throw new IntegratedQueryError(
      "Il parametro cursor non appartiene a questo dataset, rilascio o filtro.",
    );
  }
  return cursor as IntegratedCursorPayload;
}

function isQueryable(dataset: IntegratedDatasetCatalogEntry): boolean {
  return dataset.publication === "rows" || dataset.publication === "source-index";
}

function publicationNote(dataset: IntegratedDatasetCatalogEntry): string {
  if (dataset.publication === "rows") {
    return "Le righe pubbliche sono interrogabili senza cambiare i valori della sorgente.";
  }
  if (dataset.publication === "source-index") {
    return "L'indice pubblico delle fonti è interrogabile riga per riga.";
  }
  if (dataset.publication === "catalog-only") {
    return "Il dataset è integrato e contato, ma non produce righe pubbliche in questa vista.";
  }
  return "Il materiale è integrato e contato come derivato, senza trasformarlo in righe di fonte.";
}

function reuseNote(dataset: IntegratedDatasetCatalogEntry): string {
  if (dataset.licenseStatus === "verified-open-eu-reuse") {
    return "Riuso degli avvisi GUUE consentito dalla nota TED, salvo diversa indicazione (decisione 2011/833/UE); metadati SIMAP CC0 1.0.";
  }
  if (dataset.licenseStatus === "verified-open-iodl-2.0") {
    return "Riuso verificato: Italian Open Data License (IODL) 2.0.";
  }
  if (dataset.licenseStatus === "verified-open-cc-by-4.0") {
    return "Riuso verificato: CC BY 4.0.";
  }
  return "Condizioni di riuso non dichiarate nella sorgente: verificare l'asset primario prima di riutilizzarlo.";
}

/** Public titles that should read clearer than the raw catalog slug/title. */
const PUBLIC_DATASET_TITLES: Readonly<Record<string, string>> = {
  vincitori: "Fornitori per settore e importo",
  "gruppi-vincitori": "Gruppi societari dei fornitori",
  "vincitori-cig": "Collegamenti fornitore-CIG",
};

function publicTitle(dataset: IntegratedDatasetCatalogEntry): string {
  return PUBLIC_DATASET_TITLES[dataset.id] ?? dataset.title;
}

function publicMetadata(dataset: IntegratedDatasetCatalogEntry): IntegratedDatasetMetadata {
  return {
    id: dataset.id,
    title: publicTitle(dataset),
    domain: dataset.domain,
    authority: dataset.authority,
    licenseStatus: dataset.licenseStatus,
    publication: dataset.publication,
    evidenceLabel: dataset.evidenceLabel,
    sourceRows: dataset.rows,
    publicRows: dataset.publicRows,
    rowsWithPublicSource: dataset.rowsWithPublicSource,
    headers: dataset.headers,
    caveats: dataset.caveats,
    sourceMetadata: dataset.sourceMetadata,
    provenanceHref: `/fonti/copertura#dataset-${dataset.id}`,
    queryable: isQueryable(dataset),
    publicationNote: publicationNote(dataset),
    reuseNote: reuseNote(dataset),
  };
}

function rowContains(row: IntegratedPublicRow, foldedQuery: string): boolean {
  return Object.values(row.cells).some(
    (value) => value !== null && value.toLocaleLowerCase("it-IT").includes(foldedQuery),
  );
}

export async function getIntegratedDataOverview() {
  const bundle = await loadIntegratedSourceBundle();
  return {
    complete: bundle.release.complete,
    generatedAt: bundle.catalog.generatedAt,
    totals: bundle.catalog.totals,
    datasets: bundle.catalog.datasets.map(publicMetadata),
  } as const;
}

/** Sole row selector used by both pages and APIs. */
export async function selectIntegratedDataset(
  input: DatasetSelectorInput,
): Promise<IntegratedDatasetResult> {
  const datasetId = singleString(input.datasetId, "dataset", false)!;
  if (!/^[a-z0-9]+(?:-[a-z0-9]+)*$/.test(datasetId)) {
    throw new IntegratedDatasetNotFoundError(datasetId);
  }
  const q = normalizedQuery(input.q);
  const limit = boundedInteger(input.limit, "limit", INTEGRATED_DEFAULT_LIMIT, INTEGRATED_MAX_LIMIT, 1);
  const bundle = await loadIntegratedSourceBundle();
  const dataset = bundle.datasetsById.get(datasetId);
  if (!dataset) throw new IntegratedDatasetNotFoundError(datasetId);
  const metadata = publicMetadata(dataset);
  const offsetProvided = input.offset !== undefined && input.offset !== null && input.offset !== "";
  const cursorProvided = input.cursor !== undefined && input.cursor !== null && input.cursor !== "";
  if (offsetProvided && cursorProvided) {
    throw new IntegratedQueryError("Usa offset oppure cursor, non entrambi.");
  }
  if (q !== null && offsetProvided) {
    throw new IntegratedQueryError(
      "Offset è disponibile soltanto senza ricerca testuale; per continuare una ricerca usa cursor.",
    );
  }
  if (!metadata.queryable) {
    if (cursorProvided) {
      throw new IntegratedQueryError("Questo dataset non espone un cursor di righe.");
    }
    const offset = boundedInteger(input.offset, "offset", 0, 0);
    return {
      dataset: metadata,
      query: q,
      limit,
      offset,
      matchedRows: 0,
      rows: [],
      pagination: {
        returned: 0,
        scannedRows: 0,
        scanStartSourceRow: null,
        scanEndSourceRow: null,
        nextCursor: null,
        exhausted: true,
      },
    };
  }
  const cursor = decodeDatasetCursor(
    input.cursor,
    dataset,
    bundle.release.releaseSetSha256,
    q,
  );
  const maximumOffset = dataset.publicRows === 0 ? 0 : dataset.publicRows - 1;
  const offset = cursor === null
    ? boundedInteger(input.offset, "offset", 0, maximumOffset)
    : null;
  let nextSourceRow = cursor?.nextSourceRow ?? (offset! + 1);
  const scanStartSourceRow = nextSourceRow <= dataset.publicRows ? nextSourceRow : null;
  let scanEndSourceRow: number | null = null;
  let scannedRows = 0;
  let loadedChunks = 0;
  let loadedRawBytes = 0;
  const selected: IntegratedPublicRow[] = [];
  const foldedQuery = q?.toLocaleLowerCase("it-IT") ?? null;

  scan: while (nextSourceRow <= dataset.publicRows && selected.length < limit) {
    const ordinal = Math.floor((nextSourceRow - 1) / INTEGRATED_ROW_CHUNK_ROWS);
    if (foldedQuery !== null && loadedChunks >= INTEGRATED_MAX_SEARCH_CHUNKS) break;
    const chunk = await loadIntegratedDatasetChunk(bundle, dataset, ordinal, input.signal);
    loadedChunks += 1;
    loadedRawBytes += chunk.uncompressedBytes;
    if (
      chunk.uncompressedBytes > INTEGRATED_ROW_CHUNK_MAX_RAW_BYTES ||
      loadedRawBytes > INTEGRATED_MAX_SEARCH_RAW_BYTES
    ) {
      throw new Error(`Budget di decompressione superato per ${dataset.id}.`);
    }
    const chunkFirstSourceRow = ordinal * INTEGRATED_ROW_CHUNK_ROWS + 1;
    const startIndex = nextSourceRow - chunkFirstSourceRow;
    for (let index = startIndex; index < chunk.rows.length; index += 1) {
      if (foldedQuery !== null && scannedRows >= INTEGRATED_MAX_SEARCH_ROWS) break scan;
      const row = chunk.rows[index];
      if (!row || row.sourceRow !== nextSourceRow) {
        throw new Error(`Ordine chunk divergente durante la lettura di ${dataset.id}.`);
      }
      scannedRows += 1;
      scanEndSourceRow = row.sourceRow;
      nextSourceRow = row.sourceRow + 1;
      if (foldedQuery === null || rowContains(row, foldedQuery)) selected.push(row);
      if (selected.length >= limit) break scan;
    }
  }
  const exhausted = nextSourceRow > dataset.publicRows;
  const nextCursor = exhausted
    ? null
    : encodeDatasetCursor(
        dataset,
        bundle.release.releaseSetSha256,
        q,
        nextSourceRow,
      );
  return {
    dataset: metadata,
    query: q,
    limit,
    offset,
    matchedRows:
      q === null
        ? dataset.publicRows
        : scanStartSourceRow === 1 && exhausted
          ? selected.length
          : null,
    rows: selected,
    pagination: {
      returned: selected.length,
      scannedRows,
      scanStartSourceRow,
      scanEndSourceRow,
      nextCursor,
      exhausted,
    },
  };
}

function sourceContains(source: PublicSourceCatalogEntry, foldedQuery: string): boolean {
  return [
    source.id,
    source.classification,
    source.disposition,
    source.publicValue,
    ...source.reasonCodes,
  ].some((value) => value?.toLocaleLowerCase("it-IT").includes(foldedQuery));
}

/** Sole source-identity selector used by both pages and APIs. */
export async function selectPublicSourceCatalog(
  input: SourceSelectorInput = {},
): Promise<PublicSourceResult> {
  const q = normalizedQuery(input.q);
  const dispositionValue = singleString(input.disposition, "disposition");
  if (
    dispositionValue !== undefined &&
    dispositionValue !== "published" &&
    dispositionValue !== "quarantined"
  ) {
    throw new IntegratedQueryError("Il parametro disposition non è riconosciuto.");
  }
  const disposition = dispositionValue ?? null;
  const limit = boundedInteger(input.limit, "limit", INTEGRATED_DEFAULT_LIMIT, INTEGRATED_MAX_LIMIT, 1);
  const offset = boundedInteger(input.offset, "offset", 0, INTEGRATED_MAX_SOURCE_OFFSET);
  const bundle = await loadIntegratedSourceBundle();
  const foldedQuery = q?.toLocaleLowerCase("it-IT") ?? null;
  const matching = bundle.sources.filter(
    (source) =>
      (disposition === null || source.disposition === disposition) &&
      (foldedQuery === null || sourceContains(source, foldedQuery)),
  );
  return {
    query: q,
    disposition,
    limit,
    offset,
    matchedSources: matching.length,
    sources: matching.slice(offset, offset + limit),
  };
}

export async function getIntegratedSourceCoverage() {
  const bundle = await loadIntegratedSourceBundle();
  return {
    complete: bundle.release.complete,
    releaseSetSha256: bundle.release.releaseSetSha256,
    archive: {
      expectedEntries: bundle.receipt.expected.entries,
      observedEntries: bundle.receipt.observed.entries,
      regular: bundle.receipt.observed.regular,
      hardlink: bundle.receipt.observed.hardlink,
      symlink: bundle.receipt.observed.symlink,
      storedBytes: bundle.receipt.observed.storedBytes,
      logicalBytes: bundle.receipt.observed.logicalBytes,
      dispositions: bundle.receipt.observed.dispositions,
      contentClasses: bundle.receipt.observed.contentClasses,
      families: bundle.receipt.observed.families,
    },
    sources: {
      expectedIdentities: bundle.release.sourceCatalog.identities,
      observedIdentities: bundle.sources.length,
      published: bundle.release.sourceCatalog.published,
      quarantined: bundle.release.sourceCatalog.quarantined,
      totalOccurrences: bundle.release.sourceCatalog.totalOccurrences,
    },
    datasets: {
      ...bundle.catalog.totals,
      entries: bundle.catalog.datasets.map(publicMetadata),
    },
  } as const;
}

export type PnrrProjectSelectorInput = Partial<Record<import("@/lib/pnrr-projects-index").PnrrFilter | "limit" | "cursor", unknown>> & { signal?: AbortSignal };

/** Indexed PNRR view, sharing the validated corpus rows with the generic data API. */
export async function selectPnrrProjects(input: PnrrProjectSelectorInput) {
  const { PNRR_PROJECT_DATASET, pnrrProjectMetadata, pnrrFilterNames, pnrrFilterPatterns, pnrrMatchingRows } = await import("@/lib/pnrr-projects-index");
  const filters: import("@/lib/pnrr-projects-index").PnrrFilters = {};
  for (const field of pnrrFilterNames) {
    const value = singleString(input[field], field)?.trim().toUpperCase();
    if (value) {
      if (value.length > 32 || !pnrrFilterPatterns[field].test(value)) throw new IntegratedQueryError(`Il filtro ${field} richiede un codice esatto valido.`);
      filters[field] = value;
    }
  }
  const limit = boundedInteger(input.limit, "limit", 25, 100, 1);
  const bundle = await loadIntegratedSourceBundle();
  const dataset = bundle.datasetsById.get(PNRR_PROJECT_DATASET);
  if (!dataset || dataset.receiptSha256 !== pnrrProjectMetadata.receiptSha256 || dataset.publicRows !== pnrrProjectMetadata.coverage.projectRows) {
    throw new Error("Indice PNRR non coerente con il corpus pubblicato.");
  }
  const queryHash = sha256Hex(canonicalJson(filters));
  const token = singleString(input.cursor, "cursor");
  let position = 0;
  if (token !== undefined) {
    if (token.length > 512 || !/^[A-Za-z0-9_-]+$/.test(token)) throw new IntegratedQueryError("Cursor PNRR non valido.");
    try {
      const bytes = Buffer.from(token, "base64url");
      if (bytes.toString("base64url") !== token) throw new Error();
      const cursor = JSON.parse(bytes.toString("utf8")) as Record<string, unknown>;
      if (canonicalJson(Object.keys(cursor).sort()) !== canonicalJson(["next", "query", "release", "v"]) || cursor.v !== 1 || cursor.query !== queryHash || cursor.release !== bundle.release.releaseSetSha256 || !Number.isSafeInteger(cursor.next) || (cursor.next as number) <= 0) throw new Error();
      position = cursor.next as number;
    } catch { throw new IntegratedQueryError("Cursor PNRR non valido o riferito a filtri/rilascio diversi."); }
  }
  const refs = await pnrrMatchingRows(filters);
  const matchedRows = refs?.length ?? dataset.publicRows;
  if (position > 0 && position >= matchedRows) throw new IntegratedQueryError("Cursor PNRR oltre i risultati disponibili.");
  const start = position;
  const rows: IntegratedPublicRow[] = [];
  let chunks = 0;
  let rawBytes = 0;
  let loaded: Awaited<ReturnType<typeof loadIntegratedDatasetChunk>> | undefined;
  while (position < matchedRows && rows.length < limit) {
    const sourceRow = refs?.[position] ?? position + 1;
    const ordinal = Math.floor((sourceRow - 1) / INTEGRATED_ROW_CHUNK_ROWS);
    if (!loaded || loaded.ordinal !== ordinal) {
      if (chunks >= INTEGRATED_MAX_SEARCH_CHUNKS) break;
      loaded = await loadIntegratedDatasetChunk(bundle, dataset, ordinal, input.signal);
      chunks += 1;
      rawBytes += loaded.uncompressedBytes;
      if (rawBytes > INTEGRATED_MAX_SEARCH_RAW_BYTES) throw new Error("Budget PNRR superato.");
    }
    const row = loaded.rows[(sourceRow - 1) % INTEGRATED_ROW_CHUNK_ROWS];
    if (!row || row.sourceRow !== sourceRow) throw new Error("Riferimento indice PNRR divergente.");
    rows.push(row);
    position += 1;
  }
  const nextCursor = position < matchedRows ? Buffer.from(canonicalJson({ v: 1, next: position, query: queryHash, release: bundle.release.releaseSetSha256 })).toString("base64url") : null;
  return {
    dataset: publicMetadata(dataset), referenceDate: pnrrProjectMetadata.referenceDate, filters,
    coverage: pnrrProjectMetadata.coverage, matchedRows, rows,
    pagination: { limit, returned: rows.length, start, nextCursor, exhausted: nextCursor === null, loadedChunks: chunks },
  };
}
