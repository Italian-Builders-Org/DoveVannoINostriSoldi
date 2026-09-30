import { OPENCIVITAS_2018_FUNCTIONS } from "@/lib/data/opencivitas-2018-functions";
import { createOpenCivitasFunctionGet } from "@/lib/opencivitas-function-query";
import { queryOpenCivitas2018Istruzione } from "@/lib/opencivitas-2018-istruzione-snapshot";

export const GET = createOpenCivitasFunctionGet(OPENCIVITAS_2018_FUNCTIONS["istruzione"], queryOpenCivitas2018Istruzione);
