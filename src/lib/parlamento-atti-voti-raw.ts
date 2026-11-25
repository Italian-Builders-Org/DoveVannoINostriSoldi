import { join } from "node:path";
import { readJsonSnapshot } from "@/lib/data/read-json-snapshot";

/*
 * Camera and Senato roll-call snapshots, read once per server instance and
 * shared by `politici-repubblica` and `politici-voti-tema`. A typed JSON import
 * of these 7 MiB makes tsc infer every vote row; callers keep validating the
 * value with the parse functions of their contracts.
 */
export const cameraAttiVotiJson: unknown = readJsonSnapshot(
  join(process.cwd(), "src/data/generated/camera-atti-voti-xix.json"),
  10 * 1024 * 1024,
);

export const senatoAttiVotiJson: unknown = readJsonSnapshot(
  join(process.cwd(), "src/data/generated/senato-atti-voti-xix.json"),
  6 * 1024 * 1024,
);
