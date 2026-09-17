import "server-only";
import dataArtifact from "@/data/generated/istat-bes-istruzione-2004-2024.data.json";
import metadataArtifact from "@/data/generated/istat-bes-istruzione-2004-2024.meta.json";
import { validateIstatBesIstruzioneBundle } from "@/lib/data/istat-bes-istruzione-contract";

const validated = validateIstatBesIstruzioneBundle(dataArtifact, metadataArtifact);
export const istatBesIstruzioneData = validated.data;
export const istatBesIstruzioneMetadata = validated.metadata;

export type IstatBesIstruzioneQuery = Readonly<{
  territory?: string;
  year?: number;
  indicator?: string;
  sex?: string;
  limit?: number;
  offset?: number;
}>;

/** Both HTTP and MCP consume this validated education selector. */
export function queryIstatBesIstruzione(query: IstatBesIstruzioneQuery = {}, options: { signal?: AbortSignal } = {}) {
  options.signal?.throwIfAborted();
  const territory = query.territory?.toUpperCase();
  const indicator = query.indicator?.toUpperCase();
  const sex = query.sex?.toUpperCase();
  const year = query.year;
  const limit = query.limit ?? 100;
  const offset = query.offset ?? 0;
  const data = istatBesIstruzioneData;
  if (territory === undefined && indicator === undefined && sex === undefined && year === undefined) {
    throw new Error("Specificare almeno un filtro fra territorio, anno, indicatore e sesso.");
  }
  if (territory !== undefined && !data.territories.some((entry) => entry.code === territory)) {
    throw new Error("Territorio non riconosciuto: usare un codice ISTAT fra quelli pubblicati.");
  }
  if (indicator !== undefined && !data.indicators.some((entry) => entry.code === indicator)) {
    throw new Error("Indicatore non riconosciuto: usare un codice del dominio Istruzione, per esempio 02IST001.");
  }
  if (sex !== undefined && !["F", "M", "T"].includes(sex)) throw new Error("Sesso non riconosciuto: usare F, M oppure T.");
  if (year !== undefined && (!Number.isSafeInteger(year) || year < data.period.from || year > data.period.to)) {
    throw new Error("Anno fuori dal periodo coperto (2004–2024).");
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
    source: istatBesIstruzioneMetadata.source,
    semantics: istatBesIstruzioneMetadata.semantics,
    indicators: data.indicators.filter((entry) => indicator === undefined || entry.code === indicator),
    territories: data.territories.filter((entry) => territory === undefined || entry.code === territory),
    observations,
    pagination: { total: matches.length, returned: observations.length, limit, offset, hasMore,
      nextOffset: hasMore ? offset + observations.length : null },
  };
}
