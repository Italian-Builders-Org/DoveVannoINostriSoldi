import "server-only";
import { readJsonSnapshot } from "@/lib/data/read-json-snapshot";
import { join } from "node:path";
import metadataArtifact from "@/data/generated/istat-poverta-soglia-assoluta-2005-2024.meta.json";
import { validateIstatPovertaSogliaAssolutaBundle } from "@/lib/data/istat-poverta-soglia-assoluta-contract";

export const ISTAT_POVERTA_SOGLIA_ASSOLUTA_DATA_PATH =
  "src/data/generated/istat-poverta-soglia-assoluta-2005-2024.data.json";

const dataArtifact = readJsonSnapshot(
  join(process.cwd(), ISTAT_POVERTA_SOGLIA_ASSOLUTA_DATA_PATH),
  6 * 1024 * 1024,
);
const validated = validateIstatPovertaSogliaAssolutaBundle(dataArtifact, metadataArtifact);
export const istatPovertaSogliaAssolutaData = validated.data;
export const istatPovertaSogliaAssolutaMetadata = validated.metadata;

export type IstatPovertaSogliaAssolutaQuery = Readonly<{
  territory?: string;
  year?: number;
  householdTypology?: string;
  municipalitySize?: string;
  limit?: number;
  offset?: number;
}>;

/** Both HTTP and MCP consume this validated absolute-threshold selector. */
export function queryIstatPovertaSogliaAssoluta(
  query: IstatPovertaSogliaAssolutaQuery = {},
  options: { signal?: AbortSignal } = {},
) {
  options.signal?.throwIfAborted();
  const territory = query.territory?.toUpperCase();
  const householdTypology = query.householdTypology;
  const municipalitySize = query.municipalitySize?.toUpperCase();
  const year = query.year;
  const limit = query.limit ?? 100;
  const offset = query.offset ?? 0;
  const data = istatPovertaSogliaAssolutaData;
  if (
    territory === undefined
    && householdTypology === undefined
    && municipalitySize === undefined
    && year === undefined
  ) {
    throw new Error("Specificare almeno un filtro fra territorio, anno, tipologia familiare e ampiezza demografica.");
  }
  if (territory !== undefined && !data.territories.some((entry) => entry.code === territory)) {
    throw new Error("Territorio non riconosciuto: usare un codice ISTAT fra quelli pubblicati.");
  }
  if (
    householdTypology !== undefined
    && !data.householdTypologies.some((entry) => entry.code === householdTypology)
  ) {
    throw new Error("Tipologia familiare non riconosciuta: usare un codice CL_TIPOLOGIA_FAMILIARE2 pubblicato.");
  }
  if (
    municipalitySize !== undefined
    && !data.municipalitySizes.some((entry) => entry.code === municipalitySize)
  ) {
    throw new Error("Ampiezza demografica non riconosciuta: usare un codice pubblicato (es. 2, INH_OTH_UN5000).");
  }
  if (year !== undefined && (!Number.isSafeInteger(year) || year < data.period.from || year > data.period.to)) {
    throw new Error("Anno fuori dal periodo coperto (2005–2024).");
  }
  if (
    !Number.isSafeInteger(limit) || limit < 1 || limit > 100
    || !Number.isSafeInteger(offset) || offset < 0 || offset > 100_000
  ) {
    throw new Error("Usare limit fra 1 e 100 e offset fra 0 e 100000, entrambi interi.");
  }
  const matches = data.observations.filter((row) =>
    (territory === undefined || row.territory === territory)
    && (householdTypology === undefined || row.householdTypology === householdTypology)
    && (municipalitySize === undefined || row.municipalitySize === municipalitySize)
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
    source: istatPovertaSogliaAssolutaMetadata.source,
    semantics: istatPovertaSogliaAssolutaMetadata.semantics,
    indicators: data.indicators,
    territories: data.territories.filter((entry) => territory === undefined || entry.code === territory),
    householdTypologies: data.householdTypologies.filter(
      (entry) => householdTypology === undefined || entry.code === householdTypology,
    ),
    municipalitySizes: data.municipalitySizes.filter(
      (entry) => municipalitySize === undefined || entry.code === municipalitySize,
    ),
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
