import { createOpenCivitas2019FunctionGet } from "@/lib/opencivitas-2019-function-query";
import { queryOpenCivitas2019SocialeAsili } from "@/lib/opencivitas-2019-sociale-asili-snapshot";

export const GET = createOpenCivitas2019FunctionGet("sociale-asili", queryOpenCivitas2019SocialeAsili);
