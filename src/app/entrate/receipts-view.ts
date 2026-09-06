export const RECEIPTS_PAGE_SIZE = 25;

type SearchParams = Record<string, string | string[] | undefined>;

function scalar(params: SearchParams, key: string): string | undefined {
  const value = params[key];
  if (Array.isArray(value)) throw new Error(`Il filtro ${key} deve avere un solo valore.`);
  return value?.trim() || undefined;
}

export function receiptsPageFilters(params: SearchParams) {
  const year = scalar(params, "anno");
  const page = scalar(params, "pagina");
  if (year !== undefined && !/^\d{4}$/.test(year)) {
    throw new Error("Scegli un anno valido: 2024, 2025 o 2026.");
  }
  if (page !== undefined && (!/^[1-9]\d*$/.test(page) || Number(page) > 4001)) {
    throw new Error("Il numero di pagina deve essere un intero tra 1 e 4001.");
  }
  return {
    year: year === undefined ? undefined : Number(year),
    region: scalar(params, "regione"),
    query: scalar(params, "q"),
    code: scalar(params, "codice"),
    limit: RECEIPTS_PAGE_SIZE,
    offset: ((page === undefined ? 1 : Number(page)) - 1) * RECEIPTS_PAGE_SIZE,
  };
}

export function receiptsPageHref({
  year, region, query, code, page = 1,
}: {
  year: number;
  region?: string | null;
  query?: string | null;
  code?: string | null;
  page?: number;
}): string {
  const params = new URLSearchParams({ anno: String(year) });
  if (region) params.set("regione", region);
  if (query) params.set("q", query);
  if (code) params.set("codice", code);
  if (page > 1) params.set("pagina", String(page));
  return `/entrate?${params}`;
}

export function receiptsPeriodLabel(period: {
  year: number;
  endMonth: number;
  completeness: "complete" | "partial";
}): string {
  const month = new Intl.DateTimeFormat("it-IT", { month: "long", timeZone: "UTC" })
    .format(new Date(Date.UTC(period.year, period.endMonth - 1, 1)));
  return period.completeness === "partial"
    ? `Gennaio-${month} ${period.year} · dati parziali`
    : `Anno ${period.year} · completo`;
}
