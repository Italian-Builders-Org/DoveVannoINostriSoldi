import "server-only";

import {
  eurostatCofogData,
  queryEurostatCofog,
} from "@/lib/eurostat-cofog-snapshot";
import { getCommittedBudgetLawMissionSeries } from "@/lib/bdap-legge-bilancio";
import {
  availableSiopeYears,
  getSiopeMunicipalSnapshot,
} from "@/lib/siope-snapshot";

/** Everyday labels for COFOG divisions (3B). GF10 is broader than pensions alone. */
export const COFOG_EVERYDAY_LABELS: Readonly<Record<string, string>> = {
  TOTAL: "Totale",
  GF01: "Servizi generali",
  GF02: "Difesa",
  GF03: "Ordine pubblico e sicurezza",
  GF04: "Economia e imprese",
  GF05: "Ambiente",
  GF06: "Casa e territorio",
  GF07: "Sanità",
  GF08: "Cultura e tempo libero",
  GF09: "Istruzione",
  GF10: "Pensioni e protezione sociale",
};

const COFOG_EVERYDAY_NOTES: Readonly<Record<string, string>> = {
  GF01: "Include anche gli interessi sul debito e altri servizi generali; non è solo «burocrazia».",
  GF10: "Non sono solo le pensioni: qui Eurostat mette anche altre prestazioni sociali.",
  GF07: "Sanità della pubblica amministrazione nel complesso, non solo il bilancio dello Stato.",
};

/** Missions whose stanziamenti are dominated by gross debt repayment, not policy choice. */
export const BUDGET_LAW_DEBT_MISSION = "Debito pubblico";

const STATE_EVERYDAY_LABELS: Readonly<Record<string, string>> = {
  "Politiche previdenziali": "Pensioni",
  "Relazioni finanziarie con le autonomie territoriali": "Trasferimenti a Regioni e Comuni",
  "Politiche economico-finanziarie e di bilancio e tutela della finanza pubblica": "Finanza pubblica",
  "Istruzione scolastica": "Scuola",
  "Diritti sociali, politiche sociali e famiglia": "Politiche sociali",
  "Difesa e sicurezza del territorio": "Difesa",
  "Competitivita' e sviluppo delle imprese": "Imprese",
  "Istruzione universitaria e formazione post-universitaria": "Università",
  "Ordine pubblico e sicurezza": "Sicurezza",
  "Tutela della salute": "Salute (missione Stato)",
};

export type HomeFunnelSlice = Readonly<{
  id: string;
  label: string;
  note: string | null;
  amountEuro: number;
  sharePercent: number;
  href: string | null;
  linkLabel: string | null;
}>;

export type HomeItalyFunnel = Readonly<{
  pa: Readonly<{
    year: number;
    availableYears: readonly number[];
    totalEuro: number;
    gdpSharePercent: number;
    slices: readonly HomeFunnelSlice[];
    moneyNature: string;
    source: Readonly<{
      owner: string;
      label: string;
      href: string;
      observedAt: string;
      datasetCode: string;
    }>;
    caveats: readonly string[];
  }>;
  state: Readonly<{
    year: number;
    totalWithDebtEuro: number;
    totalWithoutDebtEuro: number;
    debtEuro: number;
    slices: readonly HomeFunnelSlice[];
    moneyNature: string;
    source: Readonly<{
      owner: string;
      label: string;
      href: string;
      observedAt: string;
    }>;
    caveat: string;
  }>;
  comuni: Readonly<{
    year: number;
    totalEuro: number;
    latestMonthLabel: string;
    moneyNature: string;
    href: string;
    sourceHref: string;
  }>;
}>;

function eurosFromCents(cents: number): number {
  return cents / 100;
}

function sharePercent(part: number, total: number): number {
  if (total <= 0) return 0;
  return (part / total) * 100;
}

