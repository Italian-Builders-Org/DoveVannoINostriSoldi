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
const DETAIL_CODE_TO_PARENT = new Map<string, EurostatCofogDetailParent>(
  (Object.keys(eurostatCofogData.details) as EurostatCofogDetailParent[]).flatMap((parent) =>
    eurostatCofogData.details[parent].functions.map((entry) => [entry.code, parent] as const),
  ),
);

const SOURCE_SUMMARY = {
  owner: eurostatCofogMetadata.source.owner,
  landingUrl: eurostatCofogMetadata.source.landingUrl,
  licenseId: eurostatCofogMetadata.source.licenseId,
  datasetCode: eurostatCofogMetadata.source.datasetCode,
  publicationDate: eurostatCofogMetadata.semantics.provenance.publicationDate,
  coverageNote: eurostatCofogMetadata.coverage.note,
} as const;

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

export type EurostatCofogSubfunctionQueryResult = Readonly<{
  datasetId: string;
  level: "subfunction";
  parentFunction: EurostatCofogDetailParent;
  period: EurostatCofogData["period"];
  caveats: readonly string[];
  units: EurostatCofogData["units"];
  flags: EurostatCofogData["flags"];
  functions: readonly EurostatCofogDetailFunction[];
  geographies: readonly EurostatCofogGeography[];
  observations: readonly EurostatCofogDetailObservation[];
  reconciliation: EurostatCofogData["details"][EurostatCofogDetailParent]["reconciliation"];
  source: EurostatCofogQueryResult["source"];
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
    throw new Error(
      "Funzione COFOG non riconosciuta: usare TOTAL, una divisione GF01…GF10 oppure, per l’Italia, una sottofunzione da GF0101 a GF1009.",
    );
  }
  return value;
}

function normalizeDetailParent(parent: string): EurostatCofogDetailParent {
  const value = parent.toUpperCase();
  if (!DETAIL_PARENTS.has(value)) {
    throw new Error("Dettaglio COFOG non pubblicato: usare una divisione da GF01 a GF10.");
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
    source: SOURCE_SUMMARY,
  };
}

/**
 * Superficie pubblica di API e MCP: totale e divisioni per ogni geografia, oppure
 * una sottofunzione di secondo livello. Il secondo livello è pubblicato solo per
 * l’Italia, quindi un altro paese viene rifiutato invece di restituire zero righe.
 */
export function queryEurostatCofogPublic(
  query: EurostatCofogQuery = {},
): EurostatCofogQueryResult | EurostatCofogSubfunctionQueryResult {
  const code = query.function?.toUpperCase();
  const parent = code === undefined ? undefined : DETAIL_CODE_TO_PARENT.get(code);
  if (code === undefined || parent === undefined) {
    return queryEurostatCofog(query);
  }
  const geo = normalizeGeo(query.geo);
  if (geo !== undefined && geo !== "IT") {
    throw new Error("Le sottofunzioni COFOG sono pubblicate solo per l’Italia: usare il paese IT.");
  }
  const year = normalizeYear(query.year);
  const detail = eurostatCofogData.details[parent];
  return {
    datasetId: eurostatCofogData.datasetId,
    level: "subfunction",
    parentFunction: detail.parentFunction,
    period: eurostatCofogData.period,
    caveats: eurostatCofogData.caveats,
    units: eurostatCofogData.units,
    flags: eurostatCofogData.flags,
    functions: detail.functions.filter((entry) => entry.code === code),
    geographies: eurostatCofogData.geographies.filter((entry) => entry.code === "IT"),
    observations: detail.observations.filter(
      (observation) => observation.function === code && (year === undefined || observation.year === year),
    ),
    reconciliation: detail.reconciliation,
    source: SOURCE_SUMMARY,
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
