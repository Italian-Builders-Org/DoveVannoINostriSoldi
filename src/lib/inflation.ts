import { eurostatHicpData, eurostatHicpMetadata } from "@/lib/eurostat-hicp-snapshot";
import type { EurostatHicpDivisionCode } from "@/lib/data/eurostat-hicp-contract";

export const ISTAT_CONSUMER_PRICE_2026_URL =
  "https://www.istat.it/comunicato-stampa/gli-indici-dei-prezzi-al-consumo-anno-2026/";

const DIVISION_LABELS_IT: Readonly<Record<EurostatHicpDivisionCode, string>> = {
  CP01: "Alimentari e bevande analcoliche",
  CP02: "Bevande alcoliche, tabacco e droghe",
  CP03: "Abbigliamento e calzature",
  CP04: "Abitazione, acqua, elettricità, gas e altri combustibili",
  CP05: "Arredamenti, apparecchi per la casa e manutenzione",
  CP06: "Sanità",
  CP07: "Trasporti",
  CP08: "Informazione e comunicazione",
  CP09: "Ricreazione, sport e cultura",
  CP10: "Istruzione",
  CP11: "Ristoranti e servizi di alloggio",
  CP12: "Assicurazioni e servizi finanziari",
  CP13: "Cura della persona, protezione sociale e altri beni e servizi",
};

const GEO_LABELS_IT = {
  EU27_2020: "Unione europea (UE27)",
  EA21: "Area euro (21 paesi)",
  IT: "Italia",
} as const;

function rate(tenths: number): number {
  return tenths / 10;
}

function monthLabel(period: string): string {
  const [year, month] = period.split("-").map(Number) as [number, number];
  return new Intl.DateTimeFormat("it-IT", { month: "long", year: "numeric", timeZone: "UTC" })
    .format(new Date(Date.UTC(year, month - 1, 1)));
}

function shortMonthLabel(period: string): string {
  const [year, month] = period.split("-").map(Number) as [number, number];
  return new Intl.DateTimeFormat("it-IT", { month: "short", year: "2-digit", timeZone: "UTC" })
    .format(new Date(Date.UTC(year, month - 1, 1)));
}

export function getInflationView() {
  const latest = eurostatHicpData.totalObservations.at(-1);
  if (!latest) throw new Error("Snapshot Eurostat HICP senza osservazioni Italia");
  const currentWeightYear = eurostatHicpData.period.weightYears.at(-1);
  if (!currentWeightYear) throw new Error("Snapshot Eurostat HICP senza anno dei pesi");
  const weights = new Map(
    eurostatHicpData.weights
      .filter((row) => row.year === currentWeightYear)
      .map((row) => [row.code, row.weightHundredthsPerThousand] as const),
  );

  const divisions = eurostatHicpData.divisionObservations.map((row) => {
    const weightHundredthsPerThousand = weights.get(row.code);
    if (weightHundredthsPerThousand === undefined) {
      throw new Error(`Snapshot Eurostat HICP: peso ${currentWeightYear}/${row.code} assente`);
    }
    return {
      code: row.code,
      label: DIVISION_LABELS_IT[row.code],
      sourceLabel: eurostatHicpData.divisions.find((division) => division.code === row.code)?.label ?? row.code,
      annualRate: rate(row.annualRateTenths),
      weightPerThousand: weightHundredthsPerThousand / 100,
      weightPercent: weightHundredthsPerThousand / 1_000,
      period: row.period,
      flag: row.flag ?? null,
    };
  });

  return {
    latest: {
      period: latest.period,
      periodLabel: monthLabel(latest.period),
      index: latest.indexHundredths / 100,
      annualRate: rate(latest.annualRateTenths),
      monthlyRate: rate(latest.monthlyRateTenths),
      estimated: Object.values(latest.flags ?? {}).includes("e"),
    },
    trend: eurostatHicpData.totalObservations.map((row) => ({
      period: row.period,
      label: monthLabel(row.period),
      shortLabel: shortMonthLabel(row.period),
      index: row.indexHundredths / 100,
      annualRate: rate(row.annualRateTenths),
      monthlyRate: rate(row.monthlyRateTenths),
      estimated: Object.values(row.flags ?? {}).includes("e"),
    })),
    comparison: eurostatHicpData.comparison.map((row) => ({
      geo: row.geo,
      label: GEO_LABELS_IT[row.geo],
      annualRate: rate(row.annualRateTenths),
      period: row.period,
      periodLabel: monthLabel(row.period),
      flag: row.flag ?? null,
    })),
    divisions,
    divisionsByRate: divisions.toSorted((a, b) => b.annualRate - a.annualRate || a.code.localeCompare(b.code)),
    currentWeightYear,
    data: eurostatHicpData,
    metadata: eurostatHicpMetadata,
  };
}
