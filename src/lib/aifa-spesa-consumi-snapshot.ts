import "server-only";
import { join } from "node:path";

import { readJsonSnapshot } from "@/lib/data/read-json-snapshot";
import metadataArtifact from "@/data/generated/aifa-spesa-consumi-2022-2025.meta.json";
import {
  validateAifaSpesaConsumiBundle,
  type AifaSpesaConsumiData,
  type AifaSpesaConsumiMetadata,
  type AifaSpesaConsumiObservation,
} from "@/lib/data/aifa-spesa-consumi-contract";

const validated = validateAifaSpesaConsumiBundle(
  readJsonSnapshot(
    join(process.cwd(), "src/data/generated/aifa-spesa-consumi-2022-2025.data.json"),
    // L'artefatto pesa circa 4 MB: il margine serve alle rigenerazioni, non a leggere altro.
    8 * 1024 * 1024,
  ),
  metadataArtifact,
);

export const aifaSpesaConsumiData: AifaSpesaConsumiData = validated.data;
export const aifaSpesaConsumiMetadata: AifaSpesaConsumiMetadata = validated.metadata;

const REGION_CODES = new Set(aifaSpesaConsumiData.regions.map((entry) => entry.code));
const CLASS_CODES = new Set(aifaSpesaConsumiData.classes.map((entry) => entry.code));
const ATC2_CODES = new Set(aifaSpesaConsumiData.atc2.map((entry) => entry.code));

export type AifaSpesaConsumiQuery = Readonly<{
  year?: number;
  regionCode?: string;
  class?: string;
  atc2?: string;
}>;

export type AifaSpesaConsumiQueryResult = Readonly<{
  datasetId: string;
  period: AifaSpesaConsumiData["period"];
  granularity: AifaSpesaConsumiData["granularity"];
  units: AifaSpesaConsumiData["units"];
  channels: AifaSpesaConsumiData["channels"];
  coverage: AifaSpesaConsumiData["coverage"];
  reconciliation: AifaSpesaConsumiData["reconciliation"];
  caveats: readonly string[];
  regions: AifaSpesaConsumiData["regions"];
  classes: AifaSpesaConsumiData["classes"];
  atc2: AifaSpesaConsumiData["atc2"];
  observations: readonly AifaSpesaConsumiObservation[];
  source: Readonly<{
    owner: string;
    landingUrl: string;
    licenseId: string;
    licenseNote: string;
    publicationDate: string;
    observedAt: string;
  }>;
  semantics: AifaSpesaConsumiMetadata["semantics"];
}>;

function normalizeYear(year: number | undefined): number | undefined {
  if (year === undefined) return undefined;
  const { from, to } = aifaSpesaConsumiData.period;
  if (!Number.isSafeInteger(year) || year < from || year > to) {
    throw new Error(`Anno fuori dal periodo coperto (${from}-${to}).`);
  }
  return year;
}

function normalizeRegion(code: string | undefined): string | undefined {
  if (code === undefined) return undefined;
  if (!REGION_CODES.has(code)) {
    throw new Error("Regione non riconosciuta: usare il codice ISTAT a tre cifre, per esempio 030.");
  }
  return code;
}

function normalizeClass(code: string | undefined): string | undefined {
  if (code === undefined) return undefined;
  const value = code === "c-bis" ? "C-bis" : code.length === 3 ? code : code.toUpperCase();
  if (!CLASS_CODES.has(value)) {
    throw new Error("Classe di rimborsabilità non riconosciuta: usare A, C, C-bis, Cnn, H oppure N.");
  }
  return value;
}

function normalizeAtc2(code: string | undefined): string | undefined {
  if (code === undefined) return undefined;
  const value = code.toUpperCase();
  if (!ATC2_CODES.has(value)) {
    throw new Error("Codice ATC di II livello non pubblicato in questo snapshot.");
  }
  return value;
}

export function queryAifaSpesaConsumi(query: AifaSpesaConsumiQuery = {}): AifaSpesaConsumiQueryResult {
  const year = normalizeYear(query.year);
  const regionCode = normalizeRegion(query.regionCode);
  const klass = normalizeClass(query.class);
  const atc2 = normalizeAtc2(query.atc2);

  const observations = aifaSpesaConsumiData.observations.filter(
    (row) =>
      (year === undefined || row.year === year) &&
      (regionCode === undefined || row.regionCode === regionCode) &&
      (klass === undefined || row.class === klass) &&
      (atc2 === undefined || row.atc2 === atc2),
  );

  return {
    datasetId: aifaSpesaConsumiData.datasetId,
    period: aifaSpesaConsumiData.period,
    granularity: aifaSpesaConsumiData.granularity,
    units: aifaSpesaConsumiData.units,
    channels: aifaSpesaConsumiData.channels,
    coverage: aifaSpesaConsumiData.coverage,
    reconciliation: aifaSpesaConsumiData.reconciliation,
    caveats: aifaSpesaConsumiData.caveats,
    regions: regionCode === undefined
      ? aifaSpesaConsumiData.regions
      : aifaSpesaConsumiData.regions.filter((entry) => entry.code === regionCode),
    classes: aifaSpesaConsumiData.classes,
    atc2: atc2 === undefined
      ? aifaSpesaConsumiData.atc2
      : aifaSpesaConsumiData.atc2.filter((entry) => entry.code === atc2),
    observations,
    source: {
      owner: aifaSpesaConsumiMetadata.source.owner,
      landingUrl: aifaSpesaConsumiMetadata.source.landingUrl,
      licenseId: aifaSpesaConsumiMetadata.source.licenseId,
      licenseNote: aifaSpesaConsumiMetadata.source.licenseNote,
      publicationDate: aifaSpesaConsumiMetadata.source.sourceUpdated,
      observedAt: aifaSpesaConsumiMetadata.observedAt,
    },
    semantics: aifaSpesaConsumiMetadata.semantics,
  };
}
