import snapshotJson from "@/data/generated/opencivitas-2022.json";
import {
  assertOpenCivitasSnapshot,
  type OpenCivitasSnapshot,
} from "@/lib/data/opencivitas-contract";

export const openCivitasSnapshot: OpenCivitasSnapshot =
  assertOpenCivitasSnapshot(snapshotJson);
