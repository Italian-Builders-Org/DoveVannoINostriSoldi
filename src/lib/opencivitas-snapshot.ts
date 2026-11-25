import { join } from "node:path";
import { readJsonSnapshot } from "@/lib/data/read-json-snapshot";
import {
  assertOpenCivitasSnapshot,
  type OpenCivitasSnapshot,
} from "@/lib/data/opencivitas-contract";

// Read at runtime: a typed JSON import makes tsc infer every row (815 KiB).
const snapshotJson: unknown = readJsonSnapshot(
  join(process.cwd(), "src/data/generated/opencivitas-2022.json"),
  2 * 1024 * 1024,
);

export const openCivitasSnapshot: OpenCivitasSnapshot =
  assertOpenCivitasSnapshot(snapshotJson);
