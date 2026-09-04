import "server-only";

import dataArtifact from "@/data/generated/istat-pensions-2012-2022.data.json";
import metadataArtifact from "@/data/generated/istat-pensions-2012-2022.meta.json";
import {
  validateIstatPensionsBundle,
  type IstatPensionBenefitObservation,
  type IstatPensionerObservation,
  type IstatPensionsData,
  type IstatPensionsMetadata,
} from "@/lib/data/istat-pensions-contract";

const validated = validateIstatPensionsBundle(dataArtifact, metadataArtifact);

export const istatPensionsData: IstatPensionsData = validated.data;
export const istatPensionsMetadata: IstatPensionsMetadata = validated.metadata;

export type IstatPensionSource = Readonly<{
  id: string;
  title: string;
  url: string;
  sha256: string;
  observedAt: string;
  period: Readonly<{ from: 2012; to: 2022 }>;
}>;

export const istatPensionsSources: readonly IstatPensionSource[] = [
  istatPensionsMetadata.source.assets.pensionBenefits,
  istatPensionsMetadata.source.assets.pensioners,
].map((asset) => ({
  id: asset.id,
  title: asset.title,
  url: asset.url,
  sha256: asset.sha256,
  observedAt: asset.observedAt,
  period: asset.referencePeriod,
}));

export const istatPensionsSnapshot = { ...validated, sources: istatPensionsSources };

export type IstatPensionsQuery = Readonly<{
  year?: number;
}>;

export type IstatPensionsQueryResult = Readonly<{
  datasetId: "istat-pensions";
  period: Readonly<{ from: 2012; to: 2022 }>;
  pensionBenefits: readonly IstatPensionBenefitObservation[];
  pensioners: readonly IstatPensionerObservation[];
  sources: readonly IstatPensionSource[];
  provenance: Readonly<{
    owner: "Istat";
    sourceLockSha256: string;
    assets: IstatPensionsMetadata["source"]["assets"];
  }>;
  caveats: IstatPensionsData["caveats"];
}>;

function normalizeYear(year: number | undefined): number | undefined {
  if (year === undefined) return undefined;
  if (!Number.isInteger(year) || year < 2012 || year > 2022) {
    throw new RangeError("L'anno ISTAT pensioni deve essere un intero tra 2012 e 2022");
  }
  return year;
}

export function queryIstatPensions(query: IstatPensionsQuery = {}): IstatPensionsQueryResult {
  const year = normalizeYear(query.year);
  const pensionBenefits = year === undefined
    ? istatPensionsData.pensionBenefits.observations
    : istatPensionsData.pensionBenefits.observations.filter((row) => row.year === year);
  const pensioners = year === undefined
    ? istatPensionsData.pensioners.observations
    : istatPensionsData.pensioners.observations.filter((row) => row.year === year);
  return {
    datasetId: "istat-pensions",
    period: istatPensionsData.period,
    pensionBenefits,
    pensioners,
    sources: istatPensionsSources,
    provenance: {
      owner: istatPensionsMetadata.source.owner,
      sourceLockSha256: istatPensionsMetadata.integrity.sourceLockSha256,
      assets: istatPensionsMetadata.source.assets,
    },
    caveats: istatPensionsData.caveats,
  };
}
