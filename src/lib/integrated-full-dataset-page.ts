import "server-only";

import { IntegratedQueryError, selectIntegratedDataset } from "@/lib/integrated-public-view";
import type { IntegratedPublicRow } from "@/lib/integrated-source-contract";

export const FULL_DATASET_PAGE_SIZE = 25;

export async function loadAllIntegratedDatasetRows(datasetId: string, q: unknown) {
  const rows: IntegratedPublicRow[] = [];
  let cursor: string | null | undefined;
  let dataset;
  let query: string | null = null;
  for (;;) {
    const batch = await selectIntegratedDataset({ datasetId, q, cursor, limit: 100 });
    dataset = batch.dataset;
    query = batch.query;
    rows.push(...batch.rows);
    cursor = batch.pagination.nextCursor;
    if (!cursor) break;
  }
  if (!dataset) {
    throw new Error(`Dataset ${datasetId} non caricato.`);
  }
  return { dataset, query, rows };
}

export function pageOffsetFromCursor(cursor: unknown): number {
  if (cursor === undefined || cursor === null || cursor === "") return 0;
  if (typeof cursor !== "string" || !/^\d+$/.test(cursor)) {
    throw new IntegratedQueryError("Cursor di paginazione non valido.");
  }
  const offset = Number.parseInt(cursor, 10);
  if (offset < 0) throw new IntegratedQueryError("Cursor di paginazione non valido.");
  return offset;
}

export function paginateFilteredRows<T>(
  items: readonly T[],
  offset: number,
  pageSize = FULL_DATASET_PAGE_SIZE,
) {
  const page = items.slice(offset, offset + pageSize);
  const nextOffset = offset + page.length;
  const exhausted = nextOffset >= items.length;
  return {
    page,
    matchedRows: items.length,
    limit: pageSize,
    offset,
    pagination: {
      returned: page.length,
      scannedRows: items.length,
      scanStartSourceRow: null,
      scanEndSourceRow: null,
      nextCursor: exhausted ? null : String(nextOffset),
      exhausted,
    },
  };
}
