import "server-only";

import dataArtifact from "@/data/generated/mef-irpef-dettaglio-2017-2025.data.json";
import metadataArtifact from "@/data/generated/mef-irpef-dettaglio-2017-2025.meta.json";
import {
  validateMefIrpefDettaglioBundle,
  type MefIrpefDettaglioData,
  type MefIrpefDettaglioMetadata,
  type MefIrpefDettaglioRow,
  type MefIrpefDettaglioSchema,
  type MefIrpefDettaglioTable,
} from "@/lib/data/mef-irpef-dettaglio-contract";

const validated = validateMefIrpefDettaglioBundle(dataArtifact, metadataArtifact);

export const mefIrpefDettaglioData: MefIrpefDettaglioData = validated.data;
export const mefIrpefDettaglioMetadata: MefIrpefDettaglioMetadata = validated.metadata;

const FAMILIES: ReadonlySet<string> = new Set(mefIrpefDettaglioData.tables.map((table) => table.family));
const BREAKDOWNS: ReadonlySet<string> = new Set(mefIrpefDettaglioData.tables.map((table) => table.breakdown));

export type MefIrpefDettaglioQuery = Readonly<{
  family?: string;
  breakdown?: string;
  /** Anno di dichiarazione; taxYear resta distinto nella risposta. */
  year?: number;
  limit?: number;
  offset?: number;
}>;

export type MefIrpefDettaglioTableResult = Readonly<{
  table: MefIrpefDettaglioTable;
  schema: MefIrpefDettaglioSchema;
  source: MefIrpefDettaglioMetadata["source"]["files"][string];
  rows: readonly { keys: readonly string[]; values: readonly (number | null)[] }[];
}>;

export type MefIrpefDettaglioQueryResult = Readonly<{
  datasetId: string;
  period: MefIrpefDettaglioData["period"];
  periodBasis: MefIrpefDettaglioData["periodBasis"];
  taxPeriod: MefIrpefDettaglioData["taxPeriod"];
  pagination: { limit: number; offset: number; totalRows: number; returnedRows: number; nextOffset: number | null };
  caveats: readonly string[];
  instruments: MefIrpefDettaglioData["instruments"];
  availability: MefIrpefDettaglioData["availability"];
  tables: readonly MefIrpefDettaglioTableResult[];
  coverage: MefIrpefDettaglioData["coverage"];
  source: Readonly<{ owner: string; landingUrl: string; licenseId: string; observedAt: string }>;
}>;

function normalizeYear(year: number | undefined): number | undefined {
  if (year === undefined) return undefined;
  const { from, to } = mefIrpefDettaglioData.period;
  if (!Number.isSafeInteger(year) || year < from || year > to) {
    throw new Error(`Anno fuori dal periodo coperto (${from}-${to}).`);
  }
  return year;
}

function normalizeFamily(family: string | undefined): string | undefined {
  if (family === undefined) return undefined;
  const value = family.toLowerCase();
  if (!FAMILIES.has(value)) {
    throw new Error("Famiglia non riconosciuta: usare tipo_reddito, calcolo_irpef oppure bonus_irpef.");
  }
  return value;
}

function normalizeBreakdown(breakdown: string | undefined): string | undefined {
  if (breakdown === undefined) return undefined;
  const map: Record<string, string> = {
    regione: "regione", region: "regione",
    classeeta: "classeEta", classeEta: "classeEta", eta: "classeEta",
    sesso: "sesso", sex: "sesso",
  };
  const value = map[breakdown] ?? map[breakdown.toLowerCase()];
  if (!value || !BREAKDOWNS.has(value)) {
    throw new Error("Taglio non riconosciuto: usare regione, classeEta oppure sesso.");
  }
  return value;
}

export function queryMefIrpefDettaglio(query: MefIrpefDettaglioQuery = {}): MefIrpefDettaglioQueryResult {
  const family = normalizeFamily(query.family);
  const breakdown = normalizeBreakdown(query.breakdown);
  const year = normalizeYear(query.year);
  const limit = query.limit ?? 50;
  const offset = query.offset ?? 0;
  if (!Number.isSafeInteger(limit) || limit < 1 || limit > 100 || !Number.isSafeInteger(offset) || offset < 0 || offset > 100_000) {
    throw new Error("Paginazione non valida: limit 1-100, offset 0-100000.");
  }
  if (family === undefined && breakdown === undefined && year === undefined) throw new Error("Specificare almeno un filtro fra famiglia, taglio e anno di dichiarazione.");

  const wanted = new Map<number, MefIrpefDettaglioTable>();
  mefIrpefDettaglioData.tables.forEach((table, index) => {
    if (family !== undefined && table.family !== family) return;
    if (breakdown !== undefined && table.breakdown !== breakdown) return;
    if (year !== undefined && table.year !== year) return;
    wanted.set(index, table);
  });

  const byTable = new Map<number, { keys: readonly string[]; values: readonly (number | null)[] }[]>();
  let totalRows = 0;
  let returnedRows = 0;
  for (const raw of mefIrpefDettaglioData.rows) {
    const row = raw as MefIrpefDettaglioRow;
    if (!wanted.has(row.t)) continue;
    const index = totalRows++;
    if (index < offset || returnedRows >= limit) continue;
    returnedRows += 1;
    const bucket = byTable.get(row.t) ?? [];
    bucket.push({ keys: row.k, values: row.v });
    byTable.set(row.t, bucket);
  }

  const tables: MefIrpefDettaglioTableResult[] = [...wanted.entries()].map(([index, table]) => ({
    table,
    schema: mefIrpefDettaglioData.schemas[table.schemaId],
    source: mefIrpefDettaglioMetadata.source.files[table.id],
    rows: byTable.get(index) ?? [],
  }));

  return {
    datasetId: mefIrpefDettaglioData.datasetId,
    period: mefIrpefDettaglioData.period,
    periodBasis: mefIrpefDettaglioData.periodBasis,
    taxPeriod: mefIrpefDettaglioData.taxPeriod,
    pagination: { limit, offset, totalRows, returnedRows, nextOffset: offset + returnedRows < totalRows ? offset + returnedRows : null },
    caveats: mefIrpefDettaglioData.caveats,
    instruments: mefIrpefDettaglioData.instruments,
    availability: mefIrpefDettaglioData.availability,
    tables,
    coverage: mefIrpefDettaglioData.coverage,
    source: {
      owner: mefIrpefDettaglioMetadata.source.owner,
      landingUrl: mefIrpefDettaglioMetadata.source.landingUrl,
      licenseId: mefIrpefDettaglioMetadata.source.licenseId,
      observedAt: mefIrpefDettaglioMetadata.observedAt,
    },
  };
}
