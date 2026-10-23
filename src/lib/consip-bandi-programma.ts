import "server-only";

import { z } from "zod";
import {
  FULL_DATASET_PAGE_SIZE,
  loadAllIntegratedDatasetRows,
  pageOffsetFromCursor,
  paginateFilteredRows,
} from "@/lib/integrated-full-dataset-page";
import type { IntegratedPublicRow } from "@/lib/integrated-source-contract";

export const CONSIP_BANDI_DATASET = "consip-bandi-gare-programma-2026";
export const CONSIP_BANDI_ACQUISITION_DATE = "2026-10-23";
export const CONSIP_INSTRUMENTS = ["MePA", "SDA", "Convenzione", "Accordo Quadro"] as const;
export type ConsipInstrument = (typeof CONSIP_INSTRUMENTS)[number];

const rowCells = z.object({
  "Identificativo lotto": z.string().min(1),
  "Denominazione bando": z.string().min(1),
  "Denominazione lotto": z.string().min(1),
  "Tipo strumento": z.enum(CONSIP_INSTRUMENTS),
  "Categoria merceologica": z.string().min(1),
  "Data pubblicazione": z.iso.date(),
  "Data termine": z.string(),
  "Base asta eurocent": z.string(),
  "Importo massimale eurocent": z.string(),
  "URL dataset": z.string().url(),
}).strict();

const DATASET_URL = "https://dati.consip.it/dataset/dataset-bandi-e-gare";

export function consipBandiOpenStatus(deadline: string, asOf = new Date()): "aperto" | "scaduto" | "senza-scadenza" {
  if (!deadline) return "senza-scadenza";
  const today = asOf.toISOString().slice(0, 10);
  return deadline >= today ? "aperto" : "scaduto";
}

export function parseConsipBandiRow(row: IntegratedPublicRow) {
  const cells = rowCells.parse(row.cells);
  if (
    !Array.isArray(row.sourceUrls)
    || !row.sourceUrls.some((sourceUrl) => sourceUrl === DATASET_URL)
    || cells["URL dataset"] !== DATASET_URL
  ) {
    throw new Error("Riga Consip bandi fuori dal perimetro verificato.");
  }
  const deadline = cells["Data termine"] === "" ? "" : z.iso.date().parse(cells["Data termine"]);
  const base = cells["Base asta eurocent"] === "" ? null : Number(cells["Base asta eurocent"]);
  const cap = cells["Importo massimale eurocent"] === "" ? null : Number(cells["Importo massimale eurocent"]);
  if ((base !== null && (!Number.isSafeInteger(base) || base < 0))
    || (cap !== null && (!Number.isSafeInteger(cap) || cap < 0))) {
    throw new Error("Importo Consip non valido.");
  }
  return {
    rowId: row.id,
    lotId: cells["Identificativo lotto"],
    bandTitle: cells["Denominazione bando"],
    lotTitle: cells["Denominazione lotto"],
    instrument: cells["Tipo strumento"],
    category: cells["Categoria merceologica"],
    publicationDate: cells["Data pubblicazione"],
    deadline,
    baseCents: base,
    capCents: cap,
    datasetUrl: cells["URL dataset"],
    openStatus: consipBandiOpenStatus(deadline),
    syntheticId: cells["Identificativo lotto"].startsWith("senza-id-"),
  };
}

function normalizeInstrument(value: unknown): ConsipInstrument | undefined {
  if (value === undefined || value === null || value === "") return undefined;
  if (typeof value !== "string") return undefined;
  const normalized = value.toLowerCase();
  if (normalized === "mepa") return "MePA";
  if (normalized === "sda") return "SDA";
  if (normalized === "convenzione") return "Convenzione";
  if (normalized === "accordo-quadro" || normalized === "accordo quadro") return "Accordo Quadro";
  return undefined;
}

function consipDeadlineSortKey(deadline: string): string {
  return deadline === "" ? "9999-12-31" : deadline;
}

function compareConsipBandiRows(
  left: ReturnType<typeof parseConsipBandiRow>,
  right: ReturnType<typeof parseConsipBandiRow>,
): number {
  const leftKey = consipDeadlineSortKey(left.deadline);
  const rightKey = consipDeadlineSortKey(right.deadline);
  if (leftKey !== rightKey) return leftKey.localeCompare(rightKey);
  return left.lotId.localeCompare(right.lotId);
}

export async function getConsipBandiPage(input: {
  q?: unknown;
  cursor?: unknown;
  strumento?: unknown;
  soloAperti?: unknown;
} = {}) {
  const instrument = normalizeInstrument(input.strumento);
  if (input.strumento !== undefined && input.strumento !== "" && instrument === undefined) {
    throw new Error("Filtro strumento non valido.");
  }
  const openOnly = input.soloAperti === "1" || input.soloAperti === "true";
  const offset = pageOffsetFromCursor(input.cursor);
  const loaded = await loadAllIntegratedDatasetRows(CONSIP_BANDI_DATASET, input.q);
  if (loaded.dataset.publicRows !== 1839 || loaded.dataset.licenseStatus !== "verified-open-cc-by-4.0") {
    throw new Error("Dataset Consip bandi incompleto o licenza divergente.");
  }
  let bandi = loaded.rows.map(parseConsipBandiRow);
  if (instrument) bandi = bandi.filter((row) => row.instrument === instrument);
  if (openOnly) bandi = bandi.filter((row) => row.openStatus === "aperto");
  bandi.sort(compareConsipBandiRows);
  const paged = paginateFilteredRows(bandi, offset, FULL_DATASET_PAGE_SIZE);
  const rowById = new Map(loaded.rows.map((row) => [row.id, row]));
  const pageRows = paged.page.map((bandiRow) => {
    const row = rowById.get(bandiRow.rowId);
    if (!row) throw new Error("Riga Consip bandi mancante dopo il filtro.");
    return row;
  });
  return {
    dataset: loaded.dataset,
    query: loaded.query,
    limit: paged.limit,
    offset: paged.offset,
    matchedRows: paged.matchedRows,
    rows: pageRows,
    pagination: paged.pagination,
    bandi: paged.page,
    instrument,
    openOnly,
  };
}
