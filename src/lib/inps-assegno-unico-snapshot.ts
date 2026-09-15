import "server-only";
import { join } from "node:path";

import { readJsonSnapshot } from "@/lib/data/read-json-snapshot";
import metadataArtifact from "@/data/generated/inps-assegno-unico-2022-2024.meta.json";
import {
  validateInpsAssegnoUnicoBundle,
  type InpsAssegnoUnicoData,
  type InpsAssegnoUnicoMetadata,
  type InpsAssegnoUnicoObservation,
} from "@/lib/data/inps-assegno-unico-contract";

const validated = validateInpsAssegnoUnicoBundle(
  readJsonSnapshot(
    join(process.cwd(), "src/data/generated/inps-assegno-unico-2022-2024.data.json"),
    3 * 1024 * 1024,
  ),
  metadataArtifact,
);

export const inpsAssegnoUnicoData: InpsAssegnoUnicoData = validated.data;
export const inpsAssegnoUnicoMetadata: InpsAssegnoUnicoMetadata = validated.metadata;

const TABLE_IDS = new Set(inpsAssegnoUnicoData.tables.map((table) => table.id));
const PROVINCES = new Set(inpsAssegnoUnicoData.observations.map((row) => row.province));
const REGIONS = new Set(inpsAssegnoUnicoData.observations.map((row) => row.region));

export type InpsAssegnoUnicoQuery = Readonly<{
  table?: string;
  year?: number;
  province?: string;
  region?: string;
}>;

export type InpsAssegnoUnicoQueryResult = Readonly<{
  datasetId: string;
  period: InpsAssegnoUnicoData["period"];
  units: InpsAssegnoUnicoData["units"];
  coverage: InpsAssegnoUnicoData["coverage"];
  measures: InpsAssegnoUnicoData["measures"];
  tables: InpsAssegnoUnicoData["tables"];
  nucleiChildrenColumn: InpsAssegnoUnicoData["nucleiChildrenColumn"];
  caveats: readonly string[];
  observations: readonly InpsAssegnoUnicoObservation[];
  source: Readonly<{
    owner: string;
    landingUrl: string;
    licenseId: string;
    observedAt: string;
    distributionUsed: string;
  }>;
  semantics: InpsAssegnoUnicoMetadata["semantics"];
}>;

export function queryInpsAssegnoUnico(query: InpsAssegnoUnicoQuery = {}): InpsAssegnoUnicoQueryResult {
  if (query.year !== undefined) {
    const { from, to } = inpsAssegnoUnicoData.period;
    if (!Number.isSafeInteger(query.year) || query.year < from || query.year > to) {
      throw new Error(`Anno fuori dal periodo coperto (${from}-${to}).`);
    }
  }
  if (query.table !== undefined && !TABLE_IDS.has(query.table as "nuclei" | "figli_disabilita")) {
    throw new Error("Tabella non riconosciuta: usare nuclei oppure figli_disabilita.");
  }
  if (query.province !== undefined && !PROVINCES.has(query.province)) {
    throw new Error("Provincia non presente nello snapshot Assegno Unico.");
  }
  if (query.region !== undefined && !REGIONS.has(query.region)) {
    throw new Error("Regione non presente nello snapshot Assegno Unico.");
  }

  let observations = inpsAssegnoUnicoData.observations;
  if (query.table !== undefined) {
    observations = observations.filter((row) => row.table === query.table);
  }
  if (query.year !== undefined) {
    observations = observations.filter((row) => row.year === query.year);
  }
  if (query.province !== undefined) {
    observations = observations.filter((row) => row.province === query.province);
  }
  if (query.region !== undefined) {
    observations = observations.filter((row) => row.region === query.region);
  }

  return {
    datasetId: inpsAssegnoUnicoData.datasetId,
    period: inpsAssegnoUnicoData.period,
    units: inpsAssegnoUnicoData.units,
    coverage: inpsAssegnoUnicoData.coverage,
    measures: inpsAssegnoUnicoData.measures,
    tables: inpsAssegnoUnicoData.tables,
    nucleiChildrenColumn: inpsAssegnoUnicoData.nucleiChildrenColumn,
    caveats: inpsAssegnoUnicoData.caveats,
    observations,
    source: {
      owner: inpsAssegnoUnicoMetadata.source.owner,
      landingUrl: inpsAssegnoUnicoMetadata.source.landingUrl,
      licenseId: inpsAssegnoUnicoMetadata.source.licenseId,
      observedAt: inpsAssegnoUnicoMetadata.observedAt,
      distributionUsed: inpsAssegnoUnicoMetadata.source.distributionChoice.used,
    },
    semantics: inpsAssegnoUnicoMetadata.semantics,
  };
}
