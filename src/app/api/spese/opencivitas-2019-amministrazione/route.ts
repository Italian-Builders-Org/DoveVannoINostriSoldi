import { OPENCIVITAS_2019_FUNCTIONS } from "@/lib/data/opencivitas-2019-functions";
import { createOpenCivitasFunctionGet } from "@/lib/opencivitas-function-query";
import { queryOpenCivitas2019Amministrazione } from "@/lib/opencivitas-2019-amministrazione-snapshot";

export const GET = createOpenCivitasFunctionGet(OPENCIVITAS_2019_FUNCTIONS["amministrazione"], queryOpenCivitas2019Amministrazione);
