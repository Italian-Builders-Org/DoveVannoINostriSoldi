import "server-only";
import snapshotJson from "@/data/generated/opencivitas-2019-polizia.json";
import { assertOpenCivitas2019FunctionSnapshot } from "@/lib/data/opencivitas-2019-function-contract";
import {
  queryOpenCivitas2019Function,
  type OpenCivitas2019FunctionFilters,
} from "@/lib/opencivitas-2019-function-query";

export const openCivitas2019PoliziaSnapshot = assertOpenCivitas2019FunctionSnapshot("polizia", snapshotJson);

export function queryOpenCivitas2019Polizia(filters: OpenCivitas2019FunctionFilters) {
  return queryOpenCivitas2019Function("polizia", openCivitas2019PoliziaSnapshot, filters);
}
