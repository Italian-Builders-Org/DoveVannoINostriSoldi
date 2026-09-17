import "server-only";

import { selectIntegratedDataset, type IntegratedDatasetResult } from "@/lib/integrated-public-view";

export type IncomePoint = {
  surveyYear: number;
  incomeYear: number;
  value: number | null;
  status: string | null;
  note: string | null;
};

export type IncomeIndicatorView = {
  key: string;
  title: string;
  definition: string;
  scaleLabel: string;
  valueSuffix: string;
  points: readonly IncomePoint[];
  sourceUrl: string;
  checkedAt: string;
};

export const INEQUALITY_DATASET_ID = "eurostat-disuguaglianza-redditi";
const HEADERS = ["Indicatore", "Anno rilevazione", "Anno redditi", "Valore", "Unità", "Stato", "URL fonte"];
const definitions = [
  { key: "gini", title: "Coefficiente di Gini", definition: "Quanto sono disuguali i redditi: zero indica una distribuzione uguale per tutti; 100 la massima disuguaglianza.", scaleLabel: "Scala da 0 a 100", unit: "scala da 0 a 100", valueSuffix: "", code: "ilc_di12" },
  { key: "s80s20", title: "Rapporto S80/S20", definition: "Il reddito complessivo del 20% più ricco rispetto a quello del 20% più povero.", scaleLabel: "Rapporto tra i due quintili", unit: "rapporto", valueSuffix: " volte", code: "ilc_di11" },
] as const;

export function incomeIndicatorsFromDataset(result: IntegratedDatasetResult): IncomeIndicatorView[] {
  if (result.dataset.id !== INEQUALITY_DATASET_ID ||
      JSON.stringify(result.dataset.headers) !== JSON.stringify(HEADERS) ||
      result.pagination.nextCursor !== null || !result.pagination.exhausted) {
    throw new Error("Disuguaglianza: corpus incompleto o schema inatteso");
  }
  const groups = new Map<string, IncomePoint[]>();
  const urls = new Map<string, string>();
  for (const row of result.rows) {
    const [key, survey, income, sourceValue, unit, sourceStatus, sourceUrl] = HEADERS.map((header) => row.cells[header]);
    const raw = sourceValue === "" ? null : sourceValue;
    const status = sourceStatus === "" ? null : sourceStatus;
    const definition = definitions.find((item) => item.key === key);
    if (!definition || unit !== definition.unit || !survey || !/^20[0-9]{2}$/.test(survey) ||
        income !== String(Number(survey) - 1) ||
        (status !== null && status !== "b") ||
        !sourceUrl?.startsWith(`https://ec.europa.eu/eurostat/api/dissemination/statistics/1.0/data/${definition.code}?`)) {
      throw new Error("Disuguaglianza: indicatore, periodo, unità o fonte incoerenti");
    }
    const value = raw === null ? null : Number(raw);
    if (raw !== null && (!/^(?:0|[1-9][0-9]*)(?:\.[0-9]+)?$/.test(raw) ||
        !Number.isFinite(value) || value! < 0 || (key === "gini" && value! > 100))) {
      throw new Error("Disuguaglianza: valore non valido");
    }
    const points = groups.get(key!) ?? [];
    if (points.some((point) => point.surveyYear === Number(survey)) ||
        (urls.has(key!) && urls.get(key!) !== sourceUrl)) {
      throw new Error("Disuguaglianza: cella duplicata o fonte divergente");
    }
    points.push({ surveyYear: Number(survey), incomeYear: Number(income), value, status,
      note: status === "b" ? "Interruzione della serie" : value === null ? "Dato non disponibile" : null });
    groups.set(key!, points);
    urls.set(key!, sourceUrl);
  }
  return definitions.map((definition) => {
    const points = (groups.get(definition.key) ?? []).sort((a, b) => a.surveyYear - b.surveyYear);
    if (points.length !== 12 || points.some((point, index) => point.surveyYear !== 2014 + index)) {
      throw new Error("Disuguaglianza: copertura temporale incompleta");
    }
    return { key: definition.key, title: definition.title, definition: definition.definition, scaleLabel: definition.scaleLabel, valueSuffix: definition.valueSuffix, points, sourceUrl: urls.get(definition.key)!, checkedAt: result.dataset.sourceMetadata.checkedAt };
  });
}

export async function buildInequalityPageView(): Promise<IncomeIndicatorView[]> {
  return incomeIndicatorsFromDataset(await selectIntegratedDataset({ datasetId: INEQUALITY_DATASET_ID, limit: 100 }));
}
