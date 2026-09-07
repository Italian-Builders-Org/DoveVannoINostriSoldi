import "server-only";

import dataArtifact from "@/data/generated/istat-bes-economico-2004-2024.data.json";
import metadataArtifact from "@/data/generated/istat-bes-economico-2004-2024.meta.json";
import {
  validateIstatBesBundle,
  type IstatBesData,
  type IstatBesIndicator,
  type IstatBesMetadata,
  type IstatBesObservation,
  type IstatBesTerritory,
} from "@/lib/data/istat-bes-contract";

const validated = validateIstatBesBundle(dataArtifact, metadataArtifact);

export const istatBesData: IstatBesData = validated.data;
export const istatBesMetadata: IstatBesMetadata = validated.metadata;

const TERRITORY_CODES = new Set(istatBesData.territories.map((entry) => entry.code));
const INDICATOR_CODES = new Set(istatBesData.indicators.map((entry) => entry.code));
const SEX_CODES = new Set(istatBesData.sexes);

export type IstatBesQuery = Readonly<{
  territory?: string;
  year?: number;
  indicator?: string;
  sex?: string;
}>;

export type IstatBesQueryResult = Readonly<{
  datasetId: string;
  period: IstatBesData["period"];
  periodNote: string;
  caveats: readonly string[];
  scale: IstatBesData["scale"];
  domain: IstatBesData["domain"];
  flags: IstatBesData["flags"];
  indicators: readonly IstatBesIndicator[];
  territories: readonly IstatBesTerritory[];
  observations: readonly IstatBesObservation[];
  reconciliation: IstatBesData["reconciliation"];
  source: Readonly<{
    owner: string;
    landingUrl: string;
    dataflowId: string;
    licenseId: string;
    edition: string;
    observedAt: string;
  }>;
}>;

function normalizeYear(value: number | undefined): number | undefined {
  if (value === undefined) return undefined;
  const { from, to } = istatBesData.period;
  if (!Number.isSafeInteger(value) || value < from || value > to) {
    throw new Error(`Anno fuori dal periodo coperto (${from}-${to}).`);
  }
  return value;
}

function normalizeTerritory(value: string | undefined): string | undefined {
  if (value === undefined) return undefined;
  const code = value.toUpperCase();
  if (!TERRITORY_CODES.has(code)) {
    throw new Error("Territorio non riconosciuto: usare un codice ISTAT fra quelli pubblicati.");
  }
  return code;
}

function normalizeIndicator(value: string | undefined): string | undefined {
  if (value === undefined) return undefined;
  const code = value.toUpperCase();
  if (!INDICATOR_CODES.has(code)) {
    throw new Error("Indicatore non riconosciuto: usare un codice BES del dominio, per esempio 04BEC002P.");
  }
  return code;
}

function normalizeSex(value: string | undefined): string | undefined {
  if (value === undefined) return undefined;
  const code = value.toUpperCase();
  if (!SEX_CODES.has(code as IstatBesData["sexes"][number])) {
    throw new Error("Sesso non riconosciuto: usare F, M oppure T.");
  }
  return code;
}

export function queryIstatBes(query: IstatBesQuery = {}): IstatBesQueryResult {
  const territory = normalizeTerritory(query.territory);
  const year = normalizeYear(query.year);
  const indicator = normalizeIndicator(query.indicator);
  const sex = normalizeSex(query.sex);

  const observations = istatBesData.observations.filter(
    (observation) =>
      (territory === undefined || observation.territory === territory) &&
      (year === undefined || observation.year === year) &&
      (indicator === undefined || observation.indicator === indicator) &&
      (sex === undefined || observation.sex === sex),
  );

  return {
    datasetId: istatBesData.datasetId,
    period: istatBesData.period,
    // Il periodo complessivo non vale per ogni indicatore: la nota viaggia col dato.
    periodNote: istatBesData.periodNote,
    caveats: istatBesData.caveats,
    scale: istatBesData.scale,
    domain: istatBesData.domain,
    flags: istatBesData.flags,
    indicators:
      indicator === undefined
        ? istatBesData.indicators
        : istatBesData.indicators.filter((entry) => entry.code === indicator),
    territories:
      territory === undefined
        ? istatBesData.territories
        : istatBesData.territories.filter((entry) => entry.code === territory),
    observations,
    reconciliation: istatBesData.reconciliation,
    source: {
      owner: istatBesMetadata.source.owner,
      landingUrl: istatBesMetadata.source.landingUrl,
      dataflowId: istatBesMetadata.source.dataflowId,
      licenseId: istatBesMetadata.source.licenseId,
      edition: istatBesData.domain.edition,
      observedAt: istatBesMetadata.observedAt,
    },
  };
}
