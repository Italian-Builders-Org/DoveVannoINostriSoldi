import "server-only";

import type {
  AnacConcentrationDimension,
  AnacEntityProcurementPageView,
} from "@/lib/data/anac-entity-procurement-page";

export type AnacConcentrationSelection = "top1" | "top10" | "all";

/** Select the same operators and award relations used by the published metric. */
export function selectAnacConcentrationAwards(
  profile: Pick<AnacEntityProcurementPageView, "operators" | "awards" | "concentration">,
  dimension: AnacConcentrationDimension,
  selection: AnacConcentrationSelection,
) {
  const metric = profile.concentration[dimension];
  if (metric.status === "withheld") return null;
  const limit = selection === "top1" ? 1 : selection === "top10" ? metric.includedTop : metric.operatorCount;
  const operators = profile.operators.filter((operator) => {
    const rank = dimension === "value" ? operator.rankByValue : operator.rankByCount;
    return rank !== null && rank <= limit;
  });
  const refs = new Set(operators.map((operator) => operator.ref));
  const awards = profile.awards.filter((award) => {
    if (!award.operatorRefs.some((ref) => refs.has(ref))) return false;
    return dimension === "count" || (award.attribution === "single-operator"
      && (award.amountStatus === "positive-exact-cent" || award.amountStatus === "positive-subcent"));
  });
  // A multipart award is displayed once, but can contribute several count relations.
  const relationCount = awards.reduce((sum, award) => sum + award.operatorRefs.filter((ref) => refs.has(ref)).length, 0);
  return {
    metric,
    selection,
    operators,
    awards,
    relationCount,
    weight: selection === "top1" ? metric.top1Amount : selection === "top10" ? metric.top10Amount : metric.marketTotal,
  };
}

export type AnacConcentrationDrilldown = NonNullable<ReturnType<typeof selectAnacConcentrationAwards>>;
