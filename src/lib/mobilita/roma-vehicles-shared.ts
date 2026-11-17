/**
 * Coalesces concurrent reads of the Roma VehiclePositions feed on one instance.
 * The public API route and MCP tool share this loader so ATAC is not contacted twice.
 */
import {
  loadRomaRealtimeVehicles,
  type FetchLike,
  type RomaRealtimeVehiclesView,
} from "@/lib/mobilita/roma-gtfs-realtime";

const INSTANCE_TTL_MS = 10_000;

let inflight: { at: number; promise: Promise<RomaRealtimeVehiclesView> } | null = null;

export function loadRomaRealtimeVehiclesCoalesced(
  fetchImpl: FetchLike = fetch,
  now: () => number = Date.now,
): Promise<RomaRealtimeVehiclesView> {
  const at = now();
  if (inflight && at - inflight.at < INSTANCE_TTL_MS) return inflight.promise;
  const promise = loadRomaRealtimeVehicles(fetchImpl, now);
  const entry = { at, promise };
  inflight = entry;
  promise.catch(() => {
    if (inflight === entry) inflight = null;
  });
  return promise;
}