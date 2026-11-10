import "server-only";

import snapshot from "@/data/editorial-snapshots/dispositivi.json";
import type { aggregateMedicalDeviceSpending } from "@/lib/medical-device-spending";

export function getMedicalDeviceSpendingHistory() {
  return snapshot.history;
}

export function getDefaultMedicalDeviceAggregate(): Awaited<ReturnType<typeof aggregateMedicalDeviceSpending>> {
  return snapshot.defaultAggregate as Awaited<ReturnType<typeof aggregateMedicalDeviceSpending>>;
}
