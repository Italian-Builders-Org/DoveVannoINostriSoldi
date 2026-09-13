import "server-only";

import { readFileSync } from "node:fs";
import { join } from "node:path";

import {
  validateIstatPensionsBundle,
  type IstatPensionBenefitObservation,
  type IstatPensionerObservation,
  type IstatPensionsData,
  type IstatPensionsMetadata,
} from "@/lib/data/istat-pensions-contract";

// La lettura runtime evita di inferire i tipi di tutte le righe durante il build.
// I percorsi letterali consentono a Next di includere gli snapshot nel deploy.
const DATA_PATH = join(
  process.cwd(),
  "src/data/generated/istat-pensions-2012-2022.data.json",
);
const METADATA_PATH = join(
  process.cwd(),
  "src/data/generated/istat-pensions-2012-2022.meta.json",
);

const validated = validateIstatPensionsBundle(
  JSON.parse(readFileSync(DATA_PATH, "utf8")) as unknown,
  JSON.parse(readFileSync(METADATA_PATH, "utf8")) as unknown,
);

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

/** Mantiene il default nazionale delle query esistenti; il dettaglio territoriale va richiesto. */
export type IstatPensionsQuery = Readonly<{
  year?: number;
  territory?: string;
}>;

export const ISTAT_PENSIONS_DEFAULT_TERRITORY = "IT";

const ISTAT_PENSION_TERRITORY_CODES = new Set(istatPensionsData.territories.map((entry) => entry.code));

export type IstatPensionsQueryResult = Readonly<{
  datasetId: "istat-pensions";
  period: Readonly<{ from: 2012; to: 2022 }>;
  territory: string;
  territories: IstatPensionsData["territories"];
  territorialIdentities: IstatPensionsData["territorialIdentities"];
  territorialNotes: IstatPensionsData["territorialNotes"];
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

function normalizeTerritory(territory: string | undefined): string {
  const code = (territory ?? ISTAT_PENSIONS_DEFAULT_TERRITORY).toUpperCase();
  if (!ISTAT_PENSION_TERRITORY_CODES.has(code)) {
    throw new RangeError("Territorio non riconosciuto: usare un codice fra quelli pubblicati dallo snapshot");
  }
  return code;
}

export function queryIstatPensions(query: IstatPensionsQuery = {}): IstatPensionsQueryResult {
  const year = normalizeYear(query.year);
  const territory = normalizeTerritory(query.territory);
  const matches = (row: { year: number; territory: string }) =>
    row.territory === territory && (year === undefined || row.year === year);
  const pensionBenefits = istatPensionsData.pensionBenefits.observations.filter(matches);
  const pensioners = istatPensionsData.pensioners.observations.filter(matches);
  return {
    datasetId: "istat-pensions",
    period: istatPensionsData.period,
    territory,
    territories: istatPensionsData.territories,
    territorialIdentities: istatPensionsData.territorialIdentities,
    territorialNotes: istatPensionsData.territorialNotes,
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
