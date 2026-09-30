import { OPENCIVITAS_2018_FUNCTIONS } from "@/lib/data/opencivitas-2018-functions";
import { createOpenCivitasFunctionGet } from "@/lib/opencivitas-function-query";
import { queryOpenCivitas2018Amministrazione } from "@/lib/opencivitas-2018-amministrazione-snapshot";

export const GET = createOpenCivitasFunctionGet(OPENCIVITAS_2018_FUNCTIONS["amministrazione"], queryOpenCivitas2018Amministrazione);
