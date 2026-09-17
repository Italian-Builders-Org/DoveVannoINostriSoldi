import rawSnapshot from "@/data/generated/opencoesione-overview.json";
import {
  assertOpenCoesioneSnapshot,
  paymentCostRatio,
  type OpenCoesioneDimension,
  type OpenCoesioneSnapshot,
} from "@/lib/data/opencoesione-contract";

/**
 * The scheduled ETL validates this file before committing it. Re-validating at
 * module load protects local builds and makes schema drift fail closed.
 */
export const openCoesioneSnapshot: OpenCoesioneSnapshot =
  assertOpenCoesioneSnapshot(rawSnapshot);

export const openCoesionePaymentCostRatio = paymentCostRatio(openCoesioneSnapshot);

export type OpenCoesioneDimensionMetrics = OpenCoesioneDimension & {
  publicCostShare: number;
  paymentCostRatio: number;
  averagePublicCostCents: number | null;
  costPaymentDifferenceCents: number;
};

/** Derived ratios stay reconstructible from the versioned official snapshot. */
export function deriveOpenCoesioneDimension(
  dimension: OpenCoesioneDimension,
  nationalPublicCostCents: number,
): OpenCoesioneDimensionMetrics {
  return {
    ...dimension,
    publicCostShare:
      nationalPublicCostCents > 0 ? dimension.publicCostCents / nationalPublicCostCents : 0,
    paymentCostRatio:
      dimension.publicCostCents > 0
        ? dimension.paymentsCents / dimension.publicCostCents
        : 0,
    averagePublicCostCents:
      dimension.projects > 0
        ? Math.round(dimension.publicCostCents / dimension.projects)
        : null,
    costPaymentDifferenceCents: dimension.publicCostCents - dimension.paymentsCents,
  };
}
