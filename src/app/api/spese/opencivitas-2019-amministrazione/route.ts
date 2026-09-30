import { createOpenCivitas2019FunctionGet } from "@/lib/opencivitas-2019-function-query";
import { queryOpenCivitas2019Amministrazione } from "@/lib/opencivitas-2019-amministrazione-snapshot";

export const GET = createOpenCivitas2019FunctionGet("amministrazione", queryOpenCivitas2019Amministrazione);
