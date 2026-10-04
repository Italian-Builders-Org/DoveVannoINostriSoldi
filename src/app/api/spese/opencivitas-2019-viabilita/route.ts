import { OPENCIVITAS_2019_FUNCTIONS } from "@/lib/data/opencivitas-2019-functions";
import { createOpenCivitasFunctionGet } from "@/lib/opencivitas-function-query";
import { queryOpenCivitas2019Viabilita } from "@/lib/opencivitas-2019-viabilita-snapshot";

export const GET = createOpenCivitasFunctionGet(OPENCIVITAS_2019_FUNCTIONS["viabilita"], queryOpenCivitas2019Viabilita);
