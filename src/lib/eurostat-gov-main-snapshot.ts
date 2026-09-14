import "server-only";

import dataArtifact from "@/data/generated/eurostat-gov-main-1995-2025.data.json";
import metadataArtifact from "@/data/generated/eurostat-gov-main-1995-2025.meta.json";
import {
  validateEurostatGovMainBundle,
  type EurostatGovMainData,
  type EurostatGovMainItem,
  type EurostatGovMainMetadata,
  type EurostatGovMainObservation,
} from "@/lib/data/eurostat-gov-main-contract";

const validated = validateEurostatGovMainBundle(dataArtifact, metadataArtifact);

export const eurostatGovMainData: EurostatGovMainData = validated.data;
export const eurostatGovMainMetadata: EurostatGovMainMetadata = validated.metadata;

const ITEM_CODES = new Set<string>(eurostatGovMainData.items.map((item) => item.code));

export type EurostatGovMainQuery = Readonly<{
  year?: number;
  naItem?: string;
}>;

export type EurostatGovMainQueryResult = Readonly<{
  datasetId: string;
  period: EurostatGovMainData["period"];
  caveats: readonly string[];
  units: EurostatGovMainData["units"];
  flags: EurostatGovMainData["flags"];
  items: readonly EurostatGovMainItem[];
  memoItems: EurostatGovMainData["memoItems"];
  observations: readonly EurostatGovMainObservation[];
  reconciliation: EurostatGovMainData["reconciliation"];
  source: Readonly<{
    owner: string;
    landingUrl: string;
    licenseId: string;
    datasetCode: string;
    publicationDate: string;
    coverageNote: string;
  }>;
}>;

function normalizeYear(year: number | undefined): number | undefined {
  if (year === undefined) return undefined;
  const { from, to } = eurostatGovMainData.period;
  if (!Number.isSafeInteger(year) || year < from || year > to) {
    throw new Error(`Anno fuori dal periodo coperto (${from}-${to}).`);
  }
  return year;
}

function normalizeItem(code: string | undefined): string | undefined {
  if (code === undefined) return undefined;
  const value = code.toUpperCase();
  if (!ITEM_CODES.has(value)) {
    throw new Error("Voce non pubblicata: usare TR, TE, B9, una componente delle identità o D41PAY.");
  }
  return value;
}

export function queryEurostatGovMain(query: EurostatGovMainQuery = {}): EurostatGovMainQueryResult {
  const year = normalizeYear(query.year);
  const naItem = normalizeItem(query.naItem);
  return {
    datasetId: eurostatGovMainData.datasetId,
    period: eurostatGovMainData.period,
    caveats: eurostatGovMainData.caveats,
    units: eurostatGovMainData.units,
    flags: eurostatGovMainData.flags,
    items: naItem === undefined
      ? eurostatGovMainData.items
      : eurostatGovMainData.items.filter((item) => item.code === naItem),
    memoItems: eurostatGovMainData.memoItems,
    observations: eurostatGovMainData.observations.filter(
      (observation) =>
        (year === undefined || observation.year === year) && (naItem === undefined || observation.naItem === naItem),
    ),
    reconciliation: eurostatGovMainData.reconciliation,
    source: {
      owner: eurostatGovMainMetadata.source.owner,
      landingUrl: eurostatGovMainMetadata.source.landingUrl,
      licenseId: eurostatGovMainMetadata.source.licenseId,
      datasetCode: eurostatGovMainMetadata.source.datasetCode,
      publicationDate: eurostatGovMainMetadata.semantics.provenance.publicationDate,
      coverageNote: eurostatGovMainMetadata.coverage.note,
    },
  };
}
