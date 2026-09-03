import type { GovernmentScorecardV6ChartSlide } from "@/lib/government-scorecard-page";

export type GovernmentChartCountryId = GovernmentScorecardV6ChartSlide["series"][number]["id"];
export type GovernmentChartPoint = GovernmentScorecardV6ChartSlide["series"][number]["points"][number];

export const GOVERNMENT_CHART_COLORS: Record<GovernmentChartCountryId, string> = {
  IT: "var(--chart-country-italy)",
  FR: "var(--chart-country-france)",
  DE: "var(--chart-country-germany)",
  ES: "var(--chart-country-spain)",
};

export const GOVERNMENT_CHART_PATTERNS: Record<GovernmentChartCountryId, string | undefined> = {
  IT: undefined,
  FR: "9 4",
  DE: "3 3",
  ES: "12 3 2 3",
};

export const GOVERNMENT_CHART_MARKERS: Record<GovernmentChartCountryId, string> = {
  IT: "●",
  FR: "■",
  DE: "▲",
  ES: "◆",
};

export function formatGovernmentChartValue(value: number, unit: string): string {
  return value.toLocaleString("it-IT", {
    maximumFractionDigits: unit.startsWith("Euro") ? 0 : 2,
    minimumFractionDigits: 0,
  });
}

export function formatGovernmentChartPeriod(period: string): string {
  return period.replace("-Q", " T");
}

export function isGovernmentChartPointInWindow(
  periodStart: string,
  startDate: string,
  endDate: string,
  endExclusive: boolean,
): boolean {
  return periodStart >= startDate && (endExclusive ? periodStart < endDate : periodStart <= endDate);
}

export function splitGovernmentChartAtMissingPeriods(
  points: readonly GovernmentChartPoint[],
  periods: readonly string[],
) {
  const indexes = new Map(periods.map((period, index) => [period, index]));
  const segments: GovernmentChartPoint[][] = [];
  for (const point of points) {
    const current = segments.at(-1);
    const previous = current?.at(-1);
    if (!current || !previous || (indexes.get(point.period) ?? 0) - (indexes.get(previous.period) ?? 0) > 1) {
      segments.push([point]);
    } else {
      current.push(point);
    }
  }
  return segments;
}
