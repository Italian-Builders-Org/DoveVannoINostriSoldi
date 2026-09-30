import { OPENCIVITAS_2018_FUNCTIONS } from "@/lib/data/opencivitas-2018-functions";
import { createOpenCivitasFunctionGet } from "@/lib/opencivitas-function-query";
import { queryOpenCivitas2018Polizia } from "@/lib/opencivitas-2018-polizia-snapshot";

export const GET = createOpenCivitasFunctionGet(OPENCIVITAS_2018_FUNCTIONS["polizia"], queryOpenCivitas2018Polizia);
