import "server-only";

import rawSnapshot from "@/data/generated/indire-pnrr-assignments.json";
import { assertIndirePnrrAssignmentsSnapshot } from "@/lib/data/indire-pnrr-assignments-contract";

export const indirePnrrAssignmentsSnapshot = assertIndirePnrrAssignmentsSnapshot(rawSnapshot);
