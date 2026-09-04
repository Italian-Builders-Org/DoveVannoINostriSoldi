import "server-only";

import {
  aggregateRecipientInsights,
  detectInsightRoles,
  emptyInsights,
  formatInsightTeaser,
  type DatasetInsights,
} from "@/lib/integrated-dataset-insight-core";
import {
  INTEGRATED_ROW_CHUNK_MAX_RAW_BYTES,
  INTEGRATED_ROW_CHUNK_ROWS,
  type IntegratedPublicRow,
} from "@/lib/integrated-source-contract";
import {
  loadIntegratedDatasetChunk,
  loadIntegratedSourceBundle,
} from "@/lib/integrated-sources";

export {
  aggregateRecipientInsights,
  detectInsightRoles,
  emptyInsights,
  formatInsightTeaser,
  insightCapabilityBadge,
  isInsightCapable,
  parseInsightAmount,
  looksLikeAmountHeader,
  amountColumnKeys,
  formatIntegratedAmountCell,
  INSIGHT_RECURRENCE_N,
  INSIGHT_TOP_N,
  type DatasetInsights,
  type InsightColumnRoles,
  type InsightRecipient,
} from "@/lib/integrated-dataset-insight-core";

/** Same safety ceiling as filtered search in integrated-public-view. */
const INSIGHT_MAX_CHUNKS = 8;
const INSIGHT_MAX_ROWS = 8_000;
const INSIGHT_MAX_RAW_BYTES = 16 * 1024 * 1024;
/** Catalog card teasers: one or two chunks is enough for a first-recipient line. */
const TEASER_MAX_CHUNKS = 2;
const TEASER_MAX_ROWS = 2_000;
const TEASER_MAX_PARALLEL = 8;

/**
 * Scans public row chunks within the same safety budget as filtered search.
 * Returns null when the dataset id is unknown.
 */
export async function loadDatasetInsights(
  datasetId: string,
  options: {
    signal?: AbortSignal;
    topN?: number;
    maxChunks?: number;
    maxRows?: number;
  } = {},
): Promise<DatasetInsights | null> {
  if (!/^[a-z0-9]+(?:-[a-z0-9]+)*$/.test(datasetId)) return null;
  const bundle = await loadIntegratedSourceBundle();
  const dataset = bundle.datasetsById.get(datasetId);
  if (!dataset) return null;
  const queryable = dataset.publication === "rows" || dataset.publication === "source-index";
  const roles = detectInsightRoles(dataset.headers);
  if (!queryable || roles.recipient === null || roles.amount === null) {
    return emptyInsights(datasetId, roles, dataset.publicRows, false);
  }

  const maxChunks = options.maxChunks ?? INSIGHT_MAX_CHUNKS;
  const maxRows = options.maxRows ?? INSIGHT_MAX_ROWS;
  const collected: IntegratedPublicRow[] = [];
  let nextSourceRow = 1;
  let scannedRows = 0;
  let loadedChunks = 0;
  let loadedRawBytes = 0;

  scan: while (nextSourceRow <= dataset.publicRows) {
    if (loadedChunks >= maxChunks) break;
    if (scannedRows >= maxRows) break;
    const ordinal = Math.floor((nextSourceRow - 1) / INTEGRATED_ROW_CHUNK_ROWS);
    const chunk = await loadIntegratedDatasetChunk(bundle, dataset, ordinal, options.signal);
    loadedChunks += 1;
    loadedRawBytes += chunk.uncompressedBytes;
    if (
      chunk.uncompressedBytes > INTEGRATED_ROW_CHUNK_MAX_RAW_BYTES ||
      loadedRawBytes > INSIGHT_MAX_RAW_BYTES
    ) {
      throw new Error(`Budget di decompressione superato per insight di ${dataset.id}.`);
    }
    const chunkFirstSourceRow = ordinal * INTEGRATED_ROW_CHUNK_ROWS + 1;
    const startIndex = nextSourceRow - chunkFirstSourceRow;
    for (let index = startIndex; index < chunk.rows.length; index += 1) {
      if (scannedRows >= maxRows) break scan;
      const row = chunk.rows[index];
      if (!row || row.sourceRow !== nextSourceRow) {
        throw new Error(`Ordine chunk divergente durante insight di ${dataset.id}.`);
      }
      collected.push(row);
      scannedRows += 1;
      nextSourceRow = row.sourceRow + 1;
    }
  }

  return aggregateRecipientInsights(datasetId, dataset.headers, collected, {
    publicRows: dataset.publicRows,
    scannedRows,
    exhausted: nextSourceRow > dataset.publicRows,
    topN: options.topN,
  });
}

/** One-line catalog teaser. */
export async function loadDatasetInsightTeaser(
  datasetId: string,
  options: { signal?: AbortSignal } = {},
): Promise<Readonly<{ line: string; complete: boolean }> | null> {
  const insights = await loadDatasetInsights(datasetId, {
    signal: options.signal,
    topN: 1,
    maxChunks: TEASER_MAX_CHUNKS,
    maxRows: TEASER_MAX_ROWS,
  });
  if (!insights) return null;
  const line = formatInsightTeaser(insights);
  if (!line) return null;
  const complete = insights.scannedRows >= insights.publicRows || insights.publicRows <= TEASER_MAX_ROWS;
  return { line, complete };
}

/** Bounded parallel teasers for catalog cards. */
export async function loadDatasetInsightTeasers(
  datasetIds: readonly string[],
  options: { signal?: AbortSignal; limit?: number } = {},
): Promise<ReadonlyMap<string, Readonly<{ line: string; complete: boolean }>>> {
  const ids = [...new Set(datasetIds)].slice(0, options.limit ?? 24);
  const out = new Map<string, Readonly<{ line: string; complete: boolean }>>();
  for (let index = 0; index < ids.length; index += TEASER_MAX_PARALLEL) {
    const batch = ids.slice(index, index + TEASER_MAX_PARALLEL);
    const results = await Promise.all(
      batch.map(async (id) => [id, await loadDatasetInsightTeaser(id, options)] as const),
    );
    for (const [id, teaser] of results) {
      if (teaser) out.set(id, teaser);
    }
  }
  return out;
}
