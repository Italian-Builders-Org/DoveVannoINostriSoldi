import "server-only";

import dataArtifact from "@/data/generated/consip-ordini-2024-2026.data.json";
import metadataArtifact from "@/data/generated/consip-ordini-2024-2026.meta.json";
import {
  validateConsipOrdiniBundle,
  type ConsipOrdiniData,
  type ConsipOrdiniMetadata,
  type ConsipOrdiniObservation,
  type ConsipOrdiniTotal,
} from "@/lib/data/consip-ordini-contract";

const validated = validateConsipOrdiniBundle(dataArtifact, metadataArtifact);

export const consipOrdiniData: ConsipOrdiniData = validated.data;
export const consipOrdiniMetadata: ConsipOrdiniMetadata = validated.metadata;

export type ConsipOrdiniChannel = "convenzioni" | "mepa";

export type ConsipOrdiniQuery = Readonly<{
  year?: number;
  channel?: ConsipOrdiniChannel;
}>;

export type ConsipOrdiniQueryResult = Readonly<{
  datasetId: string;
  period: ConsipOrdiniData["period"];
  caveats: readonly string[];
  totals: readonly ConsipOrdiniTotal[];
  byRegion: readonly ConsipOrdiniObservation[];
  byAdministrationType: readonly ConsipOrdiniObservation[];
  source: Readonly<{
    owner: string;
    landingUrl: string;
    licenseId: string;
    suppressionNote: string;
  }>;
}>;

function normalizeYear(year: number | undefined): number | undefined {
  if (year === undefined) return undefined;
  const { from, to } = consipOrdiniData.period;
  if (!Number.isSafeInteger(year) || year < from || year > to) {
    throw new Error(`Anno fuori dal periodo coperto (${from}-${to}).`);
  }
  return year;
}

function normalizeChannel(channel: string | undefined): ConsipOrdiniChannel | undefined {
  if (channel === undefined) return undefined;
  if (channel !== "convenzioni" && channel !== "mepa") {
    throw new Error("Canale non riconosciuto: usare convenzioni oppure mepa.");
  }
  return channel;
}

export function queryConsipOrdini(query: ConsipOrdiniQuery = {}): ConsipOrdiniQueryResult {
  const year = normalizeYear(query.year);
  const channel = normalizeChannel(query.channel);
  const keep = <T extends { year: number; channel: string }>(rows: readonly T[]): readonly T[] =>
    rows.filter((row) => (year === undefined || row.year === year) && (channel === undefined || row.channel === channel));

  return {
    datasetId: consipOrdiniData.datasetId,
    period: consipOrdiniData.period,
    caveats: consipOrdiniData.caveats,
    totals: keep(consipOrdiniData.totals),
    byRegion: keep(consipOrdiniData.byRegion),
    byAdministrationType: keep(consipOrdiniData.byAdministrationType),
    source: {
      owner: consipOrdiniMetadata.source.owner,
      landingUrl: consipOrdiniMetadata.source.landingUrl,
      licenseId: consipOrdiniMetadata.source.licenseId,
      suppressionNote: consipOrdiniMetadata.suppression.note,
    },
  };
}
