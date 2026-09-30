import { createOpenCivitas2019FunctionGet } from "@/lib/opencivitas-2019-function-query";
import { queryOpenCivitas2019Polizia } from "@/lib/opencivitas-2019-polizia-snapshot";

export const GET = createOpenCivitas2019FunctionGet("polizia", queryOpenCivitas2019Polizia);
