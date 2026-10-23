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
  ADE_IMMOBILI_OPEN_DATA_ZIP,
  ADE_IMMOBILI_UTILIZZO_DATASET,
  UTILIZZO_CATEGORIES,
} from "@/lib/ade-immobili-italia-2026";

const utilizzoCells = z.object({
  "Anno imposta": z.literal("2023"),
  "Provincia (sigla)": z.union([z.literal("Totale"), z.string().regex(/^[A-Z]{2}$/)]),
  "Categoria utilizzo": z.enum(UTILIZZO_CATEGORIES),
  Indicatore: z.string().min(1),
  Valore: z.string(),
  "URL fonte": z.literal(ADE_IMMOBILI_OPEN_DATA_ZIP),
}).strict();

function parseUtilizzoRow(row: IntegratedPublicRow) {
  const cells = utilizzoCells.parse(row.cells);
  if (!row.sourceUrls.includes(ADE_IMMOBILI_OPEN_DATA_ZIP) || cells["URL fonte"] !== ADE_IMMOBILI_OPEN_DATA_ZIP) {
    throw new Error("Riga utilizzo fuori dal perimetro verificato.");
  }
  return {
    rowId: row.id,
    provincia: cells["Provincia (sigla)"],
    categoria: cells["Categoria utilizzo"],
    indicatore: cells.Indicatore,
    valore: cells.Valore,
    sourceUrl: cells["URL fonte"],
  };
}

function compareUtilizzo(
  left: ReturnType<typeof parseUtilizzoRow>,
  right: ReturnType<typeof parseUtilizzoRow>,
): number {
  return left.provincia.localeCompare(right.provincia)
    || left.categoria.localeCompare(right.categoria)
    || left.indicatore.localeCompare(right.indicatore);
}

function normalizeProvincia(value: unknown): string | undefined {
  if (value === undefined || value === null || value === "") return undefined;
  if (typeof value !== "string") return undefined;
  const upper = value.trim().toUpperCase();
  if (!/^[A-Z]{2}$/.test(upper)) return undefined;
  return upper;
}

function normalizeCategoria(value: unknown): (typeof UTILIZZO_CATEGORIES)[number] | undefined {
  if (value === undefined || value === null || value === "") return undefined;
  if (typeof value !== "string") return undefined;
  const normalized = value.toLowerCase();
  return UTILIZZO_CATEGORIES.find((category) => category === normalized);
}

type ParsedUtilizzoRow = ReturnType<typeof parseUtilizzoRow>;

let utilizzoRowsCache: {
  qKey: string;
  dataset: Awaited<ReturnType<typeof loadAllIntegratedDatasetRows>>["dataset"];
  query: string | null;
  rows: ParsedUtilizzoRow[];
} | null = null;

function utilizzoQueryKey(q: unknown): string {
  if (q === undefined || q === null || q === "") return "";
  return String(q);
}

async function loadParsedUtilizzoRows(q: unknown) {
  const qKey = utilizzoQueryKey(q);
  if (utilizzoRowsCache?.qKey === qKey) {
    return utilizzoRowsCache;
  }
  const loaded = await loadAllIntegratedDatasetRows(ADE_IMMOBILI_UTILIZZO_DATASET, q);
  if (loaded.dataset.publicRows !== 16_632 || loaded.dataset.licenseStatus !== "verified-open-cc-by-3.0-it") {
    throw new Error("Dataset utilizzo AdE incompleto o licenza divergente.");
  }
  utilizzoRowsCache = {
    qKey,
    dataset: loaded.dataset,
    query: loaded.query,
    rows: loaded.rows.map(parseUtilizzoRow),
  };
  return utilizzoRowsCache;
}

export async function getAdeImmobiliUtilizzoPage(input: {
  q?: unknown;
  cursor?: unknown;
  provincia?: unknown;
  categoria?: unknown;
} = {}) {
  const provincia = normalizeProvincia(input.provincia);
  if (input.provincia !== undefined && input.provincia !== "" && provincia === undefined) {
    throw new Error("Sigla provincia non valida.");
  }
  const categoria = normalizeCategoria(input.categoria);
  if (input.categoria !== undefined && input.categoria !== "" && categoria === undefined) {
    throw new Error("Categoria utilizzo non valida.");
  }
  const offset = pageOffsetFromCursor(input.cursor);
  const loaded = await loadParsedUtilizzoRows(input.q);
  let rows = loaded.rows;
  if (provincia) rows = rows.filter((row) => row.provincia === provincia);
  if (categoria) rows = rows.filter((row) => row.categoria === categoria);
  rows = [...rows].sort(compareUtilizzo);
  const paged = paginateFilteredRows(rows, offset, FULL_DATASET_PAGE_SIZE);
  return {
    dataset: loaded.dataset,
    query: loaded.query,
    provincia: provincia ?? null,
    categoria: categoria ?? null,
    matchedRows: paged.matchedRows,
    rows: paged.page,
    pagination: paged.pagination,
    limit: paged.limit,
    offset: paged.offset,
  };
}