function resolveCofogYear(requested: number | undefined): number {
  const { from, to } = eurostatCofogData.period;
  if (requested !== undefined && Number.isSafeInteger(requested) && requested >= from && requested <= to) {
    return requested;
  }
  return to;
}

function cofogLink(code: string): { href: string; linkLabel: string } | null {
  if (code === "GF01") return { href: "/debito", linkLabel: "Debito e interessi" };
  if (code === "GF04") return { href: "/imprese", linkLabel: "Imprese" };
  if (code === "GF05") return { href: "/spese/ambiente", linkLabel: "Protezione dell'ambiente" };
  if (code === "GF06") return { href: "/territori", linkLabel: "Territori" };
  if (code === "GF07") return { href: "/spese/sanita", linkLabel: "Sanità" };
  if (code === "GF08") return { href: "/spese/sport", linkLabel: "Sport (parziale)" };
  if (code === "GF09") return { href: "/istruzione", linkLabel: "Istruzione" };
  if (code === "GF10") return { href: "/spese/pensioni", linkLabel: "Pensioni" };
  return null;
}

function stateLink(mission: string): { href: string; linkLabel: string } {
  if (mission === "Politiche previdenziali") {
    return { href: "/spese/pensioni", linkLabel: "Pensioni" };
  }
  if (mission === "Tutela della salute") {
    return { href: "/spese/sanita", linkLabel: "Sanità" };
  }
  if (mission.startsWith("Istruzione scolastica")) {
    return { href: "/istruzione", linkLabel: "Scuola" };
  }
  if (mission.startsWith("Istruzione universitaria")) {
    return { href: "/istruzione/universita-ricerca", linkLabel: "Università e ricerca" };
  }
  if (mission === "Difesa e sicurezza del territorio") {
    return { href: "/stato", linkLabel: "Spese dello Stato" };
  }
  if (mission === "Relazioni finanziarie con le autonomie territoriali") {
    return { href: "/regioni", linkLabel: "Regioni" };
  }
  if (mission === "Competitivita' e sviluppo delle imprese") {
    return { href: "/imprese", linkLabel: "Imprese" };
  }
  if (mission === "Diritti sociali, politiche sociali e famiglia") {
    return { href: "/poverta", linkLabel: "Povertà" };
  }
  return { href: "/spese/legge-di-bilancio", linkLabel: "Legge di Bilancio" };
}

/**
 * Homepage funnel: PA (Eurostat COFOG, SEC) then Stato (Legge di Bilancio enacted),
 * then a compact Comuni cash pointer. Snapshots only: no live OpenBDAP on `/`.
 */
