import "server-only";
import snapshotJson from "@/data/generated/opencivitas-2019-sociale-asili.json";
import { assertOpenCivitas2019FunctionSnapshot } from "@/lib/data/opencivitas-2019-function-contract";
import {
  queryOpenCivitas2019Function,
  type OpenCivitas2019FunctionFilters,
} from "@/lib/opencivitas-2019-function-query";

export const openCivitas2019SocialeAsiliSnapshot = assertOpenCivitas2019FunctionSnapshot("sociale-asili", snapshotJson);

export function queryOpenCivitas2019SocialeAsili(filters: OpenCivitas2019FunctionFilters) {
  return queryOpenCivitas2019Function("sociale-asili", openCivitas2019SocialeAsiliSnapshot, filters);
}
