export type MoneyPair = {
  competenzaEur: number | null;
  cassaEur: number | null;
};

export type SummaryMetric = {
  label: string;
  byYear: Record<string, MoneyPair>;
};

export type ManovraSharePoint = {
  legislazioneVigentePct: number | null;
  manovraPct: number | null;
  totalePct: number | null;
  legislazioneVigenteEur?: number | null;
  manovraEur?: number | null;
  stanziamentoEur?: number | null;
};

export type ManovraShareRow = {
  aggregate: string;
  byYear: Record<string, ManovraSharePoint>;
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

export type ProgrammaticPilPoint = {
  year: number;
  indebitamento: number | null;
  primario: number | null;
  debito: number | null;
};

const PROGRAMMATIC_PIL_SERIES = [
  "indebitamentoNettoPilPct",
  "saldoPrimarioPilPct",
  "debitoPubblicoPilPct",
] as const;

/** PIL/deficit series for Tav. 1 — independent of the page year selector. */
export function buildProgrammaticPilPoints(
  edition: ManovraEdition,
): ProgrammaticPilPoint[] {
  if (!edition.programmatic.available) return [];
  const { series } = edition.programmatic;
  const years = new Set<number>(edition.years);
  for (const key of PROGRAMMATIC_PIL_SERIES) {
    const byYear = series[key]?.byYear;
    if (!byYear) continue;
    for (const year of Object.keys(byYear)) {
      const parsed = Number(year);
      if (Number.isInteger(parsed)) years.add(parsed);
    }
  }
  return [...years]
    .sort((a, b) => a - b)
    .map((year) => ({
      year,
      indebitamento: series.indebitamentoNettoPilPct?.byYear[String(year)] ?? null,
      primario: series.saldoPrimarioPilPct?.byYear[String(year)] ?? null,
      debito: series.debitoPubblicoPilPct?.byYear[String(year)] ?? null,
    }));
}

export function shouldShowProgrammaticPilChart(
  edition: ManovraEdition,
  points: ProgrammaticPilPoint[],
): boolean {
  if (!edition.programmatic.available || points.length === 0) return false;
  return points.some(
    (point) =>
      (point.indebitamento != null && Number.isFinite(point.indebitamento)) ||
      (point.primario != null && Number.isFinite(point.primario)) ||
      (point.debito != null && Number.isFinite(point.debito)),
  );
}

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
    pendingBilancioInBreveFirstYears?: number[];
    archiveCatalogUrl: string;
    note: string;
  };
  acquiredAt: string;
  checkedAt: string;
  latestEditionId: string;
  editions: ManovraEdition[];
  firstYearComparisons: FirstYearComparison[];
};

/** Fail-closed parse of the Bilancio in Breve reading model (from dvns_snapshots). */
export function assertManovraSnapshot(value: unknown): ManovraSnapshot {
  if (!value || typeof value !== "object") {
    throw new Error("Snapshot Bilancio in Breve fuori contratto");
  }
  const snapshot = value as ManovraSnapshot;
  if (snapshot.schemaVersion !== 1 || !Array.isArray(snapshot.editions) || snapshot.editions.length === 0) {
    throw new Error("Snapshot Bilancio in Breve fuori contratto");
  }
  if (typeof snapshot.latestEditionId !== "string" || !snapshot.latestEditionId) {
    throw new Error("Snapshot Bilancio in Breve fuori contratto");
  }
  if (!snapshot.editions.some((edition) => edition.id === snapshot.latestEditionId)) {
    throw new Error("Snapshot Bilancio in Breve fuori contratto");
  }
  return snapshot;
}

export function getEdition(snapshot: ManovraSnapshot, id: string): ManovraEdition {
  const edition = snapshot.editions.find((item) => item.id === id);
  if (!edition) throw new Error(`Edizione manovra sconosciuta: ${id}`);
  return edition;
}

