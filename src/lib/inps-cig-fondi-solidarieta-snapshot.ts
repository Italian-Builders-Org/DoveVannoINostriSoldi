import "server-only";
import { join } from "node:path";

import { readJsonSnapshot } from "@/lib/data/read-json-snapshot";
import metadataArtifact from "@/data/generated/inps-cig-fondi-solidarieta-2023-2024.meta.json";
import {
  validateInpsCigFondiSolidarietaBundle,
  type InpsCigFondiSolidarietaData,
  type InpsCigFondiSolidarietaMetadata,
  type InpsCigFondiSolidarietaObservation,
} from "@/lib/data/inps-cig-fondi-solidarieta-contract";

const validated = validateInpsCigFondiSolidarietaBundle(
  readJsonSnapshot(
    join(process.cwd(), "src/data/generated/inps-cig-fondi-solidarieta-2023-2024.data.json"),
    2 * 1024 * 1024,
  ),
  metadataArtifact,
);

export const inpsCigFondiSolidarietaData: InpsCigFondiSolidarietaData = validated.data;
export const inpsCigFondiSolidarietaMetadata: InpsCigFondiSolidarietaMetadata =
  validated.metadata;

const REGIONS = new Set(inpsCigFondiSolidarietaData.observations.map((row) => row.region));
const MONTHS = new Set(inpsCigFondiSolidarietaData.observations.map((row) => row.month));
const FUND_MANAGEMENTS = new Set(
  inpsCigFondiSolidarietaData.observations.map((row) => row.fundManagement),
);
const SECTORS = new Set(inpsCigFondiSolidarietaData.observations.map((row) => row.sector));

export type InpsCigFondiSolidarietaQuery = Readonly<{
  year?: number;
  month?: string;
  region?: string;
  fundManagement?: string;
  sector?: string;
}>;

export type InpsCigFondiSolidarietaQueryResult = Readonly<{
  datasetId: string;
  period: InpsCigFondiSolidarietaData["period"];
  units: InpsCigFondiSolidarietaData["units"];
  coverage: InpsCigFondiSolidarietaData["coverage"];
  measures: InpsCigFondiSolidarietaData["measures"];
  caveats: readonly string[];
  observations: readonly InpsCigFondiSolidarietaObservation[];
  source: Readonly<{
    owner: string;
    landingUrl: string;
    licenseId: string;
    observedAt: string;
    distributionUsed: string;
  }>;
  semantics: InpsCigFondiSolidarietaMetadata["semantics"];
}>;

export function queryInpsCigFondiSolidarieta(
  query: InpsCigFondiSolidarietaQuery = {},
): InpsCigFondiSolidarietaQueryResult {
  if (query.year !== undefined) {
    const { from, to } = inpsCigFondiSolidarietaData.period;
    if (!Number.isSafeInteger(query.year) || query.year < from || query.year > to) {
      throw new Error(`Anno fuori dal periodo coperto (${from}-${to}).`);
    }
  }
  if (query.region !== undefined && !REGIONS.has(query.region)) {
    throw new Error("Regione non presente nello snapshot CIG Fondi di Solidarietà.");
  }
  if (query.month !== undefined && !MONTHS.has(query.month)) {
    throw new Error("Mese non presente nello snapshot CIG Fondi di Solidarietà.");
  }
  if (
    query.fundManagement !== undefined &&
    !FUND_MANAGEMENTS.has(
      query.fundManagement as InpsCigFondiSolidarietaObservation["fundManagement"],
    )
  ) {
    throw new Error("Gestione fondi non presente nello snapshot CIG Fondi di Solidarietà.");
  }
  if (
    query.sector !== undefined &&
    !SECTORS.has(query.sector as InpsCigFondiSolidarietaObservation["sector"])
  ) {
    throw new Error("Ramo di attività non presente nello snapshot CIG Fondi di Solidarietà.");
  }

  let observations = inpsCigFondiSolidarietaData.observations;
  if (query.year !== undefined) {
    observations = observations.filter((row) => row.year === query.year);
  }
  if (query.month !== undefined) {
    observations = observations.filter((row) => row.month === query.month);
  }
  if (query.region !== undefined) {
    observations = observations.filter((row) => row.region === query.region);
  }
  if (query.fundManagement !== undefined) {
    observations = observations.filter((row) => row.fundManagement === query.fundManagement);
  }
  if (query.sector !== undefined) {
    observations = observations.filter((row) => row.sector === query.sector);
  }

  return {
    datasetId: inpsCigFondiSolidarietaData.datasetId,
    period: inpsCigFondiSolidarietaData.period,
    units: inpsCigFondiSolidarietaData.units,
    coverage: inpsCigFondiSolidarietaData.coverage,
    measures: inpsCigFondiSolidarietaData.measures,
    caveats: inpsCigFondiSolidarietaData.caveats,
    observations,
    source: {
      owner: inpsCigFondiSolidarietaMetadata.source.owner,
      landingUrl: inpsCigFondiSolidarietaMetadata.source.landingUrl,
      licenseId: inpsCigFondiSolidarietaMetadata.source.licenseId,
      observedAt: inpsCigFondiSolidarietaMetadata.observedAt,
      distributionUsed: inpsCigFondiSolidarietaMetadata.source.distributionChoice.used,
    },
    semantics: inpsCigFondiSolidarietaMetadata.semantics,
  };
}
