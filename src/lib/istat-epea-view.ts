import type { IstatEpeaData } from "./data/istat-epea-contracts.ts";

export const EPEA_SECTORS = [
  { code: "S13_15", label: "Amministrazioni pubbliche e istituzioni sociali private" },
  { code: "S1", label: "Totale economia" },
  { code: "S14", label: "Famiglie" },
  { code: "S1K", label: "Società" },
] as const;
export type EpeaSector = (typeof EPEA_SECTORS)[number]["code"];
export const EPEA_YEARS = [2016, 2017, 2018, 2019, 2020, 2021, 2022] as const;
export const EPEA_CLASSES = [
  { code: "CEPA1", label: "Aria e clima" },
  { code: "CEPA2", label: "Acque reflue" },
  { code: "CEPA3", label: "Rifiuti" },
  { code: "CEPA4", label: "Suolo, acque sotterranee e superficiali" },
  { code: "CEPA5", label: "Rumore e vibrazioni" },
  { code: "CEPA6", label: "Biodiversità e paesaggio" },
  { code: "CEPA7_9", label: "Radiazioni, ricerca e sviluppo e altre attività" },
] as const;

export function parseEpeaSelection(params: Record<string, string | string[] | undefined>) {
  const year = params.anno ?? "2022";
  const sector = params.settore ?? "S13_15";
  if (typeof year !== "string" || !/^20(1[6-9]|2[0-2])$/.test(year)
    || typeof sector !== "string" || !EPEA_SECTORS.some((item) => item.code === sector)) {
    return null;
  }
  return { year: Number(year), sector: sector as EpeaSector };
}

/** One national expenditure observation per cell; never sum accounting aggregates. */
export function buildEpeaView(rows: IstatEpeaData["rows"], year: number, sector: EpeaSector) {
  if (!EPEA_YEARS.some((value) => value === year) || !EPEA_SECTORS.some((item) => item.code === sector)) {
    throw new Error("Selezione EPEA fuori perimetro.");
  }
  const cells = new Map<string, number | null>();
  for (const row of rows) {
    if (row.dataTypeAggr !== "EPS_NEXP" || row.institutionalSector !== sector) continue;
    if (row.refArea !== "IT" || row.valuation !== "V") {
      throw new Error("Geografia o valutazione EPEA inattesa.");
    }
    const key = `${row.year}:${row.cepaClass}`;
    if (cells.has(key)) throw new Error(`Osservazione EPEA duplicata: ${key}.`);
    if ((row.amountCents === null) !== (row.obsValueMillions === null)
      || (row.amountCents !== null && (!Number.isSafeInteger(row.amountCents) || row.amountCents < 0
        || !/^\d+(?:\.\d+)?$/.test(row.obsValueMillions!)
        || Math.round(Number(row.obsValueMillions) * 100_000_000) !== row.amountCents))) {
      throw new Error(`Importo EPEA incoerente: ${key}.`);
    }
    cells.set(key, row.amountCents);
  }
  const value = (period: number, cepa: string) => cells.get(`${period}:${cepa}`) ?? null;
  return {
    year,
    sector,
    totalCents: value(year, "TOT_CEPA"),
    classes: EPEA_CLASSES.map((item) => ({ ...item, amountCents: value(year, item.code) })),
    history: EPEA_YEARS.map((period) => ({ year: period, amountCents: value(period, "TOT_CEPA") })),
  };
}
