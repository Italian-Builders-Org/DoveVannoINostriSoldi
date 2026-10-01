import "server-only";
import { join } from "node:path";
import { readJsonSnapshot } from "@/lib/data/read-json-snapshot";
import { OPENCIVITAS_2019_FUNCTIONS } from "@/lib/data/opencivitas-2019-functions";
import { assertOpenCivitasFunctionSnapshot } from "@/lib/data/opencivitas-function-contract";
import { queryOpenCivitasFunction, type OpenCivitasFunctionFilters } from "@/lib/opencivitas-function-query";

const RELEASE = OPENCIVITAS_2019_FUNCTIONS["rifiuti"];

export const openCivitas2019RifiutiSnapshot = assertOpenCivitasFunctionSnapshot(
  RELEASE,
  readJsonSnapshot(
    join(process.cwd(), "src/data/generated/opencivitas-2019-rifiuti.json"),
    2 * 1024 * 1024,
  ),
);

export function queryOpenCivitas2019Rifiuti(filters: OpenCivitasFunctionFilters) {
  return queryOpenCivitasFunction(RELEASE, openCivitas2019RifiutiSnapshot, filters);
}
