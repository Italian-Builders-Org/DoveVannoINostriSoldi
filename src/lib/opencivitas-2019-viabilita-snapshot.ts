import "server-only";
import snapshotJson from "@/data/generated/opencivitas-2019-viabilita.json";
import { OPENCIVITAS_2019_FUNCTIONS } from "@/lib/data/opencivitas-2019-functions";
import { assertOpenCivitasFunctionSnapshot } from "@/lib/data/opencivitas-function-contract";
import { queryOpenCivitasFunction, type OpenCivitasFunctionFilters } from "@/lib/opencivitas-function-query";

const RELEASE = OPENCIVITAS_2019_FUNCTIONS["viabilita"];

export const openCivitas2019ViabilitaSnapshot = assertOpenCivitasFunctionSnapshot(RELEASE, snapshotJson);

export function queryOpenCivitas2019Viabilita(filters: OpenCivitasFunctionFilters) {
  return queryOpenCivitasFunction(RELEASE, openCivitas2019ViabilitaSnapshot, filters);
}
