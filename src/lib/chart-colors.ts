export const CHART_COLORS = [
  "#4fa3d1",
  "#43b69a",
  "#e3b65a",
  "#d97979",
  "#9c83d3",
  "#7fb36e",
] as const;

export function chartColor(index: number): string {
  return CHART_COLORS[index % CHART_COLORS.length];
}
