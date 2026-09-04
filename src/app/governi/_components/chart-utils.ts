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

export function formatGovernmentChartPublicationStatus(
  status: GovernmentChartPoint["status"],
): string {
  if (status === "provisional") return " · provvisorio";
  if (status === "estimated") return " · stimato";
  return "";
}

export function formatGovernmentChartPointStatus(
  point: Pick<GovernmentChartPoint, "status" | "quality_notes">,
): string {
  const labels = [
    formatGovernmentChartPublicationStatus(point.status).replace(/^ · /, ""),
    ...(point.quality_notes ?? []),
  ].filter(Boolean);
  return labels.length === 0 ? "" : ` · ${labels.join(", ")}`;
}

export function hasGovernmentChartTrend(periods: readonly string[]): boolean {
  return new Set(periods).size >= 2;
}

function governmentChartPeriodEndExclusive(
  periodStart: string,
  frequency: GovernmentScorecardV6ChartSlide["frequency"],
): string {
  const end = new Date(`${periodStart}T00:00:00Z`);
  if (Number.isNaN(end.getTime())) throw new Error(`periodo del grafico non valido: ${periodStart}`);

  if (frequency === "Annuale") end.setUTCFullYear(end.getUTCFullYear() + 1);
  else if (frequency === "Trimestrale") end.setUTCMonth(end.getUTCMonth() + 3);
  else end.setUTCMonth(end.getUTCMonth() + 1);

  return end.toISOString().slice(0, 10);
}

export function isGovernmentChartStartBoundaryPeriod(
  periodStart: string,
  startDate: string,
  frequency: GovernmentScorecardV6ChartSlide["frequency"],
): boolean {
  return periodStart <= startDate
    && startDate < governmentChartPeriodEndExclusive(periodStart, frequency);
}

export function isGovernmentChartPointInWindow(
  periodStart: string,
  startDate: string,
  endDate: string,
  endExclusive: boolean,
  frequency: GovernmentScorecardV6ChartSlide["frequency"] = "Mensile",
): boolean {
  if (isGovernmentChartStartBoundaryPeriod(periodStart, startDate, frequency)) return true;

  const referenceDate = frequency === "Annuale"
    ? `${periodStart.slice(0, 4)}-07-01`
    : periodStart;
  return referenceDate >= startDate && (endExclusive ? referenceDate < endDate : periodStart <= endDate);
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
