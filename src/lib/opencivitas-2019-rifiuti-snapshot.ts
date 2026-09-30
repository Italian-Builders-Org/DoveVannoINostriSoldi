import "server-only";
import snapshotJson from "@/data/generated/opencivitas-2019-rifiuti.json";
import { assertOpenCivitas2019FunctionSnapshot } from "@/lib/data/opencivitas-2019-function-contract";
import {
  queryOpenCivitas2019Function,
  type OpenCivitas2019FunctionFilters,
} from "@/lib/opencivitas-2019-function-query";

export const openCivitas2019RifiutiSnapshot = assertOpenCivitas2019FunctionSnapshot("rifiuti", snapshotJson);

export function queryOpenCivitas2019Rifiuti(filters: OpenCivitas2019FunctionFilters) {
  return queryOpenCivitas2019Function("rifiuti", openCivitas2019RifiutiSnapshot, filters);
}
