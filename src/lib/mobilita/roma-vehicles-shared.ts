/**
 * Coalesces concurrent reads of the Roma VehiclePositions feed on one instance.
 * The public API route and MCP tool share this loader so ATAC is not contacted twice.
 * A successful read is reused for {@link INSTANCE_TTL_MS}; only failures clear inflight
 * early. Recent upstream failures without last-good are cached for
 * {@link VEHICLE_FEED_FAILURE_CACHE_MS}.
 */
import {
  FEED_FETCH_BUDGET_MS,
  loadRomaRealtimeVehicles,
  resetRomaVehicleLastGoodForTests,
  type FetchLike,
  type RomaRealtimeVehiclesView,
} from "@/lib/mobilita/roma-gtfs-realtime";
import { resetRomaArrivalsLastGoodForTests } from "@/lib/mobilita/roma-trip-updates";

const INSTANCE_TTL_MS = 10_000;

/** Brief negative cache when the feed fails without a last-good snapshot (route + MCP). */
export const VEHICLE_FEED_FAILURE_CACHE_MS = 5_000;

export type LoadRomaVehiclesCoalescedOptions = {
  feedFetchBudgetMs?: number;
};

type FailureCache = { at: number; error: unknown };

let inflight: { at: number; promise: Promise<RomaRealtimeVehiclesView> } | null = null;
let recentFailure: FailureCache | null = null;

/** Clears coalescing and last-good caches (unit tests only). */
export function resetRomaMobilitaRealtimeForTests(): void {
  inflight = null;
  recentFailure = null;
  resetRomaVehicleLastGoodForTests();
  resetRomaArrivalsLastGoodForTests();
}

export function loadRomaRealtimeVehiclesCoalesced(
  fetchImpl: FetchLike = fetch,
  now: () => number = Date.now,
  options: LoadRomaVehiclesCoalescedOptions = {},
): Promise<RomaRealtimeVehiclesView> {
  const feedFetchBudgetMs = options.feedFetchBudgetMs ?? FEED_FETCH_BUDGET_MS;
  const at = now();
  if (recentFailure) {
    if (at - recentFailure.at < VEHICLE_FEED_FAILURE_CACHE_MS) {
      const cached = recentFailure.error;
      const rejected = Promise.reject(cached);
      void rejected.catch(() => undefined);
      return rejected;
    }
    recentFailure = null;
  }
  if (inflight && at - inflight.at < INSTANCE_TTL_MS) return inflight.promise;

  const promise = loadRomaRealtimeVehicles(fetchImpl, now, feedFetchBudgetMs);
  const entry = { at, promise };
  inflight = entry;
  void promise
    .then(() => {
      recentFailure = null;
    })
    .catch((error) => {
      recentFailure = { at: now(), error };
      if (inflight === entry) inflight = null;
    });
  return promise;
}
