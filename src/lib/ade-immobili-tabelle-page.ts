import "server-only";

import { z } from "zod";
import {
  FULL_DATASET_PAGE_SIZE,
  loadAllIntegratedDatasetRows,
  pageOffsetFromCursor,
  paginateFilteredRows,
} from "@/lib/integrated-full-dataset-page";
import type { IntegratedPublicRow } from "@/lib/integrated-source-contract";
import {
  ADE_IMMOBILI_TABLE_API_PREFIX,
  ADE_IMMOBILI_TABELLE_DATASET,
} from "@/lib/ade-immobili-italia-2026";

const tabelleCells = z.object({
  "Tabella id": z.string().regex(/^2026_\d{2}_\d{2}_\d{2}$/),
  "Titolo tabella": z.string().min(1),
  Riga: z.string().regex(/^[1-9][0-9]*$/),
  Colonna: z.string().min(1),
  Valore: z.string(),
  "URL fonte": z.string().url(),
}).strict();

function parseTabelleRow(row: IntegratedPublicRow) {
  const cells = tabelleCells.parse(row.cells);
  const expectedUrl = `${ADE_IMMOBILI_TABLE_API_PREFIX}${cells["Tabella id"]}&cq=1`;
  if (cells["URL fonte"] !== expectedUrl || !row.sourceUrls.includes(expectedUrl)) {
    throw new Error("Riga tabella fuori dal perimetro verificato.");
  }
  return {
    rowId: row.id,
    tableId: cells["Tabella id"],
    title: cells["Titolo tabella"],
    row: cells.Riga,
    column: cells.Colonna,
    value: cells.Valore,
    sourceUrl: cells["URL fonte"],
  };
}

function compareTabelle(
  left: ReturnType<typeof parseTabelleRow>,
  right: ReturnType<typeof parseTabelleRow>,
): number {
  return left.tableId.localeCompare(right.tableId)
    || Number(left.row) - Number(right.row)
    || left.column.localeCompare(right.column);
}

function normalizeTableId(value: unknown): string | undefined {
  if (value === undefined || value === null || value === "") return undefined;
  if (typeof value !== "string" || !/^2026_\d{2}_\d{2}_\d{2}$/.test(value)) return undefined;
  return value;
}

export async function getAdeImmobiliTabellePage(input: {
  q?: unknown;
  cursor?: unknown;
  tabella?: unknown;
} = {}) {
  const tabella = normalizeTableId(input.tabella);
  if (input.tabella !== undefined && input.tabella !== "" && tabella === undefined) {
    throw new Error("Identificativo tabella non valido.");
  }
  const offset = pageOffsetFromCursor(input.cursor);
  const loaded = await loadAllIntegratedDatasetRows(ADE_IMMOBILI_TABELLE_DATASET, input.q);
  if (loaded.dataset.publicRows !== 3_033 || loaded.dataset.licenseStatus !== "verified-open-cc-by-3.0-it") {
    throw new Error("Dataset tabelle AdE incompleto o licenza divergente.");
  }
  let rows = loaded.rows.map(parseTabelleRow);
  if (tabella) rows = rows.filter((row) => row.tableId === tabella);
  rows.sort(compareTabelle);
  const paged = paginateFilteredRows(rows, offset, FULL_DATASET_PAGE_SIZE);
  return {
    dataset: loaded.dataset,
    query: loaded.query,
    tabella: tabella ?? null,
    matchedRows: paged.matchedRows,
    rows: paged.page,
    pagination: paged.pagination,
    limit: paged.limit,
    offset: paged.offset,
  };
}
