import "server-only";

import { INTEGRATED_ROW_CHUNK_ROWS, integratedRowChunkCount, type IntegratedPublicRow } from "@/lib/integrated-source-contract";
import { loadIntegratedDatasetChunk, loadIntegratedSourceBundle } from "@/lib/integrated-sources";

export type SortedLookup = Readonly<{ rows: readonly IntegratedPublicRow[]; headers: readonly string[]; chunksRead: number }>;

/**
 * Rows whose `column` equals `key` in a dataset the ETL publishes sorted by that column:
 * a binary search on the chunks instead of a full scan. Every chunk read is checked for order;
 * the whole-dataset order is covered by tests/integrated-sorted-lookup.test.mjs.
 */
export async function selectSortedRows(datasetId: string, column: string, key: string): Promise<SortedLookup> {
  const bundle = await loadIntegratedSourceBundle();
  const dataset = bundle.datasetsById.get(datasetId);
  if (!dataset) throw new Error(`Dataset ${datasetId} assente dal corpus.`);
  if (!dataset.headers.includes(column)) throw new Error(`Il dataset ${datasetId} non ha la colonna ${column}.`);

  const value = (row: IntegratedPublicRow) => {
    const cell = row.cells[column];
    if (typeof cell !== "string") throw new Error(`Chiave assente in ${datasetId}, riga ${row.sourceRow}.`);
    return cell;
  };
  const chunks = new Map<number, readonly IntegratedPublicRow[]>();
  const read = async (ordinal: number) => {
    const cached = chunks.get(ordinal);
    if (cached) return cached;
    const { rows } = await loadIntegratedDatasetChunk(bundle, dataset, ordinal);
    rows.forEach((row, index) => {
      if (row.sourceRow !== ordinal * INTEGRATED_ROW_CHUNK_ROWS + index + 1) throw new Error(`Ordine dei chunk divergente in ${datasetId}.`);
      if (index > 0 && value(rows[index - 1]) > value(row)) throw new Error(`Dataset ${datasetId} non ordinato per ${column}.`);
    });
    chunks.set(ordinal, rows);
    return rows;
  };

  const count = integratedRowChunkCount(dataset.publicRows);
  // First chunk whose last row is not below the key.
  let low = 0, high = count;
  while (low < high) {
    const middle = (low + high) >> 1;
    const rows = await read(middle);
    if (value(rows[rows.length - 1]) < key) low = middle + 1;
    else high = middle;
  }
  const found: IntegratedPublicRow[] = [];
  let previous: string | null = null;
  for (let ordinal = low; ordinal < count; ordinal += 1) {
    for (const row of await read(ordinal)) {
      const current = value(row);
      if (previous !== null && previous > current) throw new Error(`Dataset ${datasetId} non ordinato per ${column}.`);
      previous = current;
      if (current > key) return { rows: found, headers: dataset.headers, chunksRead: chunks.size };
      if (current === key) found.push(row);
    }
  }
  return { rows: found, headers: dataset.headers, chunksRead: chunks.size };
}
