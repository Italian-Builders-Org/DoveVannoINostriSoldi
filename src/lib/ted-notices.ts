import "server-only";

import { z } from "zod";
import { selectIntegratedDataset } from "@/lib/integrated-public-view";
import type { IntegratedPublicRow } from "@/lib/integrated-source-contract";

export const TED_DATASET = "ted-avvisi-italia-2026-08";
export const TED_FORM_LABELS = {
  competition: "Gara",
  result: "Risultato",
  planning: "Programmazione",
  "cont-modif": "Modifica del contratto",
  "dir-awa-pre": "Aggiudicazione diretta prevista",
  consultation: "Consultazione",
} as const;

const stringList = z.array(z.string().min(1)).min(1);
const noticeCells = z.object({
  "Numero pubblicazione": z.string().regex(/^[1-9][0-9]*-2026$/),
  "Data pubblicazione": z.iso.date().startsWith("2026-08-"),
  "Tipo avviso": z.enum(Object.keys(TED_FORM_LABELS) as [keyof typeof TED_FORM_LABELS, ...Array<keyof typeof TED_FORM_LABELS>]),
  Titolo: z.string().min(1),
  Committenti: z.string(),
  "Lingua committenti": z.enum(["ita", "eng"]),
  "Paesi committenti": z.string(),
  "Codici CPV": z.string(),
  "URL avviso": z.string().url(),
}).strict();

export function parseTedNotice(row: IntegratedPublicRow) {
  const cells = noticeCells.parse(row.cells);
  const number = cells["Numero pubblicazione"];
  const url = `https://ted.europa.eu/it/notice/-/detail/${number}`;
  const countries = stringList.parse(JSON.parse(cells["Paesi committenti"]));
  const cpvs = stringList.parse(JSON.parse(cells["Codici CPV"]));
  if (cells["URL avviso"] !== url || !row.sourceUrls.includes(url)
    || !countries.includes("ITA") || countries.some((value) => !/^[A-Z]{3}$/.test(value))
    || cpvs.some((value) => !/^[0-9]{8}$/.test(value))) {
    throw new Error("Avviso TED fuori dal perimetro verificato.");
  }
  return {
    rowId: row.id, number, url, title: cells.Titolo, date: cells["Data pubblicazione"],
    form: cells["Tipo avviso"], buyers: stringList.parse(JSON.parse(cells.Committenti)),
    buyerLanguage: cells["Lingua committenti"], countries: [...new Set(countries)], cpvs: [...new Set(cpvs)],
  };
}

export async function getTedNoticePage(input: { q?: unknown; cursor?: unknown } = {}) {
  const result = await selectIntegratedDataset({ datasetId: TED_DATASET, ...input, limit: 25 });
  if (result.dataset.publicRows !== 2825 || result.dataset.licenseStatus !== "verified-open-eu-reuse") {
    throw new Error("Dataset TED incompleto o condizioni di riuso divergenti.");
  }
  return { ...result, notices: result.rows.map(parseTedNotice) };
}
