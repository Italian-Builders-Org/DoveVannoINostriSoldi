import "server-only";

import dataArtifact from "@/data/generated/eurostat-sha-health-2014-2025.data.json";
import metadataArtifact from "@/data/generated/eurostat-sha-health-2014-2025.meta.json";
import {
  EUROSTAT_SHA_SCHEMES,
  validateEurostatShaHealthBundle,
} from "@/lib/data/eurostat-sha-health-contract";

const validated = validateEurostatShaHealthBundle(dataArtifact, metadataArtifact);
export const eurostatShaHealthData = validated.data;
export const eurostatShaHealthMetadata = validated.metadata;

export type EurostatShaHealthQuery = Readonly<{
  year?: number;
  scheme?: string;
}>;

const HIGHLIGHT_SCHEMES = ["TOT_HF", "HF1", "HF11", "HF2", "HF3"] as const;

export function queryEurostatShaHealth(query: EurostatShaHealthQuery = {}) {
  if (query.year !== undefined) {
    if (!Number.isSafeInteger(query.year) || query.year < 2014 || query.year > 2025) {
      throw new Error("Specificare un anno tra 2014 e 2025 (MCP: year), oppure omettere year per l'intera serie.");
    }
  }
  if (query.scheme !== undefined) {
    if (!(EUROSTAT_SHA_SCHEMES as readonly string[]).includes(query.scheme)) {
      throw new Error("Specificare uno schema SHA pubblicato (MCP: code), oppure omettere code.");
    }
  }

  let observations = eurostatShaHealthData.observations;
  if (query.year !== undefined) {
    observations = observations.filter((row) => row.year === query.year);
  }
  if (query.scheme !== undefined) {
    observations = observations.filter((row) => row.scheme === query.scheme);
  }

  return {
    datasetId: eurostatShaHealthData.datasetId,
    geography: eurostatShaHealthData.geography,
    period: eurostatShaHealthData.period,
    units: eurostatShaHealthData.units,
    schemes: eurostatShaHealthData.schemes,
    observations,
    coverage: {
      ...eurostatShaHealthData.coverage,
      returnedCells: observations.length,
    },
    source: eurostatShaHealthMetadata.source,
    caveats: eurostatShaHealthData.caveats,
    semantics: eurostatShaHealthMetadata.semantics,
  };
}

/** Compact view for /spese/sanita: highlight schemes only, never mixed with CE SSN. */
export function getEurostatShaHealthPanel(year: number = eurostatShaHealthData.period.to) {
  if (!Number.isSafeInteger(year) || year < 2014 || year > 2025) {
    throw new Error("Anno SHA fuori dal periodo pubblicato.");
  }
  const rows = HIGHLIGHT_SCHEMES.map((scheme) => {
    const observation = eurostatShaHealthData.observations.find(
      (row) => row.scheme === scheme && row.year === year,
    );
    if (!observation) {
      throw new Error(`Cella SHA mancante: ${scheme}/${year}`);
    }
    return observation;
  });
  return {
    year,
    provisional: year === 2025,
    rows,
    source: eurostatShaHealthMetadata.source,
    caveats: eurostatShaHealthData.caveats,
    apiPath: `/api/sanita/sha?anno=${year}`,
  };
}
