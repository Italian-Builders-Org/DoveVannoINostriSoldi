import snapshotJson from "@/data/generated/consulenti-overview.json";
import {
  assertConsulentiSnapshot,
  type ConsulentiSnapshot,
} from "@/lib/data/consulenti-contract";

export const consulentiSnapshot: ConsulentiSnapshot = assertConsulentiSnapshot(snapshotJson);
