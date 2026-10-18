import { exactEuro, integer } from "@/lib/format";

type TenderMoneyFields = {
  amountCents: number | null;
  awardAmountCents: number | null;
};

export function summarizeTenderCents(
  tenders: readonly TenderMoneyFields[],
  field: keyof Pick<TenderMoneyFields, "amountCents" | "awardAmountCents">,
): { sumKnownCents: number; missingCount: number } {
  let sumKnownCents = 0;
  let missingCount = 0;
  for (const tender of tenders) {
    const cents = tender[field];
    if (cents === null) {
      missingCount += 1;
    } else {
      sumKnownCents += cents;
    }
  }
  return { sumKnownCents, missingCount };
}

/** Totale derivato che non tratta gli importi mancanti come zero. */
export function formatDerivedTenderTotal(
  tenders: readonly TenderMoneyFields[],
  field: keyof Pick<TenderMoneyFields, "amountCents" | "awardAmountCents">,
): string {
  if (tenders.length === 0) {
    return "non disponibile";
  }
  const { sumKnownCents, missingCount } = summarizeTenderCents(tenders, field);
  if (missingCount === tenders.length) {
    return "non disponibile";
  }
  if (missingCount === 0) {
    return exactEuro(sumKnownCents / 100);
  }
  const missingLabel =
    missingCount === 1 ? "1 gara senza importo" : `${integer(missingCount)} gare senza importo`;
  return `almeno ${exactEuro(sumKnownCents / 100)} · ${missingLabel}`;
}
