import { OPENCIVITAS_2019_FUNCTIONS } from "@/lib/data/opencivitas-2019-functions";
import { createOpenCivitasFunctionGet } from "@/lib/opencivitas-function-query";
import { queryOpenCivitas2019SocialeAsili } from "@/lib/opencivitas-2019-sociale-asili-snapshot";

export const GET = createOpenCivitasFunctionGet(OPENCIVITAS_2019_FUNCTIONS["sociale-asili"], queryOpenCivitas2019SocialeAsili);
