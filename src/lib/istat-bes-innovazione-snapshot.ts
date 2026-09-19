import "server-only";
import { readJsonSnapshot } from "@/lib/data/read-json-snapshot";
import { join } from "node:path";
import metadataArtifact from "@/data/generated/istat-bes-innovazione-2004-2023.meta.json";
import { validateIstatBesInnovazioneBundle } from "@/lib/data/istat-bes-innovazione-contract";

export const ISTAT_BES_INNOVAZIONE_DATA_PATH = "src/data/generated/istat-bes-innovazione-2004-2023.data.json";

const dataArtifact = readJsonSnapshot(join(process.cwd(), ISTAT_BES_INNOVAZIONE_DATA_PATH), 2 * 1024 * 1024);
const validated = validateIstatBesInnovazioneBundle(dataArtifact, metadataArtifact);
export const istatBesInnovazioneData = validated.data;
export const istatBesInnovazioneMetadata = validated.metadata;

export type IstatBesInnovazioneQuery = Readonly<{
  territory?: string;
  year?: number;
  indicator?: string;
  sex?: string;
  limit?: number;
  offset?: number;
}>;

/** Both HTTP and MCP consume this validated innovation-domain selector. */
export function queryIstatBesInnovazione(query: IstatBesInnovazioneQuery = {}, options: { signal?: AbortSignal } = {}) {
  options.signal?.throwIfAborted();
  const territory = query.territory?.toUpperCase();
  const indicator = query.indicator?.toUpperCase();
  const sex = query.sex?.toUpperCase();
  const year = query.year;
  const limit = query.limit ?? 100;
  const offset = query.offset ?? 0;
  const data = istatBesInnovazioneData;
  if (territory === undefined && indicator === undefined && sex === undefined && year === undefined) {
    throw new Error("Specificare almeno un filtro fra territorio, anno, indicatore e sesso.");
  }
  if (territory !== undefined && !data.territories.some((entry) => entry.code === territory)) {
    throw new Error("Territorio non riconosciuto: usare un codice ISTAT fra quelli pubblicati.");
  }
  if (indicator !== undefined && !data.indicators.some((entry) => entry.code === indicator)) {
    throw new Error("Indicatore non riconosciuto: usare un codice del dominio Innovazione, per esempio 11RIC002.");
  }
  if (sex !== undefined && sex !== "T") throw new Error("Sesso non riconosciuto: questo dominio pubblica soltanto T.");
  if (year !== undefined && (!Number.isSafeInteger(year) || year < data.period.from || year > data.period.to)) {
    throw new Error("Anno fuori dal periodo coperto (2004–2023).");
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
    source: istatBesInnovazioneMetadata.source,
    semantics: istatBesInnovazioneMetadata.semantics,
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
