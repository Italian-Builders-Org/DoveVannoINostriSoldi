import "server-only";

import {
  eurostatCofogMetadata,
  queryEurostatCofog,
  type EurostatCofogQueryResult,
} from "@/lib/eurostat-cofog-snapshot";

export function parseHealthYear(value: string | string[] | undefined): number | null {
  if (value === undefined) return eurostatCofogMetadata.period.to;
  if (typeof value !== "string" || !/^\d{4}$/.test(value)) return null;
  const year = Number(value);
  const { from, to } = eurostatCofogMetadata.period;
  return year >= from && year <= to ? year : null;
}

/** Consume only observations that already crossed the canonical snapshot contract. */
export function buildHealthHistory(cofog: EurostatCofogQueryResult) {
  const history = [...cofog.observations].sort((left, right) => left.year - right.year);
  if (history.length !== cofog.period.to - cofog.period.from + 1 ||
    history.some((point, index) => point.geo !== "IT" || point.function !== "GF07" ||
      point.year !== cofog.period.from + index)) {
    throw new Error("Sanità: serie COFOG Italia GF07 incompleta o inattesa.");
  }
  return history;
}

export function getHealthPublicSpendingView(year: number = eurostatCofogMetadata.period.to) {
  const cofog = queryEurostatCofog({ geo: "IT", function: "GF07" });
  const history = buildHealthHistory(cofog);
  const selected = history.find((point) => point.year === year);
  if (!selected) throw new Error("Sanità: anno COFOG non disponibile.");
  return { history, selected, flags: cofog.flags, metadata: eurostatCofogMetadata };
}
