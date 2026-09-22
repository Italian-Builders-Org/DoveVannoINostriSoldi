import "server-only";

import dataArtifact from "@/data/generated/istat-permessi-costruire-2015-2025.data.json";
import metadataArtifact from "@/data/generated/istat-permessi-costruire-2015-2025.meta.json";
import { validateIstatPermessiCostruireBundle } from "@/lib/data/istat-permessi-costruire-contract";

const validated = validateIstatPermessiCostruireBundle(dataArtifact, metadataArtifact);
export const istatPermessiCostruireData = validated.data;
export const istatPermessiCostruireMetadata = validated.metadata;

export type IstatPermessiCostruireQuery = Readonly<{
  year?: number;
  table?: "a1" | "a2" | "a3" | "a4";
}>;

const TABLES = ["a1", "a2", "a3", "a4"] as const;

export function queryIstatPermessiCostruire(query: IstatPermessiCostruireQuery = {}) {
  if (query.year !== undefined) {
    if (!Number.isSafeInteger(query.year) || query.year < 2015 || query.year > 2025) {
      throw new Error("Specificare un anno tra 2015 e 2025, oppure omettere year per l'intera serie.");
    }
  }
  if (query.table !== undefined && !TABLES.includes(query.table)) {
    throw new Error("Tavola non canonica: usare a1, a2, a3 o a4.");
  }

  const filterYears = <T extends { year: number }>(rows: readonly T[]) => (
    query.year === undefined ? rows : rows.filter((row) => row.year === query.year)
  );

  let tables;
  if (query.table === undefined) {
    tables = {
      a1: { ...istatPermessiCostruireData.tables.a1, years: filterYears(istatPermessiCostruireData.tables.a1.years) },
      a2: { ...istatPermessiCostruireData.tables.a2, years: filterYears(istatPermessiCostruireData.tables.a2.years) },
      a3: { ...istatPermessiCostruireData.tables.a3, years: filterYears(istatPermessiCostruireData.tables.a3.years) },
      a4: { ...istatPermessiCostruireData.tables.a4, years: filterYears(istatPermessiCostruireData.tables.a4.years) },
    };
  } else if (query.table === "a1") {
    tables = {
      a1: { ...istatPermessiCostruireData.tables.a1, years: filterYears(istatPermessiCostruireData.tables.a1.years) },
    };
  } else if (query.table === "a2") {
    tables = {
      a2: { ...istatPermessiCostruireData.tables.a2, years: filterYears(istatPermessiCostruireData.tables.a2.years) },
    };
  } else if (query.table === "a3") {
    tables = {
      a3: { ...istatPermessiCostruireData.tables.a3, years: filterYears(istatPermessiCostruireData.tables.a3.years) },
    };
  } else {
    tables = {
      a4: { ...istatPermessiCostruireData.tables.a4, years: filterYears(istatPermessiCostruireData.tables.a4.years) },
    };
  }

  if (query.year !== undefined) {
    for (const table of Object.values(tables)) {
      if (!table || table.years.length !== 1) {
        throw new Error("Anno richiesto assente dallo snapshot verificato.");
      }
    }
  }

  return {
    datasetId: istatPermessiCostruireData.datasetId,
    geography: istatPermessiCostruireData.geography,
    period: istatPermessiCostruireData.period,
    units: istatPermessiCostruireData.units,
    soldi: istatPermessiCostruireData.soldi,
    tables,
    source: istatPermessiCostruireMetadata.source,
    caveats: istatPermessiCostruireData.caveats,
    semantics: istatPermessiCostruireMetadata.semantics,
  };
}
