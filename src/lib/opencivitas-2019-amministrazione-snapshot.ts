import "server-only";
import { join } from "node:path";
import { readJsonSnapshot } from "@/lib/data/read-json-snapshot";
import { OPENCIVITAS_2019_FUNCTIONS } from "@/lib/data/opencivitas-2019-functions";
import { assertOpenCivitasFunctionSnapshot } from "@/lib/data/opencivitas-function-contract";
import { queryOpenCivitasFunction, type OpenCivitasFunctionFilters } from "@/lib/opencivitas-function-query";

const RELEASE = OPENCIVITAS_2019_FUNCTIONS["amministrazione"];

export const openCivitas2019AmministrazioneSnapshot = assertOpenCivitasFunctionSnapshot(
  RELEASE,
  readJsonSnapshot(
    join(process.cwd(), "src/data/generated/opencivitas-2019-amministrazione.json"),
    2 * 1024 * 1024,
  ),
);

export function queryOpenCivitas2019Amministrazione(filters: OpenCivitasFunctionFilters) {
  return queryOpenCivitasFunction(RELEASE, openCivitas2019AmministrazioneSnapshot, filters);
}
