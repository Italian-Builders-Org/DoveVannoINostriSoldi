import "server-only";

import dataArtifact from "@/data/generated/mef-tax-gap-nazionale.data.json";
import metadataArtifact from "@/data/generated/mef-tax-gap-nazionale.meta.json";
import { validateMefTaxGapNazionaleBundle } from "@/lib/data/mef-tax-gap-nazionale-contract";

const validated = validateMefTaxGapNazionaleBundle(dataArtifact, metadataArtifact);
export const mefTaxGapNazionaleData = validated.data;
export const mefTaxGapNazionaleMetadata = validated.metadata;

export type MefTaxGapNazionaleQuery = Readonly<{
  year?: number;
  tax?: string;
}>;

export function queryMefTaxGapNazionale(query: MefTaxGapNazionaleQuery = {}) {
  if (query.year !== undefined) {
    if (!Number.isSafeInteger(query.year) || query.year < 2018 || query.year > 2022) {
      throw new Error("Specificare un anno tra 2018 e 2022 (MCP: year), oppure omettere year per l'intera serie.");
    }
  }
  const allowedTaxes = new Set(mefTaxGapNazionaleData.taxRows.map((row) => row.id));
  if (query.tax !== undefined && !allowedTaxes.has(query.tax)) {
    throw new Error("Specificare un id di riga pubblicato (MCP: tax), oppure omettere tax per tutte le voci.");
  }

  let taxRows = mefTaxGapNazionaleData.taxRows;
  if (query.tax !== undefined) {
    taxRows = taxRows.filter((row) => row.id === query.tax);
  }
  if (query.year !== undefined) {
    taxRows = taxRows.map((row) => ({
      ...row,
      series: row.series.filter((item) => item.year === query.year),
    }));
    if (taxRows.some((row) => row.series.length !== 1)) {
      throw new Error("Anno richiesto assente dallo snapshot verificato.");
    }
  }

  return {
    datasetId: mefTaxGapNazionaleData.datasetId,
    geography: mefTaxGapNazionaleData.geography,
    period: mefTaxGapNazionaleData.period,
    units: mefTaxGapNazionaleData.units,
    taxRows,
    source: mefTaxGapNazionaleMetadata.source,
    pdf: mefTaxGapNazionaleMetadata.pdf,
    caveats: mefTaxGapNazionaleData.caveats,
    semantics: mefTaxGapNazionaleMetadata.semantics,
  };
}
