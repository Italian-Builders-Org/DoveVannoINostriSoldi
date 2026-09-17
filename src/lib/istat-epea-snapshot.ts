import "server-only";

import dataArtifact from "@/data/generated/istat-epea-2016-2022.data.json";
import metadataArtifact from "@/data/generated/istat-epea-2016-2022.meta.json";
import {
  parseIstatEpeaData,
  parseIstatEpeaMeta,
  type IstatEpeaData,
  type IstatEpeaMeta,
} from "@/lib/data/istat-epea-contracts";

const data: IstatEpeaData = parseIstatEpeaData(dataArtifact);
const metadata: IstatEpeaMeta = parseIstatEpeaMeta(metadataArtifact);

const SECTORS = new Set(["S1", "S13_15", "S14", "S1K", "S1K_ANC", "S1K_SPASEC", "S2"]);
const CEPAS = new Set(["CEPA1", "CEPA2", "CEPA3", "CEPA4", "CEPA5", "CEPA6", "CEPA7_9", "TOT_CEPA"]);

export const istatEpeaData = data;
export const istatEpeaMetadata = metadata;

export type IstatEpeaQuery = Readonly<{
  year?: number;
  sector?: string;
  cepa?: string;
}>;

export type IstatEpeaQueryResult = Readonly<{
  datasetId: "istat-epea";
  edition: "2025M2";
  period: { from: 2016; to: 2022 };
  caveats: readonly string[];
  unit: {
    source: string;
    storage: string;
  };
  source: IstatEpeaMeta["source"];
  filtersApplied: IstatEpeaQuery;
  observations: IstatEpeaData["rows"];
}>;

function normalizeYear(year: number | undefined): number | undefined {
  if (year === undefined) return undefined;
  if (!Number.isSafeInteger(year) || year < 2016 || year > 2022) {
    throw new Error("Anno fuori dal periodo coperto (2016-2022).");
  }
  return year;
}

function normalizeSector(sector: string | undefined): string | undefined {
  if (sector === undefined) return undefined;
  const value = sector.trim().toUpperCase();
  if (!SECTORS.has(value)) {
    throw new Error(
      `Settore istituzionale non riconosciuto. Valori ammessi: ${[...SECTORS].sort().join(", ")}.`,
    );
  }
  return value;
}

function normalizeCepa(cepa: string | undefined): string | undefined {
  if (cepa === undefined) return undefined;
  const value = cepa.trim().toUpperCase();
  if (!CEPAS.has(value)) {
    throw new Error(`Classe CEPA non riconosciuta. Valori ammessi: ${[...CEPAS].sort().join(", ")}.`);
  }
  return value;
}

export function queryIstatEpea(query: IstatEpeaQuery = {}): IstatEpeaQueryResult {
  const year = normalizeYear(query.year);
  const sector = normalizeSector(query.sector);
  const cepa = normalizeCepa(query.cepa);

  if (year === undefined && sector === undefined && cepa === undefined) {
    throw new Error(
      "Specificare almeno un filtro fra anno, settore e cepa: la serie completa non viene servita in un'unica risposta.",
    );
  }

  const observations = data.rows.filter(
    (row) =>
      (year === undefined || row.year === year) &&
      (sector === undefined || row.institutionalSector === sector) &&
      (cepa === undefined || row.cepaClass === cepa),
  );

  return {
    datasetId: "istat-epea",
    edition: "2025M2",
    period: { from: 2016, to: 2022 },
    caveats: metadata.caveats,
    unit: {
      source: "milioni di euro (UNIT_MEAS=EURO, UNIT_MULT=6)",
      storage: "amountCents = OBS_VALUE * 1e6 * 100 quando OBS_VALUE presente",
    },
    source: metadata.source,
    filtersApplied: { year, sector, cepa },
    observations,
  };
}
