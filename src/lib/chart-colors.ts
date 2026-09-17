/**
 * Categorical series colours.
 *
 * The accent leads, then the neutral ramp carries the rest: a chart should
 * read as one accented series against supporting context, not as a rainbow
 * competing with the tricolour in the header.
 */
export const CHART_COLORS = [
  "#ec3013",
  "#444141",
  "#9b9797",
  "#ef6853",
  "#605d5d",
  "#ffc4b8",
] as const;

export function chartColor(index: number): string {
  return CHART_COLORS[index % CHART_COLORS.length];
}
