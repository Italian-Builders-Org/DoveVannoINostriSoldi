import { createOpenCivitas2019FunctionGet } from "@/lib/opencivitas-2019-function-query";
import { queryOpenCivitas2019Viabilita } from "@/lib/opencivitas-2019-viabilita-snapshot";

export const GET = createOpenCivitas2019FunctionGet("viabilita", queryOpenCivitas2019Viabilita);
