/**
 * Categorical fills for additive institutional compositions.
 * Product CTA colour stays out of these category tokens.
 */
export const INSTITUTIONAL_CATEGORY_COLORS = [
  "var(--chart-category-blue)",
  "var(--chart-category-teal)",
  "var(--chart-category-purple)",
  "var(--chart-category-amber)",
  "var(--chart-category-green)",
  "var(--chart-category-slate)",
] as const;

export function institutionalCategoryColor(index: number): string {
  return INSTITUTIONAL_CATEGORY_COLORS[index % INSTITUTIONAL_CATEGORY_COLORS.length]!;
}
