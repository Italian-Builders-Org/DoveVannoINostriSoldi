import "server-only";

import { getCommittedBudgetLawMissionSeries, selectBudgetLawMission } from "@/lib/bdap-legge-bilancio";
import { eurostatCofogData, eurostatCofogMetadata, queryEurostatCofog } from "@/lib/eurostat-cofog-snapshot";

export const CULTURE_COFOG_FUNCTION = "GF08";
export const CULTURE_BUDGET_MISSION = "Tutela e valorizzazione dei beni e attivita' culturali e paesaggistici";

/** A malformed or unavailable year must never silently show another period. */
export function parseCultureYear(raw: string | string[] | undefined): number | null {
  if (raw === undefined) return eurostatCofogData.period.to;
  if (typeof raw !== "string" || !/^\d{4}$/.test(raw)) return null;
  const year = Number(raw);
  return year >= eurostatCofogData.period.from && year <= eurostatCofogData.period.to ? year : null;
}

/** Both reading models come from their existing validated snapshot adapters. */
export function buildCulturePublicSpendingView(year: number = eurostatCofogData.period.to) {
  const selectedQuery = queryEurostatCofog({ geo: "IT", year });
  const selected = selectedQuery.observations.find((row) => row.function === CULTURE_COFOG_FUNCTION);
  const total = selectedQuery.observations.find((row) => row.function === "TOTAL");
  if (!selected || !total) throw new Error(`Spesa COFOG Italia incompleta per ${year}.`);
  const history = queryEurostatCofog({ geo: "IT", function: CULTURE_COFOG_FUNCTION })
    .observations.slice().sort((left, right) => left.year - right.year);
  const budget = selectBudgetLawMission(getCommittedBudgetLawMissionSeries(10), CULTURE_BUDGET_MISSION);

  return {
    year,
    selected,
    history,
    years: history.map((row) => row.year),
    shareOfPublicSpendingPercent: total.amountCents > 0 ? selected.amountCents / total.amountCents * 100 : null,
    totalPublicSpendingCents: total.amountCents,
    metadata: eurostatCofogMetadata,
    flags: eurostatCofogData.flags,
    caveats: eurostatCofogData.caveats,
    // State appropriations are a separate measure, never a GF08 breakdown.
    budget: {
      ...budget,
      selected: budget.allocations.find((row) => row.year === year) ?? null,
    },
  };
}
