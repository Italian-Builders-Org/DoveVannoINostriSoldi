import { createOpenCivitas2019FunctionGet } from "@/lib/opencivitas-2019-function-query";
import { queryOpenCivitas2019Istruzione } from "@/lib/opencivitas-2019-istruzione-snapshot";

export const GET = createOpenCivitas2019FunctionGet("istruzione", queryOpenCivitas2019Istruzione);
