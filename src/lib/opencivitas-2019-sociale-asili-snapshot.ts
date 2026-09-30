import "server-only";
import snapshotJson from "@/data/generated/opencivitas-2019-sociale-asili.json";
import { OPENCIVITAS_2019_FUNCTIONS } from "@/lib/data/opencivitas-2019-functions";
import { assertOpenCivitasFunctionSnapshot } from "@/lib/data/opencivitas-function-contract";
import { queryOpenCivitasFunction, type OpenCivitasFunctionFilters } from "@/lib/opencivitas-function-query";

const RELEASE = OPENCIVITAS_2019_FUNCTIONS["sociale-asili"];

export const openCivitas2019SocialeAsiliSnapshot = assertOpenCivitasFunctionSnapshot(RELEASE, snapshotJson);

export function queryOpenCivitas2019SocialeAsili(filters: OpenCivitasFunctionFilters) {
  return queryOpenCivitasFunction(RELEASE, openCivitas2019SocialeAsiliSnapshot, filters);
}
