import "server-only";
import { closeSync, constants, fstatSync, openSync, readSync } from "node:fs";
import { join } from "node:path";
import metadataArtifact from "@/data/generated/istat-bes-lavoro-2008-2024.meta.json";
import { validateIstatBesLavoroBundle } from "@/lib/data/istat-bes-lavoro-contract";

export const ISTAT_BES_LAVORO_DATA_PATH = "src/data/generated/istat-bes-lavoro-2008-2024.data.json";

function readDataArtifact(): unknown {
  // Keep the 19,120 rows out of TypeScript's JSON type inference while
  // retaining the same fail-closed validation at the server boundary.
  const fd = openSync(join(process.cwd(), ISTAT_BES_LAVORO_DATA_PATH), constants.O_RDONLY | constants.O_NOFOLLOW);
  try {
    const before = fstatSync(fd);
    if (!before.isFile() || before.size <= 0 || before.size > 3 * 1024 * 1024) {
      throw new Error("Snapshot BesT Lavoro assente o troppo grande.");
    }
    const bytes = Buffer.alloc(before.size);
    let offset = 0;
    while (offset < bytes.length) {
      const count = readSync(fd, bytes, offset, bytes.length - offset, offset);
      if (!count) throw new Error("Snapshot BesT Lavoro incompleto.");
      offset += count;
    }
    const after = fstatSync(fd);
    if (before.size !== after.size || before.mtimeMs !== after.mtimeMs || before.ino !== after.ino) {
      throw new Error("Snapshot BesT Lavoro cambiato durante la lettura.");
    }
    return JSON.parse(bytes.toString("utf8")) as unknown;
  } finally {
    closeSync(fd);
  }
}

const dataArtifact = readDataArtifact();
const validated = validateIstatBesLavoroBundle(dataArtifact, metadataArtifact);
export const istatBesLavoroData = validated.data;
export const istatBesLavoroMetadata = validated.metadata;

export type IstatBesLavoroQuery = Readonly<{
  territory?: string;
  year?: number;
  indicator?: string;
  sex?: string;
  limit?: number;
  offset?: number;
}>;

/** Both HTTP and MCP consume this validated work-domain selector. */
export function queryIstatBesLavoro(query: IstatBesLavoroQuery = {}, options: { signal?: AbortSignal } = {}) {
  options.signal?.throwIfAborted();
  const territory = query.territory?.toUpperCase();
  const indicator = query.indicator?.toUpperCase();
  const sex = query.sex?.toUpperCase();
  const year = query.year;
  const limit = query.limit ?? 100;
  const offset = query.offset ?? 0;
  const data = istatBesLavoroData;
  if (territory === undefined && indicator === undefined && sex === undefined && year === undefined) {
    throw new Error("Specificare almeno un filtro fra territorio, anno, indicatore e sesso.");
  }
  if (territory !== undefined && !data.territories.some((entry) => entry.code === territory)) {
    throw new Error("Territorio non riconosciuto: usare un codice ISTAT fra quelli pubblicati.");
  }
  if (indicator !== undefined && !data.indicators.some((entry) => entry.code === indicator)) {
    throw new Error("Indicatore non riconosciuto: usare un codice del dominio Lavoro, per esempio 03LAV001-N22.");
  }
  if (sex !== undefined && !["F", "M", "T"].includes(sex)) throw new Error("Sesso non riconosciuto: usare F, M oppure T.");
  if (year !== undefined && (!Number.isSafeInteger(year) || year < data.period.from || year > data.period.to)) {
    throw new Error("Anno fuori dal periodo coperto (2008–2024).");
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
    source: istatBesLavoroMetadata.source,
    semantics: istatBesLavoroMetadata.semantics,
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
