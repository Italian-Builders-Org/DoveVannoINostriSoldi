import type { OpenCivitasMunicipality } from "@/lib/data/opencivitas-contract";

/**
 * Derived screening of OpenCivitas' historical-minus-standard spending per
 * inhabitant. It is deliberately separate from the source indicators for
 * service quantity and quality: a result only identifies a distributional
 * value worth reading in context.
 */
export const METHODOLOGY_WARNING =
  "Screening derivato dai dati OpenCivitas: confronta la differenza per abitante tra spesa storica e spesa standard con una soglia regionale. " +
  "Un valore oltre la soglia indica dove approfondire con contesto locale, servizi e qualità del dato.";

export const POPULATION_METHOD_WARNING =
  "La popolazione mostrata per gli outlier è una stima implicita: la media arrotondata dei valori ottenuti dividendo spesa totale e spesa per abitante per le due misure disponibili. " +
  "Resta una ricostruzione contabile, distinta da un denominatore demografico ISTAT.";

export type OutlierDirection = "sopra" | "sotto";

export type PopulationBand =
  | "meno-di-1.000"
  | "1.000-4.999"
  | "5.000-19.999"
  | "20.000-o-piu"
  | "non-disponibile";

export type SpendingOutlier = {
  istatCode: string;
  name: string;
  province: string;
  region: string;
  differencePerCapitaCents: number;
  direction: OutlierDirection;
  /** Null when the region has zero IQR; distance remains available. */
  excessMultiple: number | null;
  distanceBeyondFenceCents: number;
  impliedPopulation: number | null;
  populationBand: PopulationBand;
};

export type RegionOutlierBreakdown = {
  region: string;
  /** Valid monetary records in the region before the minimum-size gate. */
  cohortSize: number;
  /** Records actually used to estimate fences; zero below the minimum. */
  evaluated: number;
  excludedForDataQuality: number;
  notEvaluatedForSmallCohort: number;
  minimumReached: boolean;
  medianPerCapitaCents: number | null;
  iqrPerCapitaCents: number | null;
  above: number;
  below: number;
};

export type PopulationBandBreakdown = {
  band: PopulationBand;
  cohorts: number;
  evaluatedCohorts: number;
  cohortSize: number;
  evaluatedMunicipalities: number;
  outliers: number;
};

export type SpendingOutlierSummary = {
  metricVersion: 2;
  measure: "historical-minus-standard-spending-per-capita-cents";
  method: "tukey-iqr";
  quantileConvention: "linear-interpolation-r7";
  fenceMultiplier: number;
  minimumRegionSize: number;
  evaluatedMunicipalities: number;
  excludedForDataQuality: number;
  notEvaluatedForSmallCohort: number;
  outliers: SpendingOutlier[];
  byRegion: RegionOutlierBreakdown[];
  sensitivityByPopulationBand: PopulationBandBreakdown[];
  populationMethod: "implied-total-divided-by-per-capita";
  methodologyWarning: string;
  populationMethodWarning: string;
};

const DEFAULT_FENCE_MULTIPLIER = 1.5;
const MINIMUM_REGION_SIZE = 4;
const POPULATION_BAND_ORDER: PopulationBand[] = [
  "meno-di-1.000",
  "1.000-4.999",
  "5.000-19.999",
  "20.000-o-piu",
  "non-disponibile",
];

const WARNINGS_UNRELATED_TO_SPENDING_DIFFERENCE = new Set([
  "DIFF_OUT_PERC_TOT",
  "POSIZIONE_SPESA_PERC_TOT",
  "POSIZIONE_OUTPUT_PERC_TOT",
]);

function warningAffectsSpendingDifference(warning: string): boolean {
  const field = warning.split(":", 1)[0]?.trim();
  return !field || !WARNINGS_UNRELATED_TO_SPENDING_DIFFERENCE.has(field);
}

function quantile(sortedValues: number[], p: number): number {
  if (sortedValues.length === 1) return sortedValues[0];
  const position = p * (sortedValues.length - 1);
  const lowerIndex = Math.floor(position);
  const upperIndex = Math.ceil(position);
  if (lowerIndex === upperIndex) return sortedValues[lowerIndex];
  const weight = position - lowerIndex;
  return sortedValues[lowerIndex] * (1 - weight) + sortedValues[upperIndex] * weight;
}