export function buildHomeItalyFunnel(requestedYear?: number): HomeItalyFunnel {
  const year = resolveCofogYear(requestedYear);
  const cofog = queryEurostatCofog({ geo: "IT", year });
  const total = cofog.observations.find((row) => row.function === "TOTAL");
  if (!total) {
    throw new Error(`Manca il totale Eurostat COFOG Italia per ${year}.`);
  }

  const divisions = cofog.observations
    .filter((row) => row.function !== "TOTAL")
    .slice()
    .sort((left, right) => right.amountCents - left.amountCents);

  const totalEuro = eurosFromCents(total.amountCents);
  // Show every COFOG division: the chart must read as a full composition, not a truncated list.
  const slices: HomeFunnelSlice[] = divisions.map((row) => {
    const link = cofogLink(row.function);
    return {
      id: row.function,
      label: COFOG_EVERYDAY_LABELS[row.function] ?? row.function,
      note: COFOG_EVERYDAY_NOTES[row.function] ?? null,
      amountEuro: eurosFromCents(row.amountCents),
      sharePercent: sharePercent(row.amountCents, total.amountCents),
      href: link?.href ?? null,
      linkLabel: link?.linkLabel ?? null,
    };
  });

  const budget = getCommittedBudgetLawMissionSeries(10);
  // Prefer the same calendar year as COFOG when present; otherwise the latest enacted year.
  const stateYear = budget.years.includes(year)
    ? year
    : Math.max(...budget.years);
  const yearAllocations = budget.allocations.filter((row) => row.year === stateYear);
  if (yearAllocations.length === 0) {
    throw new Error(`Nessuno stanziamento Legge di Bilancio per ${stateYear}.`);
  }

  const debtEuro = yearAllocations
    .filter((row) => row.mission === BUDGET_LAW_DEBT_MISSION)
    .reduce((sum, row) => sum + row.amountEur, 0);
  const withoutDebt = yearAllocations.filter((row) => row.mission !== BUDGET_LAW_DEBT_MISSION);
  const totalWithoutDebtEuro = withoutDebt.reduce((sum, row) => sum + row.amountEur, 0);
  const totalWithDebtEuro = yearAllocations.reduce((sum, row) => sum + row.amountEur, 0);

  const stateTop = withoutDebt
    .slice()
    .sort((left, right) => right.amountEur - left.amountEur)
    .slice(0, 5);

  const stateSlices: HomeFunnelSlice[] = stateTop.map((row) => {
    const link = stateLink(row.mission);
    return {
      id: row.mission,
      label: STATE_EVERYDAY_LABELS[row.mission] ?? row.mission,
      note: row.mission === "Tutela della salute"
        ? "Nel bilancio dello Stato questa missione è piccola: la sanità pesa soprattutto su Regioni e SSN."
        : null,
      amountEuro: row.amountEur,
      sharePercent: sharePercent(row.amountEur, totalWithoutDebtEuro),
      href: link.href,
      linkLabel: link.linkLabel,
    };
  });

  const siopeYear = availableSiopeYears[0];
  const siope = getSiopeMunicipalSnapshot(siopeYear);

  return {
    pa: {
      year,
      availableYears: Array.from(
        { length: eurostatCofogData.period.to - eurostatCofogData.period.from + 1 },
        (_, index) => eurostatCofogData.period.from + index,
      ).reverse(),
      totalEuro,
      gdpSharePercent: total.shareOfGdpHundredths / 100,
      slices,
      moneyNature:
        "Spesa delle amministrazioni pubbliche (S13) in competenza economica SEC 2010: non è cassa e non è solo lo Stato centrale.",
      source: {
        owner: cofog.source.owner,
        label: `Eurostat COFOG · ${cofog.source.datasetCode}`,
        href: cofog.source.landingUrl,
        observedAt: cofog.source.publicationDate.slice(0, 10),
        datasetCode: cofog.source.datasetCode,
      },
      caveats: [
        ...cofog.caveats.slice(0, 2),
        "Il totale Eurostat non è la somma esatta delle funzioni: ogni cella è arrotondata dalla fonte.",
        `Lo snapshot Eurostat acquisito copre l’Italia fino al ${eurostatCofogData.period.to}.`,
      ],
    },
    state: {
      year: stateYear,
      totalWithDebtEuro,
      totalWithoutDebtEuro,
      debtEuro,
      slices: stateSlices,
      moneyNature:
        "Stanziamenti di competenza della Legge di Bilancio (CP A1): autorizzazioni, non pagamenti di cassa.",
      source: {
        owner: "RGS / OpenBDAP",
        label: "Legge di Bilancio · missioni",
        href: "/spese/legge-di-bilancio",
        observedAt: budget.observedAt.slice(0, 10),
      },
      caveat:
        "La missione «Debito pubblico» è esclusa dalle barre percentuali perché è dominata dal rimborso lordo del debito, non dalla spesa per servizi.",
    },
    comuni: {
      year: siope.year,
      totalEuro: siope.totalPaid,
      latestMonthLabel: siope.latestMonthLabel,
      moneyNature: "Pagamenti di cassa SIOPE dei soli Comuni: restano fuori Stato, Regioni e sanità.",
      href: `/spese?anno=${siope.year}`,
      sourceHref: siope.source.siopeMovementsUrl,
    },
  };
}