export function getLatestEdition(snapshot: ManovraSnapshot): ManovraEdition {
  return getEdition(snapshot, snapshot.latestEditionId);
}

export function getLatestComparison(snapshot: ManovraSnapshot): FirstYearComparison | null {
  const rows = snapshot.firstYearComparisons;
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
): Array<{
  aggregate: string;
  manovraPct: number;
  totalePct: number | null;
  manovraEur: number | null;
  stanziamentoEur: number | null;
}> {
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
        manovraEur: point.manovraEur ?? null,
        stanziamentoEur: point.stanziamentoEur ?? null,
      };
    })
    .filter((row): row is NonNullable<typeof row> => Boolean(row))
    .sort((a, b) => Math.abs(b.manovraPct) - Math.abs(a.manovraPct));
}

const MISSION_SHORT_LABELS: Record<string, string> = {
  "Istruzione scolastica": "Scuola",
  "Istruzione universitaria e formazione post-universitaria": "Università",
  "Tutela della salute": "Salute (Stato)",
  "Politiche previdenziali": "Previdenza",
  "Diritti sociali, politiche sociali e famiglia": "Politiche sociali",
  "Politiche per il lavoro": "Lavoro",
  "Difesa e sicurezza del territorio": "Difesa",
  "Ordine pubblico e sicurezza": "Sicurezza",
  "Giustizia": "Giustizia",
  "Debito pubblico": "Debito pubblico",
  "Relazioni finanziarie con le autonomie territoriali": "Autonomie territoriali",
  "Diritto alla mobilità e sviluppo dei sistemi di trasporto": "Trasporti",
  "Tutela e valorizzazione dei beni e attività culturali e paesaggistici": "Cultura",
  "Sviluppo sostenibile e tutela del territorio e dell'ambiente": "Ambiente",
  "Fondi da ripartire": "Fondi da ripartire",
  "Competitività e sviluppo delle imprese": "Imprese",
};

export function shortMissionLabel(mission: string): string {
  return MISSION_SHORT_LABELS[mission] ?? mission;
}

/** RGS Tav. A.3 missions for one year, largest first, excluding totals. */
export function rgsMissionsForYear(
  edition: ManovraEdition,
  year: number,
  limit = 16,
): Array<{ mission: string; short: string; amountEur: number }> {
  if (!edition.missionHistory.available) return [];
  const key = String(year);
  return edition.missionHistory.missions
    .map((row) => {
      const million = row.byYearMillionEur[key];
      if (million == null || !Number.isFinite(million)) return null;
      if (row.mission.toLowerCase().startsWith("totale")) return null;
      return {
        mission: row.mission,
        short: shortMissionLabel(row.mission),
        amountEur: Math.round(million * 1_000_000),
      };
    })
    .filter((row): row is NonNullable<typeof row> => Boolean(row))
    .sort((a, b) => b.amountEur - a.amountEur)
    .slice(0, limit);
}

/** Year-over-year change inside the same LB triennium (Tav. A.3). */
export function rgsMissionDeltas(
  edition: ManovraEdition,
  fromYear: number,
  toYear: number,
  limit = 12,
): Array<{ mission: string; short: string; deltaEur: number }> {
  if (!edition.missionHistory.available) return [];
  const fromKey = String(fromYear);
  const toKey = String(toYear);
  return edition.missionHistory.missions
    .map((row) => {
      const from = row.byYearMillionEur[fromKey];
      const to = row.byYearMillionEur[toKey];
      if (from == null || to == null) return null;
      if (row.mission.toLowerCase().startsWith("totale")) return null;
      return {
        mission: row.mission,
        short: shortMissionLabel(row.mission),
        deltaEur: Math.round((to - from) * 1_000_000),
      };
    })
    .filter((row): row is NonNullable<typeof row> => Boolean(row))
    .sort((a, b) => Math.abs(b.deltaEur) - Math.abs(a.deltaEur))
    .slice(0, limit)
    .sort((a, b) => a.deltaEur - b.deltaEur);
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
