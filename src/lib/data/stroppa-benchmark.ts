import type { BenchmarkComparability } from "@/lib/data/stroppa-evidence-contract";

export type BenchmarkCandidate = {
  id: string;
  amountCents: number;
  comparability: BenchmarkComparability;
};

export type BenchmarkComputation = {
  quantileConvention: "linear_interpolation_r7";
  count: number;
  medianCents: number;
  p25Cents: number;
  p75Cents: number;
  p90Cents: number;
  observedCents: number;
  deltaCents: number;
  relativeDeltaBasisPoints: number | null;
};

function quantileR7(sortedValues: readonly number[], probability: number): number {
  const position = probability * (sortedValues.length - 1);
  const lower = Math.floor(position);
  const upper = Math.ceil(position);
  if (lower === upper) return sortedValues[lower];
  const weight = position - lower;
  return Math.round(sortedValues[lower] * (1 - weight) + sortedValues[upper] * weight);
}

function comparabilityKey(value: BenchmarkComparability): string {
  return JSON.stringify([
    value.categoryTaxonomy,
    value.categoryValue,
    value.periodKey,
    value.periodPrecision,
    value.amountPhase,
    value.taxTreatment,
    value.unit,
    value.procurementScope,
    value.geography,
  ]);
}

export function computeLikeForLikeBenchmark(
  observed: BenchmarkCandidate,
  cohort: readonly BenchmarkCandidate[],
  minimumCohortSize = 5,
): BenchmarkComputation {
  if (!Number.isSafeInteger(minimumCohortSize) || minimumCohortSize < 4) {
    throw new Error("minimumCohortSize: intero almeno pari a 4 atteso");
  }
  const ids = cohort.map((candidate) => candidate.id);
  if (new Set(ids).size !== ids.length) throw new Error("coorte: ID duplicati");
  if (cohort.length < minimumCohortSize) throw new Error("coorte sotto la soglia minima");
  const expectedKey = comparabilityKey(observed.comparability);
  for (const candidate of [observed, ...cohort]) {
    if (!Number.isSafeInteger(candidate.amountCents) || candidate.amountCents < 0) {
      throw new Error(`${candidate.id}: importo in centesimi non valido`);
    }
    if (comparabilityKey(candidate.comparability) !== expectedKey) {
      throw new Error(`${candidate.id}: confronto non like-for-like`);
    }
  }
  const values = cohort.map((candidate) => candidate.amountCents).sort((left, right) => left - right);
  const medianCents = quantileR7(values, 0.5);
  const deltaCents = observed.amountCents - medianCents;
  return {
    quantileConvention: "linear_interpolation_r7",
    count: values.length,
    medianCents,
    p25Cents: quantileR7(values, 0.25),
    p75Cents: quantileR7(values, 0.75),
    p90Cents: quantileR7(values, 0.9),
    observedCents: observed.amountCents,
    deltaCents,
    relativeDeltaBasisPoints: medianCents > 0
      ? Math.round((10_000 * deltaCents) / medianCents)
      : null,
  };
}
