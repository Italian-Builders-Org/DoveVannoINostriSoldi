export const GOVERNMENT_SCORECARD_V6_CHART_VIEWBOX = {
  width: 760,
  height: 340,
  left: 62,
  right: 18,
  top: 22,
  bottom: 48,
} as const;

export function getClosestGovernmentChartPointIndex(
  pointCount: number,
  svgX: number,
): number | null {
  if (!Number.isInteger(pointCount) || pointCount <= 0) return null;
  if (pointCount === 1) return 0;

  const plotWidth = GOVERNMENT_SCORECARD_V6_CHART_VIEWBOX.width
    - GOVERNMENT_SCORECARD_V6_CHART_VIEWBOX.left
    - GOVERNMENT_SCORECARD_V6_CHART_VIEWBOX.right;
  const ratio = Math.min(
    1,
    Math.max(0, (svgX - GOVERNMENT_SCORECARD_V6_CHART_VIEWBOX.left) / plotWidth),
  );
  return Math.round(ratio * (pointCount - 1));
}
