import { OPENCIVITAS_2018_FUNCTIONS } from "@/lib/data/opencivitas-2018-functions";
import { createOpenCivitasFunctionGet } from "@/lib/opencivitas-function-query";
import { queryOpenCivitas2018SocialeAsili } from "@/lib/opencivitas-2018-sociale-asili-snapshot";

export const GET = createOpenCivitasFunctionGet(OPENCIVITAS_2018_FUNCTIONS["sociale-asili"], queryOpenCivitas2018SocialeAsili);
