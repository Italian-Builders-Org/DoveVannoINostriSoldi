import "server-only";

import { z } from "zod";
import analysisData from "@/data/generated/ade-immobili-italia-2026.data.json";
import analysisMeta from "@/data/generated/ade-immobili-italia-2026.meta.json";
import {
  FULL_DATASET_PAGE_SIZE,
  loadAllIntegratedDatasetRows,
  pageOffsetFromCursor,
  paginateFilteredRows,
} from "@/lib/integrated-full-dataset-page";
import type { IntegratedPublicRow } from "@/lib/integrated-source-contract";

export const ADE_IMMOBILI_ANALYSIS_ID = "ade-immobili-italia-2026";
export const ADE_IMMOBILI_PRELIEVO_DATASET = "ade-immobili-prelievo-2015-2024";
export const ADE_IMMOBILI_UTILIZZO_DATASET = "ade-immobili-utilizzo-provincia-2023";
export const ADE_IMMOBILI_TABELLE_DATASET = "ade-immobili-tabelle-2026";
export const ADE_IMMOBILI_ACQUISITION_DATE = "2026-10-23";
export const ADE_IMMOBILI_OPEN_DATA_ZIP =
  "https://www1.finanze.gov.it/finanze/immobili/public/contenuti/opendata.zip";
export const ADE_IMMOBILI_LANDING =
  "https://www.agenziaentrate.gov.it/portale/gli-immobili-in-italia-2026";
export const ADE_IMMOBILI_TABLE_API_PREFIX =
  "https://www1.finanze.gov.it/finanze/immobili/public/api/api.php/get_table?id=";

const prelievoPoint = z.object({
  voce: z.string().min(1),
  anno: z.number().int(),
  mldEuro: z.string().min(1),
  sourceUrl: z.string().url(),
}).strict();

const analysisSchema = z.object({
  caveats: z.array(z.string().min(1)),
  coverage: z.object({
    taxYear: z.number().int(),
    edition: z.number().int(),
    openDataZipBytes: z.number().int().positive(),
    tableCount: z.number().int().positive(),
    tablesAvailableViaApi: z.number().int().nonnegative(),
    tablesMissingViaApi: z.array(z.string().min(1)),
    utilizzoProvinciaRows: z.number().int().positive(),
  }).strict(),
  hero: z.object({
    imuGettito2024Mld: z.string().min(1),
    prelievoPatrimoniale2024Mld: z.string().min(1),
  }).strict(),
  chapters: z.array(z.object({
    id: z.string().min(1),
    title: z.string().min(1),
    tables: z.number().int().nonnegative(),
  }).strict()),
  prelievoSeries: z.array(prelievoPoint),
  sources: z.object({
    landingUrl: z.string().url(),
    openDataPortalUrl: z.string().url(),
    openDataZipUrl: z.string().url(),
    volumePdfUrl: z.string().url(),
    licenseUrl: z.string().url(),
  }).strict(),
}).strict();

const metaSchema = z.object({
  datasetId: z.literal(ADE_IMMOBILI_ANALYSIS_ID),
  schemaVersion: z.literal(1),
  semantics: z.object({
    periodo: z.object({
      referencePeriod: z.string().min(1),
      note: z.string().min(1),
    }).strict(),
    provenance: z.object({
      canonicalUrls: z.array(z.string().url()).min(1),
      acquisitionDate: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
      checkedAt: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
      publicationDate: z.null(),
    }).strict(),
  }).strict(),
}).strict();

export type AdeImmobiliAnalysis = z.infer<typeof analysisSchema>;

export const UTILIZZO_CATEGORIES = [
  "abitazioni",
  "pertinenze",
  "negozi",
  "uffici",
  "produttivo",
  "altro",
] as const;

const utilizzoCells = z.object({
  "Anno imposta": z.literal("2023"),
  "Provincia (sigla)": z.union([z.literal("Totale"), z.string().regex(/^[A-Z]{2}$/)]),
  "Categoria utilizzo": z.enum(UTILIZZO_CATEGORIES),
  Indicatore: z.string().min(1),
  Valore: z.string(),
  "URL fonte": z.literal(ADE_IMMOBILI_OPEN_DATA_ZIP),
}).strict();

const tabelleCells = z.object({
  "Tabella id": z.string().regex(/^2026_\d{2}_\d{2}_\d{2}$/),
  "Titolo tabella": z.string().min(1),
  Riga: z.string().regex(/^[1-9][0-9]*$/),
  Colonna: z.string().min(1),
  Valore: z.string(),
  "URL fonte": z.string().url(),
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

function compareUtilizzo(
  left: ReturnType<typeof parseUtilizzoRow>,
  right: ReturnType<typeof parseUtilizzoRow>,
): number {
  return left.provincia.localeCompare(right.provincia)
    || left.categoria.localeCompare(right.categoria)
    || left.indicatore.localeCompare(right.indicatore);
}

function compareTabelle(
  left: ReturnType<typeof parseTabelleRow>,
  right: ReturnType<typeof parseTabelleRow>,
): number {
  return left.tableId.localeCompare(right.tableId)
    || Number(left.row) - Number(right.row)
    || left.column.localeCompare(right.column);
}

export function getAdeImmobiliAnalysis(): AdeImmobiliAnalysis {
  const data = analysisSchema.parse(analysisData);
  metaSchema.parse(analysisMeta);
  if (data.hero.imuGettito2024Mld !== "20.98" || data.coverage.utilizzoProvinciaRows !== 16_632) {
    throw new Error("Snapshot analisi AdE immobili 2026 fuori dal contratto atteso.");
  }
  if (data.sources.landingUrl !== ADE_IMMOBILI_LANDING || data.sources.openDataZipUrl !== ADE_IMMOBILI_OPEN_DATA_ZIP) {
    throw new Error("URL fonte analisi AdE immobili 2026 divergenti.");
  }
  return data;
}

export function buildPrelievoChartSeries(analysis: AdeImmobiliAnalysis) {
  const voices = ["IMU di cui", "Cedolare secca", "TASI di cui"] as const;
  return voices.map((voice) => ({
    voice,
    points: analysis.prelievoSeries
      .filter((point) => point.voce.startsWith(voice))
      .sort((left, right) => left.anno - right.anno)
      .map((point) => ({
        year: point.anno,
        mld: Number.parseFloat(point.mldEuro.replace(",", ".")),
        sourceUrl: point.sourceUrl,
      })),
  }));
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

function normalizeTableId(value: unknown): string | undefined {
  if (value === undefined || value === null || value === "") return undefined;
  if (typeof value !== "string" || !/^2026_\d{2}_\d{2}_\d{2}$/.test(value)) return undefined;
  return value;
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
  const loaded = await loadAllIntegratedDatasetRows(ADE_IMMOBILI_UTILIZZO_DATASET, input.q);
  if (loaded.dataset.publicRows !== 16_632 || loaded.dataset.licenseStatus !== "verified-open-cc-by-3.0-it") {
    throw new Error("Dataset utilizzo AdE incompleto o licenza divergente.");
  }
  let rows = loaded.rows.map(parseUtilizzoRow);
  if (provincia) rows = rows.filter((row) => row.provincia === provincia);
  if (categoria) rows = rows.filter((row) => row.categoria === categoria);
  rows.sort(compareUtilizzo);
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
