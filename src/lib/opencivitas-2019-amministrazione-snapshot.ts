import "server-only";
import snapshotJson from "@/data/generated/opencivitas-2019-amministrazione.json";
import { assertOpenCivitas2019FunctionSnapshot } from "@/lib/data/opencivitas-2019-function-contract";
import {
  queryOpenCivitas2019Function,
  type OpenCivitas2019FunctionFilters,
} from "@/lib/opencivitas-2019-function-query";

export const openCivitas2019AmministrazioneSnapshot = assertOpenCivitas2019FunctionSnapshot("amministrazione", snapshotJson);

export function queryOpenCivitas2019Amministrazione(filters: OpenCivitas2019FunctionFilters) {
  return queryOpenCivitas2019Function("amministrazione", openCivitas2019AmministrazioneSnapshot, filters);
}
