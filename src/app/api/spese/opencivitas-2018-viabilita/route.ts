import { OPENCIVITAS_2018_FUNCTIONS } from "@/lib/data/opencivitas-2018-functions";
import { createOpenCivitasFunctionGet } from "@/lib/opencivitas-function-query";
import { queryOpenCivitas2018Viabilita } from "@/lib/opencivitas-2018-viabilita-snapshot";

export const GET = createOpenCivitasFunctionGet(OPENCIVITAS_2018_FUNCTIONS["viabilita"], queryOpenCivitas2018Viabilita);
