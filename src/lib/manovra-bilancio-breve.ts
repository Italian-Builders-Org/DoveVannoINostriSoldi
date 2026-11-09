import snapshotJson from "@/data/generated/rgs-bilancio-in-breve.json";

export type MoneyPair = {
  competenzaEur: number | null;
  cassaEur: number | null;
};

export type SummaryMetric = {
  label: string;
  byYear: Record<string, MoneyPair>;
};

export type ManovraShareRow = {
  aggregate: string;
  byYear: Record<
    string,
    {
      legislazioneVigentePct: number | null;
      manovraPct: number | null;
      totalePct: number | null;
    }
  >;
};

export type DetailSeriesRow = {
  label: string;
  byYear: Record<string, MoneyPair>;
};

export type MissionHistorySeries = {
  available: boolean;
  unit: string;
  years: number[];
  missions: Array<{
    mission: string;
    byYearMillionEur: Record<string, number>;
  }>;
  note?: string;
};

export type ManovraEdition = {
  id: string;
  label: string;
  firstYear: number;
  years: number[];
  nature: string;
  unit: string;
  landingUrl: string;
  xlsx: { url: string; fileName: string; bytes: number; sha256: string };
  pdf: { url: string; fileName: string; bytes: number; sha256: string };
  acquiredAt: string;
  headline: {
    entrateFinaliCompetenzaEur: number;
    speseFinaliCompetenzaEur: number;
    saldoNettoDaFinanziareCompetenzaEur: number;
    ricorsoAlMercatoCompetenzaEur: number;
  };
  summary: Record<string, SummaryMetric>;
  manovraShareOfAppropriationsPct: ManovraShareRow[];
  programmatic: {
    available: boolean;
    note?: string;
    series: Record<string, { label: string; byYear: Record<string, number | null> }>;
  };
  revenueDetail: DetailSeriesRow[];
  spendDetail: DetailSeriesRow[];
  missionHistory: MissionHistorySeries;
  caveats: string[];
};

export type FirstYearComparison = {
  fromEditionId: string;
  toEditionId: string;
  fromYear: number;
  toYear: number;
  entrateFinali: {
    fromEur: number;
    toEur: number;
    deltaEur: number;
    deltaPct: number | null;
  };
  speseFinali: {
    fromEur: number;
    toEur: number;
    deltaEur: number;
    deltaPct: number | null;
  };
  saldoNettoDaFinanziare: {
    fromEur: number;
    toEur: number;
    deltaEur: number;
    deltaPct: number | null;
  };
  ricorsoAlMercato: {
    fromEur: number;
    toEur: number;
    deltaEur: number;
    deltaPct: number | null;
  };
};

export type ManovraSnapshot = {
  schemaVersion: number;
  title: string;
  holder: string;
  archiveUrl: string;
  moneyNature: string;
  unit: string;
  referenceNote: string;
  coverage: {
    comparableXlsxFirstYears: number[];
    pdfOnlyLandingYears: number[];
    archiveCatalogUrl: string;
    note: string;
  };
  acquiredAt: string;
  checkedAt: string;
  latestEditionId: string;
  editions: ManovraEdition[];
  firstYearComparisons: FirstYearComparison[];
};

const snapshot = snapshotJson as ManovraSnapshot;

export function getManovraSnapshot(): ManovraSnapshot {
  if (snapshot.schemaVersion !== 1 || !Array.isArray(snapshot.editions)) {
    throw new Error("Snapshot Bilancio in Breve fuori contratto");
  }
  return snapshot;
}

export function getEdition(id: string): ManovraEdition {
  const edition = getManovraSnapshot().editions.find((item) => item.id === id);
  if (!edition) throw new Error(`Edizione manovra sconosciuta: ${id}`);
  return edition;
}

export function getLatestEdition(): ManovraEdition {
  return getEdition(getManovraSnapshot().latestEditionId);
}

export function getLatestComparison(): FirstYearComparison | null {
  const rows = getManovraSnapshot().firstYearComparisons;
  return rows.length ? rows[rows.length - 1] : null;
}

export function formatSignedBillions(eur: number): string {
  const billions = eur / 1_000_000_000;
  const abs = Math.abs(billions);
  const digits = abs >= 100 ? 0 : abs >= 10 ? 1 : 2;
  const body = abs.toLocaleString("it-IT", {
    minimumFractionDigits: digits,
    maximumFractionDigits: digits,
  });
  const sign = billions > 0 ? "+" : billions < 0 ? "−" : "";
  return `${sign}${body} mld €`;
}

export function formatBillions(eur: number): string {
  const billions = Math.abs(eur) / 1_000_000_000;
  const digits = billions >= 100 ? 0 : billions >= 10 ? 1 : 2;
  const body = billions.toLocaleString("it-IT", {
    minimumFractionDigits: digits,
    maximumFractionDigits: digits,
  });
  return `${eur < 0 ? "−" : ""}${body} mld €`;
}

export function formatExactEuro(eur: number): string {
  return new Intl.NumberFormat("it-IT", {
    style: "currency",
    currency: "EUR",
    maximumFractionDigits: 0,
  }).format(eur);
}

/** Importi di pagina: sempre in mld con 2 decimali (es. 768,78 mld €), mai al centesimo. */
export function formatReadableMoney(eur: number): string {
  const billions = Math.abs(eur) / 1_000_000_000;
  const body = billions.toLocaleString("it-IT", {
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  });
  return `${eur < 0 ? "−" : ""}${body} mld €`;
}

export function formatSignedPct(value: number | null, digits = 1): string {
  if (value == null || !Number.isFinite(value)) return "n.d.";
  const abs = Math.abs(value).toLocaleString("it-IT", {
    minimumFractionDigits: digits,
    maximumFractionDigits: digits,
  });
  const sign = value > 0 ? "+" : value < 0 ? "−" : "";
  return `${sign}${abs}%`;
}

export function manovraShareSorted(
  edition: ManovraEdition,
  year: number,
): Array<{ aggregate: string; manovraPct: number; totalePct: number | null }> {
  const key = String(year);
  return edition.manovraShareOfAppropriationsPct
    .map((row) => {
      const point = row.byYear[key];
      if (!point || point.manovraPct == null) return null;
      if (row.aggregate.toLowerCase().startsWith("totale")) return null;
      return {
        aggregate: row.aggregate,
        manovraPct: point.manovraPct,
        totalePct: point.totalePct,
      };
    })
    .filter((row): row is NonNullable<typeof row> => Boolean(row))
    .sort((a, b) => Math.abs(b.manovraPct) - Math.abs(a.manovraPct));
}

export function detailCompetenza(
  rows: DetailSeriesRow[],
  label: string,
  year: number,
): number | null {
  const row = rows.find((item) => item.label === label);
  return row?.byYear[String(year)]?.competenzaEur ?? null;
}

export function topDetailRows(
  rows: DetailSeriesRow[],
  year: number,
  limit = 10,
): Array<{ label: string; amountEur: number }> {
  const seen = new Set<string>();
  return rows
    .map((row) => ({
      label: row.label,
      amountEur: row.byYear[String(year)]?.competenzaEur ?? null,
    }))
    .filter((row): row is { label: string; amountEur: number } => row.amountEur != null)
    .filter((row) => !row.label.toLowerCase().startsWith("totale"))
    .filter((row) => {
      if (seen.has(row.label)) return false;
      seen.add(row.label);
      return true;
    })
    .sort((a, b) => b.amountEur - a.amountEur)
    .slice(0, limit);
}
