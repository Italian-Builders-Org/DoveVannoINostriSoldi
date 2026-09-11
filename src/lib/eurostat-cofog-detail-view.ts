import "server-only";

import type { EurostatCofogDetailParent } from "@/lib/data/eurostat-cofog-contract";
import {
  EUROSTAT_COFOG_DETAIL_LABELS,
  shareOfParentBasisPoints,
  type EurostatCofogDetailLabelCode,
} from "@/lib/eurostat-cofog-detail-labels";
import { queryEurostatCofog, queryEurostatCofogDetail } from "@/lib/eurostat-cofog-snapshot";

export function buildEurostatCofogDetailRows(parent: EurostatCofogDetailParent, year: number) {
  const parentResult = queryEurostatCofog({ geo: "IT", year, function: parent });
  const parentRow = parentResult.observations[0];
  const detailResult = queryEurostatCofogDetail(parent, year);
  if (!parentRow || detailResult.observations.length !== detailResult.functions.length) {
    throw new Error(`${parent} ${year}: dettaglio COFOG incompleto`);
  }

  return {
    parent: parentRow,
    reconciliation: detailResult.reconciliation,
    rows: detailResult.observations.map((row) => {
      const code = row.function as EurostatCofogDetailLabelCode;
      return {
        ...row,
        label: EUROSTAT_COFOG_DETAIL_LABELS[code],
        shareOfParentBasisPoints: shareOfParentBasisPoints(row.amountCents, parentRow.amountCents),
      };
    }),
  };
}
