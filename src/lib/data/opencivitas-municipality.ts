// Shared read model for the nine independently verified FC60/FC70 indicators.
export const MUNICIPALITY_COLUMNS = [
  "istatCode",
  "name",
  "province",
  "region",
  "historicalSpendingCents",
  "standardSpendingCents",
  "differenceCents",
  "historicalPerCapitaCents",
  "standardPerCapitaCents",
  "differencePerCapitaCents",
  "differenceBasisPoints",
  "serviceDifferenceBasisPoints",
  "spendingLevel",
  "serviceLevel",
  "spendingAssessmentReason",
  "servicesAssessmentReason",
  "sourceWarnings",
] as const;

export type OpenCivitasMunicipality = {
  istatCode: string;
  name: string;
  province: string;
  region: string;
  historicalSpendingCents: number;
  standardSpendingCents: number;
  differenceCents: number;
  historicalPerCapitaCents: number;
  standardPerCapitaCents: number;
  differencePerCapitaCents: number;
  differenceBasisPoints: number;
  serviceDifferenceBasisPoints: number | null;
  spendingLevel: number | null;
  serviceLevel: number | null;
  spendingAssessmentReason: string | null;
  servicesAssessmentReason: string | null;
  sourceWarnings: string[];
};
