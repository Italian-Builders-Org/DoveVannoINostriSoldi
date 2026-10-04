import { OPENCIVITAS_2019_FUNCTIONS } from "@/lib/data/opencivitas-2019-functions";
import { createOpenCivitasFunctionGet } from "@/lib/opencivitas-function-query";
import { queryOpenCivitas2019Istruzione } from "@/lib/opencivitas-2019-istruzione-snapshot";

export const GET = createOpenCivitasFunctionGet(OPENCIVITAS_2019_FUNCTIONS["istruzione"], queryOpenCivitas2019Istruzione);
