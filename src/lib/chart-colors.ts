/**
 * Categorical series colours.
 *
 * The accent leads, then the neutral ramp carries the rest: a chart should
 * read as one accented series against supporting context, not as a rainbow
 * competing with the tricolour in the header.
 */
export const CHART_COLORS = [
  "var(--chart-primary)",
  "var(--chart-secondary)",
  "var(--chart-tertiary)",
  "var(--color-accent-2)",
  "var(--color-neutral-700)",
  "var(--chart-quinary)",
] as const;

export function chartColor(index: number): string {
  return CHART_COLORS[index % CHART_COLORS.length]!;
}
