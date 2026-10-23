import "server-only";

import { z } from "zod";
import { selectIntegratedDataset } from "@/lib/integrated-public-view";
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
  if (!row.sourceUrls.includes(DATASET_URL) || cells["URL dataset"] !== DATASET_URL) {
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
  const result = await selectIntegratedDataset({ datasetId: CONSIP_BANDI_DATASET, q: input.q, cursor: input.cursor, limit: 25 });
  if (result.dataset.publicRows !== 1839 || result.dataset.licenseStatus !== "verified-open-cc-by-4.0") {
    throw new Error("Dataset Consip bandi incompleto o licenza divergente.");
  }
  let rows = result.rows.map(parseConsipBandiRow);
  if (instrument) rows = rows.filter((row) => row.instrument === instrument);
  if (openOnly) rows = rows.filter((row) => row.openStatus === "aperto");
  return { ...result, bandi: rows, instrument, openOnly };
}
