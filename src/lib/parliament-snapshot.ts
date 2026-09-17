import snapshotJson from "@/data/generated/parliament-overview.json";
import {
  assertParliamentSnapshot,
  type ParliamentSnapshot,
} from "@/lib/data/parliament-contract";

export const parliamentSnapshot: ParliamentSnapshot = assertParliamentSnapshot(snapshotJson);
