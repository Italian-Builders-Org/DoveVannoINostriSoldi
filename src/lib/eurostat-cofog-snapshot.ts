import "server-only";

import dataArtifact from "@/data/generated/eurostat-cofog-2014-2024.data.json";
import metadataArtifact from "@/data/generated/eurostat-cofog-2014-2024.meta.json";
import {
  validateEurostatCofogBundle,
  type EurostatCofogData,
  type EurostatCofogFunction,
  type EurostatCofogGeography,
  type EurostatCofogMetadata,
  type EurostatCofogObservation,
} from "@/lib/data/eurostat-cofog-contract";

const validated = validateEurostatCofogBundle(dataArtifact, metadataArtifact);

export const eurostatCofogData: EurostatCofogData = validated.data;
export const eurostatCofogMetadata: EurostatCofogMetadata = validated.metadata;

const GEOGRAPHY_CODES = new Set(eurostatCofogData.geographies.map((geography) => geography.code));
const FUNCTION_CODES = new Set(eurostatCofogData.functions.map((entry) => entry.code));

export type EurostatCofogQuery = Readonly<{
  geo?: string;
  year?: number;
  function?: string;
}>;

export type EurostatCofogQueryResult = Readonly<{
  datasetId: string;
  period: EurostatCofogData["period"];
  caveats: readonly string[];
  units: EurostatCofogData["units"];
  flags: EurostatCofogData["flags"];
  functions: readonly EurostatCofogFunction[];
  geographies: readonly EurostatCofogGeography[];
  observations: readonly EurostatCofogObservation[];
  reconciliation: EurostatCofogData["reconciliation"];
  source: Readonly<{
    owner: string;
    landingUrl: string;
    licenseId: string;
    datasetCode: string;
    publicationDate: string;
    coverageNote: string;
  }>;
}>;

function normalizeYear(year: number | undefined): number | undefined {
  if (year === undefined) return undefined;
  const { from, to } = eurostatCofogData.period;
  if (!Number.isSafeInteger(year) || year < from || year > to) {
    throw new Error(`Anno fuori dal periodo coperto (${from}-${to}).`);
  }
  return year;
}

function normalizeGeo(geo: string | undefined): string | undefined {
  if (geo === undefined) return undefined;
  const code = geo.toUpperCase();
  if (!GEOGRAPHY_CODES.has(code)) {
    throw new Error("Geografia non riconosciuta: usare un codice Eurostat fra quelli pubblicati.");
  }
  return code;
}

function normalizeFunction(code: string | undefined): string | undefined {
  if (code === undefined) return undefined;
  const value = code.toUpperCase();
  if (!FUNCTION_CODES.has(value)) {
    throw new Error("Funzione COFOG non riconosciuta: usare TOTAL oppure GF01…GF10.");
  }
  return value;
}

export function queryEurostatCofog(query: EurostatCofogQuery = {}): EurostatCofogQueryResult {
  const geo = normalizeGeo(query.geo);
  const year = normalizeYear(query.year);
  const cofogFunction = normalizeFunction(query.function);

  const observations = eurostatCofogData.observations.filter(
    (observation) =>
      (geo === undefined || observation.geo === geo) &&
      (year === undefined || observation.year === year) &&
      (cofogFunction === undefined || observation.function === cofogFunction),
  );

  return {
    datasetId: eurostatCofogData.datasetId,
    period: eurostatCofogData.period,
    caveats: eurostatCofogData.caveats,
    units: eurostatCofogData.units,
    flags: eurostatCofogData.flags,
    functions: eurostatCofogData.functions,
    geographies: geo === undefined
      ? eurostatCofogData.geographies
      : eurostatCofogData.geographies.filter((geography) => geography.code === geo),
    observations,
    reconciliation: eurostatCofogData.reconciliation,
    source: {
      owner: eurostatCofogMetadata.source.owner,
      landingUrl: eurostatCofogMetadata.source.landingUrl,
      licenseId: eurostatCofogMetadata.source.licenseId,
      datasetCode: eurostatCofogMetadata.source.datasetCode,
      publicationDate: eurostatCofogMetadata.semantics.provenance.publicationDate,
      coverageNote: eurostatCofogMetadata.coverage.note,
    },
  };
}
