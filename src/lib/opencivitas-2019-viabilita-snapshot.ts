import "server-only";
import snapshotJson from "@/data/generated/opencivitas-2019-viabilita.json";
import { assertOpenCivitas2019FunctionSnapshot } from "@/lib/data/opencivitas-2019-function-contract";
import {
  queryOpenCivitas2019Function,
  type OpenCivitas2019FunctionFilters,
} from "@/lib/opencivitas-2019-function-query";

export const openCivitas2019ViabilitaSnapshot = assertOpenCivitas2019FunctionSnapshot("viabilita", snapshotJson);

export function queryOpenCivitas2019Viabilita(filters: OpenCivitas2019FunctionFilters) {
  return queryOpenCivitas2019Function("viabilita", openCivitas2019ViabilitaSnapshot, filters);
}
