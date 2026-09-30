import "server-only";
import snapshotJson from "@/data/generated/opencivitas-2019-rifiuti.json";
import { OPENCIVITAS_2019_FUNCTIONS } from "@/lib/data/opencivitas-2019-functions";
import { assertOpenCivitasFunctionSnapshot } from "@/lib/data/opencivitas-function-contract";
import { queryOpenCivitasFunction, type OpenCivitasFunctionFilters } from "@/lib/opencivitas-function-query";

const RELEASE = OPENCIVITAS_2019_FUNCTIONS["rifiuti"];

export const openCivitas2019RifiutiSnapshot = assertOpenCivitasFunctionSnapshot(RELEASE, snapshotJson);

export function queryOpenCivitas2019Rifiuti(filters: OpenCivitasFunctionFilters) {
  return queryOpenCivitasFunction(RELEASE, openCivitas2019RifiutiSnapshot, filters);
}
