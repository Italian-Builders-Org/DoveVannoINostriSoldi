import "server-only";

import snapshot from "@/data/editorial-snapshots/salute-posti-letto.json";
import type { IntegratedDatasetMetadata } from "@/lib/integrated-public-view";

export function getHospitalBeds() {
  return { dataset: snapshot.dataset as IntegratedDatasetMetadata, regions: snapshot.regions };
}
