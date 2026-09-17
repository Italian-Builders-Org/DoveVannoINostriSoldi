import type { Benchmark, EvidenceAmount, EvidencePeriod } from "./public-spending-evidence-contract";

export type BenchmarkMember = {
  observationId: string;
  valueCents: number;
  category: string;
  period: EvidencePeriod;
  taxBasis: EvidenceAmount["taxBasis"];
  unit: EvidenceAmount["unit"];
  denominator: Benchmark["denominator"];
};

export type BenchmarkInput = {
  cohortId: string;
  cohortLabel: string;
  targetObservationId: string;
  members: BenchmarkMember[];
};

function quantileR7(sortedValues: readonly number[], probability: number): number {
  const position = probability * (sortedValues.length - 1);
  const lower = Math.floor(position);
  const upper = Math.ceil(position);
  if (lower === upper) return sortedValues[lower];
  return sortedValues[lower] * (upper - position) + sortedValues[upper] * (position - lower);
}

function samePeriod(left: EvidencePeriod, right: EvidencePeriod): boolean {
  return left.start === right.start && left.end === right.end && left.precision === right.precision;
}

function sameDenominator(left: Benchmark["denominator"], right: Benchmark["denominator"]): boolean {
  return left.name === right.name && left.value === right.value && left.unit === right.unit;
}

export function computePublicSpendingBenchmark(input: BenchmarkInput): Benchmark {
  if (input.members.length < 3) throw new Error("benchmark: almeno tre osservazioni richieste");
  const target = input.members.find((member) => member.observationId === input.targetObservationId);
  if (!target) throw new Error("benchmark: osservazione target assente dalla coorte");
  if (new Set(input.members.map((member) => member.observationId)).size !== input.members.length) {
    throw new Error("benchmark: observationId duplicato");
  }

  for (const member of input.members) {
    if (
      member.category !== target.category ||
      !samePeriod(member.period, target.period) ||
      member.taxBasis !== target.taxBasis ||
      member.unit !== target.unit ||
      !sameDenominator(member.denominator, target.denominator)
    ) {
      throw new Error("benchmark: coorte non like-for-like");
    }
    if (!Number.isSafeInteger(member.valueCents) || member.valueCents < 0) {
      throw new Error("benchmark: importo in centesimi non valido");
    }
  }

  const sortedValues = input.members.map((member) => member.valueCents).sort((a, b) => a - b);
  const medianCents = quantileR7(sortedValues, 0.5);
  const targetDeltaCents = target.valueCents - medianCents;

  return {
    cohortId: input.cohortId,
    cohortLabel: input.cohortLabel,
    category: target.category,
    period: target.period,
    taxBasis: target.taxBasis,
    unit: target.unit,
    denominator: target.denominator,
    method: "linear_interpolation_r7",
    cohortSize: input.members.length,
    medianCents,
    p25Cents: quantileR7(sortedValues, 0.25),
    p75Cents: quantileR7(sortedValues, 0.75),
    targetDeltaCents,
    targetDeltaPercent: medianCents === 0 ? null : (targetDeltaCents / medianCents) * 100,
    observationIds: input.members.map((member) => member.observationId),
  };
}
