import "server-only";
import snapshotJson from "@/data/generated/opencivitas-2019-istruzione.json";
import { assertOpenCivitas2019FunctionSnapshot } from "@/lib/data/opencivitas-2019-function-contract";
import {
  queryOpenCivitas2019Function,
  type OpenCivitas2019FunctionFilters,
} from "@/lib/opencivitas-2019-function-query";

export const openCivitas2019IstruzioneSnapshot = assertOpenCivitas2019FunctionSnapshot("istruzione", snapshotJson);

export function queryOpenCivitas2019Istruzione(filters: OpenCivitas2019FunctionFilters) {
  return queryOpenCivitas2019Function("istruzione", openCivitas2019IstruzioneSnapshot, filters);
}
