import "server-only";
import snapshotJson from "@/data/generated/opencivitas-2019-amministrazione.json";
import { OPENCIVITAS_2019_FUNCTIONS } from "@/lib/data/opencivitas-2019-functions";
import { assertOpenCivitasFunctionSnapshot } from "@/lib/data/opencivitas-function-contract";
import { queryOpenCivitasFunction, type OpenCivitasFunctionFilters } from "@/lib/opencivitas-function-query";

const RELEASE = OPENCIVITAS_2019_FUNCTIONS["amministrazione"];

export const openCivitas2019AmministrazioneSnapshot = assertOpenCivitasFunctionSnapshot(RELEASE, snapshotJson);

export function queryOpenCivitas2019Amministrazione(filters: OpenCivitasFunctionFilters) {
  return queryOpenCivitasFunction(RELEASE, openCivitas2019AmministrazioneSnapshot, filters);
}
