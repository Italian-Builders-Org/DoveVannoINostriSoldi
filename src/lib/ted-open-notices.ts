import "server-only";

import { z } from "zod";
import {
  FULL_DATASET_PAGE_SIZE,
  loadAllIntegratedDatasetRows,
  pageOffsetFromCursor,
  paginateFilteredRows,
} from "@/lib/integrated-full-dataset-page";
import type { IntegratedPublicRow } from "@/lib/integrated-source-contract";

export const TED_OPEN_DATASET = "ted-bandi-aperti-italia-2026-10";
export const TED_OPEN_ACQUISITION_DATE = "2026-10-23";
export const TED_OPEN_FORM_LABELS = {
  competition: "Gara",
  consultation: "Consultazione",
  "dir-awa-pre": "Aggiudicazione diretta prevista",
} as const;

export const TED_OPEN_NATURES = ["Lavori", "Servizi", "Forniture"] as const;
export type TedOpenNature = (typeof TED_OPEN_NATURES)[number];

const stringList = z.array(z.string().min(1)).min(1);
const noticeCells = z.object({
  "Numero pubblicazione": z.string().regex(/^[1-9][0-9]*-[0-9]{4}$/),
  "Data pubblicazione": z.iso.date(),
  "Tipo avviso": z.enum(Object.keys(TED_OPEN_FORM_LABELS) as [keyof typeof TED_OPEN_FORM_LABELS, ...Array<keyof typeof TED_OPEN_FORM_LABELS>]),
  "Natura contratto": z.enum(TED_OPEN_NATURES),
  Titolo: z.string().min(1),
  Committenti: z.string(),
  "Lingua committenti": z.enum(["ita", "eng"]),
  "Paesi committenti": z.string(),
  "Codici CPV": z.string(),
  "Scadenza offerte": z.iso.date(),
  "Importo stimato eurocent": z.string(),
  "Luoghi esecuzione": z.string(),
  "URL avviso": z.string().url(),
}).strict();

export function isTedOpenDeadlineStillValid(deadline: string, asOf = new Date()): boolean {
  const today = asOf.toISOString().slice(0, 10);
  return deadline >= today;
}

export function parseTedOpenNotice(row: IntegratedPublicRow) {
  const cells = noticeCells.parse(row.cells);
  const number = cells["Numero pubblicazione"];
  const url = `https://ted.europa.eu/it/notice/-/detail/${number}`;
  const countries = stringList.parse(JSON.parse(cells["Paesi committenti"]));
  const cpvs = stringList.parse(JSON.parse(cells["Codici CPV"]));
  const cities = cells["Luoghi esecuzione"] ? z.array(z.string()).parse(JSON.parse(cells["Luoghi esecuzione"])) : [];
  const amountCents = cells["Importo stimato eurocent"] === "" ? null : Number(cells["Importo stimato eurocent"]);
  if (
    cells["URL avviso"] !== url
    || !Array.isArray(row.sourceUrls)
    || !row.sourceUrls.some((sourceUrl) => sourceUrl === url)
    || !countries.includes("ITA") || countries.some((value) => !/^[A-Z]{3}$/.test(value))
    || cpvs.some((value) => !/^[0-9]{8}$/.test(value))
    || (amountCents !== null && (!Number.isSafeInteger(amountCents) || amountCents < 0))) {
    throw new Error("Avviso TED aperto fuori dal perimetro verificato.");
  }
  return {
    rowId: row.id,
    number,
    url,
    title: cells.Titolo,
    publicationDate: cells["Data pubblicazione"],
    deadline: cells["Scadenza offerte"],
    form: cells["Tipo avviso"],
    nature: cells["Natura contratto"],
    buyers: stringList.parse(JSON.parse(cells.Committenti)),
    buyerLanguage: cells["Lingua committenti"],
    countries: [...new Set(countries)],
    cpvs: [...new Set(cpvs)],
    cities: [...new Set(cities)],
    amountCents,
    stillOpen: isTedOpenDeadlineStillValid(cells["Scadenza offerte"]),
  };
}

function normalizeNature(value: unknown): TedOpenNature | undefined {
  if (value === undefined || value === null || value === "") return undefined;
  if (typeof value !== "string") return undefined;
  const normalized = value.toLowerCase();
  if (normalized === "lavori") return "Lavori";
  if (normalized === "servizi") return "Servizi";
  if (normalized === "forniture") return "Forniture";
  return undefined;
}

function compareTedOpenNotices(
  left: ReturnType<typeof parseTedOpenNotice>,
  right: ReturnType<typeof parseTedOpenNotice>,
): number {
  if (left.deadline !== right.deadline) return left.deadline.localeCompare(right.deadline);
  return left.number.localeCompare(right.number);
}

export async function getTedOpenNoticePage(input: {
  q?: unknown;
  cursor?: unknown;
  tipo?: unknown;
  includeExpired?: unknown;
} = {}) {
  const nature = normalizeNature(input.tipo);
  if (input.tipo !== undefined && input.tipo !== "" && nature === undefined) {
    throw new Error("Filtro tipo non valido: usare lavori, servizi o forniture.");
  }
  const includeExpired = input.includeExpired === "1" || input.includeExpired === "true";
  const offset = pageOffsetFromCursor(input.cursor);
  const loaded = await loadAllIntegratedDatasetRows(TED_OPEN_DATASET, input.q);
  if (loaded.dataset.publicRows !== 1707 || loaded.dataset.licenseStatus !== "verified-open-eu-reuse") {
    throw new Error("Dataset TED bandi aperti incompleto o condizioni di riuso divergenti.");
  }
  let notices = loaded.rows.map(parseTedOpenNotice);
  if (nature) notices = notices.filter((notice) => notice.nature === nature);
  if (!includeExpired) notices = notices.filter((notice) => notice.stillOpen);
  notices.sort(compareTedOpenNotices);
  const paged = paginateFilteredRows(notices, offset, FULL_DATASET_PAGE_SIZE);
  const rowById = new Map(loaded.rows.map((row) => [row.id, row]));
  const pageRows = paged.page.map((notice) => {
    const row = rowById.get(notice.rowId);
    if (!row) throw new Error("Riga TED bandi aperti mancante dopo il filtro.");
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
    notices: paged.page,
    nature,
    includeExpired,
  };
}

export async function getTedOpenNoticeByNumber(number: string) {
  const page = await getTedOpenNoticePage({ q: number, includeExpired: true });
  const notice = page.notices.find((row) => row.number === number);
  if (!notice) return null;
  return notice;
}
