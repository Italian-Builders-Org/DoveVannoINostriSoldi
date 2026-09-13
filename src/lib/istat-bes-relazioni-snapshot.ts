import "server-only";
import { readJsonSnapshot } from "@/lib/data/read-json-snapshot";
import { join } from "node:path";
import metadataArtifact from "@/data/generated/istat-bes-relazioni-2011-2024.meta.json";
import { validateIstatBesRelazioniBundle } from "@/lib/data/istat-bes-relazioni-contract";

export const ISTAT_BES_RELAZIONI_DATA_PATH = "src/data/generated/istat-bes-relazioni-2011-2024.data.json";

const dataArtifact = readJsonSnapshot(join(process.cwd(), ISTAT_BES_RELAZIONI_DATA_PATH), 3 * 1024 * 1024);
const validated = validateIstatBesRelazioniBundle(dataArtifact, metadataArtifact);
export const istatBesRelazioniData = validated.data;
export const istatBesRelazioniMetadata = validated.metadata;

export type IstatBesRelazioniQuery = Readonly<{
  territory?: string;
  year?: number;
  indicator?: string;
  sex?: string;
  limit?: number;
  offset?: number;
}>;

/** Both HTTP and MCP consume this validated social-relations selector. */
export function queryIstatBesRelazioni(query: IstatBesRelazioniQuery = {}, options: { signal?: AbortSignal } = {}) {
  options.signal?.throwIfAborted();
  const territory = query.territory?.toUpperCase();
  const indicator = query.indicator?.toUpperCase();
  const sex = query.sex?.toUpperCase();
  const year = query.year;
  const limit = query.limit ?? 100;
  const offset = query.offset ?? 0;
  const data = istatBesRelazioniData;
  if (territory === undefined && indicator === undefined && sex === undefined && year === undefined) {
    throw new Error("Specificare almeno un filtro fra territorio, anno, indicatore e sesso.");
  }
  if (territory !== undefined && !data.territories.some((entry) => entry.code === territory)) {
    throw new Error("Territorio non riconosciuto: usare un codice ISTAT fra quelli pubblicati.");
  }
  if (indicator !== undefined && !data.indicators.some((entry) => entry.code === indicator)) {
    throw new Error("Indicatore non riconosciuto: usare un codice del dominio Relazioni sociali, per esempio 05REL008.");
  }
  if (sex !== undefined && sex !== "T") throw new Error("Sesso non riconosciuto: questo dominio pubblica soltanto T.");
  if (year !== undefined && (!Number.isSafeInteger(year) || year < data.period.from || year > data.period.to)) {
    throw new Error("Anno fuori dal periodo coperto (2011–2024).");
  }
  if (!Number.isSafeInteger(limit) || limit < 1 || limit > 100
    || !Number.isSafeInteger(offset) || offset < 0 || offset > 100_000) {
    throw new Error("Usare limit fra 1 e 100 e offset fra 0 e 100000, entrambi interi.");
  }
  const matches = data.observations.filter((row) =>
    (territory === undefined || row.territory === territory)
    && (indicator === undefined || row.indicator === indicator)
    && (sex === undefined || row.sex === sex)
    && (year === undefined || row.year === year));
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
    source: istatBesRelazioniMetadata.source,
    semantics: istatBesRelazioniMetadata.semantics,
    indicators: data.indicators.filter((entry) => indicator === undefined || entry.code === indicator),
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
