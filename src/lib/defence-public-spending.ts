import "server-only";

import budgetLawSourceLock from "../../scripts/etl/specs/openbdap-budget-law-missions.source.json";
import {
  getCommittedBudgetLawMissionSeries,
  selectBudgetLawMission,
  type BudgetLawMissionSeries,
} from "@/lib/bdap-legge-bilancio";
import {
  eurostatCofogMetadata,
  queryEurostatCofog,
  type EurostatCofogQueryResult,
} from "@/lib/eurostat-cofog-snapshot";

export const DEFENCE_MISSION = "Difesa e sicurezza del territorio";

export function parseDefenceYear(value: string | string[] | undefined): number | null {
  if (value === undefined) return eurostatCofogMetadata.period.to;
  if (typeof value !== "string" || !/^\d{4}$/.test(value)) return null;
  const year = Number(value);
  return year >= eurostatCofogMetadata.period.from && year <= eurostatCofogMetadata.period.to ? year : null;
}

/** The inputs have already crossed their snapshot contracts. Keep an absent
 * year distinct from a published zero when placing the two series alongside. */
export function buildDefenceSeries(
  cofog: EurostatCofogQueryResult,
  budget: BudgetLawMissionSeries,
) {
  const history = [...cofog.observations].sort((left, right) => left.year - right.year);
  if (
    history.length !== cofog.period.to - cofog.period.from + 1 ||
    history.some((point, index) =>
      point.geo !== "IT" || point.function !== "GF02" ||
      point.year !== cofog.period.from + index)
  ) {
    throw new Error("Difesa: serie COFOG Italia GF02 incompleta o inattesa.");
  }
  const mission = selectBudgetLawMission(budget, DEFENCE_MISSION);
  const allocations = [...mission.allocations].sort((left, right) => left.year - right.year);
  if (!allocations.length || allocations.length !== mission.years.length ||
    allocations.some((point, index) => point.year !== mission.years[index])) {
    throw new Error("Difesa: serie della missione di bilancio incompleta.");
  }
  const latestCofog = history.at(-1)!;
  const latestBudget = allocations.at(-1)!;
  const budgetByYear = new Map(allocations.map((point) => [point.year, point]));
  const cofogByYear = new Map(history.map((point) => [point.year, point]));
  const comparisonCofog = history.findLast((point) => budgetByYear.has(point.year));
  if (!comparisonCofog) throw new Error("Difesa: nessun anno comune alle due fonti.");
  const years = [...new Set([...cofogByYear.keys(), ...budgetByYear.keys()])].sort((a, b) => a - b);

  return {
    history,
    allocations,
    latestCofog,
    latestBudget,
    comparison: {
      year: comparisonCofog.year,
      cofog: comparisonCofog,
      budget: budgetByYear.get(comparisonCofog.year)!,
    },
    annual: years.map((year) => ({
      year,
      cofog: cofogByYear.get(year) ?? null,
      budget: budgetByYear.get(year) ?? null,
    })),
  };
}

export function getDefencePublicSpendingView(year: number = eurostatCofogMetadata.period.to) {
  const cofog = queryEurostatCofog({ geo: "IT", function: "GF02" });
  const budget = getCommittedBudgetLawMissionSeries(10);
  const series = buildDefenceSeries(cofog, budget);
  const selected = series.history.find((point) => point.year === year);
  if (!selected) throw new Error("Difesa: anno COFOG non disponibile.");
  return {
    ...series,
    selected,
    comparison: {
      year: selected.year,
      cofog: selected,
      budget: series.allocations.find((point) => point.year === selected.year) ?? null,
    },
    missionLabel: DEFENCE_MISSION,
    flags: cofog.flags,
    cofog: {
      period: cofog.period,
      source: eurostatCofogMetadata.source,
      semantics: eurostatCofogMetadata.semantics,
      integrity: eurostatCofogMetadata.integrity,
      caveats: cofog.caveats,
    },
    budget: {
      dataset: budget.dataset,
      semantics: {
        soldi: { unit: "euro", nature: "Stanziamenti di competenza della Legge di Bilancio (CP A1)" },
        periodo: { from: budget.years[0], to: budget.years.at(-1)! },
        provenance: {
          holder: budgetLawSourceLock.source.owner,
          publicationDate: null,
          metadataModified: budget.dataset.metadataModified,
          acquisitionDate: budget.observedAt,
          checkedAt: null,
          license: budget.dataset.license,
          canonicalUrls: [budget.dataset.apiUrl, budget.dataset.csvUrl],
          sha256: budgetLawSourceLock.source.csv.sha256,
        },
      },
    },
  };
}
