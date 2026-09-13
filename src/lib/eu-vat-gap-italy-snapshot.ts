import "server-only";

import dataArtifact from "@/data/generated/eu-vat-gap-italy.data.json";
import metadataArtifact from "@/data/generated/eu-vat-gap-italy.meta.json";
import { validateEuVatGapItalyBundle } from "@/lib/data/eu-vat-gap-italy-contract";

const validated = validateEuVatGapItalyBundle(dataArtifact, metadataArtifact);
export const euVatGapItalyData = validated.data;
export const euVatGapItalyMetadata = validated.metadata;

export type EuVatGapItalyQuery = Readonly<{
  year?: number;
}>;

export function queryEuVatGapItaly(query: EuVatGapItalyQuery = {}) {
  if (query.year !== undefined) {
    if (!Number.isSafeInteger(query.year) || query.year < 2019 || query.year > 2024) {
      throw new Error("Specificare un anno tra 2019 e 2024 (MCP: year), oppure omettere year per l'intera serie.");
    }
  }
  const years = query.year === undefined
    ? euVatGapItalyData.years
    : euVatGapItalyData.years.filter((row) => row.year === query.year);
  if (query.year !== undefined && years.length !== 1) {
    throw new Error("Anno richiesto assente dallo snapshot verificato.");
  }
  return {
    datasetId: euVatGapItalyData.datasetId,
    geography: euVatGapItalyData.geography,
    period: euVatGapItalyData.period,
    units: euVatGapItalyData.units,
    years,
    gapChangeSince2019: euVatGapItalyData.gapChangeSince2019,
    source: euVatGapItalyMetadata.source,
    caveats: euVatGapItalyData.caveats,
    semantics: euVatGapItalyMetadata.semantics,
  };
}
