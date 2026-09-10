import "server-only";

import {
  eurostatCofogMetadata,
  queryEurostatCofog,
  queryEurostatCofogGf01Detail,
} from "@/lib/eurostat-cofog-snapshot";
import { getPublicDebtSnapshot } from "@/lib/public-debt";

const DEFAULT_YEAR = 2024;
const DETAIL_LABELS = {
  GF0101: "Organi esecutivi e legislativi, affari finanziari e fiscali, affari esteri",
  GF0102: "Aiuti economici all’estero",
  GF0103: "Servizi generali",
  GF0104: "Ricerca di base",
  GF0105: "R&S nei servizi generali",
  GF0106: "Altri servizi generali",
  GF0107: "Operazioni sul debito pubblico",
  GF0108: "Trasferimenti generali tra livelli di governo",
} as const;

export const COFOG_MANUAL_URL =
  "https://ec.europa.eu/eurostat/web/products-manuals-and-guidelines/-/ks-gq-19-010";

function shareBasisPoints(numerator: number, denominator: number): number {
  return Number((BigInt(numerator) * BigInt(10_000) + BigInt(denominator) / BigInt(2)) / BigInt(denominator));
}
export function parseGeneralPublicServicesYear(
  value: string | string[] | undefined,
): number | null {
  if (value === undefined) return DEFAULT_YEAR;
  if (Array.isArray(value) || !/^\d{4}$/.test(value)) return null;
  const year = Number(value);
  return year >= 2014 && year <= 2024 ? year : null;
}

export function getGeneralPublicServicesView(year = DEFAULT_YEAR) {
  const parentResult = queryEurostatCofog({ geo: "IT", year, function: "GF01" });
  const totalResult = queryEurostatCofog({ geo: "IT", year, function: "TOTAL" });
  const detailResult = queryEurostatCofogGf01Detail(year);
  const parent = parentResult.observations[0];
  const publicTotal = totalResult.observations[0];
  if (!parent || !publicTotal || detailResult.observations.length !== 8) {
    throw new Error(`GF01 ${year}: snapshot incompleto`);
  }

  const detail = detailResult.observations.map((row) => ({
    ...row,
    label: DETAIL_LABELS[row.function],
    shareOfGf01BasisPoints: shareBasisPoints(row.amountCents, parent.amountCents),
  }));
  const debtTransactions = detail.find((row) => row.function === "GF0107");
  if (!debtTransactions) throw new Error(`GF01 ${year}: GF0107 assente`);
  const debtSnapshot = getPublicDebtSnapshot();
  const interest = debtSnapshot.annualInterest.history.find((row) => row.year === year) ?? null;
  const history = queryEurostatCofog({ geo: "IT", function: "GF01" }).observations.map((row) => ({
    year: row.year,
    amountCents: row.amountCents,
    shareOfGdpHundredths: row.shareOfGdpHundredths,
    flag: row.flag ?? null,
  }));

  return {
    year,
    period: parentResult.period,
    years: history.map((row) => row.year),
    parent: {
      ...parent,
      shareOfPublicSpendingBasisPoints: shareBasisPoints(parent.amountCents, publicTotal.amountCents),
    },
    publicTotalCents: publicTotal.amountCents,
    detail,
    debtTransactions,
    interestComparison: interest === null ? null : {
      year,
      interestExpenseCents: interest.interestExpenseCents,
      debtTransactionsCents: debtTransactions.amountCents,
      differenceCents: debtTransactions.amountCents - interest.interestExpenseCents,
    },
    history,
    flags: parentResult.flags,
    caveats: parentResult.caveats,
    source: {
      owner: eurostatCofogMetadata.source.owner,
      datasetCode: eurostatCofogMetadata.source.datasetCode,
      datasetLabel: eurostatCofogMetadata.source.datasetLabel,
      landingUrl: eurostatCofogMetadata.source.landingUrl,
      termsUrl: eurostatCofogMetadata.source.termsUrl,
      assets: eurostatCofogMetadata.source.assets,
      publicationDate: eurostatCofogMetadata.semantics.provenance.publicationDate,
      acquisitionDate: eurostatCofogMetadata.semantics.provenance.acquisitionDate,
      checkedAt: eurostatCofogMetadata.semantics.provenance.checkedAt,
      license: eurostatCofogMetadata.semantics.provenance.license,
      dataArtifactSha256: eurostatCofogMetadata.integrity.dataArtifact.sha256,
    },
    semantics: eurostatCofogMetadata.semantics,
    detailReconciliation: detailResult.reconciliation,
  };
}

export type GeneralPublicServicesView = ReturnType<typeof getGeneralPublicServicesView>;
