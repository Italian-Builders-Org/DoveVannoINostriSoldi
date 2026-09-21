import "server-only";
import { readJsonSnapshot } from "@/lib/data/read-json-snapshot";
import { join } from "node:path";
import metadataArtifact from "@/data/generated/istat-poverta-soglia-relativa-2014-2024.meta.json";
import { validateIstatPovertaSogliaRelativaBundle } from "@/lib/data/istat-poverta-soglia-relativa-contract";

export const ISTAT_POVERTA_SOGLIA_RELATIVA_DATA_PATH =
  "src/data/generated/istat-poverta-soglia-relativa-2014-2024.data.json";

const dataArtifact = readJsonSnapshot(
  join(process.cwd(), ISTAT_POVERTA_SOGLIA_RELATIVA_DATA_PATH),
  256 * 1024,
);
const validated = validateIstatPovertaSogliaRelativaBundle(dataArtifact, metadataArtifact);
export const istatPovertaSogliaRelativaData = validated.data;
export const istatPovertaSogliaRelativaMetadata = validated.metadata;

export type IstatPovertaSogliaRelativaQuery = Readonly<{
  territory?: string;
  year?: number;
  householdComposition?: string;
  limit?: number;
  offset?: number;
}>;

/** Both HTTP and MCP consume this validated relative-threshold selector. */
export function queryIstatPovertaSogliaRelativa(
  query: IstatPovertaSogliaRelativaQuery = {},
  options: { signal?: AbortSignal } = {},
) {
  options.signal?.throwIfAborted();
  const territory = query.territory?.toUpperCase();
  const householdComposition = query.householdComposition?.toUpperCase();
  const year = query.year;
  const limit = query.limit ?? 100;
  const offset = query.offset ?? 0;
  const data = istatPovertaSogliaRelativaData;
  if (territory === undefined && householdComposition === undefined && year === undefined) {
    throw new Error("Specificare almeno un filtro fra territorio, anno e ampiezza familiare.");
  }
  if (territory !== undefined && !data.territories.some((entry) => entry.code === territory)) {
    throw new Error("Territorio non riconosciuto: per questa soglia è pubblicata solo Italia (IT).");
  }
  if (
    householdComposition !== undefined
    && !data.householdCompositions.some((entry) => entry.code === householdComposition)
  ) {
    throw new Error("Ampiezza familiare non riconosciuta: usare N1…N6 oppure N7_GE.");
  }
  if (year === data.excludedYear) {
    throw new Error(
      `L'anno ${data.excludedYear} è escluso dal prodotto perché i valori della fonte sono incoerenti con il resto della serie.`,
    );
  }
  if (year !== undefined && (!Number.isSafeInteger(year) || year < data.period.from || year > data.period.to)) {
    throw new Error("Anno fuori dal periodo coperto (2014–2024, senza 2021).");
  }
  if (
    !Number.isSafeInteger(limit) || limit < 1 || limit > 100
    || !Number.isSafeInteger(offset) || offset < 0 || offset > 100_000
  ) {
    throw new Error("Usare limit fra 1 e 100 e offset fra 0 e 100000, entrambi interi.");
  }
  const matches = data.observations.filter((row) =>
    (territory === undefined || row.territory === territory)
    && (householdComposition === undefined || row.householdComposition === householdComposition)
    && (year === undefined || row.year === year));
  const observations = matches.slice(offset, offset + limit);
  const hasMore = offset + observations.length < matches.length;
  return {
    datasetId: data.datasetId,
    domain: data.domain,
    period: data.period,
    periodNote: data.periodNote,
    excludedYear: data.excludedYear,
    excludedYearReason: data.excludedYearReason,
    scale: data.scale,
    flags: data.flags,
    caveats: data.caveats,
    reconciliation: data.reconciliation,
    source: istatPovertaSogliaRelativaMetadata.source,
    semantics: istatPovertaSogliaRelativaMetadata.semantics,
    indicators: data.indicators,
    territories: data.territories.filter((entry) => territory === undefined || entry.code === territory),
    householdCompositions: data.householdCompositions.filter(
      (entry) => householdComposition === undefined || entry.code === householdComposition,
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