function impliedPopulation(municipality: OpenCivitasMunicipality): number | null {
  const estimates = [
    municipality.historicalPerCapitaCents > 0
      ? municipality.historicalSpendingCents / municipality.historicalPerCapitaCents
      : null,
    municipality.standardPerCapitaCents > 0
      ? municipality.standardSpendingCents / municipality.standardPerCapitaCents
      : null,
  ].filter((value): value is number => value !== null && Number.isFinite(value) && value > 0);
  if (estimates.length === 0) return null;
  return Math.max(1, Math.round(estimates.reduce((sum, value) => sum + value, 0) / estimates.length));
}

function populationBand(population: number | null): PopulationBand {
  if (population === null) return "non-disponibile";
  if (population < 1_000) return "meno-di-1.000";
  if (population < 5_000) return "1.000-4.999";
  if (population < 20_000) return "5.000-19.999";
  return "20.000-o-piu";
}

function summarizeRegion(
  region: string,
  municipalities: OpenCivitasMunicipality[],
  excludedForDataQuality: number,
  fenceMultiplier: number,
): { breakdown: RegionOutlierBreakdown; outliers: SpendingOutlier[] } {
  const sorted = [...municipalities].sort(
    (left, right) => left.differencePerCapitaCents - right.differencePerCapitaCents || left.istatCode.localeCompare(right.istatCode),
  );
  const values = sorted.map((item) => item.differencePerCapitaCents);
  const q1 = quantile(values, 0.25);
  const q3 = quantile(values, 0.75);
  const iqr = q3 - q1;
  const median = quantile(values, 0.5);
  const lowerFence = q1 - fenceMultiplier * iqr;
  const upperFence = q3 + fenceMultiplier * iqr;
  const outliers: SpendingOutlier[] = [];
  let above = 0;
  let below = 0;

  for (const municipality of sorted) {
    const value = municipality.differencePerCapitaCents;
    // With zero dispersion the standard Tukey fence collapses to one point.
    // Values different from that point remain observable instead of silently
    // turning [0, 0, 0, 0, 100] into an empty result.
    const outside = value < lowerFence || value > upperFence;
    if (!outside) continue;

    const direction: OutlierDirection = value > upperFence ? "sopra" : "sotto";
    const distanceBeyondFenceCents = direction === "sopra"
      ? value - upperFence
      : lowerFence - value;
    if (direction === "sopra") above += 1;
    else below += 1;

    const population = impliedPopulation(municipality);
    outliers.push({
      istatCode: municipality.istatCode,
      name: municipality.name,
      province: municipality.province,
      region: municipality.region,
      differencePerCapitaCents: value,
      direction,
      excessMultiple: iqr > 0 ? distanceBeyondFenceCents / iqr : null,
      distanceBeyondFenceCents,
      impliedPopulation: population,
      populationBand: populationBand(population),
    });
  }

  return {
    breakdown: {
      region,
      cohortSize: municipalities.length,
      evaluated: municipalities.length,
      excludedForDataQuality,
      notEvaluatedForSmallCohort: 0,
      minimumReached: true,
      medianPerCapitaCents: median,
      iqrPerCapitaCents: iqr,
      above,
      below,
    },
    outliers,
  };
}

function populationSensitivity(
  municipalities: OpenCivitasMunicipality[],
  fenceMultiplier: number,
): PopulationBandBreakdown[] {
  return POPULATION_BAND_ORDER.map((band) => {
    const byRegion = new Map<string, OpenCivitasMunicipality[]>();
    for (const municipality of municipalities) {
      const population = impliedPopulation(municipality);
      if (populationBand(population) !== band) continue;
      const bucket = byRegion.get(municipality.region) ?? [];
      bucket.push(municipality);
      byRegion.set(municipality.region, bucket);
    }

    let evaluatedCohorts = 0;
    let cohortSize = 0;
    let evaluatedMunicipalities = 0;
    let outliers = 0;
    for (const cohort of byRegion.values()) {
      cohortSize += cohort.length;
      if (cohort.length < MINIMUM_REGION_SIZE) continue;
      evaluatedCohorts += 1;
      const result = summarizeRegion("sensitivity", cohort, 0, fenceMultiplier);
      evaluatedMunicipalities += result.breakdown.evaluated;
      outliers += result.outliers.length;
    }
    return {
      band,
      cohorts: byRegion.size,
      evaluatedCohorts,
      cohortSize,
      evaluatedMunicipalities,
      outliers,
    };
  });
}

