import "server-only";
import { readJsonSnapshot } from "@/lib/data/read-json-snapshot";
import { join } from "node:path";
import metadataArtifact from "@/data/generated/istat-poverta-regioni-2014-2024.meta.json";
import { validateIstatPovertaRegioniBundle } from "@/lib/data/istat-poverta-regioni-contract";

export const ISTAT_POVERTA_REGIONI_DATA_PATH =
  "src/data/generated/istat-poverta-regioni-2014-2024.data.json";

const dataArtifact = readJsonSnapshot(
  join(process.cwd(), ISTAT_POVERTA_REGIONI_DATA_PATH),
  256 * 1024,
);
const validated = validateIstatPovertaRegioniBundle(dataArtifact, metadataArtifact);
export const istatPovertaRegioniData = validated.data;
export const istatPovertaRegioniMetadata = validated.metadata;

export type IstatPovertaRegioniQuery = Readonly<{
  territory?: string;
  measure?: string;
  year?: number;
  limit?: number;
  offset?: number;
}>;

/** Both HTTP and MCP consume this validated regional-incidence selector. */
export function queryIstatPovertaRegioni(
  query: IstatPovertaRegioniQuery = {},
  options: { signal?: AbortSignal } = {},
) {
  options.signal?.throwIfAborted();
  const data = istatPovertaRegioniData;
  const territory = query.territory?.toUpperCase();
  const measure = query.measure?.toLowerCase();
  const year = query.year;
  const limit = query.limit ?? 100;
  const offset = query.offset ?? 0;

  if (territory === undefined && measure === undefined && year === undefined) {
    throw new Error("Specificare almeno un filtro fra territorio, misura e anno.");
  }
  if (territory !== undefined && !data.territories.some((entry) => entry.code === territory)) {
    throw new Error("Territorio non riconosciuto: usare i codici ISTAT, per esempio ITC4 per la Lombardia.");
  }
  if (measure !== undefined && !data.measures.some((entry) => entry.key === measure)) {
    throw new Error("Misura non riconosciuta: usare households oppure individuals.");
  }
  if (year !== undefined && (!Number.isSafeInteger(year) || year < data.period.from || year > data.period.to)) {
    throw new Error("Anno fuori dal periodo coperto (2014–2024).");
  }
  if (
    !Number.isSafeInteger(limit) || limit < 1 || limit > 100
    || !Number.isSafeInteger(offset) || offset < 0 || offset > 100_000
  ) {
    throw new Error("Usare limit fra 1 e 100 e offset fra 0 e 100000, entrambi interi.");
  }

  const selects = <T extends { territory: string; measure: string; year: number }>(row: T) =>
    (territory === undefined || row.territory === territory)
    && (measure === undefined || row.measure === measure)
    && (year === undefined || row.year === year);

  const matches = data.observations.filter(selects);
  const observations = matches.slice(offset, offset + limit);
  const hasMore = offset + observations.length < matches.length;
  return {
    datasetId: data.datasetId,
    domain: data.domain,
    period: data.period,
    periodNote: data.periodNote,
    scale: data.scale,
    flags: data.flags,
    caveats: data.caveats,
    reconciliation: data.reconciliation,
    ratioBounds: data.ratioBounds,
    source: istatPovertaRegioniMetadata.source,
    semantics: istatPovertaRegioniMetadata.semantics,
    measures: data.measures.filter((entry) => measure === undefined || entry.key === measure),
    territories: data.territories.filter((entry) => territory === undefined || entry.code === territory),
    observations,
    // Le assenze viaggiano con i valori: chi legge la selezione vede anche cosa non c'è, e perché.
    undiffused: data.undiffused.filter(selects),
    missingRows: data.missingRows.filter(selects),
    pagination: {
      total: matches.length,
      returned: observations.length,
      limit,
      offset,
      hasMore,
      nextOffset: hasMore ? offset + observations.length : null,
    },
  };
}
