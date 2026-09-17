import "server-only";

import dataArtifact from "@/data/generated/mef-iva-2024-2025.data.json";
import metadataArtifact from "@/data/generated/mef-iva-2024-2025.meta.json";
import { validateMefIvaBundle } from "@/lib/data/mef-iva-contract";

const validated = validateMefIvaBundle(dataArtifact, metadataArtifact);
export const mefIvaData = validated.data;
export const mefIvaMetadata = validated.metadata;

export type MefIvaQuery = Readonly<{
  /** Anno di dichiarazione, distinto dall'anno di imposta. */
  year?: number;
  breakdown?: string;
  limit?: number;
  offset?: number;
}>;

export function queryMefIva(query: MefIvaQuery = {}) {
  if (query.year !== 2024 && query.year !== 2025) {
    throw new Error("Specificare anno di dichiarazione 2024 oppure 2025 (MCP: year).");
  }
  if (query.breakdown !== "regione" && query.breakdown !== "attivita") {
    throw new Error("Specificare taglio regione oppure attivita (MCP: breakdown).");
  }
  const limit = query.limit ?? 50;
  const offset = query.offset ?? 0;
  if (!Number.isSafeInteger(limit) || limit < 1 || limit > 100 ||
      !Number.isSafeInteger(offset) || offset < 0 || offset > 100_000) {
    throw new Error("Paginazione non valida: limit 1-100, offset 0-100000.");
  }
  const selected = mefIvaData.tables.find((table) => table.declarationYear === query.year && table.breakdown === query.breakdown)!;
  const { rows: allRows, ...table } = selected;
  const rows = allRows.slice(offset, offset + limit);
  return {
    datasetId: mefIvaData.datasetId,
    table,
    rows,
    pagination: {
      limit, offset, totalRows: allRows.length, returnedRows: rows.length,
      nextOffset: offset + rows.length < allRows.length ? offset + rows.length : null,
    },
    source: mefIvaMetadata.source,
    caveats: mefIvaData.caveats,
    semantics: mefIvaMetadata.semantics,
  };
}
