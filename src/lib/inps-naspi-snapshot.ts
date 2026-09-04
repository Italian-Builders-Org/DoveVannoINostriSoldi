import "server-only";

import dataArtifact from "@/data/generated/inps-naspi-2018-2022.data.json";
import metadataArtifact from "@/data/generated/inps-naspi-2018-2022.meta.json";
import {
  validateInpsNaspiBundle,
  type InpsNaspiData,
  type InpsNaspiMetadata,
  type InpsNaspiObservation,
  type InpsNaspiTable,
} from "@/lib/data/inps-naspi-contract";

const validated = validateInpsNaspiBundle(dataArtifact, metadataArtifact);

export const inpsNaspiData: InpsNaspiData = validated.data;
export const inpsNaspiMetadata: InpsNaspiMetadata = validated.metadata;

const TABLE_IDS = new Set(inpsNaspiData.tables.map((table) => table.id));
const TERRITORY_CODES = new Set(inpsNaspiData.observations.map((row) => row.territorio));

export type InpsNaspiQuery = Readonly<{
  table?: string;
  measure?: string;
  year?: number;
  territory?: string;
}>;

export type InpsNaspiQueryResult = Readonly<{
  datasetId: string;
  period: InpsNaspiData["period"];
  caveats: readonly string[];
  measures: InpsNaspiData["measures"];
  suppression: InpsNaspiData["suppression"];
  tables: readonly InpsNaspiTable[];
  observations: readonly InpsNaspiObservation[];
  reconciliation: InpsNaspiData["reconciliation"];
  source: Readonly<{
    owner: string;
    landingUrl: string;
    licenseId: string;
    observedAt: string;
    distributionUsed: string;
  }>;
}>;

function normalizeYear(year: number | undefined): number | undefined {
  if (year === undefined) return undefined;
  const { from, to } = inpsNaspiData.period;
  if (!Number.isSafeInteger(year) || year < from || year > to) {
    throw new Error(`Anno fuori dal periodo coperto (${from}-${to}).`);
  }
  return year;
}

function normalizeTable(table: string | undefined): string | undefined {
  if (table === undefined) return undefined;
  const id = table.toLowerCase();
  if (!TABLE_IDS.has(id)) {
    throw new Error("Tabella non riconosciuta: usare uno degli id pubblicati in tables.");
  }
  return id;
}

function normalizeMeasure(value: string | undefined): "beneficiari" | "trattamenti" | undefined {
  if (value === undefined) return undefined;
  const measure = value.toLowerCase();
  if (measure !== "beneficiari" && measure !== "trattamenti") {
    throw new Error("Misura non riconosciuta: usare beneficiari oppure trattamenti.");
  }
  return measure;
}

function normalizeTerritory(value: string | undefined): string | undefined {
  if (value === undefined) return undefined;
  const code = value.toUpperCase();
  if (!TERRITORY_CODES.has(code)) {
    throw new Error("Territorio non riconosciuto: usare un codice pubblicato nello snapshot.");
  }
  return code;
}

export function queryInpsNaspi(query: InpsNaspiQuery = {}): InpsNaspiQueryResult {
  const table = normalizeTable(query.table);
  const measure = normalizeMeasure(query.measure);
  const year = normalizeYear(query.year);
  const territory = normalizeTerritory(query.territory);

  const observations = inpsNaspiData.observations.filter(
    (row) =>
      (table === undefined || row.table === table) &&
      (measure === undefined || row.measure === measure) &&
      (year === undefined || row.year === year) &&
      (territory === undefined || row.territorio === territory),
  );

  return {
    datasetId: inpsNaspiData.datasetId,
    period: inpsNaspiData.period,
    caveats: inpsNaspiData.caveats,
    measures: inpsNaspiData.measures,
    suppression: inpsNaspiData.suppression,
    tables:
      table === undefined
        ? inpsNaspiData.tables.filter((entry) => measure === undefined || entry.measure === measure)
        : inpsNaspiData.tables.filter((entry) => entry.id === table),
    observations,
    reconciliation: inpsNaspiData.reconciliation,
    source: {
      owner: inpsNaspiMetadata.source.owner,
      landingUrl: inpsNaspiMetadata.source.landingUrl,
      licenseId: inpsNaspiMetadata.source.licenseId,
      observedAt: inpsNaspiMetadata.observedAt,
      distributionUsed: inpsNaspiMetadata.source.distributionChoice.used,
    },
  };
}
