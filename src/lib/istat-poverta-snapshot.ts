import "server-only";

import dataArtifact from "@/data/generated/istat-poverta-assoluta-2014-2024.data.json";
import metadataArtifact from "@/data/generated/istat-poverta-assoluta-2014-2024.meta.json";
import {
  validateIstatPovertaBundle,
  type IstatPovertaData,
  type IstatPovertaMeasure,
  type IstatPovertaMetadata,
  type IstatPovertaObservation,
  type IstatPovertaTerritory,
} from "@/lib/data/istat-poverta-contract";

const validated = validateIstatPovertaBundle(dataArtifact, metadataArtifact);

export const istatPovertaData: IstatPovertaData = validated.data;
export const istatPovertaMetadata: IstatPovertaMetadata = validated.metadata;

const TERRITORY_CODES = new Set(istatPovertaData.territories.map((entry) => entry.code));
const MEASURE_CODES = new Set(istatPovertaData.measures.map((entry) => entry.code));

export type IstatPovertaQuery = Readonly<{ territory?: string; year?: number; measure?: string }>;

export type IstatPovertaQueryResult = Readonly<{
  datasetId: string;
  period: IstatPovertaData["period"];
  caveats: readonly string[];
  scale: IstatPovertaData["scale"];
  flags: IstatPovertaData["flags"];
  measures: readonly IstatPovertaMeasure[];
  territories: readonly IstatPovertaTerritory[];
  observations: readonly IstatPovertaObservation[];
  reconciliation: IstatPovertaData["reconciliation"];
  source: Readonly<{
    owner: string;
    landingUrl: string;
    dataflowId: string;
    licenseId: string;
    seriesNote: string;
    observedAt: string;
  }>;
}>;

function normalizeYear(year: number | undefined): number | undefined {
  if (year === undefined) return undefined;
  const { from, to } = istatPovertaData.period;
  if (!Number.isSafeInteger(year) || year < from || year > to) {
    throw new Error(`Anno fuori dal periodo coperto (${from}-${to}).`);
  }
  return year;
}

function normalizeTerritory(territory: string | undefined): string | undefined {
  if (territory === undefined) return undefined;
  const code = territory.toUpperCase();
  if (!TERRITORY_CODES.has(code)) {
    throw new Error(
      "Territorio non riconosciuto: la povertà assoluta è pubblicata solo per Italia e ripartizioni (IT, ITC, ITCD, ITD, ITE, ITF, ITFG, ITG).",
    );
  }
  return code;
}

function normalizeMeasure(measure: string | undefined): string | undefined {
  if (measure === undefined) return undefined;
  const code = measure.toUpperCase();
  if (!MEASURE_CODES.has(code)) {
    throw new Error(
      "Misura non riconosciuta: usare uno dei codici assoluti pubblicati, per esempio INCID_POVASS_FAM.",
    );
  }
  return code;
}

export function queryIstatPovertaAssoluta(query: IstatPovertaQuery = {}): IstatPovertaQueryResult {
  const territory = normalizeTerritory(query.territory);
  const year = normalizeYear(query.year);
  const measure = normalizeMeasure(query.measure);

  const observations = istatPovertaData.observations.filter(
    (observation) =>
      (territory === undefined || observation.territory === territory) &&
      (year === undefined || observation.year === year) &&
      (measure === undefined || observation.measure === measure),
  );

  return {
    datasetId: istatPovertaData.datasetId,
    period: istatPovertaData.period,
    caveats: istatPovertaData.caveats,
    scale: istatPovertaData.scale,
    flags: istatPovertaData.flags,
    // Le misure restano tutte esposte anche quando se ne filtra una: unità e
    // sommabilità dichiarate servono a leggere il numero, non solo a trovarlo.
    measures: measure === undefined
      ? istatPovertaData.measures
      : istatPovertaData.measures.filter((entry) => entry.code === measure),
    territories: territory === undefined
      ? istatPovertaData.territories
      : istatPovertaData.territories.filter((entry) => entry.code === territory),
    observations,
    reconciliation: istatPovertaData.reconciliation,
    source: {
      owner: istatPovertaMetadata.source.owner,
      landingUrl: istatPovertaMetadata.source.landingUrl,
      dataflowId: istatPovertaMetadata.source.dataflowId,
      licenseId: istatPovertaMetadata.source.licenseId,
      seriesNote: istatPovertaMetadata.source.seriesNote,
      observedAt: istatPovertaMetadata.observedAt,
    },
  };
}
