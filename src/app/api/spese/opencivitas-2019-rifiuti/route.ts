import { OPENCIVITAS_2019_FUNCTIONS } from "@/lib/data/opencivitas-2019-functions";
import { createOpenCivitasFunctionGet } from "@/lib/opencivitas-function-query";
import { queryOpenCivitas2019Rifiuti } from "@/lib/opencivitas-2019-rifiuti-snapshot";

export const GET = createOpenCivitasFunctionGet(OPENCIVITAS_2019_FUNCTIONS["rifiuti"], queryOpenCivitas2019Rifiuti);
