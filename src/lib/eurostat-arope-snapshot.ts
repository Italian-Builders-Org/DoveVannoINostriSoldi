import "server-only";
import { readJsonSnapshot } from "@/lib/data/read-json-snapshot";
import { join } from "node:path";
import metadataArtifact from "@/data/generated/eurostat-arope-2015-2025.meta.json";
import { validateEurostatAropeBundle } from "@/lib/data/eurostat-arope-contract";

export const EUROSTAT_AROPE_DATA_PATH = "src/data/generated/eurostat-arope-2015-2025.data.json";

const dataArtifact = readJsonSnapshot(join(process.cwd(), EUROSTAT_AROPE_DATA_PATH), 64 * 1024);
const validated = validateEurostatAropeBundle(dataArtifact, metadataArtifact);
export const eurostatAropeData = validated.data;
export const eurostatAropeMetadata = validated.metadata;

export type EurostatAropeQuery = Readonly<{
  territory?: string;
  year?: number;
  limit?: number;
  offset?: number;
}>;

/** Both HTTP and MCP consume this validated AROPE selector. */
export function queryEurostatArope(query: EurostatAropeQuery = {}, options: { signal?: AbortSignal } = {}) {
  options.signal?.throwIfAborted();
  const territory = query.territory?.toUpperCase();
  const year = query.year;
  const limit = query.limit ?? 100;
  const offset = query.offset ?? 0;
  const data = eurostatAropeData;
  if (territory === undefined && year === undefined) {
    throw new Error("Specificare almeno un filtro fra territorio e anno.");
  }
  if (territory !== undefined && !data.territories.some((entry) => entry.code === territory)) {
    throw new Error("Territorio non riconosciuto: per questa fetta è pubblicata solo Italia (IT).");
  }
  if (year !== undefined && (!Number.isSafeInteger(year) || year < data.period.from || year > data.period.to)) {
    throw new Error("Anno fuori dal periodo coperto (2015–2025).");
  }
  if (
    !Number.isSafeInteger(limit) || limit < 1 || limit > 100
    || !Number.isSafeInteger(offset) || offset < 0 || offset > 100_000
  ) {
    throw new Error("Usare limit fra 1 e 100 e offset fra 0 e 100000, entrambi interi.");
  }
  const matches = data.observations.filter((row) =>
    (territory === undefined || row.territory === territory)
    && (year === undefined || row.year === year));
  const observations = matches.slice(offset, offset + limit);
  const hasMore = offset + observations.length < matches.length;
  return {
    datasetId: data.datasetId,
    domain: data.domain,
    period: data.period,
    periodNote: data.periodNote,
    definitionNote: data.definitionNote,
    scale: data.scale,
    flags: data.flags,
    caveats: data.caveats,
    reconciliation: data.reconciliation,
    source: eurostatAropeMetadata.source,
    semantics: eurostatAropeMetadata.semantics,
    indicators: data.indicators,
    territories: data.territories.filter((entry) => territory === undefined || entry.code === territory),
    observations,
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
