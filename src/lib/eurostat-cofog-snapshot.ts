import "server-only";

import dataArtifact from "@/data/generated/eurostat-cofog-2014-2024.data.json";
import metadataArtifact from "@/data/generated/eurostat-cofog-2014-2024.meta.json";
import {
  validateEurostatCofogBundle,
  type EurostatCofogData,
  type EurostatCofogDetailFunction,
  type EurostatCofogDetailObservation,
  type EurostatCofogDetailParent,
  type EurostatCofogFunction,
  type EurostatCofogGeography,
  type EurostatCofogMetadata,
  type EurostatCofogObservation,
} from "@/lib/data/eurostat-cofog-contract";

const validated = validateEurostatCofogBundle(dataArtifact, metadataArtifact);

export const eurostatCofogData: EurostatCofogData = validated.data;
export const eurostatCofogMetadata: EurostatCofogMetadata = validated.metadata;

const GEOGRAPHY_CODES = new Set(eurostatCofogData.geographies.map((entry) => entry.code));
const FUNCTION_CODES = new Set(eurostatCofogData.functions.map((entry) => entry.code));
const DETAIL_PARENTS = new Set(Object.keys(eurostatCofogData.details));

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

export type EurostatCofogDetailQueryResult = Readonly<{
  datasetId: string;
  parentFunction: EurostatCofogDetailParent;
  geo: "IT";
  period: EurostatCofogData["period"];
  functions: readonly EurostatCofogDetailFunction[];
  observations: readonly EurostatCofogDetailObservation[];
  reconciliation: EurostatCofogData["details"][EurostatCofogDetailParent]["reconciliation"];
  source: Readonly<{
    owner: string;
    landingUrl: string;
    datasetCode: string;
    publicationDate: string;
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

function normalizeDetailParent(parent: string): EurostatCofogDetailParent {
  const value = parent.toUpperCase();
  if (!DETAIL_PARENTS.has(value)) {
    throw new Error("Dettaglio COFOG non pubblicato: usare GF01, GF02, GF03 o GF08.");
  }
  return value as EurostatCofogDetailParent;
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
      : eurostatCofogData.geographies.filter((entry) => entry.code === geo),
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

export function queryEurostatCofogDetail(
  parent: EurostatCofogDetailParent | string,
  year?: number,
): EurostatCofogDetailQueryResult {
  const parentFunction = normalizeDetailParent(parent);
  const selectedYear = normalizeYear(year);
  const detail = eurostatCofogData.details[parentFunction];
  return {
    datasetId: eurostatCofogData.datasetId,
    parentFunction: detail.parentFunction,
    geo: detail.geo,
    period: eurostatCofogData.period,
    functions: detail.functions,
    observations: detail.observations.filter(
      (observation) => selectedYear === undefined || observation.year === selectedYear,
    ),
    reconciliation: detail.reconciliation,
    source: {
      owner: eurostatCofogMetadata.source.owner,
      landingUrl: eurostatCofogMetadata.source.landingUrl,
      datasetCode: eurostatCofogMetadata.source.datasetCode,
      publicationDate: eurostatCofogMetadata.semantics.provenance.publicationDate,
    },
  };
}

/** @deprecated Prefer queryEurostatCofogDetail("GF01", year). Kept for existing GF01 callers. */
export function queryEurostatCofogGf01Detail(year?: number): EurostatCofogDetailQueryResult {
  return queryEurostatCofogDetail("GF01", year);
}
