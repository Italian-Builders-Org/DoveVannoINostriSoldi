import { decimal, integer } from "@/lib/format";

export type StaffChartPoint = Readonly<{
  year: number;
  permanent: number;
  flexible: number;
}>;

export type StaffPeakSummary = Readonly<{
  peakPermanent: number;
  peakYear: number;
  deltaPeak: number;
}>;

/** When permanent dominates, flexible needs its own axis to stay readable. */
export function staffChartUsesDualAxis(points: readonly StaffChartPoint[]): boolean {
  if (points.length === 0) return false;
  const maxPermanent = Math.max(...points.map((point) => point.permanent));
  const maxFlexible = Math.max(...points.map((point) => point.flexible));
  if (maxFlexible <= 0) return false;
  return maxPermanent / maxFlexible >= 8;
}

export function staffChartAxisTicks(maxValue: number, tickCount = 5): number[] {
  const safeMax = Math.max(0, maxValue);
  if (safeMax === 0) return [0];
  const roughStep = safeMax / Math.max(1, tickCount - 1);
  const magnitude = 10 ** Math.floor(Math.log10(roughStep));
  const step = Math.ceil(roughStep / magnitude) * magnitude;
  const ceiling = Math.ceil(safeMax / step) * step;
  const ticks: number[] = [];
  for (let value = 0; value <= ceiling + step / 2; value += step) {
    ticks.push(value);
  }
  return ticks;
}

export function formatStaffAxisTick(value: number, kind: "permanent" | "flexible"): string {
  if (!Number.isFinite(value)) return "Non disponibile";
  if (kind === "permanent") return integer(Math.round(value));
  return Number.isInteger(value) ? integer(value) : decimal(value, 2);
}

/** Recharts YAxis width: Italian grouped thousands need room so ticks are not clipped. */
export function staffChartPermanentAxisWidth(maxPermanent: number): number {
  if (maxPermanent >= 1_000_000) return 92;
  if (maxPermanent >= 100_000) return 80;
  if (maxPermanent >= 10_000) return 72;
  return 56;
}

export function staffChartFlexibleAxisWidth(maxFlexible: number): number {
  if (maxFlexible >= 100_000) return 76;
  if (maxFlexible >= 10_000) return 68;
  return 56;
}

export function toStaffChartPoints(
  points: readonly Readonly<{ year: number; permanent: number; flexible: number }>[],
): StaffChartPoint[] {
  return points.map((point) => ({
    year: point.year,
    permanent: point.permanent,
    flexible: point.flexible,
  }));
}

export function computeStaffPeakSummary(points: readonly StaffChartPoint[]): StaffPeakSummary {
  if (points.length === 0) {
    return { peakPermanent: 0, peakYear: 0, deltaPeak: 0 };
  }
  let peak = points[0]!;
  for (const point of points) {
    if (point.permanent > peak.permanent) peak = point;
  }
  const latest = points.at(-1)!;
  return {
    peakPermanent: peak.permanent,
    peakYear: peak.year,
    deltaPeak: latest.permanent - peak.permanent,
  };
}
