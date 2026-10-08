/**
 * Cross-region net comparison for the paycheck counter map.
 * Same RAL / mensilità / missions; only regional+municipal surtax schedules differ.
 */

import {
  computePaycheck,
  type PaycheckMissionShare,
  type PaycheckMonthCount,
  type PaycheckRegionRates,
} from "@/lib/paycheck-counter";

export type PaycheckRegionNetRow = {
  code: string;
  name: string;
  monthlyNetCents: number;
  monthlyRegionalCents: number;
  monthlyMunicipalCents: number;
  monthlyIrpefCents: number;
  monthlySscCents: number;
};

export function comparePaycheckNetsByRegion(input: {
  annualGrossEur: number;
  payMonths: PaycheckMonthCount;
  regions: readonly PaycheckRegionRates[];
  missions: readonly PaycheckMissionShare[];
}): {
  rows: readonly PaycheckRegionNetRow[];
  minNetCents: number;
  maxNetCents: number;
} {
  const rows: PaycheckRegionNetRow[] = input.regions.map((region) => {
    const result = computePaycheck({
      annualGrossEur: input.annualGrossEur,
      region,
      missions: input.missions,
      payMonths: input.payMonths,
    });
    const regional = result.deductions.find((row) => row.key === "regionalSurtax");
    const municipal = result.deductions.find((row) => row.key === "municipalSurtax");
    const irpef = result.deductions.find((row) => row.key === "irpef");
    const ssc = result.deductions.find((row) => row.key === "employeeSsc");
    return {
      code: region.code,
      name: region.name,
      monthlyNetCents: result.monthlyNetCents,
      monthlyRegionalCents: regional?.monthlyCents ?? 0,
      monthlyMunicipalCents: municipal?.monthlyCents ?? 0,
      monthlyIrpefCents: irpef?.monthlyCents ?? 0,
      monthlySscCents: ssc?.monthlyCents ?? 0,
    };
  });

  rows.sort((left, right) => right.monthlyNetCents - left.monthlyNetCents);

  const nets = rows.map((row) => row.monthlyNetCents);
  return {
    rows,
    minNetCents: Math.min(...nets),
    maxNetCents: Math.max(...nets),
  };
}

/** Quantile thresholds for a 5-step choropleth (ascending values). */
export function paycheckNetColorLevels(
  values: readonly number[],
): readonly [number, number, number, number] {
  const sorted = [...values].filter((value) => Number.isFinite(value)).sort((a, b) => a - b);
  if (sorted.length === 0) return [0, 0, 0, 0];
  const at = (fraction: number) => {
    const index = Math.min(sorted.length - 1, Math.floor(sorted.length * fraction));
    return sorted[index] ?? 0;
  };
  return [at(0.2), at(0.4), at(0.6), at(0.8)];
}

export function paycheckNetLevel(
  value: number,
  thresholds: readonly [number, number, number, number],
): number {
  const index = thresholds.findIndex((threshold) => value <= threshold);
  return index === -1 ? 4 : index;
}