export function computeSpendingOutliers(
  municipalities: readonly OpenCivitasMunicipality[],
  fenceMultiplier: number = DEFAULT_FENCE_MULTIPLIER,
): SpendingOutlierSummary {
  if (!Number.isFinite(fenceMultiplier) || fenceMultiplier <= 0) {
    throw new Error("fenceMultiplier deve essere un numero positivo");
  }

  const byRegion = new Map<string, { municipalities: OpenCivitasMunicipality[]; excludedForDataQuality: number }>();
  for (const municipality of municipalities) {
    const bucket = byRegion.get(municipality.region) ?? { municipalities: [], excludedForDataQuality: 0 };
    byRegion.set(municipality.region, bucket);
    if (municipality.sourceWarnings.some(warningAffectsSpendingDifference)) {
      bucket.excludedForDataQuality += 1;
    } else {
      bucket.municipalities.push(municipality);
    }
  }

  const byRegionBreakdown: RegionOutlierBreakdown[] = [];
  const outliers: SpendingOutlier[] = [];
  for (const region of [...byRegion.keys()].sort((left, right) => left.localeCompare(right, "it-IT"))) {
    const bucket = byRegion.get(region)!;
    if (bucket.municipalities.length < MINIMUM_REGION_SIZE) {
      byRegionBreakdown.push({
        region,
        cohortSize: bucket.municipalities.length,
        evaluated: 0,
        excludedForDataQuality: bucket.excludedForDataQuality,
        notEvaluatedForSmallCohort: bucket.municipalities.length,
        minimumReached: false,
        medianPerCapitaCents: null,
        iqrPerCapitaCents: null,
        above: 0,
        below: 0,
      });
      continue;
    }
    const result = summarizeRegion(region, bucket.municipalities, bucket.excludedForDataQuality, fenceMultiplier);
    byRegionBreakdown.push(result.breakdown);
    outliers.push(...result.outliers);
  }

  outliers.sort(
    (left, right) => {
      if (left.excessMultiple === null && right.excessMultiple !== null) return 1;
      if (left.excessMultiple !== null && right.excessMultiple === null) return -1;
      return (right.excessMultiple ?? 0) - (left.excessMultiple ?? 0)
        || right.distanceBeyondFenceCents - left.distanceBeyondFenceCents
        || left.istatCode.localeCompare(right.istatCode);
    },
  );
  const excludedForDataQuality = byRegionBreakdown.reduce((total, region) => total + region.excludedForDataQuality, 0);
  const evaluatedMunicipalities = byRegionBreakdown.reduce((total, region) => total + region.evaluated, 0);
  const notEvaluatedForSmallCohort = byRegionBreakdown.reduce((total, region) => total + region.notEvaluatedForSmallCohort, 0);

  return {
    metricVersion: 2,
    measure: "historical-minus-standard-spending-per-capita-cents",
    method: "tukey-iqr",
    quantileConvention: "linear-interpolation-r7",
    fenceMultiplier,
    minimumRegionSize: MINIMUM_REGION_SIZE,
    evaluatedMunicipalities,
    excludedForDataQuality,
    notEvaluatedForSmallCohort,
    outliers,
    byRegion: byRegionBreakdown,
    sensitivityByPopulationBand: populationSensitivity(
      municipalities.filter((municipality) => !municipality.sourceWarnings.some(warningAffectsSpendingDifference)),
      fenceMultiplier,
    ),
    populationMethod: "implied-total-divided-by-per-capita",
    methodologyWarning: METHODOLOGY_WARNING,
    populationMethodWarning: POPULATION_METHOD_WARNING,
  };
}
