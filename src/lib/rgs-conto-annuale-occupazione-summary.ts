import "server-only";

import { join } from "node:path";
import { readJsonSnapshot } from "@/lib/data/read-json-snapshot";
import type { IntegratedDatasetMetadata } from "@/lib/integrated-public-view";
import { ENTE_DATASET_ID } from "@/lib/rgs-conto-annuale-occupazione-constants";
import { OCCUPAZIONE_INDEX_DIR } from "@/lib/rgs-conto-annuale-occupazione-paths";

export type OccupazioneHubIndex = Readonly<{
  schemaVersion: 2;
  datasetId: string;
  tipologiaDatasetId: string;
  years: readonly number[];
  baselineYear: number;
  latestYear: number;
  institutionCount: number;
  publicRows: number;
  searchableCount: number;
  catalogSha256: string;
  rowsSha256: string;
  sourceMetadata: IntegratedDatasetMetadata["sourceMetadata"];
  caveats: readonly string[];
  licenseStatus: IntegratedDatasetMetadata["licenseStatus"];
  nationalSeries: readonly Readonly<{ year: number; permanent: number; flexible: number; types: number }>[];
  typeTotalsLatest: readonly Readonly<{ type: string; permanent: number; flexible: number; institutions: number }>[];
  growth: readonly Readonly<{ code: string; name: string; type: string; baseline: number; latest: number; delta: number }>[];
  shrink: readonly Readonly<{ code: string; name: string; type: string; baseline: number; latest: number; delta: number }>[];
}>;

const summary = readJsonSnapshot(join(OCCUPAZIONE_INDEX_DIR, "summary.json"), 512 * 1024) as OccupazioneHubIndex;

if (summary.schemaVersion !== 2 || summary.datasetId !== ENTE_DATASET_ID) {
  throw new Error("Indice hub occupazione: schema o dataset divergenti.");
}

export function getOccupazioneHubIndex(): OccupazioneHubIndex {
  return summary;
}

export function getOccupazioneCorpusPublicRows(): number {
  const rows = summary.publicRows;
  if (!Number.isFinite(rows) || rows < 1) {
    throw new Error("Indice occupazione: publicRows non valido.");
  }
  return rows;
}

export function occupationHubMetadata(): Pick<
  OccupazioneHubIndex,
  "caveats" | "licenseStatus" | "sourceMetadata" | "publicRows"
> {
  return {
    caveats: summary.caveats,
    licenseStatus: summary.licenseStatus,
    sourceMetadata: summary.sourceMetadata,
    publicRows: summary.publicRows,
  };
}
