import "server-only";

import dataArtifact from "@/data/generated/inl-vigilanza-2025.data.json";
import metadataArtifact from "@/data/generated/inl-vigilanza-2025.meta.json";
import {
  validateInlVigilanzaBundle,
  type InlVigilanzaData,
  type InlVigilanzaMetadata,
  type InlVigilanzaObservation,
} from "@/lib/data/inl-vigilanza-contract";

const validated = validateInlVigilanzaBundle(dataArtifact, metadataArtifact);
export const inlVigilanzaData: InlVigilanzaData = validated.data;
export const inlVigilanzaMetadata: InlVigilanzaMetadata = validated.metadata;

const TABLES = new Set<string>(["inspectionsStarted", "inspectionsOutcome", "recovery"]);
const TERRITORIES = new Set(
  inlVigilanzaData.observations
    .map((row) => ("territory" in row ? row.territory : null))
    .filter((value): value is string => value !== null),
);
const SECTORS = new Set(["Agricoltura", "Industria", "Edilizia", "Terziario", "ND", "Totale"]);

export type InlVigilanzaQuery = Readonly<{
  year?: number;
  table?: string;
  territory?: string;
  sector?: string;
}>;

export function queryInlVigilanza(query: InlVigilanzaQuery = {}) {
  if (query.year !== undefined) {
    if (!Number.isSafeInteger(query.year) || query.year !== 2025) {
      throw new Error("Anno fuori dal periodo coperto (2025).");
    }
  }
  if (query.table !== undefined && !TABLES.has(query.table)) {
    throw new Error(
      "Tabella non riconosciuta: usare inspectionsStarted, inspectionsOutcome oppure recovery.",
    );
  }
  if (query.territory !== undefined && !TERRITORIES.has(query.territory)) {
    throw new Error("Territorio non presente nello snapshot INL vigilanza.");
  }
  if (query.sector !== undefined && !SECTORS.has(query.sector)) {
    throw new Error("Settore non presente nello snapshot INL vigilanza.");
  }

  let observations: readonly InlVigilanzaObservation[] = inlVigilanzaData.observations;
  if (query.table !== undefined) {
    observations = observations.filter((row) => row.table === query.table);
  }
  if (query.year !== undefined) {
    observations = observations.filter((row) => row.year === query.year);
  }
  if (query.territory !== undefined) {
    observations = observations.filter((row) => row.territory === query.territory);
  }
  if (query.sector !== undefined) {
    observations = observations.filter(
      (row) => row.table !== "recovery" && "sector" in row && row.sector === query.sector,
    );
  }

  return {
    datasetId: inlVigilanzaData.datasetId,
    period: inlVigilanzaData.period,
    geography: inlVigilanzaData.geography,
    units: inlVigilanzaData.units,
    coverage: inlVigilanzaData.coverage,
    measures: inlVigilanzaData.measures,
    caveats: inlVigilanzaData.caveats,
    observations,
    source: {
      owner: inlVigilanzaMetadata.source.owner,
      landingUrl: inlVigilanzaMetadata.source.landingUrl,
      documentUrl: inlVigilanzaMetadata.source.documentUrl,
      licenseId: inlVigilanzaMetadata.source.licenseId,
      observedAt: inlVigilanzaMetadata.observedAt,
    },
    pdf: inlVigilanzaMetadata.pdf,
    semantics: inlVigilanzaMetadata.semantics,
  };
}
