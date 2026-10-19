import "server-only";

import { join } from "node:path";
import { readJsonSnapshot } from "@/lib/data/read-json-snapshot";
import { OCCUPAZIONE_INDEX_DIR } from "@/lib/rgs-conto-annuale-occupazione-paths";
import { ENTE_DATASET_ID, TIPOLOGIA_DATASET_ID } from "@/lib/rgs-conto-annuale-occupazione-constants";
import {
  getOccupazioneCorpusPublicRows,
  getOccupazioneHubIndex,
  occupationHubMetadata,
  type OccupazioneHubIndex,
} from "@/lib/rgs-conto-annuale-occupazione-summary";

export type { OccupazioneHubIndex };

export type OccupazioneSearchEntry = Readonly<{
  code: string;
  name: string;
  type: string;
  permanentLatest: number;
}>;

const search = readJsonSnapshot(join(OCCUPAZIONE_INDEX_DIR, "search.json"), 2 * 1024 * 1024) as OccupazioneSearchEntry[];

const summary = getOccupazioneHubIndex();
if (search.length !== summary.searchableCount) {
  throw new Error("Indice search occupazione: conteggio istituzioni divergente.");
}

export function getOccupazioneSearchIndex(): readonly OccupazioneSearchEntry[] {
  return search;
}

export {
  getOccupazioneCorpusPublicRows,
  getOccupazioneHubIndex,
  occupationHubMetadata,
  ENTE_DATASET_ID,
  TIPOLOGIA_DATASET_ID,
};
