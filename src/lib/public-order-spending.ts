import "server-only";

import { buildEurostatCofogDetailRows } from "@/lib/eurostat-cofog-detail-view";
import {
  eurostatCofogData,
  eurostatCofogMetadata,
  queryEurostatCofog,
} from "@/lib/eurostat-cofog-snapshot";

export const PUBLIC_ORDER_FUNCTION = "GF03";

/** Reject absent coverage and ambiguous query parameters instead of changing the year silently. */
export function parsePublicOrderYear(value: string | string[] | undefined): number | null {
  if (value === undefined) return eurostatCofogData.period.to;
  if (typeof value !== "string" || !/^\d{4}$/.test(value)) return null;
  const year = Number(value);
  return year >= eurostatCofogData.period.from && year <= eurostatCofogData.period.to ? year : null;
}

export function getPublicOrderSpendingView(year: number = eurostatCofogData.period.to) {
  // Both queries cross the existing validated snapshot boundary. TOTAL is the
  // published denominator, never a reconstruction from rounded COFOG divisions.
  const spending = queryEurostatCofog({ geo: "IT", function: PUBLIC_ORDER_FUNCTION });
  const totals = new Map(queryEurostatCofog({ geo: "IT", function: "TOTAL" })
    .observations.map((point) => [point.year, point]));
  const history = spending.observations.toSorted((a, b) => a.year - b.year).map((point) => {
    const total = totals.get(point.year);
    if (!total || total.amountCents <= 0) {
      throw new Error(`Totale della spesa PA non disponibile per ${point.year}.`);
    }
    return {
      year: point.year,
      amountEuro: point.amountCents / 100,
      gdpSharePercent: point.shareOfGdpHundredths / 100,
      publicSpendingSharePercent: point.amountCents / total.amountCents * 100,
      flag: point.flag,
      denominatorFlag: total.flag,
    };
  });
  const selected = history.find((point) => point.year === year);
  if (!selected) throw new Error("Anno non disponibile per la spesa di ordine pubblico e sicurezza.");
  const detail = buildEurostatCofogDetailRows("GF03", year);
  return {
    selected,
    history,
    detail: detail.rows,
    detailReconciliation: detail.reconciliation,
    period: spending.period,
    flags: spending.flags,
    source: eurostatCofogMetadata.source,
    semantics: eurostatCofogMetadata.semantics,
    integrity: eurostatCofogMetadata.integrity,
    caveats: spending.caveats,
  };
}
