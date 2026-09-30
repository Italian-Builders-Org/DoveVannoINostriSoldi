import { createOpenCivitas2019FunctionGet } from "@/lib/opencivitas-2019-function-query";
import { queryOpenCivitas2019Rifiuti } from "@/lib/opencivitas-2019-rifiuti-snapshot";

export const GET = createOpenCivitas2019FunctionGet("rifiuti", queryOpenCivitas2019Rifiuti);
