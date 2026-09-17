import "server-only";

import dataArtifact from "@/data/generated/eurostat-taxag-2014-2025.data.json";
import metadataArtifact from "@/data/generated/eurostat-taxag-2014-2025.meta.json";
import {
  EUROSTAT_TAXAG_PUBLISHED_ITEMS,
  EUROSTAT_TAXAG_SECTORS,
  validateEurostatTaxagBundle,
} from "@/lib/data/eurostat-taxag-contract";

const validated = validateEurostatTaxagBundle(dataArtifact, metadataArtifact);
export const eurostatTaxagData = validated.data;
export const eurostatTaxagMetadata = validated.metadata;

export type EurostatTaxagQuery = Readonly<{
  year?: number;
  sector?: string;
  tax?: string;
}>;

export function queryEurostatTaxag(query: EurostatTaxagQuery = {}) {
  if (query.year !== undefined) {
    if (!Number.isSafeInteger(query.year) || query.year < 2014 || query.year > 2025) {
      throw new Error("Specificare un anno tra 2014 e 2025 (MCP: year), oppure omettere year per l'intera serie.");
    }
  }
  if (query.sector !== undefined) {
    if (!(EUROSTAT_TAXAG_SECTORS as readonly string[]).includes(query.sector)) {
      throw new Error("Specificare un settore ESA S13, S1311, S1313 o S1314 (MCP: sector), oppure omettere sector.");
    }
  }
  if (query.tax !== undefined) {
    if (!(EUROSTAT_TAXAG_PUBLISHED_ITEMS as readonly string[]).includes(query.tax)) {
      throw new Error("Specificare un codice na_item pubblicato (MCP: tax), oppure omettere tax per tutte le voci.");
    }
  }

  let observations = eurostatTaxagData.observations;
  if (query.year !== undefined) {
    observations = observations.filter((row) => row.year === query.year);
  }
  if (query.sector !== undefined) {
    observations = observations.filter((row) => row.sector === query.sector);
  }
  if (query.tax !== undefined) {
    observations = observations.filter((row) => row.naItem === query.tax);
  }

  return {
    datasetId: eurostatTaxagData.datasetId,
    geography: eurostatTaxagData.geography,
    period: eurostatTaxagData.period,
    units: eurostatTaxagData.units,
    items: eurostatTaxagData.items,
    sectors: eurostatTaxagData.sectors,
    observations,
    coverage: {
      ...eurostatTaxagData.coverage,
      returnedCells: observations.length,
      returnedObserved: observations.filter((row) => row.status === "observed").length,
    },
    source: eurostatTaxagMetadata.source,
    caveats: eurostatTaxagData.caveats,
    semantics: eurostatTaxagMetadata.semantics,
  };
}
