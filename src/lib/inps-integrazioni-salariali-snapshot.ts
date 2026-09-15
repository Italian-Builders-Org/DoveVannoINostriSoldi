import "server-only";
import { join } from "node:path";

import { readJsonSnapshot } from "@/lib/data/read-json-snapshot";
import metadataArtifact from "@/data/generated/inps-integrazioni-salariali-2023.meta.json";
import {
  validateInpsIntegrazioniSalarialiBundle,
  type InpsIntegrazioniSalarialiData,
  type InpsIntegrazioniSalarialiMetadata,
  type InpsIntegrazioniSalarialiObservation,
} from "@/lib/data/inps-integrazioni-salariali-contract";

const validated = validateInpsIntegrazioniSalarialiBundle(
  readJsonSnapshot(
    join(process.cwd(), "src/data/generated/inps-integrazioni-salariali-2023.data.json"),
    2 * 1024 * 1024,
  ),
  metadataArtifact,
);

export const inpsIntegrazioniSalarialiData: InpsIntegrazioniSalarialiData = validated.data;
export const inpsIntegrazioniSalarialiMetadata: InpsIntegrazioniSalarialiMetadata =
  validated.metadata;

const TABLE_IDS = new Set(inpsIntegrazioniSalarialiData.tables.map((table) => table.id));
const REGIONS = new Set(inpsIntegrazioniSalarialiData.observations.map((row) => row.region));
const INTERVENTION_TYPES = new Set(
  inpsIntegrazioniSalarialiData.observations.map((row) => row.interventionType),
);
const MONTHS = new Set(inpsIntegrazioniSalarialiData.observations.map((row) => row.month));

export type InpsIntegrazioniSalarialiQuery = Readonly<{
  table?: string;
  year?: number;
  month?: string;
  region?: string;
  interventionType?: string;
}>;

export type InpsIntegrazioniSalarialiQueryResult = Readonly<{
  datasetId: string;
  period: InpsIntegrazioniSalarialiData["period"];
  units: InpsIntegrazioniSalarialiData["units"];
  coverage: InpsIntegrazioniSalarialiData["coverage"];
  measures: InpsIntegrazioniSalarialiData["measures"];
  tables: InpsIntegrazioniSalarialiData["tables"];
  caveats: readonly string[];
  observations: readonly InpsIntegrazioniSalarialiObservation[];
  source: Readonly<{
    owner: string;
    landingUrl: string;
    licenseId: string;
    observedAt: string;
    distributionUsed: string;
  }>;
  semantics: InpsIntegrazioniSalarialiMetadata["semantics"];
}>;

export function queryInpsIntegrazioniSalariali(
  query: InpsIntegrazioniSalarialiQuery = {},
): InpsIntegrazioniSalarialiQueryResult {
  if (query.year !== undefined) {
    const { from, to } = inpsIntegrazioniSalarialiData.period;
    if (!Number.isSafeInteger(query.year) || query.year < from || query.year > to) {
      throw new Error(`Anno fuori dal periodo coperto (${from}).`);
    }
  }
  if (
    query.table !== undefined &&
    !TABLE_IDS.has(query.table as "lavoratori" | "domande" | "mensilita")
  ) {
    throw new Error("Tabella non riconosciuta: usare lavoratori, domande oppure mensilita.");
  }
  if (query.region !== undefined && !REGIONS.has(query.region)) {
    throw new Error("Regione non presente nello snapshot integrazioni salariali.");
  }
  if (query.month !== undefined && !MONTHS.has(query.month)) {
    throw new Error("Mese non presente nello snapshot integrazioni salariali.");
  }
  if (
    query.interventionType !== undefined &&
    !INTERVENTION_TYPES.has(
      query.interventionType as InpsIntegrazioniSalarialiObservation["interventionType"],
    )
  ) {
    throw new Error("Tipo di intervento non presente nello snapshot integrazioni salariali.");
  }

  let observations = inpsIntegrazioniSalarialiData.observations;
  if (query.table !== undefined) {
    observations = observations.filter((row) => row.table === query.table);
  }
  if (query.year !== undefined) {
    observations = observations.filter((row) => row.year === query.year);
  }
  if (query.month !== undefined) {
    observations = observations.filter((row) => row.month === query.month);
  }
  if (query.region !== undefined) {
    observations = observations.filter((row) => row.region === query.region);
  }
  if (query.interventionType !== undefined) {
    observations = observations.filter((row) => row.interventionType === query.interventionType);
  }

  return {
    datasetId: inpsIntegrazioniSalarialiData.datasetId,
    period: inpsIntegrazioniSalarialiData.period,
    units: inpsIntegrazioniSalarialiData.units,
    coverage: inpsIntegrazioniSalarialiData.coverage,
    measures: inpsIntegrazioniSalarialiData.measures,
    tables: inpsIntegrazioniSalarialiData.tables,
    caveats: inpsIntegrazioniSalarialiData.caveats,
    observations,
    source: {
      owner: inpsIntegrazioniSalarialiMetadata.source.owner,
      landingUrl: inpsIntegrazioniSalarialiMetadata.source.landingUrl,
      licenseId: inpsIntegrazioniSalarialiMetadata.source.licenseId,
      observedAt: inpsIntegrazioniSalarialiMetadata.observedAt,
      distributionUsed: inpsIntegrazioniSalarialiMetadata.source.distributionChoice.used,
    },
    semantics: inpsIntegrazioniSalarialiMetadata.semantics,
  };
}
