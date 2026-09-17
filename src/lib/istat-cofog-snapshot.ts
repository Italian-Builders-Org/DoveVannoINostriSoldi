import "server-only";

import dataArtifact from "@/data/generated/istat-cofog-1995-2023.data.json";
import metadataArtifact from "@/data/generated/istat-cofog-1995-2023.meta.json";
import {
  validateIstatCofogBundle,
  type IstatCofogArea,
  type IstatCofogData,
  type IstatCofogFunction,
  type IstatCofogMetadata,
  type IstatCofogObservation,
} from "@/lib/data/istat-cofog-contract";

const validated = validateIstatCofogBundle(dataArtifact, metadataArtifact);

export const istatCofogData: IstatCofogData = validated.data;
export const istatCofogMetadata: IstatCofogMetadata = validated.metadata;

const AREA_CODES = new Set(istatCofogData.areas.map((area) => area.code));
const FUNCTION_CODES = new Set(istatCofogData.functions.map((entry) => entry.code));

export type IstatCofogQuery = Readonly<{ area?: string; year?: number; function?: string }>;

export type IstatCofogQueryResult = Readonly<{
  datasetId: string;
  period: IstatCofogData["period"];
  caveats: readonly string[];
  measure: IstatCofogData["measure"];
  functions: readonly IstatCofogFunction[];
  areas: readonly IstatCofogArea[];
  observations: readonly IstatCofogObservation[];
  reconciliation: IstatCofogData["reconciliation"];
  source: Readonly<{
    owner: string;
    landingUrl: string;
    dataflowId: string;
    licenseId: string;
    edition: string;
    observedAt: string;
  }>;
}>;

function normalizeYear(year: number | undefined): number | undefined {
  if (year === undefined) return undefined;
  const { from, to } = istatCofogData.period;
  if (!Number.isSafeInteger(year) || year < from || year > to) {
    throw new Error(`Anno fuori dal periodo coperto (${from}-${to}).`);
  }
  return year;
}

function normalizeArea(area: string | undefined): string | undefined {
  if (area === undefined) return undefined;
  const code = area.toUpperCase();
  if (!AREA_CODES.has(code)) {
    throw new Error("Area non riconosciuta: usare un codice territoriale ISTAT fra quelli pubblicati.");
  }
  return code;
}

function normalizeFunction(code: string | undefined): string | undefined {
  if (code === undefined) return undefined;
  const value = code.toUpperCase();
  if (!FUNCTION_CODES.has(value)) {
    throw new Error("Funzione COFOG non riconosciuta: usare G oppure G010…G100.");
  }
  return value;
}

export function queryIstatCofog(query: IstatCofogQuery = {}): IstatCofogQueryResult {
  const area = normalizeArea(query.area);
  const year = normalizeYear(query.year);
  const cofogFunction = normalizeFunction(query.function);

  const observations = istatCofogData.observations.filter(
    (observation) =>
      (area === undefined || observation.area === area) &&
      (year === undefined || observation.year === year) &&
      (cofogFunction === undefined || observation.function === cofogFunction),
  );

  return {
    datasetId: istatCofogData.datasetId,
    period: istatCofogData.period,
    caveats: istatCofogData.caveats,
    measure: istatCofogData.measure,
    functions: istatCofogData.functions,
    areas: area === undefined ? istatCofogData.areas : istatCofogData.areas.filter((entry) => entry.code === area),
    observations,
    reconciliation: istatCofogData.reconciliation,
    source: {
      owner: istatCofogMetadata.source.owner,
      landingUrl: istatCofogMetadata.source.landingUrl,
      dataflowId: istatCofogMetadata.source.dataflowId,
      licenseId: istatCofogMetadata.source.licenseId,
      edition: istatCofogData.measure.edition,
      observedAt: istatCofogMetadata.observedAt,
    },
  };
}
