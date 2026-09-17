import { createHash } from "node:crypto";

const MILLISECONDS_PER_DAY = 86_400_000;

function utcDateMilliseconds(value: string, field: string): number {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(value)) {
    throw new TypeError(`${field} deve essere una data ISO`);
  }
  const parsed = Date.parse(`${value}T00:00:00Z`);
  if (!Number.isFinite(parsed) || new Date(parsed).toISOString().slice(0, 10) !== value) {
    throw new TypeError(`${field} deve essere una data ISO valida`);
  }
  return parsed;
}

export function durationDaysV6(startDate: string, endExclusive: string): number {
  const start = utcDateMilliseconds(startDate, "start_date");
  const end = utcDateMilliseconds(endExclusive, "end_exclusive");
  if (end < start) {
    throw new RangeError("la fine esclusiva precede l'inizio");
  }
  return (end - start) / MILLISECONDS_PER_DAY;
}

type InstitutionalWindow = {
  start_date: string;
  end_exclusive: string | null;
};

export type GovernmentScorecardV6AnnualWindow = {
  reference_date_rule: "july-1";
  assigned_years: number[];
  first_year: number | null;
  last_year: number | null;
  baseline_year: number | null;
  end_year: number | null;
  observed_through: number;
};

export function deriveAnnualStatisticalWindowV6(
  government: InstitutionalWindow,
  observedThrough: number,
  asOfDate: string,
): GovernmentScorecardV6AnnualWindow {
  if (!Number.isInteger(observedThrough)) {
    throw new TypeError("observed_through deve essere un anno intero");
  }
  const start = utcDateMilliseconds(government.start_date, "start_date");
  const institutionalEndDate = government.end_exclusive ?? asOfDate;
  const institutionalEnd = utcDateMilliseconds(
    institutionalEndDate,
    government.end_exclusive === null ? "as_of_date" : "end_exclusive",
  );
  if (institutionalEnd < start) {
    throw new RangeError("la finestra istituzionale non puo' essere negativa");
  }

  const firstCandidateYear = new Date(start).getUTCFullYear();
  const finalCandidateYear = new Date(institutionalEnd).getUTCFullYear();
  const institutionalYears: number[] = [];
  for (let year = firstCandidateYear; year <= finalCandidateYear; year += 1) {
    const referenceDate = Date.UTC(year, 6, 1);
    if (referenceDate >= start && referenceDate < institutionalEnd) {
      institutionalYears.push(year);
    }
  }
  const assignedYears = institutionalYears.filter((year) => year <= observedThrough);
  const firstYear = institutionalYears[0] ?? null;
  const lastYear = institutionalYears.at(-1) ?? null;

  return {
    reference_date_rule: "july-1",
    assigned_years: assignedYears,
    first_year: firstYear,
    last_year: lastYear,
    baseline_year: firstYear === null ? null : firstYear - 1,
    end_year: assignedYears.at(-1) ?? null,
    observed_through: observedThrough,
  };
}

type ProportionalSensitivityInput = {
  start_date: string;
  end_exclusive: string;
  annual_increments: readonly { year: number; value: number }[];
};

export type GovernmentScorecardV6DayWeight = {
  year: number;
  overlap_days: number;
  days_in_year: number;
  weight: number;
};

export function hashGovernmentScorecardV6DayWeights(
  input: readonly GovernmentScorecardV6DayWeight[],
): string {
  if (input.length === 0) throw new TypeError("vettore dei pesi giornalieri vuoto");
  const years = new Set<number>();
  const canonical = input.toSorted((left, right) => left.year - right.year).map((entry) => {
    if (
      !Number.isInteger(entry.year)
      || !Number.isInteger(entry.overlap_days)
      || !Number.isInteger(entry.days_in_year)
      || !Number.isFinite(entry.weight)
      || entry.overlap_days <= 0
      || entry.overlap_days > entry.days_in_year
      || entry.weight !== entry.overlap_days / entry.days_in_year
      || years.has(entry.year)
    ) {
      throw new TypeError("vettore dei pesi giornalieri non valido o duplicato");
    }
    years.add(entry.year);
    return [
      entry.year.toString(),
      entry.overlap_days.toString(),
      entry.days_in_year.toString(),
      entry.weight.toString(),
    ];
  });
  return createHash("sha256").update(JSON.stringify(canonical)).digest("hex");
}

export function calculateProportionalDaySensitivityV6(input: ProportionalSensitivityInput): {
  temporal_operator_id: "weighted_annual_increment";
  weights: GovernmentScorecardV6DayWeight[];
  weighted_change: number;
} {
  const start = utcDateMilliseconds(input.start_date, "start_date");
  const end = utcDateMilliseconds(input.end_exclusive, "end_exclusive");
  if (end <= start) {
    throw new RangeError("lo stress temporale richiede un intervallo positivo");
  }
  const incrementByYear = new Map<number, number>();
  for (const increment of input.annual_increments) {
    if (!Number.isInteger(increment.year) || !Number.isFinite(increment.value) || incrementByYear.has(increment.year)) {
      throw new TypeError("incrementi annuali non validi o duplicati");
    }
    incrementByYear.set(increment.year, increment.value);
  }

  const firstYear = new Date(start).getUTCFullYear();
  const finalYear = new Date(end - 1).getUTCFullYear();
  const weights: GovernmentScorecardV6DayWeight[] = [];
  let weightedChange = 0;
  for (let year = firstYear; year <= finalYear; year += 1) {
    const increment = incrementByYear.get(year);
    if (increment === undefined) {
      throw new TypeError(`incremento annuale ${year} mancante`);
    }
    const yearStart = Date.UTC(year, 0, 1);
    const yearEnd = Date.UTC(year + 1, 0, 1);
    const overlapStart = Math.max(start, yearStart);
    const overlapEnd = Math.min(end, yearEnd);
    const overlapDays = (overlapEnd - overlapStart) / MILLISECONDS_PER_DAY;
    const daysInYear = (yearEnd - yearStart) / MILLISECONDS_PER_DAY;
    const weight = overlapDays / daysInYear;
    weights.push({ year, overlap_days: overlapDays, days_in_year: daysInYear, weight });
    weightedChange += weight * increment;
  }

  return {
    temporal_operator_id: "weighted_annual_increment",
    weights,
    weighted_change: weightedChange,
  };
}
