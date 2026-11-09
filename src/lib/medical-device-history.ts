import "server-only";

import history from "@/data/editorial-snapshots/dispositivi-storico.json";

export function getMedicalDeviceSpendingHistory() {
  return history;
}
